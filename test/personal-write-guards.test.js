import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PERSONAL_WRITE_LIMITS,
  normalizeFavoritePlayerReference,
  normalizeFavoritePlayerWrite,
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
    normalizeFavoriteWrite({ teamId: 7, teamName: ' Arsenal ', teamLogo: 'https://example.test/logo.png' }),
    { teamId: 7, teamName: 'Arsenal', teamLogo: 'https://example.test/logo.png' },
  );
  assert.throws(() => normalizeFavoriteWrite({ teamId: 0, teamName: 'x' }), /Некорректная команда/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'x'.repeat(PERSONAL_WRITE_LIMITS.teamName + 1) }), /слишком длинный/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'Club', teamLogo: 'javascript:alert(1)' }), /Некорректный URL/);
});

test('personal write guards reject coerced IDs, non-string names and credentialed logo URLs', () => {
  assert.throws(
    () => normalizeFavoriteWrite({teamId:true,teamName:'Club'}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.throws(
    () => normalizeFavoriteWrite({teamId:7,teamName:{name:'Club'}}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.throws(
    () => normalizeFavoriteWrite({teamId:7,teamName:'Club\u0000Name'}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.throws(
    () => normalizeFavoriteWrite({teamId:7,teamName:'Club',teamLogo:'https://user:secret@example.test/logo.png'}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );

  assert.deepEqual(
    normalizeFavoritePlayerReference({playerId:'15',teamId:'7'}),
    {playerId:15,teamId:7},
  );
  assert.throws(
    () => normalizeFavoritePlayerReference({playerId:[15],teamId:7}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.throws(
    () => normalizeFavoritePlayerWrite({playerId:15,teamId:7,playerName:['Player']}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
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

  assert.throws(() => normalizeReminderWrite({
    fixtureId:true,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27T20:00:00.000Z',
  },now), error => error?.code === 'PERSONAL_DATA_INVALID');

  assert.throws(() => normalizeReminderWrite({
    fixtureId:42,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27 20:00:00',
  },now), /Некорректное время матча/);

  assert.throws(() => normalizeReminderWrite({
    fixtureId:42,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27T20:00:00.000Z',
    kickoffNotify:'false',
  },now), error => error?.code === 'PERSONAL_DATA_INVALID');

  assert.throws(() => normalizeReminderWrite({
    fixtureId:42,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27T20:00:00.000Z',
  },Number.NaN), /Некорректное текущее время/);

  assert.equal(normalizeReminderWrite({
    fixtureId:'42',
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27T20:00:00+00:00',
    reminderMinutes:'60',
  },now).reminderMinutes,60);
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
