import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Consolidated recovery strategy regression coverage (historical RC80-RC84).

// test/news-impact-recovery-effectiveness-rc80.test.js
{
const worker=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');
const analysisController=fs.readFileSync('public/modules/analysis-controller.js','utf8');

test('RC80 records only real recovery attempts',()=>{
  assert.match(worker,/eventName:'news_impact_recovery_attempt'/);
  assert.match(worker,/function newsImpactRecoveryCallback\(/);
  assert.match(worker,/\^ni:r:/);
  assert.match(worker,/if \(recoveryCode\) await recordNewsImpactRecoveryAttempt/);
  assert.match(worker,/if \(newsImpactRecoveryCode\) \{[\s\S]{0,260}recordNewsImpactRecoveryAttempt/);
});

test('RC80 deduplicates repeated clicks by latest recovery journey',()=>{
  assert.match(worker,/function newsImpactRecoveryJourneyKey\(/);
  assert.match(worker,/const latestAttempts=new Map\(\)/);
  assert.match(worker,/attemptAt>previous\.attemptAt/);
  assert.match(worker,/base && recovery \? /);
});

test('RC80 requires a post-attempt confirmed delivery inside the maturity window',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_WINDOW_MINUTES = 5/);
  assert.match(worker,/event\.at>=item\.attemptAt && event\.at<=item\.attemptAt\+windowMs/);
  assert.match(worker,/state='recovered'/);
  assert.match(worker,/else if \(failure\) \{ state='failed'/);
  assert.match(worker,/item\.attemptAt<=asOfMs-windowMs/);
});

test('RC80 tracks full-AI fallback attribution through Mini App launch params',()=>{
  assert.match(worker,/function newsImpactRecoveryAnalysisUrl\(/);
  assert.match(worker,/newsImpactRecoveryCode:r/);
  assert.match(analysisController,/newsImpactRecoveryCode:\s*String\(options\.newsImpactRecoveryCode/);
  assert.match(app,/params\.get\('newsImpactRecoveryCode'\)/);
  assert.match(analysisController,/newsImpactRecoveryFrom/);
});

test('RC80 admin UI keeps pending out of premature failure conclusions',()=>{
  assert.match(app,/Recovery → подтверждённый результат/);
  assert.match(app,/только реальные повторные попытки/);
  assert.match(app,/ещё ожидают/);
  assert.match(app,/Сам показ fallback или повторной кнопки успехом не считается/);
});

test('RC80 sample-aware recovery ranking and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryBest\(/);
  assert.match(worker,/confidence\?\.eligibleForBottleneck/);
  assert.match(worker,/function newsImpactRecoveryEffectivenessDrill\(/);
  assert.match(worker,/newsImpactRecoveryEffectivenessSelfTest: newsImpactRecoveryEffectivenessDrill\(\)\.pass \? 'enabled' : 'failed'/);
});

test('RC80 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc80/i.test(x)));
});
}

// test/news-impact-recovery-strategy-guard-rc81.test.js
{
const worker=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc81/i.test(x)));
});
}

// test/news-impact-recovery-stability-parity-rc82.test.js
{
const worker=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc82/i.test(x)));
});
}

// test/news-impact-recovery-drift-guard-rc83.test.js
{
const worker=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
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
}

// test/news-impact-recovery-transition-alerts-rc84.test.js
{
const worker=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  assert.match(worker,/buildNewsImpactRecoveryAdminAlerts\([\s\S]{0,180}?newsImpactRecoveryStrategyMatrix,[\s\S]{0,180}?newsImpactRecoveryStrategyLoaded\.reason/);
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
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc84/i.test(x)));
});
}
