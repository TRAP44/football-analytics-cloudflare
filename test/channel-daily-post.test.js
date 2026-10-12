import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createChannelDailyPostJob, dailyPostCandidateIds, dailyPostMatches, dailyPostText, previewParts } from '../src/channel-daily-post-job.js';

const NOW = Date.parse('2026-10-12T08:05:00.000Z');
const row = (id, date, home, away, { status = 'NS', league = 'Premier League', leagueId = 39 } = {}) => ({
  fixture: { id, date, status: { short: status } },
  league: { id: leagueId, name: league },
  teams: { home: { name: home }, away: { name: away } },
});
const rows = [
  row(1, '2026-10-12T18:45:00.000Z', 'Спартак', 'Зенит', { league: 'Премьер-лига', leagueId: 235 }),
  row(2, '2026-10-12T16:00:00.000Z', 'Arsenal', 'Chelsea'),
  row(3, '2026-10-12T08:20:00.000Z', 'Soon FC', 'Late FC'), // меньше 30 минут до начала
  row(4, '2026-10-12T19:00:00.000Z', 'No Model', 'FC'),
  row(5, '2026-10-12T07:00:00.000Z', 'Live', 'FC', { status: '1H' }),
];
const predictions = {
  1: { home: 48, draw: 27, away: 25 },
  2: { home: 61.2, draw: 22.1, away: 16.7 },
  3: { home: 40, draw: 30, away: 30 },
  5: { home: 40, draw: 30, away: 30 },
};

test('the post lists only upcoming matches with a valid pre-match estimate, in kickoff order', () => {
  const matches = dailyPostMatches(rows, predictions, NOW);
  assert.deepEqual(matches.map(m => m.fixtureId), [2, 1]);
  const text = dailyPostText(matches, NOW);
  assert.match(text, /^⚽ Матчи дня по версии модели MatchRadar — 12 октября/);
  assert.match(text, /19:00 МСК · Arsenal — Chelsea \(Premier League\)\nArsenal 61% · Ничья 22% · Chelsea 17%/);
  assert.match(text, /21:45 МСК · Спартак — Зенит/);
  assert.match(text, /Это аналитика, а не рекомендация/);
  assert.doesNotMatch(text, /ставк|коэф|кэф|букмекер/i);
  assert.equal(dailyPostText([], NOW), '');
});

test('main matches win the five slots; broken estimates are dropped', () => {
  const many = Array.from({ length: 8 }, (_, i) => row(100 + i, `2026-10-12T1${i}:30:00.000Z`, `H${i}`, `A${i}`));
  const est = Object.fromEntries(many.map((_, i) => [100 + i, { home: 50, draw: 25, away: 25 }]));
  est[107] = { home: 90, draw: 30, away: 20 };
  const picked = dailyPostMatches(many, est, NOW, { isMain: item => item.fixture.id >= 104 });
  assert.equal(picked.length, 5);
  // Главные (104–106; 107 с битой суммой) берутся всегда, оставшиеся места — ближайшим.
  assert.deepEqual(picked.map(m => m.fixtureId), [100, 101, 104, 105, 106]);
});

test('a match after 21:00 UTC belongs to the next Moscow day and is not in today\'s post', () => {
  const late = [
    row(201, '2026-10-12T20:30:00.000Z', 'Вечер', 'FC'),
    row(202, '2026-10-12T22:30:00.000Z', 'Ночь', 'FC'),
  ];
  const est = { 201: { home: 50, draw: 25, away: 25 }, 202: { home: 50, draw: 25, away: 25 } };
  assert.deepEqual(dailyPostMatches(late, est, NOW).map(m => m.fixtureId), [201]);
  assert.deepEqual(dailyPostCandidateIds(late, NOW).map(entry => entry.id), [201]);
});

test('model snapshots are requested in chunks, main matches first, so a main match past row 200 is kept', async () => {
  const fixtures = Array.from({ length: 450 }, (_, i) => row(1000 + i, `2026-10-12T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`, `H${i}`, `A${i}`));
  const mainId = 1000 + 430;
  const calls = [];
  const job = createChannelDailyPostJob({
    clock: () => NOW,
    getCache: async key => (key.startsWith('provider-fixtures:') ? { fixtures } : null),
    getModelProbabilities: async ids => {
      calls.push(ids.length);
      return Object.fromEntries(ids.filter(id => id === mainId || id < 1003).map(id => [id, { home: 50, draw: 25, away: 25 }]));
    },
    isMainFixture: item => item.fixture.id === mainId,
    recordOpsEvent: async () => {},
    setCache: async () => {},
  });
  const ranked = dailyPostCandidateIds(fixtures, NOW, { isMain: item => item.fixture.id === mainId });
  assert.equal(ranked[0].id, mainId);
  const result = await job.processChannelDailyPost({}, new Date(NOW));
  assert.equal(result.reason, 'preview_recorded');
  assert.equal(result.matches, 4);
  assert.ok(calls.every(n => n <= 200));
  assert.equal(calls.length, 3, 'only 4 snapshots exist, so all chunks are read');

  const quick = [];
  const full = createChannelDailyPostJob({
    clock: () => NOW,
    getCache: async key => (key.startsWith('provider-fixtures:') ? { fixtures } : null),
    getModelProbabilities: async ids => { quick.push(ids.length); return Object.fromEntries(ids.map(id => [id, { home: 50, draw: 25, away: 25 }])); },
    recordOpsEvent: async () => {},
    setCache: async () => {},
  });
  assert.equal((await full.processChannelDailyPost({}, new Date(NOW))).matches, 5);
  assert.deepEqual(quick, [200], 'five snapshots found in the first chunk — no more requests');
});

function harness({ enabled = false, published = [], previewCached = false } = {}) {
  const ops = [];
  const cache = new Map(previewCached ? [['channel-daily-preview:2026-10-12:v1', { date: '2026-10-12' }]] : []);
  const job = createChannelDailyPostJob({
    claimIdempotency: async key => { published.push(['claim', key]); return { claimed: true, claimId: 'claim-1' }; },
    clock: () => NOW,
    completeIdempotency: async () => {},
    fixtureTelegramDeepLink: async (_cfg, id) => ({ url: `https://t.me/MatchRadarBot?startapp=f${id}` }),
    getCache: async key => (key.startsWith('provider-fixtures:') ? { date: '2026-10-12', fixtures: rows } : cache.get(key) || null),
    getModelProbabilities: async () => predictions,
    loadProviderFixturesForDate: async () => rows,
    recordOpsEvent: async (_cfg, event) => { ops.push(event); },
    releaseIdempotency: async () => {},
    setCache: async (key, _id, value) => { cache.set(key, value); },
  });
  return { job, ops, cache };
}

test('while disabled the job only records a preview, once a day, inside the 11:00 MSK window', async () => {
  const { job, ops, cache } = harness();
  assert.equal((await job.processChannelDailyPost({}, new Date('2026-10-12T12:00:00.000Z'))).reason, 'outside_window');
  const first = await job.processChannelDailyPost({ channelDailyPostEnabled: false }, new Date(NOW));
  assert.equal(first.reason, 'preview_recorded');
  assert.equal(ops[0].code, 'CHANNEL_DAILY_POST_PREVIEW');
  assert.match(ops[0].message, /Матчи дня/);
  assert.ok(cache.has('channel-daily-preview:2026-10-12:v1'));
  assert.equal((await job.processChannelDailyPost({}, new Date(NOW))).reason, 'preview_already_recorded');
});

test('a long post is previewed in parts under the 500-character journal limit, without losing text', async () => {
  const many = Array.from({ length: 5 }, (_, i) => row(300 + i, `2026-10-12T1${i}:30:00.000Z`, `Очень длинное название клуба ${i}`, `Ещё одно длинное название ${i}`, { league: 'Лига чемпионов УЕФА' }));
  const est = Object.fromEntries(many.map((_, i) => [300 + i, { home: 50, draw: 25, away: 25 }]));
  const text = dailyPostText(dailyPostMatches(many, est, NOW), NOW);
  assert.ok(text.length > 500);
  const parts = previewParts(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.length <= 480));
  assert.equal(parts.join('\n'), text);

  const ops = [];
  const cache = new Map();
  const job = createChannelDailyPostJob({
    clock: () => NOW,
    getCache: async key => (key.startsWith('provider-fixtures:') ? { fixtures: many } : cache.get(key) || null),
    getModelProbabilities: async () => est,
    recordOpsEvent: async (_cfg, event) => { ops.push(event); },
    setCache: async (key, _id, value) => { cache.set(key, value); },
  });
  await job.processChannelDailyPost({}, new Date(NOW));
  assert.equal(ops.map(event => event.message).join('\n'), text);
  assert.deepEqual(ops.map(event => `${event.meta.part}/${event.meta.parts}`), parts.map((_, i) => `${i + 1}/${parts.length}`));
  assert.equal(cache.get('channel-daily-preview:2026-10-12:v1').text, text);
});

test('when enabled it publishes with a per-day idempotency key and a deep link to the first match', async () => {
  const published = [];
  const { job } = harness({ enabled: true, published });
  const cfg = { channelDailyPostEnabled: true, publisherBotToken: 'publisher-token', botToken: 'main-token', telegramChannelId: '@MatchRadarFootball' };
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const result = await job.processChannelDailyPost(cfg, new Date(NOW));
    assert.equal(result.reason, 'published');
  } finally {
    globalThis.fetch = original;
  }
  assert.match(published[0][1], /key:channel-daily:2026-10-12$/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.chat_id, '@MatchRadarFootball');
  assert.match(sent[0].body.text, /Матчи дня по версии модели/);
  assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].url, 'https://t.me/MatchRadarBot?startapp=f2');
});

test('wiring: off by default, task only in the 11:00 MSK window', () => {
  const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
  assert.match(wrangler, /"CHANNEL_DAILY_POST_ENABLED": "false"/);
  const jobs = fs.readFileSync('src/scheduled-jobs.js', 'utf8');
  assert.match(jobs, /scheduledAt\.getUTCHours\(\) === 8 && scheduledAt\.getUTCMinutes\(\) < 15\) \{\n\s+tasks\.push\(\['channel_daily_post'/);
});
