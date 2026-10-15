import test from 'node:test';
import assert from 'node:assert/strict';

import { createFavoriteScoreboardJob, scoreboardFixture, scoreboardText } from '../src/favorite-scoreboard-job.js';

// Живое табло любимых команд (Сергей 15.10): одно сообщение на матч.

const NOW = Date.parse('2026-10-15T19:00:00Z');
const row = (status, elapsed, home, away, extra = {}) => ({
  fixture: { id: 7, date: '2026-10-15T18:00:00Z', status: { short: status, elapsed } },
  league: { name: 'Premier League' },
  teams: { home: { id: 596, name: 'Zenit' }, away: { id: 558, name: 'Spartak Moscow' } },
  goals: { home, away },
  ...extra,
});

function setup({ fixtures, favorites = [{ telegram_id: 11, team_id: 596 }], allow = rows => rows, failEdit = null, failSave = false } = {}) {
  const store = new Map([['provider-fixtures:2026-10-15:v1', { fixtures }]]);
  const calls = [];
  let saves = 0;
  let nextId = 100;
  const job = createFavoriteScoreboardJob({
    clock: () => NOW,
    filterRecipients: async rows => ({ rows: allow(rows) }),
    getCache: async key => store.get(key) ?? null,
    hasSupabase: () => true,
    setCache: async (key, _id, payload, _cfg, _ttl, options) => {
      assert.equal(options?.requireDurable, true);
      saves += 1;
      if (failSave === true || (typeof failSave === 'number' && saves >= failSave)) return false;
      store.set(key, payload);
      return true;
    },
    supaSelectPaged: async (_cfg, table, query, options) => {
      assert.equal(table, 'favorites');
      assert.match(query.team_id, /^in\.\(/);
      assert.equal(options.pageSize, 1000);
      return { rows: favorites, truncated: false };
    },
    telegramApi: async (method, _cfg, payload) => {
      calls.push({ method, payload });
      if (method === 'editMessageText' && failEdit) throw failEdit;
      return method === 'sendMessage' ? { message_id: nextId++ } : true;
    },
  });
  const run = async fixturesNow => {
    if (fixturesNow) store.set('provider-fixtures:2026-10-15:v1', { fixtures: fixturesNow });
    return job.processFavoriteScoreboards({}, new Date(NOW));
  };
  return { run, calls, store };
}

test('one message per match: sent once, edited as the score changes, closed after the final whistle', async () => {
  const { run, calls, store } = setup({ fixtures: [row('1H', 12, 0, 0)] });
  let summary = await run();
  assert.equal(summary.sent, 1);
  assert.equal(calls[0].method, 'sendMessage');
  assert.equal(calls[0].payload.chat_id, 11);
  assert.match(calls[0].payload.text, /🔴 <b>LIVE<\/b> · 12′/);
  assert.match(calls[0].payload.text, /Zenit <b>0 : 0<\/b> Spartak Moscow/);
  assert.deepEqual(calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data, 'match:menu:7');

  summary = await run();
  assert.equal(summary.unchanged, 1, 'same text — no edit');
  assert.equal(calls.length, 1);

  await run([row('2H', 63, 1, 0)]);
  assert.equal(calls[1].method, 'editMessageText');
  assert.equal(calls[1].payload.message_id, 100);
  assert.match(calls[1].payload.text, /Zenit <b>1 : 0<\/b>/);

  summary = await run([row('FT', 90, 2, 0)]);
  assert.equal(summary.closed, 1);
  assert.match(calls[2].payload.text, /✅ <b>Матч завершён<\/b>/);
  assert.equal(calls[2].payload.reply_markup.inline_keyboard[0][0].callback_data, 'match:review:7');
  assert.equal(store.get('scoreboard:7:v1').users[11].done, true);

  await run([row('FT', 90, 2, 0)]);
  assert.equal(calls.length, 3, 'closed board is not touched again');
});

test('a match already finished never starts a new board; users with goal alerts off get nothing', async () => {
  let { run, calls } = setup({ fixtures: [row('FT', 90, 2, 0)] });
  await run();
  assert.equal(calls.length, 0);

  ({ run, calls } = setup({ fixtures: [row('1H', 5, 0, 0)], allow: () => [] }));
  await run();
  assert.equal(calls.length, 0);
});

test('fans of both teams are deduplicated; a blocked user is not retried', async () => {
  const blocked = Object.assign(new Error('Forbidden: bot was blocked by the user'), { status: 403 });
  const { run, calls, store } = setup({
    fixtures: [row('1H', 10, 0, 0)],
    favorites: [{ telegram_id: 11, team_id: 596 }, { telegram_id: 11, team_id: 558 }, { telegram_id: 12, team_id: 558 }],
    failEdit: blocked,
  });
  await run();
  assert.deepEqual(calls.map(c => c.payload.chat_id).sort(), [11, 12]);
  await run([row('1H', 20, 1, 0)]);
  assert.equal(store.get('scoreboard:7:v1').users[11].blocked, true);
  const before = calls.length;
  await run([row('2H', 50, 1, 0)]);
  assert.equal(calls.length, before, 'blocked users are skipped');
});

test('status lines: half-time, stoppage time, penalties; invalid rows are ignored', () => {
  assert.match(scoreboardText(scoreboardFixture(row('HT', 45, 1, 1), NOW)), /⏸ <b>Перерыв<\/b>/);
  assert.match(scoreboardText(scoreboardFixture(row('2H', 90, 1, 1, { fixture: { id: 7, date: '2026-10-15T18:00:00Z', status: { short: '2H', elapsed: 90, extra: 4 } } }), NOW)), /90\+4′/);
  assert.match(scoreboardText(scoreboardFixture(row('PEN', 120, 1, 1), NOW)), /по пенальти/);
  assert.equal(scoreboardFixture(row('NS', null, null, null), NOW), null);
  assert.equal(scoreboardFixture(row('FT', 90, 1, 0, { fixture: { id: 7, date: '2026-10-14T10:00:00Z', status: { short: 'FT' } } }), NOW), null, 'old finals are ignored');
  assert.doesNotMatch(scoreboardText(scoreboardFixture(row('1H', 5, 0, 0, { teams: { home: { id: 1, name: '<b>X' }, away: { id: 2, name: 'Y' } } }), NOW)), /<b>X/);
});

test('switch FAVORITE_SCOREBOARD_ENABLED=false turns the job off', async () => {
  const { calls } = setup({ fixtures: [row('1H', 5, 0, 0)] });
  const job = createFavoriteScoreboardJob({
    filterRecipients: async () => ({ rows: [] }), getCache: async () => null, hasSupabase: () => true,
    setCache: async () => true, supaSelectPaged: async () => ({ rows: [] }), telegramApi: async () => ({}),
  });
  const summary = await job.processFavoriteScoreboards({ favoriteScoreboardEnabled: false });
  assert.equal(summary.reason, 'disabled');
  assert.equal(calls.length, 0);
});

test('a user following teams in two simultaneous matches gets both boards (filter is per user)', async () => {
  const other = { fixture: { id: 8, date: '2026-10-15T18:00:00Z', status: { short: '1H', elapsed: 30 } }, league: { name: 'Serie A' },
    teams: { home: { id: 489, name: 'AC Milan' }, away: { id: 505, name: 'Inter' } }, goals: { home: 0, away: 0 } };
  const { run, calls } = setup({
    fixtures: [row('1H', 10, 0, 0), other],
    favorites: [{ telegram_id: 11, team_id: 596 }, { telegram_id: 11, team_id: 489 }],
    allow: rows => rows.slice(0, 1),
  });
  await run();
  assert.equal(calls.filter(c => c.method === 'sendMessage').length, 2);
});

test('no durable «sending» mark — no message; mark saved but result lost — never sent twice', async () => {
  let { run, calls } = setup({ fixtures: [row('1H', 10, 0, 0)], failSave: true });
  let summary = await run();
  assert.equal(summary.stopped, 'checkpoint_failed');
  assert.equal(calls.length, 0, 'nothing is sent without a saved mark');

  // Отметка сохранена (1-я запись), запись после отправки не удалась (2-я).
  const second = setup({ fixtures: [row('1H', 10, 0, 0)], failSave: 2 });
  summary = await second.run();
  assert.equal(second.calls.filter(c => c.method === 'sendMessage').length, 1);
  await second.run([row('1H', 15, 1, 0)]);
  assert.equal(second.calls.filter(c => c.method === 'sendMessage').length, 1, 'pending mark blocks a duplicate');
});

test('new boards go before edits so the per-run cap reaches everyone', async () => {
  const favorites = [{ telegram_id: 11, team_id: 596 }];
  const { run, calls, store } = setup({ fixtures: [row('1H', 10, 0, 0)], favorites });
  await run();
  store.set('scoreboard:7:v1', { users: { ...store.get('scoreboard:7:v1').users } });
  favorites.push({ telegram_id: 12, team_id: 596 });
  calls.length = 0;
  await run([row('1H', 20, 1, 0)]);
  assert.deepEqual(calls.map(c => `${c.method}:${c.payload.chat_id}`), ['sendMessage:12', 'editMessageText:11']);
});

test('Telegram rate limit clears the «sending» mark and stops the run, so the user gets the board later', async () => {
  const limited = Object.assign(new Error('Too Many Requests'), { status: 429, code: 'TELEGRAM_RATE_LIMIT' });
  const favorites = [{ telegram_id: 11, team_id: 596 }, { telegram_id: 12, team_id: 596 }];
  const store = new Map([['provider-fixtures:2026-10-15:v1', { fixtures: [row('1H', 10, 0, 0)] }]]);
  let sends = 0;
  const job = createFavoriteScoreboardJob({
    clock: () => NOW,
    filterRecipients: async rows => ({ rows }),
    getCache: async key => store.get(key) ?? null,
    hasSupabase: () => true,
    setCache: async (key, _id, payload) => { store.set(key, payload); return true; },
    supaSelectPaged: async () => ({ rows: favorites }),
    telegramApi: async () => { sends += 1; if (sends === 1) throw limited; return { message_id: 500 + sends }; },
  });
  const summary = await job.processFavoriteScoreboards({}, new Date(NOW));
  assert.equal(summary.stopped, 'rate_limited');
  assert.equal(sends, 1);
  assert.deepEqual(store.get('scoreboard:7:v1').users, {});
  await job.processFavoriteScoreboards({}, new Date(NOW));
  assert.equal(Object.keys(store.get('scoreboard:7:v1').users).length, 2);
});
