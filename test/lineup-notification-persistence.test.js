import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REMINDER_DELIVERY_KINDS, reminderDeliveryKindConfig } from '../src/reminder-delivery-store.js';

const migration = readFileSync(new URL('../supabase/migrations/supabase_migration_v6_21_2.sql', import.meta.url), 'utf8');
const rearmMigration = readFileSync(new URL('../supabase/migrations/supabase_migration_v6_25_2.sql', import.meta.url), 'utf8');
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

test('new reminders initialize lineup state and release contract points at an existing current migration head', () => {
  assert.match(reminders, /lineup_notified_at:\s*null/);
  assert.match(reminders, /lineup_claimed_at:\s*null/);
  assert.match(reminders, /lineup_attempts:\s*0/);

  assert.equal(release.productionSchema, '6.29');
  assert.match(
    release.latestMigration,
    /^supabase\/migrations\/supabase_migration_v6_29(?:_\d+)?\.sql$/,
  );
  assert.doesNotThrow(() => {
    readFileSync(new URL('../' + release.latestMigration, import.meta.url), 'utf8');
  });
});

test('explicit rearm resets lineup delivery state while an ordinary reminder update preserves it', () => {
  const rearmStart=rearmMigration.indexOf('if coalesce(p_rearm, false) then');
  const rearmEnd=rearmMigration.indexOf("'reason', 'rearmed'",rearmStart);
  assert.ok(rearmStart>=0 && rearmEnd>rearmStart);
  const rearmBranch=rearmMigration.slice(rearmStart,rearmEnd);

  assert.match(rearmBranch, /lineup_notified_at\s*=\s*null/i);
  assert.match(rearmBranch, /lineup_claimed_at\s*=\s*null/i);
  assert.match(rearmBranch, /lineup_attempts\s*=\s*0/i);

  const ordinaryStart=rearmMigration.indexOf(
    'update public.match_reminders',
    rearmEnd,
  );
  const ordinaryEnd=rearmMigration.indexOf("'reason', 'updated'",ordinaryStart);
  assert.ok(ordinaryStart>=0 && ordinaryEnd>ordinaryStart);
  const ordinaryUpdate=rearmMigration.slice(ordinaryStart,ordinaryEnd);

  assert.doesNotMatch(ordinaryUpdate,/lineup_notified_at/i);
  assert.doesNotMatch(ordinaryUpdate,/lineup_claimed_at/i);
  assert.doesNotMatch(ordinaryUpdate,/lineup_attempts/i);
});

test('historical migration preserves its rollout fingerprint exclusion without redefining current release identity', () => {
  assert.match(
    migration,
    /match_reminders' and c\.column_name in \('lineup_notified_at','lineup_claimed_at','lineup_attempts'\)/,
  );
  assert.doesNotMatch(
    migration,
    /supabase_migration_v6_29_\d+\.sql/,
  );
});
