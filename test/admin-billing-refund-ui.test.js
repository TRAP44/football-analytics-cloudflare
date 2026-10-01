import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const router = fs.readFileSync('src/router.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
const moduleSource = fs.readFileSync('public/modules/admin-billing-refund.js', 'utf8');

test('admin refundable lookup is server-authorized and separate from the public profile', () => {
  assert.match(router, /GET'[\s\S]*\/api\/admin\/billing\/refundable/);
  assert.match(router, /api\/admin\/billing\/refundable'[\s\S]*isAdminUser\(user, cfg\)/);
  assert.match(worker, /async function apiBillingRefundLookup/);
  assert.match(worker, /async function listRefundableBillingCharges/);
  assert.match(worker, /billing_payments/);
  assert.match(worker, /listUserEntitlements\(uid, cfg\)/);
  assert.match(worker, /status !== 'paid'/);
  assert.match(worker, /status !== 'active'/);
  const me = worker.slice(worker.indexOf('async function apiMe'), worker.indexOf('async function apiHistory'));
  assert.doesNotMatch(me, /telegram_payment_charge_id\s*:/);
  assert.match(me, /paymentChargeIdPresent/);
});

test('admin refund UI is admin-only and hides full charge ids from rendered copy', () => {
  assert.match(adminHtml, /id="adminBillingRefundPanel"[\s\S]*data-admin-only/);
  assert.match(adminHtml, /id="billingRefundUserId"/);
  assert.match(adminHtml, /id="billingRefundReason"/);
  assert.match(adminHtml, /id="billingRefundConfirm"/);
  assert.match(moduleSource, /charge …/);
  assert.doesNotMatch(moduleSource, /textContent\s*=\s*.*paymentChargeId/);
});

test('admin refund UI requires reason, explicit confirmation and server refund endpoint', () => {
  assert.match(moduleSource, /reason\.length < 3/);
  assert.match(moduleSource, /billingRefundConfirm/);
  assert.match(moduleSource, /confirmAction/);
  assert.match(moduleSource, /\/api\/admin\/billing\/refund/);
  assert.match(moduleSource, /telegramPaymentChargeId:String\(item\.paymentChargeId\)/);
  assert.match(moduleSource, /dedupe:false/);
  assert.match(worker, /refundStarPayment/);
  assert.match(worker, /BILLING_REFUND_ALREADY_APPLIED/);
});

test('admin surface loads refund module only for admins', () => {
  assert.match(app, /ensureAdminBillingRefundModule/);
  assert.match(app, /if \(!isAdmin\(\) \|\| !\$\('adminBillingRefundPanel'\)\) return null/);
  assert.match(app, /essentials\.push\(loadAdminBillingRefund\(false\)\)/);
});
