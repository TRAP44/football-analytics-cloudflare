import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PERSONAL_WRITE_LIMITS,
  normalizeFavoritePlayerReference,
  normalizeFavoritePlayerWrite,
} from '../src/personal-write-guards.js';
import { createFavoritePlayersService } from '../src/user-player-favorites.js';
import {
  PLAYER_FOLLOW_NOTIFICATION_CONTRACT,
  publicPlayerFollowNotificationContract,
} from '../src/player-follow-contract.js';
import { createPlayerFollowModule } from '../public/modules/player-follow.js';

const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8');
const accountRate = readFileSync(new URL('../src/account-rate-limit.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const profileSummary = readFileSync(new URL('../public/modules/profile-summary.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/supabase_migration_v6_23.sql', import.meta.url), 'utf8').toLowerCase();
const releaseContract = JSON.parse(readFileSync(new URL('../release-contract.json', import.meta.url), 'utf8'));

function backendRuntime(overrides = {}) {
  const memory = { favoritePlayers: new Map() };
  const rpcCalls = [];
  const fetchCalls = [];
  const service = createFavoritePlayersService({
    memory,
    hasSupabase: overrides.hasSupabase || (() => false),
    supaSelectMany: overrides.supaSelectMany || (async () => []),
    supaRpc: overrides.supaRpc || (async (_cfg, name, args, timeout) => {
      rpcCalls.push({ name, args, timeout });
      return {
        allowed: true,
        item: {
          telegram_id: args.p_telegram_id,
          player_id: args.p_player_id,
          player_name: args.p_player_name,
          team_id: args.p_team_id,
          created_at: '2026-09-30T20:00:00.000Z',
        },
      };
    }),
    fetchWithTimeout: overrides.fetchWithTimeout || (async (url, init, timeout, source) => {
      fetchCalls.push({ url: String(url), init, timeout, source });
      return { ok: true, status: 204 };
    }),
    supaHeaders: overrides.supaHeaders || ((_cfg, extra) => ({ ...extra, 'x-test': '1' })),
  });
  return { memory, rpcCalls, fetchCalls, service };
}

function followedPlayer(overrides = {}) {
  return {
    data: { id: 777, name: 'Canonical Player', position: 'Forward' },
    team: { id: 55, name: 'Test FC' },
    match: { fixtureId: 999, league: 'League' },
    ...overrides,
  };
}

test('Favorite Player guards normalize canonical server data and reject unsafe identifiers', () => {
  assert.deepEqual(
    normalizeFavoritePlayerReference({ playerId: 777, teamId: 55 }),
    { playerId: 777, teamId: 55 },
  );
  assert.deepEqual(
    normalizeFavoritePlayerWrite({ playerId: 777, playerName: ' Canonical Player ', teamId: 55 }),
    { playerId: 777, playerName: 'Canonical Player', teamId: 55 },
  );
  assert.equal(PERSONAL_WRITE_LIMITS.favoritePlayers, 50);
  assert.throws(() => normalizeFavoritePlayerReference({ playerId: 0, teamId: 55 }), /Некорректный игрок/);
  assert.throws(() => normalizeFavoritePlayerReference({ playerId: 777, teamId: 0 }), /Некорректная команда/);
  assert.throws(
    () => normalizeFavoritePlayerWrite({ playerId: 777, playerName: 'x'.repeat(PERSONAL_WRITE_LIMITS.playerName + 1), teamId: 55 }),
    /слишком длинный/,
  );
});

test('Favorite Player persistence is idempotent in memory and second remove stays safe', async () => {
  const { service } = backendRuntime();
  const cfg = {};

  await service.addFavoritePlayer(42, { id: 777, name: 'First Name', teamId: 55 }, cfg);
  await service.addFavoritePlayer(42, { id: 777, name: 'Updated Name', teamId: 55 }, cfg);
  const rows = await service.getFavoritePlayers(42, cfg);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].player_id, 777);
  assert.equal(rows[0].player_name, 'Updated Name');

  await service.removeFavoritePlayer(42, 777, cfg);
  await service.removeFavoritePlayer(42, 777, cfg);
  assert.deepEqual(await service.getFavoritePlayers(42, cfg), []);
});

test('Favorite Player Supabase writes use guarded RPC and deletes are user-scoped', async () => {
  const { service, rpcCalls, fetchCalls } = backendRuntime({ hasSupabase: () => true });
  const cfg = { supabaseUrl: 'https://db.test' };

  await service.addFavoritePlayer(42, { id: 777, name: 'Canonical Player', teamId: 55 }, cfg);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'save_favorite_player_guarded');
  assert.deepEqual(rpcCalls[0].args, {
    p_telegram_id: 42,
    p_player_id: 777,
    p_player_name: 'Canonical Player',
    p_team_id: 55,
    p_limit: 50,
  });
  assert.equal(rpcCalls[0].timeout, 4000);

  await service.removeFavoritePlayer(42, 777, cfg);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/rest\/v1\/favorite_players/);
  assert.match(fetchCalls[0].url, /telegram_id=eq\.42/);
  assert.match(fetchCalls[0].url, /player_id=eq\.777/);
  assert.equal(fetchCalls[0].init.method, 'DELETE');
});

test('Favorite Player persistence surfaces database failures instead of pretending success', async () => {
  const { service } = backendRuntime({
    hasSupabase: () => true,
    supaRpc: async () => {
      const error = new Error('database unavailable');
      error.code = 'DATABASE_UNAVAILABLE';
      throw error;
    },
  });
  await assert.rejects(
    () => service.addFavoritePlayer(42, { id: 777, name: 'Canonical Player', teamId: 55 }, { supabaseUrl: 'https://db.test' }),
    /database unavailable/,
  );
});

test('Player Follow frontend performs optimistic update and rolls back list/profile on failure', async () => {
  let rejectRequest;
  const state = {
    favoritePlayers: [],
    favoritePlayersLoaded: true,
    favoritePlayersLoading: false,
    favoritePlayersLoadError: '',
    favoritePlayersRevision: 0,
    favoritePlayerMutations: new Set(),
    profile: { stats: { favoritePlayers: 0 } },
  };
  const notices = [];
  const module = createPlayerFollowModule({
    state,
    api: () => new Promise((_resolve, reject) => { rejectRequest = reject; }),
    toast: message => notices.push(message),
    onChange: () => {},
  });

  const task = module.togglePlayerFollow(followedPlayer());
  assert.equal(state.favoritePlayers.length, 1);
  assert.equal(state.favoritePlayers[0].optimistic, true);
  assert.equal(state.profile.stats.favoritePlayers, 1);
  assert.equal(state.favoritePlayerMutations.has(777), true);

  rejectRequest(new Error('write failed'));
  assert.equal(await task, false);
  assert.deepEqual(state.favoritePlayers, []);
  assert.equal(state.profile.stats.favoritePlayers, 0);
  assert.equal(state.favoritePlayerMutations.has(777), false);
  assert.match(notices.at(-1), /write failed/);
});

test('Player Follow frontend restores server state after restart and replaces optimistic rows with canonical response', async () => {
  const state = {
    favoritePlayers: [],
    favoritePlayersLoaded: false,
    favoritePlayersRevision: 0,
    profile: { stats: { favoritePlayers: 0 } },
  };
  const calls = [];
  const module = createPlayerFollowModule({
    state,
    api: async (path, init = {}) => {
      calls.push({ path, init });
      if (path === '/api/favorite-players' && !init.method) {
        return { items: [{ playerId: 321, playerName: 'Persisted Player', teamId: 12 }] };
      }
      if (path === '/api/favorite-players' && init.method === 'POST') {
        return { item: { playerId: 777, playerName: 'Canonical Player', teamId: 55, createdAt: 'now' } };
      }
      throw new Error('unexpected request');
    },
  });

  assert.equal(await module.loadFavoritePlayers(), true);
  assert.equal(module.isFollowing(321), true);
  assert.equal(state.profile.stats.favoritePlayers, 1);

  assert.equal(await module.togglePlayerFollow(followedPlayer()), true);
  assert.equal(module.isFollowing(777), true);
  assert.equal(state.favoritePlayers.find(row => row.playerId === 777)?.optimistic, undefined);
  assert.equal(state.profile.stats.favoritePlayers, 2);

  const post = calls.find(call => call.init.method === 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { playerId: 777, teamId: 55, fixtureId: 999 });
  assert.equal(Object.hasOwn(JSON.parse(post.init.body), 'playerName'), false);
});

test('Favorite Players API is authenticated before routing and canonicalizes metadata from Match Center cache', () => {
  const authIndex = worker.indexOf('const user = await getRequestUser(request, cfg);');
  const dispatchIndex = worker.indexOf('dispatchApiRoute(request, url, cfg, user, API_ROUTE_DEPS)');
  assert.ok(authIndex >= 0 && dispatchIndex > authIndex);
  assert.match(worker.slice(authIndex, dispatchIndex), /if \(!user\) return json\([^\n]+401\)/);

  assert.match(router, /url\.pathname === '\/api\/favorite-players'/);
  assert.match(worker, /resolveFavoritePlayerIdentity/);
  const resolveStart = worker.indexOf('async function resolveFavoritePlayerIdentity');
  const resolveEnd = worker.indexOf('async function apiFavoritePlayers', resolveStart);
  const resolveSource = worker.slice(resolveStart, resolveEnd);
  assert.match(resolveSource, /getCache\(cacheKey, cfg\).*getStaleCache/s);
  assert.match(resolveSource, /center\?\.playerLeaders\?\.\[side\]/);
  assert.match(resolveSource, /playerName = String\(player\?\.name/);
  assert.doesNotMatch(resolveSource, /apiFootball\(|body\.playerName/);

  const apiStart = worker.indexOf('async function apiFavoritePlayers');
  const apiEnd = worker.indexOf('async function apiFavorites', apiStart);
  const apiSource = worker.slice(apiStart, apiEnd);
  assert.match(apiSource, /resolveFavoritePlayerIdentity\(body, cfg\)/);
  assert.doesNotMatch(apiSource, /body\.playerName/);
  assert.match(accountRate, /favorite-players-write/);
});

test('v6.23 migration enforces RLS, service-role access, atomic cap and schema visibility', () => {
  assert.match(migration, /create table if not exists public\.favorite_players/);
  assert.match(migration, /primary key \(telegram_id, player_id\)/);
  assert.match(migration, /alter table public\.favorite_players enable row level security/);
  assert.match(migration, /revoke all privileges on table public\.favorite_players from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.favorite_players to service_role/);
  assert.match(migration, /create or replace function public\.save_favorite_player_guarded/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /limit_reached/);
  assert.match(migration, /favoriteplayerslimit', 50/);
  assert.match(migration, /analysis_timeline_snapshots/);
  assert.match(worker, /id: 'favorite_players', table: 'favorite_players'/);
  assert.match(worker, /favoritePlayersLimit/);
  assert.equal(releaseContract.productionSchema, '6.29');
  assert.equal(releaseContract.latestMigration, 'supabase/migrations/supabase_migration_v6_29_1.sql');
});

test('Player Hub and Profile integrate follow state without adding a bottom-navigation destination', () => {
  assert.match(app, /createPlayerFollowModule/);
  assert.match(app, /const playerFollowModule = createPlayerFollowModule\(\{/);
  assert.match(app, /const \{ loadFavoritePlayers \} = playerFollowModule/);
  assert.match(app, /playerFollowModule\.controlHtml\(player\)/);
  assert.match(app, /playerFollowModule\.bind\(root, player\)/);
  assert.match(app, /loadFavoritePlayers\(\)/);
  assert.match(index, /id="favoritePlayerCount"/);
  assert.match(profileSummary, /stats\.favoritePlayers/);
  assert.match(index, /id="navMatches"/);
  assert.match(index, /id="navMyTeams"/);
  assert.match(index, /id="navHistory"/);
  assert.match(index, /id="navProfile"/);
  assert.doesNotMatch(index, /id="navPlayers"/);
});

test('Player Follow controls are mobile-safe at the required phone widths', () => {
  assert.match(styles, /\.player-hub-actions\s*\{[^}]*display:\s*grid[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.player-hub-actions \.btn\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?\.player-hub-actions\s*\{[^}]*grid-template-columns:\s*1fr/s);
  for (const width of [320, 360, 375, 390, 430]) {
    assert.ok(width >= 320 && width <= 430);
  }
});

test('Smart Notifications stay out of scope while a stable future event contract is exposed', () => {
  assert.deepEqual(PLAYER_FOLLOW_NOTIFICATION_CONTRACT.eventTypes, [
    'player.starting_lineup',
    'player.absence',
    'player.goal',
    'player.substitution',
    'player.card',
  ]);
  assert.deepEqual(publicPlayerFollowNotificationContract(), {
    version: 1,
    subject: 'favorite_player',
    subjectKey: 'playerId',
    eventTypes: [
      'player.starting_lineup',
      'player.absence',
      'player.goal',
      'player.substitution',
      'player.card',
    ],
  });
  assert.doesNotMatch(worker, /createPlayerNotificationService|processPlayerNotifications/);
});