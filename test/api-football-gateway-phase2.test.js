import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiFootballGateway } from '../src/api-football-gateway.js';

function runtime(overrides = {}) {
  const memory={provider:{plan:'FREE',minuteLimit:10,minuteRemaining:10,dailyRemaining:90},...overrides.memory};
  const counters={};
  const sleeps=[];
  const gateway=createApiFootballGateway({
    memory,
    providerPlanLimits:{FREE:{minute:10},PRO:{minute:300},UNKNOWN:{minute:10}},
    providerBudgetFloors:{FREE:{minuteReserve:2},PRO:{minuteReserve:20},UNKNOWN:{minuteReserve:2}},
    hasSupabase: overrides.hasSupabase || (()=>false),
    supaRpc: overrides.supaRpc || (async()=>({allowed:true})),
    bumpTelemetry:key=>{counters[key]=(counters[key]||0)+1;},
    recordOpsEvent:async()=>{},
    loadSharedProviderState:async()=>{},
    phase5ProviderUsage:()=>{},
    persistSharedProviderCooldown:async()=>{},
    fetchWithTimeout:overrides.fetchWithTimeout || (async()=>new Response(JSON.stringify({response:[]}),{status:200})),
    updateProviderFromHeaders:()=>{},
    persistSharedProviderQuota:async()=>{},
    providerQuotaEvidence:()=>{},
    providerSnapshot:()=>({cooldownActive:false}),
    withSingleFlight:async(_key,fn)=>fn(),
    sleepMs:async ms=>{sleeps.push(ms);},
  });
  return {gateway,memory,counters,sleeps};
}

test('Phase 2 gateway preserves FREE distributed safety budget',()=>{
  const {gateway}=runtime();
  assert.equal(gateway.distributedProviderMinuteLimit(),4);
});

test('Phase 2 gateway bounds emergency traffic when distributed Supabase guard is unavailable',async()=>{
  const {gateway,counters}=runtime({hasSupabase:()=>true,supaRpc:async()=>{throw new Error('db unavailable');}});
  const first=await gateway.claimDistributedProviderBudget({});
  const second=await gateway.claimDistributedProviderBudget({});
  const blocked=await gateway.claimDistributedProviderBudget({});
  assert.equal(gateway.emergencyProviderMinuteLimit(),2);
  assert.equal(first.allowed,true);
  assert.equal(second.allowed,true);
  assert.equal(first.degraded,true);
  assert.equal(first.local,true);
  assert.equal(blocked.allowed,false);
  assert.equal(blocked.degraded,true);
  assert.equal(blocked.reason,'guard_unavailable');
  assert.ok(blocked.retryAfter>=1);
  assert.equal(counters.providerDistributedFallbacks,3);
  assert.equal(counters.providerDistributedBlocks,1);
});

test('Phase 2 gateway also bounds traffic when Supabase is not configured',async()=>{
  const {gateway}=runtime({hasSupabase:()=>false});
  assert.equal((await gateway.claimDistributedProviderBudget({})).allowed,true);
  assert.equal((await gateway.claimDistributedProviderBudget({})).allowed,true);
  const blocked=await gateway.claimDistributedProviderBudget({});
  assert.equal(blocked.allowed,false);
  assert.equal(blocked.reason,'supabase_not_configured');
});

test('Phase 2 gateway surfaces emergency-budget exhaustion without hitting API-Football',async()=>{
  let networkCalls=0;
  const {gateway}=runtime({
    hasSupabase:()=>true,
    supaRpc:async()=>{throw new Error('db unavailable');},
    fetchWithTimeout:async()=>{
      networkCalls+=1;
      return new Response(JSON.stringify({response:[]}),{status:200});
    },
  });
  await gateway.apiFootball('/fixtures',{id:1},{apiFootballKey:'test-key'},{transportRetries:0});
  await gateway.apiFootball('/fixtures',{id:2},{apiFootballKey:'test-key'},{transportRetries:0});
  await assert.rejects(
    ()=>gateway.apiFootball('/fixtures',{id:3},{apiFootballKey:'test-key'},{transportRetries:0}),
    error=>error?.code==='FOOTBALL_GUARD_DEGRADED' && Number(error?.retryAfter)>0,
  );
  assert.equal(networkCalls,2);
});

test('Phase 2 gateway keeps request keys deterministic',()=>{
  const {gateway}=runtime();
  assert.equal(gateway.providerRequestKey('/fixtures',{team:7,season:2026,empty:''},{responseType:'envelope'}),'football:/fixtures?season=2026&team=7:type=envelope');
});

test('Phase 2 gateway retries only network transport failures once',async()=>{
  let attempts=0;
  const {gateway,sleeps}=runtime({fetchWithTimeout:async()=>{
    attempts+=1;
    if(attempts===1) throw new Error('network');
    return new Response(JSON.stringify({response:[{id:1}]}),{status:200});
  }});
  const result=await gateway.apiFootball('/fixtures',{id:1},{apiFootballKey:'test-key'});
  assert.deepEqual(result,[{id:1}]);
  assert.equal(attempts,2);
  assert.deepEqual(sleeps,[180]);
});

test('Phase 2 gateway does not retry provider HTTP failures',async()=>{
  let attempts=0;
  const {gateway}=runtime({fetchWithTimeout:async()=>{
    attempts+=1;
    return new Response(JSON.stringify({response:[]}),{status:500});
  }});
  await assert.rejects(()=>gateway.apiFootball('/fixtures',{id:1},{apiFootballKey:'test-key'}),error=>error?.code==='FOOTBALL_HTTP');
  assert.equal(attempts,1);
});


test('Phase 2 gateway preserves timeout classification after bounded retry', async () => {
  let attempts = 0;
  const timeout = Object.assign(new Error('API-Football timeout'), { code: 'UPSTREAM_TIMEOUT' });
  const { gateway, sleeps } = runtime({
    fetchWithTimeout: async () => {
      attempts += 1;
      throw timeout;
    },
  });

  await assert.rejects(
    () => gateway.apiFootball('/fixtures', { id: 1 }, { apiFootballKey: 'test-key' }),
    error => error?.code === 'UPSTREAM_TIMEOUT',
  );
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [180]);
});


test('Phase 2 gateway retries HTTP 503 once and succeeds', async () => {
  let attempts = 0;
  const { gateway, sleeps, counters } = runtime({
    fetchWithTimeout: async () => {
      attempts += 1;
      if (attempts === 1) return new Response(JSON.stringify({ response:[] }), { status:503 });
      return new Response(JSON.stringify({ response:[{ id:7 }] }), { status:200 });
    },
  });

  const result = await gateway.apiFootball('/fixtures', { id:7 }, { apiFootballKey:'test-key' });
  assert.deepEqual(result, [{ id:7 }]);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [180]);
  assert.equal(counters.providerRetries, 1);
});

test('Phase 2 gateway does not retry 400, 401, or 403', async () => {
  for (const status of [400, 401, 403]) {
    let attempts = 0;
    const { gateway } = runtime({
      fetchWithTimeout: async () => {
        attempts += 1;
        return new Response(JSON.stringify({ response:[] }), { status });
      },
    });
    await assert.rejects(
      () => gateway.apiFootball('/fixtures', { id:status }, { apiFootballKey:'test-key' }),
      error => error?.code === 'FOOTBALL_HTTP' && error?.status === status,
    );
    assert.equal(attempts, 1, String(status));
  }
});

test('Phase 2 gateway keeps 429 separate, respects Retry-After and does not auto-retry it', async () => {
  let attempts = 0;
  const { gateway, counters } = runtime({
    fetchWithTimeout: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ response:[] }), {
        status:429,
        headers:{ 'Retry-After':'19' },
      });
    },
  });

  await assert.rejects(
    () => gateway.apiFootball('/fixtures', { id:1 }, { apiFootballKey:'test-key' }),
    error => error?.code === 'FOOTBALL_RATE_LIMIT' && error?.retryAfter === 19 && error?.status === 429,
  );
  assert.equal(attempts, 1);
  assert.equal(counters.providerRateLimits, 1);
});

test('Phase 2 gateway rejects invalid JSON instead of treating it as empty data', async () => {
  const { gateway } = runtime({
    fetchWithTimeout: async () => new Response('{broken-json', { status:200 }),
  });
  await assert.rejects(
    () => gateway.apiFootball('/fixtures', { id:1 }, { apiFootballKey:'test-key' }),
    error => error?.code === 'FOOTBALL_INVALID_RESPONSE',
  );
});

test('Phase 2 gateway rejects a successful response without the response field', async () => {
  const { gateway } = runtime({
    fetchWithTimeout: async () => new Response(JSON.stringify({ paging:{ current:1, total:1 } }), { status:200 }),
  });
  await assert.rejects(
    () => gateway.apiFootball('/fixtures', { id:1 }, { apiFootballKey:'test-key' }),
    error => error?.code === 'FOOTBALL_INVALID_RESPONSE',
  );
});

test('Phase 2 gateway rejects a non-array fixture response shape', async () => {
  const { gateway } = runtime({
    fetchWithTimeout: async () => new Response(JSON.stringify({ response:{ id:1 } }), { status:200 }),
  });
  await assert.rejects(
    () => gateway.apiFootball('/fixtures', { id:1 }, { apiFootballKey:'test-key' }),
    error => error?.code === 'FOOTBALL_INVALID_RESPONSE',
  );
});
