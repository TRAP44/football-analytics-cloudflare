import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCompetitionIntegrityRuntime } from '../src/competition-integrity-runtime.js';
import { dailyPostMatches, leagueLabel } from '../src/channel-daily-post-job.js';

// Предпросмотры канала 13.10: «Premier League» Ливана и Ямайки проходили как
// главный турнир (фильтр по названию), а подпись читалась как АПЛ.

const runtime = createCompetitionIntegrityRuntime({
  APP_VERSION: 'test',
  bumpTelemetry: () => {},
  hasSupabase: () => false,
  isFinishedStatus: () => false,
  isLiveStatus: () => false,
  json: body => body,
  memory: {},
  recordOpsEvent: async () => {},
  safeOpsMetadata: value => value,
  supaSelectMany: async () => [],
  supaUpsert: async () => true,
});

test('channel league: domestic leagues outside the catalog do not pass by name', () => {
  const { isChannelLeague, isTopLeague } = runtime;
  // Ливан и Ямайка: isTopLeague пропускает по названию, канал — нет.
  assert.equal(isTopLeague(390, 'Premier League'), true);
  assert.equal(isChannelLeague(390, 'Premier League'), false);
  assert.equal(isChannelLeague(322, 'Premier League'), false);
  assert.equal(isChannelLeague(0, 'Serie A'), false);
  assert.equal(isChannelLeague(0, 'Bundesliga'), false);
  // Справочник по id.
  assert.equal(isChannelLeague(39, 'Premier League'), true);
  assert.equal(isChannelLeague(140, 'La Liga'), true);
  assert.equal(isChannelLeague(2, 'UEFA Champions League'), true);
  assert.equal(isChannelLeague(40, 'Championship'), false, 'priority below 80');
  // Международные турниры по названию.
  assert.equal(isChannelLeague(17, 'AFC Champions League Elite'), true);
  assert.equal(isChannelLeague(0, 'UEFA Youth League'), false);
  assert.equal(isChannelLeague(0, "UEFA Champions League Women"), false);
  assert.equal(isChannelLeague(null, ''), false);
});

test('league label carries the country, international competitions stay bare', () => {
  const ru = name => runtime.normalizeCountryName(name);
  assert.equal(leagueLabel({ name: 'Premier League', country: 'Lebanon' }, ru), 'Premier League, Ливан');
  assert.equal(leagueLabel({ name: 'Premier League', country: 'England' }, ru), 'Premier League, Англия');
  assert.equal(leagueLabel({ name: 'AFC Champions League Elite', country: 'World' }, ru), 'AFC Champions League Elite');
  assert.equal(leagueLabel({ name: 'Premier League', country: 'Atlantis' }, ru), 'Premier League, Atlantis');
  assert.equal(leagueLabel({ name: 'Premier League', country: 'Lebanon' }), 'Premier League, Lebanon');
  assert.equal(leagueLabel({ name: 'Premier League', country: 'Lebanon' }, () => { throw new Error('x'); }), 'Premier League, Lebanon');
  assert.equal(leagueLabel({ name: '', country: 'Lebanon' }, ru), '');
  assert.equal(leagueLabel(null, ru), '');
});

test('daily post uses the labelled league', () => {
  const now = Date.parse('2026-10-13T08:00:00.000Z');
  const rows = [{
    fixture: { id: 7, date: '2026-10-13T12:00:00.000Z', status: { short: 'NS' } },
    league: { id: 390, name: 'Premier League', country: 'Lebanon' },
    teams: { home: { name: 'Tripoli SC' }, away: { name: 'Al Akhaa Al Ahli' } },
  }];
  const [match] = dailyPostMatches(rows, { 7: { home: 55, draw: 32, away: 13 } }, now, { countryName: name => runtime.normalizeCountryName(name) });
  assert.equal(match.league, 'Premier League, Ливан');
});

test('composition root uses the channel filter for both channel posts', () => {
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const daily = worker.slice(worker.indexOf('channelDailyPostJob = createChannelDailyPostJob({'));
  const dailyBody = daily.slice(0, daily.indexOf('});'));
  assert.match(dailyBody, /isMainFixture: row => isChannelLeague\(/);
  assert.match(dailyBody, /countryName: \(\.\.\.args\) => normalizeCountryName\(\.\.\.args\)/);
  const swing = worker.slice(worker.indexOf('matchSwingJob = createMatchSwingJob({'));
  assert.match(swing.slice(0, swing.indexOf('});')), /isTopLeague: \(\.\.\.args\) => isChannelLeague\(\.\.\.args\)/);
});
