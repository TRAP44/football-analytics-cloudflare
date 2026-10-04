import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAnalysisUsageCommitRuntime } from '../src/analysis-usage-commit.js';

function runtime(overrides = {}) {
  const events = [];
  const counters = [];
  const value = createAnalysisUsageCommitRuntime({
    commitQuota: overrides.commitQuota || (async () => ({ allowed: true, used: 2, limit: 3, reason: 'reserved' })),
    readQuotaUsage: overrides.readQuotaUsage || (async () => 1),
    commitPass: overrides.commitPass || (async () => ({ allowed: true, usageCount: 2, usageLimit: 3, reason: 'consumed' })),
    readPassUsage: overrides.readPassUsage || (async () => 1),
    recordOpsEvent: async (_cfg, event) => events.push(event),
    bumpTelemetry: key => counters.push(key),
  });
  return { ...value, events, counters };
}

test('quota is committed only after successful work and confirmed commits update telemetry', async () => {
  const { commitAnalysisQuotaAfterSuccess, counters } = runtime();
  const result = await commitAnalysisQuotaAfterSuccess({
    userId: 42,
    baseline: { date: '2026-10-05', plan: 'FREE', used: 1, limit: 3 },
    cfg: {},
    context: { fixtureId: 777 },
  });
  assert.equal(result.charged, true);
  assert.equal(result.uncertain, false);
  assert.deepEqual(result.quota, { plan: 'FREE', used: 2, limit: 3, left: 1 });
  assert.ok(counters.includes('quotaReservations'));
  assert.ok(counters.includes('quotaCommits'));
});

test('ambiguous quota commit is reconciled from persisted usage without failing the completed analysis', async () => {
  const { commitAnalysisQuotaAfterSuccess, events } = runtime({
    commitQuota: async () => { throw Object.assign(new Error('timeout'), { code: 'UPSTREAM_TIMEOUT' }); },
    readQuotaUsage: async () => 2,
  });
  const result = await commitAnalysisQuotaAfterSuccess({
    userId: 42,
    baseline: { date: '2026-10-05', plan: 'FREE', used: 1, limit: 3 },
    cfg: {},
    context: { fixtureId: 777 },
  });
  assert.equal(result.charged, true);
  assert.equal(result.reconciled, true);
  assert.equal(result.uncertain, false);
  assert.equal(events[0].code, 'ANALYSIS_QUOTA_COMMIT_RECONCILED');
});

test('unconfirmed quota commit never converts a completed analysis into a failed response', async () => {
  const { commitAnalysisQuotaAfterSuccess, events, counters } = runtime({
    commitQuota: async () => { throw new Error('database unavailable'); },
    readQuotaUsage: async () => 1,
  });
  const result = await commitAnalysisQuotaAfterSuccess({
    userId: 42,
    baseline: { date: '2026-10-05', plan: 'FREE', used: 1, limit: 3 },
    cfg: {},
    context: { fixtureId: 777 },
  });
  assert.equal(result.charged, false);
  assert.equal(result.uncertain, true);
  assert.deepEqual(result.quota, { plan: 'FREE', used: 1, limit: 3, left: 2 });
  assert.equal(events[0].code, 'ANALYSIS_QUOTA_COMMIT_UNCERTAIN');
  assert.ok(counters.includes('quotaCommitUncertain'));
});

test('limited Pass ambiguous commit reconciles from entitlement usage and never requires compensation', async () => {
  const { commitPassUsageAfterSuccess, events } = runtime({
    commitPass: async () => { throw new Error('timeout'); },
    readPassUsage: async () => 2,
  });
  const result = await commitPassUsageAfterSuccess({
    userId: 42,
    candidate: { id: 9, usageCount: 1, usageLimit: 3 },
    fixtureId: 777,
    cfg: {},
    context: { fixtureId: 777 },
  });
  assert.equal(result.charged, true);
  assert.equal(result.reconciled, true);
  assert.equal(events[0].code, 'PASS_USAGE_COMMIT_RECONCILED');
});

test('unlimited Pass requires no usage mutation', async () => {
  let commits = 0;
  const { commitPassUsageAfterSuccess } = runtime({
    commitPass: async () => { commits += 1; return { allowed: true }; },
  });
  const result = await commitPassUsageAfterSuccess({
    userId: 42,
    candidate: { id: 9, usageCount: 0, usageLimit: null },
    fixtureId: 777,
    cfg: {},
  });
  assert.equal(result.unlimited, true);
  assert.equal(commits, 0);
});

test('Issue #467 full AI path persists result before quota/Pass usage commit and has no compensating refund path', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const start = worker.indexOf('async function apiAnalyze(');
  const end = worker.indexOf('async function publicServiceStatus', start);
  assert.ok(start >= 0 && end > start);
  const source = worker.slice(start, end);

  assert.match(source, /claimAnalysisAccessLease\(user\.id,cfg\)/);
  assert.match(source, /releaseAnalysisAccessLease\(accessLease,cfg\)/);
  assert.match(source, /commitAnalysisQuotaAfterSuccess\(/);
  assert.match(source, /commitPassUsageAfterSuccess\(/);
  assert.doesNotMatch(source, /reserveAnalysisQuota\(/);
  assert.doesNotMatch(source, /refundAnalysisQuota\(/);
  assert.doesNotMatch(source, /reserveEntitlementUsage\(/);
  assert.doesNotMatch(source, /refundEntitlementUsage\(/);

  const cacheWrite = source.lastIndexOf('await setCache(cacheKey, fixtureId, payload, cfg, ttl)');
  const quotaCommit = source.lastIndexOf('await commitAnalysisQuotaAfterSuccess');
  const passCommit = source.lastIndexOf('await commitPassUsageAfterSuccess');
  assert.ok(cacheWrite >= 0);
  assert.ok(quotaCommit > cacheWrite);
  assert.ok(passCommit > cacheWrite);
  assert.match(source, /quota:quotaAfterCommit/);
  assert.match(source, /recordTrackedFullAiOutcome\('fresh'\)\.catch\(\(\)=>null\)/);
});
