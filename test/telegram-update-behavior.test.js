import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramUpdateProcessor } from '../src/telegram-update-orchestration.js';

function makeRuntime(overrides = {}) {
  const telegramCalls = [];
  const deps = {
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
  };
  return {
    telegramCalls,
    processTelegramUpdate: createTelegramUpdateProcessor(deps),
  };
}

test('pre-checkout is rejected behaviorally when monetization is disabled', async () => {
  const runtime = makeRuntime();
  const cfg = { monetizationEnabled: false, botToken: 'bot-token' };
  const update = {
    pre_checkout_query: {
      id: 'pcq-1',
      from: { id: 42 },
      currency: 'XTR',
      total_amount: 100,
      invoice_payload: 'payload',
    },
  };

  const response = await runtime.processTelegramUpdate(
    new Request('https://example.test/telegram'),
    cfg,
    update,
  );

  assert.deepEqual(response, { body: { ok: true }, status: 200 });
  assert.equal(runtime.telegramCalls.length, 1);
  assert.equal(runtime.telegramCalls[0].method, 'answerPreCheckoutQuery');
  assert.equal(runtime.telegramCalls[0].payload.pre_checkout_query_id, 'pcq-1');
  assert.equal(runtime.telegramCalls[0].payload.ok, false);
  assert.match(runtime.telegramCalls[0].payload.error_message, /Оплата временно отключена/);
});

test('valid Telegram Stars subscription pre-checkout is accepted', async () => {
  const runtime = makeRuntime({
    parseInvoicePayload: async () => ({ userId: 42, plan: 'pro' }),
    billingPlanConfig: plan => plan === 'pro' ? { stars: 250 } : null,
  });
  const cfg = { monetizationEnabled: true, botToken: 'bot-token' };
  const update = {
    pre_checkout_query: {
      id: 'pcq-2',
      from: { id: 42 },
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: 'signed-subscription-payload',
    },
  };

  const response = await runtime.processTelegramUpdate(
    new Request('https://example.test/telegram'),
    cfg,
    update,
  );

  assert.deepEqual(response, { body: { ok: true }, status: 200 });
  assert.equal(runtime.telegramCalls.length, 1);
  assert.deepEqual(runtime.telegramCalls[0].payload, {
    pre_checkout_query_id: 'pcq-2',
    ok: true,
  });
});

test('provider/parser failure rejects pre-checkout without throwing from webhook processing', async () => {
  const runtime = makeRuntime({
    parseInvoicePayload: async () => {
      throw Object.assign(new Error('provider unavailable'), { code: 'PROVIDER_DOWN' });
    },
  });
  const cfg = { monetizationEnabled: true, botToken: 'bot-token' };
  const update = {
    pre_checkout_query: {
      id: 'pcq-3',
      from: { id: 42 },
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: 'broken-payload',
    },
  };

  const response = await runtime.processTelegramUpdate(
    new Request('https://example.test/telegram'),
    cfg,
    update,
  );

  assert.deepEqual(response, { body: { ok: true }, status: 200 });
  assert.equal(runtime.telegramCalls.length, 1);
  assert.equal(runtime.telegramCalls[0].payload.ok, false);
  assert.match(runtime.telegramCalls[0].payload.error_message, /Не удалось проверить подписку/);
});
