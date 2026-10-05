import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserRemindersService } from '../src/user-reminders.js';

function futureIso(minutesFromNow) {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

function makeService({ resolveCanonicalFixture } = {}) {
  const memory = { reminders: new Map() };
  const service = createUserRemindersService({
    memory,
    hasSupabase: () => false,
    supaSelectMany: async () => [],
    supaRpc: async () => null,
    fetchWithTimeout: async () => { throw new Error('not used'); },
    supaHeaders: () => ({}),
    getPreferences: async () => ({
      reminderMinutes: 30,
      kickoffNotification: true,
    }),
    resolveCanonicalFixture: resolveCanonicalFixture || (async fixtureId => ({
      available: true,
      fixtureId,
      homeName: 'Canonical Home',
      awayName: 'Canonical Away',
      leagueName: 'Canonical League',
      fixtureDate: futureIso(180),
    })),
  });
  return { memory, service };
}

test('reminder creation uses canonical server fixture data and stores normalized settings', async () => {
  const { memory, service } = makeService();

  const stored = await service.addReminder(42, {
    fixtureId: 1001,
    homeName: 'Untrusted Home',
    awayName: 'Untrusted Away',
    leagueName: 'Untrusted League',
    fixtureDate: futureIso(999),
    reminderMinutes: 60,
    kickoffNotify: false,
  }, {});

  assert.equal(stored.telegram_id, 42);
  assert.equal(stored.fixture_id, 1001);
  assert.equal(stored.home_name, 'Canonical Home');
  assert.equal(stored.away_name, 'Canonical Away');
  assert.equal(stored.league_name, 'Canonical League');
  assert.equal(stored.remind_before_minutes, 60);
  assert.equal(stored.kickoff_notify, false);
  assert.equal(stored.enabled, true);
  assert.equal(memory.reminders.get(42)?.length, 1);
});

test('reminder creation rejects unavailable canonical fixtures with a stable error code', async () => {
  const { service } = makeService({
    resolveCanonicalFixture: async () => ({
      available: false,
      reason: 'not_cached',
    }),
  });

  await assert.rejects(
    () => service.addReminder(42, {
      fixtureId: 1002,
      reminderMinutes: 30,
    }, {}),
    error => {
      assert.equal(error.code, 'REMINDER_FIXTURE_UNAVAILABLE');
      assert.equal(error.reason, 'not_cached');
      assert.equal(error.retryAfter, 30);
      return true;
    },
  );
});

test('reminder service enforces the active reminder limit behaviorally', async () => {
  const { memory, service } = makeService();
  const userId = 42;
  memory.reminders.set(userId, Array.from({ length: 50 }, (_, index) => ({
    telegram_id: userId,
    fixture_id: index + 1,
    home_name: `Home ${index + 1}`,
    away_name: `Away ${index + 1}`,
    league_name: 'League',
    fixture_date: futureIso(180 + index),
    remind_before_minutes: 30,
    kickoff_notify: true,
    enabled: true,
    created_at: new Date().toISOString(),
  })));

  await assert.rejects(
    () => service.addReminder(userId, {
      fixtureId: 9999,
      reminderMinutes: 30,
    }, {}),
    error => {
      assert.equal(error.code, 'REMINDERS_LIMIT');
      assert.match(error.message, /не больше 50 активных напоминаний/);
      return true;
    },
  );

  assert.equal(memory.reminders.get(userId)?.length, 50);
});
