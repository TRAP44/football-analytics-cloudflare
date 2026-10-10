import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisContextRuntime } from '../src/analysis-context-runtime.js';
import { createTelegramBotUiRuntime } from '../src/telegram-bot-ui-runtime.js';
import { createTelegramBotOrchestrationRuntime } from '../src/telegram-bot-orchestration-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createInstructorRuntime({
  analysisQualityGate = () => ({ state: 'ready', allowSignal: true, reasons: [] }),
} = {}) {
  return createAnalysisContextRuntime({
    analysisQualityGate,
    freeQuotaHealthy: () => true,
    getCache: async () => null,
    getStaleCache: async () => null,
    marketMovementNote: () => '',
    refereeProfile: referee => referee ? { name: referee } : null,
    resolveTeamSeasonPlayers: async () => null,
    setCache: async () => true,
  });
}

function createBotUi({
  apiAnalyze = async () => new Response('{}', { status: 200 }),
  telegramFullAnalysisUrl = (request, fixtureId, tab) => {
    const url=new URL(request.url);
    url.pathname='/';
    url.search='';
    url.searchParams.set('fixtureId',String(fixtureId));
    url.searchParams.set('action','analysis');
    url.searchParams.set('tab',String(tab));
    url.searchParams.set('handoff','1');
    return url.toString();
  },
  telegramWebAppUrl = (request, params = {}) => {
    const url=new URL(request.url);
    url.pathname='/';
    url.search='';
    for (const [key,value] of Object.entries(params)) {
      url.searchParams.set(key,String(value));
    }
    return url.toString();
  },
  telegramApi = async () => ({}),
} = {}) {
  return createTelegramBotUiRuntime({
    apiAnalyze,
    botAiHandoffText: () => '',
    createRequest: (url, init) => new Request(url, init),
    freeQuotaHealthy: () => true,
    getCache: async () => null,
    getFavorites: async () => [],
    isFinishedStatus: status => String(status || '') === 'FT',
    isLiveStatus: status => ['1H', 'HT', '2H'].includes(String(status || '')),
    loadProviderFixture: async () => null,
    markTelegramWebhookMutation: async () => true,
    newsImpactDecisionCard: () => null,
    newsImpactDecisionKeyboard: () => ({ inline_keyboard: [] }),
    recordGrowthEvent: () => {},
    setCache: async () => true,
    statusLabel: value => String(value || ''),
    telegramApi,
    telegramFullAnalysisUrl,
    telegramHtmlEscape: escapeHtml,
    telegramWebAppUrl,
  });
}

const app = readRepoFile('public/app.js');
const html = readRepoFile('public/index.html');
const css = readRepoFile('public/styles.css');
const analysisRuntime = readRepoFile('src/analysis-runtime.js');
const appCapabilities = readRepoFile('src/app-capabilities.js');
const telegramUpdate = readRepoFile('src/telegram-update-orchestration.js');

test('AI instructor exposes a real skip state for weak confidence', () => {
  const runtime = createInstructorRuntime();

  const result = runtime.buildAiInstructor({
    probabilities: { home: 62, draw: 23, away: 15 },
    goalModel: { qualityScore: 80, over25: 70, btts: 60 },
    confidence: { score: 40, signalCount: 3, disagreement: 4, agreement: 90 },
    completeness: { score: 10, max: 10 },
    providerReliability: { state: 'healthy', trustCap: 100 },
  });

  assert.equal(result.role, 'football-ai-instructor');
  assert.equal(result.betSignal.code, 'skip');
  assert.equal(result.betSignal.label, 'Без уверенного вывода');
  assert.match(result.betSignal.reason, /Уверенность модели ниже рабочего порога/);
  assert.equal(result.riskLabel, 'Высокий');
  assert.match(result.matchPlan.cancel, /не форсировать решение/);
});

test('quality gate can still force an otherwise strong AI signal into skip', () => {
  const runtime = createInstructorRuntime({
    analysisQualityGate: () => ({
      state: 'hold',
      allowSignal: false,
      reasons: [{ level: 'hold', text: 'Составы ещё не подтверждены.' }],
    }),
  });

  const result = runtime.buildAiInstructor({
    probabilities: { home: 64, draw: 22, away: 14 },
    confidence: { score: 82, signalCount: 3, disagreement: 4, agreement: 90 },
    completeness: { score: 10, max: 10 },
    providerReliability: { state: 'healthy', trustCap: 100 },
  });

  assert.equal(result.betSignal.code, 'skip');
  assert.equal(result.betSignal.reason, 'Составы ещё не подтверждены.');
  assert.equal(result.qualityGate.state, 'hold');
});

test('pre-match AI instructor preserves referee context and match-plan guidance', () => {
  const runtime = createInstructorRuntime();

  const result = runtime.buildAiInstructor({
    probabilities: { home: 52, draw: 28, away: 20 },
    confidence: { score: 76, signalCount: 3, disagreement: 5, agreement: 80 },
    completeness: { score: 9, max: 10 },
    referee: 'A. Ref',
    refereeData: { name: 'A. Ref', strictness: 'high' },
    refereeHistory: {
      available: true,
      name: 'A. Ref',
      styleLabel: 'Строгий',
      avgYellow: 5.4,
    },
    lineupImpact: {
      note: 'Оба состава подтверждены.',
      homeConfirmed: true,
      awayConfirmed: true,
    },
    providerReliability: { state: 'healthy', trustCap: 100 },
  });

  assert.equal(result.referee, 'A. Ref');
  assert.deepEqual(result.refereeProfile, { name: 'A. Ref', strictness: 'high' });
  assert.equal(result.refereeHistory.styleLabel, 'Строгий');
  assert.ok(result.matchPlan.checks.some(item => item.includes('Строгий')));
  assert.ok(result.matchPlan.checks.some(item => item.includes('Оба состава подтверждены')));
});

test('analysis payload wires the instructor with referee, lineups, market and reliability context', () => {
  assert.match(
    analysisRuntime,
    /aiInstructor=objectValue\(buildAiInstructor\(\{[\s\S]*?probabilities,[\s\S]*?goalModel,[\s\S]*?confidence,[\s\S]*?referee:safeText\(fixture\?\.fixture\?\.referee,180\),[\s\S]*?refereeHistory,[\s\S]*?lineupImpact,[\s\S]*?marketMovement,[\s\S]*?providerReliability,[\s\S]*?minutesToKickoff/,
  );
  assert.match(analysisRuntime, /\n\s*aiInstructor,\n/);
});

test('Telegram verdict renders skip state, referee and user-controlled text safely', () => {
  const bot = createBotUi();

  const text = bot.botAiVerdictText({
    match: {
      home: { name: '<Home & Co>' },
      away: { name: 'Away > Team' },
      referee: '<Ref>',
    },
    aiInstructor: {
      betSignal: {
        code: 'skip',
        label: 'Пропустить ставку',
        reason: 'Нет выраженного перевеса.',
      },
      verdict: {
        outcome: 'П1 · 40%',
        total: 'Без перевеса',
        btts: 'Без перевеса',
      },
      confidenceScore: 52,
      confidenceLabel: 'Низкая',
      riskLabel: 'Высокий',
      dataTrust: {
        score: 70,
        label: 'Рабочая полнота',
      },
      refereeProfile: {
        name: '<Ref>',
      },
    },
  });

  assert.match(text, /Лучше пропустить/);
  assert.match(text, /Без уверенного вывода/);
  assert.match(text, /Судья: &lt;Ref&gt;/);
  assert.match(text, /&lt;Home &amp; Co&gt;/);
  assert.match(text, /Away &gt; Team/);
  assert.doesNotMatch(text, /<Home & Co>|<Ref>/);
  assert.match(text, /не гарантирует результат/);
});

test('Telegram hub is button-first and full analysis deep-links directly to the selected fixture', () => {
  const bot = createBotUi();
  const request = new Request('https://bot.test/webhook');

  const keyboard = bot.footballBotKeyboard(request);
  assert.deepEqual(
    keyboard.keyboard.map(row => row.map(button => button.text)),
    [
      ['⚽ Матчи', '🔎 Найти матч'],
      ['🔴 LIVE', '⭐ Мои команды'],
      ['🤖 AI-подборка', '••• Ещё'],
    ],
  );
  assert.equal(keyboard.is_persistent, true);

  const actions = bot.footballMatchActionKeyboard(request, {
    fixtureId: 77,
    home: { id: 1, name: 'Home' },
    away: { id: 2, name: 'Away' },
  });
  const buttons = actions.inline_keyboard.flat();
  const full = buttons.find(button => button.text === '📊 Полный AI-разбор');

  assert.ok(full);
  const url = new URL(full.web_app.url);
  assert.equal(url.searchParams.get('fixtureId'), '77');
  assert.equal(url.searchParams.get('action'), 'analysis');
  assert.equal(url.searchParams.get('tab'), 'brief');
  assert.equal(url.searchParams.get('handoff'), '1');
});

test('Telegram quick AI requests an explicit server recheck with telegram origin', async () => {
  let captured = null;
  const bot = createBotUi({
    apiAnalyze: async request => {
      captured = {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.json(),
      };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await bot.botAnalyzeFixture(
    new Request('https://bot.test/webhook'),
    {},
    123,
    77,
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(captured.method, 'POST');
  assert.equal(captured.headers['content-type'], 'application/json');
  assert.deepEqual(captured.body, {
    fixtureId: 77,
    origin: 'telegram_quick',
    recheck: true,
  });
});

test('Telegram bot configuration clears slash commands and installs the Mini App menu button', async () => {
  const calls = [];
  const botUi = createBotUi();
  const orchestration = createTelegramBotOrchestrationRuntime({
    footballBotKeyboard: request => botUi.footballBotKeyboard(request),
    telegramApi: async (method, _cfg, payload) => {
      calls.push({ method, payload });
      return {};
    },
    telegramHtmlEscape: escapeHtml,
    telegramWebAppUrl: () => 'https://app.test/',
  });

  await orchestration.configureFootballBot(
    new Request('https://bot.test/webhook'),
    {},
    456,
  );

  const byMethod = new Map(calls.map(call => [call.method, call.payload]));
  assert.deepEqual(byMethod.get('setMyCommands'), { commands: [] });
  assert.deepEqual(byMethod.get('setMyName'), { name: 'MatchRadar AI' });
  assert.equal(
    byMethod.get('setChatMenuButton').menu_button.web_app.url,
    'https://app.test/',
  );
  assert.equal(byMethod.get('setChatMenuButton').chat_id, 456);
});

test('Telegram home safely personalizes the greeting and returns the current hub keyboard', async () => {
  const sent = [];
  const botUi = createBotUi();
  const orchestration = createTelegramBotOrchestrationRuntime({
    footballBotKeyboard: request => botUi.footballBotKeyboard(request),
    telegramApi: async (method, _cfg, payload) => {
      sent.push({ method, payload });
      return {};
    },
    telegramHtmlEscape: escapeHtml,
    telegramWebAppUrl: () => 'https://app.test/',
  });

  await orchestration.sendFootballBotHome(
    new Request('https://bot.test/webhook'),
    {},
    456,
    { first_name: '<Alex & Co>' },
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(sent[0].payload.parse_mode, 'HTML');
  assert.match(sent[0].payload.text, /Привет, <b>&lt;Alex &amp; Co&gt;<\/b>/);
  assert.doesNotMatch(sent[0].payload.text, /<Alex & Co>/);
  assert.equal(sent[0].payload.reply_markup.keyboard[0][0].text, '⚽ Матчи');
});

test('Telegram update handler accepts current and legacy button labels during rollout', () => {
  assert.match(
    telegramUpdate,
    /text === '⚽ Матчи сегодня' \|\| text === '⚽ Матчи'/,
  );
  assert.match(
    telegramUpdate,
    /text === '🧠 AI-подборка' \|\| text === '🤖 AI-подборка'/,
  );
  assert.match(telegramUpdate, /text === '••• Ещё'/);
  assert.match(telegramUpdate, /text === '← Главное меню'/);
});

test('startup experience presents MatchRadar without internal release details', () => {
  const start = html.indexOf('id="bootGate"');
  const end = html.indexOf('class="app-shell"');
  assert.ok(start >= 0 && end > start);
  const boot = html.slice(start, end);

  assert.match(boot, /MatchRadar/);
  assert.match(boot, /Видим, что меняет матч\./);
  assert.match(boot, /Загружаем матчи/);
  assert.doesNotMatch(boot, /версия|RC\d|release|build|boot-feature-row/i);
});

test('Mini App exposes instructor/referee UI and current capability flags', () => {
  assert.match(app, /function aiInstructorHtml\(/);
  assert.match(app, /analysis-referee-line/);
  assert.match(app, /Судья/);
  assert.match(css, /\.ai-instructor-card/);

  for (const flag of [
    'aiAnalysisQualityGate',
    'oneTapAiHandoff',
    'telegramMiniAppE2E',
  ]) {
    assert.match(appCapabilities, new RegExp(`${flag}:true`), flag);
  }
});
