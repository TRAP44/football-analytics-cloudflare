import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminBillingRefundModule } from '../public/modules/admin-billing-refund.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function createElementStore() {
  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '',
        checked: false,
        disabled: false,
        textContent: '',
        innerHTML: '',
        addEventListener() {},
      });
    }
    return elements.get(id);
  };
  return { elements, elementById };
}

const worker = readRepoFile('src/worker.js');
const router = readRepoFile('src/router.js');
const billingApi = readRepoFile('src/billing-api-runtime.js');
const userDataApi = readRepoFile('src/user-data-api-runtime.js');
const app = readRepoFile('public/app.js');
const publicHtml = readRepoFile('public/index.html');
const adminHtml = readRepoFile('public/admin.html');
const moduleSource = readRepoFile('public/modules/admin-billing-refund.js');

test('admin refundable endpoints are server-authorized and refund mutation is replay-protected', () => {
  assert.match(
    router,
    /method === 'GET' && pathname === '\/api\/admin\/billing\/refundable'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?apiBillingRefundLookup/,
  );
  assert.match(
    router,
    /method === 'POST' && pathname === '\/api\/admin\/billing\/refund'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?sensitiveMutation\(\(\)=>apiBillingRefund/,
  );
  assert.match(billingApi, /async function apiBillingRefund\(request, cfg, user\)[\s\S]*?if \(!isAdminUser\(user, cfg\)\) return adminForbidden\(\)/);
});

test('refund implementation lives in billing runtime and only lists active refundable charges', () => {
  assert.match(worker, /createBillingApiRuntime/);
  assert.match(worker, /function apiBillingRefundLookup\(\.\.\.args\)/);
  assert.match(worker, /function apiBillingRefund\(\.\.\.args\)/);

  assert.match(billingApi, /async function listRefundableBillingCharges/);
  assert.match(billingApi, /billing_payments/);
  assert.match(billingApi, /listUserEntitlements\(uid, cfg\)/);
  assert.match(billingApi, /status !== 'paid'/);
  assert.match(billingApi, /status !== 'active'/);
  assert.match(billingApi, /seen\.has\(item\.paymentChargeId\)/);
  assert.match(billingApi, /telegramApi\('refundStarPayment'/);
  assert.match(billingApi, /CHARGE_ALREADY_REFUNDED/);
  assert.match(billingApi, /reconciled:true/);
});

test('public profile exposes only charge presence and never returns the raw charge id', () => {
  const start = userDataApi.indexOf('async function apiMe(');
  const end = userDataApi.indexOf('\n  async function apiHistory(', start);
  assert.ok(start >= 0 && end > start, 'apiMe boundary must remain discoverable');

  const apiMe = userDataApi.slice(start, end);
  assert.match(apiMe, /paymentChargeIdPresent:\s*Boolean\(record\.telegram_payment_charge_id\)/);
  assert.doesNotMatch(apiMe, /paymentChargeId\s*:/);
  assert.doesNotMatch(apiMe, /telegramPaymentChargeId\s*:/);
});

test('admin refund UI renders only a charge suffix, never the full payment charge id', async () => {
  const { elementById } = createElementStore();
  const fullChargeId = 'charge-secret-prefix-12345678';
  elementById('billingRefundUserId').value = '123456789';

  const module = createAdminBillingRefundModule({
    state: { profile: { user: { id: 1 } } },
    elementById,
    api: async () => ({
      items: [{
        product: 'MATCH_PASS',
        stars: 25,
        fixtureId: 77,
        paymentChargeId: fullChargeId,
        chargeSuffix: '12345678',
      }],
    }),
    escapeHtml: value => String(value ?? ''),
    isAdmin: () => true,
  });

  await module.load(true);

  const rendered = elementById('billingRefundResults').innerHTML;
  assert.match(rendered, /charge …12345678/);
  assert.doesNotMatch(rendered, new RegExp(fullChargeId));
});

test('refund action requires a reason and explicit confirmation before calling the mutation endpoint', async () => {
  const { elementById } = createElementStore();
  const calls = [];
  const messages = [];
  elementById('billingRefundUserId').value = '123456789';

  const module = createAdminBillingRefundModule({
    state: { profile: { user: { id: 1 } } },
    elementById,
    api: async (path, options) => {
      calls.push({ path, options });
      if (path.includes('/refundable')) {
        return {
          items: [{
            product: 'MATCH_PASS',
            stars: 25,
            paymentChargeId: 'charge-12345678',
            chargeSuffix: '12345678',
          }],
        };
      }
      return { ok: true };
    },
    escapeHtml: value => String(value ?? ''),
    toast: message => messages.push(message),
    isAdmin: () => true,
    confirmAction: () => true,
  });

  await module.load(true);
  calls.length = 0;

  await module.refund(0);
  assert.equal(calls.length, 0);
  assert.equal(messages.at(-1), 'Укажите причину возврата.');

  elementById('billingRefundReason').value = 'E2E refund';
  await module.refund(0);
  assert.equal(calls.length, 0);
  assert.equal(messages.at(-1), 'Подтвердите ручной возврат.');

  elementById('billingRefundConfirm').checked = true;
  await module.refund(0);

  assert.equal(calls[0].path, '/api/admin/billing/refund');
  assert.deepEqual(calls[0].options, {
    method: 'POST',
    body: JSON.stringify({
      telegramId: 123456789,
      telegramPaymentChargeId: 'charge-12345678',
      reason: 'E2E refund',
    }),
    retry: false,
    dedupe: false,
  });
});

test('admin refund surface is isolated from the normal Mini App and mounted only after admin verification', () => {
  assert.match(adminHtml, /id="adminBillingRefundPanel"[\s\S]*data-admin-only/);
  assert.match(adminHtml, /id="billingRefundUserId"/);
  assert.match(adminHtml, /id="billingRefundReason"/);
  assert.match(adminHtml, /id="billingRefundConfirm"/);

  assert.doesNotMatch(publicHtml, /data-admin-only|adminBillingRefundPanel/);
  assert.match(moduleSource, /export function mountAdminBillingRefundPanel/);
  assert.match(moduleSource, /billing\.insertAdjacentElement\('afterend', section\)/);

  assert.match(
    app,
    /async function ensureAdminBillingRefundModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?mountAdminBillingRefundPanel\(document\)/,
  );
});
