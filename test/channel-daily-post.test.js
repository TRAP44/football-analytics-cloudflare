import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bettingFree, createChannelDailyPostJob, dailyPostCandidateIds, dailyPostMatches, dailyPostText, previewParts, textVersion } from '../src/channel-daily-post-job.js';

const NOW = Date.parse('2026-10-12T08:05:00.000Z');
// recordOpsEvent возвращает строку с невидимым _persistenceStatus.
const persisted = (event, status = 'persistent') => Object.defineProperty({ ...event }, '_persistenceStatus', { value: status, enumerable: false });
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

test('bookmaker branding never reaches the post: league label dropped, branded team skipped', () => {
  for (const name of ['Fonbet Кубок России', 'Liga Portugal Betclic', 'Fortuna Liga', 'Лига Ставок', 'Марафонбет Лига', 'Bet365 Cup', 'Betting League', 'Bookmaker Cup', 'Casino FC', 'Odds United']) {
    assert.equal(bettingFree(name), '', name);
  }
  for (const name of ['Premier League', 'Real Betis', 'Olimpija Ljubljana', 'Кубок России']) assert.equal(bettingFree(name), name);
  const branded = [
    row(401, '2026-10-12T15:00:00.000Z', 'Спартак', 'Зенит', { league: 'Fonbet Кубок России' }),
    row(402, '2026-10-12T16:00:00.000Z', 'Winline Team', 'FC'),
  ];
  const est = { 401: { home: 50, draw: 25, away: 25 }, 402: { home: 50, draw: 25, away: 25 } };
  const matches = dailyPostMatches(branded, est, NOW);
  assert.deepEqual(matches.map(m => m.fixtureId), [401]);
  const text = dailyPostText(matches, NOW);
  assert.match(text, /18:00 МСК · Спартак — Зенит\n/);
  assert.doesNotMatch(text, /fonbet|winline/i);
});

test('pagination stops only after five publishable matches: branded teams and broken snapshots do not count', async () => {
  const fixtures = Array.from({ length: 450 }, (_, i) => row(2000 + i, `2026-10-12T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`, i < 5 ? `Casino ${i}` : `H${i}`, `A${i}`));
  const calls = [];
  const job = createChannelDailyPostJob({
    ...claimStore(),
    clock: () => NOW,
    getCache: async key => (key.startsWith('provider-fixtures:') ? { fixtures } : null),
    getModelProbabilities: async ids => {
      calls.push(ids);
      const result = {};
      for (const id of ids) {
        const index = id - 2000;
        if (index < 5) result[id] = { home: 50, draw: 25, away: 25 }; // команды с брендом
        else if (index < 10) result[id] = { home: 90, draw: 30, away: 20 }; // битая сумма
        else if (index >= 300 && index < 305) result[id] = { home: 50, draw: 25, away: 25 };
      }
      return result;
    },
    recordOpsEvent: async event => persisted(event),
    setCache: async () => {},
  });
  const result = await job.processChannelDailyPost({}, new Date(NOW));
  assert.equal(result.matches, 5);
  assert.ok(calls.every(ids => ids.every(id => id - 2000 >= 5)), 'branded teams are not even requested');
  assert.equal(calls.length, 2, 'the second chunk is read because the first had no publishable match');
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
    ...claimStore(),
    clock: () => NOW,
    getCache: async key => (key.startsWith('provider-fixtures:') ? { fixtures } : null),
    getModelProbabilities: async ids => {
      calls.push(ids.length);
      return Object.fromEntries(ids.filter(id => id === mainId || id < 1003).map(id => [id, { home: 50, draw: 25, away: 25 }]));
    },
    isMainFixture: item => item.fixture.id === mainId,
    recordOpsEvent: async event => persisted(event),
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
    ...claimStore(),
    clock: () => NOW,
    getCache: async key => (key.startsWith('provider-fixtures:') ? { fixtures } : null),
    getModelProbabilities: async ids => { quick.push(ids.length); return Object.fromEntries(ids.map(id => [id, { home: 50, draw: 25, away: 25 }])); },
    recordOpsEvent: async event => persisted(event),
    setCache: async () => {},
  });
  assert.equal((await full.processChannelDailyPost({}, new Date(NOW))).matches, 5);
  assert.deepEqual(quick, [200], 'five snapshots found in the first chunk — no more requests');
});

// Заявки идемпотентности как в общей базе: вставка только если ключа ещё нет.
function claimStore() {
  const claims = new Map();
  let next = 0;
  return {
    claims,
    claimIdempotency: async key => {
      if (claims.has(key)) return { claimed: false, duplicate: true };
      const claimId = `claim-${++next}`;
      claims.set(key, { state: 'publishing', claimId });
      return { claimed: true, claimId };
    },
    completeIdempotency: async (key, meta) => { claims.set(key, { state: 'sent', claimId: meta.claimId }); },
    releaseIdempotency: async (key, meta) => { if (claims.get(key)?.claimId === meta.claimId) claims.delete(key); },
  };
}

function harness({ enabled = false, published = [], previewCached = false } = {}) {
  const ops = [];
  const cache = new Map(previewCached ? [['channel-daily-preview:2026-10-12:v1', { date: '2026-10-12' }]] : []);
  const store = claimStore();
  const job = createChannelDailyPostJob({
    claimIdempotency: async (key, meta) => { published.push(['claim', key]); return store.claimIdempotency(key, meta); },
    clock: () => NOW,
    completeIdempotency: store.completeIdempotency,
    fixtureTelegramDeepLink: async (_cfg, id) => ({ url: `https://t.me/MatchRadarBot?startapp=f${id}` }),
    getCache: async key => (key.startsWith('provider-fixtures:') ? { date: '2026-10-12', fixtures: rows } : cache.get(key) || store.claims.get(key) || null),
    getModelProbabilities: async () => predictions,
    loadProviderFixturesForDate: async () => rows,
    recordOpsEvent: async (_cfg, event) => { ops.push(event); return persisted(event); },
    releaseIdempotency: store.releaseIdempotency,
    setCache: async (key, _id, value) => { cache.set(key, value); },
  });
  return { job, ops, cache, store };
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
  assert.equal(ops.length, previewParts(ops.map(event => event.message).join('\n')).length, 'no duplicate parts');
});

// Журнал ops_events: одна строка на transitionKey (как record_ops_event_occurrence).
function opsJournal(fail = () => false) {
  const rows = new Map();
  const plain = [];
  return {
    rows,
    plain,
    recordOpsEvent: async (_cfg, event) => {
      if (fail(event)) return persisted(event, 'failed');
      if (event.transitionKey) rows.set(event.transitionKey, event);
      else plain.push(event);
      return persisted(event);
    },
  };
}

// Общий кеш видит строку заявки (заявка и кеш — одна таблица analysis_cache).
function sharedDeps(store, journal, extra = {}) {
  return {
    ...store,
    ...journal,
    clock: () => NOW,
    getCache: async key => (key.startsWith('provider-fixtures:') ? { fixtures: rows } : store.claims.get(key) || null),
    getModelProbabilities: async () => predictions,
    setCache: async () => {},
    ...extra,
  };
}

test('the day marker is a durable claim set after all parts: another isolate does not repeat the preview', async () => {
  const store = claimStore();
  const journal = opsJournal();
  const first = createChannelDailyPostJob(sharedDeps(store, journal));
  const second = createChannelDailyPostJob(sharedDeps(store, journal));
  assert.equal((await first.processChannelDailyPost({}, new Date(NOW))).reason, 'preview_recorded');
  const keys = [...journal.rows.keys()];
  assert.ok(keys.every(key => /^channel-daily-preview:2026-10-12:[0-9a-f]{12}:\d+\/\d+$/.test(key)));
  assert.equal(store.claims.get('telegram:channel-publish:v1:daily-preview:2026-10-12').state, 'sent');
  assert.equal((await second.processChannelDailyPost({}, new Date(NOW))).reason, 'preview_already_recorded');
  assert.equal(journal.rows.size, keys.length);
});

test('a partly saved preview is completed on the next run without duplicate parts', async () => {
  const store = claimStore();
  let failSecond = true;
  const journal = opsJournal(event => {
    if (failSecond && event.meta.part === 2) { failSecond = false; return true; }
    return false;
  });
  const many = Array.from({ length: 5 }, (_, i) => row(300 + i, `2026-10-12T1${i}:30:00.000Z`, `Очень длинное название клуба ${i}`, `Ещё одно длинное название ${i}`, { league: 'Лига чемпионов УЕФА' }));
  const est = Object.fromEntries(many.map((_, i) => [300 + i, { home: 50, draw: 25, away: 25 }]));
  const deps = sharedDeps(store, journal, {
    getCache: async key => (key.startsWith('provider-fixtures:') ? { fixtures: many } : store.claims.get(key) || null),
    getModelProbabilities: async () => est,
  });
  const job = createChannelDailyPostJob(deps);
  assert.equal((await job.processChannelDailyPost({}, new Date(NOW))).reason, 'preview_not_persisted');
  assert.equal(store.claims.size, 0, 'no marker — the next run retries');
  const savedFirst = journal.rows.size;
  assert.ok(savedFirst >= 1);
  assert.equal((await job.processChannelDailyPost({}, new Date(NOW))).reason, 'preview_recorded');
  const parts = previewParts(dailyPostText(dailyPostMatches(many, est, NOW), NOW));
  assert.equal(journal.rows.size, parts.length, 'each part is stored exactly once');
  assert.equal([...journal.rows.values()].sort((a, b) => a.meta.part - b.meta.part).map(event => event.message).join('\n'), parts.join('\n'));
});

test('a changed text on retry is written as a complete new version, never mixed with the old parts', async () => {
  const store = claimStore();
  let failAll = true;
  const journal = opsJournal(() => failAll && (failAll = false, true));
  let current = predictions;
  const job = createChannelDailyPostJob(sharedDeps(store, journal, { getModelProbabilities: async () => current }));
  assert.equal((await job.processChannelDailyPost({}, new Date(NOW))).reason, 'preview_not_persisted');
  const firstKeys = new Set(journal.rows.keys());
  current = { ...predictions, 1: { home: 40, draw: 30, away: 30 } };
  assert.equal((await job.processChannelDailyPost({}, new Date(NOW))).reason, 'preview_recorded');
  const text = dailyPostText(dailyPostMatches(rows, current, NOW), NOW);
  const version = await textVersion(text);
  const latest = [...journal.rows.values()].filter(event => event.meta.version === version).sort((a, b) => a.meta.part - b.meta.part);
  assert.equal(latest.map(event => event.message).join('\n'), text, 'the complete set of the latest version equals the text');
  assert.ok([...firstKeys].every(key => !key.includes(`:${version}:`)), 'old partial version is not mixed into the new one');
});

test('without the claim journal the preview is still written once per part', async () => {
  const journal = opsJournal();
  const job = createChannelDailyPostJob(sharedDeps({ claims: new Map(), claimIdempotency: async () => ({ claimed: false, unavailable: true }), completeIdempotency: async () => {}, releaseIdempotency: async () => {} }, journal));
  assert.equal((await job.processChannelDailyPost({}, new Date(NOW))).reason, 'preview_recorded');
  const size = journal.rows.size;
  assert.equal((await job.processChannelDailyPost({}, new Date(NOW))).reason, 'preview_recorded');
  assert.equal(journal.rows.size, size, 'repeated run updates the same rows');
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
    ...claimStore(),
    clock: () => NOW,
    getCache: async key => (key.startsWith('provider-fixtures:') ? { fixtures: many } : cache.get(key) || null),
    getModelProbabilities: async () => est,
    recordOpsEvent: async (_cfg, event) => { ops.push(event); return persisted(event); },
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
  // Сергей 13.10: «да» — публикация «Матчей дня» включена; в коде по умолчанию выключено.
  assert.match(wrangler, /"CHANNEL_DAILY_POST_ENABLED": "true"/);
  assert.match(fs.readFileSync('src/common-infrastructure-runtime.js', 'utf8'), /channelDailyPostEnabled: boolEnv\(env\.CHANNEL_DAILY_POST_ENABLED, false\)/);
  const jobs = fs.readFileSync('src/scheduled-jobs.js', 'utf8');
  assert.match(jobs, /scheduledAt\.getUTCHours\(\) === 8 && scheduledAt\.getUTCMinutes\(\) < 15\) \{\n\s+tasks\.push\(\['channel_daily_post'/);
});
