import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisRuntime } from '../src/analysis-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function json(body, status = 200, headers = {}) {
  return { body, status, headers };
}

function baseDeps() {
  const clean = () => '';
  return {
    cleanNewsImpactDecisionCode: clean,
    cleanNewsImpactActionCode: clean,
    cleanNewsImpactRecoveryCode: clean,
    json,
    recordGrowthEvent: async () => true,
    recordNewsImpactOutcome: async () => true,
    recordNewsImpactRecoveryAttempt: async () => true,
    recordNewsImpactFailure: async () => true,
    selectNewsImpactRecoveryStrategy: async () => ({ code:'retry', strategy:'fixed', guardReason:'test' }),
    newsImpactFailureCode: () => 'server_error',
  };
}

test('analysis runtime rejects fractional/unsafe fixture ids and invalid users', async () => {
  const runtime = createAnalysisRuntime(baseDeps());

  const fractional = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:1.5 }) },
    {},
    { id:123 },
  );
  const unsafe = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:Number.MAX_SAFE_INTEGER + 1 }) },
    {},
    { id:123 },
  );
  const invalidUser = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:123 }) },
    {},
    { id:0 },
  );

  assert.equal(fractional.status, 400);
  assert.equal(unsafe.status, 400);
  assert.equal(invalidUser.status, 401);
});

test('analysis runtime rejects boolean identifier coercion', async () => {
  const runtime=createAnalysisRuntime(baseDeps());

  const fixture=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:true})},
    {},
    {id:123},
  );
  const user=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:123})},
    {},
    {id:true},
  );

  assert.equal(fixture.status,400);
  assert.equal(user.status,401);
});

test('analysis cache outages fail soft before the quota gate', async () => {
  const runtime=createAnalysisRuntime({
    ...baseDeps(),
    getCache:async()=>{ throw new Error('cache down'); },
    getStaleCache:async()=>{ throw new Error('stale cache down'); },
    resolveUserEntitlements:async()=>({source:'free',access:{}}),
    getQuota:async()=>({plan:'FREE',used:3,limit:3,left:0}),
  });

  const response=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:123})},
    {},
    {id:456},
  );

  assert.equal(response.status,429);
  assert.equal(response.body.quota.left,0);
});

test('malformed quota snapshots fail closed instead of bypassing quota', async () => {
  for (const quota of [
    {plan:'FREE',used:'oops',limit:3,left:3},
    {plan:'FREE',used:0,limit:3,left:999},
    {plan:'FREE',used:5,limit:3,left:1},
    {plan:'FREE',used:0,limit:0,left:0},
  ]) {
    const runtime=createAnalysisRuntime({
      ...baseDeps(),
      getCache:async()=>null,
      getStaleCache:async()=>null,
      resolveUserEntitlements:async()=>({source:'free',access:{}}),
      getQuota:async()=>quota,
    });

    const response=await runtime.apiAnalyze(
      {json:async()=>({fixtureId:123})},
      {},
      {id:456},
    );

    assert.equal(response.status,503,JSON.stringify(quota));
    assert.equal(response.body.code,'ANALYSIS_QUOTA_UNAVAILABLE',JSON.stringify(quota));
  }
});

test('quota snapshots may report used above a reduced limit only when left is exactly zero', async () => {
  const runtime=createAnalysisRuntime({
    ...baseDeps(),
    getCache:async()=>null,
    getStaleCache:async()=>null,
    resolveUserEntitlements:async()=>({source:'free',access:{}}),
    getQuota:async()=>({plan:'FREE',used:5,limit:3,left:0}),
  });

  const response=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:123})},
    {},
    {id:456},
  );

  assert.equal(response.status,429);
  assert.equal(response.body.code,'ANALYSIS_QUOTA_EXHAUSTED');
  assert.deepEqual(response.body.quota,{
    plan:'FREE',
    used:5,
    limit:3,
    left:0,
  });
});

test('shared analysis joins reject cross-fixture payloads', async () => {
  let historyWrites=0;
  let rejected=0;
  const runtime=createAnalysisRuntime({
    ...baseDeps(),
    getCache:async()=>null,
    getStaleCache:async()=>null,
    resolveUserEntitlements:async()=>({source:'free',access:{}}),
    getQuota:async()=>({plan:'FREE',used:0,limit:3,left:3}),
    claimDistributedAnalysisLock:async()=>({claimed:false,unavailable:false}),
    waitForSharedAnalysis:async()=>({
      generatedAt:new Date().toISOString(),
      match:{fixtureId:999,status:'NS'},
    }),
    recordHistory:async()=>{ historyWrites+=1; },
    recordOpsEvent:async(_cfg,event)=>{
      if (event?.code==='ANALYSIS_SHARED_CACHE_INVALID') rejected+=1;
    },
  });

  const response=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:123})},
    {},
    {id:456},
  );

  assert.equal(response.status,429);
  assert.equal(response.body.code,'ANALYSIS_WARMING');
  assert.equal(historyWrites,0);
  assert.equal(rejected,1);
});

test('analysis runtime treats string false as false and cached quota metadata is fail-soft', async () => {
  let entitlementsCalled = 0;
  const cached = {
    generatedAt:new Date(Date.now() - 60_000).toISOString(),
    match:{
      fixtureId:123,
      date:new Date(Date.now() + 3600_000).toISOString(),
      status:'NS',
    },
  };
  const runtime = createAnalysisRuntime({
    ...baseDeps(),
    getCache: async () => cached,
    getStaleCache: async () => null,
    analysisFreshness: () => ({ needsRecheck:true, state:'recheck', reasonCode:'lineups_window' }),
    newsImpactDeltaStatus: () => null,
    recordHistory: async () => {},
    getQuota: async () => { throw new Error('quota metadata unavailable'); },
    analysisResponsePayload: (payload, meta) => ({ ...payload, ...meta }),
    resolveUserEntitlements: async () => {
      entitlementsCalled += 1;
      return { source:'free', access:{} };
    },
  });

  const response = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:123, recheck:'false' }) },
    {},
    { id:456 },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.cached, true);
  assert.equal(response.body.quota, null);
  assert.equal(entitlementsCalled, 0);
});

test('analysis runtime rejects cache payloads for another fixture and records the integrity code', async () => {
  const events=[];
  const runtime = createAnalysisRuntime({
    ...baseDeps(),
    getCache: async () => ({
      generatedAt:new Date().toISOString(),
      match:{ fixtureId:999, date:new Date().toISOString(), status:'NS' },
    }),
    getStaleCache: async () => null,
    recordOpsEvent: async (_cfg,event) => { events.push(event); },
    resolveUserEntitlements: async () => ({ source:'free', access:{} }),
    getQuota: async () => ({ plan:'FREE', used:3, limit:3, left:0 }),
  });

  const response = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:123 }) },
    {},
    { id:456 },
  );

  assert.equal(response.status,429);
  assert.equal(response.body.code,'ANALYSIS_QUOTA_EXHAUSTED');
  assert.equal(events.length,1);
  assert.equal(events[0].code,'ANALYSIS_CACHE_INVALID');
  assert.deepEqual(events[0].meta,{fixtureId:123,source:'fresh'});
});

test('client-supplied news impact flags cannot mint a free recheck', async () => {
  let historyEligibilityChecks = 0;
  const stale = {
    generatedAt:new Date(Date.now() - 60_000).toISOString(),
    match:{
      fixtureId:123,
      date:new Date(Date.now() + 3600_000).toISOString(),
      status:'NS',
    },
  };
  const runtime = createAnalysisRuntime({
    ...baseDeps(),
    getCache: async () => null,
    getStaleCache: async () => stale,
    analysisFreshness: () => ({ needsRecheck:false, state:'fresh', reasonCode:'fresh' }),
    userHasAnalyzedFixture: async () => {
      historyEligibilityChecks += 1;
      return true;
    },
    resolveUserEntitlements: async () => ({ source:'free', access:{} }),
    getQuota: async () => ({ plan:'FREE', used:3, limit:3, left:0 }),
  });

  const response = await runtime.apiAnalyze(
    {
      json: async () => ({
        fixtureId:123,
        recheck:true,
        newsImpactRecheck:true,
        newsPublishedAt:new Date().toISOString(),
      }),
    },
    {},
    { id:456 },
  );

  assert.equal(response.status, 429);
  assert.equal(historyEligibilityChecks, 0);
});

test('analysis wiring owns Tavily adapter and keeps boundary helpers local to the runtime', () => {
  const worker = readRepoFile('src/worker.js');
  const runtime = readRepoFile('src/analysis-runtime.js');

  assert.doesNotMatch(worker, /\btavilySearch\b/);
  assert.match(runtime, /fetchWithTimeout/);
  assert.match(runtime, /Authorization|authorization/);
  assert.match(runtime, /Bearer/);
  assert.match(runtime, /isRetryableFootballTransportError/);
  assert.match(runtime, /function quotaSnapshot\(value, fallback = null\)/);
  assert.match(runtime, /const expectedLeft=Math\.max\(0,limit-used\)/);
  assert.match(runtime, /function safeAnalysisProviderFetch\(input\)/);
  assert.match(runtime, /analysisCachePayload\(joinedCandidate,fixtureId\)/);
  assert.match(runtime, /return Object\.freeze\(\{apiAnalyze\}\)/);
});
