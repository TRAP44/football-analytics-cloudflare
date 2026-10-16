import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseClient} from '../src/supabase-client.js';
import {createCommonInfrastructureRuntime} from '../src/common-infrastructure-runtime.js';
import {createScheduledLeaseRuntime} from '../src/scheduled-lease.js';
const cfg={supabaseUrl:'http://127.0.0.1:54321',supabaseKey:'local-only'};
const never=()=>new Promise(()=>{});

test('RPC bounds a stalled body after headers, aborts it and allows a later call', {timeout:4000},async()=>{
  for(const status of [200,503]){
    let calls=0,signal;
    const client=createSupabaseClient({fetchWithTimeout:async(_url,init)=>{
      calls++;signal=init.signal;
      return calls===1 ? {ok:status===200,status,json:never} : Response.json([{renewed:true}]);
    }});
    await assert.rejects(client.supaRpc(cfg,'renew_scheduled_job',{},500),{code:'UPSTREAM_TIMEOUT'});
    assert.equal(calls,1);assert.equal(signal.aborted,true);
    assert.deepEqual(await client.supaRpc(cfg,'renew_scheduled_job',{},500),{renewed:true});
    assert.equal(calls,2);
  }
});

test('RPC deadline also bounds a transport ignoring AbortSignal, without replay', {timeout:2000},async()=>{
  let calls=0,signal,finish;
  const client=createSupabaseClient({fetchWithTimeout:async(_url,init)=>{
    calls++;signal=init.signal;return new Promise(resolve=>finish=resolve);
  }});
  await assert.rejects(client.supaRpc(cfg,'consume_analysis_quota',{},500),{code:'UPSTREAM_TIMEOUT'});
  assert.equal(signal.aborted,true);assert.equal(calls,1);
  finish(Response.json({consumed:true}));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
});

test('headers and body share the original monotonic deadline, late success is rejected',async()=>{
  let clock=0,calls=0;
  const client=createSupabaseClient({now:()=>clock,fetchWithTimeout:async()=>{
    calls++;clock=1200;
    return {ok:true,json:async()=>{clock=1801;return {renewed:true};}};
  }});
  await assert.rejects(client.supaRpc(cfg,'renew_scheduled_job',{},1800),{code:'UPSTREAM_TIMEOUT'});
  assert.equal(calls,1);
});

test('headers received after deadline never start body parsing',async()=>{
  let clock=0;
  const client=createSupabaseClient({now:()=>clock,fetchWithTimeout:async()=>{
    clock=1800;return {ok:true,json:()=>assert.fail('late body must not be read')};
  }});
  await assert.rejects(client.supaRpc(cfg,'complete_scheduled_job',{},1800),{code:'UPSTREAM_TIMEOUT'});
});

test('RPC retains in-budget payload and PostgREST error contracts',async()=>{
  const replies=[Response.json([{claimed:true}]),Response.json({code:'42501',message:'private detail',details:'detail'},{status:403}),new Response('not-json')];
  const client=createSupabaseClient({redactMessage:()=> 'redacted',fetchWithTimeout:async()=>replies.shift()});
  assert.deepEqual(await client.supaRpc(cfg,'claim_scheduled_job'),{claimed:true});
  await assert.rejects(client.supaRpc(cfg,'claim_scheduled_job'),error=>{
    assert.equal(error.code,'42501');assert.equal(error.detail,'detail');assert.match(error.message,/redacted/);assert.doesNotMatch(error.message,/private detail/);return true;
  });
  assert.equal(await client.supaRpc(cfg,'claim_scheduled_job'),null);
});

test('real infrastructure helper carries the RPC signal through response body consumption', {timeout:2000},async t=>{
  let signal;
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    signal=init.signal;
    return {ok:true,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))};
  });
  const infra=createCommonInfrastructureRuntime({bumpTelemetry:()=>{}});
  const client=createSupabaseClient({fetchWithTimeout:infra.fetchWithTimeout});
  await assert.rejects(client.supaRpc(cfg,'claim_scheduled_job',{},500),{code:'UPSTREAM_TIMEOUT'});
  assert.equal(signal.aborted,true);
});

test('a timed-out renewal body reaches the existing bounded retry; completion is not replayed', {timeout:5000},async()=>{
  const calls=[],events=[];let firstRenew=true,clock=0;
  const client=createSupabaseClient({now:()=>clock,fetchWithTimeout:async(url,init)=>{
    const name=new URL(url).pathname.split('/').pop();calls.push({name,body:init.body});
    if(name==='renew_scheduled_job' && firstRenew){firstRenew=false;return {ok:true,json:async()=>{clock+=1801;return {renewed:true};}};}
    if(name==='complete_scheduled_job')return {ok:true,json:async()=>{clock+=1801;return {completed:true};}};
    return Response.json({renewed:true,lockedUntil:new Date(Date.now()+60000).toISOString()});
  }});
  const rt=createScheduledLeaseRuntime({hasSupabase:()=>true,supaRpc:client.supaRpc,sleepMs:async()=>{},recordOpsEvent:async(_cfg,event)=>events.push(event)});
  const claim={claimed:true,persistent:true,jobKey:'cron:sample',groupKey:'cron-global',leaseToken:'owner-token-123456789',lockedUntil:new Date(Date.now()+30000).toISOString(),leaseSeconds:30};
  assert.equal((await rt.renewScheduledJob(cfg,claim)).renewed,true);
  assert.deepEqual(calls.map(x=>x.name),['renew_scheduled_job','renew_scheduled_job']);assert.equal(calls[0].body,calls[1].body);
  assert.equal(events[0].code,'SCHEDULED_LEASE_RENEW_RECOVERED');
  assert.equal(await rt.completeScheduledJob(cfg,claim),false);
  assert.equal(calls.filter(x=>x.name==='complete_scheduled_job').length,1);
});
