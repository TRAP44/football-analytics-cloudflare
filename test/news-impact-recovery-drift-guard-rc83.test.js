import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC83 detects statistically confirmed adaptive recovery drift',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS = 20/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS = 10/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS = 15/);
  assert.match(worker,/function newsImpactRecoveryDriftDecision\(/);
  assert.match(worker,/confidenceSeparated=Number\(recent\?\.confidence\?\.upperPct/);
  assert.match(worker,/guardReason:'performance_drift'/);
  assert.match(worker,/stability:'drift_blocked'/);
});

test('RC83 circuit breaker falls back to the fixed recovery',()=>{
  assert.match(worker,/selectedRecovery:decision\.fixedRecovery/);
  assert.match(worker,/selectedRecoveryLabel:decision\.fixedRecoveryLabel/);
  assert.match(worker,/strategy:'fixed'/);
  assert.match(worker,/driftDetected:true/);
  assert.match(worker,/buildNewsImpactRecoveryDriftMatrix\(/);
});

test('RC83 compares the recent window with the prior part of the same 30-day source',()=>{
  assert.match(worker,/const priorAttempts=attempts\.filter/);
  assert.match(worker,/at<recentCutoffMs/);
  assert.match(worker,/const priorEvidence=buildNewsImpactRecoveryStrategyEvidence\(priorAttempts,outcomes,failures/);
  assert.match(worker,/evidence,recentEvidence,priorEvidence/);
  assert.match(worker,/newsImpactRecoveryDriftDecision\(decision,loaded\.priorEvidence,loaded\.recentEvidence\)/);
});

test('RC83 stores only a categorical strategy guard reason for audit',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES/);
  assert.match(worker,/strategy_guard:safeStrategyReason/);
  assert.match(worker,/strategyReason:recovery\.guardReason/);
  const block=/eventName:'news_impact_outcome_failure'[\s\S]{0,700}?\n\s*\}\);/.exec(worker)?.[0] || '';
  assert.doesNotMatch(block,/error\.message|rawError|stack|query/);
});

test('RC83 admin surfaces drift state and automatic fallback',()=>{
  assert.match(app,/Drift circuit breaker/);
  assert.match(app,/performance drift/);
  assert.match(app,/driftBlocked/);
  assert.match(app,/strategy_guard/);
  assert.match(app,/recent окно с предыдущей частью 30-дневного периода/);
});

test('RC83 deterministic drift drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryDriftDrill\(/);
  assert.match(worker,/newsImpactRecoveryDriftSelfTest: newsImpactRecoveryDriftDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryDriftGuard','newsImpactRecoveryDriftAudit']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC83 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc83/i.test(x)));
});
