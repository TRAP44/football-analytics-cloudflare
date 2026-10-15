// «Поделиться матчем» в боте (Сергей 15.10, бэклог №1): карточка для пересылки с личной
// реферальной ссылкой; друг по ссылке попадает сразу на матч, приглашение — за поделившимся.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeReferralCode,
  opaqueReferralCode,
  referralAttributionDecision,
  splitLaunchReferralParts,
} from '../src/referral-attribution.js';
import { createTelegramLinksRuntime } from '../src/telegram-links.js';
import { createGrowthReferralRuntime } from '../src/growth-referral.js';
import { createPublisherRuntime } from '../src/publisher-runtime.js';
import { isBettingText } from '../src/signal-wording.js';

const BOT_SECRET='test-bot-secret';
const SHARER=111111111;
const FRIEND=222222222;
const FIXTURE=1234567;

function cleanLaunchPart(value, maxLength = 24) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,maxLength);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function normalizeCard(match = {}) {
  return {
    fixtureId:match.fixtureId,
    date:match.date || '',
    live:match.live===true,
    finished:match.finished===true,
    elapsed:Number.isSafeInteger(match.elapsed) ? match.elapsed : null,
    goalsHome:Number.isSafeInteger(match.goalsHome) ? match.goalsHome : null,
    goalsAway:Number.isSafeInteger(match.goalsAway) ? match.goalsAway : null,
    homeName:match.homeName || 'Хозяева',
    awayName:match.awayName || 'Гости',
    league:match.league || '',
    country:match.country || '',
  };
}

// До назначенного начала тестового матча (18.10 19:00 UTC).
const BEFORE_KICKOFF=Date.parse('2026-10-18T12:00:00Z');

function harness({ match, analysis, now = BEFORE_KICKOFF, referralDown = false } = {}) {
  const memory={users:new Map()};
  const growth=createGrowthReferralRuntime({
    memory,
    getUserRecord:async()=>null,
    hasSupabase:()=>false,
    supaPatch:async()=>{},
    supaUpsert:async()=>{},
    supaSelectOne:async()=>null,
    supaDelete:async()=>{},
    safeOpsMetadata:value=>value,
    redactOpsString:value=>String(value),
    normalizeReferralCode,
    opaqueReferralCode,
    referralAttributionDecision,
    splitLaunchReferralParts,
  });
  const links=createTelegramLinksRuntime({
    cleanLaunchPart,
    getCache:async()=>null,
    setCache:async()=>{},
    telegramApi:async()=>({id:202,username:'MatchRadarAIBot'}),
  });
  const sent=[];
  const events=[];
  const noop=()=>{};
  const publisher=createPublisherRuntime({
    adminForbidden:noop,
    botFixtureDateTime:()=>'',
    campaignStartParam:links.campaignStartParam,
    channelPublisherState:()=>({}),
    claimChannelPublishIdempotency:noop,
    cleanLaunchPart,
    completeChannelPublishIdempotency:noop,
    // referralDown — как временный сбой Supabase: код не подтверждён, ссылка без него.
    ensureReferralCode:referralDown ? async()=>'' : growth.ensureReferralCode,
    fixtureShareStartParam:links.fixtureShareStartParam,
    fixtureTelegramDeepLink:links.fixtureTelegramDeepLink,
    getCache:async()=>analysis ?? null,
    isAdminUser:()=>false,
    json:(body,status=200)=>({body,status}),
    loadBotFixtureCard:async id=>id===FIXTURE ? (match ?? {
      fixtureId:FIXTURE,
      date:'2026-10-18T19:00:00Z',
      homeName:'Реал Мадрид',
      awayName:'Барселона',
      league:'La Liga',
      country:'Испания',
    }) : null,
    normalizeBotFixtureCard:normalizeCard,
    parseLaunchStartParam:growth.parseLaunchStartParam,
    publishChannelMessage:noop,
    readJson:async()=>null,
    recordGrowthEvent:async(cfg,event)=>{ events.push(event); return true; },
    recordOpsEvent:async()=>{},
    redactOpsString:value=>String(value),
    releaseChannelPublishIdempotency:noop,
    telegramApi:async(method,cfg,body)=>{ sent.push({method,body}); return {}; },
    telegramCampaignDeepLink:links.telegramCampaignDeepLink,
    telegramHtmlEscape:escapeHtml,
    telegramShareComposerUrl:links.telegramShareComposerUrl,
    clock:()=>now,
  });
  return {growth,publisher,sent,events,cfg:{botToken:BOT_SECRET}};
}

function deepLinkFrom(message) {
  const button=message.body.reply_markup.inline_keyboard[0][0];
  return new URL(button.url);
}

test('share card carries the sharer\'s personal referral link and only link buttons', async () => {
  const {publisher,sent,events,cfg}=harness();
  const result=await publisher.sendBotFixtureShareCard(new Request('https://app.example/'),cfg,SHARER,SHARER,FIXTURE);
  assert.deepEqual(result,{ok:true,referral:true});
  assert.equal(sent.length,1);
  const message=sent[0];
  assert.equal(message.method,'sendMessage');

  const code=await opaqueReferralCode(SHARER,BOT_SECRET);
  const url=deepLinkFrom(message);
  assert.equal(url.origin+url.pathname,'https://t.me/MatchRadarAIBot');
  const start=url.searchParams.get('start');
  assert.match(start,new RegExp(`^fx${FIXTURE}__.+__r${code}$`));
  assert.ok(start.length<=64);
  assert.ok(!start.includes(String(SHARER)),'raw Telegram ID never goes into the link');

  // Ссылка есть и в самом тексте: пересланная карточка работает даже без кнопок.
  assert.ok(message.body.text.includes(`href="${escapeHtml(url.toString())}"`));
  assert.match(message.body.text,/Реал Мадрид — Барселона/);
  assert.match(message.body.text,/La Liga, Испания/);
  assert.match(message.body.text,/18\.10, 22:00 МСК/);

  // В пересланном сообщении у друга работают только кнопки-ссылки.
  const buttons=message.body.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.length,2);
  for (const button of buttons) {
    assert.equal(typeof button.url,'string');
    assert.equal(button.callback_data,undefined);
    assert.equal(button.web_app,undefined);
  }
  assert.match(buttons[1].url,/^https:\/\/t\.me\/share\/url\?/);
  assert.equal(new URL(buttons[1].url).searchParams.get('url'),url.toString());

  assert.equal(events.length,1);
  assert.equal(events[0].eventName,'share_created');
  assert.equal(events[0].metadata.referral,true);
});

test('friend opens the shared link: lands on the match and the invite is credited to the sharer', async () => {
  const {growth,publisher,sent,cfg}=harness();
  await publisher.sendBotFixtureShareCard(new Request('https://app.example/'),cfg,SHARER,SHARER,FIXTURE);
  const start=deepLinkFrom(sent[0]).searchParams.get('start');

  const intent=growth.parseLaunchStartParam(start);
  assert.equal(intent.fixtureId,FIXTURE,'bot opens this exact match');
  assert.equal(intent.action,'fixture');
  assert.equal(intent.campaign,'match_share');

  const code=await opaqueReferralCode(SHARER,BOT_SECRET);
  assert.equal(intent.referralCode,code);
  assert.equal(await growth.lookupReferralCodeOwner(intent.referralCode,cfg),SHARER);

  const accepted=await growth.applyReferralAttribution(FRIEND,intent,cfg);
  assert.deepEqual(accepted,{accepted:true,status:'accepted',referralCode:code});
  assert.deepEqual(await growth.referralAttributionForUser(FRIEND,cfg),{referralCode:code,createdAt:null});

  // Повторное открытие не переписывает пригласившего; своя ссылка не засчитывается.
  assert.equal((await growth.applyReferralAttribution(FRIEND,intent,cfg)).status,'duplicate_attribution');
  assert.equal((await growth.applyReferralAttribution(SHARER,intent,cfg)).status,'self_referral');
});

test('share card never shows betting markets: no «3+ гола», «обе забьют», odds', async () => {
  for (const code of ['over25','btts']) {
    const {publisher,sent,cfg}=harness({analysis:{aiInstructor:{betSignal:{code,label:'ТБ 2.5'},confidenceScore:71}}});
    await publisher.sendBotFixtureShareCard(new Request('https://app.example/'),cfg,SHARER,SHARER,FIXTURE);
    const text=sent[0].body.text;
    assert.doesNotMatch(text,/3\+ гола|Забьют обе|обе забьют|ТБ|коэффициент|ставк/i);
    assert.doesNotMatch(text,/🧠 AI:/,`${code} is not an outcome verdict`);
    assert.equal(isBettingText(text),false);
  }

  const {publisher,sent,cfg}=harness({analysis:{aiInstructor:{betSignal:{code:'home',label:'П1'},confidenceScore:64.4}}});
  await publisher.sendBotFixtureShareCard(new Request('https://app.example/'),cfg,SHARER,SHARER,FIXTURE);
  assert.match(sent[0].body.text,/🧠 AI: <b>Перевес Реал Мадрид<\/b> · уверенность 64\/100/);
  assert.equal(isBettingText(sent[0].body.text),false);
});

test('live and finished matches show the score, not a stale pre-match verdict', async () => {
  const analysis={aiInstructor:{betSignal:{code:'home'},confidenceScore:64}};
  const live=harness({analysis,match:{fixtureId:FIXTURE,live:true,elapsed:61,goalsHome:1,goalsAway:0,homeName:'Интер',awayName:'Милан',league:'Serie A'}});
  await live.publisher.sendBotFixtureShareCard(new Request('https://app.example/'),live.cfg,SHARER,SHARER,FIXTURE);
  assert.match(live.sent[0].body.text,/🔴 Идёт матч 61′ · 1:0/);
  assert.doesNotMatch(live.sent[0].body.text,/🧠 AI:/);

  const done=harness({analysis,match:{fixtureId:FIXTURE,finished:true,goalsHome:2,goalsAway:2,homeName:'Интер',awayName:'Милан',league:'Serie A'}});
  await done.publisher.sendBotFixtureShareCard(new Request('https://app.example/'),done.cfg,SHARER,SHARER,FIXTURE);
  assert.match(done.sent[0].body.text,/🏁 Матч завершён · 2:2/);
  assert.doesNotMatch(done.sent[0].body.text,/🧠 AI:/);
});

test('every bot match card offers «Поделиться матчем», and the tap answers after the card is sent', () => {
  const botUi=fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8');
  for (const name of ['footballMatchActionKeyboard','footballQuickAiHandoffKeyboard','footballSearchHandoffKeyboard']) {
    const start=botUi.indexOf(`function ${name}(`);
    assert.ok(start>=0,`${name} exists`);
    const end=botUi.indexOf('\n  function ',start+1);
    assert.match(botUi.slice(start,end),/callback_data:`match:share:\$\{fixtureId\}`/,`${name} has the share button`);
  }

  const update=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
  const handler=update.slice(update.indexOf('const shareAction='),update.indexOf('const matchAction ='));
  assert.ok(handler.indexOf('await sendBotFixtureShareCard')<handler.indexOf("'answerCallbackQuery'"));
  assert.match(handler,/Перешлите карточку друзьям/);
});

test('kickoff passed but the cached card still says «not started»: no stale verdict (Codex #914)', async () => {
  const analysis={aiInstructor:{betSignal:{code:'home'},confidenceScore:64}};
  const stale=harness({analysis,now:Date.parse('2026-10-18T19:40:00Z')});
  await stale.publisher.sendBotFixtureShareCard(new Request('https://app.example/'),stale.cfg,SHARER,SHARER,FIXTURE);
  const text=stale.sent[0].body.text;
  assert.doesNotMatch(text,/🧠 AI:/);
  assert.doesNotMatch(text,/🗓/);
  assert.match(text,/⏱ Начало: 18\.10, 22:00 МСК/);

  const fresh=harness({analysis});
  await fresh.publisher.sendBotFixtureShareCard(new Request('https://app.example/'),fresh.cfg,SHARER,SHARER,FIXTURE);
  assert.match(fresh.sent[0].body.text,/🧠 AI: <b>Перевес Реал Мадрид<\/b>/);
});

test('without a referral code the card still works, and the tap does not promise a personal link', async () => {
  const {publisher,sent,cfg}=harness({referralDown:true});
  const result=await publisher.sendBotFixtureShareCard(new Request('https://app.example/'),cfg,SHARER,SHARER,FIXTURE);
  assert.deepEqual(result,{ok:true,referral:false});
  const start=deepLinkFrom(sent[0]).searchParams.get('start');
  assert.match(start,new RegExp(`^fx${FIXTURE}__`));
  assert.doesNotMatch(start,/__r[a-f0-9]{16}$/);
});
