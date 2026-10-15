// Задача 3 (часть 2): оценка 1/X/2 по ходу матча и точки кривой.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { fitExpectedGoals, inPlayProbabilities, matchMinuteFromFixture, outcomeProbabilities } from '../src/in-play-model.js';
import {
  createInPlayTimelineJob,
  redCardsFromFixtureRow,
  inPlaySnapshotRow,
  liveFixtureState,
  shouldCaptureInPlay,
} from '../src/in-play-timeline-job.js';
import { renderAiProbabilityChart } from '../public/modules/ai-timeline.js';

const pre = { home: 48, draw: 27, away: 25 };
const sum = value => Math.round((value.home + value.draw + value.away) * 10) / 10;
const at = (homeGoals, awayGoals, minute, status = minute > 45 ? '2H' : '1H') => inPlayProbabilities({ prematch: pre, homeGoals, awayGoals, minute, status });

test('at kickoff the in-play estimate equals the pre-match one', () => {
  assert.deepEqual(at(0, 0, 0), pre);
  assert.deepEqual(inPlayProbabilities({ prematch: { home: 20, draw: 60, away: 20 }, homeGoals: 0, awayGoals: 0, minute: 0, status: '1H' }), { home: 20, draw: 60, away: 20 });
  const lambdas = fitExpectedGoals({ home: 0.48, away: 0.25 });
  const fitted = outcomeProbabilities(lambdas.home, lambdas.away);
  assert.ok(Math.abs(fitted.home - 0.48) < 0.002 && Math.abs(fitted.away - 0.25) < 0.002);
});

test('the estimate follows the score and the clock and always sums to 100', () => {
  const goalless = [0, 30, 60, 85].map(minute => at(0, 0, minute));
  for (let index = 1; index < goalless.length; index += 1) {
    assert.ok(goalless[index].draw > goalless[index - 1].draw, 'a goalless match drifts towards a draw');
  }
  assert.ok(at(1, 0, 30).home > pre.home + 20, 'a home goal lifts the home side');
  assert.ok(at(0, 1, 60).away > 60, 'an away goal lifts the away side');
  assert.ok(at(1, 0, 75).home > at(1, 0, 30).home, 'the same lead is worth more later');
  assert.ok(at(2, 0, 88).home > 97);
  assert.equal(at(0, 0, 45, 'HT').draw, at(0, 0, 45).draw);
  assert.ok(at(1, 0, 94).home < 100, 'not final before the whistle');
  for (const value of [at(0, 0, 10), at(1, 1, 70), at(3, 2, 89), at(0, 4, 50)]) assert.equal(sum(value), 100);
});

test('no estimate without trustworthy inputs or outside regular time', () => {
  for (const bad of [
    { prematch: pre, homeGoals: 0, awayGoals: 0, minute: 95, status: 'ET' },
    { prematch: pre, homeGoals: 0, awayGoals: 0, minute: 120, status: 'P' },
    { prematch: pre, homeGoals: 0, awayGoals: 0, minute: 20, status: 'NS' },
    { prematch: { home: 50, draw: 30, away: 30 }, homeGoals: 0, awayGoals: 0, minute: 20, status: '1H' },
    { prematch: { home: 100, draw: 0, away: 0 }, homeGoals: 0, awayGoals: 0, minute: 20, status: '1H' },
    { prematch: pre, homeGoals: 1.5, awayGoals: 0, minute: 20, status: '1H' },
    { prematch: pre, homeGoals: null, awayGoals: 0, minute: 20, status: '1H' },
    { prematch: pre, homeGoals: 0, awayGoals: 0, minute: null, status: '1H' },
  ]) assert.equal(inPlayProbabilities(bad), null, JSON.stringify(bad));
  assert.equal(matchMinuteFromFixture('HT', null), 45);
  assert.equal(matchMinuteFromFixture('2H', 90, 4), 94);
  assert.equal(matchMinuteFromFixture('2H', null), null);
});

const liveRow = (id, home, away, elapsed, status = '2H') => ({
  fixture: { id, status: { short: status, elapsed, extra: null } },
  goals: { home, away },
});

test('live state is read only from the provider row', () => {
  assert.deepEqual(liveFixtureState(liveRow(7, 1, 0, 61)), { fixtureId: 7, status: '2H', minute: 61, homeGoals: 1, awayGoals: 0 });
  assert.deepEqual(
    liveFixtureState({ ...liveRow(7, 1, 0, 61), teams: { home: { id: 10 }, away: { id: 20 } } }).teams,
    { home: 10, away: 20 },
    'team ids are kept for red-card alerts',
  );
  assert.equal(liveFixtureState({ ...liveRow(7, 1, 0, 61), teams: { home: { id: 10 }, away: { id: 10 } } }).teams, undefined);
  for (const row of [liveRow(7, 1, 0, 61, 'FT'), liveRow(7, 1, 0, 61, 'ET'), liveRow(7, null, 0, 61), liveRow(0, 1, 0, 61), liveRow(7, 1, 0, null)]) {
    assert.equal(liveFixtureState(row), null);
  }
});

test('a new point is stored on a score change or a shift of at least 1 point', () => {
  const state = { fixtureId: 7, status: '2H', minute: 61, homeGoals: 1, awayGoals: 0 };
  const probabilities = { home: 80, draw: 15, away: 5 };
  assert.equal(shouldCaptureInPlay(null, state, probabilities), true);
  assert.equal(shouldCaptureInPlay({ score: { home: 1, away: 0 }, probabilities: { home: 79.5, draw: 15.3, away: 5.2 } }, state, probabilities), false);
  assert.equal(shouldCaptureInPlay({ score: { home: 1, away: 0 }, probabilities: { home: 78.9, draw: 16, away: 5.1 } }, state, probabilities), true);
  assert.equal(shouldCaptureInPlay({ score: { home: 0, away: 0 }, probabilities }, state, probabilities), true);
  const row = inPlaySnapshotRow(state, probabilities, { score: { home: 0, away: 0 } }, '2026-10-12T18:00:00.000Z');
  assert.equal(row.snapshot_key, 'in-play:7:2026-10-12T18:00:00.000Z');
  assert.equal(row.trigger_category, 'event');
  assert.equal(row.causal_relation, 'confirmed');
  assert.deepEqual(row.provenance.score, { home: 1, away: 0 });
  assert.equal(row.provenance.source, 'in_play_model');
  assert.equal(row.provenance.teams, undefined, 'no team ids — no field');
  assert.deepEqual(inPlaySnapshotRow({ ...state, teams: { home: 10, away: 20 } }, probabilities, null, 'x').provenance.teams, { home: 10, away: 20 });
  // Значения проходят ограничения таблицы analysis_timeline_snapshots.
  assert.ok(['baseline', 'lineup', 'availability', 'odds_move', 'event', 'model_update'].includes(inPlaySnapshotRow(state, probabilities, { score: { home: 1, away: 0 } }, 'x').trigger_category));
});

function jobHarness({ fixtures, predictions = {}, previous = [], cacheHit = true, budget = { plan: 'PRO' } } = {}) {
  const inserted = [];
  const network = [];
  const job = createInPlayTimelineJob({
    clock: () => Date.parse('2026-10-12T18:00:00.000Z'),
    getCache: async () => (cacheHit ? { date: '2026-10-12', fixtures } : null),
    getModelProbabilities: async ids => Object.fromEntries(ids.filter(id => predictions[id]).map(id => [id, predictions[id]])),
    hasSupabase: () => true,
    loadProviderFixturesForDate: async (...args) => { network.push(args[0]); return fixtures; },
    providerSnapshot: () => budget,
    supaInsertIgnore: async (_cfg, table, row) => { inserted.push({ table, row }); },
    supaSelectMany: async () => previous,
  });
  return { job, inserted, network };
}

test('the job stores points only for live matches with a pre-match estimate', async () => {
  const { job, inserted, network } = jobHarness({
    fixtures: [liveRow(1, 1, 0, 61), liveRow(2, 0, 0, 30, '1H'), liveRow(3, 0, 0, 0, 'NS')],
    predictions: { 1: pre },
  });
  const result = await job.processInPlayTimeline({}, new Date('2026-10-12T18:00:00.000Z'));
  assert.equal(result.live, 2);
  assert.equal(result.eligible, 1);
  assert.equal(result.written, 1);
  assert.equal(network.length, 0, 'fresh cache: no provider request');
  assert.equal(inserted[0].table, 'analysis_timeline_snapshots');
  assert.equal(inserted[0].row.fixture_id, 1);
  assert.equal(inserted[0].row.match_minute, 61);
});

test('the job skips unchanged matches, respects the cap and the provider budget', async () => {
  const fixtures = [liveRow(1, 1, 0, 61)];
  const current = at(1, 0, 61);
  const unchanged = jobHarness({ fixtures, predictions: { 1: pre }, previous: [{ fixture_id: 1, home_prob: current.home, draw_prob: current.draw, away_prob: current.away, provenance: { score: { home: 1, away: 0 } } }] });
  assert.equal((await unchanged.job.processInPlayTimeline({})).unchanged, 1);
  assert.equal(unchanged.inserted.length, 0);

  const full = Array.from({ length: 60 }, () => ({ fixture_id: 1, home_prob: 10, draw_prob: 10, away_prob: 80, provenance: { score: { home: 0, away: 0 } } }));
  const capped = jobHarness({ fixtures, predictions: { 1: pre }, previous: full });
  assert.equal((await capped.job.processInPlayTimeline({})).capped, 1);

  const cooldown = jobHarness({ fixtures, predictions: { 1: pre }, cacheHit: false, budget: { cooldownActive: true } });
  const result = await cooldown.job.processInPlayTimeline({});
  assert.equal(cooldown.network.length, 0, 'no provider request during cooldown');
  assert.equal(result.reason, 'no_live_matches');

  const refresh = jobHarness({ fixtures, predictions: { 1: pre }, cacheHit: false });
  assert.equal((await refresh.job.processInPlayTimeline({})).written, 1);
  assert.equal(refresh.network.length, 1, 'stale cache: one request for the day feed');
});

test('the chart shows in-play points during the match and says what they account for', () => {
  const match = { fixtureId: 9, date: '2026-10-12T17:00:00.000Z', home: { name: 'Хозяева' }, away: { name: 'Гости' } };
  const point = (capturedAt, minute, probabilities, source = '', analysisVersion = 'in-play-poisson-v2') => ({
    capturedAt, minute, probabilities, provenance: source ? { source } : {}, analysisVersion,
  });
  const timeline = {
    points: [
      point('2026-10-12T16:00:00.000Z', null, pre),
      // Разбор, открытый в эфире, счёт не учитывает — на кривой его не будет.
      point('2026-10-12T17:40:00.000Z', 38, { home: 47, draw: 28, away: 25 }),
      point('2026-10-12T17:31:00.000Z', 30, { home: 76.6, draw: 17.3, away: 6.1 }, 'in_play_model'),
      point('2026-10-12T17:50:00.000Z', 45, { home: 73, draw: 19, away: 8 }, 'in_play_model'),
    ],
  };
  const html = renderAiProbabilityChart(timeline, match, []);
  assert.match(html, /3 сохранённых оценок/);
  assert.doesNotMatch(html, /38-я минута/);
  assert.match(html, /по счёту, оставшемуся времени и удалениям/);
  assert.match(html, /×0\.75, соперника ×1\.9/);
  assert.match(html, /ход игры она не учитывает/);
  const without = renderAiProbabilityChart({ points: timeline.points.slice(0, 2) }, match, []);
  assert.match(without, /38-я минута/);
  assert.doesNotMatch(without, /по счёту, оставшемуся времени и удалениям/);

  // Ревью Codex #854: точки v1 удаления не учитывали — подпись это говорит.
  const v1 = { points: timeline.points.map(item => ({ ...item, analysisVersion: 'in-play-poisson-v1' })) };
  assert.match(renderAiProbabilityChart(v1, match, []), /красные карточки и ход игры она не учитывает/);
  const mixed = { points: [...timeline.points.slice(0, 3).map(item => ({ ...item, analysisVersion: 'in-play-poisson-v1' })), timeline.points[3]] };
  assert.match(renderAiProbabilityChart(mixed, match, []), /учтены только в части точек/);
});

test('the in-play task runs with the other background tasks', () => {
  const jobs = fs.readFileSync('src/scheduled-jobs.js', 'utf8');
  assert.match(jobs, /run\('in_play_timeline', \(\) => processInPlayTimeline\(cfg, scheduledAt\)\)/);
  assert.match(jobs, /tasks\.push\(\['in_play_timeline', inPlayTimelineTask\]\)/);
  // Уведомления о голах ждут точку с новым счётом.
  // и живое табло (у кого оно есть, отдельный «Гол» не приходит).
  assert.match(jobs, /Promise\.all\(\[importantChangeTask, inPlayTimelineTask, favoriteScoreboardTask\]\)\s*\.then\(\(\) => run\('smart_notifications'/);
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.match(worker, /createInPlayTimelineJob\(\{/);
});

test('codex #847: first-half stoppage time does not eat into the second half', () => {
  const stoppage = inPlayProbabilities({ prematch: pre, homeGoals: 0, awayGoals: 0, minute: matchMinuteFromFixture('1H', 45, 5), status: '1H' });
  assert.deepEqual(stoppage, at(0, 0, 45, 'HT'));
  assert.notDeepEqual(stoppage, at(0, 0, 50, '2H'));
});

test('codex #847: a match that kicked off before midnight UTC keeps getting points', async () => {
  const yesterday = '2026-10-11';
  const lateKickoff = { ...liveRow(11, 1, 1, 80), fixture: { id: 11, date: '2026-10-11T23:00:00.000Z', status: { short: '2H', elapsed: 80 } } };
  const staleLate = { ...lateKickoff, goals: { home: 0, away: 0 }, fixture: { ...lateKickoff.fixture, status: { short: '1H', elapsed: 20 } } };
  const refreshed = [];
  const inserted = [];
  const job = createInPlayTimelineJob({
    clock: () => Date.parse('2026-10-12T00:25:00.000Z'),
    getCache: async key => (key.includes(yesterday) ? { date: yesterday, fixtures: [staleLate] } : { date: '2026-10-12', fixtures: [] }),
    getModelProbabilities: async ids => Object.fromEntries(ids.map(id => [id, pre])),
    hasSupabase: () => true,
    loadProviderFixturesForDate: async (date, _cfg, options) => { refreshed.push({ date, ...options }); return [lateKickoff]; },
    providerSnapshot: () => ({ plan: 'PRO' }),
    supaInsertIgnore: async (_cfg, _table, row) => { inserted.push(row); },
    supaSelectMany: async () => [],
  });
  const result = await job.processInPlayTimeline({}, new Date('2026-10-12T00:25:00.000Z'));
  assert.deepEqual(refreshed, [{ date: yesterday, allowNetwork: true, forceRefresh: true }]);
  assert.equal(result.written, 1);
  assert.equal(inserted[0].match_minute, 80, 'fresh score and minute, not the stale cache');

  // Днём вчерашний пакет не трогается.
  refreshed.length = 0;
  const daytime = createInPlayTimelineJob({
    clock: () => Date.parse('2026-10-12T15:00:00.000Z'),
    getCache: async () => ({ date: '2026-10-12', fixtures: [] }),
    getModelProbabilities: async () => ({}),
    hasSupabase: () => true,
    loadProviderFixturesForDate: async (date) => { refreshed.push(date); return []; },
    providerSnapshot: () => ({ plan: 'PRO' }),
    supaInsertIgnore: async () => {},
    supaSelectMany: async () => [],
  });
  await daytime.processInPlayTimeline({}, new Date('2026-10-12T15:00:00.000Z'));
  assert.deepEqual(refreshed, []);
});

test('red cards: the sanctioned side loses, the opponent gains, nothing changes without one', () => {
  const base = at(0, 0, 30);
  const homeRed = inPlayProbabilities({ prematch: pre, homeGoals: 0, awayGoals: 0, minute: 30, status: '1H', homeReds: 1 });
  const awayRed = inPlayProbabilities({ prematch: pre, homeGoals: 0, awayGoals: 0, minute: 30, status: '1H', awayReds: 1 });
  assert.ok(homeRed.home < base.home && homeRed.away > base.away);
  assert.ok(awayRed.away < base.away && awayRed.home > base.home);
  assert.deepEqual(inPlayProbabilities({ prematch: pre, homeGoals: 0, awayGoals: 0, minute: 30, status: '1H', homeReds: 0, awayReds: null }), base);
  // Чем меньше осталось играть, тем меньше влияние удаления.
  const late = inPlayProbabilities({ prematch: pre, homeGoals: 0, awayGoals: 0, minute: 85, status: '2H', homeReds: 1 });
  assert.ok(Math.abs(late.home - at(0, 0, 85).home) < Math.abs(homeRed.home - base.home));
  for (const value of [homeRed, awayRed, late]) assert.equal(sum(value), 100);
});

test('red cards are read from fixture events, a second yellow counts', () => {
  const row = {
    fixture: { id: 7 },
    teams: { home: { id: 1 }, away: { id: 2 } },
    events: [
      { type: 'Card', detail: 'Red Card', team: { id: 1 } },
      { type: 'Card', detail: 'Second Yellow card', team: { id: 2 } },
      { type: 'Card', detail: 'Yellow Card', team: { id: 2 } },
      { type: 'Goal', detail: 'Normal Goal', team: { id: 1 } },
    ],
  };
  assert.deepEqual(redCardsFromFixtureRow(row), { fixtureId: 7, home: 1, away: 1 });
  assert.equal(redCardsFromFixtureRow({ fixture: { id: 7 }, teams: row.teams }), null, 'no events — unknown, not zero');
});

test('the job asks for events once per 20 matches and keeps the last known red cards on failure', async () => {
  const fixtures = [liveRow(1, 0, 0, 30, '1H')];
  const calls = [];
  const inserted = [];
  const make = (apiFootball, previous = []) => createInPlayTimelineJob({
    apiFootball,
    clock: () => Date.parse('2026-10-12T18:00:00.000Z'),
    getCache: async () => ({ date: '2026-10-12', fixtures }),
    getModelProbabilities: async () => ({ 1: pre }),
    hasSupabase: () => true,
    loadProviderFixturesForDate: async () => fixtures,
    providerSnapshot: () => ({ plan: 'PRO' }),
    supaInsertIgnore: async (_cfg, _table, row) => { inserted.push(row); },
    supaSelectMany: async () => previous,
  });
  await make(async (path, params) => {
    calls.push([path, params]);
    return [{ fixture: { id: 1 }, teams: { home: { id: 10 }, away: { id: 20 } }, events: [{ type: 'Card', detail: 'Red Card', team: { id: 10 } }] }];
  }).processInPlayTimeline({});
  assert.deepEqual(calls, [['/fixtures', { ids: '1' }]]);
  assert.deepEqual(inserted[0].provenance.reds, { home: 1, away: 0, source: 'events' });
  assert.match(inserted[0].explanation, /удаления 1:0/);

  inserted.length = 0;
  const known = { fixture_id: 1, home_prob: 10, draw_prob: 10, away_prob: 80, provenance: { score: { home: 0, away: 0 }, reds: { home: 1, away: 0 } } };
  await make(async () => { throw new Error('limit'); }, [known]).processInPlayTimeline({});
  assert.deepEqual(inserted[0].provenance.reds, { home: 1, away: 0, source: 'previous' });
});

test('codex #854: the fresh fixture row replaces the cached score, dismissals never decrease, finished matches stop', async () => {
  const cached = [liveRow(1, 0, 0, 30, '1H'), liveRow(2, 0, 0, 30, '1H')];
  const inserted = [];
  const previous = [{ fixture_id: 1, home_prob: 10, draw_prob: 10, away_prob: 80, provenance: { score: { home: 0, away: 0 }, reds: { home: 1, away: 0 } } }];
  const job = createInPlayTimelineJob({
    apiFootball: async () => [
      // Свежее: 40′, 1:0, а в событиях (временно) нет прошлого удаления.
      { fixture: { id: 1, status: { short: '1H', elapsed: 40 } }, goals: { home: 1, away: 0 }, teams: { home: { id: 10 }, away: { id: 20 } }, events: [] },
      // Матч 2 уже закончился.
      { fixture: { id: 2, status: { short: 'FT', elapsed: 90 } }, goals: { home: 0, away: 0 }, teams: { home: { id: 30 }, away: { id: 40 } }, events: [] },
    ],
    clock: () => Date.parse('2026-10-12T18:00:00.000Z'),
    getCache: async () => ({ date: '2026-10-12', fixtures: cached }),
    getModelProbabilities: async () => ({ 1: pre, 2: pre }),
    hasSupabase: () => true,
    loadProviderFixturesForDate: async () => cached,
    providerSnapshot: () => ({ plan: 'PRO' }),
    supaInsertIgnore: async (_cfg, _table, row) => { inserted.push(row); },
    supaSelectMany: async () => previous,
  });
  await job.processInPlayTimeline({});
  assert.equal(inserted.length, 1, 'no point for the finished match');
  assert.equal(inserted[0].fixture_id, 1);
  assert.equal(inserted[0].match_minute, 40);
  assert.deepEqual(inserted[0].provenance.score, { home: 1, away: 0 });
  assert.deepEqual(inserted[0].provenance.reds, { home: 1, away: 0, source: 'events' });
});
