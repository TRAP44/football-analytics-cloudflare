import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMINDER_DELIVERY_KINDS,
  reminderDeliveryKindConfig,
  createReminderDeliveryStore,
} from '../src/reminder-delivery-store.js';

test('notification delivery kinds keep the existing prematch and kickoff persistence contract', () => {
  assert.deepEqual(Object.keys(REMINDER_DELIVERY_KINDS), ['prematch', 'kickoff', 'lineup']);
  assert.deepEqual(reminderDeliveryKindConfig('prematch'), {
    claimColumn: 'prematch_claimed_at',
    doneColumn: 'notified_at',
    attemptsColumn: 'prematch_attempts',
  });
  assert.deepEqual(reminderDeliveryKindConfig('kickoff'), {
    claimColumn: 'kickoff_claimed_at',
    doneColumn: 'kickoff_notified_at',
    attemptsColumn: 'kickoff_attempts',
  });
});

test('unknown intelligent notification kinds fail closed until persistence is explicitly defined', () => {
  assert.deepEqual(reminderDeliveryKindConfig('lineup'), {
    claimColumn: 'lineup_claimed_at',
    doneColumn: 'lineup_notified_at',
    attemptsColumn: 'lineup_attempts',
  });
  assert.throws(
    () => reminderDeliveryKindConfig('important_change'),
    /Unsupported reminder delivery kind: important_change/,
  );
  assert.throws(
    () => reminderDeliveryKindConfig('final'),
    /Unsupported reminder delivery kind: final/,
  );
});

test('claim uses registry columns without changing current delivery semantics', async () => {
  const calls = [];
  const store = createReminderDeliveryStore({
    hasSupabase: () => true,
    fetchWithTimeout: async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, async json() { return [{}]; } };
    },
    supaHeaders: (_cfg, extra) => extra,
    recordOpsEvent: async () => {},
    redactOpsString: value => String(value),
  });

  const row = {
    telegram_id: 7,
    fixture_id: 99,
    prematch_attempts: 2,
    kickoff_attempts: 3,
  };
  const cfg = { supabaseUrl: 'https://example.supabase.co' };

  await store.claimReminderDelivery(row, 'prematch', cfg);
  await store.claimReminderDelivery(row, 'kickoff', cfg);

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /notified_at=is\.null/);
  assert.match(calls[0].url, /prematch_claimed_at=is\.null/);
  assert.equal(JSON.parse(calls[0].init.body).prematch_attempts, 3);
  assert.match(calls[1].url, /kickoff_notified_at=is\.null/);
  assert.match(calls[1].url, /kickoff_claimed_at=is\.null/);
  assert.equal(JSON.parse(calls[1].init.body).kickoff_attempts, 4);
});
