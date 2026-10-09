import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApiFootballGateway } from '../src/api-football-gateway.js';
import { createProviderBudgetRuntime } from '../src/provider-budget-runtime.js';

function createGateway(provider = {}) {
  const memory = {
    provider: {
      plan:'FREE',
      dailyLimit:100,
      dailyRemaining:20,
      minuteLimit:10,
      minuteRemaining:7,
      updatedAt:new Date().toISOString(),
      cooldownUntil:null,
      ...provider,
    },
  };
  let networkCalls = 0;
  let distributedClaims = 0;
  const events = [];
  const gateway = createApiFootballGateway({
    memory,
    providerPlanLimits:{
      FREE:{daily:100,minute:10},
      PRO:{daily:7500,minute:300},
      ULTRA:{daily:75000,minute:450},
      MEGA:{daily:150000,minute:900},
    },
    providerBudgetFloors:{
      FREE:{dailyReserve:20,minuteReserve:3},
      PRO:{dailyReserve:400,minuteReserve:18},
      ULTRA:{dailyReserve:2500,minuteReserve:30},
      MEGA:{dailyReserve:4000,minuteReserve:45},
    },
    hasSupabase:()=>true,
    supaRpc:async()=>{ distributedClaims += 1; return {allowed:true,count:1,retryAfter:0}; },
    bumpTelemetry:()=>{},
    observeProviderRequest:()=>{},
    recordOpsEvent:async(_cfg,event)=>{ events.push(event); },
    loadSharedProviderState:async()=>{},
    phase5ProviderUsage:()=>{},
    persistSharedProviderCooldown:async()=>{},
    fetchWithTimeout:async()=>{ networkCalls += 1; throw new Error('network should not be reached'); },
    updateProviderFromHeaders:()=>{},
    persistSharedProviderQuota:async()=>{},
    providerQuotaEvidence:()=>{},
    providerSnapshot:()=>({cooldownActive:false}),
    withSingleFlight:async(_key,fn)=>await fn(),
    sleepMs:async()=>{},
  });
  return { gateway, memory, events, counts:()=>({networkCalls,distributedClaims}) };
}

test('FREE daily reserve blocks provider network before minute-budget consumption', async () => {
  const { gateway, events, counts } = createGateway();
  await assert.rejects(
    () => gateway.apiFootballNetwork('/fixtures',{date:'2026-10-02'},{apiFootballKey:'secret'}),
    error => error?.code === 'FOOTBALL_DAILY_RESERVE' && Number(error?.retryAfter) >= 60,
  );
  assert.equal(counts().networkCalls,0);
  assert.equal(counts().distributedClaims,0);
  assert.equal(events[0]?.code,'PROVIDER_DAILY_RESERVE');
  assert.equal(events[0]?.meta?.disposition,'serve_cache_or_fail_soft');
});

test('FREE daily reserve does not carry stale quota across a UTC day boundary', () => {
  const yesterday = new Date(Date.now() - 26 * 60 * 60_000).toISOString();
  const { gateway } = createGateway({updatedAt:yesterday,dailyRemaining:1});
  assert.equal(gateway.dailyReserveDecision().blocked,false);
});

test('FREE daily reserve ignores stale evidence so a plan upgrade can refresh from headers', () => {
  const stale = new Date(Date.now() - 45 * 60_000).toISOString();
  const { gateway } = createGateway({updatedAt:stale,dailyRemaining:1});
  assert.equal(gateway.dailyReserveDecision().blocked,false);
  const recent = new Date(Date.now() - 5 * 60_000).toISOString();
  const { gateway: fresh } = createGateway({updatedAt:recent,dailyRemaining:1});
  assert.equal(fresh.dailyReserveDecision().blocked,true);
});

test('paid provider plans are not constrained by the FREE daily reserve', () => {
  const { gateway } = createGateway({plan:'PRO',dailyLimit:7500,dailyRemaining:10,minuteLimit:300,minuteRemaining:100});
  assert.equal(gateway.dailyReserveDecision().blocked,false);
});

test('daily reserve is treated as a provider rate-limit condition for fail-soft callers', () => {
  const { gateway } = createGateway();
  assert.equal(gateway.isFootballRateLimitError({code:'FOOTBALL_DAILY_RESERVE'}),true);
});

test('admin provider budget exposes broad-launch readiness and limited-beta recommendation', () => {
  const source = fs.readFileSync('src/provider-budget-runtime.js','utf8');
  const start = source.indexOf('function providerBudgetProfile');
  const end = source.indexOf('function providerPublicBudgetMode', start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const block = source.slice(start,end);
  assert.match(block,/broadTrafficReady/);
  assert.match(block,/recommendedMode:\s*broadTrafficReady \? 'public' : 'limited_beta'/);
  assert.match(block,/provider_free_plan/);
  assert.match(block,/protectedDailyReserve/);
  assert.match(block,/FREE-квота подходит только для ограниченной beta/);
});

test('daily reserve guard executes before distributed minute budget', () => {
  const source = fs.readFileSync('src/api-football-gateway.js','utf8');
  const start = source.indexOf('async function apiFootballNetwork');
  const end = source.indexOf('function providerRequestKey', start);
  const block = source.slice(start,end);
  const daily = block.indexOf('dailyReserveDecision(options)');
  const minute = block.indexOf('claimDistributedProviderBudget(cfg)');
  assert.ok(daily >= 0 && minute > daily);
});



function createLaunchBudget(provider={}){
  const memory={provider:{
    plan:'PRO',dailyLimit:7500,dailyRemaining:7000,minuteLimit:300,
    minuteRemaining:275,updatedAt:new Date().toISOString(),cooldownUntil:null,
    ...provider,
  }};
  return createProviderBudgetRuntime({
    memory,
    clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),
    freeQuotaHealthy:()=>true,
    hasSupabase:()=>false,
    runtimeControlsSnapshot:()=>({}),
  }).providerBudgetProfile();
}

test('FREE daily reserve denies unknown or malformed remaining counts before network',async()=>{
  for(const dailyRemaining of [undefined,'unavailable','NaN',Infinity,{},-1]){
    const {gateway,counts}=createGateway({dailyRemaining});
    await assert.rejects(
      ()=>gateway.apiFootballNetwork('/fixtures',{date:'2026-10-02'},{apiFootballKey:'secret'}),
      err=>err?.code==='FOOTBALL_DAILY_RESERVE',
    );
    assert.equal(counts().distributedClaims,0);
    assert.equal(counts().networkCalls,0);
  }
});

test('launch capacity rejects PRO when observed remaining quota is unknown',()=>{
  for(const incomplete of [
    {dailyRemaining:undefined},
    {minuteRemaining:undefined},
    {dailyRemaining:'invalid'},
    {minuteRemaining:'invalid'},
    {dailyRemaining:8000},
    {minuteRemaining:400},
  ]){
    const profile=createLaunchBudget(incomplete);
    assert.equal(profile.launchCapacity.broadTrafficReady,false,JSON.stringify(incomplete));
    assert.equal(profile.launchCapacity.recommendedMode,'limited_beta');
  }
});

test('launch capacity requires recent provider quota evidence, not only paid-plan limits',()=>{
  const stale=createLaunchBudget({updatedAt:new Date(Date.now()-60*60_000).toISOString()});
  assert.equal(stale.launchCapacity.broadTrafficReady,false);
  const future=createLaunchBudget({updatedAt:new Date(Date.now()+5*60_000).toISOString()});
  assert.equal(future.launchCapacity.broadTrafficReady,false);
  const absent=createLaunchBudget({updatedAt:null});
  assert.equal(absent.launchCapacity.broadTrafficReady,false);
  const fresh=createLaunchBudget();
  assert.equal(fresh.launchCapacity.broadTrafficReady,true);
  assert.equal(fresh.launchCapacity.recommendedMode,'public');
});

test('launch capacity does not promote depleted or FREE quotas to broad public readiness',()=>{
  for(const provider of [
    {plan:'FREE',dailyLimit:100,minuteLimit:10,dailyRemaining:80,minuteRemaining:8},
    {dailyRemaining:400,minuteRemaining:275},
    {dailyRemaining:7000,minuteRemaining:18},
    {cooldownUntil:new Date(Date.now()+60_000).toISOString()},
  ]){
    const profile=createLaunchBudget(provider);
    assert.equal(profile.launchCapacity.broadTrafficReady,false);
    assert.equal(profile.launchCapacity.recommendedMode,'limited_beta');
  }
});



test('public launch remains blocked when PRO capacity has entered conservation mode',()=>{
  for(const quota of [
    {dailyRemaining:600,minuteRemaining:275},
    {dailyRemaining:7000,minuteRemaining:30},
    {dailyRemaining:750,minuteRemaining:275},
  ]){
    const profile=createLaunchBudget(quota);
    assert.equal(profile.mode,'conserve');
    assert.equal(profile.launchCapacity.broadTrafficReady,false);
    assert.equal(profile.launchCapacity.recommendedMode,'limited_beta');
    assert.equal(profile.launchCapacity.blocker,'provider_capacity_guard');
  }
});

test('public launch remains blocked in ULTRA plan conservation mode',()=>{
  const profile=createLaunchBudget({
    plan:'ULTRA',dailyLimit:75000,dailyRemaining:6000,
    minuteLimit:450,minuteRemaining:410,
  });
  assert.equal(profile.mode,'conserve');
  assert.equal(profile.launchCapacity.broadTrafficReady,false);
  assert.equal(profile.launchCapacity.recommendedMode,'limited_beta');
});

test('paid launch gate keeps healthy quota in public mode when outside conserve thresholds',()=>{
  const healthy=createLaunchBudget({dailyRemaining:7300,minuteRemaining:280});
  assert.equal(healthy.mode,'expanded');
  assert.equal(healthy.launchCapacity.broadTrafficReady,true);
  assert.equal(healthy.launchCapacity.recommendedMode,'public');
  const ultra=createLaunchBudget({
    plan:'ULTRA',dailyLimit:75000,dailyRemaining:70000,
    minuteLimit:450,minuteRemaining:440,
  });
  assert.equal(ultra.mode,'expanded');
  assert.equal(ultra.launchCapacity.broadTrafficReady,true);
});

test('production launch approval must require normal budget mode alongside verified quota',()=>{
  const source=fs.readFileSync('src/provider-budget-runtime.js','utf8');
  const begin=source.indexOf('const broadTrafficReady = Boolean(');
  const end=source.indexOf('const launchCapacity = {',begin);
  assert.ok(begin>=0 && end>begin);
  const block=source.slice(begin,end);
  assert.match(block,/completeProviderQuotaSnapshot\(p\)/);
  assert.match(block,/recentQuotaEvidence/);
  assert.match(block,/mode === 'expanded'/);
  assert.doesNotMatch(block,/mode !== 'emergency'/);
});
