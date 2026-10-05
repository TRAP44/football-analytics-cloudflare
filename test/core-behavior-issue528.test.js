import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker.js';
import { createLineupNotificationService } from '../src/lineup-notification-service.js';
import { createImportantChangeNotificationService } from '../src/important-change-notification-service.js';
import { createTelegramUpdateProcessor } from '../src/telegram-update-orchestration.js';

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
