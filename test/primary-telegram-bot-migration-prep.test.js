import { readFileSync as readContractSource } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  primaryTelegramBotIdentityCacheKey,
  primaryTelegramUpdateDedupeKey,
  resolvePrimaryTelegramBotUsername,
  telegramBotStartUrl,
} from '../src/telegram-primary-identity.js';
import { bytesToHex, hmacSha256, validateTelegramInitData } from '../src/crypto-utils.js';
import { channelPublisherState, sendMessage } from '../src/channel-publisher.js';

const worker = fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/auth-user.js','utf8')+'\n'+fs.readFileSync('src/growth-referral.js','utf8');
const telegramLinks = fs.readFileSync('src/telegram-links.js','utf8');
const identityModule = fs.readFileSync('src/telegram-primary-identity.js','utf8');
const router = fs.readFileSync('src/router.js','utf8');
const userDataApi = fs.readFileSync('src/user-data-api-runtime.js','utf8');
const accessControl = fs.readFileSync('src/access-control.js','utf8');
const reminderDeliveryService = fs.readFileSync('src/reminder-delivery-service.js','utf8');
const bootstrap = fs.readFileSync('src/worker-bootstrap-runtime.js','utf8');
const authGrowthWiring = fs.readFileSync('src/auth-growth-wiring-runtime.js','utf8');
const billingApi = fs.readFileSync('src/billing-api-runtime.js','utf8');
const publisherRuntime = fs.readFileSync('src/publisher-runtime.js','utf8');
const serviceWiring = fs.readFileSync('src/service-wiring-runtime.js','utf8');

async function signedInitData(botToken, userId = 24681012) {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  params.set('query_id', 'migration-prep');
  params.set('user', JSON.stringify({ id:userId, first_name:'Migration' }));
  const dataCheckString = [...params.entries()]
    .sort(([left],[right]) => left.localeCompare(right))
    .map(([key,value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken);
  params.set('hash', bytesToHex(await hmacSha256(new Uint8Array(secretKey), dataCheckString)));
  return params.toString();
}

test('primary bot username cache is identity-aware across token A and token B', async () => {
  const tokenA = 'test-primary-token-A';
  const tokenB = 'test-primary-token-B';
  const keyA = await primaryTelegramBotIdentityCacheKey(tokenA);
  const keyB = await primaryTelegramBotIdentityCacheKey(tokenB);
  assert.notEqual(keyA, keyB);
  assert.match(keyA, /^telegram:bot-username:v2:[0-9a-f]{32}$/);
  assert.equal(keyA.includes(tokenA), false);
  assert.equal(keyB.includes(tokenB), false);

  const cache = new Map([['telegram:bot-username:v1',{username:'MANAGERPLAYER_BOT'}]]);
  let getMeCalls = 0;
  const resolve = (token, username, id) => resolvePrimaryTelegramBotUsername({
    botToken:token,
    getCached:async key => cache.get(key),
    setCached:async (key,payload) => cache.set(key,payload),
    getMe:async () => {
      getMeCalls += 1;
      return {id,username};
    },
  });

  assert.equal(await resolve(tokenA,'MANAGERPLAYER_BOT',101),'MANAGERPLAYER_BOT');
  assert.equal(await resolve(tokenB,'MatchRadarAIBot',202),'MatchRadarAIBot');
  assert.equal(getMeCalls,2);
  assert.equal(cache.get(keyA).username,'MANAGERPLAYER_BOT');
  assert.equal(cache.get(keyB).username,'MatchRadarAIBot');
  assert.equal(cache.get('telegram:bot-username:v1').username,'MANAGERPLAYER_BOT');
});

test('deep link follows the new primary identity and cannot reuse the legacy username cache', async () => {
  const cache = new Map([['telegram:bot-username:v1',{username:'MANAGERPLAYER_BOT'}]]);
  const username = await resolvePrimaryTelegramBotUsername({
    botToken:'test-primary-token-B',
    getCached:async key => cache.get(key),
    setCached:async (key,payload) => cache.set(key,payload),
    getMe:async () => ({id:202,username:'MatchRadarAIBot'}),
  });
  const link = telegramBotStartUrl(username,'fx12345__social__migration__test');
  assert.match(link,/^https:\/\/t\.me\/MatchRadarAIBot\?start=/);
  assert.equal(link.includes('MANAGERPLAYER_BOT'),false);
  assert.doesNotMatch(worker,/telegram:bot-username:v1/);
  assert.match(telegramLinks,/telegramBotStartUrl\(username,startParam\)/);
});

test('Telegram initData validation is bound to the current primary bot token', async () => {
  const tokenA = 'test-primary-token-A';
  const tokenB = 'test-primary-token-B';
  const initDataB = await signedInitData(tokenB);
  const valid = await validateTelegramInitData(initDataB,tokenB,3600);
  const invalidOld = await validateTelegramInitData(initDataB,tokenA,3600);
  assert.equal(valid?.id,24681012);
  assert.equal(invalidOld,null);
  assert.match(readContractSource(new URL('../src/auth-user.js',import.meta.url),'utf8'),/validateTelegramInitData\(initData, cfg\?\.botToken, initDataMaxAgeSeconds\)/);
});

test('publisher token stays independent from primary bot migration', async () => {
  const cfg = {
    botToken:'test-primary-token-B',
    publisherBotToken:'test-publisher-token',
    telegramChannelId:'@MatchRadarFootball',
  };
  assert.equal(channelPublisherState(cfg).enabled,true);
  let calledUrl = '';
  await sendMessage(cfg,{
    text:'Migration isolation test',
    ctaUrl:'https://t.me/MatchRadarAIBot?start=fx12345',
  },{
    fetchImpl:async url => {
      calledUrl=String(url);
      return new Response(JSON.stringify({ok:true,result:{message_id:77}}),{
        status:200,
        headers:{'content-type':'application/json'},
      });
    },
  });
  assert.match(calledUrl,/\/bottest-publisher-token\/sendMessage$/);
  assert.equal(calledUrl.includes(cfg.botToken),false);
  assert.match(readContractSource(new URL('../src/common-infrastructure-runtime.js', import.meta.url), 'utf8'),/publisherBotToken:\s*env\.TELEGRAM_PUBLISHER_BOT_TOKEN/);
});

test('user data remains keyed by Telegram user id, independent of bot username', () => {
  assert.match(readContractSource(new URL('../src/auth-user.js', import.meta.url), 'utf8'),/telegram_id:\s*userId/);
  assert.match(readContractSource(new URL('../src/auth-user.js', import.meta.url), 'utf8'),/supaUpsert\(cfg, 'users', record, 'telegram_id'\)/);
  assert.match(readContractSource(new URL('../src/auth-user.js',import.meta.url),'utf8'),/supaSelectOne\(cfg, 'users', \{ telegram_id: `eq\.\$\{normalizedUserId\}` \}\)/);
});

test('webhook, start attribution, reminders, billing and Mini App URL contracts stay on primary bot', () => {
  assert.match(bootstrap,/request\.method === 'POST' && url\.pathname === '\/telegram\/webhook'/);
  assert.match(billingApi,/expectedUrl:`\$\{new URL\(request\.url\)\.origin\}\/telegram\/webhook`/);
  assert.match(worker,/function telegramStartPayload\(\.\.\.args\)/);
  assert.match(authGrowthWiring,/ensureLaunchAttribution,/);
  assert.match(serviceWiring,/createReminderDeliveryService\(\{/);
  assert.match(serviceWiring,/sendTelegramMessage,/);
  assert.match(reminderDeliveryService,/async function processDueReminders\(cfg\)/);
  assert.match(reminderDeliveryService,/sendTelegramMessage\(positiveSafeInteger\(row\.telegram_id\), text, cfg\)/);
  assert.match(billingApi,/makeInvoicePayload\(user\.id, plan, cfg\.botToken\)/);
  assert.match(telegramLinks,/function telegramWebAppUrl\(request, params = \{\}\)/);
  assert.match(telegramLinks,/url\.pathname = '\/'/);
});

test('primary identity cache never logs or stores the raw bot token', () => {
  assert.doesNotMatch(identityModule,/console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(identityModule,/payload\s*=\s*\{[^}]*botToken/s);
  assert.match(identityModule,/crypto\.subtle\.digest\('SHA-256'/);
});

test('fixture share and channel publisher CTA use the current primary bot identity resolver', () => {
  assert.match(publisherRuntime,/fixtureTelegramDeepLink\(cfg,fixtureId,\{source,campaign,content,referralCode\}\)/);
  assert.match(publisherRuntime,/telegramShareComposerUrl\(link\.url/);
  assert.match(publisherRuntime,/fixtureTelegramDeepLink\(cfg,safeFixtureId,\{source:'social',campaign:'match_share',content:'telegram',referralCode\}\)/);
  assert.match(publisherRuntime,/fixtureTelegramDeepLink\(cfg,fixtureId,\{source:'channel',campaign:'publisher_mvp',content:'manual'\}\)/);
  assert.match(publisherRuntime,/cta:\{text:'Открыть матч в MatchRadar',url:link\.url\}/);
  assert.match(worker,/function apiFixtureShareLink\(\.\.\.args\) \{ return getPublisherRuntime\(\)\.apiFixtureShareLink/);
});

test('/api/me and admin identity remain keyed by Telegram user id after primary bot migration', () => {
  assert.match(router,/method === 'GET' && pathname === '\/api\/me'/);
  const apiMeStart=userDataApi.indexOf('async function apiMe');
  const apiMeEnd=userDataApi.indexOf('\n  async function apiHistory',apiMeStart);
  const apiMeBlock=userDataApi.slice(apiMeStart,apiMeEnd);
  assert.match(apiMeBlock,/const userId=positiveId\(user\?\.id\)/);
  assert.match(apiMeBlock,/getFavorites\(userId, cfg\)/);
  assert.match(apiMeBlock,/getReminders\(userId, cfg\)/);
  assert.match(apiMeBlock,/getPreferences\(userId, cfg\)/);
  assert.match(apiMeBlock,/const admin=isAdminUser\(user,cfg\) === true/);
  assert.match(accessControl,/cfg\.adminTelegramIds/);
  assert.match(accessControl,/telegramIdCandidate\(id\) === userId/);
});

test('disabled monetization remains fail-closed during primary bot migration', () => {
  assert.match(router,/if \(cfg\?\.monetizationEnabled !== true\) return json\(\{ error: 'Монетизация пока отключена\.' \}, 404\)/);
});



test('bot update deduplication is scoped to primary bot identity across token rotation',()=>{
  const first='12345:original_bot_secret';
  const rotated='12345:rotated_bot_secret';
  const other='67890:other_bot_secret';
  const update={update_id:5001};
  assert.equal(primaryTelegramUpdateDedupeKey(first,update),'b:id-12345:u:5001');
  assert.equal(primaryTelegramUpdateDedupeKey(rotated,update),primaryTelegramUpdateDedupeKey(first,update));
  assert.notEqual(primaryTelegramUpdateDedupeKey(other,update),primaryTelegramUpdateDedupeKey(first,update));
  assert.equal(primaryTelegramUpdateDedupeKey(first,{update_id:true}),'');
  assert.equal(primaryTelegramUpdateDedupeKey(first,{callback_query:{id:'callback-1'}}),'b:id-12345:c:callback-1');
});

test('a token-specific cache entry with the wrong bot ID must be refreshed',async()=>{
  const token='12345:primary_bot_secret';
  const key=await primaryTelegramBotIdentityCacheKey(token);
  const cache=new Map([[key,{username:'WrongLegacyBot',botId:67890}]]);
  let calls=0;
  const actual=await resolvePrimaryTelegramBotUsername({
    botToken:token,
    getCached:async k=>cache.get(k),
    setCached:async(k,v)=>cache.set(k,v),
    getMe:async()=>{calls++;return {id:12345,username:'MatchRadarPrimaryBot',is_bot:true};},
  });
  assert.equal(actual,'MatchRadarPrimaryBot');
  assert.equal(calls,1);
  assert.equal(cache.get(key).botId,12345);
  assert.equal(JSON.stringify([...cache.values()]).includes(token),false);
});

test('primary bot migration refuses a mismatched getMe identity without storing it',async()=>{
  const token='12345:primary_bot_secret';
  let writes=0;
  await assert.rejects(
    resolvePrimaryTelegramBotUsername({
      botToken:token,
      getCached:async()=>null,
      setCached:async()=>{writes++;},
      getMe:async()=>({id:67890,username:'LegacyPublisherBot',is_bot:true}),
    }),
    /does not match TELEGRAM_BOT_TOKEN/,
  );
  assert.equal(writes,0);
  await assert.rejects(
    resolvePrimaryTelegramBotUsername({
      botToken:token,
      getMe:async()=>({id:12345,username:'NotABot',is_bot:false}),
    }),
    /is not a bot/,
  );
});

test('primary bot deep links reject injection and require a safe Telegram start parameter',()=>{
  assert.equal(telegramBotStartUrl('MatchRadarPrimaryBot','fx12345__social'),
    'https://t.me/MatchRadarPrimaryBot?start=fx12345__social');
  for(const startParam of ['', 'a&evil=1','a?jump=true','bad value','<script>','a'.repeat(65)]){
    assert.throws(()=>telegramBotStartUrl('MatchRadarPrimaryBot',startParam),/start parameter is invalid/);
  }
  for(const username of ['a','bot?x=1','bot/@other',true]){
    assert.throws(()=>telegramBotStartUrl(username,'fx12345'),/username is invalid/);
  }
});
