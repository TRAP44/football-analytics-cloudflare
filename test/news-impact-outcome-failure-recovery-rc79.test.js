import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const telegramUpdate=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
const botOrchestration=fs.readFileSync('src/telegram-bot-orchestration-runtime.js','utf8');
const analysis=fs.readFileSync('src/analysis-runtime.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const admin=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');
const analysisController=fs.readFileSync('public/modules/analysis-controller.js','utf8');

test('RC79 stores categorical failure diagnostics without raw error text',()=>{
  assert.match(recovery,/eventName:'news_impact_outcome_failure'/);
  const start=recovery.indexOf("eventName:'news_impact_outcome_failure'");
  const block=recovery.slice(start,start+900);
  assert.match(block,/decision:safeDecision/);
  assert.match(block,/reason:safeReason/);
  assert.match(block,/recovery:safeRecovery/);
  assert.doesNotMatch(block,/error\.message|rawError|stack|url|query/);
});

test('RC79 classifies known operational failures and recovery paths',()=>{
  assert.match(recovery,/function newsImpactFailureCode\(/);
  assert.match(recovery,/function newsImpactRecoveryForFailure\(/);
  for (const code of ['provider_rate_limit','provider_unavailable','quota_exhausted','analysis_warming','match_missing','invalid_fixture','data_invalid','telegram_delivery','timeout','server_error']) {
    assert.ok(recovery.includes("'" + code + "'"), 'missing ' + code);
  }
  for (const recoveryCode of ['retry','retry_soon','retry_later','wait_quota_reset','open_search','open_full_ai']) {
    assert.ok(recovery.includes("'" + recoveryCode + "'"), 'missing ' + recoveryCode);
  }
});

test('RC79 does not count failed Telegram section delivery as a successful outcome',()=>{
  assert.match(botOrchestration,/async function sendBotFixtureSection\([\s\S]{0,160}?options = \{\}/);
  assert.match(botOrchestration,/return \{ok:true,status:200\}/);
  assert.match(botOrchestration,/ok:false,[\s\S]{0,100}?status,[\s\S]{0,100}?code:/);

  const deliveryStart=telegramUpdate.indexOf('const delivery=await sendBotFixtureSection');
  const guard=telegramUpdate.indexOf('if (!delivery?.ok)',deliveryStart);
  const outcome=telegramUpdate.indexOf('await swallowAsync(recordNewsImpactOutcome',guard);
  assert.ok(deliveryStart>=0 && guard>deliveryStart && outcome>guard,'outcome must follow successful section guard');
});

test('RC79 exposes safe recovery in Telegram and Mini App',()=>{
  assert.match(recovery,/function newsImpactRecoveryKeyboard\(/);
  assert.match(recovery,/async function sendNewsImpactRecoveryMessage\(/);
  assert.match(analysis,/error\.newsImpactRecovery=recovery/);
  assert.match(analysisController,/error\?\.payload\?\.newsImpactRecovery/);
  assert.match(analysisController,/recovery\.action === 'search'/);
});

test('RC79 aggregates failure reasons without interpreting dissatisfaction',()=>{
  assert.match(recovery,/function buildNewsImpactFailureDiagnostics\(/);
  assert.match(growth,/rawErrorsStored:false/);
  assert.match(growth,/meaning:'delivery_failure_not_user_dissatisfaction'/);
  assert.match(admin,/News Impact: диагностика сбоев/);
  assert.match(admin,/Сбой доставки не означает, что пользователь недоволен/);
});

test('RC79 deterministic failure drill remains wired through the recovery runtime',()=>{
  assert.match(recovery,/function newsImpactFailureDiagnosticsDrill\(/);
  assert.match(recovery,/provider\?\.events===2/);
  assert.match(recovery,/recovery\?\.code==='retry_soon'/);
  assert.match(worker,/function newsImpactFailureDiagnosticsDrill\(\.\.\.args\).*getNewsImpactRecoveryRuntime\(\)\.newsImpactFailureDiagnosticsDrill/s);
});

test('RC79 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc79/i.test(x)));
});
