import test from 'node:test';
import assert from 'node:assert/strict';
import {installSupabaseTransportTrace} from '../scripts/supabase-transport-trace.js';
function harness(limit=40){
  const handlers=new Map();let clock=0,removed=0;
  const trace=installSupabaseTransportTrace({limit,now:()=>clock,subscribe:(name,fn)=>{handlers.set(name,fn);return()=>removed++;}});
  return {trace,emit:(name,data)=>handlers.get('undici:'+name)(data),at:ms=>{clock=ms;},removed:()=>removed};
}
const request=()=>({origin:'https://project.supabase.co',path:'/rest/v1/rpc/claim_scheduled_job?secret=private',method:'POST',headers:'private token',body:'private payload'});

test('records dispatch, header and body timings of existing requests, including reused sockets',()=>{
  const h=harness(),one=request(),two=request(),socket={remoteAddress:'private IP'};
  h.emit('request:create',{request:one});h.at(200);h.emit('client:sendHeaders',{request:one,socket});
  h.at(250);h.emit('request:headers',{request:one,response:{statusCode:200,headers:['private token']}});
  h.at(300);h.emit('request:trailers',{request:one});
  h.at(60300);h.emit('request:create',{request:two});h.at(60310);h.emit('client:sendHeaders',{request:two,socket});
  assert.deepEqual(h.trace.entries,[
    '1 POST /rest/v1/rpc/claim_scheduled_job created 0ms',
    '1 POST /rest/v1/rpc/claim_scheduled_job sent 200ms connection=first_seen idle=0ms',
    '1 POST /rest/v1/rpc/claim_scheduled_job headers 250ms status=200',
    '1 POST /rest/v1/rpc/claim_scheduled_job complete 300ms',
    '2 POST /rest/v1/rpc/claim_scheduled_job created 0ms',
    '2 POST /rest/v1/rpc/claim_scheduled_job sent 10ms connection=reused idle=60010ms',
  ]);
  assert.doesNotMatch(h.trace.entries.join('\n'),/private|project|secret|headers=/);
  h.trace.restore();assert.equal(h.removed(),5);
});

test('timeouts before send and after send remain distinguishable without arbitrary error text',()=>{
  const h=harness(),one=request(),two=request();
  h.emit('request:create',{request:one});h.at(2500);h.emit('request:error',{request:one,error:{code:'UND_ERR_CONNECT_TIMEOUT',message:'private IP'}});
  h.emit('request:create',{request:two});h.emit('client:sendHeaders',{request:two,socket:{}});
  h.at(4300);h.emit('request:error',{request:two,error:{code:'private code',message:'private token'}});
  assert.match(h.trace.entries[1],/error 2500ms code=UND_ERR_CONNECT_TIMEOUT/);
  assert.match(h.trace.entries.at(-1),/error 1800ms code=unknown/);
  assert.doesNotMatch(h.trace.entries.join('\n'),/private/);
});

test('ignores unrelated services, malformed events, path injection and query values; ring buffer is bounded',()=>{
  const h=harness(3);
  for(const req of [null,{...request(),origin:'https://api.telegram.org'},{...request(),origin:'https://project.supabase.co.evil.example'},{...request(),path:'/rest/v1/rpc/<private>'},{...request(),method:'private'}]){
    h.emit('request:create',{request:req});h.emit('request:error',{request:req,error:{message:'private'}});
  }
  assert.equal(h.trace.entries.length,0);
  for(let i=0;i<10;i++){const req=request();h.emit('request:create',{request:req});h.emit('request:error',{request:req,error:{name:'AbortError'}});}
  assert.equal(h.trace.entries.length,3);
  assert.match(h.trace.entries.at(-1),/code=aborted/);
});

test('early failure survives successful later ticks and keeps its own send/header phases',()=>{
  const h=harness(4),failed=request(),socket={};
  h.emit('request:create',{request:failed});h.at(5);h.emit('client:sendHeaders',{request:failed,socket});
  h.at(1800);h.emit('request:error',{request:failed,error:{name:'AbortError'}});
  for(let i=0;i<30;i++){
    const req=request();h.emit('request:create',{request:req});h.emit('client:sendHeaders',{request:req,socket});
    h.emit('request:headers',{request:req,response:{statusCode:200}});h.emit('request:trailers',{request:req});
  }
  assert.equal(h.trace.entries.length,4);assert.equal(h.trace.failures.length,1);
  assert.match(h.trace.failures[0],/error 1800ms code=aborted sent=5ms headers=nonems connection=first_seen/);
  assert.deepEqual(h.trace.stats,{requests:31,completed:30,errors:1,maxSentMs:5,maxHeadersMs:0});
  for(let i=0;i<20;i++){const req=request();h.emit('request:create',{request:req});h.emit('request:error',{request:req,error:{name:'AbortError'}});}
  assert.equal(h.trace.failures.length,10);
});
