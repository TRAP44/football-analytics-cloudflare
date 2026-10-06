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

const validatedUser = id => ({ id, __telegramValidated: true });

test('telegramIdList parses supported separators and rejects invalid Telegram IDs', () => {
  assert.deepEqual(
    telegramIdList('1813351866, 42; 101\n202 invalid -5 0 3.14'),
    [1813351866, 42, 101, 202],
  );
  assert.deepEqual(telegramIdList(null), []);
});

test('real Telegram users are not elevated by DEV_MODE', () => {
  assert.equal(isAdminUser({ id: 5195504559 }, { devMode: true, adminTelegramIds: [] }), false);
});

test('only the marked synthetic development identity receives dev admin access', () => {
  assert.equal(
    isAdminUser(
      { id: DEVELOPMENT_TELEGRAM_ID, __developmentIdentity: true },
      { devMode: true, adminTelegramIds: [] },
    ),
    true,
  );
  assert.equal(
    isAdminUser(
      { id: DEVELOPMENT_TELEGRAM_ID },
      { devMode: true, adminTelegramIds: [] },
    ),
    false,
  );
});

test('production admin access requires an exact allowlist match', () => {
  const cfg = {
    devMode: false,
    adminTelegramIds: telegramIdList('1813351866, 42'),
  };

  assert.equal(isAdminUser({ id: 1813351866 }, cfg), true);
  assert.equal(isAdminUser({ id: 5195504559 }, cfg), false);
});

test('access control fails safely for malformed config values', () => {
  assert.equal(
    isAdminUser(
      { id: DEVELOPMENT_TELEGRAM_ID, __developmentIdentity: true },
      { devMode: 'false', adminTelegramIds: null },
    ),
    false,
  );
  assert.equal(
    isClosedBetaUser(
      validatedUser(101),
      { betaTelegramIds: '101' },
    ),
    false,
  );
  assert.deepEqual(
    closedBetaAccessDecision(
      validatedUser(303),
      { betaAccessEnabled: 'true', betaTelegramIds: [101] },
    ),
    { allowed: true, adminBypass: false, betaParticipant: false },
  );
});

test('billing plan never grants administrative access', () => {
  assert.equal(
    isAdminUser(
      { id: 77, plan: 'PREMIUM' },
      { devMode: false, adminTelegramIds: [] },
    ),
    false,
  );
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
  assert.equal(isClosedBetaUser(validatedUser(101), cfg), true);
  assert.equal(isClosedBetaUser(validatedUser(303), cfg), false);
  assert.equal(isClosedBetaUser(validatedUser(9001), cfg), false);
});

test('strict beta is fail-closed for normal users and keeps admin bypass outside beta metrics', () => {
  const cfg = {
    devMode: false,
    adminTelegramIds: [9001],
    betaTelegramIds: [101, 202],
    betaAccessEnabled: true,
  };

  assert.deepEqual(
    closedBetaAccessDecision(validatedUser(101), cfg),
    { allowed: true, adminBypass: false, betaParticipant: true },
  );
  assert.deepEqual(
    closedBetaAccessDecision(validatedUser(303), cfg),
    { allowed: false, adminBypass: false, betaParticipant: false },
  );
  assert.deepEqual(
    closedBetaAccessDecision(validatedUser(9001), cfg),
    { allowed: true, adminBypass: true, betaParticipant: false },
  );
});

test('public mode allows signed Telegram users while preserving beta membership metadata', () => {
  const publicCfg = {
    devMode: false,
    adminTelegramIds: [],
    betaTelegramIds: [101],
    betaAccessEnabled: false,
  };
  const defaultCfg = {
    devMode: false,
    adminTelegramIds: [],
    betaTelegramIds: [101],
  };

  assert.deepEqual(
    closedBetaAccessDecision(validatedUser(303), publicCfg),
    { allowed: true, adminBypass: false, betaParticipant: false },
  );
  assert.deepEqual(
    closedBetaAccessDecision(validatedUser(303), defaultCfg),
    { allowed: true, adminBypass: false, betaParticipant: false },
  );
  assert.deepEqual(
    closedBetaAccessDecision(validatedUser(101), publicCfg),
    { allowed: true, adminBypass: false, betaParticipant: true },
  );
  assert.deepEqual(
    closedBetaAccessDecision({ id: 101 }, defaultCfg),
    { allowed: false, adminBypass: false, betaParticipant: false },
  );
});
