import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAnalysisRuntime } from '../src/analysis-runtime.js';

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

test('analysis runtime rejects cache payloads for another fixture', async () => {
  let opsEvents = 0;
  const runtime = createAnalysisRuntime({
    ...baseDeps(),
    getCache: async () => ({
      generatedAt:new Date().toISOString(),
      match:{ fixtureId:999, date:new Date().toISOString(), status:'NS' },
    }),
    getStaleCache: async () => null,
    recordOpsEvent: async () => { opsEvents += 1; },
    resolveUserEntitlements: async () => ({ source:'free', access:{} }),
    getQuota: async () => ({ plan:'FREE', used:3, limit:3, left:0 }),
  });

  const response = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:123 }) },
    {},
    { id:456 },
  );

  assert.equal(response.status, 429);
  assert.equal(opsEvents, 1);
});

test('analysis wiring owns Tavily adapter and retryable provider fallback', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const runtime = fs.readFileSync('src/analysis-runtime.js', 'utf8');

  assert.doesNotMatch(worker, /\btavilySearch\b/);
  assert.match(runtime, /fetchWithTimeout/);
  assert.match(runtime, /Authorization|authorization/);
  assert.match(runtime, /Bearer/);
  assert.match(runtime, /isRetryableFootballTransportError/);
  assert.match(runtime, /quotaSnapshotForResponse/);
});
