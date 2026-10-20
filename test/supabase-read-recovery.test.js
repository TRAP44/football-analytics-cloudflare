import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createSupabaseClient,supabaseReadRecoverySnapshot} from '../src/supabase-client.js';
import {createCommonInfrastructureRuntime} from '../src/common-infrastructure-runtime.js';
import {createSupabaseAdmissionFetch} from '../scripts/supabase-fetch-admission.js';
const cfg={supabaseUrl:'https://fixture.supabase.co',supabaseKey:'fixture-only',cronRunner:'github-actions'};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function harness(t,transport){
  t.mock.timers.enable({apis:['setTimeout']});let clock=0;const calls=[];
  const client=createSupabaseClient({now:()=>clock,sleepMs:async()=>{},fetchWithTimeout:async(url,init,budget)=>{
    calls.push({url,init,budget});return transport(calls.length,url,init);
  }});
  return {client,calls,async tick(ms){clock+=ms;t.mock.timers.tick(ms);await turn();}};
}

test('fast background SELECT stays one request and clears the fallback timer',async t=>{
  const h=harness(t,()=>Response.json([{id:1}]));
  assert.deepEqual(await h.client.supaSelectMany(cfg,'match_reminders'),[{id:1}]);
  await h.tick(3000);assert.equal(h.calls.length,1);
});

test('stalled first GET recovers after two seconds within the original seven-second budget',async t=>{
  const before=supabaseReadRecoverySnapshot();const first=deferred();
  const h=harness(t,n=>n===1?first.promise:Response.json([{id:2}]));
  const result=h.client.supaSelectMany(cfg,'match_reminders');await turn();
  await h.tick(1999);assert.equal(h.calls.length,1);
  await h.tick(1);assert.deepEqual(await result,[{id:2}]);
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].budget,5000);
  assert.ok(h.calls.every(call=>call.init.signal.aborted));
  let cancelled=0;
  first.resolve(new Response(new ReadableStream({cancel(){cancelled++;}})));
  await turn();assert.equal(cancelled,1);assert.equal(h.calls.length,2);
  const after=supabaseReadRecoverySnapshot();assert.equal(after.slowFallbacks-before.slowFallbacks,1);assert.equal(after.slowFallbackWins-before.slowFallbackWins,1);
});

test('fallback covers a stalled JSON body and late data cannot replace its result',async t=>{
  const body=deferred();
  const h=harness(t,n=>n===1?{ok:true,status:200,json:()=>body.promise}:Response.json([{id:3}]));
  const result=h.client.supaSelectOne(cfg,'analysis_cache',{});await turn();await h.tick(2000);
  assert.deepEqual(await result,{id:3});assert.equal(h.calls[0].init.signal.aborted,true);
  body.resolve([{id:99}]);await turn();assert.equal(h.calls.length,2);
});

test('a healthy slow original can win and cancels the secondary request',async t=>{
  const first=deferred(),second=deferred(),before=supabaseReadRecoverySnapshot();
  const h=harness(t,n=>n===1?first.promise:second.promise);
  const result=h.client.supaSelectMany(cfg,'runtime_controls');await turn();await h.tick(2000);
  assert.equal(h.calls.length,2);first.resolve(Response.json([{id:4}]));
  assert.deepEqual(await result,[{id:4}]);assert.equal(h.calls[1].init.signal.aborted,true);
  assert.equal(supabaseReadRecoverySnapshot().originalWins-before.originalWins,1);
});

for(const kind of ['network','503'])test(`failed fallback (${kind}) preserves the live original without a third attempt`,async t=>{
  const first=deferred();
  const h=harness(t,n=>{
    if(n===1)return first.promise;
    if(kind==='network')throw new Error('transport');
    return new Response('temporarily unavailable',{status:503});
  });
  const result=h.client.supaSelectMany(cfg,'match_reminders');await turn();await h.tick(2000);
  assert.equal(h.calls.length,2);await h.tick(1000);first.resolve(Response.json([{id:5}]));
  assert.deepEqual(await result,[{id:5}]);assert.equal(h.calls.length,2);
});

test('early transient status consumes the second attempt without an additional delayed fallback',async t=>{
  const second=deferred();
  const h=harness(t,n=>n===1?new Response('retry',{status:503}):second.promise);
  const result=h.client.supaSelectMany(cfg,'match_reminders');await turn();await turn();
  assert.equal(h.calls.length,2);await h.tick(2500);assert.equal(h.calls.length,2);
  second.resolve(Response.json([]));assert.deepEqual(await result,[]);
});

test('both stalled attempts terminate at the original deadline, including ignored transport signals',async t=>{
  const h=harness(t,()=>new Promise(()=>{}));
  const result=h.client.supaSelectMany(cfg,'match_reminders');
  const rejected=assert.rejects(result,{code:'UPSTREAM_TIMEOUT'});
  await turn();await h.tick(2000);assert.equal(h.calls.length,2);
  await h.tick(5000);await rejected;
  assert.ok(h.calls.every(call=>call.init.signal.aborted));
  await h.tick(10000);assert.equal(h.calls.length,2);
});

test('caller cancellation stops both reads immediately and never starts more I/O',async t=>{
  const controller=new AbortController(),reason=new Error('caller stopped');
  const h=harness(t,()=>new Promise(()=>{}));
  const result=h.client.supaSelectMany(cfg,'scheduled_job_leases',{}, {signal:controller.signal});
  const rejected=assert.rejects(result,error=>error===reason);
  await turn();await h.tick(2000);controller.abort(reason);await rejected;
  assert.ok(h.calls.every(call=>call.init.signal.aborted));await h.tick(7000);assert.equal(h.calls.length,2);
});

test('ordinary auth, rate limits and invalid SELECT payloads remain terminal',async t=>{
  for(const status of [401,403,429,500,200]){
    let calls=0;
    const client=createSupabaseClient({fetchWithTimeout:async()=>{
      calls++;return status===200?Response.json({invalid:true}):new Response('denied',{status});
    }});
    await assert.rejects(client.supaSelectMany(cfg,'match_reminders'));
    assert.equal(calls,1);
  }
  // A malformed secondary cannot be counted as successful recovery.
  const before=supabaseReadRecoverySnapshot();
  const h=harness(t,n=>n===1?new Promise(()=>{}):Response.json({invalid:true}));
  const rejected=assert.rejects(h.client.supaSelectMany(cfg,'match_reminders'),/invalid response payload/);
  await turn();await h.tick(2000);await rejected;
  assert.equal(supabaseReadRecoverySnapshot().slowFallbackWins,before.slowFallbackWins);
});

test('one active fallback per client bounds pressure and releases the reservation after completion',async t=>{
  const first=deferred(),second=deferred(),third=deferred();let fallback=deferred();
  const h=harness(t,n=>n===1?first.promise:n===2?second.promise:n===4?third.promise:fallback.promise);
  const a=h.client.supaSelectMany(cfg,'analysis_cache',{id:'eq.1'});
  const b=h.client.supaSelectMany(cfg,'analysis_cache',{id:'eq.2'});
  await turn();await h.tick(2000);assert.equal(h.calls.length,3);
  fallback.resolve(Response.json([{id:1}]));assert.deepEqual(await a,[{id:1}]);
  second.resolve(Response.json([{id:2}]));assert.deepEqual(await b,[{id:2}]);
  // Reservation was released: the next slow read gets its own fallback.
  fallback=deferred();const c=h.client.supaSelectMany(cfg,'analysis_cache',{id:'eq.3'});
  await turn();await h.tick(2000);assert.equal(h.calls.length,5);
  fallback.resolve(Response.json([{id:3}]));assert.deepEqual(await c,[{id:3}]);
});

test('HTTP Worker reads and small deadlines do not launch delayed requests',async t=>{
  const first=deferred();const h=harness(t,n=>n===1?first.promise:new Promise(()=>{}));
  const result=h.client.supaSelectMany({...cfg,cronRunner:''},'match_reminders');
  await turn();await h.tick(2500);assert.equal(h.calls.length,1);
  first.resolve(Response.json([]));assert.deepEqual(await result,[]);
  const short=h.client.supaSelectMany(cfg,'match_reminders',{}, {timeoutMs:500});
  const rejected=assert.rejects(short,{code:'UPSTREAM_TIMEOUT'});await turn();await h.tick(500);
  await rejected;assert.equal(h.calls.length,2);
});

test('native fetch recovers stalled headers and bodies on a real local HTTP connection', {timeout:10000},async()=>{
  for(const sendHeaders of [false,true]){
    let calls=0,closed=false;
    const server=createServer((_req,res)=>{
      calls++;
      if(calls===1){res.on('close',()=>{closed=true;});if(sendHeaders){res.writeHead(200,{'Content-Type':'application/json'});res.write('[');}return;}
      res.writeHead(200,{'Content-Type':'application/json'});res.end('[{"id":6}]');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const telemetry={};
      const infrastructure=createCommonInfrastructureRuntime({bumpTelemetry:key=>{telemetry[key]=(telemetry[key]||0)+1;}});
      const client=createSupabaseClient({fetchWithTimeout:infrastructure.fetchWithTimeout});
      const started=performance.now();
      const result=await client.supaSelectMany({...cfg,supabaseUrl:`http://127.0.0.1:${server.address().port}`},'match_reminders');
      assert.deepEqual(result,[{id:6}]);assert.equal(calls,2);
      assert.ok(performance.now()-started<5500,'recovered before the old seven-second failure');
      await new Promise(resolve=>setTimeout(resolve,10));assert.equal(closed,true);
      assert.equal(telemetry.upstreamTimeouts||0,0,'superseding a read is not an upstream timeout');
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
});


test('delayed reads cannot consume the lease reserve and aborted queued fallback never reaches transport',async t=>{
  const controller=new AbortController(),reason=new Error('cancel queued reads'),sent=[];
  const admission=createSupabaseAdmissionFetch(async(url,init)=>{
    sent.push(String(url));
    if(String(url).includes('/rpc/'))return Response.json({renewed:true});
    return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  },{origin:cfg.supabaseUrl});
  const h=harness(t,(_n,url,init)=>admission.fetch(url,init));
  const reads=[1,2,3].map(id=>h.client.supaSelectMany(cfg,'analysis_cache',{id:`eq.${id}`},{signal:controller.signal}));
  const results=Promise.allSettled(reads);await turn();await h.tick(2000);
  assert.equal(admission.stats.started,3);assert.equal(h.calls.length,4);
  const lease=await admission.fetch(`${cfg.supabaseUrl}/rest/v1/rpc/renew_scheduled_job`,{method:'POST'});
  assert.equal(lease.ok,true);assert.equal(admission.stats.peakActive,4);assert.equal(admission.stats.peakRegular,3);
  controller.abort(reason);const outcomes=await results;await turn();
  assert.ok(outcomes.every(result=>result.status==='rejected'&&result.reason===reason));
  assert.ok(admission.stats.cancelledQueued>=1);assert.equal(sent.length,4);
  await h.tick(7000);assert.equal(sent.length,4);
});

test('Node writes keep a single attempt when stalled past the read fallback threshold',async t=>{
  const h=harness(t,()=>new Promise(()=>{}));
  const rejected=assert.rejects(h.client.supaUpsert(cfg,'analysis_cache',{id:1},'id'),{code:'UPSTREAM_TIMEOUT'});
  await turn();await h.tick(2000);assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,'POST');
  await h.tick(5000);await rejected;assert.equal(h.calls.length,1);
});
