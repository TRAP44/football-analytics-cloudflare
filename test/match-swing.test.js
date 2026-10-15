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
  const halfText = matchSwingText({ homeName: 'Ковентри', awayName: 'Ньюкасл' }, half);
  assert.match(halfText, /Ковентри 1:0 Ньюкасл · перерыв/);
  assert.equal(halfText.includes('MatchRadar'), false);
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

function harness({ points = [POINT(1)], predictions = [PREDICTION(1)], reminders = [{ telegram_id: 5 }], favorites = [{ telegram_id: 5 }, { telegram_id: 6 }], deliveries = [], truncated = [], top = true, remindersEnabled = true } = {}) {
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
      return [];
    },
    supaSelectPaged: async (_cfg, table, filters, options) => {
      queries.push({ table, filters, options });
      const rows = { match_reminders: reminders, favorites, smart_notification_deliveries: deliveries }[table] || [];
      return { rows, truncated: truncated.includes(table) };
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
  assert.equal(queries.find(query => query.table === 'favorites').options.maxRows, MATCH_SWING_POLICY.maxRecipientsPerFixture);
  assert.deepEqual(queries.find(query => query.table === 'smart_notification_deliveries').filters, { fixture_id: 'eq.1', event_type: 'in.("match.swing","team.swing")' });

  const off = harness({ remindersEnabled: false });
  await off.job.processMatchSwings({}, new Date(NOW));
  assert.equal(off.delivered.length, 0, 'the admin reminders switch also stops swing messages');

  const calm = harness({ points: [POINT(1, { home_prob: 50, draw_prob: 30, away_prob: 20 })] });
  assert.equal((await calm.job.processMatchSwings({}, new Date(NOW))).swings, 0);
  assert.equal(calm.delivered.length, 0);
});

test('channel: nothing is posted or previewed in the channel (Сергей 15.10)', async () => {
  const { job, ops, store } = harness();
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push(String(url)); return new Response('{}', { status: 200 }); };
  try {
    const summary = await job.processMatchSwings({ channelSwingPostEnabled: true, publisherBotToken: 'publisher-token', telegramChannelId: '@MatchRadarFootball' }, new Date(NOW));
    assert.equal(summary.swings, 1);
    assert.equal('channelPosted' in summary, false);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(sent, []);
  assert.equal(store.claims.size, 0);
  assert.equal(ops.filter(event => event.source === 'channel_publisher').length, 0);
  assert.equal(fs.readFileSync('src/match-swing-job.js', 'utf8').includes('publishChannelMessage'), false);
});

test('wiring: no channel switch, job runs after the in-play points are written', () => {
  assert.equal(fs.readFileSync('wrangler.jsonc', 'utf8').includes('CHANNEL_SWING_POST_ENABLED'), false);
  assert.equal(fs.readFileSync('src/common-infrastructure-runtime.js', 'utf8').includes('channelSwingPostEnabled'), false);
  const jobs = fs.readFileSync('src/scheduled-jobs.js', 'utf8');
  assert.match(jobs, /tasks\.push\(\['match_swing', inPlayTimelineTask\.then\(\(\) => run\('match_swing', \(\) => processMatchSwings\(cfg, scheduledAt\)\)\)\]\);/);
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.match(worker, /deliverSmartNotification: \(\.\.\.args\) => deliverSmartNotification\(\.\.\.args\),/);
});

// Ревью Codex #869: одно сообщение о переломе на человека и матч — в любом из двух поводов.
test('personal: a swing already delivered for one reason is not repeated for the other', async () => {
  // 5 получил по напоминанию, потом снял его (остался болельщиком); 6 получил как болельщик, потом поставил напоминание.
  const { job, delivered } = harness({
    reminders: [{ telegram_id: 6 }, { telegram_id: 7 }],
    favorites: [{ telegram_id: 5 }, { telegram_id: 8 }],
    deliveries: [{ telegram_id: 5, event_type: 'match.swing', status: 'sent' }, { telegram_id: 6, event_type: 'team.swing', status: 'unknown' }],
  });
  await job.processMatchSwings({}, new Date(NOW));
  assert.deepEqual(delivered.map(item => [item.row.telegram_id, item.eventType]), [[7, 'match.swing'], [8, 'team.swing']]);

  // Повтор того же повода (например, retry_pending) не отсекается — его решает дедупликация доставки.
  const retry = harness({ reminders: [{ telegram_id: 5 }], favorites: [], deliveries: [{ telegram_id: 5, event_type: 'match.swing', status: 'retry_pending' }] });
  await retry.job.processMatchSwings({}, new Date(NOW));
  assert.deepEqual(retry.delivered.map(item => item.row.telegram_id), [5]);

  // Неудачная попытка по напоминанию, напоминание снято, команда любимая — сообщение уйдёт как team.swing.
  const moved = harness({ reminders: [], favorites: [{ telegram_id: 5 }, { telegram_id: 10 }], deliveries: [{ telegram_id: 5, event_type: 'match.swing', status: 'retry_pending' }, { telegram_id: 9, event_type: 'match.swing', status: 'terminal_failed' }, { telegram_id: 10, event_type: 'match.swing', status: 'claimed' }] });
  await moved.job.processMatchSwings({}, new Date(NOW));
  assert.deepEqual(moved.delivered.map(item => [item.row.telegram_id, item.eventType]), [[5, 'team.swing'], [10, 'team.swing']]);
});

test('every qualifying match in a run is handled, no per-run cap', async () => {
  const ids = Array.from({ length: 14 }, (_, index) => index + 1);
  const { job, delivered } = harness({ points: ids.map(id => POINT(id)), predictions: ids.map(id => PREDICTION(id)), favorites: [] });
  const summary = await job.processMatchSwings({}, new Date(NOW));
  assert.equal(summary.swings, 14);
  assert.equal(new Set(delivered.map(item => item.row.fixture_id)).size, 14);
});

test('personal: a truncated audience is reported, not silently dropped', async () => {
  const { job, ops } = harness({ truncated: ['favorites'] });
  const summary = await job.processMatchSwings({}, new Date(NOW));
  assert.equal(summary.truncated, 1);
  assert.equal(summary.ok, false);
  const run = ops.find(event => event.eventType === 'match_swing_run');
  assert.equal(run.code, 'MATCH_SWING_RUN_DEGRADED');
  assert.match(run.message, /список получателей обрезан \(1\)/);
});
