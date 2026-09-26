import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVELOPMENT_TELEGRAM_ID,
  closedBetaAccessDecision,
  isAdminUser,
  isClosedBetaUser,
  isTelegramValidatedUser,
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


test('closed beta membership requires a signed Telegram identity and exact beta allowlist match', () => {
  const cfg = {
    devMode: false,
    adminTelegramIds: [9001],
    betaTelegramIds: [101, 202],
    betaAccessEnabled: true,
  };
  assert.equal(isTelegramValidatedUser({ id: 101 }), false);
  assert.equal(isClosedBetaUser({ id: 101 }, cfg), false);
  assert.equal(isClosedBetaUser({ id: 101, __telegramValidated: true }, cfg), true);
  assert.equal(isClosedBetaUser({ id: 303, __telegramValidated: true }, cfg), false);
  assert.equal(isClosedBetaUser({ id: 9001, __telegramValidated: true }, cfg), false);
});

test('strict beta access is fail-closed for normal users and keeps admin bypass outside beta metrics', () => {
  const cfg = {
    devMode: false,
    adminTelegramIds: [9001],
    betaTelegramIds: [101, 202],
    betaAccessEnabled: true,
  };
  assert.deepEqual(
    closedBetaAccessDecision({ id: 101, __telegramValidated: true }, cfg),
    { allowed: true, adminBypass: false, betaParticipant: true },
  );
  assert.deepEqual(
    closedBetaAccessDecision({ id: 303, __telegramValidated: true }, cfg),
    { allowed: false, adminBypass: false, betaParticipant: false },
  );
  assert.deepEqual(
    closedBetaAccessDecision({ id: 9001, __telegramValidated: true }, cfg),
    { allowed: true, adminBypass: true, betaParticipant: false },
  );
});

test('legacy false or missing beta flag never opens normal-user routes', () => {
  const falseCfg = {
    devMode: false,
    adminTelegramIds: [],
    betaTelegramIds: [101],
    betaAccessEnabled: false,
  };
  const missingCfg = {
    devMode: false,
    adminTelegramIds: [],
    betaTelegramIds: [101],
  };

  assert.deepEqual(
    closedBetaAccessDecision({ id: 303, __telegramValidated: true }, falseCfg),
    { allowed: false, adminBypass: false, betaParticipant: false },
  );
  assert.deepEqual(
    closedBetaAccessDecision({ id: 303, __telegramValidated: true }, missingCfg),
    { allowed: false, adminBypass: false, betaParticipant: false },
  );
  assert.deepEqual(
    closedBetaAccessDecision({ id: 101, __telegramValidated: true }, falseCfg),
    { allowed: true, adminBypass: false, betaParticipant: true },
  );
  assert.equal(closedBetaAccessDecision({ id: 101 }, missingCfg).allowed, false);
});
