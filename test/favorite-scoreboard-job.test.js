import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  boardIsActive, normalizeBoard, scoreboardFixture, scoreboardRecipientIds, scoreboardText, SNAPSHOT_MAX_AGE_MS,
} from '../src/favorite-scoreboard-job.js';
import { createScoreboardHarness, fixtureRow, NOW } from '../scripts/scoreboard-harness.js';

// Живое табло любимых команд (#919) и его надёжность (Issue #921).

const fans = (count, teamId = 596, start = 1) => Array.from({ length: count }, (_, i) => ({ telegram_id: start + i, team_id: teamId }));
const timeout = () => Object.assign(new Error('Telegram sendMessage timeout'), { code: 'TELEGRAM_TIMEOUT' });

test('one message per match: sent once, edited as the score changes, closed after the final whistle', async () => {
  const h = createScoreboardHarness({ favorites: fans(1, 596, 11) });
  h.setFixtures([fixtureRow({ elapsed: 12 })]);
  let summary = await h.run();
  assert.equal(summary.sent, 1);
  assert.equal(h.sent[0].chat, 11);
  assert.match(h.sent[0].text, /🔴 <b>LIVE<\/b> · 12′/);
  assert.match(h.sent[0].text, /Zenit <b>0 : 0<\/b> Spartak Moscow/);

  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 12 })]);
  summary = await h.run();
  assert.equal(summary.unchanged, 1, 'same text — no edit');
  assert.equal(h.counters.telegram, 1);

  h.tick();
  h.setFixtures([fixtureRow({ status: '2H', elapsed: 63, home: 1 })]);
  summary = await h.run();
  assert.equal(summary.edited, 1);

  h.tick();
  h.setFixtures([fixtureRow({ status: 'FT', elapsed: 90, home: 2 })]);
  summary = await h.run();
  assert.equal(summary.closed, 1);
  assert.equal(h.board(7, 11).s, 'd');

  h.tick();
  h.setFixtures([fixtureRow({ status: 'FT', elapsed: 90, home: 2 })]);
  const before = h.counters.telegram;
  await h.run();
  assert.equal(h.counters.telegram, before, 'closed board is not touched again');
});

test('stale snapshot: yesterday’s 85-minute-old pack never creates or edits a LIVE board', async () => {
  const h = createScoreboardHarness({ favorites: fans(1, 596, 11), clockStart: Date.parse('2026-10-16T01:00:00Z') });
  // Вчерашний пакет живёт до 12 часов; снимок возрастом 85 минут.
  h.setFixtures([fixtureRow({ elapsed: 30, kickoff: '2026-10-15T23:00:00Z' })], { date: '2026-10-15', fetchedAt: h.now() - 85 * 60_000 });
  let summary = await h.run();
  assert.equal(h.sent.length, 0);
  assert.equal(summary.sent, 0);

  // Табло уже показано по свежему снимку; затем снова только устаревший — без правок.
  h.setFixtures([fixtureRow({ elapsed: 40, home: 1, kickoff: '2026-10-15T23:00:00Z' })], { date: '2026-10-15', fetchedAt: h.now() });
  await h.run();
  assert.equal(h.sent.length, 1);
  h.tick(15 * 60_000);
  h.setFixtures([fixtureRow({ elapsed: 50, home: 2, kickoff: '2026-10-15T23:00:00Z' })], { date: '2026-10-15', fetchedAt: h.now() - SNAPSHOT_MAX_AGE_MS - 60_000 });
  summary = await h.run();
  assert.equal(summary.edited, 0);
  assert.equal(summary.staleSkipped, 1);
  assert.equal(h.ops.at(-1).meta.staleSkipped, 1, 'stale skips are visible in the run record');
});

test('a snapshot not newer than the shown one does not roll the score back', async () => {
  const h = createScoreboardHarness({ favorites: fans(1, 596, 11) });
  h.setFixtures([fixtureRow({ elapsed: 60, home: 2 })], { fetchedAt: h.now() });
  await h.run();
  h.tick(60_000);
  // Свежий по возрасту, но снят раньше показанного: старый счёт 1:0.
  h.setFixtures([fixtureRow({ elapsed: 55, home: 1 })], { fetchedAt: h.now() - 2 * 60_000 });
  const summary = await h.run();
  assert.equal(summary.edited, 0);
  assert.equal(h.counters.telegram, 1);
});

test('final score closes the board even from an older snapshot; a final never turns back into LIVE', async () => {
  const h = createScoreboardHarness({ favorites: fans(1, 596, 11) });
  h.setFixtures([fixtureRow({ elapsed: 80 })]);
  await h.run();
  h.tick(30 * 60_000);
  h.setFixtures([fixtureRow({ status: 'FT', elapsed: 90, home: 1 })], { fetchedAt: h.now() - 25 * 60_000 });
  let summary = await h.run();
  assert.equal(summary.closed, 1);
  h.tick();
  h.setFixtures([fixtureRow({ status: '2H', elapsed: 88 })]);
  summary = await h.run();
  assert.equal(summary.edited + summary.sent, 0);
});

test('timeout on sendMessage → unknown: never resent, and the user keeps normal goal alerts', async () => {
  let fail = true;
  const h = createScoreboardHarness({
    favorites: fans(1, 596, 11),
    telegram: method => { if (method === 'sendMessage' && fail) { fail = false; throw timeout(); } },
  });
  h.setFixtures([fixtureRow()]);
  let summary = await h.run();
  assert.equal(summary.unknown, 1);
  assert.equal(h.board(7, 11).s, 'p');
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 20, home: 1 })]);
  summary = await h.run();
  assert.equal(h.counters.telegram, 1, 'no second sendMessage after an unknown outcome');
  assert.equal(summary.unknownPending, 1);
  const getCache = async key => h.store.get(key) ?? null;
  assert.deepEqual([...await scoreboardRecipientIds(getCache, 7, {})], [], 'pending is not an active board — goal alerts stay on');
});

test('definite Telegram rejection clears the mark and retries next run; 429 pauses until retry_after', async () => {
  let mode = 'reject';
  const h = createScoreboardHarness({
    favorites: fans(3, 596, 11),
    telegram: method => {
      if (method !== 'sendMessage') return undefined;
      if (mode === 'reject') { mode = 'ok'; throw Object.assign(new Error('Bad Request: chat not available'), { status: 400, code: 'TELEGRAM_REJECTED' }); }
      if (mode === 'limit') { mode = 'ok'; throw Object.assign(new Error('Too Many Requests'), { status: 429, code: 'TELEGRAM_RATE_LIMIT', retryAfter: 120 }); }
      return undefined;
    },
  });
  h.setFixtures([fixtureRow()]);
  let summary = await h.run();
  assert.equal(summary.sent, 2);
  assert.equal(h.board(7, 11), undefined, 'rejected user has no mark');
  h.tick();
  h.setFixtures([fixtureRow()]);
  summary = await h.run();
  assert.equal(summary.sent, 1, 'rejected user gets the board on the next run');

  const limited = createScoreboardHarness({
    favorites: fans(3, 596, 11),
    telegram: method => { if (method === 'sendMessage' && mode !== 'done') { mode = 'done'; throw Object.assign(new Error('Too Many Requests'), { status: 429, code: 'TELEGRAM_RATE_LIMIT', retryAfter: 120 }); } },
  });
  limited.setFixtures([fixtureRow()]);
  summary = await limited.run();
  assert.equal(summary.stopped, 'rate_limited');
  assert.equal(limited.counters.telegram, 1, 'run stops at the first 429');
  assert.equal(Object.keys(limited.store.get('scoreboard:7:v1').users).length, 0, 'untouched marks are cleared');
  limited.tick(60_000);
  summary = await limited.run();
  assert.equal(summary.reason, 'rate_limit_pause');
  limited.tick(5 * 60_000);
  limited.setFixtures([fixtureRow()]);
  summary = await limited.run();
  assert.equal(summary.sent, 3);
});

test('lost save after a successful send never produces a duplicate', async () => {
  // 1-я запись — отметки «отправляю», 2-я (после отправки) не удалась.
  const h = createScoreboardHarness({ favorites: fans(1, 596, 11), failSaveAt: saves => saves === 2 });
  h.setFixtures([fixtureRow()]);
  let summary = await h.run();
  assert.equal(summary.stopped, 'checkpoint_failed');
  assert.equal(h.sent.length, 1);
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 20 })]);
  summary = await h.run();
  assert.equal(h.sent.length, 1, 'pending mark blocks a second board');

  const noClaim = createScoreboardHarness({ favorites: fans(1, 596, 11), failSaveAt: () => true });
  noClaim.setFixtures([fixtureRow()]);
  summary = await noClaim.run();
  assert.equal(noClaim.counters.telegram, 0, 'nothing is sent without a saved mark');
});

test('audience larger than one run and one page: everyone gets exactly one board, no one is dropped', async () => {
  const total = 1300;
  const h = createScoreboardHarness({ favorites: fans(total), maxMessagesPerRun: 400, discoveryMaxRows: 500 });
  const runs = [];
  for (let i = 0; i < 8 && h.sent.length < total; i += 1) {
    h.setFixtures([fixtureRow({ elapsed: 10 + i })]);
    runs.push(await h.run());
    h.tick();
  }
  const chats = h.sent.map(s => s.chat);
  assert.equal(new Set(chats).size, total, 'every fan got a board');
  assert.equal(chats.length, total, 'no duplicates');
  assert.ok(runs.some(r => r.discovery.truncated), 'favorites were read in several slices');
  assert.ok(runs.some(r => r.capped), 'per-run cap was hit');
});

test('fair order: finals first, then edits and new boards share the budget; oldest edits first', async () => {
  const h = createScoreboardHarness({ favorites: fans(30), maxMessagesPerRun: 30 });
  h.setFixtures([fixtureRow()]);
  await h.run();
  assert.equal(h.sent.length, 30);
  // Пришли ещё 30 болельщиков, счёт изменился, бюджет 30: правки и новые делят его.
  h.tick();
  const more = createScoreboardHarness({ favorites: fans(60), maxMessagesPerRun: 30 });
  for (const [key, value] of h.store) more.store.set(key, value);
  more.tick(h.now() - more.now());
  more.setFixtures([fixtureRow({ elapsed: 30, home: 1 })]);
  const summary = await more.run();
  assert.ok(summary.edited > 0 && summary.sent > 0, 'both edits and new boards progress');
  assert.equal(summary.edited + summary.sent, 30);
  assert.ok(summary.deferred > 0 && summary.oldestWaitSec > 0, 'backlog and the oldest wait are reported');
});

test('one aggregated ops record per run with counts and reasons', async () => {
  const h = createScoreboardHarness({ favorites: fans(5), maxMessagesPerRun: 3 });
  h.setFixtures([fixtureRow()]);
  await h.run();
  assert.equal(h.ops.length, 1);
  const { meta, code } = h.ops[0];
  assert.equal(code, 'FAVORITE_SCOREBOARD_RUN');
  for (const key of ['sent', 'edited', 'closed', 'unchanged', 'deferred', 'staleSkipped', 'unknown', 'failed', 'oldestWaitSec', 'telegramCalls', 'dbWrites', 'discovery']) {
    assert.ok(key in meta, key);
  }
  assert.equal(meta.sent, 3);
  assert.equal(meta.deferred, 2);
});

test('users with goal alerts off get nothing; FAVORITE_SCOREBOARD_ENABLED=false turns everything off', async () => {
  const off = createScoreboardHarness({ favorites: fans(3), allow: () => [] });
  off.setFixtures([fixtureRow()]);
  await off.run();
  assert.equal(off.counters.telegram, 0);

  const h = createScoreboardHarness({ favorites: fans(3) });
  h.setFixtures([fixtureRow()]);
  const summary = await h.run({ favoriteScoreboardEnabled: false });
  assert.equal(summary.reason, 'disabled');
  assert.equal(h.counters.telegram, 0);
  const getCache = async () => ({ users: { 1: { m: 5 } } });
  assert.deepEqual([...await scoreboardRecipientIds(getCache, 7, { favoriteScoreboardEnabled: false })], []);
});

test('blocked users are not retried; a deleted message closes the board without a new one', async () => {
  const h = createScoreboardHarness({
    favorites: fans(2, 596, 11),
    telegram: (method, payload) => {
      if (method === 'editMessageText' && payload.chat_id === 11) throw Object.assign(new Error('Forbidden: bot was blocked by the user'), { status: 403 });
      if (method === 'editMessageText' && payload.chat_id === 12) throw new Error('Bad Request: message to edit not found');
      return undefined;
    },
  });
  h.setFixtures([fixtureRow()]);
  await h.run();
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 20, home: 1 })]);
  await h.run();
  assert.equal(h.board(7, 11).s, 'b');
  assert.equal(h.board(7, 12).s, 'd');
  const calls = h.counters.telegram;
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 30, home: 2 })]);
  await h.run();
  assert.equal(h.counters.telegram, calls);
});

test('state compatibility: boards saved by #919 keep working', () => {
  assert.deepEqual(normalizeBoard({ messageId: 5, text: 'x', at: 10 }), { m: 5, h: normalizeBoard({ h: undefined, text: 'x', m: 1 }).h, a: 10 });
  assert.equal(normalizeBoard({ pending: true, at: 1 }).s, 'p');
  assert.equal(normalizeBoard({ blocked: true }).s, 'b');
  assert.equal(boardIsActive(normalizeBoard({ messageId: 5, done: true })), true);
  assert.equal(boardIsActive(normalizeBoard({ pending: true })), false);
});

test('status lines: half-time, stoppage time, penalties; invalid rows are ignored', () => {
  const row = (status, elapsed, extra) => ({ ...fixtureRow({ status, elapsed, home: 1, away: 1 }), fixture: { id: 7, date: '2026-10-15T18:00:00Z', status: { short: status, elapsed, extra } } });
  assert.match(scoreboardText(scoreboardFixture(row('HT', 45), NOW)), /⏸ <b>Перерыв<\/b>/);
  assert.match(scoreboardText(scoreboardFixture(row('2H', 90, 4), NOW)), /90\+4′/);
  assert.match(scoreboardText(scoreboardFixture(row('PEN', 120), NOW)), /по пенальти/);
  assert.equal(scoreboardFixture({ ...fixtureRow({ status: 'NS' }), goals: { home: null, away: null } }, NOW), null);
});

test('policy and measurements are documented', () => {
  const doc = fs.readFileSync('docs/LIVE_SCOREBOARD_RU.md', 'utf8');
  for (const word of ['pending', 'unknown', 'blocked', 'done', 'курсор', '429', '1000', '10000', 'scoreboard_deliveries']) assert.ok(doc.includes(word), word);
});

// Ревью Codex #925.

test('opt-out after the board: no edits or closing once goal alerts are off or the team is removed', async () => {
  const h = createScoreboardHarness({ favorites: fans(2, 596, 11) });
  h.setFixtures([fixtureRow()]);
  await h.run();
  assert.equal(h.sent.length, 2);
  h.setAllow(rows => rows.filter(row => row.telegram_id !== 11));
  h.favorites.splice(h.favorites.findIndex(row => row.telegram_id === 12), 1);
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 30, home: 1 })]);
  const summary = await h.run();
  assert.equal(summary.edited, 0);
  assert.equal(summary.optedOut, 2);
  assert.equal(h.counters.telegram, 2, 'no editMessageText after opt-out');
  h.tick();
  h.setFixtures([fixtureRow({ status: 'FT', elapsed: 90, home: 1 })]);
  await h.run();
  assert.equal(h.counters.telegram, 2, 'no closing edit either');
});

test('recipient re-check failure defers edits instead of sending them', async () => {
  let broken = false;
  const h = createScoreboardHarness({ favorites: fans(1, 596, 11), allow: rows => { if (broken) throw new Error('settings down'); return rows; } });
  h.setFixtures([fixtureRow()]);
  await h.run();
  broken = true;
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 30, home: 1 })]);
  let summary = await h.run();
  assert.equal(summary.edited, 0);
  assert.equal(summary.recheckFailed, true);
  assert.equal(summary.deferred, 1);
  broken = false;
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 35, home: 1 })]);
  summary = await h.run();
  assert.equal(summary.edited, 1);
});

test('several favorite teams of one user split by the page boundary: every match gets its board', async () => {
  const two = (id) => [{ telegram_id: id, team_id: 596 }, { telegram_id: id, team_id: 489 }];
  const matches = () => [fixtureRow({ id: 7 }), fixtureRow({ id: 8, homeId: 489, awayId: 505 })];
  const h = createScoreboardHarness({ favorites: two(11), discoveryMaxRows: 1 });
  for (let i = 0; i < 4; i += 1) { h.setFixtures(matches()); await h.run(); h.tick(); }
  assert.ok(h.board(7, 11)?.m && h.board(8, 11)?.m, 'both boards');
  assert.equal(h.sent.length, 2);

  const many = createScoreboardHarness({ favorites: [1, 2, 3, 4, 5].flatMap(two), discoveryMaxRows: 3 });
  for (let i = 0; i < 8; i += 1) { many.setFixtures(matches()); await many.run(); many.tick(); }
  const delivered = many.sent.map(s => s.message_id);
  assert.equal(many.sent.length, 10, 'five users × two matches, no duplicates');
  assert.equal(new Set(delivered).size, 10);
  for (const id of [1, 2, 3, 4, 5]) assert.ok(many.board(7, id)?.m && many.board(8, id)?.m, `user ${id}`);
});

test('time budget is checked before every send inside a claimed batch', async () => {
  const h = createScoreboardHarness({ favorites: fans(200), sendDelayMs: 1000, runTimeBudgetMs: 45_000 });
  h.setFixtures([fixtureRow()]);
  const started = h.now();
  const summary = await h.run();
  assert.ok(h.now() - started <= 47_000, `run lasted ${h.now() - started} ms`);
  assert.equal(summary.capped, true);
  assert.ok(summary.deferred > 0);
  const users = h.store.get('scoreboard:7:v1').users;
  assert.equal(Object.values(users).filter(b => b.s === 'p').length, 0, 'no stranded pending marks');
  for (let i = 0; i < 6 && h.sent.length < 200; i += 1) { h.tick(); h.setFixtures([fixtureRow()]); await h.run(); }
  assert.equal(h.sent.length, 200);
  assert.equal(new Set(h.sent.map(s => s.chat)).size, 200, 'no duplicates after continuation');
});

test('freshness uses the real execution time, not the cron slot', async () => {
  const h = createScoreboardHarness({ favorites: fans(1, 596, 11) });
  // Пакет обновлён после начала слота: не «из будущего».
  h.setFixtures([fixtureRow()], { fetchedAt: h.now() });
  let summary = await h.job.processFavoriteScoreboards({}, new Date(h.now() - 90_000));
  assert.equal(summary.sent, 1);
  // Запуск задержался: к слоту снимку было 5 минут, на деле уже 12.
  const late = createScoreboardHarness({ favorites: fans(1, 596, 11) });
  late.setFixtures([fixtureRow()], { fetchedAt: late.now() - 12 * 60_000 });
  summary = await late.job.processFavoriteScoreboards({}, new Date(late.now() - 7 * 60_000));
  assert.equal(summary.sent, 0);
});
