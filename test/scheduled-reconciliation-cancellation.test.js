import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseClient} from '../src/supabase-client.js';
import {createServiceWiringRuntime} from '../src/service-wiring-runtime.js';
import {withRequestDeadline} from '../src/request-deadline.js';
import {createScheduledLeaseRuntime} from '../src/scheduled-lease.js';
const cfg={supabaseUrl:'https://example.supabase.co',supabaseKey:'test-key'};
const claim={claimed:true,persistent:true,jobKey:'cron:test',groupKey:'cron-global',leaseToken:'owner-token-123456789',leaseSeconds:720,lockedUntil:new Date(Date.now()+720000).toISOString()};
const timeout=()=>Object.assign(Error('timeout'),{code:'UPSTREAM_TIMEOUT'});

test('a reconciliation read inherits the short deadline and aborts its actual fetch',async()=>{
  let signal,calls=0;
  const client=createSupabaseClient({fetchWithTimeout:async(_url,init,budget)=>{
    calls++;signal=init.signal;assert.ok(budget>0&&budget<=30);
    return await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  await assert.rejects(client.supaSelectMany(cfg,'scheduled_job_leases',{}, {timeoutMs:30}),error=>error.code==='UPSTREAM_TIMEOUT');
  assert.equal(calls,1);assert.equal(signal.aborted,true);
});

test('caller cancellation reaches fetch and body parsing without a second read',async()=>{
  for(const stage of ['fetch','body']){
    const caller=new AbortController();let calls=0,transportSignal;
    const client=createSupabaseClient({fetchWithTimeout:async(_url,init)=>{
      calls++;transportSignal=init.signal;
      const pending=()=>new Promise((_,reject)=>transportSignal.addEventListener('abort',()=>reject(transportSignal.reason),{once:true}));
      if(stage==='fetch'){
        const result=pending();queueMicrotask(()=>caller.abort(timeout()));return await result;
      }
      return {ok:true,status:200,json:()=>{const result=pending();queueMicrotask(()=>caller.abort(timeout()));return result;}};
    }});
    await assert.rejects(client.supaSelectMany(cfg,'scheduled_job_leases',{}, {signal:caller.signal,timeoutMs:100}),error=>error.code==='UPSTREAM_TIMEOUT');
    assert.equal(transportSignal.aborted,true);assert.equal(calls,1);
  }
});

test('already cancelled read performs no I/O and a caller without options keeps the normal budget',async()=>{
  const caller=new AbortController();caller.abort(timeout());let calls=0;
  const client=createSupabaseClient({now:()=>0,fetchWithTimeout:async(_url,_init,budget)=>{calls++;assert.equal(budget,7000);return {ok:true,json:async()=>[]};}});
  await assert.rejects(client.supaSelectMany(cfg,'scheduled_job_leases',{}, {signal:caller.signal}));assert.equal(calls,0);
  assert.deepEqual(await client.supaSelectMany(cfg,'scheduled_job_leases'),[]);assert.equal(calls,1);
});

function wired(read){
  let lease;
  const deps=new Proxy({
    createScheduledLeaseRuntime:options=>{lease=createScheduledLeaseRuntime({...options,sleepMs:async()=>{}});return lease;},
    hasSupabase:()=>true,supaRpc:async()=>{throw timeout();},
    supaSelectMany:read,recordOpsEvent:async()=>{},redactOpsString:()=>'',
  },{get:(target,key)=>key in target?target[key]:()=>({})});
  createServiceWiringRuntime(deps);
  return lease;
}

test('renew and completion pass signal and remaining time through the actual service wiring',async()=>{
  for(const operation of ['renewScheduledJob','completeScheduledJob']){
    let calls=0;
    const lease=wired(async(_cfg,table,filters,options)=>{
      calls++;assert.equal(table,'scheduled_job_leases');assert.equal(filters.job_key,'eq.cron:test');
      assert.equal(options.limit,1);assert.match(options.select,/lease_token/);
      assert.ok(options.signal instanceof AbortSignal);assert.equal(options.signal.aborted,false);
      assert.ok(options.timeoutMs>0&&options.timeoutMs<=7000);
      return [{status:operation==='renewScheduledJob'?'running':'done',lease_token:claim.leaseToken,group_key:claim.groupKey,locked_until:claim.lockedUntil}];
    });
    const result=await lease[operation](cfg,claim);
    assert.equal(operation==='renewScheduledJob'?result.renewed:result,true);assert.equal(calls,1);
  }
});


test('outer timeout cancels the underlying owner read rather than merely abandoning its promise',async()=>{
  let signal,release,child;
  const client=createSupabaseClient({fetchWithTimeout:async(_url,init)=>{
    signal=init.signal;
    return await new Promise((resolve,reject)=>{
      release=()=>resolve({ok:true,json:async()=>[]});
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
  }});
  try{
    await assert.rejects(withRequestDeadline(({signal:outer,remaining})=>{
      child=client.supaSelectMany(cfg,'scheduled_job_leases',{}, {signal:outer,timeoutMs:remaining()});
      return child;
    },{budgetMs:30,source:'Owner read'}),error=>error.code==='UPSTREAM_TIMEOUT');
    assert.equal(signal.aborted,true,'the abandoned GET must not retain its independent 7-second timer');
  }finally{release?.();await child?.catch(()=>{});}
});


test('a cold-schema three-second claim remains one acquisition',async()=>{
  const scheduledAt=new Date();let requests=0;const owners=[];
  const client=createSupabaseClient({fetchWithTimeout:async(_url,init)=>{
    requests++;owners.push(JSON.parse(init.body).p_owner_token);
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>resolve(new Response(JSON.stringify({claimed:true,jobKey:claim.jobKey,groupKey:claim.groupKey,leaseToken:owners[0],scheduledAt:scheduledAt.toISOString(),lockedUntil:new Date(Date.now()+720000).toISOString()}),{status:200})),3000);
      init.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(init.signal.reason);},{once:true});
    });
  }});
  const lease=createScheduledLeaseRuntime({hasSupabase:()=>true,supaRpc:client.supaRpc});
  const result=await lease.claimScheduledJob(cfg,{jobKey:claim.jobKey,groupKey:claim.groupKey,scheduledAt});
  assert.equal(result.claimed,true);assert.equal(requests,1);assert.equal(new Set(owners).size,1);
});

test('readback waits for a two-second owner confirmation instead of discarding a valid result',async()=>{
  const lease=createScheduledLeaseRuntime({hasSupabase:()=>true,sleepMs:async()=>{},supaRpc:async()=>{throw timeout();},readScheduledJob:async()=>{
    await new Promise(resolve=>setTimeout(resolve,2000));
    return {status:'running',lease_token:claim.leaseToken,group_key:claim.groupKey,locked_until:new Date(Date.now()+720000).toISOString()};
  }});
  const result=await lease.renewScheduledJob(cfg,claim);
  assert.equal(result.renewed,true);assert.equal(result.reason,'ownership_confirmed');
});
