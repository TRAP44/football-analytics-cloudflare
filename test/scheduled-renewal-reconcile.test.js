import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledLeaseRuntime} from '../src/scheduled-lease.js';
const clock=Date.parse('2026-10-19T00:00:00Z');
const claim={claimed:true,persistent:true,jobKey:'cron:test',groupKey:'cron-global',leaseToken:'owner-token-123456789',leaseSeconds:720,lockedUntil:new Date(clock+720000).toISOString()};
const row=()=>({status:'running',group_key:claim.groupKey,lease_token:claim.leaseToken,locked_until:claim.lockedUntil});
function harness({read=async()=>row(),error='UPSTREAM_TIMEOUT',now=()=>clock,onRecord=async()=>{}}={}){
  const calls=[],events=[];let reads=0;
  const rt=createScheduledLeaseRuntime({hasSupabase:()=>true,now,sleepMs:async()=>{},
    supaRpc:async(...args)=>{calls.push(args);throw Object.assign(Error('private upstream detail'),{code:error});},
    readScheduledJob:async(...args)=>{reads++;return read(...args);},recordOpsEvent:async(_cfg,event)=>{events.push(event);await onRecord(event);},redactOpsString:()=> 'redacted',
  });return {rt,calls,events,get reads(){return reads;}};
}
test('two lost renewal responses can retain DB-confirmed ownership without a third write or work replay',async()=>{
  const h=harness();const result=await h.rt.renewScheduledJob({},claim);
  assert.equal(result.renewed,true);assert.equal(result.reason,'ownership_confirmed');assert.equal(result.lockedUntil,claim.lockedUntil);
  assert.equal(h.calls.length,2);assert.equal(h.reads,1);
  for(const call of h.calls){assert.equal(call[1],'renew_scheduled_job');assert.equal(call[2].p_lease_token,claim.leaseToken);}
  assert.equal(h.events[0].code,'SCHEDULED_LEASE_RENEW_CONFIRMED');assert.doesNotMatch(JSON.stringify(h.events),/owner-token|private/);
});
test('changed owner/group, nonrunning, expired and insufficient heartbeat horizon all stop execution',async()=>{
  for(const value of [null,{}, {...row(),lease_token:'other-owner-token'}, {...row(),group_key:'other'}, {...row(),status:'done'}, {...row(),status:'failed'}, {...row(),locked_until:'invalid'}, {...row(),locked_until:new Date(clock-1).toISOString()}, {...row(),locked_until:new Date(clock+365000).toISOString()}]){
    const h=harness({read:async()=>value});const result=await h.rt.renewScheduledJob({},claim);
    assert.equal(result.renewed,false);assert.equal(result.reason,'lease_unavailable');assert.equal(h.calls.length,2);assert.equal(h.reads,1);
    assert.equal(h.events.at(-1).code,'SCHEDULED_LEASE_RENEW_FAILED');
  }
});
test('unavailable read and permanent RPC failure never become a successful heartbeat',async()=>{
  for(const options of [{read:async()=>{throw Error('read failed');}},{error:'HTTP_403'}]){
    const h=harness(options);assert.equal((await h.rt.renewScheduledJob({},claim)).renewed,false);
    assert.equal(h.reads,options.error?0:1);assert.equal(h.calls.length,options.error?1:2);
  }
});
test('reconciliation requires enough observed lease horizon for the next heartbeat rather than assuming extension',async()=>{
  const h=harness({read:async()=>({...row(),locked_until:new Date(clock+365001).toISOString()})});
  const result=await h.rt.renewScheduledJob({},claim);assert.equal(result.renewed,true);assert.equal(result.lockedUntil,new Date(clock+365001).toISOString());
});


test('slow observability cannot grant ownership after the safe heartbeat horizon elapsed',async()=>{
  let current=clock;
  const h=harness({now:()=>current,onRecord:async event=>{if(event.code==='SCHEDULED_LEASE_RENEW_CONFIRMED')current=clock+355000;}});
  assert.equal((await h.rt.renewScheduledJob({},claim)).renewed,false);
  assert.equal(h.events.at(-1).code,'SCHEDULED_LEASE_RENEW_FAILED');
});
test('an explicit ownership rejection is never overridden with a read',async()=>{
  let reads=0;
  const rt=createScheduledLeaseRuntime({hasSupabase:()=>true,supaRpc:async()=>({renewed:false,reason:'ownership_lost',jobKey:claim.jobKey}),readScheduledJob:async()=>{reads++;return row();}});
  assert.equal((await rt.renewScheduledJob({},claim)).renewed,false);assert.equal(reads,0);
});
