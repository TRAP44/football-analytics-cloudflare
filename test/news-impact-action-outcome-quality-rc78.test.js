import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';
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
  assert.match(recovery,/const fixtureId=newsImpactPositiveId\(row\?\.fixture_id\)/);
  assert.match(recovery,/outcomeAt<action\.actionAt \|\| outcomeAt>action\.actionAt\+outcomeWindowMs/);
  assert.match(recovery,/if \(!code \|\| !expected \|\| code!==expected\) continue/);
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


test('RC78 outcome quality fails closed on malformed containers, ids, flags and outcome codes',async()=>{
  const recorded=[];
  const runtime=createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_ACTION_CODES:new Set(['full_ai','share']),
    NEWS_IMPACT_ACTION_LABELS:{full_ai:'Полный AI',share:'Поделиться'},
    NEWS_IMPACT_DECISION_CODES:new Set(['material']),
    NEWS_IMPACT_FUNNEL_MIN_USERS:10,
    NEWS_IMPACT_FUNNEL_STABLE_USERS:30,
    NEWS_IMPACT_OUTCOME_CODES:{full_ai:'analysis_delivered',share:'share_card_delivered'},
    NEWS_IMPACT_OUTCOME_WINDOW_MINUTES:5,
    recordGrowthEvent:async(_cfg,event)=>{recorded.push(event);return true;},
  });
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');

  assert.doesNotThrow(()=>runtime.buildNewsImpactActionOutcomeQuality({broken:true},null,{asOfMs}));
  assert.deepEqual(
    runtime.buildNewsImpactActionOutcomeQuality({broken:true},null,{asOfMs}).map(x=>x.observed),
    [0,0],
  );

  const actions=[
    {telegram_id:true,fixture_id:100,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material',action:'full_ai'}},
    {telegram_id:'7',fixture_id:'100',created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material',action:'full_ai'}},
  ];
  const wrongOutcome=[
    {telegram_id:'7',fixture_id:'100',created_at:'2026-09-23T10:03:00Z',metadata:{decision:'material',action:'full_ai',outcome:'share_card_delivered'}},
  ];
  const wrongQuality=runtime.buildNewsImpactActionOutcomeQuality(actions,wrongOutcome,{asOfMs,outcomeWindowMinutes:true});
  const wrongFullAi=wrongQuality.find(x=>x.action==='full_ai');
  assert.equal(wrongFullAi.observed,1);
  assert.equal(wrongFullAi.confirmed,0);

  const correctOutcome=[
    {telegram_id:'7',fixture_id:'100',created_at:'2026-09-23T10:03:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}},
  ];
  const correctQuality=runtime.buildNewsImpactActionOutcomeQuality(actions,correctOutcome,{asOfMs,outcomeWindowMinutes:true});
  const correctFullAi=correctQuality.find(x=>x.action==='full_ai');
  assert.equal(correctFullAi.confirmed,1);

  assert.equal(runtime.newsImpactOutcomeBottleneck({broken:true}),null);
  assert.equal(runtime.newsImpactOutcomeBottleneck([
    {action:'full_ai',attempts:10,completionPct:0,confidence:{eligibleForBottleneck:'false'}},
  ]),null);

  assert.equal(await runtime.recordNewsImpactOutcome({},{
    userId:true,fixtureId:100,decision:'material',action:'full_ai',
  }),false);
  assert.equal(recorded.length,0);

  assert.equal(await runtime.recordNewsImpactOutcome({},{
    userId:'7',fixtureId:'100',decision:'material',action:'full_ai',
    channel:'telegram',delivery:{toString(){throw new Error('must not coerce');}},
  }),true);
  assert.equal(recorded.length,1);
  assert.equal(recorded[0].userId,7);
  assert.equal(recorded[0].fixtureId,100);
  assert.equal('delivery' in recorded[0].metadata,false);
});

test('RC78 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc78/i.test(x)));
});
