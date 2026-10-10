import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUserHistoryService } from '../src/user-history.js';
import { createTelegramSearchRuntime } from '../src/telegram-search-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createHistoryService({
  hasSupabase = () => false,
  memory = { history: new Map() },
  supaUpsert = async () => true,
  supaSelectMany = async () => [],
} = {}) {
  return {
    memory,
    service: createUserHistoryService({
      memory,
      hasSupabase,
      supaUpsert,
      supaSelectMany,
      recordOpsEvent: async () => {},
      bumpTelemetry: () => {},
      retryDelayMs: 0,
      sleep: async () => {},
    }),
  };
}

function createTelegramSearch({
  getHistory = async () => [],
  telegramApi = async () => ({}),
  footballMatchActionKeyboard = (_request, match, historyUrl) => ({
    inline_keyboard: [[
      {
        text: 'Открыть матч',
        web_app: {
          url: `${historyUrl}&fixtureId=${Number(match.fixtureId || 0)}`,
        },
      },
    ]],
  }),
} = {}) {
  return createTelegramSearchRuntime({
    apiFootball: async () => [],
    digestTime: () => '12:00',
    footballMatchActionKeyboard,
    footballSearchHandoffKeyboard: () => ({ inline_keyboard: [] }),
    freeQuotaHealthy: () => true,
    getCache: async () => null,
    getFavorites: async () => [],
    getHistory,
    loadPublicAiTrackRecord: async () => ({ available: false }),
    loadSearchTeamMatches: async () => ({ matches: [] }),
    normalizeSearchTeam: row => row,
    rankTeamDiscoveryMatches: rows => rows,
    recordGrowthEvent: () => {},
    rememberBotFixtureCards: async () => {},
    searchText: value => String(value || '').toLowerCase().trim(),
    setCache: async () => true,
    telegramApi,
    telegramWebAppUrl: (_request, params = {}) =>
      `https://bot.test/?${new URLSearchParams(params)}`,
    todayUtc: () => '2026-10-06',
    topTeamSearchPlan: query => ({
      best: { score: 100, canonical: query },
      providerQuery: query,
      candidates: [],
    }),
  });
}

const app = readRepoFile('public/app.js');
const html = readRepoFile('public/index.html');
const analysisRuntime = readRepoFile('src/analysis-runtime.js');
const userDataApi = readRepoFile('src/user-data-api-runtime.js');
const migration = readRepoFile('supabase/migrations/supabase_migration_v6_14.sql');
const telegramUpdate = readRepoFile('src/telegram-update-orchestration.js');

test('RC43 analysis history persists compact AI verdict fields in memory', async () => {
  const { service, memory } = createHistoryService();

  await service.recordHistory(123, {
    analysisVersion: '4.15.0-availability-quality',
    match: {
      fixtureId: 77,
      home: { name: 'Arsenal', logo: 'https://img.test/arsenal.png' },
      away: { name: 'Chelsea', logo: 'https://img.test/chelsea.png' },
      league: 'Premier League',
      date: '2026-10-06T18:00:00Z',
    },
    aiInstructor: {
      betSignal: {
        code: 'double_home',
        label: '1X · хозяева не проиграют',
      },
      confidenceScore: 82.6,
      riskLabel: 'Умеренный',
      verdict: {
        outcome: 'П1 · 58%',
        total: 'ТБ 2.5 · 61%',
        btts: 'Да · 57%',
      },
    },
  }, {});

  const rows = await service.getHistory(123, {});
  assert.equal(rows.length, 1);
  assert.deepEqual(
    {
      fixture_id: rows[0].fixture_id,
      ai_signal_code: rows[0].ai_signal_code,
      ai_signal_label: rows[0].ai_signal_label,
      ai_confidence: rows[0].ai_confidence,
      ai_risk: rows[0].ai_risk,
      ai_outcome: rows[0].ai_outcome,
      ai_total: rows[0].ai_total,
      ai_btts: rows[0].ai_btts,
      analysis_version: rows[0].analysis_version,
    },
    {
      fixture_id: 77,
      ai_signal_code: 'double_home',
      ai_signal_label: '1X · хозяева не проиграют',
      ai_confidence: 83,
      ai_risk: 'Умеренный',
      ai_outcome: 'П1 · 58%',
      ai_total: 'ТБ 2.5 · 61%',
      ai_btts: 'Да · 57%',
      analysis_version: '4.15.0-availability-quality',
    },
  );
  assert.equal(memory.history.get(123).length, 1);
});

test('RC43 history upserts one row per user and fixture instead of duplicating re-analysis', async () => {
  const { service } = createHistoryService();

  const base = {
    match: {
      fixtureId: 77,
      home: { name: 'Home' },
      away: { name: 'Away' },
    },
    aiInstructor: {
      betSignal: { code: 'skip', label: 'Пропустить ставку' },
      confidenceScore: 55,
      verdict: {},
    },
  };

  await service.recordHistory(123, base, {});
  await service.recordHistory(123, {
    ...base,
    aiInstructor: {
      ...base.aiInstructor,
      betSignal: { code: 'home', label: 'П1' },
      confidenceScore: 78,
    },
  }, {});

  const rows = await service.getHistory(123, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fixture_id, 77);
  assert.equal(rows[0].ai_signal_code, 'home');
  assert.equal(rows[0].ai_signal_label, 'П1');
  assert.equal(rows[0].ai_confidence, 78);
});

test('RC43 Supabase persistence uses an idempotent user+fixture conflict key', async () => {
  const upserts = [];
  const { service } = createHistoryService({
    hasSupabase: () => true,
    supaUpsert: async (...args) => {
      upserts.push(args);
      return true;
    },
  });

  await service.recordHistory(321, {
    match: {
      fixtureId: 88,
      home: { name: 'Inter' },
      away: { name: 'Milan' },
    },
    aiInstructor: {
      betSignal: { code: 'skip', label: 'Пропустить ставку' },
      confidenceScore: 110,
      riskLabel: 'Высокий',
      verdict: {
        outcome: 'Н · 36%',
      },
    },
  }, { supabase: true });

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][1], 'analysis_history');
  assert.equal(upserts[0][2].telegram_id, 321);
  assert.equal(upserts[0][2].fixture_id, 88);
  assert.equal(upserts[0][2].ai_confidence, 100);
  assert.equal(upserts[0][3], 'telegram_id,fixture_id');
});

test('RC43 public history API maps only compact saved verdict fields', () => {
  assert.match(
    userDataApi,
    /async function apiHistory\(request, cfg, user\)[\s\S]*?aiSignalCode:safeText\(row\.ai_signal_code,40\)[\s\S]*?aiSignalLabel:publicSignalLabel\(safeText\(row\.ai_signal_label,160\)\)[\s\S]*?aiConfidence:confidence[\s\S]*?aiRisk:safeText\(row\.ai_risk,60\)[\s\S]*?aiOutcome:safeText\(row\.ai_outcome,80\)[\s\S]*?aiTotal:safeText\(row\.ai_total,80\)[\s\S]*?aiBtts:safeText\(row\.ai_btts,80\)/,
  );
});

test('RC43 history analysis re-open uses the same active full-analysis cache generation', () => {
  const analysisMatch = analysisRuntime.match(
    /const cacheKey\s*=\s*`fixture:\$\{fixtureId\}:(v\d+-[a-z-]+-rc\d+)`/,
  );
  const historyMatch = userDataApi.match(
    /const cacheKey\s*=\s*`fixture:\$\{fixtureId\}:(v\d+-[a-z-]+-rc\d+)`/,
  );

  assert.ok(analysisMatch, 'analysis cache key generation missing');
  assert.ok(historyMatch, 'history cache key generation missing');
  assert.equal(historyMatch[1], analysisMatch[1]);
  assert.match(
    userDataApi,
    /analysisResponsePayload\(payload,\{cached:true,stale:!fresh,historyReadOnly:true,recheck:\{requested:false,performed:false,free:false/,
  );
});

test('RC43 analyzed upcoming matches expose saved verdicts without spending a new analysis', () => {
  assert.match(app, /function analysisHistoryForFixture\(fixtureId\)/);
  assert.match(
    app,
    /state\.history\.find\(item => Number\(item\.fixtureId\) === id && item\.aiSignalLabel\)/,
  );
  assert.match(app, /data-history-analysis/);
  assert.match(app, /Открыть AI-разбор/);

});

test('RC43 Telegram last verdict formats the newest saved compact snapshot', () => {
  const telegram = createTelegramSearch();

  assert.equal(
    telegram.lastAiVerdictText({}),
    'История AI-разборов пока пуста.',
  );

  assert.equal(
    telegram.lastAiVerdictText({
      fixture_id: 77,
      home_name: 'Arsenal',
      away_name: 'Chelsea',
    }),
    'Последний анализ: Arsenal — Chelsea. Он был создан до сохранения быстрых AI-вердиктов; откройте историю в приложении.',
  );

  const text = telegram.lastAiVerdictText({
    fixture_id: 77,
    home_name: 'Arsenal',
    away_name: 'Chelsea',
    ai_signal_label: '1X · хозяева не проиграют',
    ai_confidence: 83,
    ai_risk: 'Умеренный',
    ai_outcome: 'П1 · 58%',
  });

  assert.match(text, /🧠 Последний AI-разбор/);
  assert.match(text, /Arsenal — Chelsea/);
  assert.match(text, /1X · хозяева не проиграют/);
  assert.match(text, /уверенность 83\/100/);
  assert.match(text, /риск умеренный/);
  assert.match(text, /Исход: П1 · 58%/);
});

test('RC43 Telegram /last sends the newest history row and a history deep link', async () => {
  const sent = [];
  const telegram = createTelegramSearch({
    getHistory: async userId => {
      assert.equal(userId, 123);
      return [{
        fixture_id: 77,
        home_name: 'Arsenal',
        away_name: 'Chelsea',
        ai_signal_label: 'П1',
        ai_confidence: 70,
      }];
    },
    telegramApi: async (method, _cfg, payload) => {
      sent.push({ method, payload });
      return {};
    },
  });

  await telegram.sendLastAiVerdict(
    new Request('https://bot.test/webhook'),
    {},
    123,
    456,
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(sent[0].payload.chat_id, 456);
  assert.match(sent[0].payload.text, /Последний AI-разбор/);
  assert.match(
    sent[0].payload.reply_markup.inline_keyboard[0][0].web_app.url,
    /view=history/,
  );
  assert.match(
    sent[0].payload.reply_markup.inline_keyboard[0][0].web_app.url,
    /fixtureId=77/,
  );

  assert.match(
    telegramUpdate,
    /\/\^\\\/last[\s\S]*?text === '🕘 Последний разбор'[\s\S]*?sendLastAiVerdict\(request, cfg,/,
  );
});

test('RC43 historical migration keeps compact verdict columns and bounded confidence', () => {
  for (const column of [
    'ai_signal_code',
    'ai_signal_label',
    'ai_confidence',
    'ai_risk',
    'ai_outcome',
    'ai_total',
    'ai_btts',
    'analysis_version',
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`));
  }

  assert.match(
    migration,
    /check \(ai_confidence is null or \(ai_confidence >= 0 and ai_confidence <= 100\)\)/,
  );
  assert.match(migration, /HISTORICAL \/ FROZEN MIGRATION/);
});
