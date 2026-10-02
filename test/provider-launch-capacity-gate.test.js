import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApiFootballGateway } from '../src/api-football-gateway.js';

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

test('paid provider plans are not constrained by the FREE daily reserve', () => {
  const { gateway } = createGateway({plan:'PRO',dailyLimit:7500,dailyRemaining:10,minuteLimit:300,minuteRemaining:100});
  assert.equal(gateway.dailyReserveDecision().blocked,false);
});

test('daily reserve is treated as a provider rate-limit condition for fail-soft callers', () => {
  const { gateway } = createGateway();
  assert.equal(gateway.isFootballRateLimitError({code:'FOOTBALL_DAILY_RESERVE'}),true);
});

test('admin provider budget exposes broad-launch readiness and limited-beta recommendation', () => {
  const worker = fs.readFileSync('src/worker.js','utf8');
  const start = worker.indexOf('function providerBudgetProfile');
  const end = worker.indexOf('function providerPublicBudgetMode', start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const block = worker.slice(start,end);
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
