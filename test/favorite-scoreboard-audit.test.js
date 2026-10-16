import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreboardRecipientIds, SCOREBOARD_PAUSE_KEY } from '../src/favorite-scoreboard-job.js';
import { createScoreboardHarness, fixtureRow } from '../scripts/scoreboard-harness.js';

// Аудит LIVE-табло 16.10: потерянные уведомления о голах, пауза по 429, курсор.

const fans = (count, teamId = 596, start = 1) => Array.from({ length: count }, (_, i) => ({ telegram_id: start + i, team_id: teamId }));
const recipients = (h, at = h.now()) => scoreboardRecipientIds(async key => h.store.get(key) ?? null, 7, {}, at);

test('a board frozen by stale data stops suppressing goal alerts; fresh unchanged runs keep it', async () => {
  const h = createScoreboardHarness({ favorites: fans(1, 596, 11) });
  h.setFixtures([fixtureRow({ status: 'HT', elapsed: 45 })]);
  await h.run();
  assert.deepEqual([...await recipients(h)], [11], 'live board replaces goal alerts');
  // Перерыв: текст не меняется, данные свежие — табло по-прежнему актуально.
  for (let i = 0; i < 4; i += 1) { h.tick(); h.setFixtures([fixtureRow({ status: 'HT', elapsed: 45 })]); await h.run(); }
  assert.deepEqual([...await recipients(h)], [11], 'unchanged but fresh board still counts');
  // Источник перестал обновляться: табло стоит, гол из другого источника не должен теряться.
  const staleAt = h.now() - 11 * 60_000;
  for (let i = 0; i < 4; i += 1) { h.tick(); h.setFixtures([fixtureRow({ status: '2H', elapsed: 50, home: 1 })], { fetchedAt: staleAt }); await h.run(); }
  assert.deepEqual([...await recipients(h)], [], 'stale board → goal alerts resume');
});

test('a board the user deleted mid-match brings goal alerts back and is not re-sent', async () => {
  const h = createScoreboardHarness({
    favorites: fans(1, 596, 11),
    telegram: method => { if (method === 'editMessageText') throw new Error('Bad Request: message to edit not found'); },
  });
  h.setFixtures([fixtureRow()]);
  await h.run();
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 20, home: 1 })]);
  const summary = await h.run();
  assert.equal(summary.failed, 0, 'a deleted message is not an operational failure');
  assert.deepEqual([...await recipients(h)], [], 'goal alerts resume');
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 30, home: 2 })]);
  await h.run();
  assert.equal(h.sent.length, 1, 'no second board');
});

test('429 pause counts retry_after from the moment of the 429, not from the run start', async () => {
  let calls = 0;
  const h = createScoreboardHarness({
    favorites: fans(60),
    sendDelayMs: 1000,
    telegram: method => {
      if (method !== 'sendMessage') return undefined;
      calls += 1;
      if (calls === 40) throw Object.assign(new Error('Too Many Requests'), { status: 429, code: 'TELEGRAM_RATE_LIMIT', retryAfter: 30 });
      return undefined;
    },
  });
  h.setFixtures([fixtureRow()]);
  const summary = await h.run();
  assert.equal(summary.stopped, 'rate_limited');
  const pause = h.store.get(SCOREBOARD_PAUSE_KEY);
  assert.ok(pause.until >= h.now() + 29_000, `pause ends ${pause.until - h.now()} ms after the run — must cover retry_after`);
});

test('failed claim save: those fans stay in the queue (cursor does not skip them) and are counted', async () => {
  let saves = 0;
  const h = createScoreboardHarness({ favorites: fans(5), discoveryMaxRows: 3, failSaveAt: () => { saves += 1; return saves === 1; } });
  h.setFixtures([fixtureRow()]);
  const summary = await h.run();
  assert.equal(summary.stopped, 'checkpoint_failed');
  assert.equal(summary.discovery.next, 0, 'cursor stays before the unsent fans');
  assert.equal(summary.deferred, 3);
  for (let i = 0; i < 3 && h.sent.length < 5; i += 1) { h.tick(); h.setFixtures([fixtureRow()]); await h.run(); }
  assert.deepEqual(h.sent.map(s => s.chat).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test('a rate-limited edit is reported as deferred, not dropped from the backlog', async () => {
  const h = createScoreboardHarness({
    favorites: fans(1, 596, 11),
    telegram: method => { if (method === 'editMessageText') throw Object.assign(new Error('Too Many Requests'), { status: 429, retryAfter: 5 }); },
  });
  h.setFixtures([fixtureRow()]);
  await h.run();
  h.tick();
  h.setFixtures([fixtureRow({ elapsed: 20, home: 1 })]);
  const summary = await h.run();
  assert.equal(summary.stopped, 'rate_limited');
  assert.equal(summary.deferred, 1);
});
