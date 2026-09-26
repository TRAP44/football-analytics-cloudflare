import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  primaryTelegramBotIdentityCacheKey,
  resolvePrimaryTelegramBotUsername,
  telegramBotStartUrl,
} from '../src/telegram-primary-identity.js';
import { bytesToHex, hmacSha256, validateTelegramInitData } from '../src/crypto-utils.js';
import { channelPublisherState, sendMessage } from '../src/channel-publisher.js';

const worker = fs.readFileSync('src/worker.js','utf8');
const identityModule = fs.readFileSync('src/telegram-primary-identity.js','utf8');

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

  assert.equal(await resolve(tokenA,'PrimaryBot_A',101),'PrimaryBot_A');
  assert.equal(await resolve(tokenB,'MatchRadarAI_B',202),'MatchRadarAI_B');
  assert.equal(getMeCalls,2);
  assert.equal(cache.get(keyA).username,'PrimaryBot_A');
  assert.equal(cache.get(keyB).username,'MatchRadarAI_B');
  assert.equal(cache.get('telegram:bot-username:v1').username,'MANAGERPLAYER_BOT');
});

test('deep link follows the new primary identity and cannot reuse the legacy username cache', async () => {
  const cache = new Map([['telegram:bot-username:v1',{username:'MANAGERPLAYER_BOT'}]]);
  const username = await resolvePrimaryTelegramBotUsername({
    botToken:'test-primary-token-B',
    getCached:async key => cache.get(key),
    setCached:async (key,payload) => cache.set(key,payload),
    getMe:async () => ({id:202,username:'MatchRadarAI_B'}),
  });
  const link = telegramBotStartUrl(username,'fx12345__social__migration__test');
  assert.match(link,/^https:\/\/t\.me\/MatchRadarAI_B\?start=/);
  assert.equal(link.includes('MANAGERPLAYER_BOT'),false);
  assert.doesNotMatch(worker,/telegram:bot-username:v1/);
  assert.match(worker,/telegramBotStartUrl\(username,startParam\)/);
});

test('Telegram initData validation is bound to the current primary bot token', async () => {
  const tokenA = 'test-primary-token-A';
  const tokenB = 'test-primary-token-B';
  const initDataB = await signedInitData(tokenB);
  const valid = await validateTelegramInitData(initDataB,tokenB,3600);
  const invalidOld = await validateTelegramInitData(initDataB,tokenA,3600);
  assert.equal(valid?.id,24681012);
  assert.equal(invalidOld,null);
  assert.match(worker,/validateTelegramInitData\(initData, cfg\.botToken, initDataMaxAgeSeconds\)/);
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
    ctaUrl:'https://t.me/MatchRadarAI_B?start=fx12345',
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
  assert.match(worker,/publisherBotToken:\s*env\.TELEGRAM_PUBLISHER_BOT_TOKEN/);
});

test('user data remains keyed by Telegram user id, independent of bot username', () => {
  assert.match(worker,/telegram_id:\s*userId/);
  assert.match(worker,/supaUpsert\(cfg, 'users', record, 'telegram_id'\)/);
  assert.match(worker,/supaSelectOne\(cfg, 'users', \{ telegram_id: `eq\.\$\{Number\(userId\)\}` \}\)/);
});

test('webhook, start attribution, reminders, billing and Mini App URL contracts stay on primary bot', () => {
  assert.match(worker,/request\.method === 'POST' && url\.pathname === '\/telegram\/webhook'/);
  assert.match(worker,/const expectedUrl = `\$\{new URL\(request\.url\)\.origin\}\/telegram\/webhook`/);
  assert.match(worker,/function telegramStartPayload\(/);
  assert.match(worker,/async function ensureLaunchAttribution\(userId, rawStartParam, cfg\)/);
  assert.match(worker,/async function processDueReminders\(cfg\)/);
  assert.match(worker,/sendTelegramMessage\(row\.telegram_id, text, cfg\)/);
  assert.match(worker,/makeInvoicePayload\(user\.id, plan, cfg\.botToken\)/);
  assert.match(worker,/function telegramWebAppUrl\(request, params = \{\}\)/);
  assert.match(worker,/url\.pathname = '\/'/);
});

test('primary identity cache never logs or stores the raw bot token', () => {
  assert.doesNotMatch(identityModule,/console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(identityModule,/payload\s*=\s*\{[^}]*botToken/s);
  assert.match(identityModule,/crypto\.subtle\.digest\('SHA-256'/);
});
