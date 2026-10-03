import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesToHex,
  constantTimeEqual,
  hmacSha256,
  validateTelegramInitData,
  TELEGRAM_AUTH_FUTURE_SKEW_SECONDS,
} from '../src/crypto-utils.js';

const encoder = new TextEncoder();

async function telegramInitData({ token = '123456:TEST_TOKEN', user = { id: 42, first_name: 'Test' }, authDate = Math.floor(Date.now() / 1000) } = {}) {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAEAAAE');
  params.set('user', JSON.stringify(user));
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = await hmacSha256(encoder.encode('WebAppData'), token);
  const hash = bytesToHex(await hmacSha256(new Uint8Array(secret), dataCheckString));
  params.set('hash', hash);
  return params.toString();
}

test('constantTimeEqual preserves strict equality semantics', () => {
  assert.equal(constantTimeEqual('abc123', 'abc123'), true);
  assert.equal(constantTimeEqual('abc123', 'abc124'), false);
  assert.equal(constantTimeEqual('short', 'longer'), false);
});

test('validateTelegramInitData accepts a valid signed Telegram payload', async () => {
  const token = '123456:TEST_TOKEN';
  const initData = await telegramInitData({ token });
  const user = await validateTelegramInitData(initData, token, 3600);
  assert.equal(user.id, 42);
  assert.equal(user.first_name, 'Test');
});

test('validateTelegramInitData rejects tampering and stale payloads', async () => {
  const token = '123456:TEST_TOKEN';
  const valid = await telegramInitData({ token });
  const tampered = new URLSearchParams(valid);
  tampered.set('user', JSON.stringify({ id: 99 }));
  assert.equal(await validateTelegramInitData(tampered.toString(), token, 3600), null);

  const stale = await telegramInitData({ token, authDate: Math.floor(Date.now() / 1000) - 7200 });
  assert.equal(await validateTelegramInitData(stale, token, 3600), null);
});


test('validateTelegramInitData accepts only the explicit small future clock skew', async () => {
  const token='123456:TEST_TOKEN';
  const now=Math.floor(Date.now()/1000);
  const within=await telegramInitData({
    token,
    authDate:now+Math.max(1,TELEGRAM_AUTH_FUTURE_SKEW_SECONDS-1),
  });
  assert.equal((await validateTelegramInitData(within,token,3600))?.id,42);

  const beyond=await telegramInitData({
    token,
    authDate:now+TELEGRAM_AUTH_FUTURE_SKEW_SECONDS+1,
  });
  assert.equal(await validateTelegramInitData(beyond,token,3600),null);
});

test('validateTelegramInitData enforces directional freshness at the configured boundary', async () => {
  const token='123456:TEST_TOKEN';
  const now=Math.floor(Date.now()/1000);
  const inside=await telegramInitData({token,authDate:now-59});
  const outside=await telegramInitData({token,authDate:now-61});
  assert.equal((await validateTelegramInitData(inside,token,60))?.id,42);
  assert.equal(await validateTelegramInitData(outside,token,60),null);
});

test('constantTimeEqual compares unequal-length inputs without changing equality semantics', () => {
  assert.equal(constantTimeEqual('a'.repeat(64),'a'.repeat(63)),false);
  assert.equal(constantTimeEqual('a'.repeat(64),'a'.repeat(64)),true);
  assert.equal(constantTimeEqual('a'.repeat(63)+'b','a'.repeat(64)),false);
});
