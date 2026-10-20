import test from 'node:test';import assert from 'node:assert/strict';
import {runLiveWindow,runCron} from '../scripts/cron-runner.js';
import {createScheduledJobsRuntime} from '../src/scheduled-jobs.js';
import {fastLiveNotificationConfig} from '../src/fast-live-notification-budget.js';

test('hot runner checks LIVE on minute boundaries without another workflow/full execution',async()=>{
 let at=Date.parse('2026-10-18T12:01:20Z');const calls=[];
 const results=await runLiveWindow({now:()=>at,wait:async ms=>{at+=ms;},endMs:Date.parse('2026-10-18T12:05:00Z'),runTick:async ms=>{calls.push(ms);at+=15000;return {failed:false};}});
 assert.deepEqual(calls.map(ms=>new Date(ms).toISOString()),['2026-10-18T12:02:00.000Z','2026-10-18T12:03:00.000Z','2026-10-18T12:04:00.000Z']);assert.equal(results.length,3);
 const controllers=[];
 await runCron({worker:{scheduled:async controller=>{controllers.push(controller);return [{task:'live_notifications',ok:true}];}},env:{},nowMs:calls[0],liveOnly:true});
 assert.equal(controllers[0].liveNotificationsOnly,true);assert.equal(controllers[0].scheduledTime,calls[0]);
});
test('fast window stops at slot end, when disabled or after a failed tick',async()=>{
 const start=Date.parse('2026-10-18T12:04:40Z');let at=start,calls=0;
 assert.deepEqual(await runLiveWindow({now:()=>at,wait:async ms=>at+=ms,endMs:start+20000,runTick:async()=>{calls++;}}),[]);
 await runLiveWindow({enabled:false,endMs:start+300000,runTick:async()=>calls++});assert.equal(calls,0);
 at=Date.parse('2026-10-18T12:00:00Z');
 await runLiveWindow({now:()=>at,wait:async ms=>at+=ms,endMs:at+300000,runTick:async()=>{calls++;return {failed:true};}});assert.equal(calls,1);
});
test('extra LIVE requests atomically share 25% daily allowance and stop at half remaining',async()=>{
 const old=Date.now;const now=Date.parse('2026-10-18T12:10:00Z');Date.now=()=>now;
 try{
  let remaining=7400,claims=0;
  const deps={providerSnapshot:()=>({plan:'PRO',dailyLimit:7500,dailyRemaining:remaining,updatedAt:new Date(now).toISOString()}),loadSharedProviderState:async()=>{},probeProviderStatus:async()=>assert.fail('fresh quota needs no probe'),supaSelectMany:async()=>[],supaRpc:async(_cfg,name,args)=>{assert.equal(name,'claim_provider_request');assert.equal(args.p_limit,1875);assert.match(args.p_bucket_key,/^prematch-provider-requests:h12$/);claims++;return {allowed:true};}};
  const cfg=await fastLiveNotificationConfig({botToken:'test'},deps);assert.equal(claims,0);
  await cfg.prematchProviderClaim();assert.equal(claims,1);
  remaining=3750;await assert.rejects(cfg.prematchProviderClaim(),error=>error.code==='FOOTBALL_BACKGROUND_LIMIT');assert.equal(claims,1);
  assert.equal(await fastLiveNotificationConfig({},deps),null);
  remaining=7400;const denied=await fastLiveNotificationConfig({},{...deps,supaRpc:async()=>({allowed:false})});
  await assert.rejects(denied.prematchProviderClaim(),error=>error.code==='FOOTBALL_BACKGROUND_LIMIT');
  const broken=await fastLiveNotificationConfig({},{...deps,supaSelectMany:async()=>{throw new Error('store unavailable');}});
  await assert.rejects(broken.prematchProviderClaim(),error=>error.code==='FOOTBALL_BACKGROUND_LIMIT');
 }finally{Date.now=old;}
});

test('pre-work unavailable lease preserves the failed result but tries a fresh later minute',async()=>{
 let at=Date.parse('2026-10-18T12:01:20Z');const calls=[];
 const first={failed:true,tasks:[{task:'scheduled_execution',status:'skipped',reason:'lease_unavailable'}]};
 const results=await runLiveWindow({now:()=>at,wait:async ms=>{at+=ms;},endMs:Date.parse('2026-10-18T12:05:00Z'),runTick:async ms=>{
  calls.push(ms);at+=4000;return calls.length===1 ? first : {failed:false,tasks:[{task:'live_notifications',status:'ok'}]};
 }});
 assert.deepEqual(calls.map(ms=>new Date(ms).toISOString()),['2026-10-18T12:02:00.000Z','2026-10-18T12:03:00.000Z','2026-10-18T12:04:00.000Z']);
 assert.equal(results[0],first);assert.equal(results.some(result=>result.failed),true,'workflow must still report the skipped failed slot');
});
test('unknown or post-work failure still stops; repeated pre-work failures stay bounded by slot and tick cap',async()=>{
 for(const result of [
  {failed:true,tasks:[{task:'scheduled_execution',status:'degraded',reason:'lease_unavailable'}]},
  {failed:true,tasks:[{task:'scheduled_execution',status:'skipped',reason:'invalid_lease_claim'}]},
  {failed:true,tasks:[{task:'live_notifications',status:'ok'},{task:'scheduled_execution',status:'skipped',reason:'lease_unavailable'}]},
  {failed:true,tasks:[]},
 ]){
  let at=Date.parse('2026-10-18T12:00:00Z'),calls=0;
  await runLiveWindow({now:()=>at,wait:async ms=>at+=ms,endMs:at+300000,runTick:async()=>{calls++;return result;}});
  assert.equal(calls,1);
 }
 let at=Date.parse('2026-10-18T12:00:00Z'),calls=0;
 const results=await runLiveWindow({now:()=>at,wait:async ms=>at+=ms,endMs:at+3600000,runTick:async()=>{calls++;return {failed:true,tasks:[{task:'scheduled_execution',status:'skipped',reason:'lease_unavailable'}]};}});
 assert.equal(calls,4);assert.equal(results.length,4);
});


test('actual runner and scheduler require fresh ownership before work after a failed pre-work claim',async()=>{
 for(const overlap of [false,true]){
  let at=Date.parse('2026-10-18T12:01:20Z'),work=0;const claims=[];
  const runtime=createScheduledJobsRuntime({
   claimScheduledJob:async(_cfg,input)=>{
    claims.push(input.jobKey);
    if(claims.length===1)throw Error('lost claim response');
    if(overlap)return {claimed:false,persistent:true,reason:'overlap',jobKey:input.jobKey,groupKey:input.groupKey};
    return {claimed:true,persistent:true,jobKey:input.jobKey,groupKey:input.groupKey,leaseToken:'owner-token-123456789',leaseSeconds:720};
   },
   renewScheduledJob:async()=>({renewed:true,lockedUntil:new Date(Date.now()+720000).toISOString()}),
   completeScheduledJob:async()=>true,
   processSmartNotifications:async()=>{work++;return {checked:0,failed:0};},
  });
  const worker={scheduled:controller=>runtime.executeScheduledRun(controller,{cronRunner:'github-actions'})};
  const results=await runLiveWindow({now:()=>at,wait:async ms=>at+=ms,endMs:Date.parse('2026-10-18T12:05:00Z'),runTick:ms=>runCron({worker,env:{},nowMs:ms,liveOnly:true})});
  assert.equal(claims.length,3);assert.equal(new Set(claims).size,3,'no replay of the unknown claim');
  assert.ok(claims.every(key=>key.startsWith('cron-live:')));
  assert.equal(results[0].failed,true);assert.equal(results[0].tasks[0].reason,'lease_unavailable');
  assert.equal(work,overlap ? 0 : 2,'an uncertain earlier owner is never bypassed');
 }
});
