import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledLeaseRuntime} from '../src/scheduled-lease.js';
const clock=Date.parse('2026-10-19T00:00:00Z');
const claim={claimed:true,persistent:true,jobKey:'cron:sample',groupKey:'cron-global',leaseToken:'owner-token-123456789',lockedUntil:new Date(clock+30000).toISOString()};
const timeout=()=>Object.assign(Error('upstream timeout'),{code:'UPSTREAM_TIMEOUT'});
const row=status=>({status,group_key:claim.groupKey,lease_token:claim.leaseToken,locked_until:claim.lockedUntil});
function harness(rpc,read){
  const calls=[],reads=[],events=[];
  const rt=createScheduledLeaseRuntime({hasSupabase:()=>true,now:()=>clock,
    supaRpc:async(...args)=>{calls.push(args);return rpc(calls.length,...args);},
    readScheduledJob:async(...args)=>{reads.push(args);return read(reads.length,...args);},
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  });return {rt,calls,reads,events};
}
test('lost completion response is confirmed by its owner without replaying work or RPC',async()=>{
  const h=harness(async()=>{throw timeout();},async()=>row('done'));
  assert.equal(await h.rt.completeScheduledJob({},claim),true);
  assert.equal(h.calls.length,1);assert.equal(h.reads.length,1);
  assert.equal(h.reads[0][1],claim.jobKey);
  assert.equal(h.events[0].code,'SCHEDULED_LEASE_COMPLETE_RECOVERED');
  assert.doesNotMatch(JSON.stringify(h.events),/owner-token/);
});
test('uncommitted completion gets one owner-checked retry and no release or claim',async()=>{
  const h=harness(async n=>{if(n===1)throw timeout();return true;},async()=>row('running'));
  assert.equal(await h.rt.completeScheduledJob({},claim),true);
  assert.equal(h.calls.length,2);assert.equal(h.reads.length,1);
  for(const [index,call] of h.calls.entries()){assert.equal(call[1],'complete_scheduled_job');assert.ok(call[3]>0&&call[3]<=(index===0?4000:1800));assert.equal(call[2].p_lease_token,claim.leaseToken);assert.ok(call[5] instanceof AbortSignal);}
});
test('second lost response is confirmed once, never retried a third time',async()=>{
  for(const final of ['done','running']){
    const h=harness(async()=>{throw timeout();},async n=>row(n===1?'running':final));
    assert.equal(await h.rt.completeScheduledJob({},claim),final==='done');
    assert.equal(h.calls.length,2);assert.equal(h.reads.length,2);
  }
});
test('ownership changes, expired leases, malformed rows and read errors fail closed',async()=>{
  for(const value of [null,{},row('failed'),{...row('done'),lease_token:'different-owner-token'},{...row('done'),group_key:'other'},{...row('running'),locked_until:new Date(clock+2000).toISOString()},Error('read failed')]){
    const h=harness(async()=>{throw timeout();},async()=>{if(value instanceof Error)throw value;return value;});
    assert.equal(await h.rt.completeScheduledJob({},claim),false);
    assert.equal(h.calls.length,1);assert.equal(h.events[0].code,'SCHEDULED_LEASE_COMPLETE_FAILED');
  }
});
test('false acknowledgements, permanent errors and release operations are never replayed',async()=>{
  for(const scenario of ['false','permanent','release']){
    const h=harness(async()=>{if(scenario==='false')return false;throw Object.assign(Error('failed'),{code:scenario==='release'?'UPSTREAM_TIMEOUT':'HTTP_403'});},async()=>row('done'));
    assert.equal(await h.rt[scenario==='release'?'releaseScheduledJob':'completeScheduledJob']({},claim),false);
    assert.equal(h.calls.length,1);assert.equal(h.reads.length,0);
  }
});


test('a measured slow completion is accepted without creating an unnecessary second write',async()=>{
  const h=harness(async()=>{await new Promise(resolve=>setTimeout(resolve,2200));return true;},async()=>{throw Error('unexpected read');});
  assert.equal(await h.rt.completeScheduledJob({},claim),true);
  assert.equal(h.calls.length,1);assert.equal(h.reads.length,0);
});

test('completion writes and reconciliation share one seven-second deadline and cancel both transports',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let elapsed=0;
  t.mock.method(performance,'now',()=>elapsed);
  let writeSignal,readSignal;
  const h=harness(async(...args)=>{writeSignal=args.at(-1);return new Promise(()=>{});},async(_n,_cfg,_job,options)=>{readSignal=options.signal;return new Promise(()=>{});});
  const turn=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};
  const result=h.rt.completeScheduledJob({},claim);await turn();
  elapsed=4000;t.mock.timers.tick(4000);await turn();
  assert.equal(h.calls.length,1);assert.equal(h.reads.length,1);assert.equal(writeSignal.aborted,true);
  elapsed=7000;t.mock.timers.tick(3000);await turn();
  assert.equal(await result,false);assert.equal(readSignal.aborted,true);
  elapsed=17000;t.mock.timers.tick(10000);await turn();assert.equal(h.calls.length,1);
});


test('slow diagnostic logging cannot turn proven completion into failure or delay its return',async()=>{
  const events=[];
  const rt=createScheduledLeaseRuntime({hasSupabase:()=>true,now:()=>clock,
    supaRpc:async()=>{throw timeout();},readScheduledJob:async()=>row('done'),
    recordOpsEvent:async(_cfg,event)=>{events.push(event.code);return new Promise(()=>{});},
  });
  assert.equal(await rt.completeScheduledJob({},claim),true);
  assert.deepEqual(events,['SCHEDULED_LEASE_COMPLETE_RECOVERED']);
});
