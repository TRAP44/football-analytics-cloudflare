import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesToHex,
  constantTimeEqual,
  hmacSha256,
  validateTelegramInitData,
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
