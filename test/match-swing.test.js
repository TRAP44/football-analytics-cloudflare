import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMatchSwingJob, matchSwing, matchSwingText, MATCH_SWING_POLICY } from '../src/match-swing-job.js';
import { isBettingText } from '../src/signal-wording.js';

const NOW = Date.parse('2026-10-12T19:00:00Z');
const live = (over = {}) => ({ status: '1H', minute: 18, score: { home: 0, away: 1 }, home: 19, draw: 33, away: 48, ...over });

// Реальные случаи 10–12.10 из analysis_timeline_snapshots.
test('swing: the pre-match favourite lost ≥ 25 p.p. and the opponent now leads the estimate', () => {
  const swing = matchSwing({ home: 58, draw: 34, away: 8 }, live());
  assert.equal(swing.favorite, 'home');
  assert.equal(swing.other, 'away');
  assert.equal(swing.drop, 39);
  assert.deepEqual(swing.score, { home: 0, away: 1 });

  // 0:0 на 53-й: растёт ничья, соперник не лидер — не перелом.
  assert.equal(matchSwing({ home: 62, draw: 34, away: 4 }, live({ minute: 53, score: { home: 0, away: 0 }, home: 34, draw: 63, away: 3 })), null);
  // Нет явного фаворита (отрыв < 10 п. п.).
  assert.equal(matchSwing({ home: 40, draw: 28, away: 32 }, live({ home: 10, draw: 30, away: 60 })), null);
  // Падение меньше порога.
  assert.equal(matchSwing({ home: 50, draw: 30, away: 20 }, live({ home: 30, draw: 24, away: 46 })), null);
  // Соперник не лидер оценки (ниже 45%).
  assert.equal(matchSwing({ home: 60, draw: 25, away: 15 }, live({ home: 30, draw: 30, away: 40 })), null);
  // Матч не идёт / сломанные данные.
  assert.equal(matchSwing({ home: 58, draw: 34, away: 8 }, live({ status: 'FT' })), null);
  assert.equal(matchSwing({ home: 58, draw: 34, away: 8 }, live({ away: 80 })), null, 'probabilities must sum to ~100');
  assert.equal(matchSwing({ home: 58, draw: 34, away: 8 }, live({ score: { home: null, away: 1 } })), null);
  assert.equal(matchSwing({ home: 58, draw: 30, away: 30 }, live()), null, 'broken pre-match snapshot');
  // Гостевой фаворит и перерыв.
  const away = matchSwing({ home: 19, draw: 30, away: 51 }, live({ status: 'HT', minute: 45, score: { home: 1, away: 0 }, home: 51, draw: 28, away: 21 }));
  assert.equal(away.favorite, 'away');
  assert.equal(away.status, 'HT');
  assert.equal(MATCH_SWING_POLICY.minDropPp, 25);
});

test('text: only numbers from the snapshots, no betting words', () => {
  const swing = matchSwing({ home: 58, draw: 34, away: 8 }, live());
  const text = matchSwingText({ homeName: 'Арсенал', awayName: 'Челси' }, swing);
  assert.equal(text, [
    '⚡ Перелом матча',
    '',
    'Арсенал 0:1 Челси · 18′',
    'До матча модель отдавала преимущество команде Арсенал: 58%. Сейчас — 19%.',
    'Челси — 48% · ничья — 33%.',
    '',
    'Оценка модели по счёту и оставшемуся времени. Это аналитика, а не рекомендация.',
  ].join('\n'));
  assert.equal(isBettingText(text), false);
  const half = matchSwing({ home: 19, draw: 30, away: 51 }, live({ status: 'HT', minute: 45, score: { home: 1, away: 0 }, home: 51, draw: 28, away: 21 }));
  const channel = matchSwingText({ homeName: 'Ковентри', awayName: 'Ньюкасл' }, half, { channel: true });
  assert.match(channel, /Ковентри 1:0 Ньюкасл · перерыв/);
  assert.match(channel, /Как менялась оценка — в MatchRadar\.$/);
});

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
    completeIdempotency: async (key, meta) => { claims.set(key, { state: 'sent', claimId: meta?.claimId }); },
    releaseIdempotency: async (key, meta) => { if (claims.get(key)?.claimId === meta?.claimId) claims.delete(key); },
  };
}

const POINT = (fixtureId, over = {}) => ({
  fixture_id: fixtureId,
  captured_at: new Date(NOW - 60_000).toISOString(),
  match_status: '1H',
  match_minute: 18,
  home_prob: 19,
  draw_prob: 33,
  away_prob: 48,
  provenance: { score: { home: 0, away: 1 } },
  ...over,
});
const PREDICTION = (fixtureId, over = {}) => ({
  fixture_id: fixtureId, league_id: 39, league_name: 'Premier League', home_id: 10, away_id: 20,
  home_name: 'Арсенал', away_name: 'Челси', home_prob: 58, draw_prob: 34, away_prob: 8, ...over,
});

function harness({ points = [POINT(1)], predictions = [PREDICTION(1)], reminders = [{ telegram_id: 5 }], favorites = [{ telegram_id: 5 }, { telegram_id: 6 }], top = true, remindersEnabled = true } = {}) {
  const store = claimStore();
  const delivered = [];
  const filtered = [];
  const ops = [];
  const queries = [];
  const job = createMatchSwingJob({
    ...store,
    clock: () => NOW,
    deliverSmartNotification: async input => { delivered.push(input); return { state: 'sent' }; },
    filterRecipients: async (rows, eventType) => { filtered.push(eventType); return { rows }; },
    fixtureTelegramDeepLink: async (_cfg, id) => ({ url: `https://t.me/MatchRadarBot?startapp=f${id}` }),
    getCache: async key => store.claims.get(key) || null,
    hasSupabase: () => true,
    isTopLeague: () => top,
    loadRuntimeControls: async () => ({ value: { remindersEnabled } }),
    recordOpsEvent: async (_cfg, event) => { ops.push(event); return { _persistenceStatus: 'persistent' }; },
    supaSelectMany: async (_cfg, table, filters) => {
      queries.push({ table, filters });
      if (table === 'analysis_timeline_snapshots') return points;
      if (table === 'model_predictions') return predictions;
      if (table === 'match_reminders') return reminders;
      if (table === 'favorites') return favorites;
      return [];
    },
  });
  return { job, store, delivered, filtered, ops, queries };
}

test('personal: reminder holders get match.swing, fans of either team team.swing, one message per person', async () => {
  const { job, delivered, filtered, queries } = harness();
  const summary = await job.processMatchSwings({}, new Date(NOW));
  assert.equal(summary.swings, 1);
  assert.deepEqual(filtered, ['match.swing', 'team.swing']);
  assert.deepEqual(delivered.map(item => [item.row.telegram_id, item.eventType, item.category]), [[5, 'match.swing', 'match'], [6, 'team.swing', 'teams']]);
  assert.match(delivered[0].dedupeKey, /^v1:1:match\.swing:swing-/);
  assert.match(delivered[1].dedupeKey, /^v1:1:team\.swing:swing-/);
  assert.match(delivered[0].text, /Перелом матча/);
  assert.equal(delivered[0].row.fixture_id, 1);
  const points = queries.find(query => query.table === 'analysis_timeline_snapshots');
  assert.equal(points.filters.snapshot_key, 'like.in-play:*');
  assert.equal(points.filters.captured_at, `gte.${new Date(NOW - MATCH_SWING_POLICY.maxPointAgeMs).toISOString()}`);
  assert.equal(queries.find(query => query.table === 'favorites').filters.team_id, 'in.(10,20)');

  const off = harness({ remindersEnabled: false });
  await off.job.processMatchSwings({}, new Date(NOW));
  assert.equal(off.delivered.length, 0, 'the admin reminders switch also stops swing messages');

  const calm = harness({ points: [POINT(1, { home_prob: 50, draw_prob: 30, away_prob: 20 })] });
  assert.equal((await calm.job.processMatchSwings({}, new Date(NOW))).swings, 0);
  assert.equal(calm.delivered.length, 0);
});

test('channel off: one preview per match for top leagues only, nothing published', async () => {
  const { job, ops, store } = harness();
  await job.processMatchSwings({ channelSwingPostEnabled: false }, new Date(NOW));
  const preview = ops.filter(event => event.code === 'CHANNEL_SWING_POST_PREVIEW');
  assert.equal(preview.length, 1);
  assert.equal(preview[0].transitionKey, 'channel-swing-preview:1');
  assert.match(preview[0].message, /Как менялась оценка — в MatchRadar\./);
  assert.equal(store.claims.size, 0);

  const minor = harness({ top: false });
  await minor.job.processMatchSwings({}, new Date(NOW));
  assert.equal(minor.ops.filter(event => event.code === 'CHANNEL_SWING_POST_PREVIEW').length, 0);

  const branded = harness({ predictions: [PREDICTION(1, { home_name: 'Betway Stars' })] });
  await branded.job.processMatchSwings({}, new Date(NOW));
  assert.equal(branded.ops.filter(event => event.code === 'CHANNEL_SWING_POST_PREVIEW').length, 0);
});

test('channel on: at most three posts per Moscow day, one per match, failed posts free the slot', async () => {
  const ids = [1, 2, 3, 4];
  const { job, store, ops } = harness({ points: ids.map(id => POINT(id)), predictions: ids.map(id => PREDICTION(id)), reminders: [], favorites: [] });
  const cfg = { channelSwingPostEnabled: true, publisherBotToken: 'publisher-token', botToken: 'main-token', telegramChannelId: '@MatchRadarFootball' };
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 70 + sent.length } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const first = await job.processMatchSwings(cfg, new Date(NOW));
    assert.equal(first.channelPosted, 3);
    assert.equal(first.channelCapped, 1);
    const second = await job.processMatchSwings(cfg, new Date(NOW + 5 * 60_000));
    assert.equal(second.channelPosted, 0, 'no repeat posts for the same matches');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(sent.length, 3);
  assert.equal(sent[0].chat_id, '@MatchRadarFootball');
  assert.match(sent[0].text, /⚡ Перелом матча/);
  assert.equal(sent[0].reply_markup.inline_keyboard[0][0].url, 'https://t.me/MatchRadarBot?startapp=f1');
  assert.deepEqual([1, 2, 3].map(n => store.claims.get(`telegram:channel-publish:v1:swing-slot:2026-10-12:${n}`)?.state), ['sent', 'sent', 'sent']);
  assert.equal(ops.filter(event => event.code === 'CHANNEL_SWING_POST_PUBLISHED').length, 3);

  // Публикатор выключен — пост не вышел, слот дня освобождается.
  const disabled = harness({ reminders: [], favorites: [] });
  await disabled.job.processMatchSwings({ channelSwingPostEnabled: true }, new Date(NOW));
  assert.equal(disabled.store.claims.has('telegram:channel-publish:v1:swing-slot:2026-10-12:1'), false);
});

test('wiring: channel posts off by default, job runs after the in-play points are written', () => {
  const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
  assert.match(wrangler, /"CHANNEL_SWING_POST_ENABLED": "false"/);
  const infra = fs.readFileSync('src/common-infrastructure-runtime.js', 'utf8');
  assert.match(infra, /channelSwingPostEnabled: boolEnv\(env\.CHANNEL_SWING_POST_ENABLED, false\)/);
  const jobs = fs.readFileSync('src/scheduled-jobs.js', 'utf8');
  assert.match(jobs, /tasks\.push\(\['match_swing', inPlayTimelineTask\.then\(\(\) => run\('match_swing', \(\) => processMatchSwings\(cfg, scheduledAt\)\)\)\]\);/);
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.match(worker, /deliverSmartNotification: \(\.\.\.args\) => deliverSmartNotification\(\.\.\.args\),/);
});
