import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTelegramSearchRuntime } from '../src/telegram-search-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing source boundary: ${endMarker}`);
  return source.slice(start, end);
}

function searchText(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function createSearchRuntime(overrides = {}) {
  return createTelegramSearchRuntime({
    apiFootball: async () => [],
    digestTime: () => '12:00',
    footballMatchActionKeyboard: () => ({ inline_keyboard: [] }),
    footballSearchHandoffKeyboard: (_request, _match, searchUrl) => ({
      inline_keyboard: [[{ text: 'Открыть', web_app: { url: searchUrl } }]],
    }),
    freeQuotaHealthy: () => true,
    getCache: async () => null,
    getFavorites: async () => [],
    getHistory: async () => [],
    loadPublicAiTrackRecord: async () => ({ available: false }),
    loadSearchTeamMatches: async () => ({ matches: [] }),
    normalizeSearchTeam: row => ({
      id: Number(row?.team?.id || row?.id || 0),
      name: String(row?.team?.name || row?.name || ''),
      score: 100,
    }),
    rankTeamDiscoveryMatches: matches => matches,
    recordGrowthEvent: () => {},
    rememberBotFixtureCards: async () => {},
    searchText,
    setCache: async () => true,
    telegramApi: async () => ({}),
    telegramWebAppUrl: (_request, params = {}) => `https://app.test/?${new URLSearchParams(params)}`,
    todayUtc: () => '2026-10-06',
    topTeamSearchPlan: query => ({
      best: { score: 200, canonical: query },
      providerQuery: query,
      candidates: [],
    }),
    ...overrides,
  });
}

const app = readRepoFile('public/app.js');
const css = readRepoFile('public/styles.css');
const telegramOrchestration = readRepoFile('src/telegram-update-orchestration.js');

test('home AI ranking is capped at three matches and explicitly not presented as a prediction', () => {
  const block = sourceBlock(app, 'function renderAiFocus()', 'function homeMatchSections(');

  assert.match(block, /slice\(0,3\)/);
  assert.match(block, /AI-РЕЙТИНГ ДНЯ/);
  assert.match(block, /Это ещё не прогноз исхода/);
  assert.match(block, /analysisHistoryForFixture\(m\.fixtureId\)/);
  assert.match(block, /data-ai-rank-history/);
  assert.match(block, /data-ai-rank-fixture/);
  assert.match(css, /\.ai-rank-row\{/);
});

test('AI center gives analyzed skip signals a dedicated caution lane', () => {
  const block = sourceBlock(app, 'function renderAiCenterSummary()', 'function renderAiFocus()');

  assert.match(block, /aiSignalCode === 'skip'/);
  assert.match(block, /Лучше пропустить/);
  assert.match(block, /ai-center-feature caution/);
  assert.match(block, /highRisk/);
  assert.match(css, /\.ai-center-feature\.caution\{/);
});

test('Telegram natural-language search parser recognizes intent and match separators', () => {
  const runtime = createSearchRuntime();

  assert.deepEqual(
    runtime.botSearchParts('/ask что поставить на Арсенал — Челси'),
    {
      query: 'Арсенал — Челси',
      first: 'Арсенал',
      second: 'Челси',
      intent: 'pick',
    },
  );
  assert.deepEqual(
    runtime.botSearchParts('кто судья Интер против Милан'),
    {
      query: 'Интер против Милан',
      first: 'Интер',
      second: 'Милан',
      intent: 'referee',
    },
  );
  assert.equal(runtime.botSearchParts('разбери матч Реал vs Барселона').intent, 'analysis');
});

test('Telegram search escapes HTML in user-controlled match content', () => {
  const runtime = createSearchRuntime();

  assert.equal(
    runtime.telegramHtmlEscape('<b>Arsenal & "Co"</b>'),
    '&lt;b&gt;Arsenal &amp; &quot;Co&quot;&lt;/b&gt;',
  );

  const line = runtime.botMatchLine({
    home: { name: '<Arsenal>' },
    away: { name: 'Chelsea & Co' },
    league: '<Premier League>',
    live: true,
    statusLabel: '<LIVE>',
  }, 0);

  assert.doesNotMatch(line, /<Arsenal>|<Premier League>|<LIVE>/);
  assert.match(line, /&lt;Arsenal&gt;/);
  assert.match(line, /Chelsea &amp; Co/);
  assert.match(line, /&lt;Premier League&gt;/);
});

test('remote Telegram search respects provider quota and permits only the explicit high-intent reserve path', async () => {
  const calls = [];
  let apiCalls = 0;
  const lowIntent = createSearchRuntime({
    freeQuotaHealthy: (daily, minute) => {
      calls.push([daily, minute]);
      return false;
    },
    topTeamSearchPlan: query => ({
      best: { score: 100, canonical: query },
      providerQuery: query,
      candidates: [],
    }),
    apiFootball: async () => {
      apiCalls += 1;
      return [];
    },
  });

  assert.deepEqual(
    await lowIntent.botRemoteTeamMatches({ first: 'Arsenal', second: '' }, {}),
    [],
  );
  assert.equal(apiCalls, 0);
  assert.deepEqual(calls, [[10, 2]]);

  const reserveCalls = [];
  const highIntent = createSearchRuntime({
    freeQuotaHealthy: (daily, minute) => {
      reserveCalls.push([daily, minute]);
      return daily === 2 && minute === 1;
    },
    topTeamSearchPlan: query => ({
      best: { score: 200, canonical: query },
      providerQuery: query,
      candidates: [],
    }),
    apiFootball: async () => {
      apiCalls += 1;
      return [];
    },
  });

  await highIntent.botRemoteTeamMatches({ first: 'Arsenal', second: '' }, {});

  assert.deepEqual(reserveCalls, [[10, 2], [2, 1]]);
  assert.equal(apiCalls, 1);
});

test('Telegram football search prefers cached matches, limits output and preserves safe HTML/deep-link handoff', async () => {
  const sent = [];
  let remoteCalls = 0;
  const matches = [
    {
      fixtureId: 77,
      date: '2026-10-06T18:00:00Z',
      league: '<Premier>',
      home: { name: '<Arsenal>' },
      away: { name: 'Chelsea & Co' },
      live: false,
      finished: false,
      featured: true,
    },
  ];

  const runtime = createSearchRuntime({
    getCache: async key => key === 'matches:2026-10-06:v6-integrity'
      ? { matches }
      : null,
    loadSearchTeamMatches: async () => {
      remoteCalls += 1;
      return { matches: [] };
    },
    telegramApi: async (method, _cfg, payload) => {
      sent.push({ method, payload });
      return {};
    },
  });

  await runtime.sendBotFootballSearch(
    new Request('https://bot.test/webhook'),
    {},
    123,
    456,
    'Arsenal',
  );

  assert.equal(remoteCalls, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(sent[0].payload.chat_id, 456);
  assert.equal(sent[0].payload.parse_mode, 'HTML');
  assert.doesNotMatch(sent[0].payload.text, /<Arsenal>|<Premier>/);
  assert.match(sent[0].payload.text, /&lt;Arsenal&gt;/);
  assert.match(sent[0].payload.text, /Chelsea &amp; Co/);
  assert.match(sent[0].payload.text, /Запрос: «Arsenal»/);
  assert.match(
    sent[0].payload.reply_markup.inline_keyboard[0][0].web_app.url,
    /view=search/,
  );
  assert.match(
    sent[0].payload.reply_markup.inline_keyboard[0][0].web_app.url,
    /q=Arsenal/,
  );
});

test('Telegram update orchestration routes both explicit and natural text into the shared football search', () => {
  assert.match(
    telegramOrchestration,
    /\/\^\\\/\(\?:search\|ask\)[\s\S]*?sendBotFootballSearch\(request, cfg,[\s\S]*?chatId, text\)/,
  );
  assert.match(
    telegramOrchestration,
    /if \(chatId && text && !text\.startsWith\('\/'\)\) \{[\s\S]*?sendBotFootballSearch\(request, cfg,[\s\S]*?chatId, text\)/,
  );
});

test('Mini App launch intent supports search and exact fixture deep links while reusing saved analysis', () => {
  const launchBlock = sourceBlock(app, 'async function openLaunchFixture(', 'function applyLaunchIntent()');
  const intentBlock = sourceBlock(app, 'function applyLaunchIntent()', 'function analysisFreshnessHtml(');

  assert.match(launchBlock, /analysisHistoryForFixture\(id\)/);
  assert.match(launchBlock, /openHistoryAnalysis\(id, null\)/);
  assert.match(launchBlock, /analyzeMatch\(id, null/);

  assert.match(intentBlock, /params\.get\('fixtureId'\)/);
  assert.match(intentBlock, /params\.get\('q'\)/);
  assert.match(intentBlock, /\['analysis','center'\]\.includes\(action\)/);
  assert.match(intentBlock, /openLaunchFixture\(fixtureId, action, tab, handoff/);
});
