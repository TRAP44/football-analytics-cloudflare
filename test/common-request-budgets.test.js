import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../public/modules/client-core.js';
const flush=()=>new Promise(setImmediate);
function client(extra={}){
  const state={compatibilityBlocked:false,clientPerf:{requests:0,deduped:0,retries:0,rateLimited:0,completed:0,totalMs:0,failed:0,timeouts:0}};
  const inflightGetRequests=new Map();const failures=[];
  const api=createApiClient({state,inflightGetRequests,tg:null,observeServerVersion(){},showBootRecovery(){},applyRuntimeUi(){},normalizeApiError:e=>e,noteRequestSuccess(){},noteRequestFailure:e=>failures.push(e),...extra});
  return {api,state,inflightGetRequests,failures};
}
const response=(data,status=200)=>({ok:status===200,status,headers:new Headers(),json:async()=>data});

test('browser retry and a stalled body share one total deadline; late body cannot publish success',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const original=globalThis.fetch;let clock=0,calls=0,finish;
  globalThis.fetch=async()=>{
    calls++;if(calls===1){clock=400;return response({},503);}
    return {...response({}),json:()=>new Promise(resolve=>{finish=resolve;})};
  };
  try{
    const r=client({now:()=>clock});const pending=r.api('/api/me',{timeoutMs:1000});
    await flush();clock=950;t.mock.timers.tick(600);await flush();
    assert.equal(calls,2);clock=1000;t.mock.timers.tick(50);
    await assert.rejects(pending,error=>error.status===408);assert.equal(r.state.clientPerf.completed,0);
    finish({ok:true});await flush();assert.equal(r.state.clientPerf.completed,0);assert.equal(r.inflightGetRequests.size,0);
  }finally{globalThis.fetch=original;}
});

test('mutation invalidates old in-flight dedupe entries; old completion cannot erase a newer read',async()=>{
  const original=globalThis.fetch;let calls=0;const replies=[];
  globalThis.fetch=async(_url,init)=>{
    if(init.method==='POST')return response({ok:true});calls++;
    return {...response({}),json:()=>new Promise(resolve=>replies.push(resolve))};
  };
  try{
    const r=client();const old=r.api('/api/favorites');await flush();
    await r.api('/api/favorites',{method:'POST',body:'{}'});
    const fresh=r.api('/api/favorites');await flush();assert.equal(calls,2);
    replies[0]({items:['old']});await old;assert.equal(r.inflightGetRequests.size,1);
    replies[1]({items:['new']});assert.deepEqual(await fresh,{items:['new']});assert.equal(r.inflightGetRequests.size,0);
  }finally{globalThis.fetch=original;}
});

test('caller cancellation is isolated, never retried and never marks the connection failed',async()=>{
  const original=globalThis.fetch;const replies=[];
  globalThis.fetch=async()=>({...response({}),json:()=>new Promise(resolve=>replies.push(resolve))});
  try{
    const r=client();const abort=new AbortController();
    const cancelled=r.api('/api/me',{signal:abort.signal});const active=r.api('/api/me');await flush();
    assert.equal(replies.length,2);abort.abort();await assert.rejects(cancelled,error=>error.status===499);
    assert.equal(r.failures.length,0);assert.equal(r.state.clientPerf.retries,0);
    replies[1]({id:42});assert.deepEqual(await active,{id:42});replies[0]({id:99});await flush();
    assert.equal(r.state.clientPerf.completed,1);
  }finally{globalThis.fetch=original;}
});

test('reads with different timeout policies never inherit another callers longer budget',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return response({ok:true});};
  try{
    const r=client();await Promise.all([r.api('/api/me',{timeoutMs:1000}),r.api('/api/me',{timeoutMs:9000})]);assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});
