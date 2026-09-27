import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PERSONAL_WRITE_LIMITS,
  normalizeFavoriteWrite,
  normalizeReminderWrite,
} from '../src/personal-write-guards.js';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/supabase_migration_v6_19_1.sql', 'utf8').toLowerCase();

test('personal write guards normalize valid favorites and reject unsafe payloads', () => {
  assert.deepEqual(
    normalizeFavoriteWrite({ teamId: 7, teamName: ' Arsenal ', teamLogo: 'https://example.test/logo.png' }),
    { teamId: 7, teamName: 'Arsenal', teamLogo: 'https://example.test/logo.png' },
  );
  assert.throws(() => normalizeFavoriteWrite({ teamId: 0, teamName: 'x' }), /Некорректная команда/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'x'.repeat(PERSONAL_WRITE_LIMITS.teamName + 1) }), /слишком длинный/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'Club', teamLogo: 'javascript:alert(1)' }), /Некорректный URL/);
});

test('personal write guards normalize valid reminders and reject stale or oversized input', () => {
  const now = Date.parse('2026-09-27T18:00:00.000Z');
  const row = normalizeReminderWrite({
    fixtureId: 42,
    homeName: ' Home ',
    awayName: ' Away ',
    leagueName: ' League ',
    fixtureDate: '2026-09-27T20:00:00.000Z',
    reminderMinutes: 60,
    kickoffNotify: false,
  }, now);
  assert.equal(row.fixtureId, 42);
  assert.equal(row.homeName, 'Home');
  assert.equal(row.awayName, 'Away');
  assert.equal(row.leagueName, 'League');
  assert.equal(row.reminderMinutes, 60);
  assert.equal(row.kickoffNotify, false);
  assert.throws(() => normalizeReminderWrite({
    fixtureId: 42,
    homeName: 'Home',
    awayName: 'Away',
    fixtureDate: '2026-09-27T18:04:00.000Z',
  }, now), /начинается или начался/);
});

test('v6.19.1 serializes per-user writes and keeps RPCs backend-only', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /save_favorite_guarded/);
  assert.match(migration, /save_match_reminder_guarded/);
  assert.match(migration, /limit_reached/);
  assert.match(migration, /revoke execute on function public\.save_favorite_guarded[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_favorite_guarded[\s\S]*to service_role/);
  assert.match(migration, /revoke execute on function public\.save_match_reminder_guarded[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_match_reminder_guarded[\s\S]*to service_role/);
});

test('worker uses guarded RPCs instead of direct upsert for personal writes', () => {
  const favoriteStart = worker.indexOf('async function addFavorite');
  const reminderStart = worker.indexOf('async function addReminder');
  assert.ok(favoriteStart >= 0 && reminderStart > favoriteStart);
  const favoriteBlock = worker.slice(favoriteStart, reminderStart);
  const reminderEnd = worker.indexOf('async function removeReminder', reminderStart);
  const reminderBlock = worker.slice(reminderStart, reminderEnd);
  assert.match(favoriteBlock, /save_favorite_guarded/);
  assert.doesNotMatch(favoriteBlock, /supaUpsert\(cfg, 'favorites'/);
  assert.match(reminderBlock, /save_match_reminder_guarded/);
  assert.doesNotMatch(reminderBlock, /supaUpsert\(cfg, 'match_reminders'/);
  assert.match(worker, /FAVORITES_LIMIT/);
  assert.match(worker, /REMINDERS_LIMIT/);
});

test('personal write guard contract is a blocking schema-drift dependency', () => {
  assert.match(worker, /readPersonalWriteGuardContract/);
  assert.match(worker, /missing\.push\('personal_write_guards'\)/);
  assert.match(worker, /summary\.ok && fingerprint\.ok && personalWriteGuards\.ok/);
});
