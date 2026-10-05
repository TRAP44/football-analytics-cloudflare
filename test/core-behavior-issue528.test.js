import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker.js';
import { createLineupNotificationService } from '../src/lineup-notification-service.js';
import { createImportantChangeNotificationService } from '../src/important-change-notification-service.js';
import { createTelegramUpdateProcessor } from '../src/telegram-update-orchestration.js';
import { evaluatePromotionWindows, evaluatePostPromotionRollback } from '../src/calibration-lifecycle.js';

test('worker /api/analyze executes real route and rejects invalid fixture deterministically', async () => {
  const request = new Request('http://localhost/api/analyze', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({fixtureId:0}),
  });

  const response = await worker.fetch(request, { DEV_MODE:'true' }, { waitUntil() {} });
  assert.equal(response.status,400);
  const body = await response.json();
  assert.equal(body.error,'Некорректный номер матча.');
});

test('lineup scheduler executes confirmed lineup happy path and delivery state accounting', async () => {
  const deliveries=[];
  const events=[];
  const service=createLineupNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
    supaSelectPaged:async()=>({
      rows:[
        {telegram_id:1,fixture_id:501,home_name:'Alpha',away_name:'Beta',league_name:'League',fixture_date:'2026-10-05T18:00:00.000Z'},
        {telegram_id:2,fixture_id:501,home_name:'Alpha',away_name:'Beta',league_name:'League',fixture_date:'2026-10-05T18:00:00.000Z'},
      ],
      truncated:false,
    }),
    loadLineupSnapshot:async fixtureId=>({confirmed:fixtureId===501,homeName:'Alpha',awayName:'Beta'}),
    filterNotificationRecipients:async rows=>({rows,blockedByPreference:0,blockedByEntitlement:0}),
    deliverClaimedReminder:async (row,kind,text)=>{
      deliveries.push({row,kind,text});
      return {state:row.telegram_id===1?'sent':'already_claimed'};
    },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  });

  const summary=await service.processLineupNotifications({botToken:'token'});
  assert.equal(summary.ok,true);
  assert.equal(summary.checked,2);
  assert.equal(summary.fixturesChecked,1);
  assert.equal(summary.confirmed,1);
  assert.equal(summary.sent,1);
  assert.equal(summary.claimed,1);
  assert.equal(summary.failed,0);
  assert.equal(deliveries.length,2);
  assert.equal(deliveries[0].kind,'lineup');
  assert.match(deliveries[0].text,/Составы опубликованы/);
  assert.equal(events.at(-1)?.code,'LINEUP_NOTIFICATION_RUN_OK');
});

test('important-change scheduler emits only significant market movement notifications', async () => {
  const deliveries=[];
  const events=[];
  const service=createImportantChangeNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
    supaSelectPaged:async()=>({
      rows:[
        {telegram_id:7,fixture_id:700,home_name:'Home',away_name:'Away',league_name:'League'},
        {telegram_id:8,fixture_id:701,home_name:'Flat',away_name:'Market',league_name:'League'},
      ],
      truncated:false,
    }),
    filterNotificationRecipients:async rows=>({rows,blockedByPreference:0,blockedByEntitlement:0}),
    getOddsSnapshots:async fixtureId=>fixtureId===700
      ? [
          {at:'2026-10-05T10:00:00.000Z',homeProb:45,drawProb:30,awayProb:25},
          {at:'2026-10-05T12:00:00.000Z',homeProb:53,drawProb:27,awayProb:20},
        ]
      : [
          {at:'2026-10-05T10:00:00.000Z',homeProb:45,drawProb:30,awayProb:25},
          {at:'2026-10-05T12:00:00.000Z',homeProb:46,drawProb:29,awayProb:25},
        ],
    deliverClaimedReminder:async (row,kind,text)=>{
      deliveries.push({row,kind,text});
      return {state:'sent'};
    },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
    thresholdPp:5,
  });

  const summary=await service.processImportantChangeNotifications({botToken:'token'});
  assert.equal(summary.ok,true);
  assert.equal(summary.fixturesChecked,2);
  assert.equal(summary.significant,1);
  assert.equal(summary.sent,1);
  assert.equal(summary.failed,0);
  assert.equal(deliveries.length,1);
  assert.equal(deliveries[0].row.fixture_id,700);
  assert.equal(deliveries[0].kind,'important_change');
  assert.match(deliveries[0].text,/\+8\.0 п\.п\./);
  assert.equal(events.at(-1)?.code,'IMPORTANT_CHANGE_RUN_OK');
});

test('telegram processor propagates payment application failure instead of acknowledging success', async () => {
  const responseJson=(body,status=200)=>({body,status});
  const processor=createTelegramUpdateProcessor({
    loadRuntimeControls:async()=>({value:{}}),
    telegramLockdownDecision:()=>({blocked:false,rejectCheckout:false}),
    telegramApi:async()=>({}),
    json:responseJson,
    parseInvoicePayload:async()=>null,
    billingPlanConfig:()=>null,
    parsePassInvoicePayload:async()=>null,
    passProductConfig:()=>null,
    setBotDigestSubscription:async()=>{},
    telegramWebAppUrl:()=> 'https://example.test/app',
    recordGrowthEvent:async()=>{},
    footballBotKeyboard:()=>({}),
    sendBotDayMatches:async()=>{},
    cleanNewsImpactDecisionCode:v=>String(v||''),
    cleanNewsImpactActionCode:v=>String(v||''),
    cleanNewsImpactRecoveryCode:v=>String(v||''),
    recordNewsImpactRecoveryAttempt:async()=>{},
    sendGeneralFootballNews:async()=>{},
    recordNewsImpactOutcome:async()=>{},
    sendNewsImpactRecoveryMessage:async()=>{},
    sendBotFixtureShareCard:async()=>{},
    sendBotFixtureSection:async()=>({ok:true}),
    newsPublishedAtFromDayToken:()=>null,
    newsTeamByToken:()=>null,
    botRemoteTeamMatches:async()=>[],
    newsRelevantFixture:()=>null,
    newsTeamToken:()=> '',
    sendBotFootballSearch:async()=>{},
    sendFavoriteTeamNews:async()=>{},
    toggleBotFavorite:async()=>({active:false,team:{name:'Team'}}),
    loadBotFixtureCard:async()=>null,
    getFavorites:async()=>[],
    footballMatchActionKeyboard:()=>({}),
    setCache:async()=>{},
    postMatchReturnDisabledKey:id=>`postmatch:${id}`,
    memory:{cache:new Map()},
    hasSupabase:()=>false,
    supaDelete:async()=>{},
    applySuccessfulPayment:async()=>{ throw new Error('billing write failed'); },
    applyRefundedPayment:async()=>{},
    updateUserSubscription:async()=>{},
    telegramStartPayload:()=> '',
    upsertUser:async()=>{},
    parseLaunchStartParam:()=>({fixtureId:0}),
    ensureLaunchAttribution:async()=>({}),
    applyReferralAttribution:async()=>({accepted:false,status:'none'}),
    configureFootballBot:async()=>{},
    sendBotFixtureMenu:async()=>{},
    sendFootballBotHome:async()=>{},
    footballBotMoreKeyboard:()=>({}),
    sendFootballBotHelp:async()=>{},
    sendBotFavoriteTeams:async()=>{},
    sendBotFavoriteTeamMatches:async()=>{},
    sendDailyPicks:async()=>{},
    sendLastAiVerdict:async()=>{},
    sendBotAiTrackRecord:async()=>{},
    sendDigestControls:async()=>{},
  });

  await assert.rejects(
    processor(
      {url:'https://example.test/telegram/webhook'},
      {},
      {message:{from:{id:5},date:100,successful_payment:{telegram_payment_charge_id:'charge-1'}}},
    ),
    /billing write failed/,
  );
});


test('lineup scheduler returns controlled failure summary when reminder read fails', async () => {
  const events=[];
  const service=createLineupNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
    supaSelectPaged:async()=>{ throw new Error('reminder read failed'); },
    loadLineupSnapshot:async()=>({confirmed:false}),
    deliverClaimedReminder:async()=>({state:'sent'}),
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  });

  const summary=await service.processLineupNotifications({botToken:'token'});
  assert.equal(summary.ok,false);
  assert.equal(summary.failed,1);
  assert.equal(summary.checked,0);
  assert.equal(events[0]?.code,'LINEUP_NOTIFICATION_READ_FAILED');
  assert.equal(events[0]?.message,'reminder read failed');
});

test('important-change scheduler isolates snapshot failure and continues other fixtures', async () => {
  const deliveries=[];
  const service=createImportantChangeNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
    supaSelectPaged:async()=>({
      rows:[
        {telegram_id:1,fixture_id:801,home_name:'Broken',away_name:'Feed'},
        {telegram_id:2,fixture_id:802,home_name:'Healthy',away_name:'Feed'},
      ],
      truncated:false,
    }),
    filterNotificationRecipients:async rows=>({rows,blockedByPreference:0,blockedByEntitlement:0}),
    getOddsSnapshots:async fixtureId=>{
      if (fixtureId===801) throw new Error('odds unavailable');
      return [
        {at:'2026-10-05T10:00:00.000Z',homeProb:40,drawProb:30,awayProb:30},
        {at:'2026-10-05T12:00:00.000Z',homeProb:48,drawProb:27,awayProb:25},
      ];
    },
    deliverClaimedReminder:async row=>{
      deliveries.push(row.fixture_id);
      return {state:'sent'};
    },
    recordOpsEvent:async()=>{},
    thresholdPp:5,
  });

  const summary=await service.processImportantChangeNotifications({botToken:'token'});
  assert.equal(summary.ok,false);
  assert.equal(summary.fixturesChecked,2);
  assert.equal(summary.failed,1);
  assert.equal(summary.significant,1);
  assert.equal(summary.sent,1);
  assert.deepEqual(deliveries,[802]);
});


test('calibration promotion threshold behaves at the exact Brier safety boundary', () => {
  const windows=[
    {sample:20,baselineBrier:0.205,candidateBrier:0.204,baselineLogLoss:0.91,candidateLogLoss:0.91},
    {sample:20,baselineBrier:0.201,candidateBrier:0.200,baselineLogLoss:0.90,candidateLogLoss:0.89},
  ];
  const result=evaluatePromotionWindows(windows);
  assert.equal(result.pass,true);
  assert.equal(result.status,'eligible');

  const held=evaluatePromotionWindows([
    windows[0],
    {...windows[1],candidateBrier:0.2005},
  ]);
  assert.equal(held.pass,false);
  assert.equal(held.status,'held');
});

test('calibration rollback waits for sample size even when metrics regress materially', () => {
  const early=evaluatePostPromotionRollback({
    sample:19,
    activeBrier:0.25,
    championBrier:0.20,
    activeLogLoss:1.05,
    championLogLoss:0.90,
  });
  assert.equal(early.enoughData,false);
  assert.equal(early.rollback,false);

  const mature=evaluatePostPromotionRollback({
    sample:20,
    activeBrier:0.25,
    championBrier:0.20,
    activeLogLoss:1.05,
    championLogLoss:0.90,
  });
  assert.equal(mature.enoughData,true);
  assert.equal(mature.rollback,true);
});

test('telegram news-impact callback recovers through injected fallback when news delivery fails', async () => {
  const recoveryCalls=[];
  const apiCalls=[];
  const processor=createTelegramUpdateProcessor({
    loadRuntimeControls:async()=>({value:{}}),
    telegramLockdownDecision:()=>({blocked:false,rejectCheckout:false}),
    telegramApi:async(method,_cfg,body)=>{ apiCalls.push({method,body}); return {}; },
    json:(body,status=200)=>({body,status}),
    parseInvoicePayload:async()=>null,
    billingPlanConfig:()=>null,
    parsePassInvoicePayload:async()=>null,
    passProductConfig:()=>null,
    setBotDigestSubscription:async()=>{},
    telegramWebAppUrl:()=> 'https://example.test/app',
    recordGrowthEvent:async()=>{},
    footballBotKeyboard:()=>({}),
    sendBotDayMatches:async()=>{},
    cleanNewsImpactDecisionCode:v=>String(v||''),
    cleanNewsImpactActionCode:v=>String(v||''),
    cleanNewsImpactRecoveryCode:v=>String(v||''),
    recordNewsImpactRecoveryAttempt:async()=>{},
    sendGeneralFootballNews:async()=>{ throw Object.assign(new Error('news provider down'),{status:503}); },
    recordNewsImpactOutcome:async()=>{},
    sendNewsImpactRecoveryMessage:async(...args)=>recoveryCalls.push(args),
    sendBotFixtureShareCard:async()=>{},
    sendBotFixtureSection:async()=>({ok:true}),
    newsPublishedAtFromDayToken:()=>null,
    newsTeamByToken:()=>null,
    botRemoteTeamMatches:async()=>[],
    newsRelevantFixture:()=>null,
    newsTeamToken:()=> '',
    sendBotFootballSearch:async()=>{},
    sendFavoriteTeamNews:async()=>{},
    toggleBotFavorite:async()=>({active:false,team:{name:'Team'}}),
    loadBotFixtureCard:async()=>null,
    getFavorites:async()=>[],
    footballMatchActionKeyboard:()=>({}),
    setCache:async()=>{},
    postMatchReturnDisabledKey:id=>`postmatch:${id}`,
    memory:{cache:new Map()},
    hasSupabase:()=>false,
    supaDelete:async()=>{},
    applySuccessfulPayment:async()=>{},
    applyRefundedPayment:async()=>{},
    updateUserSubscription:async()=>{},
    telegramStartPayload:()=> '',
    upsertUser:async()=>{},
    parseLaunchStartParam:()=>({fixtureId:0}),
    ensureLaunchAttribution:async()=>({}),
    applyReferralAttribution:async()=>({accepted:false,status:'none'}),
    configureFootballBot:async()=>{},
    sendBotFixtureMenu:async()=>{},
    sendFootballBotHome:async()=>{},
    footballBotMoreKeyboard:()=>({}),
    sendFootballBotHelp:async()=>{},
    sendBotFavoriteTeams:async()=>{},
    sendBotFavoriteTeamMatches:async()=>{},
    sendDailyPicks:async()=>{},
    sendLastAiVerdict:async()=>{},
    sendBotAiTrackRecord:async()=>{},
    sendDigestControls:async()=>{},
  });

  const result=await processor(
    {url:'https://example.test/telegram/webhook'},
    {},
    {callback_query:{id:'cb-news',data:'news:impact:material:news:123',from:{id:77},message:{chat:{id:88}}}},
  );
  assert.deepEqual(result.body,{ok:true,recovered:true});
  assert.equal(recoveryCalls.length,1);
  assert.equal(recoveryCalls[0][2].fixtureId,123);
  assert.equal(recoveryCalls[0][2].fallback,'provider_unavailable');
  assert.equal(apiCalls[0]?.method,'answerCallbackQuery');
});
