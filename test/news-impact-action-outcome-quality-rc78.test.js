import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC78 records outcomes only after successful delivery paths',()=>{
  assert.match(worker,/eventName:'news_impact_outcome'/);
  assert.match(worker,/await sendGeneralFootballNews[\s\S]{0,220}await recordNewsImpactOutcome/);
  assert.match(worker,/await sendBotFixtureShareCard[\s\S]{0,220}await recordNewsImpactOutcome/);
  const deliveryStart=worker.indexOf('const delivery=await sendBotFixtureSection');
  const deliveryOutcome=worker.indexOf('await recordNewsImpactOutcome',deliveryStart);
  const deliveryGuard=worker.indexOf('if (!delivery?.ok)',deliveryStart);
  assert.ok(deliveryStart>=0 && deliveryGuard>deliveryStart && deliveryOutcome>deliveryGuard,'section outcome must follow successful-delivery guard');
  assert.match(worker,/await recordTrackedFullAiOutcome\('fresh'\)/);
});

test('RC78 outcome correlation is ordered and fixture-scoped',()=>{
  assert.match(worker,/function newsImpactJourneyKey\(/);
  assert.match(worker,/row\.fixture_id/);
  assert.match(worker,/outcomeAt<action\.actionAt \|\| outcomeAt>action\.actionAt\+outcomeWindowMs/);
  assert.match(worker,/NEWS_IMPACT_OUTCOME_WINDOW_MINUTES = 5/);
});

test('RC78 protects very recent actions from false failure',()=>{
  assert.match(worker,/confirmed\.has\(key\) \|\| value\.actionAt<=asOfMs-outcomeWindowMs/);
  assert.match(worker,/pending=Math\.max\(0,observed\.length-attempts\)/);
  assert.match(worker,/newsImpactOutcomeSummary/);
});

test('RC78 admin UI distinguishes delivery from satisfaction and AI quality',()=>{
  assert.match(app,/News Impact: действие → результат/);
  assert.match(app,/подтверждённая сервером доставка/);
  assert.match(app,/не оценка удовлетворённости пользователя/);
  assert.match(app,/не доказательство качества прогноза/);
});

test('RC78 uses sample-aware confidence for action outcome quality',()=>{
  assert.match(worker,/function newsImpactOutcomeBottleneck\(/);
  assert.match(worker,/newsImpactConversionConfidence\(confirmedOutcomes,attempts\)/);
  assert.match(worker,/function newsImpactOutcomeQualityDrill\(/);
  assert.match(worker,/newsImpactOutcomeQualitySelfTest: newsImpactOutcomeQualityDrill\(\)\.pass \? 'enabled' : 'failed'/);
});

test('RC78 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('.').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|rc78/i.test(x)));
});
