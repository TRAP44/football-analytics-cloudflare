import test from 'node:test';import assert from 'node:assert/strict';
import {runLiveWindow,runCron} from '../scripts/cron-runner.js';
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
