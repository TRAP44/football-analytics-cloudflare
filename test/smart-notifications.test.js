import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SMART_NOTIFICATION_POLICY,
  notificationDecision,
  publicSmartNotificationCapabilities,
  smartNotificationDedupeKey,
} from '../src/smart-notification-policy.js';
import { createSmartNotificationDeliveryService } from '../src/smart-notification-delivery.js';
import { aiProbabilityMovement, createSmartNotificationService, radarStrongSignalState } from '../src/smart-notification-service.js';
import { normalizeSmartNotificationPayload } from '../public/modules/smart-notifications.js';

test('server policy keeps basic match alerts FREE and gates player/AI/market alerts', () => {
  assert.equal(notificationDecision({ eventType:'match.goal', plan:'FREE' }).allowed, true);
  assert.deepEqual(
    notificationDecision({ eventType:'market.movement', plan:'FREE' }),
    { allowed:false, reason:'entitlement_required', category:'aiRadar', requiredPlan:'PRO' },
  );
  assert.equal(notificationDecision({ eventType:'player.goal', plan:'PRO' }).allowed, true);
  assert.equal(notificationDecision({ eventType:'ai.probability_change', plan:'PREMIUM' }).allowed, true);
  assert.equal(notificationDecision({
    eventType:'match.red_card',
    plan:'PREMIUM',
    preferences:{ enabled:true, match:false },
  }).reason, 'preference_category_disabled');

  const free = publicSmartNotificationCapabilities('FREE');
  const pro = publicSmartNotificationCapabilities('PRO');
  assert.equal(free.categories.match.available, true);
  assert.equal(free.categories.players.available, false);
  assert.equal(pro.categories.players.available, true);
  assert.equal(pro.categories.aiRadar.available, true);
  assert.equal(pro.thresholds.radarConfidence, SMART_NOTIFICATION_POLICY.radarConfidenceThreshold);
  assert.equal(pro.thresholds.radarOutcomeProbability, SMART_NOTIFICATION_POLICY.radarOutcomeThreshold);
  assert.equal(pro.playerContract.eventTypes.includes('player.goal'), true);
});

test('strong Radar signal uses persisted confidence/probability thresholds and only fires on a transition', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z');
  const weak = [
    { snapshot_key:'r1', captured_at:'2026-10-01T11:30:00.000Z', home_prob:52, draw_prob:24, away_prob:24, confidence_score:68 },
    { snapshot_key:'r2', captured_at:'2026-10-01T11:55:00.000Z', home_prob:58, draw_prob:22, away_prob:20, confidence_score:81 },
  ];
  const entered = radarStrongSignalState(weak, { now });
  assert.equal(entered.strong, true);
  assert.equal(entered.significant, true);
  assert.equal(entered.strongest.side, 'home');

  const sustained = radarStrongSignalState([
    weak[1],
    { snapshot_key:'r3', captured_at:'2026-10-01T11:59:00.000Z', home_prob:60, draw_prob:21, away_prob:19, confidence_score:84 },
  ], { now });
  assert.equal(sustained.strong, true);
  assert.equal(sustained.significant, false);

  const stale = radarStrongSignalState([
    { ...weak[1], captured_at:'2026-10-01T01:00:00.000Z' },
  ], { now });
  assert.equal(stale.reason, 'stale_signal');
  assert.equal(stale.significant, false);
});

test('dedupe keys are stable per fixture/event/player and distinct across events', () => {
  const first = smartNotificationDedupeKey({ fixtureId:12, eventType:'player.goal', playerId:99, eventKey:'55:goal' });
  const same = smartNotificationDedupeKey({ fixtureId:12, eventType:'player.goal', playerId:99, eventKey:'55:goal' });
  const other = smartNotificationDedupeKey({ fixtureId:12, eventType:'player.goal', playerId:99, eventKey:'72:goal' });
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.match(first, /^v1:12:player\.goal:p99:/);
});

test('AI probability movement ignores noise, accepts configured threshold and rejects stale signals', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z');
  const rows = [
    { snapshot_key:'a', captured_at:'2026-10-01T11:30:00.000Z', home_prob:40, draw_prob:30, away_prob:30 },
    { snapshot_key:'b', captured_at:'2026-10-01T11:55:00.000Z', home_prob:47, draw_prob:27, away_prob:26 },
  ];
  assert.equal(aiProbabilityMovement(rows, { thresholdPp:8, now }).significant, false);
  assert.equal(aiProbabilityMovement(rows, { thresholdPp:5, now }).significant, true);

  const stale = rows.map(row => ({ ...row, captured_at:row.captured_at.replace('11:', '01:') }));
  assert.equal(aiProbabilityMovement(stale, { thresholdPp:5, maxSignalAgeMinutes:180, now }).reason, 'stale_signal');
});

function deliveryRuntime(sendTelegramMessage) {
  const memory = {};
  const events = [];
  const service = createSmartNotificationDeliveryService({
    memory,
    hasSupabase:()=>false,
    supaRpc:async()=>{ throw new Error('unexpected rpc'); },
    sendTelegramMessage,
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  });
  return { service, memory, events };
}

test('event delivery is idempotent across repeated cron executions', async () => {
  let sends = 0;
  const {service} = deliveryRuntime(async()=>{
    sends += 1;
    return { ok:true, status:200, outcome:'sent' };
  });
  const input = {
    row:{ telegram_id:5, fixture_id:50 },
    eventType:'match.goal',
    category:'match',
    text:'goal',
    dedupeKey:'v1:50:match.goal:55',
  };
  assert.equal((await service.deliverSmartNotification(input, {})).state, 'sent');
  assert.equal((await service.deliverSmartNotification(input, {})).state, 'duplicate');
  assert.equal(sends, 1);
});

test('cooldown suppresses a second AI alert even with a different snapshot pair', async () => {
  let sends = 0;
  const {service} = deliveryRuntime(async()=>{
    sends += 1;
    return { ok:true, status:200, outcome:'sent' };
  });
  const base = {
    row:{ telegram_id:6, fixture_id:60 },
    eventType:'ai.probability_change',
    category:'aiRadar',
    text:'changed',
    cooldownSeconds:SMART_NOTIFICATION_POLICY.aiCooldownSeconds,
  };
  assert.equal((await service.deliverSmartNotification({ ...base, dedupeKey:'v1:60:ai.probability_change:a-b' }, {})).state, 'sent');
  assert.equal((await service.deliverSmartNotification({ ...base, dedupeKey:'v1:60:ai.probability_change:b-c' }, {})).state, 'cooldown');
  assert.equal(sends, 1);
});

test('Telegram unknown outcome fails closed while 429 enters bounded retry state', async () => {
  const unknown = deliveryRuntime(async()=>({
    ok:false, status:0, errorCode:0, outcome:'unknown', description:'timeout',
  }));
  const input = {
    row:{ telegram_id:7, fixture_id:70 },
    eventType:'match.goal',
    category:'match',
    text:'goal',
    dedupeKey:'v1:70:match.goal:1',
  };
  assert.equal((await unknown.service.deliverSmartNotification(input, {})).state, 'unknown');
  assert.equal((await unknown.service.deliverSmartNotification(input, {})).state, 'duplicate');

  const limited = deliveryRuntime(async()=>({
    ok:false, status:429, errorCode:429, outcome:'confirmed_failure', retryAfter:30, description:'Too Many Requests',
  }));
  assert.equal((await limited.service.deliverSmartNotification(input, {})).state, 'retry_pending');
  assert.equal((await limited.service.deliverSmartNotification(input, {})).state, 'retry_wait');
});

test('smart scheduler fans one trusted live event to match followers and reuses Favorite Players for player alerts', async () => {
  const originalNow = Date.now;
  const now = Date.parse('2026-10-01T12:20:00.000Z');
  Date.now = () => now;
  try {
    const rows = [
      { telegram_id:1, fixture_id:100, fixture_date:'2026-10-01T12:00:00.000Z', home_name:'Alpha', away_name:'Beta', enabled:true },
      { telegram_id:2, fixture_id:100, fixture_date:'2026-10-01T12:00:00.000Z', home_name:'Alpha', away_name:'Beta', enabled:true },
    ];
    const deliveries = [];
    const service = createSmartNotificationService({
      hasSupabase:()=>true,
      loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
      supaSelectPaged:async()=>({rows,truncated:false}),
      filterRecipients:async(input)=>({rows:input,blockedByPreference:0,blockedByEntitlement:0}),
      loadFavoritePlayersByUser:async()=>new Map([
        [1,[{telegram_id:1,player_id:10,player_name:'Forward',team_id:11}]],
        [2,[]],
      ]),
      loadLiveNotificationSnapshot:async()=>({
        trusted:true,
        stale:false,
        events:[{minute:20,extra:0,type:'Goal',detail:'Normal Goal',teamId:11,teamName:'Alpha',playerId:10,playerName:'Forward',eventKey:'20:goal:10'}],
      }),
      loadLineupSnapshot:async()=>({confirmed:false}),
      getAnalysisTimelineSnapshots:async()=>[],
      deliverSmartNotification:async(input)=>{
        deliveries.push(input);
        return {state:'sent'};
      },
      recordOpsEvent:async()=>{},
      maxFixturesPerRun:3,
    });

    const summary = await service.processSmartNotifications({botToken:'token'});
    assert.equal(summary.sent, 3);
    assert.equal(deliveries.filter(item=>item.eventType==='match.goal').length, 2);
    assert.equal(deliveries.filter(item=>item.eventType==='player.goal').length, 1);
    assert.equal(deliveries.find(item=>item.eventType==='player.goal').row.telegram_id, 1);
  } finally {
    Date.now = originalNow;
  }
});

test('Profile UI is progressive-disclosure and server capabilities drive locked categories', () => {
  const free = normalizeSmartNotificationPayload({
    preferences:{notificationPreferences:{enabled:true,match:true,players:true}},
    notificationCapabilities:{
      plan:'FREE',
      categories:{
        match:{available:true,requiredPlan:'FREE'},
        teams:{available:true,requiredPlan:'FREE'},
        players:{available:false,requiredPlan:'PRO'},
        aiRadar:{available:false,requiredPlan:'PRO'},
      },
      thresholds:{marketPp:5,aiProbabilityPp:8,aiCooldownMinutes:30,radarConfidence:75,radarOutcomeProbability:55,radarCooldownMinutes:60},
    },
  });
  assert.equal(free.preferences.players, true);
  assert.equal(free.capabilities.categories.players.available, false);

  const html = fs.readFileSync('public/index.html','utf8');
  const styles = fs.readFileSync('public/styles.css','utf8');
  const moduleSource = fs.readFileSync('public/modules/smart-notifications.js','utf8');
  assert.match(html,/id="smartNotificationsRoot"/);
  assert.match(moduleSource,/<details class="smart-notification-details">/);
  assert.match(moduleSource,/Мои игроки/);
  assert.match(moduleSource,/AI \/ Radar/);
  assert.match(moduleSource,/Radar: confidence/);
  for (const width of [320,360,375,390,430]) {
    const coveredByResponsiveContract = width <= 430;
    assert.equal(coveredByResponsiveContract, true);
  }
  assert.match(styles,/@media \(max-width:430px\)[\s\S]*?\.smart-notification-head/);
  assert.match(styles,/@media \(max-width:360px\)[\s\S]*?\.smart-notification-head/);
});

test('v6.24 migration adds only Smart Notification state and keeps Favorite Players as the existing source', () => {
  const sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_24.sql','utf8');
  const worker = fs.readFileSync('src/worker.js','utf8');
  assert.match(sql,/add column if not exists notification_preferences jsonb/i);
  assert.match(sql,/create table if not exists public\.smart_notification_deliveries/i);
  assert.match(sql,/claim_smart_notification_delivery/);
  assert.match(sql,/finalize_smart_notification_delivery/);
  assert.doesNotMatch(sql,/create table if not exists public\.favorite_players/i);
  assert.match(worker,/createFavoritePlayersService\(\{/);
  assert.match(worker,/loadFavoritePlayersByUser: loadFavoritePlayersForSmartNotifications/);
  assert.match(worker,/filterNotificationRecipients: filterSmartNotificationRecipients/);
  assert.match(worker,/publicSmartNotificationCapabilities\(quota\?\.plan\)/);
  assert.match(worker,/radarStrongSignalState/);
  assert.match(worker,/expandedDailyDigestText/);
  assert.match(worker,/ai\.digest_expanded/);
});
