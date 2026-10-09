import assert from 'node:assert/strict';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApiFootballGateway } from '../src/api-football-gateway.js';
import { createCommonInfrastructureRuntime } from '../src/common-infrastructure-runtime.js';

// Real gateway and singleflight; only transport and persistent guard are simulated.
// This is a bounded, closed-loop soak, not an HTTP or Cloudflare capacity test.
const seconds=Number(process.env.ISOLATED_SOAK_SECONDS || 60);
assert.ok(Number.isInteger(seconds) && seconds>=10 && seconds<=600,'Soak duration must be 10..600 seconds');
assert.equal(typeof global.gc,'function','Run with node --expose-gc to measure retained heap');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const memory={inflight:new Map(),provider:{plan:'PRO',minuteRemaining:10000,dailyRemaining:100000}};
const {withSingleFlight,pruneMemoryState}=createCommonInfrastructureRuntime({memory,bumpTelemetry:()=>{}});
let mode='healthy',attempts=0,active=0,peakActive=0,peakInflight=0,waveId=0;
const cfg={apiFootballKey:'isolated-dummy-key'};
const gateway=createApiFootballGateway({
  memory,providerPlanLimits:{PRO:{minute:10000},FREE:{minute:10}},providerBudgetFloors:{PRO:{minuteReserve:1},FREE:{minuteReserve:2}},
  hasSupabase:()=>true,
  supaRpc:async()=>{
    if(mode==='database_down') throw new Error('simulated guard outage');
    return {allowed:true};
  },
  bumpTelemetry:()=>{},observeProviderRequest:()=>{},recordOpsEvent:async()=>{},
  loadSharedProviderState:async()=>{},phase5ProviderUsage:()=>{},
  persistSharedProviderCooldown:async(_cfg,seconds)=>{memory.provider.cooldownUntil=new Date(Date.now()+seconds*1000).toISOString();},
  fetchWithTimeout:async()=>{
    attempts++;active++;peakActive=Math.max(peakActive,active);
    peakInflight=Math.max(peakInflight,memory.inflight.size);
    try {
      await sleep(5);
      if(mode==='timeout') throw Object.assign(new Error('simulated timeout'),{code:'UPSTREAM_TIMEOUT'});
      if(mode==='rate_limit') return new Response('{}',{status:429,headers:{'retry-after':'1'}});
      return new Response('{"response":[{"fixture":{"id":1}}]}',{status:200});
    } finally {active--;}
  },
  updateProviderFromHeaders:()=>{},persistSharedProviderQuota:async()=>{},providerQuotaEvidence:()=>{},
  providerSnapshot:()=>({cooldownActive:false}),withSingleFlight,sleepMs:()=>sleep(1),
});
const counts={waves:0,requests:0,fulfilled:0,expectedRejected:0,burstWaves:0,timeoutWaves:0,guardOutageWaves:0,recoveryWaves:0};
async function wave(nextMode,clients=50,groups=10) {
  mode=nextMode;
  const id=++waveId,before=attempts;
  const outcomes=await Promise.allSettled(Array.from({length:clients},(_,index)=>
    gateway.apiFootball('/fixtures',{id:id*100+index%groups},cfg)));
  const failed=outcomes.filter(result=>result.status==='rejected');
  const expectedCode={timeout:'UPSTREAM_TIMEOUT',database_down:'FOOTBALL_GUARD_DEGRADED',rate_limit:'FOOTBALL_RATE_LIMIT',cooldown:'FOOTBALL_COOLDOWN'}[nextMode];
  if(expectedCode) {
    assert.equal(failed.length,clients,`All ${nextMode} requests must reject safely`);
    assert.ok(failed.every(result=>result.reason?.code===expectedCode),`Unexpected ${nextMode} failure`);
  } else {
    assert.equal(failed.length,0,'Healthy/recovery wave must succeed');
    assert.ok(outcomes.every(result=>result.value[0].fixture.id===1));
  }
  const multiplier=nextMode==='timeout'?2:['database_down','cooldown'].includes(nextMode)?0:1;
  assert.equal(attempts-before,groups*multiplier,'Shared transport/retry count must remain bounded');
  assert.equal(memory.inflight.size,0,'Singleflight must drain after every success or failure wave');
  assert.equal(active,0,'Transport must drain after every wave');
  counts.waves++;counts.requests+=clients;counts.fulfilled+=clients-failed.length;counts.expectedRejected+=failed.length;
  if(clients===1000) counts.burstWaves++;
  if(nextMode==='timeout') counts.timeoutWaves++;
  if(nextMode==='database_down') counts.guardOutageWaves++;
  if(nextMode==='recovery') counts.recoveryWaves++;
}
for(let index=0;index<20;index++) await wave('healthy');
global.gc();
const baseline=process.memoryUsage();
const samples=[];
const delay=monitorEventLoopDelay({resolution:20});delay.enable();
const started=performance.now();
let sampledAt=0;
while(performance.now()-started<seconds*1000) {
  const cycle=counts.waves%40;
  if(cycle===0) await wave('healthy',1000,20);
  else if(cycle===10) {await wave('timeout');await wave('recovery');}
  else if(cycle===20) {await wave('database_down');await wave('recovery');}
  else await wave('healthy');
  if(performance.now()-sampledAt>=5000) {
    global.gc();
    const usage=process.memoryUsage();
    samples.push({elapsedMs:Math.round(performance.now()-started),heapUsed:usage.heapUsed,rss:usage.rss,inflight:memory.inflight.size});
    sampledAt=performance.now();
  }
  await sleep(10);
}
await wave('rate_limit');
await wave('cooldown');
await sleep(1100);
await wave('recovery');
// Exercise production pruning with expired entries and live sentinel entries.
const now=Date.now();
const shapes={cache:()=>({expiresAt:now-1}),userSyncAt:()=>now-7200000,
  routeBurst:()=>({startedAt:now-600000}),telegramBurst:()=>({startedAt:now-600000}),
  telegramUpdateDedupe:()=>({at:now-1200000}),clientTelemetryDedupe:()=>now-3600000};
for(const [name,value] of Object.entries(shapes)) {
  memory[name]=new Map(Array.from({length:10000},(_,index)=>['expired-'+index,value()]));
  const live=name==='cache'?{expiresAt:now+60000}:name==='telegramUpdateDedupe'?{at:now}:
    ['routeBurst','telegramBurst'].includes(name)?{startedAt:now}:now;
  memory[name].set('live-sentinel',live);
}
const cleanupPruned=pruneMemoryState();
for(const name of Object.keys(shapes)) {
  assert.ok(memory[name].has('live-sentinel'),`Pruning must retain fresh ${name} entries`);
  assert.ok(memory[name].size<=(name==='cache'?500:1),`Expired ${name} entries must not accumulate`);
}
global.gc();
const retained=process.memoryUsage();
assert.ok(retained.heapUsed-baseline.heapUsed<16*1024*1024,'Retained heap growth exceeded 16 MiB after warmup');
assert.ok(retained.rss-baseline.rss<96*1024*1024,'RSS growth exceeded 96 MiB after warmup');
assert.ok(counts.burstWaves>0 && counts.timeoutWaves>0 && counts.guardOutageWaves>0 && counts.recoveryWaves>0);
assert.ok(peakActive<=20 && peakInflight<=20,'Burst must coalesce to at most 20 distinct active requests');
delay.disable();
const result={scope:'Closed-loop single-process gateway soak; simulated 5ms transport and persistent guard. Not HTTP, real provider cost, distributed DB throughput or production capacity.',
  durationMs:Math.round(performance.now()-started),counts,attempts,peakActive,peakInflight,
  inflightAtEnd:memory.inflight.size,cleanupPruned,baseline,retained,
  retainedHeapGrowthBytes:retained.heapUsed-baseline.heapUsed,rssGrowthBytes:retained.rss-baseline.rss,
  eventLoopP99Ms:+(delay.percentile(99)/1e6).toFixed(2),samples};
mkdirSync('load-results',{recursive:true});
writeFileSync('load-results/isolated-soak.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:true,...counts,durationMs:result.durationMs,peakInflight,retainedHeapGrowthBytes:result.retainedHeapGrowthBytes,eventLoopP99Ms:result.eventLoopP99Ms}));
