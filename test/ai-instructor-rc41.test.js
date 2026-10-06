import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisContextRuntime } from '../src/analysis-context-runtime.js';
import { createAnalysisQualityRuntime } from '../src/analysis-quality-runtime.js';
import { createRefereeIntelligenceRuntime } from '../src/referee-intelligence-runtime.js';
import { createTelegramDigestRuntime } from '../src/telegram-digest-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createQualityRuntime({
  assessMatchLineups = () => ({
    home: { confirmed: true },
    away: { confirmed: true },
    bothConfirmed: true,
    bothPublished: true,
    anyPublished: true,
    confirmedSides: 2,
    partialSides: 0,
  }),
} = {}) {
  return createAnalysisQualityRuntime({
    absenceAdjustmentUnits: rows => Array.isArray(rows) ? rows.length : 0,
    assessMatchLineups,
    probabilityLeaderMargin: probabilities => {
      const values = Object.values(probabilities || {}).map(Number).sort((a, b) => b - a);
      return values.length >= 2 ? values[0] - values[1] : 0;
    },
  });
}

function createContextRuntime({
  qualityRuntime = createQualityRuntime(),
} = {}) {
  return createAnalysisContextRuntime({
    analysisQualityGate: qualityRuntime.analysisQualityGate,
    freeQuotaHealthy: () => true,
    getCache: async () => null,
    getStaleCache: async () => null,
    marketMovementNote: qualityRuntime.marketMovementNote,
    refereeProfile: value => ({ name: String(value || ''), country: '', available: Boolean(value) }),
    resolveTeamSeasonPlayers: async () => null,
    setCache: async () => true,
  });
}

function createDigestRuntime({
  hasSupabase = () => false,
  memory = { botDigestSubscriptions: new Map() },
  markTelegramWebhookMutation = () => {},
  supaSelectOne = async () => null,
  supaUpsert = async () => true,
  telegramApi = async () => ({}),
} = {}) {
  return createTelegramDigestRuntime({
    DAILY_DIGEST_POLICY: {
      deliveryHourUtc: 7,
      claimLeaseSeconds: 300,
      pageSize: 500,
      maxRecipientsPerRun: 100,
      scanCap: 10000,
      concurrency: 2,
      minSendIntervalMs: 0,
      executionBudgetMs: 30000,
    },
    SMART_NOTIFICATION_POLICY: {
      radarConfidenceThreshold: 70,
      radarOutcomeThreshold: 55,
      maxSignalAgeMinutes: 120,
    },
    apiFootball: async () => [],
    assessDailyDigestRun: () => ({ severity: 'info', code: 'OK', reason: 'healthy' }),
    botMatchButtonText: () => 'Матч',
    bumpTelemetry: () => {},
    currentMorningFootballNews: async () => ({ items: [], degraded: false }),
    filterSmartNotificationRecipients: async () => ({ rows: [] }),
    footballBotKeyboard: () => ({ keyboard: [] }),
    freeQuotaHealthy: () => true,
    getAnalysisTimelineSnapshots: async () => [],
    getCache: async () => null,
    getFavorites: async () => [],
    getStaleCache: async () => null,
    hasSupabase,
    isFootballRateLimitError: () => false,
    isLiveStatus: status => ['1H', 'HT', '2H'].includes(String(status || '')),
    isYouthReserveMatch: () => false,
    loadProviderFixturesForDate: async () => [],
    markTelegramWebhookMutation,
    matchInterestScore: () => 0,
    memory,
    morningNewsText: () => '',
    newsConversionKeyboard: () => ({ inline_keyboard: [] }),
    normalizeBotFixtureCard: value => value,
    normalizeCompetition: (_leagueId, name) => ({
      name,
      shortName: name,
      priority: 0,
      featured: false,
    }),
    planDailyDigestRecipients: () => ({
      scanned: 0,
      pages: 0,
      eligible: 0,
      pending: [],
      duplicate: 0,
      activeClaims: 0,
      freshClaims: 0,
      sealedClaims: 0,
      oldestActiveClaimAgeMs: 0,
      expiredClaims: 0,
      truncated: false,
    }),
    radarStrongSignalState: () => null,
    recordOpsEvent: async () => {},
    rememberBotFixtureCards: async () => {},
    runBoundedDailyDigest: async () => ({
      claimed: 0,
      sent: 0,
      failed: 0,
      rateLimited: 0,
      deferred: 0,
      remaining: 0,
      backlog: 0,
      recoveredClaims: 0,
    }),
    setCache: async () => true,
    sleepMs: async () => {},
    supaPatch: async () => true,
    supaRpc: async () => true,
    supaSelectOne,
    supaSelectPaged: async () => ({ rows: [], truncated: false }),
    supaUpsert,
    telegramApi,
    telegramHtmlEscape: value => String(value || ''),
    todayUtc: () => '2026-10-06',
  });
}

const app = readRepoFile('public/app.js');
const css = readRepoFile('public/styles.css');
const analysisRuntime = readRepoFile('src/analysis-runtime.js');
const migration = readRepoFile('supabase/migrations/supabase_migration_v6_12.sql');

test('RC41 AI verdict summarizes outcome, total, BTTS and a concrete action', () => {
  const context = createContextRuntime();

  const ai = context.buildAiInstructor({
    probabilities: { home: 60, draw: 25, away: 15 },
    goalModel: {
      qualityScore: 80,
      over25: 70,
      btts: 40,
    },
    confidence: {
      score: 80,
      signalCount: 3,
      disagreement: 4,
      agreement: 90,
    },
    completeness: {
      score: 10,
      max: 10,
    },
    lineupImpact: {
      homeConfirmed: true,
      awayConfirmed: true,
      note: 'Оба состава подтверждены.',
    },
    providerReliability: {
      state: 'healthy',
      trustCap: 100,
    },
    minutesToKickoff: 120,
  });

  assert.deepEqual(ai.verdict, {
    outcome: 'П1 · 60%',
    total: 'ТБ 2.5 · 70%',
    btts: 'Нет · 60%',
  });
  assert.equal(ai.betSignal.code, 'double_home');
  assert.equal(ai.betSignal.label, '1X · хозяева не проиграют');
  assert.match(app, /aria-label="Вердикт AI за 10 секунд"/);
  assert.match(css, /\.ai-verdict-grid/);
});

test('RC41 market movement note validates samples and reports the strongest 1X2 shift', () => {
  const quality = createQualityRuntime();

  assert.equal(
    quality.marketMovementNote({
      sample: 1,
      probabilityChange: { home: 3, draw: -1, away: -2 },
    }),
    'История движения коэффициентов ещё собирается.',
  );
  assert.equal(
    quality.marketMovementNote({
      sample: 3,
      probabilityChange: { home: 4.25, draw: -1.25, away: -3 },
    }),
    'Рынок сместился к П1: +4.3 п.п. по подразумеваемой вероятности.',
  );
  assert.equal(
    quality.marketMovementNote({
      sample: 3,
      probabilityChange: { home: Infinity, draw: 0, away: 0 },
    }),
    'Данные движения рынка не прошли проверку.',
  );
});

test('RC41 lineup impact does not treat untrusted or incomplete lineups as confirmed evidence', () => {
  const quality = createQualityRuntime();

  const trusted = quality.buildLineupImpact({
    absences: {
      home: [{ id: 1 }, { id: 2 }],
      away: [],
      summary: {
        home: { injury: 1, suspension: 1, doubtful: 0 },
        away: { injury: 0, suspension: 0, doubtful: 0 },
        resolvedByLineup: 0,
      },
    },
    lineups: {},
    homeName: 'Home',
    awayName: 'Away',
    reliability: {
      features: {
        injuries: {
          state: 'available',
          confidenceBearing: true,
          stale: false,
        },
        lineups: {
          state: 'available',
          confidenceBearing: true,
          stale: false,
          confirmed: true,
        },
      },
    },
  });

  assert.equal(trusted.homeConfirmed, true);
  assert.equal(trusted.awayConfirmed, true);
  assert.equal(trusted.homeAbsences, 2);
  assert.match(trusted.note, /подтверждены надёжным источником/);

  const untrusted = quality.buildLineupImpact({
    absences: { home: [], away: [] },
    lineups: {},
    reliability: {
      features: {
        lineups: {
          state: 'stale_data',
          confidenceBearing: false,
          stale: true,
          confirmed: false,
        },
      },
    },
  });

  assert.equal(untrusted.structuralHomeConfirmed, true);
  assert.equal(untrusted.structuralAwayConfirmed, true);
  assert.equal(untrusted.homeConfirmed, false);
  assert.equal(untrusted.awayConfirmed, false);
  assert.match(untrusted.note, /не прошёл проверку свежести или provenance/);
});

test('RC41 pre-match analysis wires odds movement and lineup impact into the AI instructor', () => {
  assert.match(analysisRuntime, /const previousMarketSnapshots/);
  assert.match(analysisRuntime, /buildOddsMovement\(/);
  assert.match(analysisRuntime, /lineupImpact=objectValue\(buildLineupImpact\(\{/);
  assert.match(
    analysisRuntime,
    /aiInstructor=objectValue\(buildAiInstructor\(\{[\s\S]*?lineupImpact,[\s\S]*?marketMovement,/,
  );
  assert.match(analysisRuntime, /\n\s*aiInstructor,\n/);
  assert.match(app, /ai-market-note/);
  assert.match(app, /ai-lineup-note/);
});

test('RC41 referee names are normalized into a structured context object', () => {
  const runtime = createRefereeIntelligenceRuntime({
    hasSupabase: () => false,
    memory: { refereeMatchHistory: new Map() },
    numericValue: value => Number(value),
    supaSelectMany: async () => [],
    supaUpsert: async () => true,
  });

  assert.deepEqual(
    runtime.refereeProfile('  Michael Oliver , England  '),
    {
      name: 'Michael Oliver',
      country: 'England',
      available: true,
    },
  );
  assert.deepEqual(
    runtime.refereeProfile(''),
    {
      name: '',
      country: '',
      available: false,
    },
  );
  assert.equal(runtime.refereeHistoryKey('Michael   Oliver, England'), 'michael oliver');
  assert.match(app, /refereeProfile\?\.name/);
});

test('RC41 digest controls are explicit opt-in and opt-out actions', async () => {
  const sent = [];
  const digest = createDigestRuntime({
    telegramApi: async (method, _cfg, payload) => {
      sent.push({ method, payload });
      return {};
    },
  });

  await digest.sendDigestControls(
    new Request('https://bot.test/webhook'),
    {},
    456,
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(sent[0].payload.chat_id, 456);
  assert.deepEqual(
    sent[0].payload.reply_markup.inline_keyboard[0].map(button => ({
      text: button.text,
      callback_data: button.callback_data,
    })),
    [
      { text: '✅ Включить', callback_data: 'digest:on' },
      { text: '🔕 Выключить', callback_data: 'digest:off' },
    ],
  );
});

test('RC41 digest subscription persists opt-in state in memory and marks a Telegram mutation', async () => {
  const memory = { botDigestSubscriptions: new Map() };
  const mutations = [];
  const digest = createDigestRuntime({
    memory,
    markTelegramWebhookMutation: (_cfg, mutation) => mutations.push(mutation),
  });

  const enabled = await digest.setBotDigestSubscription(
    123,
    456,
    true,
    {},
    'https://app.test/',
  );
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.telegram_id, 123);
  assert.equal(enabled.chat_id, 456);
  assert.equal(enabled.hour_utc, 7);
  assert.equal(enabled.app_url, 'https://app.test/');
  assert.equal(memory.botDigestSubscriptions.get(123).enabled, true);

  const disabled = await digest.setBotDigestSubscription(
    123,
    999,
    false,
    {},
    '',
  );
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.chat_id, 456);
  assert.equal(memory.botDigestSubscriptions.get(123).enabled, false);
  assert.deepEqual(mutations, ['digest_subscription', 'digest_subscription']);

  const publicSettings = digest.publicDigestSettings(disabled, 'PRO', [
    { team_id: 10, team_name: 'Arsenal' },
  ]);
  assert.equal(publicSettings.enabled, false);
  assert.equal(publicSettings.configured, true);
  assert.equal(publicSettings.delivery.hourUtc, 7);
  assert.equal(publicSettings.delivery.editable, false);
  assert.equal(publicSettings.capabilities.planSpecificContent, true);
  assert.deepEqual(publicSettings.favoriteTeams, [
    { teamId: 10, teamName: 'Arsenal' },
  ]);
});

test('RC41 digest subscription uses only the service-side Supabase table path', async () => {
  const upserts = [];
  const digest = createDigestRuntime({
    hasSupabase: () => true,
    supaSelectOne: async () => ({
      telegram_id: 123,
      chat_id: 456,
      enabled: false,
      app_url: 'https://old.test/',
    }),
    supaUpsert: async (...args) => {
      upserts.push(args);
      return true;
    },
  });

  await digest.setBotDigestSubscription(
    123,
    999,
    true,
    { supabase: true },
    'https://new.test/',
  );

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][1], 'bot_digest_subscriptions');
  assert.equal(upserts[0][2].telegram_id, 123);
  assert.equal(upserts[0][2].chat_id, 456);
  assert.equal(upserts[0][2].enabled, true);
  assert.equal(upserts[0][2].app_url, 'https://new.test/');
  assert.equal(upserts[0][3], 'telegram_id');
});

test('RC41 historical digest migration keeps RLS and service-role-only table privileges', () => {
  assert.match(migration, /alter table public\.bot_digest_subscriptions enable row level security/i);
  assert.match(
    migration,
    /revoke all privileges on table public\.bot_digest_subscriptions from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete on table public\.bot_digest_subscriptions to service_role/i,
  );
  assert.match(migration, /HISTORICAL \/ FROZEN MIGRATION/);
});
