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


test('settlement watchdog state-write failures are observable instead of silently swallowed',()=>{
  assert.match(worker,/async function recordCriticalWriteFailure\(/);
  assert.match(worker,/SETTLEMENT_WATCHDOG_STATE_WRITE_FAILED/);
  assert.match(worker,/SETTLEMENT_RELIABILITY_READ_FAILED/);
  assert.match(worker,/REMEDIATION_AUDIT_FINALIZE_FAILED/);
  assert.match(worker,/REMEDIATION_AUDIT_WRITE_FAILED/);
  assert.doesNotMatch(
    functionBody('noteSettlementWatchdogOutcome'),
    /loadSettlementReliability\(cfg\)\.catch\(\(\) => normalizeSettlementReliability\(\)\)/,
  );
});


test('critical delivery and referral writes emit stable diagnostics',()=>{
  for (const code of [
    'BILLING_REFERRAL_WRITE_FAILED',
    'DAILY_DIGEST_RELEASE_WRITE_FAILED',
    'POST_MATCH_RETURN_FINISH_WRITE_FAILED',
    'POST_MATCH_RETURN_RELEASE_WRITE_FAILED',
  ]) {
    assert.match(worker,new RegExp(code));
  }
  assert.doesNotMatch(worker,/recordReferredPayment\([^\n]+\)\.catch\(\(\)=>false\)/);
  assert.doesNotMatch(worker,/release_daily_digest[^\n]+\.catch\(\(\)=>false\)/);
});


test('analysis-lock and post-match-return cleanup failures stay observable',()=>{
  for (const code of [
    'ANALYSIS_LOCK_STALE_DELETE_FAILED',
    'ANALYSIS_LOCK_RELEASE_FAILED',
    'POST_MATCH_RETURN_STALE_CLAIM_DELETE_FAILED',
    'POST_MATCH_RETURN_RELEASE_WRITE_FAILED',
  ]) {
    assert.match(worker,new RegExp(code));
  }
});


test('channel publisher idempotency cleanup uses its own diagnostic codes',()=>{
  assert.match(worker,/CHANNEL_PUBLISH_STALE_CLAIM_DELETE_FAILED/);
  assert.match(worker,/CHANNEL_PUBLISH_RELEASE_FAILED/);
  const start=worker.indexOf('async function claimChannelPublishIdempotency');
  const end=worker.indexOf('const DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS',start);
  const body=worker.slice(start,end);
  assert.doesNotMatch(body,/POST_MATCH_RETURN_RELEASE_WRITE_FAILED/);
  assert.doesNotMatch(body,/source:'post_match_return'/);
});


test('settlement cron marker write failures are observable',()=>{
  assert.match(worker,/SETTLEMENT_FINALITY_MARKER_WRITE_FAILED/);
  assert.match(worker,/SETTLEMENT_WATCHDOG_MARKER_WRITE_FAILED/);
});


test('prediction settlement failures are never silently swallowed',()=>{
  for (const code of [
    'SETTLEMENT_PENDING_READ_FAILED',
    'SETTLEMENT_PREDICTION_WRITE_FAILED',
    'SETTLEMENT_BACKGROUND_FAILED',
  ]) {
    assert.match(worker,new RegExp(code));
  }
  assert.doesNotMatch(worker,/settlePredictionsFromFixtures\([^\n]+\)\.catch\(\(\) => null\)/);
});
