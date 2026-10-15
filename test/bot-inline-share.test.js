import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createTelegramSearchRuntime } from '../src/telegram-search-runtime.js';
import { TELEGRAM_BURST_POLICIES, createTelegramDedupeRuntime } from '../src/telegram-dedupe.js';

// Inline-режим (Сергей 15.10): `@MatchRadarBot Реал` в любом чате Telegram —
// карточка матча с кнопкой на разбор и ссылкой автора.

const DAY = '2026-10-15';
const day = [
  { fixtureId: 11, date: '2026-10-15T19:00:00Z', league: 'La Liga', live: false, finished: false,
    home: { id: 541, name: 'Real Madrid', logo: 'https://media.example/541.png' }, away: { id: 529, name: 'Barcelona' } },
  { fixtureId: 12, date: '2026-10-15T13:00:00Z', league: 'Serie A', live: true, finished: false, statusLabel: "63'",
    score: { home: 2, away: 1 }, home: { id: 489, name: 'AC Milan' }, away: { id: 497, name: 'AS Roma' } },
  { fixtureId: 13, date: '2026-10-15T10:00:00Z', league: 'Premier League', live: false, finished: true,
    score: { home: 0, away: 0 }, home: { id: 42, name: 'Arsenal' }, away: { id: 49, name: 'Chelsea' } },
  { fixtureId: 14, date: '2026-10-15T12:00:00Z', league: 'U19 League', live: false, finished: false, lowPriority: true,
    home: { id: 7, name: 'Real Madrid U19' }, away: { id: 8, name: 'Getafe U19' } },
];

function setup({ cache = {}, plan = null, remote = [] } = {}) {
  const calls = [];
  const deepLinks = [];
  const store = { [`matches:${DAY}:v6-integrity`]: { matches: day }, ...cache };
  const runtime = createTelegramSearchRuntime({
    apiFootball: async () => [],
    digestTime: () => '—',
    ensureReferralCode: async userId => `ref${userId}`,
    fixtureTelegramDeepLink: async (_cfg, fixtureId, options) => {
      deepLinks.push({ fixtureId, ...options });
      return { url: `https://t.me/MatchRadarBot?start=f${fixtureId}_${options.referralCode}` };
    },
    footballMatchActionKeyboard: () => ({ inline_keyboard: [] }),
    footballSearchHandoffKeyboard: () => null,
    freeQuotaHealthy: () => true,
    getCache: async key => store[key] ?? null,
    getHistory: async () => [],
    loadPublicAiTrackRecord: async () => ({ available: false }),
    loadSearchTeamMatches: async () => ({ matches: remote }),
    normalizeSearchTeam: row => ({ id: Number(row?.id || 0), name: String(row?.name || ''), score: 200 }),
    rankTeamDiscoveryMatches: matches => matches,
    recordGrowthEvent: () => {},
    rememberBotFixtureCards: async () => {},
    searchText: value => String(value).toLowerCase().replace(/\s+/g, ' ').trim(),
    setCache: async () => true,
    telegramApi: async (method, _cfg, payload) => { calls.push({ method, payload }); return {}; },
    telegramWebAppUrl: () => '',
    todayUtc: () => DAY,
    topTeamSearchPlan: query => plan ?? { providerQuery: query, candidates: [], resolved: false, best: null },
  });
  const ask = query => runtime.answerBotInlineQuery({ url: 'https://app.example/telegram' }, {}, { id: 'q1', from: { id: 77 }, query });
  return { runtime, calls, deepLinks, ask };
}

test('inline query returns a shareable match card with the author referral link', async () => {
  const { calls, deepLinks, ask } = setup({
    cache: { 'fixture:11:v17-starting-xi-rc146': { probabilities: { home: 52.4, draw: 25.1, away: 22.5 } } },
  });
  await ask('Real');
  assert.equal(calls.length, 1);
  const { method, payload } = calls[0];
  assert.equal(method, 'answerInlineQuery');
  assert.equal(payload.inline_query_id, 'q1');
  assert.equal(payload.is_personal, true);
  const [card] = payload.results;
  assert.equal(card.type, 'article');
  assert.equal(card.title, 'Real Madrid — Barcelona');
  assert.equal(card.thumbnail_url, 'https://media.example/541.png');
  assert.match(card.description, /La Liga · сегодня, 22:00 МСК/);
  const text = card.input_message_content.message_text;
  assert.match(text, /<b>Real Madrid — Barcelona<\/b>/);
  assert.match(text, /Real Madrid 52% · ничья 25% · Barcelona 23%/);
  assert.doesNotMatch(text, /П1|П2|ТБ|коэффициент|ставк|API-Football/i);
  assert.deepEqual(card.reply_markup.inline_keyboard, [[{ text: '🧠 Открыть AI-разбор', url: 'https://t.me/MatchRadarBot?start=f11_ref77' }]]);
  assert.deepEqual(deepLinks[0], { fixtureId: 11, source: 'social', campaign: 'inline_share', content: 'telegram', referralCode: 'ref77' });
  // Юниорский матч с похожим названием тоже находится, но основной — первым.
  assert.equal(payload.results[0].id, 'm11');
});

test('empty inline query shows the main matches of the day: LIVE first, no finished or low-priority', async () => {
  const { calls, ask } = setup();
  await ask('');
  const ids = calls[0].payload.results.map(r => r.id);
  assert.deepEqual(ids, ['m12', 'm11']);
  const live = calls[0].payload.results[0];
  assert.match(live.input_message_content.message_text, /🔴 LIVE 63&#39; · 2:1/);
  // Для идущего матча довматчевые проценты не показываются.
  assert.match(live.input_message_content.message_text, /Полный AI-разбор матча — в MatchRadar/);
});

test('Cyrillic query is resolved through the team search plan', async () => {
  const { calls, ask } = setup({ plan: { providerQuery: 'AC Milan', candidates: [], resolved: true, best: { score: 280 } } });
  await ask('Милан');
  assert.deepEqual(calls[0].payload.results.map(r => r.id), ['m12']);
});

test('unverified probabilities are never shown', async () => {
  for (const probabilities of [{ home: 80, draw: 80, away: 80 }, { home: 'x', draw: 30, away: 20 }, null]) {
    const { calls, ask } = setup({ cache: { 'fixture:11:v17-starting-xi-rc146': { probabilities } } });
    await ask('Real Madrid');
    const text = calls[0].payload.results[0].input_message_content.message_text;
    assert.doesNotMatch(text, /%/);
  }
});

test('no match found answers with a button into the bot instead of an empty list', async () => {
  const { calls, ask } = setup();
  await ask('Zzzzzz United');
  assert.deepEqual(calls[0].payload.results, []);
  assert.deepEqual(calls[0].payload.button, { text: 'Матч не найден — открыть MatchRadar', start_parameter: 'inline' });
});

test('inline queries are routed and rate-limited like other updates', () => {
  const orchestration = readFileSync(new URL('../src/telegram-update-orchestration.js', import.meta.url), 'utf8');
  assert.match(orchestration, /if \(update\.inline_query\) \{[\s\S]*?answerBotInlineQuery\(request,cfg,inline\)/);
  assert.ok(orchestration.indexOf('if (update.inline_query)') < orchestration.indexOf('if (update.callback_query) {\n    const cb'));
  assert.deepEqual(TELEGRAM_BURST_POLICIES.inline, { limit: 20, windowMs: 10000, label: 'inline' });
  const dedupe = createTelegramDedupeRuntime({ runtimeMemory: { telegramBurst: new Map(), telegramUpdateDedupe: new Map() } });
  assert.equal(dedupe.telegramBurstKind({ inline_query: { id: '1', from: { id: 5 } } }), 'inline');
});
