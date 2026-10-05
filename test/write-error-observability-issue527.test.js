import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { failSoftWithOpsEvent } from '../src/fail-soft-ops.js';

test('failSoftWithOpsEvent preserves fallback and reports the primary failure', async () => {
  const observed=[];
  const result=await failSoftWithOpsEvent(
    async()=>{ throw new Error('write unavailable'); },
    {
      fallback:false,
      onFailure:async error=>{ observed.push(error.message); },
    },
  );

  assert.equal(result,false);
  assert.deepEqual(observed,['write unavailable']);
});

test('failSoftWithOpsEvent keeps historical fallback even if ops persistence also fails', async () => {
  const previous=console.error;
  const lines=[];
  console.error=(...args)=>lines.push(args.join(' '));
  try {
    const result=await failSoftWithOpsEvent(
      async()=>{ throw new Error('primary write failed'); },
      {
        fallback:null,
        onFailure:async()=>{ throw new Error('ops store failed'); },
      },
    );
    assert.equal(result,null);
    assert.deepEqual(lines,['Fail-soft operational event could not be persisted.']);
  } finally {
    console.error=previous;
  }
});

test('critical fail-soft integration points emit stable operational codes', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');

  for (const code of [
    'BILLING_EXISTING_CHARGE_LOOKUP_FAILED',
    'BILLING_REFERRAL_PAYMENT_WRITE_FAILED',
    'DAILY_DIGEST_RELEASE_FAILED',
    'CHANNEL_PUBLISH_CLAIM_RELEASE_FAILED',
    'SETTLEMENT_WATCHDOG_STATE_WRITE_FAILED',
    'REMEDIATION_FAILURE_RECORD_WRITE_FAILED',
  ]) {
    assert.match(worker,new RegExp(code));
  }

  assert.doesNotMatch(
    worker,
    /recordReferredPayment\(userId,payment,subscription\.plan,cfg\)\.catch\(\(\)=>false\)/,
  );
  assert.doesNotMatch(
    worker,
    /release_daily_digest[^\n]+\.catch\(\(\)=>false\)/,
  );
});
