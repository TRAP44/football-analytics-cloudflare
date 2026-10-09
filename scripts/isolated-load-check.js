import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runSensitiveMutationWithReplay } from '../src/sensitive-mutation-replay.js';
import { createApiFootballGateway } from '../src/api-football-gateway.js';
import { workerRuntime } from '../test-support/worker-root.js';

// Only the transport and persistence boundaries are simulated. No external
// credentials, payments, Telegram sends or production URLs are used.
const flights=workerRuntime.getCommonInfrastructureRuntime().withSingleFlight;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rows=[];
function harness(mode) {
  let attempts=0, claims=0, active=0, maxActive=0, cooldown=0;
  const observations=[];
  const gateway=createApiFootballGateway({
    memory:{provider:{plan:'FREE',minuteLimit:10,minuteRemaining:10,dailyRemaining:90}},
    providerPlanLimits:{FREE:{minute:10},UNKNOWN:{minute:10}},
    providerBudgetFloors:{FREE:{minuteReserve:2},UNKNOWN:{minuteReserve:2}},
    hasSupabase:()=>true,
    supaRpc:async(_cfg,_name,args)=>{
      if (mode==='database_down') throw new Error('simulated database outage');
      claims++;
      return {allowed:claims<=args.p_limit,retryAfter:60};
    },
    bumpTelemetry:()=>{}, observeProviderRequest:event=>observations.push(event),
    recordOpsEvent:async()=>{},loadSharedProviderState:async()=>{},
    phase5ProviderUsage:()=>{}, persistSharedProviderCooldown:async(_cfg,seconds)=>{cooldown=seconds;},
    fetchWithTimeout:async()=>{
      attempts++;active++;maxActive=Math.max(maxActive,active);
      try {
        await sleep(10);
        if (mode==='timeout') throw Object.assign(new Error('simulated timeout'),{code:'UPSTREAM_TIMEOUT'});
        if (mode==='rate_limit') return new Response('{}',{status:429,headers:{'retry-after':'30'}});
        if (mode==='recover' && attempts===1) return new Response('{}',{status:503});
        return new Response(JSON.stringify({response:[{fixture:{id:1}}]}),{status:200});
      } finally {active--;}
    },
    updateProviderFromHeaders:()=>{},persistSharedProviderQuota:async()=>{},
    providerQuotaEvidence:()=>{},providerSnapshot:()=>({cooldownActive:false}),
    withSingleFlight:flights,sleepMs:async()=>{},
  });
  return {gateway,stats:()=>({attempts,claims,maxActive,cooldown,observations:observations.length})};
}
for (const concurrency of [10,50,100]) {
  for (const scenario of ['shared_request','unique_requests','database_down','timeout','rate_limit','recover']) {
    const h=harness(scenario);
    const latencies=[];
    const started=performance.now();
    const results=await Promise.allSettled(Array.from({length:concurrency},async(_,index)=>{
      const at=performance.now();
      try {
        return await h.gateway.apiFootball('/fixtures',{id:scenario==='unique_requests'?index+1:1},{apiFootballKey:'isolated-dummy-key'});
      } finally {latencies.push(performance.now()-at);}
    }));
    const durationMs=performance.now()-started;
    const fulfilled=results.filter(r=>r.status==='fulfilled').length;
    const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason?.code || 'unknown');
    const stats=h.stats();
    if (scenario==='unique_requests') {
      assert.equal(fulfilled,4,'FREE atomic budget must admit exactly four distinct requests');
      assert.equal(stats.attempts,4);
    } else if (scenario==='database_down') {
      assert.equal(fulfilled,0);assert.equal(stats.attempts,0,'guard outage must stop all provider traffic');
      assert.ok(errors.every(code=>code==='FOOTBALL_GUARD_DEGRADED'));
    } else if (scenario==='timeout') {
      assert.equal(fulfilled,0);assert.equal(stats.attempts,2,'retry must stay bounded and shared');
      assert.ok(errors.every(code=>code==='UPSTREAM_TIMEOUT'));
    } else if (scenario==='rate_limit') {
      assert.equal(fulfilled,0);assert.equal(stats.attempts,1);assert.equal(stats.cooldown,30);
      assert.ok(errors.every(code=>code==='FOOTBALL_RATE_LIMIT'));
    } else {
      assert.equal(fulfilled,concurrency);assert.equal(stats.attempts,scenario==='recover'?2:1);
      assert.ok(results.every(r=>r.value[0].fixture.id===1));
    }
    latencies.sort((a,b)=>a-b);
    rows.push({scenario,concurrency,fulfilled,rejected:errors.length,...stats,
      durationMs:+durationMs.toFixed(2),p50Ms:+latencies[Math.ceil(concurrency*.5)-1].toFixed(2),
      p95Ms:+latencies[Math.ceil(concurrency*.95)-1].toFixed(2),errors:[...new Set(errors)]});
  }
}
for (const concurrency of [10,50,100]) {
  let state=null,sideEffects=0;
  const coordinator={
    async claim() {
      if (state) return {claimed:false,state,reason:'duplicate_'+state};
      state='inflight';return {claimed:true,state,reason:'claimed',leaseToken:'isolated-lease-token-0001'};
    },
    async complete() {state='completed';return {ok:true,updated:true,state};},
    async fail() {state='failed';return {ok:true,updated:true,state};},
  };
  const run=()=>{
    const request=new Request('https://isolated.invalid/api/runtime-controls',{method:'POST',headers:{'content-type':'application/json'},body:'{"maintenanceMode":false}'});
    return runSensitiveMutationWithReplay({request,url:new URL(request.url),user:{id:7},memory:{},coordinator,
      handler:async()=>{sideEffects++;await sleep(10);return {status:200};}});
  };
  const started=performance.now();
  const results=await Promise.all(Array.from({length:concurrency},run));
  assert.equal(sideEffects,1,'simulated persistent coordinator must permit one side effect across separate local memories');
  assert.equal(results.filter(r=>r.blocked===false).length,1);
  assert.equal(results.filter(r=>r.reason==='duplicate_inflight').length,concurrency-1);
  assert.equal((await run()).reason,'duplicate_completed');
  assert.equal(sideEffects,1);
  rows.push({scenario:'mutation_replay',concurrency,fulfilled:1,rejected:concurrency-1,attempts:0,sideEffects,
    durationMs:+(performance.now()-started).toFixed(2),p50Ms:null,p95Ms:null,errors:[]});
}
mkdirSync('load-results',{recursive:true});
writeFileSync('load-results/isolated-load.json',JSON.stringify({scope:'in-process runtime concurrency with simulated 10ms transport; not HTTP, Cloudflare capacity or multi-isolate database throughput',rows},null,2));
writeFileSync('load-results/isolated-load.md','# Isolated load and resilience\n\nSimulated 10 ms transport; these numbers are not production capacity estimates.\n\n| Scenario | Parallel | Success | Rejected | Transport attempts | p95 ms |\n|---|---:|---:|---:|---:|---:|\n'+rows.map(r=>`| ${r.scenario} | ${r.concurrency} | ${r.fulfilled} | ${r.rejected} | ${r.attempts} | ${r.p95Ms} |`).join('\n')+'\n');
console.log(`Isolated load: ${rows.length} scenarios passed. Results: load-results/isolated-load.md`);
