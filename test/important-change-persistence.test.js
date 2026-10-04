import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REMINDER_DELIVERY_KINDS, reminderDeliveryKindConfig } from '../src/reminder-delivery-store.js';

const migration = readFileSync(new URL('../supabase/migrations/supabase_migration_v6_21_3.sql', import.meta.url), 'utf8');
const reminders = readFileSync(new URL('../src/user-reminders.js', import.meta.url), 'utf8');
const release = JSON.parse(readFileSync(new URL('../release-contract.json', import.meta.url), 'utf8'));

test('important-change notification has dedicated atomic delivery columns', () => {
  assert.deepEqual(reminderDeliveryKindConfig('important_change'), {
    claimColumn: 'important_change_claimed_at',
    doneColumn: 'important_change_notified_at',
    attemptsColumn: 'important_change_attempts',
  });
  assert.ok(Object.hasOwn(REMINDER_DELIVERY_KINDS, 'important_change'));
});

test('v6.21.3 migration creates and resets important-change notification state', () => {
  assert.match(migration, /add column if not exists important_change_notified_at timestamptz/i);
  assert.match(migration, /add column if not exists important_change_claimed_at timestamptz/i);
  assert.match(migration, /add column if not exists important_change_attempts integer not null default 0/i);
  assert.match(migration, /important_change_notified_at = null/i);
  assert.match(migration, /important_change_claimed_at = null/i);
  assert.match(migration, /important_change_attempts = 0/i);
});

test('new reminders initialize important-change state and release contract tracks migration', () => {
  assert.match(reminders, /important_change_notified_at:\s*null/);
  assert.match(reminders, /important_change_claimed_at:\s*null/);
  assert.match(reminders, /important_change_attempts:\s*0/);
  assert.equal(release.latestMigration, 'supabase/migrations/supabase_migration_v6_27.sql');
});

test('migration preserves current structural fingerprint during additive rollout', () => {
  assert.match(migration, /important_change_notified_at/);
  assert.match(migration, /important_change_claimed_at/);
  assert.match(migration, /important_change_attempts/);
  assert.match(migration, /lineup_notified_at/);
});
