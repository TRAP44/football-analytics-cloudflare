import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVELOPMENT_TELEGRAM_ID,
  isAdminUser,
  telegramIdList,
} from '../src/access-control.js';

test('real Telegram users are not elevated by DEV_MODE', () => {
  assert.equal(isAdminUser({ id: 5195504559 }, { devMode: true, adminTelegramIds: [] }), false);
});

test('only the marked synthetic development identity receives dev admin access', () => {
  assert.equal(isAdminUser(
    { id: DEVELOPMENT_TELEGRAM_ID, __developmentIdentity: true },
    { devMode: true, adminTelegramIds: [] },
  ), true);
  assert.equal(isAdminUser(
    { id: DEVELOPMENT_TELEGRAM_ID },
    { devMode: true, adminTelegramIds: [] },
  ), false);
});

test('production admin access requires an exact allowlist match', () => {
  const cfg = { devMode: false, adminTelegramIds: telegramIdList('1813351866, 42') };
  assert.equal(isAdminUser({ id: 1813351866 }, cfg), true);
  assert.equal(isAdminUser({ id: 5195504559 }, cfg), false);
});

test('billing plan never grants administrative access', () => {
  assert.equal(isAdminUser({ id: 77, plan: 'PREMIUM' }, { devMode: false, adminTelegramIds: [] }), false);
});
