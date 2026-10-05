import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync(new URL('../src/worker.js', import.meta.url),'utf8');

function functionBody(name) {
  const start=worker.indexOf(`async function ${name}`);
  assert.notEqual(start,-1,`${name} must exist`);
  const next=worker.indexOf('\nasync function ',start+20);
  return worker.slice(start,next===-1 ? worker.length : next);
}

test('billing refund-state lookup fails closed instead of swallowing storage errors',()=>{
  const body=functionBody('findRefundableBillingCharge');
  assert.doesNotMatch(body,/supaSelectOne[\s\S]*?\.catch\(\(\) => null\)/);
  assert.doesNotMatch(body,/listUserEntitlements[\s\S]*?\.catch\(\(\) => \[\]\)/);
});

test('successful payment path does not ignore refunded-charge lookup failure',()=>{
  const body=functionBody('applySuccessfulPayment');
  assert.match(body,/await findRefundableBillingCharge\(userId, chargeId, cfg\);/);
  assert.doesNotMatch(body,/findRefundableBillingCharge[\s\S]*?\.catch\(\(\) => null\)/);
});

test('refund reconciliation failure emits a stable operational error before retry',()=>{
  const body=functionBody('applyRefundedPayment');
  assert.match(body,/code:'BILLING_REFUND_RECONCILIATION'/);
  assert.match(body,/eventType:'refund_reconciliation_failed'/);
  assert.match(body,/telegramWebhookRetrySafe = true/);
});
