import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');

test('RC66 defines bounded distributed analysis lock policy',()=> {
  assert.match(worker,/DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS = 90/);
  assert.match(worker,/DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS = 4/);
  assert.match(worker,/DISTRIBUTED_ANALYSIS_WAIT_MS = 1600/);
  assert.match(worker,/function distributedAnalysisLockKey\(/);
  assert.match(worker,/function distributedAnalysisLockDrill\(/);
});

test('lock claim uses persistent analysis_cache conflict dedupe',()=> {
  assert.match(worker,/async function claimDistributedAnalysisLock\(/);
  assert.match(worker,/rest\/v1\/analysis_cache/);
  assert.match(worker,/on_conflict','cache_key'/);
  assert.match(worker,/resolution=ignore-duplicates,return=representation/);
  assert.match(worker,/analysisLockClaims/);
  assert.match(worker,/analysisLockJoins/);
});

test('lock degradation now fails closed before expensive recompute',()=> {
  assert.match(worker,/analysisLockFailOpen/);
  assert.match(worker,/ANALYSIS_LOCK_FAIL_CLOSED/);
  assert.match(worker,/claimed:false,key,claimId:'',shared:false,degraded:true,unavailable:true/);
  assert.match(worker,/ANALYSIS_COORDINATION_DEGRADED/);
});

test('non-owner waits for shared fixture analysis instead of recomputing',()=> {
  assert.match(worker,/async function waitForSharedAnalysis\(/);
  assert.match(worker,/const joined=await waitForSharedAnalysis\(cacheKey,cfg\)/);
  assert.match(worker,/sharedJoin:true/);
  assert.match(worker,/ANALYSIS_WARMING/);
  assert.match(worker,/shared_compute_pending/);
});

test('analysis owner always releases persistent lock',()=> {
  assert.match(worker,/let usageReservation=null;/);
  assert.match(worker,/finally \{\n    try \{[\s\S]*const disposition=usageCommitted \? 'commit' : 'refund';[\s\S]*finalizeAnalysisUsageReservation\(\{[\s\S]*refundAnalysisQuota\(user\.id,usageReservation,cfg\)[\s\S]*refundEntitlementUsage\(user\.id,passUsageReservation\.entitlementId,cfg\)[\s\S]*\} finally \{\n      await releaseDistributedAnalysisLock\(analysisLock,cfg\);\n    \}\n  \}/);
  assert.match(worker,/async function releaseDistributedAnalysisLock\(/);
  assert.match(worker,/row\?\.payload\?\.claimId/);
});

test('production safety exposes cross-instance collapse telemetry',()=> {
  for (const metric of ['analysisLockClaims','analysisLockJoins','analysisLockJoinHits','analysisLockTimeouts','analysisLockFailOpen']) {
    assert.ok(worker.includes(metric), 'missing ' + metric);
  }
  assert.match(worker,/distributed_analysis_lock/);
  assert.match(worker,/Cross-instance защита AI/);
});

test('RC66 health contract is release-gated',()=> {
  for (const flag of ['distributedAnalysisLock','viralFixtureCollapse','crossInstanceAnalysisDedupe','analysisLockFailClosed','sharedAnalysisWaitFallback']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
  assert.ok(worker.includes("analysisLockFailOpen: 'disabled'"));
  assert.match(worker,/distributedAnalysisLockSelfTest: distributedAnalysisLockDrill\(\)\.pass \? 'enabled' : 'failed'/);
});