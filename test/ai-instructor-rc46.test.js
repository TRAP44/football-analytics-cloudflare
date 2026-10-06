import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisContextRuntime } from '../src/analysis-context-runtime.js';
import { createTelegramSearchRuntime } from '../src/telegram-search-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createInstructorRuntime({
  analysisQualityGate = () => ({ state:'ready', allowSignal:true, reasons:[] }),
  marketMovementNote = () => '',
} = {}) {
  return createAnalysisContextRuntime({
    analysisQualityGate,
    freeQuotaHealthy: () => true,
    getCache: async () => null,
    getStaleCache: async () => null,
    marketMovementNote,
    refereeProfile: value => ({
      name: String(value || ''),
      country: '',
      available: Boolean(value),
    }),
    resolveTeamSeasonPlayers: async () => null,
    setCache: async () => true,
  });
}

function createSearchRuntime() {
  return createTelegramSearchRuntime({
    apiFootball: async () => [],
    digestTime: () => '12:00',
    footballMatchActionKeyboard: () => ({ inline_keyboard: [] }),
    footballSearchHandoffKeyboard: () => ({ inline_keyboard: [] }),
    freeQuotaHealthy: () => true,
    getCache: async () => null,
    getFavorites: async () => [],
    getHistory: async () => [],
    loadPublicAiTrackRecord: async () => ({ available:false }),
    loadSearchTeamMatches: async () => ({ matches:[] }),
    normalizeSearchTeam: row => row,
    rankTeamDiscoveryMatches: rows => rows,
    recordGrowthEvent: () => {},
    rememberBotFixtureCards: async () => {},
    searchText: value => String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim(),
    setCache: async () => true,
    telegramApi: async () => ({}),
    telegramWebAppUrl: () => 'https://app.test/',
    todayUtc: () => '2026-10-07',
    topTeamSearchPlan: query => ({
      best: { score:100, canonical:query },
      providerQuery: query,
      candidates: [],
    }),
  });
}

const app = readRepoFile('public/app.js');
const css = readRepoFile('public/styles.css');
const telegramUpdate = readRepoFile('src/telegram-update-orchestration.js');

test('RC46 keeps model confidence separate from source-data trust', () => {
  const runtime = createInstructorRuntime();

  const result = runtime.buildAiInstructor({
    probabilities: { home:62, draw:23, away:15 },
    confidence: {
      score:82,
      signalCount:3,
      disagreement:4,
      agreement:90,
    },
    completeness: {
      score:10,
      max:10,
    },
    providerReliability: {
      state:'degraded',
      trustCap:55,
    },
    lineupImpact: {
      homeConfirmed:true,
      awayConfirmed:true,
    },
    minutesToKickoff:120,
  });

  assert.equal(result.confidenceScore, 82);
  assert.equal(result.confidenceLabel, 'Высокая');
  assert.equal(result.riskLabel, 'Умеренный');

  assert.deepEqual(result.dataTrust, {
    score:55,
    baseScore:100,
    reliabilityCap:55,
    label:'Ограниченные данные',
    note:'Часть данных источника недоступна или ограничена тарифом; неизвестные значения не подменяются нулями.',
  });

  assert.equal(result.betSignal.code, 'skip');
  assert.equal(
    result.betSignal.reason,
    'Надёжность входных данных ниже рабочего порога.',
  );
});

test('RC46 data trust uses completeness ratio rather than model confidence', () => {
  const runtime = createInstructorRuntime();

  const result = runtime.buildAiInstructor({
    probabilities: { home:45, draw:30, away:25 },
    confidence: {
      score:95,
      signalCount:3,
      disagreement:3,
      agreement:85,
    },
    completeness: {
      score:6,
      max:10,
    },
    providerReliability: {
      state:'healthy',
      trustCap:100,
    },
    lineupImpact: {
      homeConfirmed:true,
      awayConfirmed:true,
    },
    minutesToKickoff:180,
  });

  assert.equal(result.confidenceScore, 95);
  assert.equal(result.confidenceLabel, 'Высокая');
  assert.equal(result.dataTrust.baseScore, 60);
  assert.equal(result.dataTrust.score, 60);
  assert.equal(result.dataTrust.label, 'Рабочая полнота');
});

test('RC46 AI instructor builds a concrete three-step pre-kickoff plan', () => {
  const runtime = createInstructorRuntime({
    marketMovementNote: () => 'Рынок сместился к ТБ 2.5.',
  });

  const result = runtime.buildAiInstructor({
    probabilities: { home:45, draw:30, away:25 },
    goalModel: {
      qualityScore:80,
      over25:72,
      btts:54,
    },
    confidence: {
      score:80,
      signalCount:3,
      disagreement:4,
      agreement:85,
    },
    completeness: {
      score:10,
      max:10,
    },
    factors: ['Форма хозяев'],
    risks: ['Ключевой форвард может не выйти.'],
    referee:'A. Ref',
    refereeHistory: {
      available:true,
      styleLabel:'Строгий',
      avgYellow:5.8,
    },
    lineupImpact: {
      homeConfirmed:true,
      awayConfirmed:true,
      note:'Оба стартовых состава подтверждены.',
    },
    marketMovement: {
      sample:3,
    },
    providerReliability: {
      state:'healthy',
      trustCap:100,
    },
    minutesToKickoff:60,
  });

  assert.equal(result.betSignal.code, 'over25');
  assert.deepEqual(result.matchPlan.checks, [
    'Оба стартовых состава подтверждены.',
    'Рынок сместился к ТБ 2.5.',
    'Учесть судью: Строгий, среднее 5.8 жёлтых карточки за матч.',
  ]);
  assert.equal(
    result.matchPlan.cancel,
    'Ключевой форвард может не выйти.',
  );
  assert.match(
    result.matchPlan.liveWatch,
    /В первые 15–20 минут смотреть на темп/,
  );
});

test('RC46 skip state changes the plan from betting action to wait-and-reassess', () => {
  const runtime = createInstructorRuntime();

  const result = runtime.buildAiInstructor({
    probabilities: { home:38, draw:33, away:29 },
    confidence: {
      score:50,
      signalCount:1,
      disagreement:15,
      agreement:40,
    },
    completeness: {
      score:5,
      max:10,
    },
    providerReliability: {
      state:'healthy',
      trustCap:100,
    },
  });

  assert.equal(result.betSignal.code, 'skip');
  assert.match(result.matchPlan.cancel, /не форсировать решение/);
  assert.match(result.riskNote, /не форсируйте решение/);
});

test('RC46 Mini App renders data trust and the concrete pre-kickoff plan as separate concepts', () => {
  assert.match(app, /Качество данных/);
  assert.match(app, /dataTrust\.label/);
  assert.match(app, /dataTrustScore/);

  assert.match(app, /AI-ПЛАН ДО СТАРТОВОГО СВИСТКА/);
  assert.match(app, /Условие отмены/);
  assert.match(app, /Что смотреть дальше/);
  assert.match(css, /\.ai-match-plan/);
});

test('RC46 Telegram intent parser understands referee, pick, analysis and generic search questions', () => {
  const runtime = createSearchRuntime();

  const referee = runtime.botSearchParts('/ask кто судья Интер — Милан');
  assert.deepEqual(referee, {
    query:'Интер — Милан',
    first:'Интер',
    second:'Милан',
    intent:'referee',
  });
  assert.match(runtime.botIntentLead(referee), /судью/);

  const pick = runtime.botSearchParts('что поставить на Арсенал против Челси');
  assert.equal(pick.intent, 'pick');
  assert.equal(pick.first, 'Арсенал');
  assert.equal(pick.second, 'Челси');
  assert.match(runtime.botIntentLead(pick), /идею, риск и качество исходных данных/);

  const analysis = runtime.botSearchParts('разбери матч Реал vs Барселона');
  assert.equal(analysis.intent, 'analysis');
  assert.match(runtime.botIntentLead(analysis), /вероятности, сценарий, риски/);

  const generic = runtime.botSearchParts('Бавария');
  assert.equal(generic.intent, 'search');
  assert.equal(runtime.botIntentLead(generic), '⚽ Нашёл подходящие матчи.');
});

test('RC46 Telegram /ask and natural text route through the shared football search', () => {
  assert.match(
    telegramUpdate,
    /\/\^\\\/\(\?:search\|ask\)[\s\S]*?sendBotFootballSearch\(request, cfg,/,
  );
  assert.match(
    telegramUpdate,
    /if \(chatId && text && !text\.startsWith\('\/'\)\) \{[\s\S]*?sendBotFootballSearch\(request, cfg,/,
  );
});

test('RC46 prematch empty state keeps correct Russian wording', () => {
  assert.doesNotMatch(app, /Главное недоступен/);
  assert.match(app, /Преданализ недоступен/);
});
