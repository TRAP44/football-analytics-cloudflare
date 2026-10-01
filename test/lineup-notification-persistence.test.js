import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REMINDER_DELIVERY_KINDS, reminderDeliveryKindConfig } from '../src/reminder-delivery-store.js';

const migration = readFileSync(new URL('../supabase/migrations/supabase_migration_v6_21_2.sql', import.meta.url), 'utf8');
const reminders = readFileSync(new URL('../src/user-reminders.js', import.meta.url), 'utf8');
const release = JSON.parse(readFileSync(new URL('../release-contract.json', import.meta.url), 'utf8'));

test('lineup notification has dedicated atomic delivery columns', () => {
  assert.deepEqual(reminderDeliveryKindConfig('lineup'), {
    claimColumn: 'lineup_claimed_at',
    doneColumn: 'lineup_notified_at',
    attemptsColumn: 'lineup_attempts',
  });
  assert.ok(Object.hasOwn(REMINDER_DELIVERY_KINDS, 'lineup'));
});

test('v6.21.2 migration creates and resets lineup notification state', () => {
  assert.match(migration, /add column if not exists lineup_notified_at timestamptz/i);
  assert.match(migration, /add column if not exists lineup_claimed_at timestamptz/i);
  assert.match(migration, /add column if not exists lineup_attempts integer not null default 0/i);
  assert.match(migration, /lineup_notified_at = null/i);
  assert.match(migration, /lineup_claimed_at = null/i);
  assert.match(migration, /lineup_attempts = 0/i);
});

test('new reminders initialize lineup state and release contract tracks migration', () => {
  assert.match(reminders, /lineup_notified_at:\s*null/);
  assert.match(reminders, /lineup_claimed_at:\s*null/);
  assert.match(reminders, /lineup_attempts:\s*0/);
  assert.equal(release.productionSchema, '6.24');
  assert.equal(release.latestMigration, 'supabase/migrations/supabase_migration_v6_24.sql');
});

test('migration preserves current structural fingerprint during additive rollout', () => {
  assert.match(migration, /match_reminders' and c\.column_name in \('lineup_notified_at','lineup_claimed_at','lineup_attempts'\)/);
});
