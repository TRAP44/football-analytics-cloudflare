import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledLeaseRuntime} from '../src/scheduled-lease.js';
const at=Date.parse('2026-10-16T10:00:00Z');
const claim={claimed:true,persistent:true,jobKey:'cron:sample',groupKey:'cron-global',leaseToken:'owner-token-123456789',lockedUntil:new Date(at+30000).toISOString(),leaseSeconds:30};
const timeout=()=>Object.assign(new Error('timeout'),{code:'UPSTREAM_TIMEOUT'});
function harness(rpc,overrides={}){
 const calls=[],events=[],sleeps=[];
 const rt=createScheduledLeaseRuntime({hasSupabase:()=>true,now:()=>at,sleepMs:async ms=>sleeps.push(ms),recordOpsEvent:async(_cfg,event)=>events.push(event),supaRpc:async(...args)=>{calls.push(args);return rpc(...args);},...overrides});
 return{rt,calls,events,sleeps};
}
test('lost renewal response is retried once with exactly the same ownership and deadline',async()=>{
 let writes=0;const h=harness(async()=>{if(++writes===1)throw timeout();return{renewed:true,lockedUntil:new Date(at+60000).toISOString()};});
 assert.equal((await h.rt.renewScheduledJob({},claim)).renewed,true);
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0],h.calls[1]);assert.equal(h.calls[0][3],1800);assert.deepEqual(h.sleeps,[150]);
 assert.deepEqual(h.events.map(event=>event.code),['SCHEDULED_LEASE_RENEW_RECOVERED']);
});
test('a missing, expired or nearly expired confirmed lease never permits retry',async()=>{
 for(const lockedUntil of [null,'invalid',new Date(at-1).toISOString(),new Date(at+5000).toISOString()]){
  const h=harness(async()=>{throw timeout();});assert.equal((await h.rt.renewScheduledJob({},{...claim,lockedUntil})).renewed,false);
  assert.equal(h.calls.length,1);assert.equal(h.sleeps.length,0);
 }
});
test('lease budget is checked again after backoff',async()=>{
 let clock=at;const h=harness(async()=>{throw timeout();},{now:()=>clock,sleepMs:async()=>{clock+=26000;}});
 assert.equal((await h.rt.renewScheduledJob({},claim)).renewed,false);assert.equal(h.calls.length,1);
});
test('definitive ownership denial, malformed payload and permanent errors are never retried',async()=>{
 for(const result of [{renewed:false,reason:'lease_lost'},null]){
  const h=harness(async()=>result);assert.equal((await h.rt.renewScheduledJob({},claim)).renewed,false);assert.equal(h.calls.length,1);
 }
 for(const code of ['42501','HTTP_401','HTTP_429']){
  const h=harness(async()=>{throw Object.assign(new Error('permanent'),{code});});await h.rt.renewScheduledJob({},claim);assert.equal(h.calls.length,1);
 }
});
test('two transient failures stop renewal and emit one final failure event',async()=>{
 const h=harness(async()=>{throw timeout();});const result=await h.rt.renewScheduledJob({},claim);
 assert.equal(result.renewed,false);assert.equal(result.degraded,true);assert.equal(h.calls.length,2);
 assert.equal(h.events.length,1);assert.equal(h.events[0].code,'SCHEDULED_LEASE_RENEW_FAILED');assert.equal(h.events[0].meta.attempts,2);
});
test('claim and settlement with unknown outcomes are not replayed',async()=>{
 const h=harness(async()=>{throw timeout();});
 assert.equal((await h.rt.claimScheduledJob({},{jobKey:'cron:sample',scheduledAt:new Date(at)})).claimed,false);
 assert.equal(h.calls.length,1);assert.equal(await h.rt.completeScheduledJob({},claim),false);assert.equal(h.calls.length,2);
});

test('retry that confirms ownership was lost stops rather than treating the first timeout as success',async()=>{
 let calls=0;const h=harness(async()=>{if(++calls===1)throw timeout();return{renewed:false,reason:'lease_lost'};});
 const result=await h.rt.renewScheduledJob({},claim);assert.equal(result.renewed,false);assert.equal(result.reason,'lease_lost');
 assert.equal(h.calls.length,2);assert.equal(h.events.length,0);
});
