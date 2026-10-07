import test from 'node:test';
import assert from 'node:assert/strict';

import {
  primaryTelegramBotIdentityCacheKey,
  primaryTelegramBotStableIdentity,
  primaryTelegramUpdateDedupeKey,
  resolvePrimaryTelegramBotUsername,
  telegramBotStartUrl,
} from '../src/telegram-primary-identity.js';

const TOKEN='111111111:test-secret';

test('Telegram primary identity rejects malformed resolver option bags', async () => {
  await assert.rejects(
    () => resolvePrimaryTelegramBotUsername(null),
    /options are required/,
  );
  await assert.rejects(
    () => resolvePrimaryTelegramBotUsername([]),
    /options are required/,
  );
  await assert.rejects(
    () => resolvePrimaryTelegramBotUsername({botToken:TOKEN}),
    /getMe resolver is required/,
  );
});

test('Telegram primary identity bounds bot token input before cache or network work', async () => {
  let cacheReads=0;
  let getMeCalls=0;
  const oversized='x'.repeat(513);

  await assert.rejects(
    () => primaryTelegramBotIdentityCacheKey(oversized),
    /TELEGRAM_BOT_TOKEN is required/,
  );
  await assert.rejects(
    () => resolvePrimaryTelegramBotUsername({
      botToken:oversized,
      getCached:async () => { cacheReads += 1; return null; },
      getMe:async () => { getMeCalls += 1; return {id:1,username:'WrongBot'}; },
    }),
    /TELEGRAM_BOT_TOKEN is required/,
  );

  assert.equal(cacheReads,0);
  assert.equal(getMeCalls,0);
});

test('Telegram primary identity validates stable token structure without exposing the secret', () => {
  assert.equal(primaryTelegramBotStableIdentity(TOKEN),'id-111111111');
  assert.equal(primaryTelegramBotStableIdentity('111111111:test secret'),'');
  assert.equal(primaryTelegramBotStableIdentity('111111111:test:secret'),'');
  assert.equal(primaryTelegramBotStableIdentity('1111:test-secret'),'');
  assert.equal(primaryTelegramBotStableIdentity('111111111:'),'');
  assert.equal(primaryTelegramBotStableIdentity('111111111:\u0000secret'),'');
});

test('Telegram username cache is accepted only when its bot id matches a structured token', async () => {
  const key=await primaryTelegramBotIdentityCacheKey(TOKEN);
  let getMeCalls=0;

  const cached=await resolvePrimaryTelegramBotUsername({
    botToken:TOKEN,
    getCached:async cacheKey => {
      assert.equal(cacheKey,key);
      return {username:'MatchRadarAIBot',botId:111111111};
    },
    getMe:async () => {
      getMeCalls += 1;
      return {id:111111111,username:'UnexpectedBot'};
    },
  });
  assert.equal(cached,'MatchRadarAIBot');
  assert.equal(getMeCalls,0);

  const refreshed=await resolvePrimaryTelegramBotUsername({
    botToken:TOKEN,
    getCached:async () => ({username:'OtherValidBot',botId:222222222}),
    getMe:async () => {
      getMeCalls += 1;
      return {id:111111111,username:'MatchRadarAIBot'};
    },
  });
  assert.equal(refreshed,'MatchRadarAIBot');
  assert.equal(getMeCalls,1);
});

test('Telegram getMe identity mismatch fails closed and is never cached', async () => {
  let writes=0;
  await assert.rejects(
    () => resolvePrimaryTelegramBotUsername({
      botToken:TOKEN,
      getCached:async () => null,
      setCached:async () => { writes += 1; },
      getMe:async () => ({id:222222222,username:'MatchRadarAIBot'}),
    }),
    /does not match TELEGRAM_BOT_TOKEN/,
  );
  assert.equal(writes,0);
});

test('Telegram primary identity tolerates cache failures but validates getMe payload', async () => {
  let writes=0;
  const username=await resolvePrimaryTelegramBotUsername({
    botToken:TOKEN,
    getCached:async () => { throw new Error('cache offline'); },
    setCached:async (_key,payload,ttl) => {
      writes += 1;
      assert.equal(payload.botId,111111111);
      assert.equal(payload.username,'MatchRadarAIBot');
      assert.equal(ttl,10080);
    },
    getMe:async () => ({id:111111111,username:'MatchRadarAIBot'}),
    ttlMinutes:999999,
  });
  assert.equal(username,'MatchRadarAIBot');
  assert.equal(writes,1);

  await assert.rejects(
    () => resolvePrimaryTelegramBotUsername({
      botToken:TOKEN,
      getMe:async () => [],
    }),
    /username is unavailable/,
  );
  await assert.rejects(
    () => resolvePrimaryTelegramBotUsername({
      botToken:TOKEN,
      getMe:async () => ({id:111111111,username:'MatchRadarAIBot',is_bot:false}),
    }),
    /identity is not a bot/,
  );
});

test('Telegram update dedupe identity rejects malformed update containers and oversized fallback ids', () => {
  assert.equal(primaryTelegramUpdateDedupeKey(TOKEN,null),'');
  assert.equal(primaryTelegramUpdateDedupeKey(TOKEN,[]),'');
  assert.equal(
    primaryTelegramUpdateDedupeKey(TOKEN,{callback_query:{id:'x'.repeat(121)}}),
    '',
  );
  assert.equal(
    primaryTelegramUpdateDedupeKey(TOKEN,{update_id:'9'.repeat(25)}),
    '',
  );
  assert.equal(
    primaryTelegramUpdateDedupeKey(TOKEN,{message:{chat:{id:'9'.repeat(25)},message_id:1}}),
    '',
  );
});

test('Telegram bot start URL bounds and validates both username and start payload', () => {
  assert.equal(
    telegramBotStartUrl('@MatchRadarAIBot','  fx12345__social  '),
    'https://t.me/MatchRadarAIBot?start=fx12345__social',
  );

  for (const [username,start] of [
    ['x'.repeat(65),'valid'],
    ['bad-name','valid'],
    ['MatchRadarAIBot','x'.repeat(129)],
    ['MatchRadarAIBot','bad value'],
    ['MatchRadarAIBot',''],
  ]) {
    assert.throws(
      () => telegramBotStartUrl(username,start),
      /Telegram (?:bot username|start parameter) is invalid/,
    );
  }
});
