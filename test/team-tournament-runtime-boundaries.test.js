import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTeamTournamentRuntime } from '../src/team-tournament-runtime.js';

function deps(overrides = {}) {
  return {
    apiFootball: async () => [],
    compactProviderError: error => ({
      code: String(error?.code || 'PROVIDER_ERROR'),
      status: Number(error?.status || 0) || null,
    }),
    footballDataScorersUrl: () => null,
    footballDataStandingsUrl: () => null,
    freeQuotaHealthy: () => true,
    getCache: async () => null,
    getCacheEntry: async () => null,
    getStaleCache: async () => null,
    hasSupabase: () => false,
    isFinishedStatus: status => String(status || '').toUpperCase() === 'FT',
    isFootballRateLimitError: error => String(error?.code || '').includes('RATE'),
    isLiveStatus: status => ['1H', '2H', 'HT', 'ET', 'P'].includes(String(status || '').toUpperCase()),
    json: (body, status = 200, headers = {}) => ({ body, status, headers }),
    loadProviderTeamDiscoveryFixtures: async () => [],
    markCachedSourceMeta: (meta, extra = {}) => ({ ...meta, ...extra, source: 'cache' }),
    normalizeCompetition: (id, name, country) => ({
      id: Number(id) || 0,
      name: String(name || ''),
      shortName: String(name || ''),
      country: String(country || ''),
      youth: false,
      friendly: false,
      category: 'league',
      tier: 'major',
      priority: 80,
    }),
    normalizeCountryName: value => String(value || ''),
    normalizeFootballDataStandings: payload => payload,
    normalizeFootballDataTeamScorers: () => ({ available: false, players: [] }),
    normalizeOpenLigaMatchEvents: () => ({ available: false, events: [] }),
    normalizeOpenLigaStandings: () => ({ available: false, standings: [] }),
    normalizeRoundLabel: value => String(value || ''),
    normalizeTheOddsApiMarket: () => null,
    openLigaCompetition: () => null,
    openLigaMatchDataUrls: () => [],
    openLigaTableUrls: () => [],
    providerDataState: (items, { attempted = false } = {}) => ({
      state: Array.isArray(items) && items.length ? 'available' : 'empty_response',
      available: Array.isArray(items) && items.length > 0,
      observed: Boolean(attempted),
      usable: Array.isArray(items) && items.length > 0,
      degraded: false,
      reason: Array.isArray(items) && items.length ? '' : 'empty_response',
      count: Array.isArray(items) ? items.length : 0,
    }),
    providerFeaturePolicy: () => ({ ttlSeconds: 60 }),
    providerMinuteRemaining: () => 100,
    publicDataCapabilities: () => ({ provider: 'test' }),
    recordOpsEvent: async () => {},
    resolveProviderChain: async () => ({
      available: false,
      standings: [],
      groups: [],
      sourceMeta: { provider: 'none' },
    }),
    scoreSnapshot: () => ({ home: 0, away: 0 }),
    secondaryProviderJson: async () => ({}),
    setCache: async () => {},
    sourceMeta: input => ({ ...input }),
    splitTeamDiscoveryMatches: matches => ({
      upcoming: Array.isArray(matches) ? matches.filter(item => !item.finished) : [],
      recent: Array.isArray(matches) ? matches.filter(item => item.finished) : [],
      primary: Array.isArray(matches) ? matches[0] || null : null,
      mode: Array.isArray(matches) && matches.length ? 'upcoming' : 'empty',
    }),
    statusLabel: status => String(status || ''),
    summarizeFormRows: () => ({ overall: { played: 0 } }),
    supaRpc: async () => ({ allowed: true }),
    teamDiscoveryFutureDays: 120,
    teamDiscoveryPastDays: 30,
    teamDiscoveryWindow: () => ({ from: '2026-09-06', to: '2027-02-03' }),
    teamResult: () => ({ result: 'W', gf: 2, ga: 1 }),
    theOddsApiUrl: () => null,
    ...overrides,
  };
}

test('team tournament runtime validates its complete dependency boundary and freezes exports', () => {
  const missing = deps();
  delete missing.providerDataState;
  assert.throws(
    () => createTeamTournamentRuntime(missing),
    /providerDataState is required/,
  );

  assert.throws(
    () => createTeamTournamentRuntime(deps({ teamDiscoveryPastDays: -1 })),
    /teamDiscoveryPastDays is required/,
  );

  assert.equal(Object.isFrozen(createTeamTournamentRuntime(deps())), true);
});

test('mechanical extraction does not leak worker globals or redeclare the provider request boundary', () => {
  const runtimeSource = fs.readFileSync('src/team-tournament-runtime.js', 'utf8');
  const workerSource = fs.readFileSync('src/worker.js', 'utf8');

  assert.doesNotMatch(runtimeSource, /createProviderRequestBoundary/);
  assert.doesNotMatch(runtimeSource, /memory\.provider/);
  assert.doesNotMatch(runtimeSource, /TEAM_DISCOVERY_PAST_DAYS|TEAM_DISCOVERY_FUTURE_DAYS/);

  assert.match(
    workerSource,
    /const \{ providerRequestJson: secondaryProviderJson \} = createProviderRequestBoundary\(\{/,
  );
  assert.match(workerSource, /providerDataState,/);
  assert.match(
    workerSource,
    /providerMinuteRemaining: \(\) => memory\.provider\?\.minuteRemaining/,
  );
  assert.match(
    workerSource,
    /teamDiscoveryPastDays: searchRuntime\.TEAM_DISCOVERY_PAST_DAYS/,
  );
  assert.match(
    workerSource,
    /teamDiscoveryFutureDays: searchRuntime\.TEAM_DISCOVERY_FUTURE_DAYS/,
  );
});

test('standing normalization rejects unsafe ids and prevents NaN propagation', () => {
  const runtime = createTeamTournamentRuntime(deps());

  const row = runtime.normalizeStandingRow({
    rank: 'NaN',
    points: 'not-a-number',
    goalsDiff: 'bad',
    team: { id: 1.5, name: ' Example ' },
    all: {
      played: 'bad',
      win: -2,
      goals: { for: 'bad', against: -5 },
    },
  });

  assert.equal(row.team.id, 0);
  assert.equal(row.team.name, 'Example');
  assert.equal(row.rank, 0);
  assert.equal(row.points, 0);
  assert.equal(row.goalsDiff, 0);
  assert.equal(row.played, 0);
  assert.equal(row.win, 0);
  assert.equal(row.goalsFor, 0);
  assert.equal(row.goalsAgainst, 0);

  const standings = runtime.normalizeApiFootballStandings({ unexpected: true }, 39, 2026);
  assert.equal(standings.available, false);
  assert.deepEqual(standings.standings, []);
});

test('secondary providers reject invalid fixture ids and tolerate malformed URL collections', async () => {
  let providerCalls = 0;
  const runtime = createTeamTournamentRuntime(deps({
    hasSupabase: () => true,
    openLigaCompetition: () => ({ label: 'League' }),
    openLigaTableUrls: () => ({ unexpected: true }),
    secondaryProviderJson: async () => {
      providerCalls += 1;
      return {};
    },
  }));

  const standings = await runtime.openLigaStandingsProvider(39, 2026, {});
  assert.deepEqual(standings, {
    available: false,
    reason: 'openligadb_empty',
  });
  assert.equal(providerCalls, 0);

  const odds = await runtime.secondaryOddsMarket(
    { fixture: { id: 0 }, league: { id: 39 } },
    { theOddsApiKey: 'secret' },
  );
  assert.equal(odds.available, false);
  assert.equal(odds.reason, 'invalid_fixture');
  assert.equal(providerCalls, 0);
});

test('tournament endpoint rejects fractional ids and honors the primary quota reserve', async () => {
  let chainInput = null;
  const runtime = createTeamTournamentRuntime(deps({
    providerMinuteRemaining: () => 1,
    resolveProviderChain: async input => {
      chainInput = input;
      return {
        available: false,
        standings: [],
        groups: [],
        sourceMeta: { provider: 'none' },
      };
    },
  }));

  const invalid = await runtime.apiTournament({
    url: 'https://example.test/api/tournament?leagueId=1.5&season=2026',
  }, {});
  assert.equal(invalid.status, 400);

  const response = await runtime.apiTournament({
    url: 'https://example.test/api/tournament?leagueId=39&season=2026',
  }, {});

  assert.equal(response.status, 200);
  assert.equal(response.body.available, false);
  assert.equal(chainInput.providers[0].id, 'api-football');
  assert.equal(chainInput.providers[0].enabled, false);
  assert.equal(chainInput.providers[0].skipReason, 'quota_reserve');
});

test('team endpoint survives malformed fixture collections and cache write failures', async () => {
  const runtime = createTeamTournamentRuntime(deps({
    loadProviderTeamDiscoveryFixtures: async () => ({ unexpected: true }),
    setCache: async () => {
      throw new Error('cache unavailable');
    },
  }));

  const response = await runtime.apiTeam({
    url: 'https://example.test/api/team?teamId=10&name=Arsenal',
  }, {});

  assert.equal(response.status, 200);
  assert.equal(response.body.team.id, 10);
  assert.equal(response.body.team.name, 'Arsenal');
  assert.deepEqual(response.body.recent, []);
  assert.deepEqual(response.body.upcoming, []);
  assert.equal(response.body.discovery.windowPastDays, 30);
  assert.equal(response.body.discovery.windowFutureDays, 120);
});

test('team season statistics normalize hostile provider values without NaN', () => {
  const runtime = createTeamTournamentRuntime(deps());
  const stats = runtime.normalizeTeamSeasonStatistics({
    team: { id: 10, name: 'Team' },
    league: { id: 39, season: 2026 },
    fixtures: {
      played: { home: 'bad', away: 4, total: 10 },
      wins: { home: -1, away: 2, total: 4 },
      draws: { total: 2 },
    },
    goals: {
      for: { total: { total: 'bad', home: 7, away: 5 }, average: { total: '1,20' } },
      against: { total: { total: -3 }, average: { total: 'bad' } },
    },
  });

  assert.equal(stats.available, true);
  assert.equal(stats.team.id, 10);
  assert.equal(stats.fixtures.played.home, 0);
  assert.equal(stats.fixtures.wins.home, 0);
  assert.equal(stats.goals.for.total, 0);
  assert.equal(stats.goals.against.total, 0);
  assert.equal(stats.goals.for.average, 1.2);
  assert.equal(stats.goals.against.average, null);
  assert.ok(Number.isFinite(stats.derived.points));
});

test('team match normalization rejects fixtures that do not contain the requested team', () => {
  const runtime = createTeamTournamentRuntime(deps());

  const match = runtime.normalizeTeamHubMatch({
    fixture: { id: 100, date: '2026-10-07T18:00:00Z', status: { short: 'NS' } },
    teams: {
      home: { id: 20, name: 'Other Home' },
      away: { id: 30, name: 'Other Away' },
    },
    league: { id: 39, name: 'League', season: 2026 },
  }, 10);

  assert.deepEqual(match, { fixtureId: 0 });
});

test('player normalization rejects statistics from another team, league or season', () => {
  const runtime = createTeamTournamentRuntime(deps());

  const players = runtime.normalizeApiFootballTeamPlayers([
    {
      player: { id: 7, name: 'Wrong Scope' },
      statistics: [{
        team: { id: 20, name: 'Other Team' },
        league: { id: 140, name: 'Other League', season: 2025 },
        games: { appearences: 20 },
        goals: { total: 10 },
      }],
    },
  ], {
    teamId: 10,
    leagueId: 39,
    season: 2026,
  });

  assert.deepEqual(players, []);
});

test('player normalization deduplicates provider ids and sorts leaders deterministically', () => {
  const runtime = createTeamTournamentRuntime(deps());
  const statistics = (goals, appearances, minutes) => [{
    team: { id: 10, name: 'Team' },
    league: { id: 39, name: 'League', season: 2026 },
    games: { appearences: appearances, minutes },
    goals: { total: goals, assists: 0 },
  }];

  const players = runtime.normalizeApiFootballTeamPlayers([
    { player: { id: 7, name: 'Player A' }, statistics: statistics(3, 10, 900) },
    { player: { id: 7, name: 'Player A duplicate' }, statistics: statistics(2, 9, 800) },
    { player: { id: 8, name: 'Player B' }, statistics: statistics(5, 11, 950) },
  ], {
    teamId: 10,
    leagueId: 39,
    season: 2026,
  });

  assert.equal(players.length, 2);
  assert.equal(players[0].providerId, 8);
  assert.equal(players[1].providerId, 7);
});

test('player pagination contains malformed paging and hostile maxPages values', async () => {
  const pages = [];
  const runtime = createTeamTournamentRuntime(deps({
    apiFootball: async (_path, params) => {
      pages.push(params.page);
      return {
        response: [{
          player: { id: 1, name: 'A' },
          statistics: [{
            team: { id: 10 },
            league: { id: 39, season: 2026 },
            games: { appearences: 1 },
            goals: { total: 0 },
          }],
        }],
        paging: { current: 'bad', total: 'bad' },
      };
    },
  }));

  const result = await runtime.apiFootballTeamSeasonPlayers(
    10,
    39,
    2026,
    {},
    { maxPages: 'hostile' },
  );

  assert.deepEqual(pages, [1]);
  assert.equal(result.complete, true);
  assert.equal(result.summary.pagesLoaded, 1);
  assert.equal(result.summary.pagesTotal, 1);
});

test('team player fallback records primary errors even when compact error normalization fails', async () => {
  const error = new Error('provider exploded');
  error.code = 'PRIMARY_BROKEN';

  const runtime = createTeamTournamentRuntime(deps({
    apiFootball: async () => {
      throw error;
    },
    compactProviderError: () => null,
  }));

  const result = await runtime.resolveTeamSeasonPlayers(
    10,
    'Team',
    39,
    'League',
    2026,
    {},
    {},
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, 'all_player_sources_unavailable');
  assert.equal(result.sourceMeta.attempts[0].provider, 'api-football');
  assert.equal(result.sourceMeta.attempts[0].state, 'error');
  assert.equal(result.sourceMeta.attempts[0].reason, 'PRIMARY_BROKEN');
  assert.equal(result.sourceMeta.attempts[1].provider, 'football-data');
});
