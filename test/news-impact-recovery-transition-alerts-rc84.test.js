import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC84 derives strategy transition history from actual failure events',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryTransitionHistory\(/);
  assert.match(worker,/previous\.strategy!==strategy \|\| previous\.recovery!==recovery/);
  assert.match(worker,/fromStrategy:previous\.strategy/);
  assert.match(worker,/toStrategy:strategy/);
  assert.match(worker,/fromRecovery:previous\.recovery/);
  assert.match(worker,/toRecovery:recovery/);
  assert.match(worker,/transitionHistory=buildNewsImpactRecoveryTransitionHistory\(failures/);
});

test('RC84 transition API is privacy-safe and does not expose Telegram IDs',()=>{
  const start=worker.indexOf('function buildNewsImpactRecoveryTransitionHistory');
  const end=worker.indexOf('function summarizeNewsImpactRecoveryTransitions',start);
  const block=worker.slice(start,end);
  assert.doesNotMatch(block,/telegram_id\s*:/);
  assert.match(worker,/newsImpactRecoveryTransitionPrivacyGuard: 'enabled'/);
  assert.match(app,/Telegram ID в API истории не возвращаются/);
});

test('RC84 summarizes fixed to adaptive and adaptive to fixed transitions',()=>{
  assert.match(worker,/function summarizeNewsImpactRecoveryTransitions\(/);
  assert.match(worker,/fixedToAdaptive:list\.filter/);
  assert.match(worker,/adaptiveToFixed:list\.filter/);
  assert.match(worker,/recoveryChanged:list\.filter/);
  assert.match(worker,/newsImpactRecoveryTransitionSummary/);
});

test('RC84 builds actionable admin alerts without changing runtime routing',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryAdminAlerts\(/);
  for (const code of ['performance_drift','recent_regression','stability_sample','strategy_evidence_unavailable']) {
    assert.ok(worker.includes("'" + code + "'"), 'missing alert code ' + code);
  }
  assert.match(worker,/newsImpactRecoveryStrategyAlerts/);
  assert.match(worker,/newsImpactRecoveryAlertSummary/);
  assert.match(app,/Recovery: предупреждения/);
  assert.match(app,/История Recovery Strategy/);
});

test('RC84 uses the same 30-day strategy loader for history and alerts',()=>{
  assert.match(worker,/transitionHistory:\s*\[\]/);
  assert.match(worker,/newsImpactRecoveryStrategyLoaded\.transitionHistory/);
  assert.match(worker,/buildNewsImpactRecoveryAdminAlerts\(newsImpactRecoveryStrategyMatrix,newsImpactRecoveryStrategyLoaded\.reason\)/);
  assert.match(app,/История строится по фактически применённой стратегии в failure-событиях за 30 дней/);
});

test('RC84 deterministic transition drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryTransitionDrill\(/);
  assert.match(worker,/newsImpactRecoveryTransitionSelfTest: newsImpactRecoveryTransitionDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryTransitionHistory','newsImpactRecoveryAdminAlerts','newsImpactRecoveryTransitionPrivacyGuard']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC84 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('.').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|rc84/i.test(x)));
});
