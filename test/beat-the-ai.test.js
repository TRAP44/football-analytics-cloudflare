import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMatchPicksRuntime, publicPlayerName, scorePicks } from '../src/match-picks-runtime.js';
import { matchPickHtml, picksLeaderboardHtml } from '../public/modules/beat-ai.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const json = (body, status = 200) => ({ status, body });

function harness({ predictions = {}, picks = [], users = [], clock = NOW } = {}) {
  const upserts = [];
  const selects = [];
  const rt = createMatchPicksRuntime({
    clock: () => clock,
    hasSupabase: () => true,
    json,
    supaSelectMany: async (_cfg, table, filters, options) => {
      selects.push({ table, filters, options });
      if (table === 'model_predictions') {
        if (filters.fixture_id.startsWith('eq.')) {
          const row = predictions[Number(filters.fixture_id.slice(3))];
          return row ? [row] : [];
        }
        const ids = filters.fixture_id.slice(4, -1).split(',').map(Number);
        assert.equal(filters.settlement_verification_state, 'in.(confirmed,adjudicated)');
        return ids.map(id => predictions[id]).filter(row => row && row.status === 'settled' && ['confirmed', 'adjudicated'].includes(row.settlement_verification_state));
      }
      if (table === 'match_picks') {
        if (filters.telegram_id) {
          const user = Number(filters.telegram_id.slice(3));
          const fixture = Number(filters.fixture_id.slice(3));
          return picks.filter(row => row.telegram_id === user && row.fixture_id === fixture).map(row => ({ pick: row.pick }));
        }
        const offset = Number(filters.offset || 0);
        return picks.slice(offset, offset + options.limit);
      }
      if (table === 'users') {
        const ids = filters.telegram_id.slice(4, -1).split(',').map(Number);
        return users.filter(row => ids.includes(row.telegram_id));
      }
      return [];
    },
    supaUpsert: async (_cfg, table, row, conflict) => { upserts.push({ table, row, conflict }); },
  });
  return { rt, upserts, selects };
}

const upcoming = { fixture_id: 7, kickoff_at: '2026-10-12T18:00:00.000Z', status: 'pending', predicted_outcome: 'home', actual_outcome: null };
const post = body => new Request('https://x.test/api/match-pick', { method: 'POST', body: JSON.stringify(body) });
const get = id => new Request(`https://x.test/api/match-pick?fixtureId=${id}`);
const user = { id: 5 };

test('a pick is saved before kickoff and can be changed; the lock time comes from the model snapshot', async () => {
  const { rt, upserts } = harness({ predictions: { 7: upcoming } });
  const res = await rt.apiMatchPickSave(post({ fixtureId: 7, pick: 'draw' }), {}, user);
  assert.equal(res.status, 200);
  assert.equal(res.body.pick, 'draw');
  assert.equal(res.body.ai, 'home');
  assert.equal(res.body.open, true);
  assert.deepEqual(upserts[0], {
    table: 'match_picks',
    row: { telegram_id: 5, fixture_id: 7, pick: 'draw', kickoff_at: '2026-10-12T18:00:00.000Z', updated_at: '2026-10-12T12:00:00.000Z' },
    conflict: 'telegram_id,fixture_id',
  });
});

test('after kickoff the pick is locked and the saved pick is shown; no model snapshot — no game', async () => {
  const late = harness({ predictions: { 7: upcoming }, picks: [{ telegram_id: 5, fixture_id: 7, pick: 'away' }], clock: Date.parse('2026-10-12T18:00:00.000Z') });
  const locked = await late.rt.apiMatchPickSave(post({ fixtureId: 7, pick: 'home' }), {}, user);
  assert.equal(locked.status, 409);
  assert.equal(locked.body.code, 'PICK_LOCKED');
  assert.equal(locked.body.pick, 'away');
  assert.equal(late.upserts.length, 0);

  const none = harness();
  const res = await none.rt.apiMatchPickSave(post({ fixtureId: 9, pick: 'home' }), {}, user);
  assert.equal(res.body.code, 'NO_MODEL_PREDICTION');
  assert.equal((await none.rt.apiMatchPickGet(get(9), {}, user)).body.reason, 'no_model_prediction');
});

test('input is validated and the Telegram session is required', async () => {
  const { rt, upserts } = harness({ predictions: { 7: upcoming } });
  assert.equal((await rt.apiMatchPickSave(post({ fixtureId: 7, pick: 'win' }), {}, user)).body.code, 'PICK_INVALID');
  assert.equal((await rt.apiMatchPickSave(post({ fixtureId: 'x', pick: 'home' }), {}, user)).body.code, 'PICK_INVALID');
  assert.equal((await rt.apiMatchPickSave(new Request('https://x.test', { method: 'POST', body: 'x'.repeat(600) }), {}, user)).body.code, 'BAD_REQUEST');
  assert.equal((await rt.apiMatchPickSave(post({ fixtureId: 7, pick: 'home' }), {}, null)).status, 401);
  assert.equal((await rt.apiMatchPickGet(get(7), {}, {})).status, 401);
  assert.equal(upserts.length, 0);
});

test('a settled match shows the result and the points of the user and of AI', async () => {
  const settled = { ...upcoming, status: 'settled', actual_outcome: 'draw', settlement_verification_state: 'confirmed' };
  const { rt } = harness({ predictions: { 7: settled }, picks: [{ telegram_id: 5, fixture_id: 7, pick: 'draw' }] });
  const res = await rt.apiMatchPickGet(get(7), {}, user);
  assert.deepEqual(res.body.result, { actual: 'draw', userPoint: 1, aiPoint: 0, score: null, aiProbability: null, homeName: '', awayName: '', league: '' });
  // Данные для карточки «AI угадал» — из того же проверенного снимка.
  const full = harness({ predictions: { 7: { ...settled, actual_outcome: 'home', home_name: 'Спартак', away_name: 'Зенит', league_name: 'Премьер-лига', home_prob: 57.6, draw_prob: 24.1, away_prob: 18.3, actual_home_goals: 2, actual_away_goals: 1 } } });
  const card = (await full.rt.apiMatchPickGet(get(7), {}, user)).body.result;
  assert.deepEqual(card, { actual: 'home', userPoint: null, aiPoint: 1, score: { home: 2, away: 1 }, aiProbability: 58, homeName: 'Спартак', awayName: 'Зенит', league: 'Премьер-лига' });
  const broken = harness({ predictions: { 7: { ...settled, home_prob: 90, draw_prob: 30, away_prob: 20, actual_home_goals: -1, actual_away_goals: 'x' } } });
  const bad = (await broken.rt.apiMatchPickGet(get(7), {}, user)).body.result;
  assert.equal(bad.aiProbability, null, 'broken sum — no number');
  assert.equal(bad.score, null);
  assert.equal(res.body.open, false);
  // Итог ещё не прошёл проверку финальности — очков нет, «итог проверяется».
  for (const state of ['unverified', 'drift', null]) {
    const pending = harness({ predictions: { 7: { ...settled, settlement_verification_state: state } } });
    const body = (await pending.rt.apiMatchPickGet(get(7), {}, user)).body;
    assert.equal(body.result, null, String(state));
    assert.equal(body.verifying, true);
    assert.equal(body.open, false);
  }
});

test('scoring: 1 point per correct outcome, AI scored on the same matches, ties by fewer matches', () => {
  const settled = new Map([[1, { predicted: 'home', actual: 'home' }], [2, { predicted: 'away', actual: 'draw' }]]);
  const ranking = scorePicks([
    { telegram_id: 10, fixture_id: 1, pick: 'home' },
    { telegram_id: 10, fixture_id: 2, pick: 'away' },
    { telegram_id: 11, fixture_id: 1, pick: 'home' },
    { telegram_id: 12, fixture_id: 2, pick: 'draw' },
    { telegram_id: 12, fixture_id: 1, pick: 'away' },
    { telegram_id: 13, fixture_id: 3, pick: 'home' },
    { telegram_id: 14, fixture_id: 1, pick: 'bogus' },
  ], settled);
  assert.deepEqual(ranking.map(r => [r.userId, r.points, r.played, r.aiPoints]), [[11, 1, 1, 1], [10, 1, 2, 1], [12, 1, 2, 1]]);
});

test('leaderboard: top by points, only the first name, my rank, AI on the same matches and pending picks', async () => {
  const predictions = {
    1: { fixture_id: 1, status: 'settled', predicted_outcome: 'home', actual_outcome: 'home', settlement_verification_state: 'confirmed' },
    2: { fixture_id: 2, status: 'settled', predicted_outcome: 'away', actual_outcome: 'draw', settlement_verification_state: 'adjudicated' },
    3: { fixture_id: 3, status: 'pending', predicted_outcome: 'home', actual_outcome: null },
    4: { fixture_id: 4, status: 'settled', predicted_outcome: 'home', actual_outcome: 'home', settlement_verification_state: 'drift' },
  };
  const picks = [
    { telegram_id: 5, fixture_id: 1, pick: 'away' },
    { telegram_id: 5, fixture_id: 2, pick: 'draw' },
    { telegram_id: 5, fixture_id: 3, pick: 'home' },
    { telegram_id: 6, fixture_id: 1, pick: 'home' },
    { telegram_id: 6, fixture_id: 2, pick: 'draw' },
    { telegram_id: 6, fixture_id: 4, pick: 'home' },
  ];
  const users = [
    { telegram_id: 5, first_name: 'Сергей' },
    { telegram_id: 6, first_name: '<b>Анна</b> @spam https://t.me/x' },
  ];
  const { rt, selects } = harness({ predictions, picks, users });
  const res = await rt.apiPicksLeaderboard(new Request('https://x.test/api/picks-leaderboard'), {}, user);
  assert.equal(res.body.available, true);
  assert.deepEqual(res.body.top.map(row => [row.rank, row.points, row.played, row.me]), [[1, 2, 2, false], [2, 1, 2, true]]);
  assert.equal(res.body.top[0].name, '<b>Анна</b>');
  assert.deepEqual(res.body.me, { rank: 2, points: 1, played: 2, aiPoints: 1, pending: 1 });
  assert.equal(res.body.truncated, false);
  const userSelect = selects.find(row => row.table === 'users');
  assert.equal(userSelect.options.select, 'telegram_id,first_name', 'never username or last name');
  const picksSelect = selects.find(row => row.table === 'match_picks');
  assert.equal(picksSelect.filters.kickoff_at, 'gte.2026-09-12T12:00:00.000Z');
});

test('leaderboard reads every pick of the window page by page', async () => {
  const predictions = { 1: { fixture_id: 1, status: 'settled', predicted_outcome: 'home', actual_outcome: 'home', settlement_verification_state: 'confirmed' } };
  const picks = Array.from({ length: 2500 }, (_, i) => ({ telegram_id: 100 + i, fixture_id: 1, pick: i === 2499 ? 'home' : 'away' }));
  const { rt, selects } = harness({ predictions, picks, users: [{ telegram_id: 2599, first_name: 'Последний' }] });
  const res = await rt.apiPicksLeaderboard(new Request('https://x.test/api/picks-leaderboard'), {}, user);
  assert.equal(selects.filter(row => row.table === 'match_picks').length, 3);
  assert.deepEqual(res.body.top[0], { rank: 1, name: 'Последний', points: 1, played: 1, me: false }, 'the last page is counted');
  assert.equal(res.body.truncated, false);
});

test('player names: first name only, no links, handles or control characters', () => {
  assert.equal(publicPlayerName('Сергей'), 'Сергей');
  assert.equal(publicPlayerName('  '), 'Игрок');
  assert.equal(publicPlayerName('Ann‮ @user https://evil.example'), 'Ann');
  assert.equal(Array.from(publicPlayerName('Я'.repeat(80))).length, 32);
});

test('match card: pick buttons before kickoff, AI pick, closed state and result — no betting words', () => {
  const match = { homeName: 'Спартак', awayName: 'Зенит' };
  const open = matchPickHtml({ available: true, open: true, pick: null, ai: 'home' }, match, escapeHtml);
  assert.match(open, /data-beat-pick="home" aria-pressed="false">Спартак</);
  assert.match(open, /data-beat-pick="draw" aria-pressed="false">Ничья</);
  assert.match(open, /AI уже сделал выбор/);
  assert.doesNotMatch(open, /AI: <b>Спартак/, 'AI pick is shown after the user picks');
  const picked = matchPickHtml({ available: true, open: true, pick: 'away', ai: 'home' }, match, escapeHtml);
  assert.match(picked, /data-beat-pick="away" aria-pressed="true"/);
  assert.match(picked, /Ваш прогноз: <b>Зенит<\/b> · AI: <b>Спартак<\/b>/);
  const closed = matchPickHtml({ available: true, open: false, pick: null, ai: 'home' }, match, escapeHtml);
  assert.match(closed, /прогнозы закрыты/);
  assert.doesNotMatch(closed, /data-beat-pick/);
  const result = matchPickHtml({ available: true, open: false, pick: 'away', ai: 'home', result: { actual: 'home', userPoint: 0, aiPoint: 1 } }, match, escapeHtml);
  assert.match(result, /Итог: <b>Спартак<\/b>/);
  assert.match(result, /Вы: Зенит · <b>0<\/b>/);
  assert.match(result, /AI: Спартак · <b>\+1<\/b>/);
  assert.equal(matchPickHtml({ available: false }, match, escapeHtml), '');
  const verifying = matchPickHtml({ available: true, open: false, verifying: true, pick: 'home', ai: 'home', result: null }, match, escapeHtml);
  assert.match(verifying, /итог проверяется/);
  assert.doesNotMatch(verifying, /\+1/);
  for (const html of [open, picked, closed, result]) assert.doesNotMatch(html, /ставк|коэф|букмекер|выигрыш|деньг(и|ах) на/i);
  assert.match(matchPickHtml({ available: true, open: true, ai: 'home' }, { homeName: '<img src=x>' }, escapeHtml), /&lt;img src=x&gt;/);
});

test('leaderboard card escapes names and shows the user against AI', () => {
  const html = picksLeaderboardHtml({
    available: true,
    top: [{ rank: 1, name: '<script>', points: 3, played: 4, me: false }, { rank: 2, name: 'Сергей', points: 2, played: 4, me: true }],
    me: { rank: 2, points: 2, played: 4, aiPoints: 3, pending: 1 },
  }, escapeHtml);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Ваши очки: <b>2<\/b> из 4 · AI на тех же матчах: <b>3<\/b> · место 2/);
  assert.match(html, /Ожидают итога: 1/);
  assert.match(html, /<li class="is-me">/);
  assert.match(picksLeaderboardHtml({ available: true, top: [], me: {} }, escapeHtml), /Сделайте прогноз в Штабе матча/);
  assert.match(picksLeaderboardHtml(null, escapeHtml), /временно недоступна/);
  assert.match(picksLeaderboardHtml({ available: true, truncated: true, top: [], me: {} }, escapeHtml), /по части из них/);
});

test('wiring: routes, rate limits, UI mount points and the private table migration', () => {
  const router = fs.readFileSync('src/router.js', 'utf8');
  assert.match(router, /pathname === '\/api\/match-pick'/);
  assert.match(router, /pathname === '\/api\/picks-leaderboard'\) return await apiPicksLeaderboard/);
  const limits = fs.readFileSync('src/account-rate-limit.js', 'utf8');
  assert.match(limits, /label:'match-pick-write'/);
  assert.match(limits, /label:'picks-leaderboard'/);
  const view = fs.readFileSync('public/modules/match-center-view.js', 'utf8');
  assert.match(view, /id="beatAiPick"/);
  assert.match(view, /if \(typeof mountBeatAi === 'function'\) mountBeatAi\(m\);/);
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.match(html, /<section id="beatAiBoard" class="panel match-explanation beat-ai-board" aria-live="polite" hidden><\/section>/);
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /void loadBeatAiBoard\(\);/);
  const sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_29_16.sql', 'utf8');
  assert.match(sql, /create table if not exists public\.match_picks/);
  assert.match(sql, /pick text not null check \(pick in \('home','draw','away'\)\)/);
  assert.match(sql, /primary key \(telegram_id, fixture_id\)/);
  assert.match(sql, /alter table public\.match_picks enable row level security;/);
  assert.match(sql, /revoke all on table public\.match_picks from public, anon, authenticated, service_role;/);
  assert.match(sql, /grant select, insert, update, delete on table public\.match_picks to service_role;/);
  assert.equal(sql.match(/'sensitive_mutation_idempotency',\n {6}'match_picks'\n {4}\)/g)?.length, 3, 'legacy v1 fingerprint excludes the table');
  assert.doesNotMatch(sql, /drop /i);
});
