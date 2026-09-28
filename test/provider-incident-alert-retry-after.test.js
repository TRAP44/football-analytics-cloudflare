import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverProviderIncidentAlert } from '../src/provider-incident-alerts.js';

const plan = { action:'send', kind:'incident', targetSlots:[0], incident:{} };

for (const retryAfter of [1, 2]) {
  test(`Telegram 429 waits the full retry_after=${retryAfter} before retrying`, async () => {
    const order = [];
    let calls = 0;
    const result = await deliverProviderIncidentAlert({
      plan, adminTelegramIds:[123],
      sendMessage:async () => {
        order.push('send');
        calls += 1;
        return calls === 1 ? { ok:false, status:429, retryAfter } : { ok:true, status:200 };
      },
      sleep:async ms => { order.push(ms); },
    });
    assert.deepEqual(order, ['send', retryAfter * 1000, 'send']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.deliveredSlots, [0]);
  });
}

test('Telegram 429 with a long retry_after defers without sleeping or retrying', async () => {
  let calls = 0;
  const result = await deliverProviderIncidentAlert({
    plan, adminTelegramIds:[123],
    sendMessage:async () => { calls += 1; return { ok:false, status:429, retryAfter:60 }; },
    sleep:async () => assert.fail('Long rate limits must not hold the cron open'),
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failedSlots, [0]);
});

test('repeated Telegram 429 remains bounded to two attempts', async () => {
  let calls = 0;
  const waits = [];
  const result = await deliverProviderIncidentAlert({
    plan, adminTelegramIds:[123],
    sendMessage:async () => { calls += 1; return { ok:false, status:429, retryAfter:2 }; },
    sleep:async ms => { waits.push(ms); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(result.ok, false);
});
