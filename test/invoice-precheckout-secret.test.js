import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramUpdateProcessor } from '../src/telegram-update-orchestration.js';

function baseDeps(overrides = {}) {
  const telegramCalls = [];
  return {
    telegramCalls,
    deps: {
      loadRuntimeControls: async () => ({ value: {} }),
      telegramLockdownDecision: () => ({ blocked: false }),
      telegramApi: async (method, cfg, payload) => {
        telegramCalls.push({ method, cfg, payload });
        return { ok: true };
      },
      json: (body, status = 200) => ({ body, status }),
      parseInvoicePayload: async () => null,
      billingPlanConfig: () => null,
      parsePassInvoicePayload: async () => null,
      passProductConfig: () => null,
      ...overrides,
    },
  };
}

test('subscription pre-checkout verifies dedicated invoice secret before legacy bot token', async () => {
  const parserArgs = [];
  const { deps, telegramCalls } = baseDeps({
    parseInvoicePayload: async (...args) => {
      parserArgs.push(args);
      return { userId: 42, plan: 'PRO' };
    },
    billingPlanConfig: () => ({ stars: 250 }),
  });
  const processTelegramUpdate = createTelegramUpdateProcessor(deps);
  const cfg = {
    monetizationEnabled: true,
    invoiceSigningSecret: 'invoice-secret-v2',
    botToken: 'legacy-bot-token',
  };

  await processTelegramUpdate(
    new Request('https://example.test/telegram'),
    cfg,
    {
      pre_checkout_query: {
        id: 'pcq-sub',
        from: { id: 42 },
        currency: 'XTR',
        total_amount: 250,
        invoice_payload: 'fa1-payload',
      },
    },
  );

  assert.deepEqual(parserArgs[0], [
    'fa1-payload',
    'invoice-secret-v2',
    'legacy-bot-token',
  ]);
  assert.equal(telegramCalls[0]?.payload?.ok, true);
});

test('Pass pre-checkout receives dedicated and legacy verification secrets', async () => {
  const passParserArgs = [];
  const { deps, telegramCalls } = baseDeps({
    parseInvoicePayload: async () => null,
    parsePassInvoicePayload: async (...args) => {
      passParserArgs.push(args);
      return { userId: 42, passType: 'MATCH_PASS' };
    },
    passProductConfig: () => ({ stars: 120 }),
  });
  const processTelegramUpdate = createTelegramUpdateProcessor(deps);
  const cfg = {
    monetizationEnabled: true,
    invoiceSigningSecret: 'invoice-secret-v2',
    botToken: 'legacy-bot-token',
  };

  await processTelegramUpdate(
    new Request('https://example.test/telegram'),
    cfg,
    {
      pre_checkout_query: {
        id: 'pcq-pass',
        from: { id: 42 },
        currency: 'XTR',
        total_amount: 120,
        invoice_payload: 'fa2-payload',
      },
    },
  );

  assert.deepEqual(passParserArgs[0], [
    'fa2-payload',
    'invoice-secret-v2',
    'legacy-bot-token',
  ]);
  assert.equal(telegramCalls[0]?.payload?.ok, true);
});
