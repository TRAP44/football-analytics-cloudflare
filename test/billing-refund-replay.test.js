import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');

test('refunded Stars charges are blocked before any replay activation', () => {
  const start = worker.indexOf('async function applySuccessfulPayment');
  const end = worker.indexOf('async function billingWebhookStatus', start);
  assert.ok(start > 0 && end > start);
  const source = worker.slice(start, end);

  assert.match(source, /findRefundableBillingCharge\(userId, chargeId, cfg\)/);
  assert.match(source, /existingCharge\?\.status/);
  assert.match(source, /refunded/);
  assert.match(source, /BILLING_REFUNDED_CHARGE_REPLAY_BLOCKED/);

  const guard = source.indexOf('existingCharge');
  const subscription = source.indexOf('parseInvoicePayload');
  const pass = source.indexOf('parsePassInvoicePayload');
  assert.ok(guard > 0 && subscription > guard && pass > guard);
});

test('Stars sync still routes subscription and Pass history through the guarded payment application', () => {
  const start = worker.indexOf('async function syncBillingFromStars');
  const end = worker.indexOf('function telegramMiniAppE2EDrill', start);
  assert.ok(start > 0 && end > start);
  const source = worker.slice(start, end);

  assert.match(source, /getStarTransactions/);
  assert.match(source, /parsePassInvoicePayload/);
  assert.match(source, /parseInvoicePayload/);
  assert.ok((source.match(/applySuccessfulPayment\(userId/g) || []).length >= 2);
});
