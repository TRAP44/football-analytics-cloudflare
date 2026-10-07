import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const analysis=fs.readFileSync('src/analysis-runtime.js','utf8');
const telegramUpdate=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const admin=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC78 records outcomes only after successful delivery paths',()=>{
  assert.match(recovery,/eventName:'news_impact_outcome'/);

  const newsStart=telegramUpdate.indexOf("if (action==='news')");
  const newsDelivery=telegramUpdate.indexOf('await sendGeneralFootballNews',newsStart);
  const newsOutcome=telegramUpdate.indexOf('await swallowAsync(recordNewsImpactOutcome',newsDelivery);
  assert.ok(newsStart>=0 && newsDelivery>newsStart && newsOutcome>newsDelivery,'news outcome must follow delivery');

  const shareStart=telegramUpdate.indexOf("if (action==='share')");
  const shareDelivery=telegramUpdate.indexOf('await sendBotFixtureShareCard',shareStart);
  const shareOutcome=telegramUpdate.indexOf('await swallowAsync(recordNewsImpactOutcome',shareDelivery);
  assert.ok(shareStart>=0 && shareDelivery>shareStart && shareOutcome>shareDelivery,'share outcome must follow delivery');

  const sectionStart=telegramUpdate.indexOf('const delivery=await sendBotFixtureSection');
  const sectionGuard=telegramUpdate.indexOf('if (!delivery?.ok)',sectionStart);
  const sectionOutcome=telegramUpdate.indexOf('await swallowAsync(recordNewsImpactOutcome',sectionGuard);
  assert.ok(sectionStart>=0 && sectionGuard>sectionStart && sectionOutcome>sectionGuard,'section outcome must follow successful-delivery guard');

  assert.match(analysis,/await recordTrackedFullAiOutcome\('fresh'\)/);
});

test('RC78 outcome correlation is ordered and fixture-scoped',()=>{
  assert.match(recovery,/function newsImpactJourneyKey\(/);
  assert.match(recovery,/const fixtureId=Number\(row\.fixture_id \|\| 0\)/);
  assert.match(recovery,/outcomeAt<action\.actionAt \|\| outcomeAt>action\.actionAt\+outcomeWindowMs/);
  assert.match(worker,/const NEWS_IMPACT_OUTCOME_WINDOW_MINUTES = 5/);
});

test('RC78 protects very recent actions from false failure',()=>{
  assert.match(recovery,/confirmed\.has\(key\) \|\| value\.actionAt<=asOfMs-outcomeWindowMs/);
  assert.match(recovery,/pending=Math\.max\(0,observed\.length-attempts\)/);
  assert.match(growth,/newsImpactOutcomeSummary/);
});

test('RC78 admin UI distinguishes delivery from satisfaction and AI quality',()=>{
  assert.match(admin,/News Impact: действие → результат/);
  assert.match(admin,/подтверждённая сервером доставка/);
  assert.match(admin,/не оценка удовлетворённости пользователя/);
  assert.match(admin,/не доказательство качества прогноза/);
});

test('RC78 uses sample-aware confidence for action outcome quality',()=>{
  assert.match(recovery,/function newsImpactOutcomeBottleneck\(/);
  assert.match(recovery,/newsImpactConversionConfidence\(confirmedOutcomes,attempts\)/);
  assert.match(recovery,/function newsImpactOutcomeQualityDrill\(/);
  assert.match(recovery,/fullAi\?\.completionPct===80/);
  assert.match(recovery,/newsImpactOutcomeBottleneck\(quality\)\?\.action==='full_ai'/);
  assert.match(worker,/function newsImpactOutcomeQualityDrill\(\.\.\.args\).*getNewsImpactRecoveryRuntime\(\)\.newsImpactOutcomeQualityDrill/s);
});

test('RC78 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc78/i.test(x)));
});
