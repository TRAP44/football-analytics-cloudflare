import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC79 stores categorical failure diagnostics without raw error text',()=>{
  assert.match(worker,/eventName:'news_impact_outcome_failure'/);
  assert.match(worker,/metadata:\{[\s\S]{0,240}decision:safeDecision[\s\S]{0,240}reason:safeReason[\s\S]{0,240}recovery:safeRecovery/);
  const block=/eventName:'news_impact_outcome_failure'[\s\S]{0,520}?\n\s*\}\);/.exec(worker)?.[0] || '';
  assert.doesNotMatch(block,/error\.message|rawError|stack|url|query/);
});

test('RC79 classifies known operational failures and recovery paths',()=>{
  assert.match(worker,/function newsImpactFailureCode\(/);
  assert.match(worker,/function newsImpactRecoveryForFailure\(/);
  for (const code of ['provider_rate_limit','provider_unavailable','quota_exhausted','analysis_warming','match_missing','invalid_fixture','data_invalid','telegram_delivery','timeout','server_error']) {
    assert.ok(worker.includes("'" + code + "'"), 'missing ' + code);
  }
  for (const recovery of ['retry','retry_soon','retry_later','wait_quota_reset','open_search','open_full_ai']) {
    assert.ok(worker.includes("'" + recovery + "'"), 'missing ' + recovery);
  }
});

test('RC79 does not count swallowed Telegram section errors as successful outcomes',()=>{
  assert.match(worker,/async function sendBotFixtureSection\([\s\S]{0,120}?options = \{\}/);
  assert.match(worker,/return \{ok:true,status:200\}/);
  assert.match(worker,/return \{ok:false,status,code:/);
  assert.match(worker,/const delivery=await sendBotFixtureSection[\s\S]{0,360}?if \(!delivery\?\.ok\)/);
});

test('RC79 exposes safe recovery in Telegram and Mini App',()=>{
  assert.match(worker,/function newsImpactRecoveryKeyboard\(/);
  assert.match(worker,/sendNewsImpactRecoveryMessage\(/);
  assert.match(worker,/error\.newsImpactRecovery=recovery/);
  assert.match(worker,/newsImpactRecovery:error\.newsImpactRecovery/);
  assert.match(app,/e\.payload\?\.newsImpactRecovery/);
  assert.match(app,/recovery\.action==='search'/);
});

test('RC79 aggregates failure reasons without interpreting dissatisfaction',()=>{
  assert.match(worker,/function buildNewsImpactFailureDiagnostics\(/);
  assert.match(worker,/rawErrorsStored:false/);
  assert.match(worker,/meaning:'delivery_failure_not_user_dissatisfaction'/);
  assert.match(app,/News Impact: диагностика сбоев/);
  assert.match(app,/Сбой доставки не означает, что пользователь недоволен/);
});

test('RC79 deterministic health and migration contract',()=>{
  assert.match(worker,/function newsImpactFailureDiagnosticsDrill\(/);
  assert.match(worker,/newsImpactFailureDiagnosticsSelfTest: newsImpactFailureDiagnosticsDrill\(\)\.pass \? 'enabled' : 'failed'/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc79/i.test(x)));
});
