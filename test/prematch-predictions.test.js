import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAnalysisRuntime } from '../src/analysis-runtime.js';
import { createProviderFixtureRuntime } from '../src/provider-fixture-runtime.js';
import {
  createPrematchPredictionJob,
  prematchCandidates,
  prematchPredictionSettings,
  providerBudgetDecision,
} from '../src/prematch-prediction-job.js';

// Задача 2: вероятности модели заранее для главных матчей дня.

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const iso = minutes => new Date(NOW + minutes * 60000).toISOString();

function match(fixtureId, minutes, extra = {}) {
  return {
    fixtureId,
    date: iso(minutes),
    status: 'NS',
    live: false,
    finished: false,
    featured: false,
    isTop: false,
    interestScore: 50,
    home: { id: fixtureId * 10 + 1 },
    away: { id: fixtureId * 10 + 2 },
    ...extra,
  };
}

test('candidates: only upcoming main matches inside the window, favorites first', () => {
  const feed = {
    matches: [
      match(1, 120, { isTop: true, interestScore: 90 }),
      match(2, 60),                                        // не главный и не избранный
      match(3, 30, { featured: true, interestScore: 70 }),
      match(4, 10, { isTop: true }),                       // слишком близко к старту
      match(5, 60 * 40, { isTop: true }),                  // дальше 36 часов
      match(6, 90, { isTop: true, status: '1H', live: true }),
      match(7, 300, { isTop: true, youthReserve: true }),
      match(8, 200),                                       // избранная команда
      match(1, 120, { isTop: true }),                      // дубль
    ],
  };
  const rows = prematchCandidates([feed], new Set([81]), NOW);
  assert.deepEqual(rows.map(row => row.fixtureId), [8, 1, 3]);
  assert.equal(rows[0].favorite, true);
});

test('provider budget: FREE waits for a confirmed reserve, cooldown always blocks', () => {
  const settings = prematchPredictionSettings({});
  assert.deepEqual(settings, { enabled: true, perRun: 2, dailyLimit: 20, intervalMinutes: 30, freeDailyReserve: 60 });
  const fresh = new Date(NOW - 30_000).toISOString();
  const yesterday = new Date(NOW - 20 * 3600_000).toISOString();
  assert.equal(providerBudgetDecision({ plan: 'FREE', dailyRemaining: 59, updatedAt: fresh }, settings, NOW).allowed, false);
  assert.equal(providerBudgetDecision({ plan: 'FREE' }, settings, NOW).reason, 'provider_daily_reserve');
  assert.equal(providerBudgetDecision({ plan: 'UNKNOWN', dailyRemaining: 80, updatedAt: fresh }, settings, NOW).allowed, true);
  // Остаток из вчерашнего снимка не подтверждает сегодняшний резерв.
  assert.equal(providerBudgetDecision({ plan: 'FREE', dailyRemaining: 95, updatedAt: yesterday }, settings, NOW).reason, 'provider_daily_reserve');
  assert.equal(providerBudgetDecision({ plan: 'PRO', cooldownActive: true }, settings, NOW).reason, 'provider_cooldown');
  assert.equal(providerBudgetDecision({ plan: 'PRO', minuteRemaining: 3, updatedAt: fresh }, settings, NOW).reason, 'provider_minute_budget');
  // Старый минутный остаток (минута давно прошла) не блокирует.
  assert.equal(providerBudgetDecision({ plan: 'PRO', minuteRemaining: 3, updatedAt: yesterday }, settings, NOW).allowed, true);
  assert.equal(providerBudgetDecision({ plan: 'PRO' }, settings, NOW).allowed, true);
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function job({ feed, predicted = [], snapshot = { plan: 'PRO' }, rpcAllowed = () => true, analyze, favorites = [], rateRows = [], raw = {}, staleRaw = {}, network = {} } = {}) {
  const calls = { analyzed: [], rpc: [], events: [], selects: [], cacheReads: [], network: [] };
  const rt = createPrematchPredictionJob({
    analyzeFixtureForSystem: async (fixtureId, cfg) => {
      calls.analyzed.push(fixtureId);
      return analyze ? analyze(fixtureId, cfg) : jsonResponse({ cached: false, match: { fixtureId } });
    },
    clock: () => NOW,
    getCache: async key => {
      calls.cacheReads.push(key);
      if (key === 'matches:2026-10-11:v6-integrity') return feed;
      const rawDate = /^provider-fixtures:(.+):v1$/.exec(key)?.[1];
      return rawDate && raw[rawDate] ? { date: rawDate, fixtures: raw[rawDate] } : null;
    },
    getStaleCache: async key => {
      calls.cacheReads.push(`stale:${key}`);
      const rawDate = /^provider-fixtures:(.+):v1$/.exec(key)?.[1];
      return rawDate && staleRaw[rawDate] ? { date: rawDate, fixtures: staleRaw[rawDate] } : null;
    },
    hasSupabase: () => true,
    loadProviderFixturesForDate: async date => { calls.network.push(date); return network[date] || []; },
    loadSharedProviderState: async () => { calls.sharedLoads = (calls.sharedLoads || 0) + 1; },
    normalizeCompetition: leagueId => ({ youth: false, friendly: false, lower: false, featured: leagueId === 39 }),
    providerSnapshot: () => snapshot,
    recordOpsEvent: async (_cfg, event) => { calls.events.push(event); },
    supaRpc: async (_cfg, name, params) => {
      calls.rpc.push({ name, params });
      return { allowed: rpcAllowed(calls.rpc.length) };
    },
    supaSelectMany: async (_cfg, table, filters) => {
      calls.selects.push({ table, filters });
      if (table === 'favorites') return favorites.map(team_id => ({ team_id }));
      if (table === 'model_predictions') return predicted.map(fixture_id => ({ fixture_id }));
      if (table === 'provider_rate_windows') return rateRows;
      return [];
    },
  });
  return { rt, calls };
}

const at = new Date(NOW);

test('job: a fixture that already has a model_predictions row is never selected again', async () => {
  const feed = { matches: [match(1, 120, { isTop: true }), match(2, 180, { isTop: true }), match(3, 240, { isTop: true })] };
  const { rt, calls } = job({ feed, predicted: [1] });
  const result = await rt.processPrematchPredictions({}, at);
  assert.deepEqual(calls.analyzed, [2, 3]);
  assert.equal(result.computed, 2);
  assert.equal(result.withoutPrediction, 2);
  const lookup = calls.selects.find(row => row.table === 'model_predictions');
  assert.equal(lookup.filters.fixture_id, 'in.(1,2,3)');
  assert.equal(calls.events.length, 1, 'one aggregated ops event per run');
  assert.equal(calls.sharedLoads, 1, 'shared provider quota is loaded before the budget decision');
  assert.equal(calls.events[0].meta.computed, 2);
});

test('job: per-run cap, daily cap and provider limits stop the run', async () => {
  const feed = { matches: [1, 2, 3, 4].map(id => match(id, 60 + id * 10, { isTop: true })) };
  const perRun = await job({ feed }).rt.processPrematchPredictions({ prematchPredictionsPerRun: 1 }, at);
  assert.equal(perRun.computed, 1);

  const daily = job({ feed, rpcAllowed: n => n === 1 });
  const dailyResult = await daily.rt.processPrematchPredictions({}, at);
  assert.deepEqual(daily.calls.analyzed, [1]);
  assert.equal(dailyResult.stopReason, 'daily_limit');
  // Окно RPC не длиннее часа — сутки собираются из 24 часовых корзин.
  assert.equal(daily.calls.rpc[0].params.p_bucket_key, 'prematch-predictions:h12');
  assert.equal(daily.calls.rpc[0].params.p_window_seconds, 3600);
  assert.equal(daily.calls.rpc[0].params.p_limit, 20);

  const usedToday = job({ feed, rateRows: [
    { bucket_key: 'prematch-predictions:h03', window_started_at: '2026-10-11T03:00:00.000Z', request_count: 12 },
    { bucket_key: 'prematch-predictions:h09', window_started_at: '2026-10-11T09:00:00.000Z', request_count: 8 },
    { bucket_key: 'prematch-predictions:h23', window_started_at: '2026-10-10T23:00:00.000Z', request_count: 9 },
  ] });
  const usedResult = await usedToday.rt.processPrematchPredictions({}, at);
  assert.deepEqual(usedToday.calls.analyzed, [], '12 + 8 used today reaches the daily cap of 20; yesterday is not counted');
  assert.equal(usedResult.reason, 'daily_limit');
  assert.equal(usedToday.calls.rpc.length, 0);
  assert.deepEqual(usedToday.calls.cacheReads, [], 'an exhausted daily cap is checked before any feed is loaded');
  assert.deepEqual(usedToday.calls.network, []);

  const limited = job({ feed, analyze: () => jsonResponse({ error: 'limited' }, 429) });
  const limitedResult = await limited.rt.processPrematchPredictions({}, at);
  assert.deepEqual(limited.calls.analyzed, [1]);
  assert.equal(limitedResult.stopReason, 'provider_limited');

  const thrown = job({ feed, analyze: () => { throw Object.assign(new Error('rate'), { code: 'FOOTBALL_RATE_LIMIT' }); } });
  const thrownResult = await thrown.rt.processPrematchPredictions({}, at);
  assert.deepEqual(thrown.calls.analyzed, [1]);
  assert.equal(thrownResult.failed, 1);
  assert.equal(thrownResult.stopReason, 'provider_limited');
});

test('job: skips quietly without provider budget, outside the interval, when disabled or without the cached feed', async () => {
  const feed = { matches: [match(1, 120, { isTop: true })] };
  const cases = [
    [{ snapshot: { plan: 'FREE', dailyRemaining: 10, updatedAt: new Date(NOW - 60_000).toISOString() } }, {}, at, 'provider_daily_reserve'],
    [{ snapshot: { plan: 'PRO', cooldownActive: true } }, {}, at, 'provider_cooldown'],
    [{}, {}, new Date(NOW + 5 * 60000), 'interval'],
    [{}, { prematchPredictionsEnabled: false }, at, 'disabled'],
  ];
  for (const [options, cfg, when, reason] of cases) {
    const { rt, calls } = job({ feed, ...options });
    const result = await rt.processPrematchPredictions(cfg, when);
    assert.equal(result.reason, reason);
    assert.deepEqual(calls.analyzed, []);
    assert.deepEqual(calls.events, [], 'no ops noise on a quiet skip');
  }
  const noFeed = job({ feed: null });
  assert.equal((await noFeed.rt.processPrematchPredictions({}, at)).reason, 'feed_not_cached');
});

function rawFixture(id, minutes, leagueId, homeId, awayId) {
  return { fixture: { id, date: iso(minutes), status: { short: 'NS' } }, league: { id: leagueId, name: `League ${leagueId}` }, teams: { home: { id: homeId }, away: { id: awayId } } };
}

test('job: a cold deployment reuses the stale raw fixture cache instead of refetching', async () => {
  const day = [rawFixture(701, 120, 39, 1, 2)];
  const cold = job({ feed: null, network: { '2026-10-11': day } });
  await cold.rt.processPrematchPredictions({}, at);
  assert.deepEqual(cold.calls.network, ['2026-10-11', '2026-10-12'], 'nothing cached at all: one fetch per date');

  const expired = job({ feed: null, staleRaw: { '2026-10-11': day, '2026-10-12': [] } });
  await expired.rt.processPrematchPredictions({}, at);
  assert.deepEqual(expired.calls.network, [], 'an expired raw cache (even an empty day) is reused, not refetched');

  const withFeed = job({ feed: { matches: [match(1, 120, { isTop: true })] } });
  await withFeed.rt.processPrematchPredictions({}, at);
  assert.deepEqual(withFeed.calls.network.filter(date => date === '2026-10-11'), [], 'a normalized feed never triggers a network fetch for its date');
});

test('job: a favorite fixture outside the 120-match feed is found in the full raw batch', async () => {
  const feed = { matches: [match(1, 120, { isTop: true, interestScore: 90 })] };
  const raw = { '2026-10-11': [rawFixture(1, 120, 39, 11, 12), rawFixture(801, 100, 555, 77, 78)] };
  const { rt, calls } = job({ feed, raw, favorites: [77] });
  await rt.processPrematchPredictions({ prematchPredictionsPerRun: 2 }, at);
  assert.deepEqual(calls.analyzed, [801, 1], 'favorite first, then the top match; no duplicate of fixture 1');
  assert.deepEqual(calls.network, ['2026-10-12'], 'only the uncached tomorrow is fetched');
});

test('job: favorites are looked up for every team of the feed, in chunks', async () => {
  const matches = Array.from({ length: 180 }, (_, i) => match(1000 + i, 60 + i, i === 179 ? {} : { isTop: false }));
  const feed = { matches };
  const lastAway = matches[179].away.id;
  const { rt, calls } = job({ feed, favorites: [lastAway] });
  await rt.processPrematchPredictions({ prematchPredictionsPerRun: 1 }, at);
  const favoriteQueries = calls.selects.filter(row => row.table === 'favorites');
  assert.equal(favoriteQueries.length, 2, '360 teams → 2 queries of up to 200 ids');
  assert.deepEqual(calls.analyzed, [1179], 'a non-top match of a favorite team from the feed tail is still selected');
});

test('job: favorites of real users are prioritised over other main matches', async () => {
  const feed = { matches: [match(1, 120, { isTop: true, interestScore: 99 }), match(2, 180)] };
  const { rt, calls } = job({ feed, favorites: [21] });
  await rt.processPrematchPredictions({ prematchPredictionsPerRun: 1 }, at);
  assert.deepEqual(calls.analyzed, [2]);
});

function analysisRuntime(overrides = {}) {
  const calls = { history: 0, quota: 0, reserve: 0, entitlements: 0, growth: 0, captured: 0, lockClaimed: 0, lockReleased: 0 };
  const clean = () => '';
  const rt = createAnalysisRuntime({
    cleanNewsImpactDecisionCode: clean,
    cleanNewsImpactActionCode: clean,
    cleanNewsImpactRecoveryCode: clean,
    json: (body, status = 200) => ({ body, status }),
    recordNewsImpactOutcome: async () => true,
    recordNewsImpactRecoveryAttempt: async () => true,
    recordNewsImpactFailure: async () => true,
    selectNewsImpactRecoveryStrategy: async () => ({ code: 'retry' }),
    newsImpactFailureCode: () => 'server_error',
    recordGrowthEvent: async () => { calls.growth += 1; },
    recordHistory: async () => { calls.history += 1; },
    getQuota: async () => { calls.quota += 1; return { used: 0, limit: 3, left: 3 }; },
    reserveAnalysisQuota: async () => { calls.reserve += 1; return { allowed: true }; },
    resolveUserEntitlements: async () => { calls.entitlements += 1; return { source: 'free', access: {} }; },
    captureModelPrediction: async () => { calls.captured += 1; },
    claimDistributedAnalysisLock: async () => { calls.lockClaimed += 1; return { claimed: true }; },
    releaseDistributedAnalysisLock: async () => { calls.lockReleased += 1; },
    analysisFreshness: () => ({ needsRecheck: false, state: 'fresh' }),
    getStaleCache: async () => null,
    recordOpsEvent: async () => {},
    ...overrides,
  });
  return { rt, calls };
}

test('system analysis entry: cached analysis only records the first prediction, no user side effects', async () => {
  const cached = { generatedAt: new Date().toISOString(), match: { fixtureId: 77, date: new Date(Date.now() + 3600000).toISOString(), status: 'NS' } };
  const { rt, calls } = analysisRuntime({ getCache: async () => cached });
  const res = await rt.analyzeFixtureForSystem(77, {});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, cached: true, fixtureId: 77 });
  assert.equal(calls.captured, 1);
  assert.deepEqual([calls.history, calls.quota, calls.reserve, calls.entitlements, calls.growth], [0, 0, 0, 0, 0]);
});

test('system analysis entry: fresh computation keeps the match lock but never touches quota, rights, history or growth', async () => {
  const { rt, calls } = analysisRuntime({
    getCache: async () => null,
    loadProviderFixture: async () => { throw Object.assign(new Error('provider down'), { code: 'FOOTBALL_NETWORK' }); },
  });
  await assert.rejects(rt.analyzeFixtureForSystem(77, {}), /provider down/);
  assert.equal(calls.lockClaimed, 1);
  assert.equal(calls.lockReleased, 1);
  assert.deepEqual([calls.history, calls.quota, calls.reserve, calls.entitlements, calls.growth], [0, 0, 0, 0, 0]);
  assert.equal((await rt.analyzeFixtureForSystem(0, {})).status, 400);
});

test('wiring: cron task, feed enrichment and card fallback', () => {
  const scheduled = fs.readFileSync('src/scheduled-jobs.js', 'utf8');
  assert.match(scheduled, /\['prematch_predictions', remindersTask\.then\(\(\) => run\('prematch_predictions', \(\) => processPrematchPredictions\(cfg, scheduledAt\)\)\)\]/);
  const feed = fs.readFileSync('src/provider-fixture-runtime.js', 'utf8');
  const api = feed.slice(feed.indexOf('async function apiMatches('), feed.indexOf('\n  }\n', feed.indexOf('async function apiMatches(')));
  assert.doesNotMatch(api, /return json\(/, 'every feed response passes through respondWithPredictions');
  const app = fs.readFileSync('public/app.js', 'utf8');
  // Идущий матч тоже проходит через aiConfidenceMeterHtml: там только оценка по ходу матча.
  assert.match(app, /\$\{!m\.finished \? aiConfidenceMeterHtml\(aiHistory, m\) : ''\}/);
  assert.match(fs.readFileSync('public/modules/home-signal.js', 'utf8'), /aiConfidenceMeterHtml\(aiHistory, match\)/);
  const wrangler = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(wrangler.vars.PREMATCH_PREDICTIONS_DAILY_LIMIT, '60');
});

test('Mini App card draws feed probabilities only when they are valid', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const block = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
  const escapeHtml = value => String(value ?? '');
  const source = [block('function aiProbabilityBarHtml(', '\nfunction feedModelProbabilities'), block('function feedModelProbabilities(', '\nfunction matchCardHtml')].join('\n');
  const meter = new Function('escapeHtml', `${source}\nreturn aiConfidenceMeterHtml;`)(escapeHtml);
  const html = meter(null, { aiProbabilities: { home: 52.3, draw: 26.1, away: 21.6 } });
  assert.match(html, /mr-prob/);
  assert.match(html, /52%/);
  assert.match(html, /Оценка модели до разбора/);
  assert.doesNotMatch(html, /AI-разбор готов/);
  for (const bad of [{ home: 80, draw: 30, away: 20 }, { home: 'x', draw: 1, away: 1 }, { home: -1, draw: 51, away: 50 }, null]) {
    assert.equal(meter(null, { aiProbabilities: bad }), '');
  }
  assert.match(meter({ aiConfidence: 70, aiProbabilities: { home: 50, draw: 30, away: 20 } }, null), /AI-разбор готов/);

  // Идущий матч: только оценка по ходу матча, предматчевые цифры (и из разбора) не показываются.
  const live = { live: true, aiProbabilities: { home: 52.3, draw: 26.1, away: 21.6 }, aiLiveProbabilities: { home: 76.6, draw: 17.3, away: 6.1, minute: 61 } };
  const liveHtml = meter({ aiConfidence: 70, aiProbabilities: { home: 50, draw: 30, away: 20 } }, live);
  assert.match(liveHtml, /77%/);
  assert.match(liveHtml, /Сейчас по ходу матча · 61′/);
  assert.doesNotMatch(liveHtml, /52%|50%|AI-разбор готов|до разбора/);
  assert.equal(meter(null, { live: true, aiProbabilities: { home: 52.3, draw: 26.1, away: 21.6 } }), '', 'no in-play estimate — nothing');
  assert.equal(meter(null, { live: true, aiLiveProbabilities: { home: 80, draw: 30, away: 20 } }), '');
});


function feedRuntime({ stale, probabilities, live = null }) {
  const asked = [];
  const askedLive = [];
  const methods = {
    ...(live ? { getLatestInPlayProbabilities: async ids => { askedLive.push(ids); if (live instanceof Error) throw live; return live; } } : {}),
    apiFootball: async () => [],
    bumpTelemetry: () => {},
    catalogRank: () => 0,
    getCache: async () => null,
    getStaleCache: async key => (key.startsWith('matches:') ? stale : null),
    getModelProbabilities: async ids => { asked.push(ids); if (probabilities === 'hang') return new Promise(() => {}); if (probabilities instanceof Error) throw probabilities; return probabilities; },
    isFootballRateLimitError: () => false,
    isRetryableFootballTransportError: () => false,
    isFinishedStatus: () => false,
    isLiveStatus: () => false,
    isTopLeague: () => false,
    json: body => ({ body }),
    liveRefreshSeconds: () => 90,
    markCachedSourceMeta: (meta, extra) => ({ ...meta, ...extra }),
    matchInterestScore: () => 0,
    matchStatusRank: () => 0,
    normalizeCompetition: () => ({}),
    normalizeRoundLabel: () => '',
    persistIntegrityRun: async () => {},
    providerBudgetProfile: () => ({ paid: false }),
    publicDataCapabilities: () => ({}),
    runMatchIntegrityGuard: () => ({ accepted: [], report: {}, issues: [] }),
    scoreSnapshot: () => ({}),
    setCache: async () => {},
    settlePredictionsFromFixtures: async () => {},
    sourceMeta: meta => meta,
    statusLabel: () => '',
    todayUtc: () => '2026-10-08',
  };
  return { client: createProviderFixtureRuntime(methods), asked, askedLive };
}

test('feed: live matches get the latest in-play estimate, others never do', async () => {
  const stale = {
    date: '2026-10-10',
    sourceMeta: { provider: 'api-football' },
    matches: [
      { fixtureId: 301, live: true, home: { name: 'A' }, away: { name: 'B' } },
      { fixtureId: 302, home: { name: 'C' }, away: { name: 'D' }, aiLiveProbabilities: { home: 90, draw: 5, away: 5 } },
      { fixtureId: 303, live: true, home: { name: 'E' }, away: { name: 'F' } },
    ],
  };
  const { client, askedLive } = feedRuntime({ stale, probabilities: {}, live: { 301: { home: 76.6, draw: 17.3, away: 6.1, minute: 61 } } });
  const res = await client.apiMatches(new Request('https://x.test/api/matches?date=2026-10-10'), {});
  const byId = Object.fromEntries(res.body.matches.map(m => [m.fixtureId, m]));
  assert.deepEqual(askedLive, [[301, 303]], 'only live matches are looked up');
  assert.deepEqual(byId[301].aiLiveProbabilities, { home: 76.6, draw: 17.3, away: 6.1, minute: 61 });
  assert.equal(Object.hasOwn(byId[302], 'aiLiveProbabilities'), false, 'never passed through from the cached feed');
  assert.equal(Object.hasOwn(byId[303], 'aiLiveProbabilities'), false);

  const failing = feedRuntime({ stale, probabilities: {}, live: new Error('db down') });
  const fallback = await failing.client.apiMatches(new Request('https://x.test/api/matches?date=2026-10-10'), {});
  assert.equal(fallback.body.matches.length, 3);
  assert.ok(fallback.body.matches.every(m => !Object.hasOwn(m, 'aiLiveProbabilities')));
});

test('feed: /api/matches adds validated model probabilities for unfinished matches, independent of user history', async () => {
  const stale = {
    date: '2026-10-10',
    sourceMeta: { provider: 'api-football' },
    matches: [
      { fixtureId: 101, home: { name: 'A' }, away: { name: 'B' } },
      { fixtureId: 102, finished: true, home: { name: 'C' }, away: { name: 'D' } },
      { fixtureId: 103, home: { name: 'E' }, away: { name: 'F' }, aiProbabilities: { home: 99, draw: 1, away: 0 } },
    ],
  };
  const { client, asked } = feedRuntime({ stale, probabilities: { 101: { home: 52.3, draw: 26.1, away: 21.6 }, 102: { home: 40, draw: 30, away: 30 } } });
  const res = await client.apiMatches(new Request('https://x.test/api/matches?date=2026-10-10'), {});
  const byId = Object.fromEntries(res.body.matches.map(m => [m.fixtureId, m]));
  assert.deepEqual(asked, [[101, 103]], 'finished matches are not looked up');
  assert.deepEqual(byId[101].aiProbabilities, { home: 52.3, draw: 26.1, away: 21.6 });
  assert.equal(Object.hasOwn(byId[102], 'aiProbabilities'), false);
  assert.equal(Object.hasOwn(byId[103], 'aiProbabilities'), false, 'stale or foreign probabilities are never passed through');

  const failing = feedRuntime({ stale, probabilities: new Error('db down') });
  const fallback = await failing.client.apiMatches(new Request('https://x.test/api/matches?date=2026-10-10'), {});
  assert.equal(fallback.body.matches.length, 3, 'feed still works when predictions are unavailable');
  assert.ok(fallback.body.matches.every(m => !Object.hasOwn(m, 'aiProbabilities')));
});

test('feed: a slow prediction lookup never holds the match feed past its deadline', async () => {
  const stale = {
    date: '2026-10-10',
    sourceMeta: { provider: 'api-football' },
    matches: [{ fixtureId: 201, home: { name: 'A' }, away: { name: 'B' } }],
  };
  const { client, asked } = feedRuntime({ stale, probabilities: 'hang' });
  const started = Date.now();
  const res = await client.apiMatches(new Request('https://x.test/api/matches?date=2026-10-10'), {});
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `feed answered in ${elapsed} ms, well below the 6.5 s client timeout`);
  assert.equal(res.body.matches.length, 1);
  assert.equal(Object.hasOwn(res.body.matches[0], 'aiProbabilities'), false);
  const again = Date.now();
  await client.apiMatches(new Request('https://x.test/api/matches?date=2026-10-10'), {});
  assert.ok(Date.now() - again < 500, 'a timed-out lookup is cached briefly instead of waited on every request');
  assert.equal(asked.length, 1);
});

test('settings: the interval follows the 5-minute cron cadence', () => {
  assert.equal(prematchPredictionSettings({ prematchPredictionsIntervalMinutes: 7 }).intervalMinutes, 5);
  assert.equal(prematchPredictionSettings({ prematchPredictionsIntervalMinutes: 31 }).intervalMinutes, 30);
  assert.equal(prematchPredictionSettings({ prematchPredictionsIntervalMinutes: 33 }).intervalMinutes, 35);
  assert.equal(prematchPredictionSettings({ prematchPredictionsIntervalMinutes: 5 }).intervalMinutes, 5);
});

test('job: favorites lookup skips duplicate rows of a popular team by team_id keyset', async () => {
  const feed = { matches: [match(1, 120), match(2, 180)] };
  const popular = feed.matches[0].home.id; // 11
  const rare = feed.matches[1].away.id; // 22
  const queries = [];
  const rt = createPrematchPredictionJob({
    analyzeFixtureForSystem: async () => jsonResponse({ cached: false }),
    clock: () => NOW,
    getCache: async key => (key === 'matches:2026-10-11:v6-integrity' ? feed : null),
    getStaleCache: async () => null,
    hasSupabase: () => true,
    isTopLeague: () => false,
    loadProviderFixturesForDate: async () => [],
    loadSharedProviderState: async () => {},
    providerSnapshot: () => ({ plan: 'PRO' }),
    recordOpsEvent: async () => {},
    supaRpc: async () => ({ allowed: true }),
    supaSelectMany: async (_cfg, table, filters, options) => {
      if (table === 'favorites') {
        queries.push({ filters, options });
        const after = Number(/team_id\.gt\.(\d+)/.exec(filters.and)[1]);
        if (after < popular) return Array.from({ length: 1000 }, () => ({ team_id: popular })); // 1000+ fans
        if (after < rare) return [{ team_id: rare }];
        return [];
      }
      if (table === 'model_predictions') return [];
      return [];
    },
  });
  await rt.processPrematchPredictions({ prematchPredictionsPerRun: 2 }, new Date(NOW));
  assert.equal(queries.length, 2);
  assert.match(queries[0].filters.and, /^\(team_id\.in\.\(11,12,21,22\),team_id\.gt\.0\)$/);
  assert.equal(queries[0].options.order, 'team_id.asc');
  assert.match(queries[1].filters.and, /team_id\.gt\.11\)$/);
});

test('job: a cold match feed falls back to the raw fixtures of the day', async () => {
  const raw = [
    { fixture: { id: 501, date: iso(120), status: { short: 'NS' } }, league: { id: 39 }, teams: { home: { id: 1 }, away: { id: 2 } } },
    { fixture: { id: 502, date: iso(150), status: { short: 'NS' } }, league: { id: 999 }, teams: { home: { id: 3 }, away: { id: 4 } } },
    // Молодёжный матч избранной команды: в нормализованной ленте он lowPriority.
    { fixture: { id: 503, date: iso(90), status: { short: 'NS' } }, league: { id: 777, name: 'Premier League U21' }, teams: { home: { id: 7, name: 'Fav U21' }, away: { id: 8 } } },
  ];
  const analyzed = [];
  const asked = [];
  const rt = createPrematchPredictionJob({
    analyzeFixtureForSystem: async id => { analyzed.push(id); return jsonResponse({ cached: false }); },
    clock: () => NOW,
    getCache: async () => null,
    getStaleCache: async () => null,
    hasSupabase: () => true,
    isTopLeague: leagueId => leagueId === 39,
    loadProviderFixturesForDate: async (date, _cfg, options) => { asked.push({ date, options }); return date === '2026-10-11' ? raw : []; },
    loadSharedProviderState: async () => {},
    normalizeCompetition: (leagueId, leagueName) => {
      const youth = /U21/.test(leagueName);
      return { youth, friendly: false, lower: false, featured: leagueId === 39 };
    },
    providerSnapshot: () => ({ plan: 'PRO' }),
    recordOpsEvent: async () => {},
    supaRpc: async () => ({ allowed: true }),
    supaSelectMany: async (_cfg, table) => (table === 'favorites' ? [{ team_id: 7 }] : []),
  });
  const result = await rt.processPrematchPredictions({}, new Date(NOW));
  assert.deepEqual(asked.map(row => row.date), ['2026-10-11', '2026-10-12']);
  assert.deepEqual(analyzed, [501], 'only the top-league match of the raw day list; the favorite youth match is skipped');
  assert.equal(result.computed, 1);
});

test('job: raw fallback is fail-closed when the competition classifier is unavailable', async () => {
  const raw = [
    { fixture: { id: 601, date: iso(120), status: { short: 'NS' } }, league: { id: 39 }, teams: { home: { id: 1 }, away: { id: 2 } } },
  ];
  for (const normalizeCompetition of [undefined, () => { throw new Error('boom'); }, () => null]) {
    const analyzed = [];
    const rt = createPrematchPredictionJob({
      analyzeFixtureForSystem: async id => { analyzed.push(id); return jsonResponse({ cached: false }); },
      clock: () => NOW,
      getCache: async () => null,
      getStaleCache: async () => null,
      hasSupabase: () => true,
      isTopLeague: () => true,
      loadProviderFixturesForDate: async date => (date === '2026-10-11' ? raw : []),
      loadSharedProviderState: async () => {},
      normalizeCompetition,
      providerSnapshot: () => ({ plan: 'PRO' }),
      recordOpsEvent: async () => {},
      supaRpc: async () => ({ allowed: true }),
      supaSelectMany: async (_cfg, table) => (table === 'favorites' ? [{ team_id: 1 }] : []),
    });
    await rt.processPrematchPredictions({}, new Date(NOW));
    assert.deepEqual(analyzed, []);
  }
});
