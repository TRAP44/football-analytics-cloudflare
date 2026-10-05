import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PERSONAL_WRITE_LIMITS,
  TEAM_LOGO_ALLOWED_HOSTS,
  normalizeFavoriteWrite,
  normalizeReminderWrite,
} from '../src/personal-write-guards.js';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const favorites = fs.readFileSync('src/user-favorites.js', 'utf8');
const reminders = fs.readFileSync('src/user-reminders.js', 'utf8');
const http = fs.readFileSync('src/http.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/supabase_migration_v6_19_1.sql', 'utf8').toLowerCase();

test('personal write guards normalize valid favorites and reject unsafe payloads', () => {
  assert.deepEqual(
    normalizeFavoriteWrite({
      teamId: 7,
      teamName: ' Arsenal ',
      teamLogo: 'https://media.api-sports.io/football/teams/42.png',
    }),
    {
      teamId: 7,
      teamName: 'Arsenal',
      teamLogo: 'https://media.api-sports.io/football/teams/42.png',
    },
  );
  assert.deepEqual(TEAM_LOGO_ALLOWED_HOSTS, ['media.api-sports.io']);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 0, teamName: 'x' }), /Некорректная команда/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'x'.repeat(PERSONAL_WRITE_LIMITS.teamName + 1) }), /слишком длинный/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'Club', teamLogo: 'javascript:alert(1)' }), /Некорректный URL/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'Club', teamLogo: 'https://example.test/logo.png' }), /Некорректный URL/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'Club', teamLogo: 'https://media.api-sports.io.evil.test/logo.png' }), /Некорректный URL/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'Club', teamLogo: 'http://media.api-sports.io/football/teams/42.png' }), /Некорректный URL/);
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

test('personal write storage boundaries use guarded RPCs instead of direct upserts', () => {
  assert.match(favorites, /save_favorite_guarded/);
  assert.doesNotMatch(favorites, /supaUpsert\(cfg, 'favorites'/);
  assert.match(worker, /createUserFavoritesService\(\{/);
  assert.doesNotMatch(worker, /async function addFavorite\(/);

  assert.match(reminders, /save_match_reminder_guarded/);
  assert.doesNotMatch(reminders, /supaUpsert\(cfg, 'match_reminders'/);
  assert.match(worker, /createUserRemindersService\(\{/);
  assert.doesNotMatch(worker, /async function addReminder\(/);
  assert.match(http, /FAVORITES_LIMIT/);
  assert.match(http, /REMINDERS_LIMIT/);
  assert.match(worker, /personalWriteLimits:\s*PERSONAL_WRITE_LIMITS/);
});

test('personal write guard contract is a blocking schema-drift dependency', () => {
  assert.match(worker, /readPersonalWriteGuardContract/);
  assert.match(worker, /missing\.push\('personal_write_guards'\)/);
  assert.match(worker, /summary\.ok && fingerprint\.ok && personalWriteGuards\.ok/);
});
