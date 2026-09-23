import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC81 requires stable baseline and candidate evidence before adaptive override',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS = 30/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS = 5/);
  assert.match(worker,/row\?\.confidence\?\.status==='stable'/);
  assert.match(worker,/x\?\.confidence\?\.lowerPct[\s\S]{0,120}baseline\?\.confidence\?\.upperPct/);
  assert.match(worker,/guardReason:'baseline_sample'/);
  assert.match(worker,/guardReason:'no_significant_better'/);
  assert.match(worker,/guardReason:'significant_better'/);
});

test('RC81 evidence is scoped to the same failure reason and action',()=>{
  assert.match(worker,/x=>x\.reason===safeReason && x\.action===safeAction/);
  assert.match(worker,/const sourceFailure=priorFailures\[priorFailures\.length-1\]/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES = 30/);
  assert.match(worker,/function buildNewsImpactRecoveryStrategyEvidence\(/);
});

test('RC81 failure path falls back safely when evidence is unavailable or truncated',()=>{
  assert.match(worker,/async function loadNewsImpactRecoveryStrategyEvidence\(/);
  assert.match(worker,/available:!page\.truncated/);
  assert.match(worker,/if \(!loaded\.available\)/);
  assert.match(worker,/strategy:'fixed'/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_STRATEGY_CACHE_MS = 300_000/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS = 30/);
});

test('RC81 uses the guarded selector for Telegram and Mini App failures',()=>{
  assert.match(worker,/const recovery=await selectNewsImpactRecoveryStrategy\(cfg,reason,action\)/);
  assert.match(worker,/const recovery=await selectNewsImpactRecoveryStrategy\(cfg,reason,'full_ai'\)/);
  assert.match(worker,/strategy:recovery\.strategy/);
  assert.match(worker,/strategy:safeStrategy/);
});

test('RC81 primary open_full_ai strategy opens the Mini App directly',()=>{
  const start=worker.indexOf("function newsImpactRecoveryKeyboard");
  const end=worker.indexOf("async function sendNewsImpactRecoveryMessage",start);
  const block=worker.slice(start,end);
  assert.match(block,/r==='open_full_ai'/);
  assert.match(block,/web_app:\{url:newsImpactRecoveryAnalysisUrl/);
  assert.match(block,/r!=='open_full_ai'/);
});

test('RC81 admin UI explains fixed vs adaptive strategy decisions',()=>{
  assert.match(app,/Recovery Strategy Guard/);
  assert.match(app,/fixed fallback → adaptive только при доказательстве/);
  assert.match(app,/непересекающиеся 95% Wilson-интервалы/);
  assert.match(app,/impactRecoveryStrategyMatrix/);
  assert.match(app,/guardReason/);
});

test('RC81 deterministic strategy drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryStrategyDrill\(/);
  assert.match(worker,/newsImpactRecoveryStrategySelfTest: newsImpactRecoveryStrategyDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryStrategyGuard','newsImpactAdaptiveRecovery','newsImpactFixedFallbackGuard','newsImpactRecoveryStrategyCache']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC81 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('.').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|rc81/i.test(x)));
});
