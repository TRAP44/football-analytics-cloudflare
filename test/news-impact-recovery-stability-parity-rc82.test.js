import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC82 adds a recent stability window after the strict RC81 decision',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS = 7/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS = 10/);
  assert.match(worker,/recentEvidenceRows = null/);
  assert.match(worker,/guardReason:'stability_sample'/);
  assert.match(worker,/guardReason:'recent_regression'/);
  assert.match(worker,/guardReason:'stable_significant_better'/);
});

test('RC82 builds recent evidence from the same 30-day runtime source',()=>{
  assert.match(worker,/recentCutoffMs=now-NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS\*86400_000/);
  assert.match(worker,/const recentAttempts=attempts\.filter/);
  assert.match(worker,/const recentEvidence=buildNewsImpactRecoveryStrategyEvidence\(recentAttempts,outcomes,failures/);
  assert.match(worker,/evidence,recentEvidence/);
  assert.match(worker,/newsImpactRecoveryStrategyDecision\(reason,action,loaded\.evidence,loaded\.recentEvidence\)/);
});

test('RC82 launch funnel uses shared runtime evidence instead of the selected dashboard period',()=>{
  assert.match(worker,/newsImpactRecoveryStrategyLoaded=await loadNewsImpactRecoveryStrategyEvidence\(cfg\)/);
  assert.match(worker,/buildNewsImpactRecoveryStrategyMatrix\(newsImpactRecoveryStrategyEvidence,newsImpactRecoveryStrategyRecentEvidence\)/);
  assert.match(worker,/evidenceSource:'shared_runtime_loader'/);
  assert.match(worker,/stabilityBlocked:/);
});

test('RC82 keeps blocked candidates observable without routing users to them',()=>{
  assert.match(worker,/proposedRecovery:candidate\.recovery/);
  assert.match(worker,/strategy:'fixed'/);
  assert.match(app,/кандидат ждёт подтверждения на свежем окне/);
  assert.match(app,/свежие данные не подтверждают override/);
  assert.match(app,/кандидат:/);
});

test('RC82 exposes deterministic stability self-test and production health flags',()=>{
  assert.match(worker,/function newsImpactRecoveryStabilityDrill\(/);
  assert.match(worker,/newsImpactRecoveryStabilitySelfTest: newsImpactRecoveryStabilityDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryStrategyParity','newsImpactRecoveryStabilityGuard']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC82 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^v6_\d/.test(x));
  assert.ok(files.includes('v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|rc82/i.test(x)));
});
