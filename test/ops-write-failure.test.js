import test from 'node:test';
import assert from 'node:assert/strict';
import { recordCriticalWriteFailure } from '../src/ops-write-failure.js';

test('critical write failure records a structured ops event without rethrowing', async () => {
  const calls = [];
  const cfg = { env: 'test' };
  const result = await recordCriticalWriteFailure({
    recordOpsEvent: async (...args) => calls.push(args),
    cfg,
    source: 'billing',
    eventType: 'referral_payment_write',
    code: 'REFERRAL_PAYMENT_WRITE_FAILED',
    message: 'Referral payment attribution write failed.',
    meta: { userId: 42 },
    error: Object.assign(new Error('database unavailable'), { code: 'db_timeout' }),
  });

  assert.equal(result, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], cfg);
  assert.deepEqual(calls[0][1], {
    severity: 'error',
    source: 'billing',
    eventType: 'referral_payment_write',
    code: 'REFERRAL_PAYMENT_WRITE_FAILED',
    message: 'Referral payment attribution write failed.',
    meta: {
      userId: 42,
      errorCode: 'DB_TIMEOUT',
    },
  });
});

test('ops reporting failure remains best-effort and does not change caller behavior', async () => {
  await assert.doesNotReject(() => recordCriticalWriteFailure({
    recordOpsEvent: async () => { throw new Error('ops unavailable'); },
    cfg: {},
    code: 'WRITE_FAILED',
    error: new Error('write failed'),
  }));
});
