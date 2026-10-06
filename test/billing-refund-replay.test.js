import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillingRuntime } from '../src/billing-runtime.js';
import { createBillingApiRuntime } from '../src/billing-api-runtime.js';

const BILLING_PLANS = Object.freeze({
  FREE: { stars: 0, dailyLimit: 3, title: 'FREE', description: 'Free' },
  PRO: { stars: 100, dailyLimit: 20, title: 'PRO', description: 'Pro plan' },
  PREMIUM: { stars: 250, dailyLimit: 60, title: 'PREMIUM', description: 'Premium plan' },
});

const SUBSCRIPTION_PERIOD_SECONDS = 30 * 24 * 60 * 60;

function responseJson(body, status = 200) {
  return { body, status };
}

function hex(bytes) {
  return [...bytes].map(value => Number(value).toString(16).padStart(2, '0')).join('');
}

function baseBillingHarness(overrides = {}) {
  const memory = overrides.memory || {
    users: new Map(),
    billingPayments: new Map(),
  };
  const ops = [];
  const referred = [];
  let passActivations = 0;

  const deps = {
    BILLING_PLANS,
    STAR_SYNC_MAX_PAGES: 5,
    STAR_SYNC_PAGE_SIZE: 100,
    SUBSCRIPTION_PERIOD_SECONDS,
    activatePassPurchase: async () => {
      passActivations += 1;
      return { activated: true, duplicate: false };
    },
    bytesToHex: hex,
    constantTimeEqual: (a, b) => String(a) === String(b),
    enc: new TextEncoder(),
    fetchWithTimeout: async () => {
      throw new Error('Unexpected Telegram request');
    },
    getQuota: async userId => ({ plan: memory.users.get(Number(userId))?.plan || 'FREE' }),
    getUserRecord: async userId => memory.users.get(Number(userId)) || null,
    hasSupabase: () => false,
    hmacSha256: async () => new Uint8Array(32).fill(0xab),
    listUserEntitlements: async () => [],
    markTelegramWebhookEffect: () => {},
    markTelegramWebhookMutation: () => {},
    memory,
    parsePassInvoicePayload: async () => null,
    passProductConfig: type => type === 'MATCH_PASS'
      ? { key: 'MATCH_PASS', stars: 50, saleReady: true }
      : null,
    recordOpsEvent: async (_cfg, event) => { ops.push(event); },
    recordReferredPayment: async (...args) => { referred.push(args); return true; },
    refundPassByCharge: async () => ({ updated: false }),
    supaPatch: async () => {},
    supaSelectOne: async () => null,
    supaUpsert: async () => {},
    ...overrides,
    memory,
  };

  const runtime = createBillingRuntime(deps);
  return {
    runtime,
    memory,
    ops,
    referred,
    passActivationCount: () => passActivations,
  };
}

function telegramHistoryFetch(pages) {
  const calls = [];
  const fetchWithTimeout = async (url, options) => {
    assert.match(String(url), /\/getStarTransactions$/);
    const body = JSON.parse(options.body || '{}');
    calls.push(body);
    const page = Math.floor(Number(body.offset || 0) / Number(body.limit || 100));
    const transactions = pages[page] || [];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true, result: { transactions } }),
    };
  };
  return { fetchWithTimeout, calls };
}

function apiHarness(overrides = {}) {
  const memory = overrides.memory || {
    billingPayments: new Map(),
  };
  const telegramCalls = [];
  const reconcileCalls = [];
  const ops = [];

  const noopLinks = () => ({
    telegramWebAppUrl: () => '',
    telegramAnalysisHandoffParams: () => ({}),
    telegramFullAnalysisUrl: () => '',
    oneTapHandoffDrill: () => ({}),
    fixtureShareStartParam: () => '',
    campaignStartParam: () => '',
    telegramBotUsername: () => '',
    fixtureTelegramDeepLink: () => '',
    telegramCampaignDeepLink: () => '',
    telegramShareComposerUrl: () => '',
  });

  const deps = {
    CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES: 30,
    PASS_TYPES: {
      MATCH: 'MATCH_PASS',
      DAY: 'DAY_PASS',
      WEEKEND: 'WEEKEND_PASS',
    },
    SUBSCRIPTION_PERIOD_SECONDS,
    adminForbidden: () => responseJson({ error: 'forbidden' }, 403),
    applyRefundedPayment: async (userId, chargeId) => {
      reconcileCalls.push({ userId, chargeId });
      return { updated: true, subscriptionRevoked: true, passRevoked: false };
    },
    billingPlanConfig: plan => BILLING_PLANS[plan] || null,
    billingWebhookStatus: async () => ({ ready: true }),
    createPassInvoicePayload: async () => 'pass-payload',
    createSharedCacheRuntime: () => ({
      getCacheEntry: async () => null,
      getCache: async () => null,
      getStaleCache: async () => null,
      setCache: async () => {},
    }),
    createTelegramLinksRuntime: noopLinks,
    findRefundableBillingCharge: async () => ({
      kind: 'subscription',
      status: 'paid',
      plan: 'PRO',
    }),
    getQuota: async () => ({ plan: 'FREE' }),
    getUserRecord: async () => null,
    hasSupabase: () => false,
    isAdminUser: () => true,
    json: responseJson,
    listUserEntitlements: async () => [],
    makeInvoicePayload: async () => 'subscription-payload',
    memory,
    passProductConfig: () => ({ stars: 50, saleReady: true }),
    recordOpsEvent: async (_cfg, event) => { ops.push(event); },
    resolveUserEntitlements: async () => ({
      store: { available: true },
      subscriptionActive: false,
    }),
    supaSelectMany: async () => [],
    syncBillingFromStars: async () => ({ synced: false }),
    telegramApi: async (method, _cfg, body) => {
      telegramCalls.push({ method, body });
      return true;
    },
    updateUserSubscription: async () => {},
    ...overrides,
    memory,
  };

  return {
    runtime: createBillingApiRuntime(deps),
    memory,
    telegramCalls,
    reconcileCalls,
    ops,
  };
}

function request(body, {
  method = 'POST',
  url = 'https://example.test/api/admin/billing/refund',
} = {}) {
  return {
    method,
    url,
    json: async () => body,
  };
}

test('subscription invoice signatures work after billing runtime extraction', async () => {
  const { runtime } = baseBillingHarness();
  const payload = await runtime.makeInvoicePayload(12345, 'PRO', 'bot-token');
  const parsed = await runtime.parseInvoicePayload(payload, 'bot-token');

  assert.equal(parsed.userId, 12345);
  assert.equal(parsed.plan, 'PRO');
  assert.match(parsed.nonce, /^[0-9a-f]{12}$/);
});

test('refunded Stars charges are rejected before subscription or Pass activation', async () => {
  const userId = 101;
  const chargeId = 'charge-refunded-1';
  const memory = {
    users: new Map(),
    billingPayments: new Map([
      [chargeId, {
        telegram_payment_charge_id: chargeId,
        telegram_id: userId,
        plan: 'PRO',
        status: 'refunded',
      }],
    ]),
  };
  let passParserCalls = 0;
  const { runtime, ops, passActivationCount } = baseBillingHarness({
    memory,
    parsePassInvoicePayload: async () => {
      passParserCalls += 1;
      return { userId, passType: 'MATCH_PASS', fixtureId: 55 };
    },
  });
  const invoicePayload = await runtime.makeInvoicePayload(userId, 'PRO', 'bot-token');

  const applied = await runtime.applySuccessfulPayment(userId, {
    currency: 'XTR',
    total_amount: BILLING_PLANS.PRO.stars,
    invoice_payload: invoicePayload,
    telegram_payment_charge_id: chargeId,
  }, {
    botToken: 'bot-token',
    starsPrices: { PRO: BILLING_PLANS.PRO.stars },
    limits: { PRO: BILLING_PLANS.PRO.dailyLimit },
  });

  assert.equal(applied, false);
  assert.equal(memory.users.has(userId), false);
  assert.equal(passParserCalls, 0);
  assert.equal(passActivationCount(), 0);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].code, 'BILLING_REFUNDED_CHARGE_REPLAY_BLOCKED');
});

test('payment activation fails closed when refunded-charge storage lookup is unavailable', async () => {
  const { runtime, passActivationCount } = baseBillingHarness({
    hasSupabase: () => true,
    supaSelectOne: async () => {
      throw new Error('billing storage unavailable');
    },
    listUserEntitlements: async () => {
      throw new Error('entitlement storage unavailable');
    },
  });
  const payload = await runtime.makeInvoicePayload(202, 'PRO', 'bot-token');

  await assert.rejects(
    () => runtime.applySuccessfulPayment(202, {
      currency: 'XTR',
      total_amount: BILLING_PLANS.PRO.stars,
      invoice_payload: payload,
      telegram_payment_charge_id: 'unknown-charge',
    }, {
      botToken: 'bot-token',
      starsPrices: { PRO: BILLING_PLANS.PRO.stars },
      limits: { PRO: BILLING_PLANS.PRO.dailyLimit },
    }),
    /billing storage unavailable/,
  );

  assert.equal(passActivationCount(), 0);
});

test('Stars history pagination scans multiple pages and reports truncation accurately', async () => {
  const page100 = Array.from({ length: 100 }, (_, index) => ({ id: `p1-${index}` }));
  const page100b = Array.from({ length: 100 }, (_, index) => ({ id: `p2-${index}` }));
  const page5 = Array.from({ length: 5 }, (_, index) => ({ id: `p3-${index}` }));
  const paged = telegramHistoryFetch([page100, page100b, page5]);
  const { runtime } = baseBillingHarness({ fetchWithTimeout: paged.fetchWithTimeout });

  const history = await runtime.loadStarTransactionsForSync({ botToken: 'bot-token' });

  assert.equal(history.transactions.length, 205);
  assert.equal(history.pagesScanned, 3);
  assert.equal(history.truncated, false);
  assert.deepEqual(paged.calls, [
    { offset: 0, limit: 100 },
    { offset: 100, limit: 100 },
    { offset: 200, limit: 100 },
  ]);

  const fullPages = telegramHistoryFetch(
    Array.from({ length: 5 }, (_, page) =>
      Array.from({ length: 100 }, (_, index) => ({ id: `${page}-${index}` }))
    ),
  );
  const truncatedRuntime = baseBillingHarness({ fetchWithTimeout: fullPages.fetchWithTimeout }).runtime;
  const truncated = await truncatedRuntime.loadStarTransactionsForSync({ botToken: 'bot-token' });
  assert.equal(truncated.transactions.length, 500);
  assert.equal(truncated.pagesScanned, 5);
  assert.equal(truncated.truncated, true);
});

test('Stars sync reconciles refunds before replaying an older matching purchase', async () => {
  const userId = 303;
  const chargeId = 'pass-charge-refunded';
  const history = telegramHistoryFetch([[
    {
      id: chargeId,
      amount: 50,
      date: Math.floor(Date.now() / 1000),
      receiver: {
        type: 'user',
        transaction_type: 'invoice_payment',
        user: { id: userId },
      },
    },
    {
      id: chargeId,
      amount: 50,
      date: Math.floor(Date.now() / 1000) - 60,
      source: {
        type: 'user',
        transaction_type: 'invoice_payment',
        user: { id: userId },
        invoice_payload: 'pass-good',
      },
    },
  ]]);

  let passParserCalls = 0;
  let refundCalls = 0;
  const { runtime, passActivationCount } = baseBillingHarness({
    fetchWithTimeout: history.fetchWithTimeout,
    parsePassInvoicePayload: async payload => {
      passParserCalls += 1;
      return payload === 'pass-good'
        ? { userId, passType: 'MATCH_PASS', fixtureId: 77 }
        : null;
    },
    refundPassByCharge: async () => {
      refundCalls += 1;
      return { updated: true };
    },
    getQuota: async () => ({ plan: 'FREE', left: 3 }),
  });

  const result = await runtime.syncBillingFromStars(userId, { botToken: 'bot-token' });

  assert.equal(result.synced, true);
  assert.equal(result.refundsReconciled, 1);
  assert.equal(result.passVerified, 0);
  assert.equal(refundCalls, 1);
  assert.equal(passParserCalls, 0);
  assert.equal(passActivationCount(), 0);
});

test('Stars sync can restore both valid Pass and active subscription history through guarded payment application', async () => {
  const userId = 404;
  const now = Math.floor(Date.now() / 1000);
  const pages = [[]];
  const history = telegramHistoryFetch(pages);
  let passActivations = 0;

  const harness = baseBillingHarness({
    fetchWithTimeout: history.fetchWithTimeout,
    parsePassInvoicePayload: async payload => payload === 'pass-good'
      ? { userId, passType: 'MATCH_PASS', fixtureId: 88 }
      : null,
    activatePassPurchase: async () => {
      passActivations += 1;
      return { activated: true, duplicate: false };
    },
  });
  const subscriptionPayload = await harness.runtime.makeInvoicePayload(userId, 'PRO', 'bot-token');
  pages[0] = [
    {
      id: 'pass-charge-active',
      amount: 50,
      date: now,
      source: {
        type: 'user',
        transaction_type: 'invoice_payment',
        user: { id: userId },
        invoice_payload: 'pass-good',
      },
    },
    {
      id: 'subscription-charge-active',
      amount: BILLING_PLANS.PRO.stars,
      date: now,
      source: {
        type: 'user',
        transaction_type: 'invoice_payment',
        user: { id: userId },
        invoice_payload: subscriptionPayload,
        subscription_period: SUBSCRIPTION_PERIOD_SECONDS,
      },
    },
  ];

  const result = await harness.runtime.syncBillingFromStars(userId, {
    botToken: 'bot-token',
    starsPrices: { PRO: BILLING_PLANS.PRO.stars },
    limits: { PRO: BILLING_PLANS.PRO.dailyLimit },
  });

  assert.equal(result.passVerified, 1);
  assert.equal(result.subscriptionSynced, true);
  assert.equal(passActivations, 1);
  assert.equal(harness.memory.users.get(userId)?.plan, 'PRO');
  assert.equal(
    harness.memory.users.get(userId)?.telegram_payment_charge_id,
    'subscription-charge-active',
  );
  assert.equal(
    harness.memory.billingPayments.get('subscription-charge-active')?.status,
    'paid',
  );
});

test('refund reconciliation surfaces Pass-store failures as retry-safe billing errors', async () => {
  const userId = 505;
  const chargeId = 'pass-refund-failure';
  const { runtime } = baseBillingHarness({
    refundPassByCharge: async () => {
      throw new Error('entitlement store unavailable');
    },
  });

  await assert.rejects(
    () => runtime.applyRefundedPayment(userId, chargeId, {}),
    error => {
      assert.equal(error.code, 'BILLING_REFUND_RECONCILIATION');
      assert.equal(error.telegramWebhookRetrySafe, true);
      assert.match(error.message, /entitlement store unavailable/);
      return true;
    },
  );
});

test('refund lookup works in memory mode and returns only active refundable charges', async () => {
  const userId = 606;
  const memory = {
    billingPayments: new Map([
      ['sub-paid', {
        telegram_payment_charge_id: 'sub-paid',
        telegram_id: userId,
        plan: 'PRO',
        stars_amount: 100,
        status: 'paid',
        created_at: '2026-10-06T10:00:00.000Z',
      }],
      ['sub-refunded', {
        telegram_payment_charge_id: 'sub-refunded',
        telegram_id: userId,
        plan: 'PRO',
        stars_amount: 100,
        status: 'refunded',
        created_at: '2026-10-06T11:00:00.000Z',
      }],
    ]),
  };
  const { runtime } = apiHarness({
    memory,
    listUserEntitlements: async () => [{
      telegram_id: userId,
      entitlement_type: 'MATCH_PASS',
      stars_amount: 50,
      status: 'active',
      payment_charge_id: 'pass-active',
      created_at: '2026-10-06T12:00:00.000Z',
      expires_at: '2026-10-07T12:00:00.000Z',
      fixture_id: 77,
    }],
  });

  const items = await runtime.listRefundableBillingCharges(userId, {});

  assert.deepEqual(items.map(item => item.paymentChargeId), ['pass-active', 'sub-paid']);
  assert.equal(items.some(item => item.paymentChargeId === 'sub-refunded'), false);
});

test('manual refund retry reconciles CHARGE_ALREADY_REFUNDED without issuing a second successful refund', async () => {
  const userId = 707;
  const chargeId = 'manual-refund-retry';
  let telegramAttempts = 0;
  const { runtime, reconcileCalls, ops } = apiHarness({
    telegramApi: async method => {
      assert.equal(method, 'refundStarPayment');
      telegramAttempts += 1;
      throw new Error('Bad Request: CHARGE_ALREADY_REFUNDED');
    },
  });

  const result = await runtime.apiBillingRefund(
    request({
      telegramId: userId,
      telegramPaymentChargeId: chargeId,
      reason: 'duplicate support request',
    }),
    {},
    { id: 1 },
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.refunded, true);
  assert.equal(result.body.reconciled, true);
  assert.equal(result.body.alreadyRefunded, true);
  assert.equal(telegramAttempts, 1);
  assert.deepEqual(reconcileCalls, [{ userId, chargeId }]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].code, 'BILLING_MANUAL_REFUND');
});

test('already-refunded internal charges skip Telegram and still reconcile access idempotently', async () => {
  const userId = 808;
  const chargeId = 'already-refunded-internal';
  let telegramCalls = 0;
  const { runtime, reconcileCalls } = apiHarness({
    findRefundableBillingCharge: async () => ({
      kind: 'pass',
      status: 'refunded',
      plan: 'MATCH_PASS',
    }),
    telegramApi: async () => {
      telegramCalls += 1;
    },
  });

  const result = await runtime.apiBillingRefund(
    request({
      telegramId: userId,
      telegramPaymentChargeId: chargeId,
      reason: 'reconcile previous refund',
    }),
    {},
    { id: 1 },
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.alreadyRefunded, true);
  assert.equal(telegramCalls, 0);
  assert.deepEqual(reconcileCalls, [{ userId, chargeId }]);
});
