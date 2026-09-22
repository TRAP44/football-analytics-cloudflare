import {
  CALIBRATION_LIFECYCLE_RULES,
  calibrationProfileFingerprint,
  evaluatePostPromotionRollback,
  evaluatePromotionWindows,
  splitRollingValidation,
} from './calibration-lifecycle.js';
import {
  DEVELOPMENT_TELEGRAM_ID,
  isAdminUser,
  telegramIdList,
} from './access-control.js';

const memory = {
  users: new Map(),
  usage: new Map(),
  cache: new Map(),
  history: new Map(),
  favorites: new Map(),
  reminders: new Map(),
  preferences: new Map(),
  oddsSnapshots: new Map(),
  billingPayments: new Map(),
  modelPredictions: new Map(),
  modelRemediation: { lastRun: null, actions: [] },
  opsEvents: [],
  integrity: { lastRun: null, recentIssues: [] },
  releaseReadiness: null,
  providerAudit: { last: null, byFixture: new Map() },
  providerE2E: { last: null },
  productionReadiness: null,
  rcRegression: null,
  releaseMonitor: null,
  runtimeControls: { value: null, loadedAt: 0, source: 'defaults', schemaReady: null },
  clientTelemetryDedupe: new Map(),
  inflight: new Map(),
  routeBurst: new Map(),
  userSyncAt: new Map(),
  providerFeatureFetch: {
    api: 0,
    cache: 0,
    stale: 0,
    skipped: 0,
    byFeature: {},
    lastUpdatedAt: null,
  },
  telemetry: {
    startedAt: new Date().toISOString(),
    apiRequests: 0,
    apiSuccess: 0,
    apiErrors: 0,
    rateLimits: 0,
    cacheHits: 0,
    cacheMisses: 0,
    staleCacheHits: 0,
    cacheWrites: 0,
    cacheWriteErrors: 0,
    supabaseErrors: 0,
    routeErrors: 0,
    integrityRuns: 0,
    integrityWarnings: 0,
    integrityErrors: 0,
    integrityQuarantined: 0,
    integrityDuplicates: 0,
    singleflightJoins: 0,
    burstBlocks: 0,
    upstreamTimeouts: 0,
    userSyncSkips: 0,
    memoryPrunes: 0,
  },
  provider: { name: 'API-Football', plan: 'UNKNOWN', dailyLimit: null, dailyRemaining: null, minuteLimit: null, minuteRemaining: null, updatedAt: null, cooldownUntil: null, lastError: '', lastStatus: null, lastLatencyMs: null, lastRequestAt: null, lastSuccessAt: null },
};

const enc = new TextEncoder();
const APP_VERSION = '6.11.0-rc19';
const API_CONTRACT_VERSION = 5;
const MIN_CLIENT_VERSION = '5.8.0';
const RELEASE_CHANNEL = 'rc19';
const RC_NAME = 'RC19';
const MAX_MEMORY_OPS_EVENTS = 50;

const DEFAULT_PREFERENCES = Object.freeze({
  defaultFilter: 'top',
  reminderMinutes: 30,
  kickoffNotification: true,
  hideYouth: true,
  favoriteFirst: true,
});

const DEFAULT_RUNTIME_CONTROLS = Object.freeze({
  maintenanceMode: false,
  analysisEnabled: true,
  searchEnabled: true,
  liveEnabled: true,
  remindersEnabled: true,
  expandedDataEnabled: true,
  autoSettlementRecoveryEnabled: false,
  message: '',
  revision: 1,
  updatedAt: null,
});
const RUNTIME_CONTROLS_CACHE_MS = 30_000;

const SUBSCRIPTION_PERIOD_SECONDS = 2592000;

const BILLING_PLANS = Object.freeze({
  PRO: {
    title: 'Football Analytics PRO',
    description: '20 анализов в день, расширенные функции и приоритетные обновления.',
    stars: 199,
    dailyLimit: 20,
  },
  PREMIUM: {
    title: 'Football Analytics PREMIUM',
    description: '100 анализов в день, максимальные лимиты и расширенные уведомления.',
    stars: 399,
    dailyLimit: 100,
  },
});

const MODEL_BASE_WEIGHTS = Object.freeze({
  market: 0.42,
  apiPrediction: 0.24,
  recentForm: 0.26,
  h2h: 0.08,
});

const CALIBRATION_PROFILE_VERSION = '4.0-atomic1';
const CALIBRATION_CACHE_KEY = `model-calibration:global:${CALIBRATION_PROFILE_VERSION}`;
const CALIBRATION_CACHE_MINUTES = 360;


function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-app-version': APP_VERSION,
      'x-api-contract': String(API_CONTRACT_VERSION),
      'x-min-client-version': MIN_CLIENT_VERSION,
      'x-release-channel': RELEASE_CHANNEL,
      'vary': 'x-telegram-init-data',
      ...extraHeaders,
    },
  });
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function intEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function config(env) {
  return {
    devMode: boolEnv(env.DEV_MODE, false),
    apiFootballKey: env.API_FOOTBALL_KEY || '',
    tavilyKey: env.TAVILY_KEY || '',
    botToken: env.TELEGRAM_BOT_TOKEN || '',
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    adminTelegramIds: telegramIdList(env.ADMIN_TELEGRAM_IDS),
    supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
    cacheMinutes: intEnv(env.CACHE_MINUTES, 20),
    liveOddsEnabled: boolEnv(env.ENABLE_LIVE_ODDS, true),
    // Монетизацию сознательно держим выключенной до финального этапа проекта.
    // Старый webhook может оставаться настроенным: pre-checkout будет отклонён,
    // а UI оплаты не показывается, пока флаг не включён явно.
    monetizationEnabled: boolEnv(env.MONETIZATION_ENABLED, false),
    opsRetentionDays: intEnv(env.OPS_RETENTION_DAYS, 14),
    limits: {
      FREE: intEnv(env.FREE_DAILY_LIMIT, 3),
      PRO: intEnv(env.PRO_DAILY_LIMIT, 20),
      PREMIUM: intEnv(env.PREMIUM_DAILY_LIMIT, 100),
    },
    starsPrices: {
      PRO: intEnv(env.PRO_STARS_PRICE, BILLING_PLANS.PRO.stars),
      PREMIUM: intEnv(env.PREMIUM_STARS_PRICE, BILLING_PLANS.PREMIUM.stars),
    },
  };
}

function runtimeControlsSnapshot() {
  return memory.runtimeControls?.value || { ...DEFAULT_RUNTIME_CONTROLS };
}

function normalizeRuntimeControls(row = {}) {
  return {
    maintenanceMode: Boolean(row.maintenance_mode ?? row.maintenanceMode ?? DEFAULT_RUNTIME_CONTROLS.maintenanceMode),
    analysisEnabled: (row.analysis_enabled ?? row.analysisEnabled) !== false,
    searchEnabled: (row.search_enabled ?? row.searchEnabled) !== false,
    liveEnabled: (row.live_enabled ?? row.liveEnabled) !== false,
    remindersEnabled: (row.reminders_enabled ?? row.remindersEnabled) !== false,
    expandedDataEnabled: (row.expanded_data_enabled ?? row.expandedDataEnabled) !== false,
    autoSettlementRecoveryEnabled: Boolean(row.auto_settlement_recovery_enabled ?? row.autoSettlementRecoveryEnabled ?? DEFAULT_RUNTIME_CONTROLS.autoSettlementRecoveryEnabled),
    message: String(row.message || '').slice(0, 280),
    revision: Math.max(1, Number(row.revision || 1)),
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function publicRuntimeControls(value = runtimeControlsSnapshot()) {
  return {
    maintenanceMode: Boolean(value.maintenanceMode),
    analysisEnabled: value.analysisEnabled !== false,
    searchEnabled: value.searchEnabled !== false,
    liveEnabled: value.liveEnabled !== false,
    remindersEnabled: value.remindersEnabled !== false,
    expandedDataEnabled: value.expandedDataEnabled !== false,
    autoSettlementRecoveryEnabled: Boolean(value.autoSettlementRecoveryEnabled),
    message: String(value.message || '').slice(0, 280),
    revision: Number(value.revision || 1),
    updatedAt: value.updatedAt || null,
  };
}

async function loadRuntimeControls(cfg, options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && memory.runtimeControls?.value && now - Number(memory.runtimeControls.loadedAt || 0) < RUNTIME_CONTROLS_CACHE_MS) {
    return { ...memory.runtimeControls, cached: true };
  }

  if (!hasSupabase(cfg)) {
    const value = { ...DEFAULT_RUNTIME_CONTROLS };
    memory.runtimeControls = { value, loadedAt: now, source: 'defaults', schemaReady: false };
    return { ...memory.runtimeControls, cached: false };
  }

  try {
    const row = await supaSelectOne(cfg, 'runtime_controls', { id: 'eq.global' });
    const value = normalizeRuntimeControls(row || DEFAULT_RUNTIME_CONTROLS);
    memory.runtimeControls = { value, loadedAt: now, source: row ? 'supabase' : 'defaults', schemaReady: Boolean(row) };
    return { ...memory.runtimeControls, cached: false };
  } catch (error) {
    const previous = memory.runtimeControls?.value;
    const value = previous || { ...DEFAULT_RUNTIME_CONTROLS };
    memory.runtimeControls = { value, loadedAt: now, source: previous ? 'stale' : 'defaults', schemaReady: false, error: redactOpsString(error?.message || error, 160) };
    return { ...memory.runtimeControls, cached: false };
  }
}


function runtimeHistorySnapshot(value) {
  const c = publicRuntimeControls(value);
  return {
    maintenanceMode: c.maintenanceMode,
    analysisEnabled: c.analysisEnabled,
    searchEnabled: c.searchEnabled,
    liveEnabled: c.liveEnabled,
    remindersEnabled: c.remindersEnabled,
    expandedDataEnabled: c.expandedDataEnabled,
    autoSettlementRecoveryEnabled: c.autoSettlementRecoveryEnabled,
    message: c.message,
    revision: c.revision,
    updatedAt: c.updatedAt,
  };
}

async function probeRuntimeHistorySchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/runtime_control_history`);
    url.searchParams.set('select', 'id,revision,action,reason,snapshot,app_version,source_revision,created_at');
    url.searchParams.set('limit', '1');
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase runtime history schema');
    return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
  } catch (error) {
    return { ok: false, status: error?.code || 'error' };
  }
}

async function ensureRuntimeHistoryBaseline(cfg, value, user) {
  const snapshot = runtimeHistorySnapshot(value);
  await supaInsertIgnore(cfg, 'runtime_control_history', {
    revision: Number(snapshot.revision || 1),
    action: 'baseline',
    reason: 'Baseline captured before the first runtime-history change.',
    snapshot,
    app_version: APP_VERSION,
    changed_by: Number(user?.id || 0) || null,
    source_revision: null,
    created_at: snapshot.updatedAt || new Date().toISOString(),
  }, 'revision');
}

async function appendRuntimeHistory(cfg, value, user, meta = {}) {
  const snapshot = runtimeHistorySnapshot(value);
  await supaInsertIgnore(cfg, 'runtime_control_history', {
    revision: Number(snapshot.revision || 1),
    action: String(meta.action || 'update').slice(0, 40),
    reason: String(meta.reason || '').trim().slice(0, 240),
    snapshot,
    app_version: APP_VERSION,
    changed_by: Number(user?.id || 0) || null,
    source_revision: Number(meta.sourceRevision || 0) || null,
    created_at: new Date().toISOString(),
  }, 'revision');
}

async function listRuntimeHistory(cfg, limit = 12) {
  const rows = await supaSelectMany(cfg, 'runtime_control_history', {}, {
    limit: Math.max(1, Math.min(30, Number(limit || 12))),
    order: 'revision.desc',
  });

  return (rows || []).map(row => {
    const snapshot = normalizeRuntimeControls(row.snapshot || {});
    return {
      id: Number(row.id || 0),
      revision: Number(row.revision || snapshot.revision || 0),
      action: String(row.action || 'update'),
      reason: String(row.reason || '').slice(0, 240),
      appVersion: String(row.app_version || ''),
      sourceRevision: Number(row.source_revision || 0) || null,
      createdAt: row.created_at || null,
      controls: publicRuntimeControls(snapshot),
    };
  });
}

async function rollbackRuntimeControls(cfg, user, body = {}) {
  const historySchema = await probeRuntimeHistorySchema(cfg);
  if (!historySchema.ok) {
    return {
      error: 'Нужна supabase_migration_v5_8.sql для истории и rollback.',
      code: 'RUNTIME_HISTORY_SCHEMA',
      status: 409,
    };
  }

  const expectedRevision = Number(body.expectedRevision || 0);
  const historyId = Number(body.historyId || 0);
  if (!expectedRevision || !historyId) {
    return { error: 'Не хватает revision/historyId для rollback.', code: 'RUNTIME_ROLLBACK_INPUT', status: 400 };
  }

  const row = await supaSelectOne(cfg, 'runtime_control_history', { id: `eq.${historyId}` });
  if (!row?.snapshot) {
    return { error: 'Снимок Runtime Controls не найден.', code: 'RUNTIME_ROLLBACK_NOT_FOUND', status: 404 };
  }

  const target = normalizeRuntimeControls(row.snapshot);
  if (Number(target.revision || 0) === expectedRevision) {
    return { error: 'Выбрана уже активная revision.', code: 'RUNTIME_ROLLBACK_SAME_REVISION', status: 409 };
  }

  return await saveRuntimeControls(cfg, user, {
    expectedRevision,
    maintenanceMode: target.maintenanceMode,
    analysisEnabled: target.analysisEnabled,
    searchEnabled: target.searchEnabled,
    liveEnabled: target.liveEnabled,
    remindersEnabled: target.remindersEnabled,
    expandedDataEnabled: target.expandedDataEnabled,
    autoSettlementRecoveryEnabled: target.autoSettlementRecoveryEnabled,
    message: target.message,
    reason: String(body.reason || `Rollback to revision ${Number(row.revision || target.revision || 0)}`).slice(0, 240),
    action: 'rollback',
    sourceRevision: Number(row.revision || target.revision || 0),
  });
}

async function saveRuntimeControls(cfg, user, body = {}) {
  const currentState = await loadRuntimeControls(cfg, { force: true });
  if (!currentState.schemaReady) {
    return { error: 'Нужна supabase_migration_v5_7.sql.', code: 'RUNTIME_CONTROLS_SCHEMA', status: 409 };
  }

  const current = currentState.value;
  const expectedRevision = Number(body.expectedRevision || 0);
  if (!expectedRevision || expectedRevision !== Number(current.revision || 1)) {
    return {
      error: 'Настройки уже изменились в другой сессии. Обновите панель и повторите.',
      code: 'RUNTIME_CONTROLS_CONFLICT',
      status: 409,
      current: publicRuntimeControls(current),
    };
  }

  const historySchema = await probeRuntimeHistorySchema(cfg);
  if (historySchema.ok) {
    await ensureRuntimeHistoryBaseline(cfg, current, user).catch(() => {});
  }

  const changeReason = String(body.reason || '').trim().slice(0, 240);
  const requestedAction = String(body.action || 'update').trim();
  const changeAction = ['update', 'defaults', 'rollback'].includes(requestedAction) ? requestedAction : 'update';
  const sourceRevision = Number(body.sourceRevision || 0) || null;

  const next = {
    maintenance_mode: Boolean(body.maintenanceMode),
    analysis_enabled: body.analysisEnabled !== false,
    search_enabled: body.searchEnabled !== false,
    live_enabled: body.liveEnabled !== false,
    reminders_enabled: body.remindersEnabled !== false,
    expanded_data_enabled: body.expandedDataEnabled !== false,
    auto_settlement_recovery_enabled: Boolean(body.autoSettlementRecoveryEnabled),
    message: String(body.message || '').trim().slice(0, 280),
    revision: expectedRevision + 1,
    updated_at: new Date().toISOString(),
    updated_by: Number(user?.id || 0) || null,
  };

  const url = new URL(`${cfg.supabaseUrl}/rest/v1/runtime_controls`);
  url.searchParams.set('id', 'eq.global');
  url.searchParams.set('revision', `eq.${expectedRevision}`);
  const response = await fetchWithTimeout(url, {
    method: 'PATCH',
    headers: supaHeaders(cfg, { Prefer: 'return=representation' }),
    body: JSON.stringify(next),
  }, 7000, 'Supabase runtime controls');

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Supabase runtime_controls: HTTP ${response.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length !== 1) {
    return {
      error: 'Настройки изменились до сохранения. Обновите панель и повторите.',
      code: 'RUNTIME_CONTROLS_CONFLICT',
      status: 409,
      current: publicRuntimeControls((await loadRuntimeControls(cfg, { force: true })).value),
    };
  }

  const value = normalizeRuntimeControls(rows[0]);
  memory.runtimeControls = { value, loadedAt: Date.now(), source: 'supabase', schemaReady: true };

  if (historySchema.ok) {
    await appendRuntimeHistory(cfg, value, user, {
      action: changeAction,
      reason: changeReason,
      sourceRevision,
    }).catch(() => {});
  }

  await recordOpsEvent(cfg, {
    severity: value.maintenanceMode ? 'warning' : 'info',
    source: 'release',
    eventType: 'runtime_controls',
    code: value.maintenanceMode ? 'MAINTENANCE_ENABLED' : 'RUNTIME_CONTROLS_UPDATED',
    message: `Runtime controls updated to revision ${value.revision}.`,
    endpoint: '/api/runtime-controls',
    meta: {
      revision: value.revision,
      maintenanceMode: value.maintenanceMode,
      analysisEnabled: value.analysisEnabled,
      searchEnabled: value.searchEnabled,
      liveEnabled: value.liveEnabled,
      remindersEnabled: value.remindersEnabled,
      expandedDataEnabled: value.expandedDataEnabled,
      autoSettlementRecoveryEnabled: value.autoSettlementRecoveryEnabled,
      action: changeAction,
      reason: changeReason,
      sourceRevision,
      historyReady: historySchema.ok,
    },
  }).catch(() => {});
  return { value, status: 200, historyReady: historySchema.ok };
}

function runtimeFeatureResponse(code, message, runtime, status = 503) {
  return json({
    error: message,
    code,
    category: code === 'MAINTENANCE_MODE' ? 'maintenance' : 'feature_disabled',
    recoverable: true,
    runtime: publicRuntimeControls(runtime),
  }, status);
}

function runtimeGuard(request, user, cfg, runtime) {
  if (isAdminUser(user, cfg)) return null;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const footballRoutes = new Set([
    '/api/matches', '/api/search', '/api/tournament', '/api/team', '/api/team/intelligence',
    '/api/team/squad', '/api/match-center', '/api/analyze'
  ]);

  if (runtime.maintenanceMode && footballRoutes.has(path)) {
    return runtimeFeatureResponse(
      'MAINTENANCE_MODE',
      runtime.message || 'Football Manager временно находится на техническом обслуживании. Попробуйте позже.',
      runtime,
      503,
    );
  }
  if (path === '/api/analyze' && method === 'POST' && runtime.analysisEnabled === false) {
    return runtimeFeatureResponse('ANALYSIS_DISABLED', 'Полный анализ временно приостановлен администратором.', runtime, 503);
  }
  if (path === '/api/search' && runtime.searchEnabled === false) {
    return runtimeFeatureResponse('SEARCH_DISABLED', 'Удалённый поиск временно приостановлен. Локальный каталог остаётся доступен.', runtime, 503);
  }
  if (path === '/api/reminders' && method === 'POST' && runtime.remindersEnabled === false) {
    return runtimeFeatureResponse('REMINDERS_DISABLED', 'Новые уведомления временно приостановлены. Уже созданные можно удалить.', runtime, 503);
  }
  return null;
}

async function apiRuntimeControls(request, cfg, user) {
  if (request.method === 'GET') {
    const state = await loadRuntimeControls(cfg, { force: new URL(request.url).searchParams.get('refresh') === '1' });
    const historySchema = await probeRuntimeHistorySchema(cfg);
    let history = [];
    if (historySchema.ok) {
      history = await listRuntimeHistory(cfg, 12).catch(() => []);
    }
    return json({
      available: Boolean(state.schemaReady),
      source: state.source,
      schemaReady: Boolean(state.schemaReady),
      historyReady: Boolean(historySchema.ok),
      controls: publicRuntimeControls(state.value),
      history,
      cacheSeconds: Math.round(RUNTIME_CONTROLS_CACHE_MS / 1000),
      reason: state.schemaReady ? '' : 'Нужна supabase_migration_v5_7.sql.',
      historyReason: historySchema.ok ? '' : 'Нужна supabase_migration_v5_8.sql для истории и rollback.',
    });
  }

  if (request.method === 'PATCH' || request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const result = await saveRuntimeControls(cfg, user, body);
    if (result.error) return json({ error: result.error, code: result.code, current: result.current }, result.status || 400);

    let history = [];
    if (result.historyReady) history = await listRuntimeHistory(cfg, 12).catch(() => []);
    return json({
      ok: true,
      controls: publicRuntimeControls(result.value),
      historyReady: Boolean(result.historyReady),
      history,
    });
  }

  return json({ error: 'Метод не поддерживается.' }, 405);
}

async function apiRuntimeRollback(request, cfg, user) {
  if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);

  let body = {};
  try { body = await request.json(); } catch {}
  const result = await rollbackRuntimeControls(cfg, user, body);
  if (result.error) {
    return json({
      error: result.error,
      code: result.code,
      current: result.current,
    }, result.status || 400);
  }

  const history = await listRuntimeHistory(cfg, 12).catch(() => []);
  return json({
    ok: true,
    controls: publicRuntimeControls(result.value),
    historyReady: true,
    history,
  });
}

function publicDataCapabilities() {
  const paid = ['PRO', 'ULTRA', 'MEGA'].includes(String(memory.provider?.plan || '').toUpperCase());
  const healthy = paidQuotaHealthy();
  const publicBudget = providerPublicBudgetMode();
  const runtime = runtimeControlsSnapshot();
  const expandedAllowed = runtime.expandedDataEnabled !== false;
  const liveAllowed = runtime.liveEnabled !== false;
  const canEnrich = Boolean(paid && healthy && expandedAllowed && !['conserve','emergency'].includes(publicBudget.mode));
  return {
    visibility: 'public',
    mode: paid ? 'expanded' : 'standard',
    label: runtime.maintenanceMode ? 'Техническое обслуживание' : publicBudget.label,
    refreshSeconds: liveAllowed ? publicBudget.liveRefreshSeconds : 0,
    runtime: publicRuntimeControls(runtime),
    features: {
      events: true,
      matchStatistics: true,
      liveRefresh: liveAllowed,
      lineupsFallback: Boolean(paid && healthy && expandedAllowed),
      playerStats: canEnrich,
      injuries: canEnrich,
      liveOdds: Boolean(canEnrich && liveAllowed),
      oddsMovement: Boolean(canEnrich && liveAllowed),
    },
    note: runtime.maintenanceMode
      ? (runtime.message || 'Часть футбольных функций временно приостановлена.')
      : !expandedAllowed
        ? 'Расширенные provider-данные временно отключены администратором.'
        : paid
          ? (canEnrich
              ? 'Расширенный режим активен. Feature-level cache снижает повторные запросы.'
              : 'Расширенный тариф активен, но сейчас включён защитный режим квоты.')
          : 'Сейчас приложение экономит запросы. После увеличения квоты расширенные данные включатся автоматически.',
  };
}


function appManifest(cfg) {
  return {
    ok: true,
    app: 'football-manager',
    version: APP_VERSION,
    recommendedClientVersion: APP_VERSION,
    minClientVersion: MIN_CLIENT_VERSION,
    apiContract: API_CONTRACT_VERSION,
    releaseChannel: RELEASE_CHANNEL,
    releaseCandidate: RC_NAME,
    maintenance: Boolean(runtimeControlsSnapshot().maintenanceMode),
    monetization: cfg.monetizationEnabled ? 'enabled' : 'paused',
    runtime: publicRuntimeControls(),
    compatibility: {
      hardBlockBelowMinClient: true,
      contractRequired: API_CONTRACT_VERSION,
      softReloadOnVersionDifference: true,
    },
    features: {
      startupSafety: true,
      rollbackSafety: true,
      failureRecovery: true,
      productionLoadSafety: true,
      regressionQA: true,
      releaseMonitor: true,
      clientTelemetry: true,
      notificationReliability: true,
      reminderDeliveryClaims: true,
      runtimeControls: true,
      emergencyKillSwitches: true,
      runtimeRollback: true,
      runtimeHistory: true,
      predictionIntegrity: true,
      modelVersionCohorts: true,
      calibrationDiagnostics: true,
      predictionRemediation: true,
      settlementRecovery: true,
      settlementWatchdog: true,
      automaticSettlementRecovery: true,
      settlementCircuitBreaker: true,
      settlementReliability: true,
      settlementRunLedger: true,
      interruptedRunRecovery: true,
      settlementFinalityVerification: true,
      settlementDriftGuard: true,
      settlementDriftReview: true,
      settlementAdjudication: true,
      trustedMetricsGate: true,
      twoPassSettlementFinality: true,
      calibrationPromotionGate: true,
      adaptiveWeightsHoldout: true,
      calibrationChampionChallenger: true,
      calibrationAutomaticRollback: true,
    },
    serverTime: new Date().toISOString(),
  };
}

function adminForbidden() {
  return json({ error: 'Этот технический раздел доступен только администратору.', code: 'ADMIN_ONLY' }, 403);
}

function publicRouteError(error, rateLimited = false) {
  const code = String(error?.code || (rateLimited ? 'FOOTBALL_RATE_LIMIT' : 'SERVER_ERROR'));
  const retryAfter = Number(error?.retryAfter || 0) || undefined;

  if (rateLimited || ['FOOTBALL_RATE_LIMIT', 'FOOTBALL_COOLDOWN'].includes(code)) {
    return {
      status: 429,
      body: {
        error: retryAfter
          ? `Футбольные данные временно обновляются медленнее. Повторите примерно через ${retryAfter} сек.`
          : 'Футбольные данные временно обновляются медленнее. Попробуйте чуть позже.',
        code,
        category: 'rate_limit',
        recoverable: true,
        retryAfter,
      },
    };
  }

  if (code === 'UPSTREAM_TIMEOUT') {
    return {
      status: 504,
      body: {
        error: 'Источник данных отвечает медленнее обычного. Сохранённые данные останутся доступны, попробуйте обновить позже.',
        code,
        category: 'timeout',
        recoverable: true,
      },
    };
  }

  if (code.startsWith('FOOTBALL_')) {
    return {
      status: 502,
      body: {
        error: 'Футбольный источник временно недоступен. Приложение использует кэш там, где он есть.',
        code,
        category: 'provider',
        recoverable: true,
        retryAfter,
      },
    };
  }

  const raw = String(error?.message || '');
  if (/supabase|postgrest|database/i.test(raw)) {
    return {
      status: 503,
      body: {
        error: 'Сервис хранения данных временно недоступен. Основные футбольные экраны попробуют продолжить работу через кэш.',
        code: code === 'SERVER_ERROR' ? 'DATABASE_DEGRADED' : code,
        category: 'database',
        recoverable: true,
      },
    };
  }

  return {
    status: 502,
    body: {
      error: 'Сервис временно недоступен. Попробуйте повторить действие через несколько секунд.',
      code,
      category: 'service',
      recoverable: true,
      retryAfter,
    },
  };
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function fetchWithTimeout(input, init = {}, timeoutMs = 8000, source = 'upstream') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), Math.max(500, Number(timeoutMs || 8000)));
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      bumpTelemetry('upstreamTimeouts');
      const timeoutError = new Error(`${source} timeout после ${Math.max(500, Number(timeoutMs || 8000))} мс`);
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      timeoutError.source = source;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function withSingleFlight(key, factory, options = {}) {
  const normalized = String(key || '');
  if (!normalized) return await factory();
  const existing = memory.inflight.get(normalized);
  if (existing) {
    if (options.countTelemetry !== false) bumpTelemetry('singleflightJoins');
    return await existing;
  }
  const task = Promise.resolve().then(factory);
  memory.inflight.set(normalized, task);
  try {
    return await task;
  } finally {
    if (memory.inflight.get(normalized) === task) memory.inflight.delete(normalized);
  }
}

function pruneMemoryState() {
  let pruned = 0;
  const now = Date.now();

  if (memory.cache.size > 600) {
    for (const [key, value] of memory.cache) {
      if (Number(value?.expiresAt || 0) <= now && memory.cache.size > 450) {
        memory.cache.delete(key);
        pruned++;
      }
    }
    while (memory.cache.size > 500) {
      const first = memory.cache.keys().next().value;
      if (first === undefined) break;
      memory.cache.delete(first);
      pruned++;
    }
  }

  if (memory.userSyncAt.size > 1500) {
    for (const [key, at] of memory.userSyncAt) {
      if (now - Number(at || 0) > 60 * 60 * 1000) {
        memory.userSyncAt.delete(key);
        pruned++;
      }
    }
  }

  if (memory.routeBurst.size > 2500) {
    for (const [key, bucket] of memory.routeBurst) {
      if (now - Number(bucket?.startedAt || 0) > 5 * 60 * 1000) {
        memory.routeBurst.delete(key);
        pruned++;
      }
    }
  }

  if (memory.clientTelemetryDedupe.size > 1500) {
    for (const [key, at] of memory.clientTelemetryDedupe) {
      if (now - Number(at || 0) > 30 * 60 * 1000) {
        memory.clientTelemetryDedupe.delete(key);
        pruned++;
      }
    }
  }

  if (pruned) bumpTelemetry('memoryPrunes', pruned);
  return pruned;
}

const ROUTE_BURST_POLICIES = Object.freeze([
  { test: p => p === '/api/analyze', limit: 3, windowMs: 30000, label: 'analysis' },
  { test: p => p === '/api/match-center', limit: 8, windowMs: 10000, label: 'match-center' },
  { test: p => p === '/api/search', limit: 10, windowMs: 10000, label: 'search' },
  { test: p => p === '/api/tournament', limit: 8, windowMs: 10000, label: 'tournament' },
  { test: p => p === '/api/team' || p.startsWith('/api/team/'), limit: 10, windowMs: 10000, label: 'team' },
  { test: p => p === '/api/provider/e2e-validation', limit: 1, windowMs: 30000, label: 'provider-e2e' },
  { test: p => p === '/api/provider/coverage-audit', limit: 2, windowMs: 30000, label: 'coverage-audit' },
  { test: p => p === '/api/provider/probe', limit: 3, windowMs: 30000, label: 'provider-probe' },
  { test: p => p === '/api/client-telemetry', limit: 12, windowMs: 60000, label: 'client-telemetry' },
  { test: p => p === '/api/reminder-health', limit: 6, windowMs: 30000, label: 'reminder-health' },
  { test: p => p === '/api/runtime-controls', limit: 6, windowMs: 30000, label: 'runtime-controls' },
  { test: p => p === '/api/runtime-controls/rollback', limit: 3, windowMs: 30000, label: 'runtime-rollback' },
  { test: p => p === '/api/model-remediation', limit: 4, windowMs: 60000, label: 'model-remediation' },
  { test: p => p === '/api/diagnostics' || p === '/api/release-readiness' || p === '/api/production-readiness' || p === '/api/rc-regression' || p === '/api/release-monitor', limit: 6, windowMs: 30000, label: 'admin-diagnostics' },
]);

function routeBurstPolicy(pathname) {
  return ROUTE_BURST_POLICIES.find(policy => policy.test(pathname)) || null;
}

function enforceRouteBurst(request, user) {
  const path = new URL(request.url).pathname;
  const policy = routeBurstPolicy(path);
  if (!policy || !user?.id) return null;

  const now = Date.now();
  const key = `${Number(user.id)}:${policy.label}`;
  const current = memory.routeBurst.get(key);
  let bucket = current;
  if (!bucket || now - Number(bucket.startedAt || 0) >= policy.windowMs) {
    bucket = { startedAt: now, count: 0 };
  }
  bucket.count += 1;
  memory.routeBurst.set(key, bucket);

  if (bucket.count <= policy.limit) {
    if (memory.routeBurst.size > 2500) pruneMemoryState();
    return null;
  }

  const retryAfter = Math.max(1, Math.ceil((policy.windowMs - (now - bucket.startedAt)) / 1000));
  bumpTelemetry('burstBlocks');
  return json({
    error: 'Слишком много одинаковых действий подряд. Подождите несколько секунд.',
    code: 'BURST_GUARD',
    retryAfter,
  }, 429, { 'retry-after': String(retryAfter) });
}

function productionSafetySnapshot() {
  return {
    singleflight: {
      active: memory.inflight.size,
      joins: Number(memory.telemetry?.singleflightJoins || 0),
    },
    burstGuard: {
      activeBuckets: memory.routeBurst.size,
      blocked: Number(memory.telemetry?.burstBlocks || 0),
      policies: ROUTE_BURST_POLICIES.map(x => ({ label: x.label, limit: x.limit, windowMs: x.windowMs })),
    },
    upstream: {
      timeouts: Number(memory.telemetry?.upstreamTimeouts || 0),
      supabaseTimeoutMs: 7000,
      apiFootballTimeoutMs: 10000,
    },
    memory: {
      cacheEntries: memory.cache.size,
      cacheSoftLimit: 500,
      userSyncEntries: memory.userSyncAt.size,
      userSyncTtlSeconds: 600,
      pruned: Number(memory.telemetry?.memoryPrunes || 0),
    },
  };
}

function hasSupabase(cfg) {
  return Boolean(cfg.supabaseUrl && cfg.supabaseKey);
}

function supaHeaders(cfg, extra = {}) {
  // New Supabase sb_secret_* keys are opaque API keys, not JWTs.
  // Send them only in the apikey header. Putting sb_secret_* in
  // Authorization: Bearer makes PostgREST try to parse it as a JWT
  // and can produce PGRST303 / JWT validation errors.
  return {
    apikey: cfg.supabaseKey,
    'content-type': 'application/json',
    ...extra,
  };
}

async function supaSelectOne(cfg, table, params) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('limit', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, `Supabase ${table}`);
  if (!r.ok) throw new Error(`Supabase ${table}: HTTP ${r.status}`);
  const rows = await r.json();
  return rows?.[0] || null;
}

async function supaSelectMany(cfg, table, params = {}, { limit = 20, order = '' } = {}) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('limit', String(limit));
  if (order) url.searchParams.set('order', order);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, `Supabase ${table}`);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return await r.json();
}

async function supaSelectPaged(cfg, table, params = {}, { pageSize = 500, maxRows = 5000, order = '' } = {}) {
  const rows = [];
  const size = Math.max(1, Math.min(1000, Number(pageSize || 500)));
  const cap = Math.max(size, Math.min(10000, Number(maxRows || 5000)));
  for (let offset = 0; offset < cap; offset += size) {
    const page = await supaSelectMany(cfg, table, { ...params, offset: String(offset) }, {
      limit: Math.min(size, cap - offset),
      order,
    });
    rows.push(...page);
    if (page.length < Math.min(size, cap - offset)) return { rows, truncated: false };
  }
  return { rows, truncated: rows.length >= cap };
}

async function supaUpsert(cfg, table, rows, onConflict) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  if (onConflict) url.searchParams.set('on_conflict', onConflict);
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: supaHeaders(cfg, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  }, 7000, `Supabase ${table}`);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
  }
}

async function supaInsertIgnore(cfg, table, rows, onConflict) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  if (onConflict) url.searchParams.set('on_conflict', onConflict);
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: supaHeaders(cfg, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  }, 7000, `Supabase ${table}`);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
  }
}

async function supaPatch(cfg, table, filters, patch) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(filters || {})) url.searchParams.set(k, v);
  const r = await fetchWithTimeout(url, {
    method: 'PATCH',
    headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
    body: JSON.stringify(patch || {}),
  }, 7000, `Supabase ${table}`);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
  }
}

async function supaDelete(cfg, table, filters = {}) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(filters || {})) url.searchParams.set(k, v);
  const r = await fetchWithTimeout(url, {
    method: 'DELETE',
    headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
  }, 7000, `Supabase ${table}`);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
  }
}

async function supaRpc(cfg, functionName, payload = {}) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/rpc/${functionName}`);
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: supaHeaders(cfg),
    body: JSON.stringify(payload || {}),
  }, 7000, `Supabase RPC ${functionName}`);
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const error = new Error(`Supabase RPC ${functionName}: HTTP ${r.status}${body?.message ? ` — ${redactOpsString(body.message, 180)}` : ''}`);
    error.code = String(body?.code || `HTTP_${r.status}`);
    error.detail = body?.details || null;
    throw error;
  }
  return Array.isArray(body) && body.length === 1 ? body[0] : body;
}

async function readBackendSecurityContract(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const [contract, defaultAcl] = await Promise.all([
      supaRpc(cfg, 'backend_security_contract'),
      supaRpc(cfg, 'backend_default_acl_contract'),
    ]);
    return {
      ok: Boolean(contract?.ok && defaultAcl?.ok),
      status: contract?.ok && defaultAcl?.ok ? 'ok' : 'violations',
      checkedAt: defaultAcl?.checked_at || contract?.checked_at || null,
      schemaViolations: Array.isArray(contract?.schema_violations) ? contract.schema_violations : [],
      tableViolations: Array.isArray(contract?.table_violations) ? contract.table_violations : [],
      sequenceViolations: Array.isArray(contract?.sequence_violations) ? contract.sequence_violations : [],
      functionViolations: Array.isArray(contract?.function_violations) ? contract.function_violations : [],
      defaultAclViolations: Array.isArray(defaultAcl?.default_acl_violations) ? defaultAcl.default_acl_violations : [],
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.code || 'error',
      detail: redactOpsString(error?.message || error, 160),
      schemaViolations: [],
      tableViolations: [],
      sequenceViolations: [],
      functionViolations: [],
      defaultAclViolations: [],
    };
  }
}

function bumpTelemetry(key, amount = 1) {
  if (!memory.telemetry) return;
  const current = Number(memory.telemetry[key] || 0);
  memory.telemetry[key] = current + Number(amount || 0);
}

function redactOpsString(value, max = 500) {
  return String(value ?? '')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/sb_secret_[A-Za-z0-9_-]+/gi, 'sb_secret_[redacted]')
    .replace(/x-apisports-key\s*[:=]\s*[^\s,;]+/gi, 'x-apisports-key=[redacted]')
    .slice(0, max);
}

function safeOpsMetadata(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (/token|secret|password|authorization|api.?key|init.?data/i.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = redactOpsString(value, 240);
    else if (Array.isArray(value)) out[key] = value.slice(0, 12).map(x => typeof x === 'string' ? redactOpsString(x, 120) : x);
    else if (typeof value === 'object') {
      try { out[key] = JSON.parse(redactOpsString(JSON.stringify(value), 600)); }
      catch { out[key] = redactOpsString(String(value), 240); }
    }
  }
  return out;
}

async function recordOpsEvent(cfg, event = {}) {
  const row = {
    created_at: new Date().toISOString(),
    severity: ['info','warning','error','critical'].includes(String(event.severity || '')) ? String(event.severity) : 'info',
    source: redactOpsString(event.source || 'worker', 80),
    event_type: redactOpsString(event.eventType || 'runtime', 100),
    code: redactOpsString(event.code || '', 100),
    message: redactOpsString(event.message || '', 500),
    endpoint: redactOpsString(event.endpoint || '', 160),
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : null,
    duration_ms: Number.isFinite(Number(event.durationMs)) ? Math.max(0, Math.round(Number(event.durationMs))) : null,
    metadata: safeOpsMetadata(event.meta || {}),
  };
  memory.opsEvents.unshift(row);
  memory.opsEvents = memory.opsEvents.slice(0, MAX_MEMORY_OPS_EVENTS);
  if (!hasSupabase(cfg)) return row;
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    await fetchWithTimeout(url, {
      method: 'POST',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    }, 4000, 'Supabase ops event');
  } catch {
    // Observability must never become a new failure mode for the product.
  }
  return row;
}

async function cleanupOpsEvents(cfg) {
  if (!hasSupabase(cfg)) return { skipped: true };
  const days = Math.max(1, Number(cfg.opsRetentionDays || 14));
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  try {
    await supaDelete(cfg, 'ops_events', { created_at: `lt.${cutoff}` });
    return { ok: true, cutoff };
  } catch (error) {
    return { ok: false, error: redactOpsString(error?.message || error, 180) };
  }
}


async function cleanupIntegrityData(cfg) {
  if (!hasSupabase(cfg)) return;
  const cutoff = new Date(Date.now() - cfg.opsRetentionDays * 86400000).toISOString();
  try { await supaDelete(cfg, 'match_integrity_events', { observed_at: `lt.${cutoff}` }); } catch {}
  try { await supaDelete(cfg, 'match_integrity_runs', { observed_at: `lt.${cutoff}` }); } catch {}
}

function telemetrySnapshot() {
  const t = memory.telemetry || {};
  const requests = Number(t.apiRequests || 0);
  const hits = Number(t.cacheHits || 0);
  const misses = Number(t.cacheMisses || 0);
  const stale = Number(t.staleCacheHits || 0);
  const cacheLookups = hits + misses + stale;
  return {
    startedAt: t.startedAt || null,
    uptimeSeconds: t.startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(t.startedAt)) / 1000)) : null,
    apiRequests: requests,
    apiSuccess: Number(t.apiSuccess || 0),
    apiErrors: Number(t.apiErrors || 0),
    rateLimits: Number(t.rateLimits || 0),
    quotaBlocks: Number(t.quotaBlocks || 0),
    apiSuccessRate: requests ? Math.round((Number(t.apiSuccess || 0) / requests) * 1000) / 10 : null,
    cacheHits: hits,
    cacheMisses: misses,
    staleCacheHits: stale,
    cacheWrites: Number(t.cacheWrites || 0),
    cacheWriteErrors: Number(t.cacheWriteErrors || 0),
    cacheHitRate: cacheLookups ? Math.round((hits / cacheLookups) * 1000) / 10 : null,
    supabaseErrors: Number(t.supabaseErrors || 0),
    routeErrors: Number(t.routeErrors || 0),
    integrityRuns: Number(t.integrityRuns || 0),
    integrityWarnings: Number(t.integrityWarnings || 0),
    integrityErrors: Number(t.integrityErrors || 0),
    integrityQuarantined: Number(t.integrityQuarantined || 0),
    integrityDuplicates: Number(t.integrityDuplicates || 0),
    singleflightJoins: Number(t.singleflightJoins || 0),
    burstBlocks: Number(t.burstBlocks || 0),
    upstreamTimeouts: Number(t.upstreamTimeouts || 0),
    userSyncSkips: Number(t.userSyncSkips || 0),
    memoryPrunes: Number(t.memoryPrunes || 0),
    inflightNow: memory.inflight.size,
    routeBucketsNow: memory.routeBurst.size,
    l1CacheEntries: memory.cache.size,
    note: 'Runtime counters describe the current Cloudflare Worker isolate; provider quota values come from API-Football response headers.',
  };
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}

async function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmacSha256(enc.encode('WebAppData'), botToken);
  const calculated = bytesToHex(await hmacSha256(new Uint8Array(secretKey), dataCheckString));
  if (!constantTimeEqual(calculated.toLowerCase(), receivedHash.toLowerCase())) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 24 * 60 * 60) return null;

  try {
    const user = JSON.parse(params.get('user') || '{}');
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

async function getRequestUser(request, cfg) {
  const initData = request.headers.get('x-telegram-init-data') || '';
  let user = await validateTelegramInitData(initData, cfg.botToken);
  if (!user && cfg.devMode) {
    user = {
      id: DEVELOPMENT_TELEGRAM_ID,
      username: 'dev_user',
      first_name: 'DEV',
      last_name: 'User',
      __developmentIdentity: true,
    };
  }
  if (!user) return null;
  try {
    await upsertUser(user, cfg);
  } catch (error) {
    // Authentication is already cryptographically validated. A transient DB
    // write problem must not take public read-only football screens offline.
    bumpTelemetry('supabaseErrors');
    recordOpsEvent(cfg, {
      severity: 'warning', source: 'auth', eventType: 'user_sync', code: 'USER_SYNC_DEGRADED',
      message: error?.message || error, meta: { telegramId: Number(user.id) },
    }).catch(() => {});
  }
  return user;
}

async function upsertUser(user, cfg) {
  const userId = Number(user.id);
  const record = {
    telegram_id: userId,
    username: user.username || null,
    first_name: user.first_name || null,
    last_name: user.last_name || null,
    photo_url: user.photo_url || null,
    updated_at: new Date().toISOString(),
  };

  if (hasSupabase(cfg)) {
    const lastSync = Number(memory.userSyncAt.get(userId) || 0);
    if (lastSync && Date.now() - lastSync < 10 * 60 * 1000) {
      bumpTelemetry('userSyncSkips');
      return;
    }
    await withSingleFlight(`user-sync:${userId}`, async () => {
      const insideLastSync = Number(memory.userSyncAt.get(userId) || 0);
      if (insideLastSync && Date.now() - insideLastSync < 10 * 60 * 1000) {
        bumpTelemetry('userSyncSkips');
        return;
      }
      await supaUpsert(cfg, 'users', record, 'telegram_id');
      memory.userSyncAt.set(userId, Date.now());
      if (memory.userSyncAt.size > 1500) pruneMemoryState();
    });
    return;
  }
  const old = memory.users.get(userId) || { plan: 'FREE', created_at: new Date().toISOString() };
  memory.users.set(userId, { ...old, ...record });
}

async function getUserRecord(userId, cfg) {
  if (hasSupabase(cfg)) {
    return await supaSelectOne(cfg, 'users', { telegram_id: `eq.${Number(userId)}` });
  }
  return memory.users.get(Number(userId)) || { telegram_id: Number(userId), plan: 'FREE' };
}

async function getUsage(userId, cfg) {
  const date = todayUtc();
  if (hasSupabase(cfg)) {
    const row = await supaSelectOne(cfg, 'usage_daily', {
      telegram_id: `eq.${Number(userId)}`,
      usage_date: `eq.${date}`,
    });
    return Number(row?.analyses || 0);
  }
  return Number(memory.usage.get(`${userId}:${date}`) || 0);
}

async function incrementUsage(userId, cfg) {
  const date = todayUtc();
  const next = (await getUsage(userId, cfg)) + 1;
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'usage_daily', {
      telegram_id: Number(userId),
      usage_date: date,
      analyses: next,
      updated_at: new Date().toISOString(),
    }, 'telegram_id,usage_date');
  } else {
    memory.usage.set(`${userId}:${date}`, next);
  }
  return next;
}

async function getQuota(userId, cfg) {
  const user = await getUserRecord(userId, cfg);
  let plan = user?.plan || 'FREE';
  if (plan !== 'FREE' && user?.subscription_until && new Date(user.subscription_until) < new Date()) plan = 'FREE';
  const used = await getUsage(userId, cfg);
  const limit = cfg.limits[plan] || cfg.limits.FREE;
  return { plan, used, limit, left: Math.max(0, limit - used) };
}

function billingPlanConfig(plan, cfg) {
  const key = String(plan || '').toUpperCase();
  if (!BILLING_PLANS[key]) return null;
  return {
    key,
    ...BILLING_PLANS[key],
    stars: Number(cfg.starsPrices?.[key] || BILLING_PLANS[key].stars),
    dailyLimit: Number(cfg.limits?.[key] || BILLING_PLANS[key].dailyLimit),
  };
}

async function invoiceSignature(base, botToken) {
  return bytesToHex(await hmacSha256(enc.encode(botToken), base)).slice(0, 24);
}

async function makeInvoicePayload(userId, plan, botToken) {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(6));
  const nonce = bytesToHex(nonceBytes);
  const base = `fa1|${Number(userId)}|${String(plan).toUpperCase()}|${nonce}`;
  return `${base}|${await invoiceSignature(base, botToken)}`;
}

async function parseInvoicePayload(payload, botToken) {
  const parts = String(payload || '').split('|');
  if (parts.length !== 5 || parts[0] !== 'fa1') return null;
  const [, uidRaw, planRaw, nonce, sig] = parts;
  const uid = Number(uidRaw);
  const plan = String(planRaw || '').toUpperCase();
  if (!Number.isSafeInteger(uid) || !BILLING_PLANS[plan] || !/^[0-9a-f]{12}$/i.test(nonce) || !/^[0-9a-f]{24}$/i.test(sig)) return null;
  const base = `fa1|${uid}|${plan}|${nonce}`;
  const expected = await invoiceSignature(base, botToken);
  if (!constantTimeEqual(expected.toLowerCase(), sig.toLowerCase())) return null;
  return { userId: uid, plan, nonce };
}

async function telegramApi(method, cfg, body = {}) {
  if (!cfg.botToken) throw new Error('TELEGRAM_BOT_TOKEN не настроен.');
  const r = await fetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok) throw new Error(data?.description || `Telegram ${method}: HTTP ${r.status}`);
  return data.result;
}

async function updateUserSubscription(userId, fields, cfg) {
  const patch = { ...fields, plan_updated_at: new Date().toISOString() };
  if (hasSupabase(cfg)) {
    await supaPatch(cfg, 'users', { telegram_id: `eq.${Number(userId)}` }, patch);
  } else {
    const old = memory.users.get(Number(userId)) || { telegram_id: Number(userId), plan: 'FREE' };
    memory.users.set(Number(userId), { ...old, ...patch });
  }
}

async function saveBillingPayment(row, cfg) {
  if (!row?.telegram_payment_charge_id) return;
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'billing_payments', row, 'telegram_payment_charge_id');
  } else {
    memory.billingPayments.set(String(row.telegram_payment_charge_id), row);
  }
}

async function applySuccessfulPayment(userId, payment, cfg, fallbackDate = Math.floor(Date.now() / 1000)) {
  if (!payment || payment.currency !== 'XTR') return false;
  const parsed = await parseInvoicePayload(payment.invoice_payload, cfg.botToken);
  if (!parsed || Number(parsed.userId) !== Number(userId)) return false;
  const planCfg = billingPlanConfig(parsed.plan, cfg);
  if (!planCfg || Number(payment.total_amount) !== Number(planCfg.stars)) return false;

  const expiresUnix = Number(payment.subscription_expiration_date || 0)
    || (Number(fallbackDate || Math.floor(Date.now() / 1000)) + SUBSCRIPTION_PERIOD_SECONDS);
  const expiresAt = new Date(expiresUnix * 1000).toISOString();

  const chargeId = String(payment.telegram_payment_charge_id || '');
  if (!chargeId) return false;

  await saveBillingPayment({
    telegram_payment_charge_id: chargeId,
    telegram_id: Number(userId),
    plan: parsed.plan,
    stars_amount: Number(payment.total_amount),
    currency: 'XTR',
    invoice_payload: String(payment.invoice_payload || ''),
    provider_payment_charge_id: payment.provider_payment_charge_id || null,
    subscription_expiration_date: expiresAt,
    is_recurring: Boolean(payment.is_recurring),
    is_first_recurring: Boolean(payment.is_first_recurring),
    status: 'paid',
    created_at: new Date(Number(fallbackDate || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  }, cfg);

  await updateUserSubscription(userId, {
    plan: parsed.plan,
    subscription_until: expiresAt,
    subscription_canceled: false,
    telegram_payment_charge_id: chargeId,
  }, cfg);
  return true;
}

async function billingWebhookStatus(request, cfg) {
  if (!cfg.botToken || !cfg.webhookSecret) {
    return { ready: false, reason: 'webhook_not_configured', expectedUrl: `${new URL(request.url).origin}/telegram/webhook` };
  }
  const expectedUrl = `${new URL(request.url).origin}/telegram/webhook`;
  try {
    const info = await telegramApi('getWebhookInfo', cfg);
    const ready = String(info?.url || '') === expectedUrl;
    return {
      ready,
      expectedUrl,
      currentUrl: info?.url || '',
      pendingUpdates: Number(info?.pending_update_count || 0),
      lastError: info?.last_error_message || '',
      reason: ready ? '' : 'webhook_url_mismatch',
    };
  } catch (e) {
    return { ready: false, reason: 'webhook_check_failed', expectedUrl, error: String(e?.message || e) };
  }
}

async function syncBillingFromStars(userId, cfg) {
  const tx = await telegramApi('getStarTransactions', cfg, { offset: 0, limit: 100 });
  const list = Array.isArray(tx?.transactions) ? tx.transactions : [];
  let best = null;

  for (const item of list) {
    const source = item?.source;
    if (!source || source.type !== 'user' || source.transaction_type !== 'invoice_payment') continue;
    if (Number(source.user?.id) !== Number(userId)) continue;
    const parsed = await parseInvoicePayload(source.invoice_payload, cfg.botToken);
    if (!parsed || Number(parsed.userId) !== Number(userId)) continue;
    const planCfg = billingPlanConfig(parsed.plan, cfg);
    if (!planCfg || Number(item.amount) !== Number(planCfg.stars)) continue;
    const period = Number(source.subscription_period || SUBSCRIPTION_PERIOD_SECONDS);
    const expiresUnix = Number(item.date || 0) + period;
    if (!best || expiresUnix > best.expiresUnix) best = { item, source, parsed, expiresUnix };
  }

  if (!best || best.expiresUnix * 1000 <= Date.now()) {
    return { synced: false, quota: await getQuota(userId, cfg) };
  }

  await applySuccessfulPayment(userId, {
    currency: 'XTR',
    total_amount: Number(best.item.amount),
    invoice_payload: best.source.invoice_payload,
    telegram_payment_charge_id: String(best.item.id || ''),
    provider_payment_charge_id: '',
    subscription_expiration_date: best.expiresUnix,
    is_recurring: true,
    is_first_recurring: false,
  }, cfg, Number(best.item.date || Math.floor(Date.now() / 1000)));

  return { synced: true, quota: await getQuota(userId, cfg) };
}

async function handleTelegramWebhook(request, cfg) {
  if (!cfg.webhookSecret) return json({ ok: false, error: 'webhook_secret_missing' }, 503);
  const provided = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!constantTimeEqual(String(provided), String(cfg.webhookSecret))) return json({ ok: false }, 403);

  let update = {};
  try { update = await request.json(); } catch { return json({ ok: false }, 400); }

  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    if (!cfg.monetizationEnabled) {
      await telegramApi('answerPreCheckoutQuery', cfg, {
        pre_checkout_query_id: q.id,
        ok: false,
        error_message: 'Оплата временно отключена: мы завершаем основной функционал сервиса.',
      });
      return json({ ok: true });
    }
    let ok = false;
    let errorMessage = 'Не удалось проверить подписку.';
    try {
      const parsed = await parseInvoicePayload(q.invoice_payload, cfg.botToken);
      const planCfg = parsed ? billingPlanConfig(parsed.plan, cfg) : null;
      ok = Boolean(
        parsed
        && Number(parsed.userId) === Number(q.from?.id)
        && q.currency === 'XTR'
        && planCfg
        && Number(q.total_amount) === Number(planCfg.stars)
      );
      if (!ok) errorMessage = 'Параметры подписки не совпадают. Откройте приложение и создайте счёт заново.';
    } catch {}
    await telegramApi('answerPreCheckoutQuery', cfg, {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: errorMessage }),
    });
    return json({ ok: true });
  }

  const msg = update.message;
  if (msg?.successful_payment) {
    await applySuccessfulPayment(msg.from?.id, msg.successful_payment, cfg, Number(msg.date || Math.floor(Date.now() / 1000)));
    return json({ ok: true });
  }

  if (msg?.refunded_payment) {
    const refund = msg.refunded_payment;
    const userId = Number(msg.from?.id || 0);
    const chargeId = String(refund.telegram_payment_charge_id || '');
    if (hasSupabase(cfg) && chargeId) {
      await supaPatch(cfg, 'billing_payments', { telegram_payment_charge_id: `eq.${chargeId}` }, { status: 'refunded', updated_at: new Date().toISOString() });
    }
    const record = userId ? await getUserRecord(userId, cfg) : null;
    if (record && String(record.telegram_payment_charge_id || '') === chargeId) {
      await updateUserSubscription(userId, {
        plan: 'FREE',
        subscription_until: new Date().toISOString(),
        subscription_canceled: true,
        telegram_payment_charge_id: null,
      }, cfg);
    }
    return json({ ok: true });
  }

  if (update.subscription) {
    const sub = update.subscription;
    const parsed = await parseInvoicePayload(sub.invoice_payload, cfg.botToken);
    if (parsed && Number(parsed.userId) === Number(sub.user?.id)) {
      if (sub.state === 'canceled') {
        await updateUserSubscription(parsed.userId, { subscription_canceled: true }, cfg);
      } else if (sub.state === 'active') {
        await updateUserSubscription(parsed.userId, { subscription_canceled: false }, cfg);
      }
    }
    return json({ ok: true });
  }

  if (msg?.text && /^\/start(?:@\w+)?(?:\s|$)/i.test(msg.text)) {
    const appUrl = new URL(request.url).origin;
    await telegramApi('sendMessage', cfg, {
      chat_id: msg.chat?.id,
      text: '⚽ Football Analytics\n\nОткройте приложение, чтобы выбрать матч и получить анализ.',
      reply_markup: {
        inline_keyboard: [[{ text: '⚽ Открыть приложение', web_app: { url: appUrl } }]],
      },
    });
  }

  return json({ ok: true });
}

async function apiBillingPlans(request, cfg, user) {
  const webhook = await billingWebhookStatus(request, cfg);
  const quota = await getQuota(user.id, cfg);
  const record = await getUserRecord(user.id, cfg);
  return json({
    ready: webhook.ready,
    reason: webhook.reason || '',
    webhook: { expectedUrl: webhook.expectedUrl, currentUrl: webhook.currentUrl || '', lastError: webhook.lastError || '' },
    current: {
      plan: quota.plan,
      subscriptionUntil: record?.subscription_until || null,
      canceled: Boolean(record?.subscription_canceled),
    },
    plans: {
      FREE: { stars: 0, dailyLimit: cfg.limits.FREE },
      PRO: { stars: billingPlanConfig('PRO', cfg).stars, dailyLimit: cfg.limits.PRO },
      PREMIUM: { stars: billingPlanConfig('PREMIUM', cfg).stars, dailyLimit: cfg.limits.PREMIUM },
    },
  });
}

async function apiBillingInvoice(request, cfg, user) {
  const webhook = await billingWebhookStatus(request, cfg);
  if (!webhook.ready) return json({ error: 'Оплата ещё не активирована: Telegram webhook не настроен.', webhook }, 503);

  let body = {};
  try { body = await request.json(); } catch {}
  const plan = String(body.plan || '').toUpperCase();
  const planCfg = billingPlanConfig(plan, cfg);
  if (!planCfg) return json({ error: 'Неизвестный тариф.' }, 400);

  const quota = await getQuota(user.id, cfg);
  const record = await getUserRecord(user.id, cfg);
  if (quota.plan !== 'FREE' && record?.subscription_until && new Date(record.subscription_until) > new Date()) {
    return json({ error: quota.plan === plan ? 'Этот тариф уже активен.' : 'Сначала отключите автопродление текущего тарифа и дождитесь окончания оплаченного периода.' }, 409);
  }

  const payload = await makeInvoicePayload(user.id, plan, cfg.botToken);
  const invoiceUrl = await telegramApi('createInvoiceLink', cfg, {
    title: planCfg.title,
    description: planCfg.description,
    payload,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: `${plan} · 30 дней`, amount: planCfg.stars }],
    subscription_period: SUBSCRIPTION_PERIOD_SECONDS,
  });
  return json({ invoiceUrl, plan, stars: planCfg.stars });
}

async function apiBillingSync(request, cfg, user) {
  return json(await syncBillingFromStars(user.id, cfg));
}

async function apiBillingSubscription(request, cfg, user) {
  let body = {};
  try { body = await request.json(); } catch {}
  const action = body.action === 'resume' ? 'resume' : 'cancel';
  const record = await getUserRecord(user.id, cfg);
  const chargeId = String(record?.telegram_payment_charge_id || '');
  if (!chargeId) return json({ error: 'Активная подписка Telegram Stars не найдена.' }, 404);
  await telegramApi('editUserStarSubscription', cfg, {
    user_id: Number(user.id),
    telegram_payment_charge_id: chargeId,
    is_canceled: action === 'cancel',
  });
  await updateUserSubscription(user.id, { subscription_canceled: action === 'cancel' }, cfg);
  return json({ ok: true, canceled: action === 'cancel' });
}

async function getCacheEntry(cacheKey, cfg, allowExpired = false) {
  // L1 cache inside the current Worker isolate. This reduces Supabase reads and
  // also gives us a tiny fallback during a transient database problem.
  const local = memory.cache.get(cacheKey);
  if (local && local.expiresAt > Date.now()) {
    bumpTelemetry('cacheHits');
    // Touch the key so Map insertion order acts as a lightweight LRU.
    memory.cache.delete(cacheKey);
    memory.cache.set(cacheKey, local);
    return { payload: local.payload, expired: false, expiresAt: new Date(local.expiresAt).toISOString(), layer: 'memory' };
  }

  if (hasSupabase(cfg)) {
    try {
      const row = await supaSelectOne(cfg, 'analysis_cache', { cache_key: `eq.${cacheKey}` });
      if (!row) {
        bumpTelemetry('cacheMisses');
        if (allowExpired && local) {
          bumpTelemetry('staleCacheHits');
          return { payload: local.payload, expired: true, expiresAt: new Date(local.expiresAt).toISOString(), layer: 'memory-stale' };
        }
        return null;
      }
      const expiresAtMs = Date.parse(row.expires_at);
      const expired = Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : true;
      memory.cache.set(cacheKey, { payload: row.payload, expiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() - 1 });
      if (expired && !allowExpired) {
        bumpTelemetry('cacheMisses');
        return null;
      }
      if (expired) bumpTelemetry('staleCacheHits');
      else bumpTelemetry('cacheHits');
      return { payload: row.payload, expired, expiresAt: row.expires_at, layer: 'supabase' };
    } catch (error) {
      bumpTelemetry('supabaseErrors');
      if (local && (allowExpired || local.expiresAt > Date.now())) {
        if (local.expiresAt <= Date.now()) bumpTelemetry('staleCacheHits');
        else bumpTelemetry('cacheHits');
        recordOpsEvent(cfg, {
          severity: 'warning', source: 'cache', eventType: 'supabase_cache_read_fallback', code: 'CACHE_DB_READ',
          message: error?.message || error, meta: { cacheKey },
        }).catch(() => {});
        return { payload: local.payload, expired: local.expiresAt <= Date.now(), expiresAt: new Date(local.expiresAt).toISOString(), layer: 'memory-fallback' };
      }
      recordOpsEvent(cfg, {
        severity: 'warning', source: 'cache', eventType: 'supabase_cache_read_degraded', code: 'CACHE_DB_READ_NO_L1',
        message: error?.message || error, meta: { cacheKey },
      }).catch(() => {});
      // Treat a transient shared-cache outage as a cache miss. The route may
      // still refresh from API-Football and serve the user.
      return null;
    }
  }

  if (!local) {
    bumpTelemetry('cacheMisses');
    return null;
  }
  const expired = local.expiresAt <= Date.now();
  if (expired && !allowExpired) {
    bumpTelemetry('cacheMisses');
    return null;
  }
  if (expired) bumpTelemetry('staleCacheHits');
  else bumpTelemetry('cacheHits');
  return { payload: local.payload, expired, expiresAt: new Date(local.expiresAt).toISOString(), layer: 'memory' };
}

async function getCache(cacheKey, cfg) {
  return (await getCacheEntry(cacheKey, cfg, false))?.payload || null;
}

async function getStaleCache(cacheKey, cfg) {
  return (await getCacheEntry(cacheKey, cfg, true))?.payload || null;
}

async function setCache(cacheKey, fixtureId, payload, cfg, minutes = cfg.cacheMinutes) {
  const ttlMinutes = Number.isFinite(Number(minutes)) ? Math.max(1 / 6, Number(minutes)) : cfg.cacheMinutes;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const expiresAtMs = Date.parse(expiresAt);
  // Always keep an L1 copy. Supabase remains the persistent/shared cache.
  memory.cache.set(cacheKey, { payload, expiresAt: expiresAtMs });
  if (memory.cache.size > 600) pruneMemoryState();
  bumpTelemetry('cacheWrites');
  if (!hasSupabase(cfg)) return;
  try {
    await supaUpsert(cfg, 'analysis_cache', {
      cache_key: cacheKey,
      fixture_id: Number(fixtureId),
      payload,
      expires_at: expiresAt,
    }, 'cache_key');
  } catch (error) {
    bumpTelemetry('cacheWriteErrors');
    bumpTelemetry('supabaseErrors');
    recordOpsEvent(cfg, {
      severity: 'warning', source: 'cache', eventType: 'supabase_cache_write_fallback', code: 'CACHE_DB_WRITE',
      message: error?.message || error, meta: { cacheKey, fixtureId: Number(fixtureId || 0) },
    }).catch(() => {});
    // Cache persistence is an optimization. Do not fail a successful user request
    // only because the shared cache could not be written.
  }
}

function predictionOutcomeKey(probabilities) {
  if (!probabilities) return '';
  const rows = [
    ['home', Number(probabilities.home)],
    ['draw', Number(probabilities.draw)],
    ['away', Number(probabilities.away)],
  ].filter(([, value]) => Number.isFinite(value));
  if (rows.length !== 3) return '';
  rows.sort((a, b) => b[1] - a[1]);
  return rows[0]?.[0] || '';
}

function predictionOutcomeLabel(key, homeName = 'Хозяева', awayName = 'Гости') {
  if (key === 'home') return homeName;
  if (key === 'away') return awayName;
  if (key === 'draw') return 'Ничья';
  return '—';
}

function topProbabilityValue(row) {
  return Math.max(Number(row?.home_prob || 0), Number(row?.draw_prob || 0), Number(row?.away_prob || 0));
}

function actualOutcomeFromGoals(homeGoals, awayGoals) {
  const h = Number(homeGoals), a = Number(awayGoals);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return '';
  if (h > a) return 'home';
  if (a > h) return 'away';
  return 'draw';
}

function regulationScore(fixture) {
  const full = fixture?.score?.fulltime || fixture?.score?.fullTime || null;
  let home = Number(full?.home), away = Number(full?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    home = Number(fixture?.goals?.home ?? fixture?.score?.home);
    away = Number(fixture?.goals?.away ?? fixture?.score?.away);
  }
  return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
}

function fixtureIdentity(fixture) {
  return Number(fixture?.fixture?.id || fixture?.fixtureId || fixture?.id || 0);
}

function fixtureStatusShort(fixture) {
  return String(fixture?.fixture?.status?.short || fixture?.status || '');
}

function scoreBrier(row, actualOutcome) {
  const probs = {
    home: Math.max(0, Math.min(1, Number(row.home_prob || 0) / 100)),
    draw: Math.max(0, Math.min(1, Number(row.draw_prob || 0) / 100)),
    away: Math.max(0, Math.min(1, Number(row.away_prob || 0) / 100)),
  };
  const sum = ['home','draw','away'].reduce((acc, key) => acc + Math.pow(probs[key] - (actualOutcome === key ? 1 : 0), 2), 0);
  return Math.round((sum / 3) * 10000) / 10000;
}

function validThreeProbabilities(probabilities) {
  return Boolean(probabilities && ['home','draw','away'].every(key => {
    const value = probabilities[key];
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }));
}

function rowFinalProbabilities(row) {
  const raw = [row?.home_prob, row?.draw_prob, row?.away_prob];
  if (raw.some(value => value === null || value === undefined || value === '')) return null;
  const p = { home: Number(raw[0]), draw: Number(raw[1]), away: Number(raw[2]) };
  if (!validThreeProbabilities(p)) return null;
  return normalizeThree(p.home, p.draw, p.away);
}

function rowRawProbabilities(row) {
  const raw = [row?.raw_home_prob, row?.raw_draw_prob, row?.raw_away_prob];
  if (raw.some(value => value === null || value === undefined || value === '')) return rowFinalProbabilities(row);
  const p = { home: Number(raw[0]), draw: Number(raw[1]), away: Number(raw[2]) };
  if (!validThreeProbabilities(p)) return rowFinalProbabilities(row);
  return normalizeThree(p.home, p.draw, p.away) || rowFinalProbabilities(row);
}

function brierFromProbabilities(probabilities, actualOutcome) {
  if (!validThreeProbabilities(probabilities) || !['home','draw','away'].includes(String(actualOutcome || ''))) return null;
  const probs = {
    home: Math.max(0, Math.min(1, Number(probabilities.home) / 100)),
    draw: Math.max(0, Math.min(1, Number(probabilities.draw) / 100)),
    away: Math.max(0, Math.min(1, Number(probabilities.away) / 100)),
  };
  const sum = ['home','draw','away'].reduce((acc, key) => acc + Math.pow(probs[key] - (actualOutcome === key ? 1 : 0), 2), 0);
  return Math.round((sum / 3) * 10000) / 10000;
}

function logLossFromProbabilities(probabilities, actualOutcome) {
  if (!validThreeProbabilities(probabilities) || !['home','draw','away'].includes(String(actualOutcome || ''))) return null;
  const p = Math.max(0.01, Math.min(0.99, Number(probabilities[actualOutcome]) / 100));
  return -Math.log(p);
}

function temperatureScaleProbabilities(probabilities, temperature = 1) {
  if (!validThreeProbabilities(probabilities)) return probabilities || null;
  const t = clamp(Number(temperature) || 1, 0.8, 1.35);
  if (Math.abs(t - 1) < 0.001) return normalizeThree(probabilities.home, probabilities.draw, probabilities.away);
  const exponent = 1 / t;
  const h = Math.pow(Math.max(0.0001, Number(probabilities.home) / 100), exponent);
  const d = Math.pow(Math.max(0.0001, Number(probabilities.draw) / 100), exponent);
  const a = Math.pow(Math.max(0.0001, Number(probabilities.away) / 100), exponent);
  return normalizeThree(h, d, a);
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function signalProbabilitySnapshot(signals) {
  const out = {};
  for (const signal of signals || []) {
    if (!signal?.name || !validThreeProbabilities(signal.probabilities)) continue;
    out[String(signal.name)] = normalizeThree(signal.probabilities.home, signal.probabilities.draw, signal.probabilities.away);
  }
  return out;
}

function predictedOutcomeForProbabilities(probabilities) {
  return predictionOutcomeKey(probabilities);
}

function averageMetric(rows, fn) {
  const values = (rows || []).map(fn).map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function fitTemperatureCalibration(rows) {
  const valid = (rows || [])
    .filter(row => ['home','draw','away'].includes(String(row.actual_outcome || '')) && rowRawProbabilities(row))
    .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0));
  const split = splitRollingValidation(valid);
  if (!split.ready) {
    return { active: false, temperature: 1, candidateTemperature: 1, sample: valid.length, trainSample: 0, validationSample: 0, validationWindows: [], baselineLogLoss: null, calibratedLogLoss: null, improvement: null, reason: 'Нужно минимум 80 trusted-матчей для двух последовательных holdout-окон.' };
  }

  const { train, windows } = split;

  let bestTemperature = 1;
  let bestTrainLoss = Infinity;
  for (let t = 0.8; t <= 1.3501; t += 0.05) {
    const temperature = Math.round(t * 100) / 100;
    const loss = averageMetric(train, row => logLossFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), temperature), row.actual_outcome));
    if (Number.isFinite(loss) && loss < bestTrainLoss) {
      bestTrainLoss = loss;
      bestTemperature = temperature;
    }
  }

  const validationWindows = windows.map(window => {
    const baselineLogLoss = averageMetric(window, row => logLossFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
    const candidateLogLoss = averageMetric(window, row => logLossFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), bestTemperature), row.actual_outcome));
    const baselineBrier = averageMetric(window, row => brierFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
    const candidateBrier = averageMetric(window, row => brierFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), bestTemperature), row.actual_outcome));
    return {
      sample: window.length,
      from: window[0]?.kickoff_at || null,
      to: window.at(-1)?.kickoff_at || null,
      baselineBrier,
      candidateBrier,
      baselineLogLoss,
      candidateLogLoss,
    };
  });
  const gate = evaluatePromotionWindows(validationWindows);
  const validation = windows.flat();
  const baselineValidation = averageMetric(validation, row => logLossFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
  const candidateValidation = averageMetric(validation, row => logLossFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), bestTemperature), row.actual_outcome));
  const gain = Number.isFinite(baselineValidation) && Number.isFinite(candidateValidation) ? baselineValidation - candidateValidation : 0;
  const active = Math.abs(bestTemperature - 1) >= 0.04 && gate.pass;
  return {
    active,
    temperature: active ? bestTemperature : 1,
    candidateTemperature: bestTemperature,
    sample: valid.length,
    trainSample: train.length,
    validationSample: validation.length,
    validationWindows: gate.windows,
    baselineLogLoss: Number.isFinite(baselineValidation) ? Math.round(baselineValidation * 1000) / 1000 : null,
    calibratedLogLoss: Number.isFinite(candidateValidation) ? Math.round(candidateValidation * 1000) / 1000 : null,
    improvement: Number.isFinite(baselineValidation) && baselineValidation > 0 ? Math.round((gain / baselineValidation) * 1000) / 10 : null,
    reason: gate.reason,
  };
}

function signalCalibrationStats(rows) {
  const names = Object.keys(MODEL_BASE_WEIGHTS);
  return names.map(name => {
    const samples = [];
    for (const row of rows || []) {
      const signalMap = parseJsonObject(row?.signal_probabilities);
      const probabilities = signalMap?.[name];
      if (!validThreeProbabilities(probabilities) || !['home','draw','away'].includes(String(row?.actual_outcome || ''))) continue;
      samples.push({ probabilities, actualOutcome: String(row.actual_outcome) });
    }
    const briers = samples.map(x => brierFromProbabilities(x.probabilities, x.actualOutcome)).filter(Number.isFinite);
    const hits = samples.filter(x => predictedOutcomeForProbabilities(x.probabilities) === x.actualOutcome).length;
    const avgBrier = briers.length ? average(briers) : null;
    return {
      name,
      sample: samples.length,
      accuracy: pct(hits, samples.length),
      avgBrier: Number.isFinite(avgBrier) ? Math.round(avgBrier * 1000) / 1000 : null,
      baseWeight: MODEL_BASE_WEIGHTS[name],
    };
  });
}

function adaptiveSignalWeights(stats) {
  const eligible = (stats || []).filter(x => x.sample >= 30 && Number.isFinite(Number(x.avgBrier)));
  const active = eligible.length >= 2;
  if (!active) return { active: false, weights: { ...MODEL_BASE_WEIGHTS }, stats: (stats || []).map(x => ({ ...x, currentWeight: MODEL_BASE_WEIGHTS[x.name] })) };

  const unnormalized = {};
  for (const item of stats || []) {
    const base = Number(MODEL_BASE_WEIGHTS[item.name] || 0);
    if (!base) continue;
    let adjusted = base;
    if (item.sample >= 30 && Number.isFinite(Number(item.avgBrier))) {
      // Uniform 1X2 has Brier ~= 0.222. Convert skill into a small, strongly capped weight adjustment.
      const qualityFactor = clamp(0.2222 / Math.max(0.12, Number(item.avgBrier)), 0.85, 1.15);
      const shrink = Math.min(1, item.sample / 100) * 0.65;
      adjusted = base * (1 + (qualityFactor - 1) * shrink);
      adjusted = clamp(adjusted, base * 0.88, base * 1.12);
    }
    unnormalized[item.name] = adjusted;
  }
  const sum = Object.values(unnormalized).reduce((acc, value) => acc + Number(value || 0), 0) || 1;
  const weights = Object.fromEntries(Object.entries(unnormalized).map(([name, value]) => [name, Number(value) / sum]));
  return {
    active: true,
    weights,
    stats: (stats || []).map(x => ({ ...x, currentWeight: Number(weights[x.name] ?? MODEL_BASE_WEIGHTS[x.name] ?? 0) })),
  };
}


function rowSignalBlendProbabilities(row, weightOverrides = MODEL_BASE_WEIGHTS) {
  const signalMap = parseJsonObject(row?.signal_probabilities);
  const configured = weightOverrides && typeof weightOverrides === 'object' ? weightOverrides : MODEL_BASE_WEIGHTS;
  const candidates = Object.keys(MODEL_BASE_WEIGHTS)
    .map(name => [name, signalMap?.[name], Number(configured[name] ?? MODEL_BASE_WEIGHTS[name])])
    .filter(([, probabilities, weight]) => validThreeProbabilities(probabilities) && Number.isFinite(weight) && weight > 0);
  if (candidates.length < 2) return null;
  const total = candidates.reduce((sum, row) => sum + row[2], 0);
  if (!(total > 0)) return null;
  let home = 0, draw = 0, away = 0;
  for (const [, probabilities, rawWeight] of candidates) {
    const weight = rawWeight / total;
    home += Number(probabilities.home) * weight;
    draw += Number(probabilities.draw) * weight;
    away += Number(probabilities.away) * weight;
  }
  return normalizeThree(home, draw, away);
}

function fitAdaptiveSignalWeightsHoldout(rows) {
  const valid = (rows || [])
    .filter(row => ['home','draw','away'].includes(String(row?.actual_outcome || '')) && rowSignalBlendProbabilities(row, MODEL_BASE_WEIGHTS))
    .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0));

  const fallbackStats = signalCalibrationStats(valid);
  const split = splitRollingValidation(valid);
  if (!split.ready) {
    return {
      active: false,
      weights: { ...MODEL_BASE_WEIGHTS },
      candidateWeights: { ...MODEL_BASE_WEIGHTS },
      stats: fallbackStats.map(x => ({ ...x, currentWeight: MODEL_BASE_WEIGHTS[x.name] || 0 })),
      sample: valid.length,
      trainSample: 0,
      validationSample: 0,
      baselineBrier: null,
      candidateBrier: null,
      baselineLogLoss: null,
      candidateLogLoss: null,
      brierGain: null,
      logLossGain: null,
      validationWindows: [],
      changedWeightL1: 0,
      reason: 'Нужно минимум 80 trusted-матчей для двух последовательных holdout-окон весов.',
    };
  }

  const { train, windows } = split;
  const validation = windows.flat();
  const trainStats = signalCalibrationStats(train);
  const candidate = adaptiveSignalWeights(trainStats);

  if (!candidate.active) {
    return {
      active: false,
      weights: { ...MODEL_BASE_WEIGHTS },
      candidateWeights: candidate.weights || { ...MODEL_BASE_WEIGHTS },
      stats: candidate.stats || fallbackStats,
      sample: valid.length,
      trainSample: train.length,
      validationSample: validation.length,
      baselineBrier: null,
      candidateBrier: null,
      baselineLogLoss: null,
      candidateLogLoss: null,
      brierGain: null,
      logLossGain: null,
      validationWindows: [],
      changedWeightL1: 0,
      reason: 'Обучающая часть ещё не сформировала устойчивый кандидат весов.',
    };
  }

  const evaluateRows = source => source.map(row => ({
      source: row,
      actualOutcome: String(row.actual_outcome),
      baseline: rowSignalBlendProbabilities(row, MODEL_BASE_WEIGHTS),
      candidate: rowSignalBlendProbabilities(row, candidate.weights),
    })).filter(row => row.baseline && row.candidate);
  const evaluated = evaluateRows(validation);
  const validationWindows = windows.map(window => {
    const windowRows = evaluateRows(window);
    return {
      sample: windowRows.length,
      from: windowRows[0]?.source?.kickoff_at || null,
      to: windowRows.at(-1)?.source?.kickoff_at || null,
      baselineBrier: averageMetric(windowRows, row => brierFromProbabilities(row.baseline, row.actualOutcome)),
      candidateBrier: averageMetric(windowRows, row => brierFromProbabilities(row.candidate, row.actualOutcome)),
      baselineLogLoss: averageMetric(windowRows, row => logLossFromProbabilities(row.baseline, row.actualOutcome)),
      candidateLogLoss: averageMetric(windowRows, row => logLossFromProbabilities(row.candidate, row.actualOutcome)),
    };
  });
  const gate = evaluatePromotionWindows(validationWindows);

  const baselineBrier = averageMetric(evaluated, row => brierFromProbabilities(row.baseline, row.actualOutcome));
  const candidateBrier = averageMetric(evaluated, row => brierFromProbabilities(row.candidate, row.actualOutcome));
  const baselineLogLoss = averageMetric(evaluated, row => logLossFromProbabilities(row.baseline, row.actualOutcome));
  const candidateLogLoss = averageMetric(evaluated, row => logLossFromProbabilities(row.candidate, row.actualOutcome));
  const brierGain = Number.isFinite(baselineBrier) && Number.isFinite(candidateBrier) ? baselineBrier - candidateBrier : null;
  const logLossGain = Number.isFinite(baselineLogLoss) && Number.isFinite(candidateLogLoss) ? baselineLogLoss - candidateLogLoss : null;
  const changedWeightL1 = Object.keys(MODEL_BASE_WEIGHTS)
    .reduce((sum, name) => sum + Math.abs(Number(candidate.weights?.[name] || 0) - Number(MODEL_BASE_WEIGHTS[name] || 0)), 0);

  // RC19 gate: both sequential holdout windows must beat the baseline.
  const active = changedWeightL1 >= 0.01 && gate.pass;

  return {
    active,
    weights: active ? candidate.weights : { ...MODEL_BASE_WEIGHTS },
    candidateWeights: candidate.weights,
    stats: candidate.stats,
    sample: valid.length,
    trainSample: train.length,
    validationSample: evaluated.length,
    validationWindows: gate.windows,
    baselineBrier: Number.isFinite(baselineBrier) ? Math.round(baselineBrier * 10000) / 10000 : null,
    candidateBrier: Number.isFinite(candidateBrier) ? Math.round(candidateBrier * 10000) / 10000 : null,
    baselineLogLoss: Number.isFinite(baselineLogLoss) ? Math.round(baselineLogLoss * 1000) / 1000 : null,
    candidateLogLoss: Number.isFinite(candidateLogLoss) ? Math.round(candidateLogLoss * 1000) / 1000 : null,
    brierGain: Number.isFinite(brierGain) ? Math.round(brierGain * 10000) / 10000 : null,
    logLossGain: Number.isFinite(logLossGain) ? Math.round(logLossGain * 1000) / 1000 : null,
    changedWeightL1: Math.round(changedWeightL1 * 10000) / 10000,
    reason: active ? gate.reason : `Кандидат весов остаётся в тени: ${gate.reason}`,
  };
}

function calibrationPromotionSelfTest() {
  const signalFor = (actual, strength, wrong = false) => {
    const key = wrong ? (actual === 'home' ? 'away' : 'home') : actual;
    const draw = Math.round((100 - strength) * 0.3);
    return key === 'home'
      ? { home: strength, draw, away: 100 - strength - draw }
      : { home: 100 - strength - draw, draw, away: strength };
  };
  const makeRows = (overfit = false) => Array.from({ length: 80 }, (_, index) => {
    const actual = index % 2 === 0 ? 'home' : 'away';
    const validation = index >= 64;
    return {
      fixture_id: index + 1,
      kickoff_at: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
      actual_outcome: actual,
      signal_probabilities: {
        // Train says market is strong and the other signals are weak.
        // Stable holdout keeps that relationship; overfit holdout flips it.
        market: signalFor(actual, 90, overfit && validation),
        apiPrediction: signalFor(actual, 70, true),
        recentForm: signalFor(actual, validation && overfit ? 90 : 75, !(validation && overfit)),
        h2h: signalFor(actual, 65, true),
      },
    };
  });
  const stable = fitAdaptiveSignalWeightsHoldout(makeRows(false));
  const overfit = fitAdaptiveSignalWeightsHoldout(makeRows(true));
  return {
    pass: stable.active &&
      stable.validationSample >= 12 &&
      Number(stable.brierGain) >= 0.001 &&
      Number(stable.logLossGain) >= 0 &&
      !overfit.active,
    stableActive: stable.active,
    stableValidation: stable.validationSample,
    stableBrierGain: stable.brierGain,
    stableLogLossGain: stable.logLossGain,
    overfitBlocked: !overfit.active,
    overfitBrierGain: overfit.brierGain,
    overfitLogLossGain: overfit.logLossGain,
  };
}

async function probeCalibrationPromotionSchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/model_calibration_validations`);
    url.searchParams.set('select', 'candidate_fingerprint,profile_version,decision,validation_sample');
    url.searchParams.set('limit', '1');
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase calibration promotion schema');
    return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
  } catch (error) {
    return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
  }
}

async function calibrationPromotionFingerprint(profile) {
  return await calibrationProfileFingerprint({
    ...profile,
    temperature: profile?.temperatureActive ? profile?.temperature : 1,
    signalWeights: profile?.weightsActive ? profile?.signalWeights : { ...MODEL_BASE_WEIGHTS },
  });
}

function calibrationMetricOrNull(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

async function persistCalibrationPromotionValidation(cfg, profile) {
  if (!hasSupabase(cfg) || !profile?.promotionGate?.validationReady) return;
  const schema = await probeCalibrationPromotionSchema(cfg);
  if (!schema.ok) return;
  const weights = profile.weightsValidation || {};
  const temp = profile.temperatureValidation || {};
  const candidateFingerprint = await calibrationPromotionFingerprint(profile);
  await supaInsertIgnore(cfg, 'model_calibration_validations', {
    candidate_fingerprint: candidateFingerprint,
    profile_version: String(profile.version || CALIBRATION_PROFILE_VERSION),
    decision: String(profile.promotionGate.status || 'shadow'),
    trusted_sample: Number(profile.sample || 0),
    train_sample: Math.max(Number(weights.trainSample || 0), Number(temp.trainSample || 0)),
    validation_sample: Math.max(Number(weights.validationSample || 0), Number(temp.validationSample || 0)),
    temperature_candidate: Number(temp.candidateTemperature || 1),
    temperature_active: Boolean(profile.temperatureActive),
    candidate_weights: weights.candidateWeights || { ...MODEL_BASE_WEIGHTS },
    weights_active: Boolean(profile.weightsActive),
    baseline_brier: calibrationMetricOrNull(weights.baselineBrier),
    candidate_brier: calibrationMetricOrNull(weights.candidateBrier),
    baseline_log_loss: calibrationMetricOrNull(weights.baselineLogLoss) ?? calibrationMetricOrNull(temp.baselineLogLoss),
    candidate_log_loss: calibrationMetricOrNull(weights.candidateLogLoss) ?? calibrationMetricOrNull(temp.calibratedLogLoss),
    brier_gain: calibrationMetricOrNull(weights.brierGain),
    log_loss_gain: calibrationMetricOrNull(weights.logLossGain),
    detail: {
      promotionGate: profile.promotionGate,
      weightsReason: weights.reason || '',
      temperatureImprovementPct: temp.improvement ?? null,
      appVersion: APP_VERSION,
    },
  }, 'candidate_fingerprint');
}

async function probeCalibrationLifecycleSchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const [profiles, state, transitions] = await Promise.all([
      probeOptionalTable(cfg, 'model_calibration_profiles'),
      probeOptionalTable(cfg, 'model_calibration_state'),
      probeOptionalTable(cfg, 'model_calibration_transitions'),
    ]);
    return { ok: Boolean(profiles.ok && state.ok && transitions.ok), profiles, state, transitions };
  } catch (error) {
    return { ok: false, status: error?.code || 'error' };
  }
}

function lifecycleProfileFromRow(row) {
  if (!row) return null;
  const stored = parseJsonObject(row?.detail)?.profile || {};
  return {
    ...stored,
    version: String(row.profile_version || stored.version || CALIBRATION_PROFILE_VERSION),
    fingerprint: String(row.fingerprint || stored.fingerprint || ''),
    temperature: Number(row.temperature || stored.temperature || 1),
    temperatureActive: Boolean(row.temperature_active),
    weightsActive: Boolean(row.weights_active),
    signalWeights: parseJsonObject(row.signal_weights) || stored.signalWeights || { ...MODEL_BASE_WEIGHTS },
    sample: Number(row.trusted_sample || stored.sample || 0),
    mode: row.temperature_active || row.weights_active ? 'active' : 'baseline',
  };
}

async function persistCalibrationLifecycleProfile(cfg, profile, status = 'challenger') {
  const fingerprint = profile?.fingerprint || await calibrationPromotionFingerprint(profile);
  const weights = profile?.weightsValidation || {};
  const temp = profile?.temperatureValidation || {};
  await supaInsertIgnore(cfg, 'model_calibration_profiles', {
    fingerprint,
    profile_version: String(profile?.version || CALIBRATION_PROFILE_VERSION),
    status,
    temperature: Number(profile?.temperature || 1),
    temperature_active: Boolean(profile?.temperatureActive),
    signal_weights: profile?.signalWeights || { ...MODEL_BASE_WEIGHTS },
    weights_active: Boolean(profile?.weightsActive),
    trusted_sample: Number(profile?.sample || 0),
    train_sample: Math.max(Number(weights.trainSample || 0), Number(temp.trainSample || 0)),
    validation_sample: Math.max(Number(weights.validationSample || 0), Number(temp.validationSample || 0)),
    validation_windows: weights.validationWindows?.length ? weights.validationWindows : temp.validationWindows || [],
    baseline_brier: calibrationMetricOrNull(weights.baselineBrier),
    candidate_brier: calibrationMetricOrNull(weights.candidateBrier),
    baseline_log_loss: calibrationMetricOrNull(weights.baselineLogLoss) ?? calibrationMetricOrNull(temp.baselineLogLoss),
    candidate_log_loss: calibrationMetricOrNull(weights.candidateLogLoss) ?? calibrationMetricOrNull(temp.calibratedLogLoss),
    source_cutoff: profile?.generatedAt || new Date().toISOString(),
    detail: { profile: { ...profile, fingerprint }, appVersion: APP_VERSION },
  }, 'fingerprint');
  return fingerprint;
}

async function loadCalibrationLifecycleState(cfg) {
  const state = await supaSelectOne(cfg, 'model_calibration_state', { id: 'eq.global' });
  if (!state) return { state: null, active: null, previous: null };
  const [active, previous] = await Promise.all([
    state.active_fingerprint ? supaSelectOne(cfg, 'model_calibration_profiles', { fingerprint: `eq.${state.active_fingerprint}` }) : null,
    state.previous_fingerprint ? supaSelectOne(cfg, 'model_calibration_profiles', { fingerprint: `eq.${state.previous_fingerprint}` }) : null,
  ]);
  return { state, active: lifecycleProfileFromRow(active), previous: lifecycleProfileFromRow(previous) };
}

function probabilitiesForCalibrationProfile(row, profile) {
  const weights = profile?.weightsActive ? profile.signalWeights : MODEL_BASE_WEIGHTS;
  const blended = rowSignalBlendProbabilities(row, weights);
  if (!blended) return null;
  return profile?.temperatureActive ? temperatureScaleProbabilities(blended, profile.temperature) : blended;
}

function compareCalibrationProfiles(rows, champion, challenger) {
  const valid = (rows || []).filter(row => ['home','draw','away'].includes(String(row?.actual_outcome || '')));
  const split = splitRollingValidation(valid);
  if (!split.ready) return { pass: false, status: 'shadow', windows: [], reason: 'Недостаточно trusted-матчей для champion–challenger сравнения.' };
  const windows = split.windows.map(window => {
    const evaluated = window.map(row => ({
      row,
      actual: String(row.actual_outcome),
      baseline: probabilitiesForCalibrationProfile(row, champion),
      candidate: probabilitiesForCalibrationProfile(row, challenger),
    })).filter(item => item.baseline && item.candidate);
    return {
      sample: evaluated.length,
      from: evaluated[0]?.row?.kickoff_at || null,
      to: evaluated.at(-1)?.row?.kickoff_at || null,
      baselineBrier: averageMetric(evaluated, item => brierFromProbabilities(item.baseline, item.actual)),
      candidateBrier: averageMetric(evaluated, item => brierFromProbabilities(item.candidate, item.actual)),
      baselineLogLoss: averageMetric(evaluated, item => logLossFromProbabilities(item.baseline, item.actual)),
      candidateLogLoss: averageMetric(evaluated, item => logLossFromProbabilities(item.candidate, item.actual)),
    };
  });
  return evaluatePromotionWindows(windows);
}

function evaluateActivePostPromotion(rows, active, previous) {
  if (!active?.fingerprint || !previous?.fingerprint) return evaluatePostPromotionRollback({ sample: 0 });
  const evaluated = (rows || []).filter(row =>
    String(row?.calibration_profile_fingerprint || '') === String(active.fingerprint)
    && ['home','draw','away'].includes(String(row?.actual_outcome || ''))
  ).map(row => ({
    actual: String(row.actual_outcome),
    active: rowFinalProbabilities(row),
    champion: probabilitiesForCalibrationProfile(row, previous),
  })).filter(item => item.active && item.champion);
  return evaluatePostPromotionRollback({
    sample: evaluated.length,
    activeBrier: averageMetric(evaluated, item => brierFromProbabilities(item.active, item.actual)),
    championBrier: averageMetric(evaluated, item => brierFromProbabilities(item.champion, item.actual)),
    activeLogLoss: averageMetric(evaluated, item => logLossFromProbabilities(item.active, item.actual)),
    championLogLoss: averageMetric(evaluated, item => logLossFromProbabilities(item.champion, item.actual)),
  });
}

async function saveCalibrationLifecycleState(cfg, currentState, next = {}) {
  return await supaRpc(cfg, 'transition_model_calibration', {
    p_expected_revision: Math.max(0, Number(currentState?.revision || 0)),
    p_action: String(next.action || ''),
    p_target_fingerprint: next.targetFingerprint || null,
    p_reason: String(next.reason || 'Calibration lifecycle transition.'),
    p_actor_telegram_id: next.actorTelegramId ? Number(next.actorTelegramId) : null,
    p_metadata: safeOpsMetadata(next.metadata || {}),
  });
}

function isCalibrationRevisionConflict(error) {
  return String(error?.code || '') === '40001'
    || /revision conflict/i.test(String(error?.message || ''));
}

async function notifyCalibrationAdmins(cfg, action, detail = '') {
  if (!cfg.botToken || !(cfg.adminTelegramIds || []).length) return;
  const labels = {
    initialize: 'инициализирован',
    promote: 'продвинут новый champion',
    rollback: 'выполнен автоматический rollback',
    manual_rollback: 'выполнен ручной rollback',
    freeze: 'lifecycle заморожен',
    unfreeze: 'lifecycle разморожен',
  };
  const text = `⚙️ Calibration RC19: ${labels[action] || action}.${detail ? `\n${String(detail).slice(0, 500)}` : ''}`;
  await Promise.allSettled((cfg.adminTelegramIds || []).map(id => sendTelegramMessage(id, text, cfg)));
}

async function resolveCalibrationLifecycle(cfg, candidate, trustedRows) {
  const fingerprint = await calibrationPromotionFingerprint(candidate);
  candidate.fingerprint = fingerprint;
  const schema = await probeCalibrationLifecycleSchema(cfg);
  if (!schema.ok) {
    const baseline = baselineCalibrationProfile(candidate.sample, candidate.signalStats || []);
    baseline.fingerprint = await calibrationPromotionFingerprint(baseline);
    return {
      ...baseline,
      lifecycle: { available: false, status: 'blocked', activeFingerprint: baseline.fingerprint, challengerFingerprint: fingerprint, reason: 'Нужна supabase_migration_v6_10.sql; production остаётся на baseline.' },
    };
  }

  const eligible = candidate?.promotionGate?.status === 'promoted';
  await persistCalibrationLifecycleProfile(cfg, candidate, eligible ? 'challenger' : candidate?.promotionGate?.status === 'held' ? 'held' : 'challenger');
  let lifecycle = await loadCalibrationLifecycleState(cfg);

  if (!lifecycle.active) {
    const baseline = baselineCalibrationProfile(candidate.sample, candidate.signalStats || []);
    baseline.fingerprint = await calibrationPromotionFingerprint(baseline);
    await persistCalibrationLifecycleProfile(cfg, baseline, 'active');
    try {
      const state = await saveCalibrationLifecycleState(cfg, lifecycle.state, {
        action: 'initialize',
        targetFingerprint: baseline.fingerprint,
        reason: 'RC19 baseline lifecycle initialization.',
        metadata: { appVersion: APP_VERSION },
      });
      lifecycle = { state, active: baseline, previous: null };
      await notifyCalibrationAdmins(cfg, 'initialize', `Active: ${baseline.fingerprint.slice(0, 12)}`);
    } catch (error) {
      if (!isCalibrationRevisionConflict(error)) throw error;
      lifecycle = await loadCalibrationLifecycleState(cfg);
    }
  }

  const postPromotion = evaluateActivePostPromotion(trustedRows, lifecycle.active, lifecycle.previous);
  if (postPromotion.rollback && lifecycle.previous?.fingerprint && !lifecycle.state?.frozen) {
    const failedFingerprint = lifecycle.active.fingerprint;
    try {
      const state = await saveCalibrationLifecycleState(cfg, lifecycle.state, {
        action: 'rollback',
        targetFingerprint: lifecycle.previous.fingerprint,
        reason: postPromotion.reason,
        metadata: { failedFingerprint, sample: postPromotion.sample, appVersion: APP_VERSION },
      });
      await recordOpsEvent(cfg, { severity: 'warning', source: 'model', eventType: 'calibration_rollback', code: 'CALIBRATION_AUTO_ROLLBACK', message: postPromotion.reason, meta: { failedFingerprint, restoredFingerprint: lifecycle.previous.fingerprint, sample: postPromotion.sample } });
      await notifyCalibrationAdmins(cfg, 'rollback', `${failedFingerprint.slice(0, 12)} → ${lifecycle.previous.fingerprint.slice(0, 12)}. ${postPromotion.reason}`);
      lifecycle = { state, active: lifecycle.previous, previous: null };
    } catch (error) {
      if (!isCalibrationRevisionConflict(error)) throw error;
      lifecycle = await loadCalibrationLifecycleState(cfg);
    }
  }

  let comparison = null;
  let promoted = false;
  if (eligible && fingerprint !== lifecycle.active.fingerprint && !lifecycle.state?.frozen) {
    comparison = compareCalibrationProfiles(trustedRows, lifecycle.active, candidate);
    if (comparison.pass) {
      const previousFingerprint = lifecycle.active.fingerprint;
      try {
        const state = await saveCalibrationLifecycleState(cfg, lifecycle.state, {
          action: 'promote',
          targetFingerprint: fingerprint,
          reason: comparison.reason,
          metadata: { previousFingerprint, appVersion: APP_VERSION },
        });
        await recordOpsEvent(cfg, { severity: 'info', source: 'model', eventType: 'calibration_promotion', code: 'CALIBRATION_PROMOTED', message: comparison.reason, meta: { fingerprint, previousFingerprint } });
        await notifyCalibrationAdmins(cfg, 'promote', `${previousFingerprint.slice(0, 12)} → ${fingerprint.slice(0, 12)}. ${comparison.reason}`);
        lifecycle = { state, active: candidate, previous: lifecycle.active };
        promoted = true;
      } catch (error) {
        if (!isCalibrationRevisionConflict(error)) throw error;
        lifecycle = await loadCalibrationLifecycleState(cfg);
      }
    }
  }

  const production = lifecycle.active || baselineCalibrationProfile(candidate.sample, candidate.signalStats || []);
  return {
    ...production,
    fingerprint: production.fingerprint,
    lifecycle: {
      available: true,
      status: lifecycle.state?.frozen ? 'frozen' : promoted ? 'promoted' : production.fingerprint === fingerprint ? 'active' : eligible ? 'held' : 'shadow',
      activeFingerprint: production.fingerprint,
      previousFingerprint: lifecycle.previous?.fingerprint || null,
      challengerFingerprint: fingerprint,
      revision: Number(lifecycle.state?.revision || 0),
      frozen: Boolean(lifecycle.state?.frozen),
      freezeReason: lifecycle.state?.freeze_reason || '',
      frozenAt: lifecycle.state?.frozen_at || null,
      lastTransition: lifecycle.state?.last_transition || '',
      comparison,
      postPromotion,
      candidate: {
        mode: candidate.mode,
        sample: candidate.sample,
        promotionGate: candidate.promotionGate,
        validationWindows: candidate.weightsValidation?.validationWindows || candidate.temperatureValidation?.validationWindows || [],
      },
    },
  };
}

function publicCalibrationControlState(lifecycle, transitions = []) {
  const state = lifecycle?.state || {};
  return {
    available: Boolean(state?.id),
    activeFingerprint: lifecycle?.active?.fingerprint || state.active_fingerprint || null,
    previousFingerprint: lifecycle?.previous?.fingerprint || state.previous_fingerprint || null,
    revision: Number(state.revision || 0),
    frozen: Boolean(state.frozen),
    freezeReason: state.freeze_reason || '',
    frozenAt: state.frozen_at || null,
    lastTransition: state.last_transition || '',
    lastTransitionReason: state.last_transition_reason || '',
    updatedAt: state.updated_at || null,
    transitions: (transitions || []).map(row => ({
      id: Number(row.id || 0),
      action: row.action || '',
      fromActiveFingerprint: row.from_active_fingerprint || null,
      toActiveFingerprint: row.to_active_fingerprint || null,
      fromPreviousFingerprint: row.from_previous_fingerprint || null,
      toPreviousFingerprint: row.to_previous_fingerprint || null,
      expectedRevision: Number(row.expected_revision || 0),
      resultingRevision: Number(row.resulting_revision || 0),
      reason: row.reason || '',
      createdAt: row.created_at || null,
    })),
  };
}

async function apiCalibrationControl(request, cfg, user) {
  const schema = await probeCalibrationLifecycleSchema(cfg);
  if (!schema.ok) return json({ available: false, reason: 'Нужна supabase_migration_v6_10.sql.' }, 503);

  let lifecycle = await loadCalibrationLifecycleState(cfg);
  if (request.method === 'GET') {
    const transitions = await supaSelectMany(cfg, 'model_calibration_transitions', {}, { limit: 20, order: 'created_at.desc' });
    return json(publicCalibrationControlState(lifecycle, transitions));
  }
  if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);

  let body = {};
  try { body = await request.json(); } catch {}
  const action = String(body.action || '').trim().toLowerCase();
  if (!['freeze','unfreeze','manual_rollback'].includes(action)) {
    return json({ error: 'Действие должно быть freeze, unfreeze или manual_rollback.' }, 400);
  }
  const reason = String(body.reason || '').trim();
  if (reason.length < 5) return json({ error: 'Укажите причину действия — минимум 5 символов.' }, 400);
  if (action === 'manual_rollback' && !lifecycle.previous?.fingerprint) {
    return json({ error: 'Предыдущий champion отсутствует; ручной rollback невозможен.' }, 409);
  }

  try {
    await saveCalibrationLifecycleState(cfg, lifecycle.state, {
      action,
      targetFingerprint: action === 'manual_rollback' ? lifecycle.previous.fingerprint : null,
      reason,
      actorTelegramId: user.id,
      metadata: { source: 'admin_ui', appVersion: APP_VERSION },
    });
  } catch (error) {
    if (isCalibrationRevisionConflict(error)) {
      return json({ error: 'Состояние уже изменилось другим процессом. Обновите данные и повторите действие.', code: 'CALIBRATION_REVISION_CONFLICT' }, 409);
    }
    throw error;
  }

  await recordOpsEvent(cfg, {
    severity: action === 'manual_rollback' ? 'warning' : 'info',
    source: 'model',
    eventType: `calibration_${action}`,
    code: `CALIBRATION_${action.toUpperCase()}`,
    message: reason,
    meta: { revision: Number(lifecycle.state?.revision || 0), actorTelegramId: Number(user.id) },
  });
  await notifyCalibrationAdmins(cfg, action, reason);

  lifecycle = await loadCalibrationLifecycleState(cfg);
  const transitions = await supaSelectMany(cfg, 'model_calibration_transitions', {}, { limit: 20, order: 'created_at.desc' });
  return json({ ok: true, ...publicCalibrationControlState(lifecycle, transitions) });
}

function baselineCalibrationProfile(sample = 0, stats = []) {
  return {
    version: CALIBRATION_PROFILE_VERSION,
    generatedAt: new Date().toISOString(),
    mode: sample >= 20 ? 'shadow' : 'baseline',
    sample,
    temperature: 1,
    temperatureActive: false,
    weightsActive: false,
    signalWeights: { ...MODEL_BASE_WEIGHTS },
    signalStats: (stats || []).map(x => ({ ...x, currentWeight: MODEL_BASE_WEIGHTS[x.name] || 0 })),
    temperatureValidation: { sample, trainSample: 0, validationSample: 0, baselineLogLoss: null, calibratedLogLoss: null, improvement: null },
    weightsValidation: {
      active: false,
      weights: { ...MODEL_BASE_WEIGHTS },
      candidateWeights: { ...MODEL_BASE_WEIGHTS },
      sample,
      trainSample: 0,
      validationSample: 0,
      baselineBrier: null,
      candidateBrier: null,
      baselineLogLoss: null,
      candidateLogLoss: null,
      brierGain: null,
      logLossGain: null,
      changedWeightL1: 0,
      reason: 'Недостаточно trusted-матчей для отдельной holdout-проверки весов.',
    },
    promotionGate: {
      status: sample >= 20 ? 'shadow' : 'baseline',
      validationReady: false,
      trustedSample: sample,
      note: sample >= 20 ? 'Кандидат калибровки собирает доказательства в тени.' : 'Сначала нужно накопить trusted settlement.',
    },
    note: sample >= 20 ? 'Калибратор собирает выборку в теневом режиме. Итоговые вероятности пока не меняются.' : 'Сначала нужно накопить завершённые предматчевые прогнозы.',
  };
}

function buildCalibrationProfile(rows) {
  const valid = verifiedSettledRows(rows);
  const signalStats = signalCalibrationStats(valid);
  const temperature = fitTemperatureCalibration(valid);
  const weights = fitAdaptiveSignalWeightsHoldout(valid);
  const active = Boolean(temperature.active || weights.active);
  const validationReady = Number(weights.validationSample || 0) >= 40 || Number(temperature.validationSample || 0) >= 40;
  const shadow = !active && (valid.length >= 20 || validationReady || signalStats.some(x => x.sample >= 10));
  const promotionStatus = active ? 'promoted' : validationReady ? 'held' : shadow ? 'shadow' : 'baseline';
  return {
    version: CALIBRATION_PROFILE_VERSION,
    generatedAt: new Date().toISOString(),
    mode: active ? 'active' : shadow ? 'shadow' : 'baseline',
    sample: valid.length,
    temperature: temperature.active ? temperature.temperature : 1,
    temperatureActive: Boolean(temperature.active),
    weightsActive: Boolean(weights.active),
    signalWeights: weights.active ? weights.weights : { ...MODEL_BASE_WEIGHTS },
    signalStats: (weights.stats || signalStats).map(x => ({
      ...x,
      currentWeight: Number((weights.active ? weights.weights : MODEL_BASE_WEIGHTS)[x.name] ?? MODEL_BASE_WEIGHTS[x.name] ?? 0),
    })),
    temperatureValidation: temperature,
    weightsValidation: weights,
    promotionGate: {
      status: promotionStatus,
      validationReady,
      trustedSample: valid.length,
      weightHoldoutSample: Number(weights.validationSample || 0),
      temperatureHoldoutSample: Number(temperature.validationSample || 0),
      note: active
        ? 'Автокалибровка прошла два последовательных trusted holdout-окна и готова к champion–challenger сравнению.'
        : validationReady
          ? 'Кандидат удержан в тени: holdout ещё не подтвердил безопасное улучшение.'
          : 'Кандидат остаётся в тени до достаточной trusted holdout-выборки.',
    },
    note: active
      ? 'RC19: кандидат прошёл два holdout-окна; постоянный lifecycle решает продвижение относительно активного champion.'
      : shadow
        ? 'RC19: challenger измеряется в тени; production использует только постоянный active-профиль.'
        : 'Недостаточно trusted-прогнозов для безопасной автоматической калибровки.',
  };
}

async function getCalibrationProfile(cfg, { force = false } = {}) {
  if (!force) {
    try {
      const cached = await getCache(CALIBRATION_CACHE_KEY, cfg);
      if (cached?.version === CALIBRATION_PROFILE_VERSION) return cached;
    } catch {}
  }

  let rows = [];
  if (hasSupabase(cfg)) {
    try {
      const since = new Date(Date.now() - 365 * 86400_000).toISOString();
      rows = await supaSelectMany(cfg, 'model_predictions', { status: 'eq.settled', kickoff_at: `gte.${since}` }, { limit: 500, order: 'kickoff_at.desc' });
    } catch (error) {
      return baselineCalibrationProfile(0, []);
    }
  } else {
    rows = [...memory.modelPredictions.values()].filter(x => x.status === 'settled');
  }
  const candidate = buildCalibrationProfile(rows);
  try { await persistCalibrationPromotionValidation(cfg, candidate); } catch (error) {
    console.warn('calibration promotion audit skipped', error?.message || error);
  }
  const profile = hasSupabase(cfg)
    ? await resolveCalibrationLifecycle(cfg, candidate, verifiedSettledRows(rows)).catch(async error => {
        console.warn('calibration lifecycle fallback', error?.message || error);
        const baseline = baselineCalibrationProfile(candidate.sample, candidate.signalStats || []);
        baseline.fingerprint = await calibrationPromotionFingerprint(baseline);
        return { ...baseline, lifecycle: { available: false, status: 'fallback', activeFingerprint: baseline.fingerprint, challengerFingerprint: candidate.fingerprint || null, reason: 'Lifecycle persistence failed; production remains on baseline.' } };
      })
    : { ...candidate, fingerprint: await calibrationPromotionFingerprint(candidate), lifecycle: { available: false, status: 'memory' } };
  try { await setCache(CALIBRATION_CACHE_KEY, 0, profile, cfg, CALIBRATION_CACHE_MINUTES); } catch {}
  return profile;
}

async function captureModelPrediction(payload, cfg) {
  const match = payload?.match;
  const probabilities = payload?.probabilities;
  const fixtureId = Number(match?.fixtureId || 0);
  const kickoffMs = Date.parse(match?.date || '');
  const status = String(match?.status || '').toUpperCase();
  if (!fixtureId || !probabilities || !Number.isFinite(kickoffMs)) return false;
  if (!['NS', 'TBD'].includes(status)) return false;
  // Backtest only genuine pre-match snapshots, never a prediction captured after kickoff.
  if (kickoffMs <= Date.now() + 120_000) return false;
  const predictedOutcome = predictionOutcomeKey(probabilities);
  if (!predictedOutcome) return false;

  const row = {
    fixture_id: fixtureId,
    analysis_version: String(payload.analysisVersion || '3.7.0-model-calibration'),
    captured_at: new Date().toISOString(),
    kickoff_at: new Date(kickoffMs).toISOString(),
    league_id: Number(match.leagueId || 0) || null,
    league_name: String(match.league || ''),
    home_id: Number(match.home?.id || 0) || null,
    away_id: Number(match.away?.id || 0) || null,
    home_name: String(match.home?.name || ''),
    away_name: String(match.away?.name || ''),
    home_prob: Number(probabilities.home),
    draw_prob: Number(probabilities.draw),
    away_prob: Number(probabilities.away),
    predicted_outcome: predictedOutcome,
    confidence_score: Number(payload.confidence?.score || 0) || null,
    signal_names: (payload.modelBreakdown?.signals || []).map(x => String(x?.name || '')).filter(Boolean),
    signal_weights: payload.modelBreakdown?.weights || {},
    signal_probabilities: signalProbabilitySnapshot(payload.modelBreakdown?.signals || []),
    raw_home_prob: Number.isFinite(Number(payload.rawProbabilities?.home)) ? Number(payload.rawProbabilities.home) : Number(probabilities.home),
    raw_draw_prob: Number.isFinite(Number(payload.rawProbabilities?.draw)) ? Number(payload.rawProbabilities.draw) : Number(probabilities.draw),
    raw_away_prob: Number.isFinite(Number(payload.rawProbabilities?.away)) ? Number(payload.rawProbabilities.away) : Number(probabilities.away),
    calibration_mode: String(payload.modelCalibration?.mode || 'baseline'),
    calibration_profile_fingerprint: String(payload.modelCalibration?.fingerprint || ''),
    calibration_temperature: Number(payload.modelCalibration?.temperature || 1),
    calibration_sample: Number(payload.modelCalibration?.sample || 0),
    calibration_weights: payload.modelCalibration?.signalWeights || {},
    data_mode: String(payload.dataPolicy?.mode || ''),
    completeness_score: Number(payload.completeness?.score || 0),
    completeness_max: Number(payload.completeness?.max || 0),
    home_expected_goals: Number.isFinite(Number(payload.goalModel?.homeExpected)) ? Number(payload.goalModel.homeExpected) : null,
    away_expected_goals: Number.isFinite(Number(payload.goalModel?.awayExpected)) ? Number(payload.goalModel.awayExpected) : null,
    over25_prob: Number.isFinite(Number(payload.goalModel?.over25)) ? Number(payload.goalModel.over25) : null,
    btts_prob: Number.isFinite(Number(payload.goalModel?.btts)) ? Number(payload.goalModel.btts) : null,
    status: 'pending',
  };

  if (hasSupabase(cfg)) {
    try {
      // fixture_id is the primary key: the FIRST pre-match snapshot stays immutable.
      await supaInsertIgnore(cfg, 'model_predictions', row, 'fixture_id');
      return true;
    } catch (error) {
      // Keep v3.6 installations functional until the optional v3.7 ALTER migration is applied.
      try {
        const legacyRow = { ...row };
        for (const key of ['signal_probabilities','raw_home_prob','raw_draw_prob','raw_away_prob','calibration_mode','calibration_profile_fingerprint','calibration_temperature','calibration_sample','calibration_weights']) delete legacyRow[key];
        await supaInsertIgnore(cfg, 'model_predictions', legacyRow, 'fixture_id');
        console.warn('v3.7 calibration columns are not available yet; prediction stored in legacy format');
        return true;
      } catch (legacyError) {
        console.warn('model prediction capture skipped', legacyError?.message || error?.message || error);
        return false;
      }
    }
  }
  if (!memory.modelPredictions.has(fixtureId)) memory.modelPredictions.set(fixtureId, row);
  return true;
}

async function settlePredictionsFromFixtures(fixtures, cfg) {
  const finished = (fixtures || []).filter(f => isFinishedStatus(fixtureStatusShort(f)) && fixtureIdentity(f));
  if (!finished.length) return { checked: 0, settled: 0 };
  const ids = [...new Set(finished.map(fixtureIdentity).filter(Boolean))];
  let rows = [];
  if (hasSupabase(cfg)) {
    try {
      rows = await supaSelectMany(cfg, 'model_predictions', {
        status: 'eq.pending',
        fixture_id: `in.(${ids.join(',')})`,
      }, { limit: Math.min(500, ids.length + 10) });
    } catch (error) {
      console.warn('model prediction settle read skipped', error?.message || error);
      return { checked: 0, settled: 0 };
    }
  } else {
    rows = ids.map(id => memory.modelPredictions.get(Number(id))).filter(x => x?.status === 'pending');
  }
  if (!rows.length) return { checked: 0, settled: 0 };

  const fixtureMap = new Map(finished.map(f => [fixtureIdentity(f), f]));
  let settled = 0;
  for (const row of rows) {
    const fixture = fixtureMap.get(Number(row.fixture_id));
    const score = regulationScore(fixture);
    if (!score) continue;
    const actualOutcome = actualOutcomeFromGoals(score.home, score.away);
    if (!actualOutcome) continue;
    const totalGoals = score.home + score.away;
    const bttsActual = score.home > 0 && score.away > 0;
    const over25Actual = totalGoals >= 3;
    const patch = {
      status: 'settled',
      settled_at: new Date().toISOString(),
      actual_home_goals: score.home,
      actual_away_goals: score.away,
      actual_outcome: actualOutcome,
      correct: String(row.predicted_outcome || '') === actualOutcome,
      brier_score: scoreBrier(row, actualOutcome),
      over25_actual: over25Actual,
      over25_correct: row.over25_prob === null || row.over25_prob === undefined ? null : (Number(row.over25_prob) >= 50) === over25Actual,
      btts_actual: bttsActual,
      btts_correct: row.btts_prob === null || row.btts_prob === undefined ? null : (Number(row.btts_prob) >= 50) === bttsActual,
      settlement_verification_state: 'unverified',
      settlement_verified_at: null,
      settlement_verified_status: fixtureStatusShort(fixture),
    };
    if (hasSupabase(cfg)) {
      try {
        await supaPatch(cfg, 'model_predictions', { fixture_id: `eq.${Number(row.fixture_id)}`, status: 'eq.pending' }, patch);
        settled++;
      } catch (error) {
        console.warn('model prediction settle patch skipped', error?.message || error);
      }
    } else {
      memory.modelPredictions.set(Number(row.fixture_id), { ...row, ...patch });
      settled++;
    }
  }
  return { checked: rows.length, settled };
}

function average(values) {
  const rows = (values || []).map(Number).filter(Number.isFinite);
  return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null;
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

function qualityBucket(rows, label) {
  const valid = (rows || []).filter(x => typeof x.correct === 'boolean');
  return {
    label,
    sample: valid.length,
    accuracy: pct(valid.filter(x => x.correct).length, valid.length),
    avgBrier: valid.length ? Math.round((average(valid.map(verifiedBrierScore).filter(Number.isFinite)) || 0) * 1000) / 1000 : null,
  };
}


function dashboardRound(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

function dashboardLogLoss(row) {
  const key = String(row?.actual_outcome || '');
  if (!['home','draw','away'].includes(key)) return null;
  const p = Math.max(0.01, Math.min(0.99, Number(row?.[`${key}_prob`] || 0) / 100));
  return -Math.log(p);
}

function dashboardCompletenessPercent(row) {
  const score = Number(row?.completeness_score || 0);
  const max = Number(row?.completeness_max || 0);
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
  return clamp(score / max * 100, 0, 100);
}

function dashboardBucket(rows, label, extra = {}) {
  const valid = (rows || []).filter(row => ['home','draw','away'].includes(String(row?.actual_outcome || '')));
  const hitCount = valid.filter(row => row.correct === true).length;
  const top = average(valid.map(topProbabilityValue));
  const acc = pct(hitCount, valid.length);
  const brier = average(valid.map(verifiedBrierScore).filter(Number.isFinite));
  const logLoss = average(valid.map(dashboardLogLoss).filter(Number.isFinite));
  const confidence = average(valid.map(row => Number(row?.confidence_score)).filter(Number.isFinite));
  const completeness = average(valid.map(dashboardCompletenessPercent).filter(Number.isFinite));
  return {
    label,
    sample: valid.length,
    accuracy: acc,
    avgBrier: dashboardRound(brier),
    avgLogLoss: dashboardRound(logLoss),
    avgTopProbability: dashboardRound(top, 1),
    calibrationGap: Number.isFinite(Number(top)) && Number.isFinite(Number(acc)) ? dashboardRound(Number(top) - Number(acc), 1) : null,
    avgConfidence: dashboardRound(confidence, 1),
    avgCompleteness: dashboardRound(completeness, 1),
    ...extra,
  };
}

function dashboardWeekKey(value) {
  const d = new Date(value || 0);
  if (!Number.isFinite(d.getTime())) return '';
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}

function dashboardWeekLabel(key) {
  const d = new Date(`${key}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return key;
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}

function buildWeeklyDashboard(rows, limit = 10) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = dashboardWeekKey(row?.kickoff_at);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .sort((a,b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([key, group]) => dashboardBucket(group, dashboardWeekLabel(key), { key }));
}

function buildLeagueDashboard(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const id = Number(row?.league_id || 0);
    const name = String(row?.league_name || '').trim() || 'Неизвестный турнир';
    const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { id: id || null, name, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()]
    .map(group => dashboardBucket(group.rows, group.name, { leagueId: group.id, leagueName: group.name }))
    .sort((a,b) => Number(b.sample || 0) - Number(a.sample || 0) || String(a.leagueName).localeCompare(String(b.leagueName)))
    .slice(0, 12);
}

function buildConfidenceDashboard(rows) {
  const defs = [
    ['<50', -Infinity, 50],
    ['50–59', 50, 60],
    ['60–69', 60, 70],
    ['70–79', 70, 80],
    ['80+', 80, Infinity],
  ];
  return defs.map(([label,min,max]) => dashboardBucket(
    (rows || []).filter(row => {
      const v = Number(row?.confidence_score);
      return Number.isFinite(v) && v >= min && v < max;
    }),
    label
  ));
}

function buildCompletenessDashboard(rows) {
  const defs = [
    ['<60%', -Infinity, 60],
    ['60–79%', 60, 80],
    ['80%+', 80, Infinity],
  ];
  return defs.map(([label,min,max]) => dashboardBucket(
    (rows || []).filter(row => {
      const v = dashboardCompletenessPercent(row);
      return Number.isFinite(v) && v >= min && v < max;
    }),
    label
  ));
}

function buildCalibrationModeDashboard(rows) {
  const defs = [
    ['baseline', 'База'],
    ['shadow', 'Тень'],
    ['active', 'Активен'],
  ];
  return defs.map(([mode,label]) => dashboardBucket(
    (rows || []).filter(row => String(row?.calibration_mode || 'baseline') === mode),
    label,
    { mode }
  )).filter(x => x.sample > 0);
}

function buildSignalDashboard(rows) {
  const names = Object.keys(MODEL_BASE_WEIGHTS);
  return names.map(name => {
    const subset = [];
    const signalBriers = [];
    const signalLosses = [];
    let signalHits = 0;
    for (const row of rows || []) {
      if (!['home','draw','away'].includes(String(row?.actual_outcome || ''))) continue;
      const signalMap = parseJsonObject(row?.signal_probabilities);
      const probabilities = signalMap?.[name];
      if (!validThreeProbabilities(probabilities)) continue;
      subset.push(row);
      const sb = brierFromProbabilities(probabilities, row.actual_outcome);
      const sl = logLossFromProbabilities(probabilities, row.actual_outcome);
      if (Number.isFinite(sb)) signalBriers.push(sb);
      if (Number.isFinite(sl)) signalLosses.push(sl);
      if (predictedOutcomeForProbabilities(probabilities) === row.actual_outcome) signalHits++;
    }
    const finalBrier = average(subset.map(verifiedBrierScore).filter(Number.isFinite));
    const finalAccuracy = pct(subset.filter(row => row.correct === true).length, subset.length);
    const signalBrier = average(signalBriers);
    const signalAccuracy = pct(signalHits, subset.length);
    return {
      name,
      label: signalDisplayName(name),
      sample: subset.length,
      signalAccuracy,
      finalAccuracy,
      signalBrier: dashboardRound(signalBrier),
      finalBrier: dashboardRound(finalBrier),
      brierDeltaVsBlend: Number.isFinite(Number(signalBrier)) && Number.isFinite(Number(finalBrier))
        ? dashboardRound(Number(signalBrier) - Number(finalBrier))
        : null,
      signalLogLoss: dashboardRound(average(signalLosses)),
      baseWeight: dashboardRound(Number(MODEL_BASE_WEIGHTS[name] || 0) * 100, 1),
    };
  });
}

function buildOutcomeDashboard(rows) {
  return ['home','draw','away'].map(key => dashboardBucket(
    (rows || []).filter(row => String(row?.predicted_outcome || '') === key),
    key === 'home' ? 'П1' : key === 'draw' ? 'X' : 'П2',
    { key }
  ));
}

function buildModelDashboardObservations(rows, dashboard) {
  const notes = [];
  const overall = dashboard?.overview || {};
  const sample = Number(overall.sample || 0);

  if (sample < 30) {
    notes.push({
      level: 'info',
      title: 'Выборка ещё небольшая',
      text: `В периоде ${sample} завершённых прогнозов. Разрезы по лигам и confidence пока нужно читать как диагностику, а не как устойчивые закономерности.`,
    });
  }

  if (sample >= 20 && Number.isFinite(Number(overall.calibrationGap)) && Number(overall.calibrationGap) >= 8) {
    notes.push({
      level: 'warn',
      title: 'Модель выглядит переуверенной',
      text: `Средняя top-вероятность выше фактической точности примерно на ${Number(overall.calibrationGap).toFixed(1)} п.п. Калибровку стоит продолжать проверять на новых матчах.`,
    });
  }

  const high = (dashboard?.confidence || []).find(x => x.label === '80+');
  const mid = (dashboard?.confidence || []).find(x => x.label === '60–69');
  if (Number(high?.sample || 0) >= 12 && Number(mid?.sample || 0) >= 12 &&
      Number.isFinite(Number(high?.accuracy)) && Number.isFinite(Number(mid?.accuracy)) &&
      Number(high.accuracy) <= Number(mid.accuracy)) {
    notes.push({
      level: 'warn',
      title: 'Высокий confidence пока не даёт прироста',
      text: `В диапазоне 80+ точность ${Number(high.accuracy).toFixed(1)}%, а в 60–69 — ${Number(mid.accuracy).toFixed(1)}%. Это повод проверить причины, но не менять пороги автоматически.`,
    });
  }

  const weakLeague = (dashboard?.leagues || []).find(x =>
    Number(x.sample || 0) >= 10 &&
    Number.isFinite(Number(x.avgBrier)) &&
    Number.isFinite(Number(overall.avgBrier)) &&
    Number(x.avgBrier) >= Number(overall.avgBrier) + 0.035
  );
  if (weakLeague) {
    notes.push({
      level: 'watch',
      title: 'Есть лига для дополнительной проверки',
      text: `${weakLeague.leagueName}: n=${weakLeague.sample}, Brier ${Number(weakLeague.avgBrier).toFixed(3)} против общего ${Number(overall.avgBrier).toFixed(3)}. Возможна специфика турнира или просто шум выборки.`,
    });
  }

  const weakSignal = (dashboard?.signals || []).find(x =>
    Number(x.sample || 0) >= 30 &&
    Number.isFinite(Number(x.brierDeltaVsBlend)) &&
    Number(x.brierDeltaVsBlend) >= 0.025
  );
  if (weakSignal) {
    notes.push({
      level: 'watch',
      title: 'Один источник слабее итогового blend',
      text: `${weakSignal.label}: собственный Brier ${Number(weakSignal.signalBrier).toFixed(3)}, blend на тех же матчах ${Number(weakSignal.finalBrier).toFixed(3)}. Текущий вес уже ограничен guardrails.`,
    });
  }

  const latest = (dashboard?.trend || []).slice(-3);
  if (latest.length >= 3 && latest.every(x => Number(x.sample || 0) >= 4)) {
    const first = Number(latest[0]?.avgBrier);
    const last = Number(latest[latest.length - 1]?.avgBrier);
    if (Number.isFinite(first) && Number.isFinite(last) && last <= first - 0.025) {
      notes.push({
        level: 'good',
        title: 'Последние недели выглядят лучше по Brier',
        text: `Brier снизился примерно с ${first.toFixed(3)} до ${last.toFixed(3)}. Нужна более длинная серия, чтобы считать это устойчивым улучшением.`,
      });
    }
  }

  if (!notes.length) {
    notes.push({
      level: 'info',
      title: 'Явных диагностических отклонений нет',
      text: 'Продолжаем накапливать immutable pre-match snapshots. v6.2 добавляет settlement watchdog и runtime-gated catch-up, не меняя веса модели автоматически.',
    });
  }

  return notes.slice(0, 5);
}


function modelVersionName(row) {
  const version = String(row?.analysis_version || '').trim();
  return version || 'legacy / unknown';
}

function weightedTopCalibrationError(rows) {
  const defs = [
    [0, 45], [45, 55], [55, 65], [65, 75], [75, 101],
  ];
  const valid = (rows || []).filter(modelQualityEligibleRow);
  if (!valid.length) return null;

  let weighted = 0;
  let used = 0;
  for (const [min, max] of defs) {
    const group = valid.filter(row => {
      const top = topProbabilityValue(row);
      return Number.isFinite(Number(top)) && top >= min && top < max;
    });
    if (!group.length) continue;
    const predicted = average(group.map(topProbabilityValue));
    const actual = pct(group.filter(row => row.correct === true).length, group.length);
    if (!Number.isFinite(Number(predicted)) || !Number.isFinite(Number(actual))) continue;
    weighted += Math.abs(Number(predicted) - Number(actual)) * group.length;
    used += group.length;
  }
  return used ? dashboardRound(weighted / used, 1) : null;
}

function buildModelVersionCohorts(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const version = modelVersionName(row);
    if (!groups.has(version)) groups.set(version, []);
    groups.get(version).push(row);
  }

  return [...groups.entries()].map(([version, cohortRows]) => {
    const bucket = dashboardBucket(cohortRows, version, { version });
    const kickoffTimes = cohortRows.map(row => Date.parse(row?.kickoff_at || '')).filter(Number.isFinite);
    const signalReady = cohortRows.filter(row => {
      const signalMap = parseJsonObject(row?.signal_probabilities);
      return signalMap && Object.keys(signalMap).length > 0;
    }).length;
    return {
      ...bucket,
      calibrationError: weightedTopCalibrationError(cohortRows),
      signalSnapshotCoverage: pct(signalReady, cohortRows.length),
      firstKickoffAt: kickoffTimes.length ? new Date(Math.min(...kickoffTimes)).toISOString() : null,
      lastKickoffAt: kickoffTimes.length ? new Date(Math.max(...kickoffTimes)).toISOString() : null,
    };
  }).sort((a, b) =>
    Date.parse(b.lastKickoffAt || 0) - Date.parse(a.lastKickoffAt || 0) ||
    Number(b.sample || 0) - Number(a.sample || 0)
  );
}

function predictionProbabilityIntegrity(row) {
  const raw = ['home_prob','draw_prob','away_prob'].map(key => row?.[key]);
  const present = raw.every(value => value !== null && value !== undefined && value !== '');
  const values = raw.map(Number);
  const finite = present && values.every(Number.isFinite);
  const bounded = finite && values.every(value => value >= 0 && value <= 100);
  const sum = finite ? values.reduce((a, b) => a + b, 0) : null;
  const sumOk = Number.isFinite(sum) && Math.abs(sum - 100) <= 1.5;
  return { present, finite, bounded, sum, sumOk, valid: present && finite && bounded && sumOk };
}

function predictionSnapshotTiming(row) {
  // model_predictions uses captured_at. created_at is accepted only as a
  // compatibility fallback for old/manual snapshots.
  const capturedRaw = row?.captured_at ?? row?.created_at;
  const kickoffRaw = row?.kickoff_at;
  const capturedAt = capturedRaw === null || capturedRaw === undefined || capturedRaw === '' ? NaN : Date.parse(capturedRaw);
  const kickoffAt = kickoffRaw === null || kickoffRaw === undefined || kickoffRaw === '' ? NaN : Date.parse(kickoffRaw);
  const valid = Number.isFinite(capturedAt) && Number.isFinite(kickoffAt);
  return { capturedAt, kickoffAt, valid, late: valid && capturedAt >= kickoffAt };
}

function settledOutcomeIntegrity(row) {
  const outcome = String(row?.actual_outcome || '');
  const homeRaw = row?.actual_home_goals;
  const awayRaw = row?.actual_away_goals;
  const home = Number(homeRaw);
  const away = Number(awayRaw);
  const scoreValid = homeRaw !== null && homeRaw !== undefined && homeRaw !== '' &&
    awayRaw !== null && awayRaw !== undefined && awayRaw !== '' &&
    Number.isInteger(home) && Number.isInteger(away) && home >= 0 && away >= 0;
  const outcomeValid = ['home','draw','away'].includes(outcome);
  const expectedOutcome = scoreValid ? actualOutcomeFromGoals(home, away) : '';
  return {
    scoreValid,
    outcomeValid,
    expectedOutcome,
    valid: scoreValid && outcomeValid && expectedOutcome === outcome,
  };
}

function predictionConsistency(row, { settled = false } = {}) {
  const probabilityCheck = predictionProbabilityIntegrity(row);
  if (!probabilityCheck.valid) return { testable: false, valid: false, predictedValid: false, topMatches: false, correctMatches: false };
  const predicted = String(row?.predicted_outcome || '');
  const predictedValid = ['home','draw','away'].includes(predicted);
  const expectedPredicted = predictionOutcomeKey({
    home: Number(row.home_prob),
    draw: Number(row.draw_prob),
    away: Number(row.away_prob),
  });
  const topMatches = predictedValid && predicted === expectedPredicted;
  let correctMatches = true;
  if (settled) {
    const actual = String(row?.actual_outcome || '');
    correctMatches = typeof row?.correct === 'boolean' &&
      ['home','draw','away'].includes(actual) &&
      row.correct === (predicted === actual);
  }
  return { testable: true, predictedValid, topMatches, correctMatches, valid: predictedValid && topMatches && correctMatches };
}

function trustedSettlementForMetrics(row) {
  const state = String(row?.settlement_verification_state || 'unverified');
  return row?.status === 'settled' && ['confirmed', 'adjudicated'].includes(state);
}

function trustedMetricsGateSelfTest() {
  const base = { status: 'settled' };
  return {
    pass:
      trustedSettlementForMetrics({ ...base, settlement_verification_state: 'confirmed' }) &&
      trustedSettlementForMetrics({ ...base, settlement_verification_state: 'adjudicated' }) &&
      !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'verified' }) &&
      !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'unverified' }) &&
      !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'drift' }) &&
      !trustedSettlementForMetrics({ status: 'void', settlement_verification_state: 'adjudicated' }),
    confirmed: trustedSettlementForMetrics({ ...base, settlement_verification_state: 'confirmed' }),
    adjudicated: trustedSettlementForMetrics({ ...base, settlement_verification_state: 'adjudicated' }),
    verifiedBlocked: !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'verified' }),
    unverifiedBlocked: !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'unverified' }),
    driftBlocked: !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'drift' }),
    voidBlocked: !trustedSettlementForMetrics({ status: 'void', settlement_verification_state: 'adjudicated' }),
  };
}

function modelQualityEligibleRow(row) {
  const timing = predictionSnapshotTiming(row);
  return trustedSettlementForMetrics(row) &&
    predictionProbabilityIntegrity(row).valid &&
    timing.valid && !timing.late &&
    settledOutcomeIntegrity(row).valid &&
    predictionConsistency(row, { settled: true }).valid;
}

function verifiedSettledRows(settledRows, pendingRows = []) {
  const settled = Array.isArray(settledRows) ? settledRows : [];
  const all = [...settled, ...(Array.isArray(pendingRows) ? pendingRows : [])];
  const fixtureCounts = new Map();
  for (const row of all) {
    const id = Number(row?.fixture_id || 0);
    if (Number.isInteger(id) && id > 0) fixtureCounts.set(id, Number(fixtureCounts.get(id) || 0) + 1);
  }
  return settled.filter(row => {
    const id = Number(row?.fixture_id || 0);
    return Number.isInteger(id) && id > 0 && fixtureCounts.get(id) === 1 && modelQualityEligibleRow(row);
  });
}

function verifiedBrierScore(row) {
  if (!predictionProbabilityIntegrity(row).valid || !settledOutcomeIntegrity(row).valid) return null;
  return brierFromProbabilities({
    home: Number(row.home_prob),
    draw: Number(row.draw_prob),
    away: Number(row.away_prob),
  }, String(row.actual_outcome));
}

function buildPredictionIntegrity(settledRows, pendingRows) {
  const settled = Array.isArray(settledRows) ? settledRows : [];
  const pending = Array.isArray(pendingRows) ? pendingRows : [];
  const all = [...settled, ...pending];
  const now = Date.now();

  const invalidProbabilities = all.filter(row => !predictionProbabilityIntegrity(row).valid);
  const invalidSnapshotMetadata = all.filter(row => !predictionSnapshotTiming(row).valid);
  const snapshotAfterKickoff = all.filter(row => predictionSnapshotTiming(row).late);
  const stalePending = pending.filter(row => {
    const timing = predictionSnapshotTiming(row);
    return Number.isFinite(timing.kickoffAt) && timing.kickoffAt < now - 36 * 3600_000;
  });
  const missingVersion = all.filter(row => !String(row?.analysis_version || '').trim());
  const missingSignals = all.filter(row => {
    const signalMap = parseJsonObject(row?.signal_probabilities);
    return !signalMap || !Object.keys(signalMap).length;
  });
  const invalidSettledOutcome = settled.filter(row => !settledOutcomeIntegrity(row).valid);
  const inconsistentPrediction = all.filter(row => {
    if (!predictionProbabilityIntegrity(row).valid) return false;
    const check = predictionConsistency(row, { settled: false });
    return !check.predictedValid || !check.topMatches;
  });
  const invalidCorrectFlag = settled.filter(row => {
    if (!predictionProbabilityIntegrity(row).valid || !settledOutcomeIntegrity(row).valid) return false;
    return !predictionConsistency(row, { settled: true }).correctMatches;
  });
  const invalidFixtureIds = all.filter(row => {
    const id = Number(row?.fixture_id || 0);
    return !Number.isInteger(id) || id <= 0;
  });

  const fixtureCounts = new Map();
  for (const row of all) {
    const id = Number(row?.fixture_id || 0);
    if (!id) continue;
    fixtureCounts.set(id, Number(fixtureCounts.get(id) || 0) + 1);
  }
  const duplicateFixtures = [...fixtureCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([fixtureId, count]) => ({ fixtureId, count }))
    .slice(0, 20);

  const severe = invalidProbabilities.length + invalidSnapshotMetadata.length + snapshotAfterKickoff.length +
    invalidSettledOutcome.length + inconsistentPrediction.length + invalidCorrectFlag.length +
    invalidFixtureIds.length + duplicateFixtures.length;
  const warning = stalePending.length;

  const checks = [
    {
      key: 'probabilities',
      label: 'Вероятности 1X2',
      state: invalidProbabilities.length ? 'fail' : 'pass',
      count: invalidProbabilities.length,
      detail: invalidProbabilities.length
        ? 'Есть строки с NaN/выходом за 0–100 или суммой, отличающейся от 100 более чем на 1.5 п.п.'
        : 'Все загруженные 1X2 probability snapshots проходят базовую проверку.',
    },
    {
      key: 'snapshot_metadata',
      label: 'Snapshot timestamps',
      state: invalidSnapshotMetadata.length ? 'fail' : 'pass',
      count: invalidSnapshotMetadata.length,
      detail: invalidSnapshotMetadata.length
        ? 'Есть строки без корректного captured_at или kickoff_at; pre-match статус нельзя подтвердить.'
        : 'captured_at и kickoff_at доступны у всех загруженных snapshots.',
    },
    {
      key: 'snapshot_timing',
      label: 'Pre-match snapshot timing',
      state: snapshotAfterKickoff.length ? 'fail' : 'pass',
      count: snapshotAfterKickoff.length,
      detail: snapshotAfterKickoff.length
        ? 'Есть snapshot, созданные в момент kickoff или позже.'
        : 'Поздние snapshot в загруженной выборке не обнаружены.',
    },
    {
      key: 'pending_settlement',
      label: 'Зависшие pending',
      state: stalePending.length ? 'warn' : 'pass',
      count: stalePending.length,
      detail: stalePending.length
        ? 'Есть pending-прогнозы старше 36 часов после kickoff — нужен контроль daily settlement.'
        : 'Зависших pending старше 36 часов нет.',
    },
    {
      key: 'settled_outcome',
      label: 'Фактический результат',
      state: invalidSettledOutcome.length ? 'fail' : 'pass',
      count: invalidSettledOutcome.length,
      detail: invalidSettledOutcome.length
        ? 'Есть settled-строки без корректного счёта либо outcome не совпадает со счётом.'
        : 'Settled-строки имеют корректный счёт и согласованный 1X2 outcome.',
    },
    {
      key: 'prediction_consistency',
      label: 'Predicted outcome',
      state: inconsistentPrediction.length ? 'fail' : 'pass',
      count: inconsistentPrediction.length,
      detail: inconsistentPrediction.length
        ? 'Есть строки, где predicted_outcome отсутствует или не совпадает с максимальной 1X2 вероятностью.'
        : 'predicted_outcome согласован с максимальной 1X2 вероятностью.',
    },
    {
      key: 'correct_flag',
      label: 'Correct flag',
      state: invalidCorrectFlag.length ? 'fail' : 'pass',
      count: invalidCorrectFlag.length,
      detail: invalidCorrectFlag.length
        ? 'Есть settled-строки, где correct не согласован с predicted_outcome и actual_outcome.'
        : 'Флаг correct согласован с прогнозом и фактическим исходом.',
    },
    {
      key: 'fixture_identity',
      label: 'Fixture identity',
      state: invalidFixtureIds.length ? 'fail' : 'pass',
      count: invalidFixtureIds.length,
      detail: invalidFixtureIds.length
        ? 'Есть строки без положительного целочисленного fixture_id.'
        : 'Все загруженные строки имеют корректный fixture_id.',
    },
    {
      key: 'duplicates',
      label: 'Fixture uniqueness',
      state: duplicateFixtures.length ? 'fail' : 'pass',
      count: duplicateFixtures.length,
      detail: duplicateFixtures.length
        ? 'В загруженной выборке повторяется fixture_id.'
        : 'Дубликаты fixture_id в загруженной выборке не обнаружены.',
    },
    {
      key: 'version_metadata',
      label: 'Версия анализа',
      state: missingVersion.length ? 'info' : 'pass',
      count: missingVersion.length,
      detail: missingVersion.length
        ? 'У старых snapshots может отсутствовать analysis_version; они показываются как legacy / unknown.'
        : 'У всех загруженных snapshots есть analysis_version.',
    },
    {
      key: 'signal_snapshot',
      label: 'Signal snapshots',
      state: missingSignals.length ? 'info' : 'pass',
      count: missingSignals.length,
      detail: missingSignals.length
        ? 'У части старых версий отсутствует signal_probabilities; это информационное ограничение cohort-аналитики.'
        : 'Signal probabilities доступны у всей загруженной выборки.',
    },
  ];

  return {
    status: severe ? 'blocked' : warning ? 'watch' : 'clean',
    label: severe ? 'Есть нарушения integrity' : warning ? 'Есть пункты для проверки' : 'Integrity checks пройдены',
    loadedRows: all.length,
    settledRows: settled.length,
    pendingRows: pending.length,
    severeIssues: severe,
    warningIssues: warning,
    informationalIssues: missingVersion.length + missingSignals.length,
    truncatedPotentially: settled.length >= 500 || pending.length >= 500,
    checks,
    examples: {
      invalidProbabilityFixtures: invalidProbabilities.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
      invalidSnapshotFixtures: invalidSnapshotMetadata.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
      lateSnapshotFixtures: snapshotAfterKickoff.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
      stalePendingFixtures: stalePending.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
      invalidOutcomeFixtures: invalidSettledOutcome.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
      inconsistentPredictionFixtures: inconsistentPrediction.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
      invalidCorrectFlagFixtures: invalidCorrectFlag.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
      invalidFixtureRows: invalidFixtureIds.length,
      duplicateFixtures,
    },
    note: 'Integrity проверяет только строки, загруженные текущим admin endpoint (до 500 settled + 500 pending). Строки с FAIL исключаются из метрик качества; веса модели автоматически не меняются.',
  };
}

function modelIntegritySelfTest() {
  const now = Date.now();
  const valid = {
    fixture_id: 1,
    home_prob: 50, draw_prob: 25, away_prob: 25,
    predicted_outcome: 'home', correct: true,
    actual_outcome: 'home', actual_home_goals: 2, actual_away_goals: 1,
    analysis_version: 'selftest', signal_probabilities: { market: { home: 50, draw: 25, away: 25 } },
    kickoff_at: new Date(now - 2 * 3600_000).toISOString(),
    captured_at: new Date(now - 3 * 3600_000).toISOString(),
  };
  const invalid = {
    ...valid,
    fixture_id: 2,
    home_prob: 90, draw_prob: 30, away_prob: 20,
    captured_at: new Date(now - 1 * 3600_000).toISOString(),
  };
  const missingProbability = {
    ...valid,
    fixture_id: 4,
    home_prob: null, draw_prob: 50, away_prob: 50,
  };
  const missingTimestamp = {
    ...valid,
    fixture_id: 5,
    captured_at: null,
  };
  const invalidOutcome = {
    ...valid,
    fixture_id: 6,
    actual_outcome: 'away',
    correct: false,
  };
  const inconsistentPrediction = {
    ...valid,
    fixture_id: 7,
    predicted_outcome: 'away',
    correct: false,
  };
  const stalePending = {
    ...valid,
    fixture_id: 3,
    actual_outcome: null,
    actual_home_goals: null,
    actual_away_goals: null,
    kickoff_at: new Date(now - 48 * 3600_000).toISOString(),
    captured_at: new Date(now - 49 * 3600_000).toISOString(),
  };
  const result = buildPredictionIntegrity([valid, invalid, missingProbability, missingTimestamp, invalidOutcome, inconsistentPrediction], [stalePending]);
  return {
    pass:
      result.checks.find(x => x.key === 'probabilities')?.count === 2 &&
      result.checks.find(x => x.key === 'snapshot_metadata')?.count === 1 &&
      result.checks.find(x => x.key === 'snapshot_timing')?.count === 1 &&
      result.checks.find(x => x.key === 'pending_settlement')?.count === 1 &&
      result.checks.find(x => x.key === 'settled_outcome')?.count === 1 &&
      result.checks.find(x => x.key === 'prediction_consistency')?.count === 1,
    result,
  };
}

function modelRemediationSelfTest() {
  const now = Date.now();
  const row = (fixtureId, hoursAgo, status = 'pending') => ({
    fixture_id: fixtureId,
    status,
    kickoff_at: new Date(now - hoursAgo * 3600_000).toISOString(),
    captured_at: new Date(now - (hoursAgo + 2) * 3600_000).toISOString(),
  });
  const candidates = stalePredictionCandidates([
    row(11, 48),
    row(12, 40),
    row(13, 12),
    row(14, 72, 'settled'),
  ], now);
  const batch = selectRemediationBatch(candidates, 20, 5);
  return {
    pass: candidates.length === 2 && batch.selected.length === 2 &&
      batch.selected.map(x => Number(x.fixture_id)).join(',') === '11,12' && batch.dates.length <= 5,
    candidates: candidates.length,
    selected: batch.selected.length,
    dates: batch.dates.length,
  };
}

function buildModelDashboard(rows, days) {
  const valid = (rows || []).filter(modelQualityEligibleRow);
  const overview = dashboardBucket(valid, 'Все прогнозы');
  const dashboard = {
    version: '6.1',
    periodDays: days,
    generatedAt: new Date().toISOString(),
    overview,
    trend: buildWeeklyDashboard(valid, 10),
    confidence: buildConfidenceDashboard(valid),
    completeness: buildCompletenessDashboard(valid),
    leagues: buildLeagueDashboard(valid),
    outcomes: buildOutcomeDashboard(valid),
    versions: buildModelVersionCohorts(valid),
    weightedCalibrationError: weightedTopCalibrationError(valid),
    signals: buildSignalDashboard(valid),
    calibrationModes: buildCalibrationModeDashboard(valid),
  };
  dashboard.observations = buildModelDashboardObservations(valid, dashboard);
  dashboard.note = 'Dashboard использует immutable pre-match snapshots и фактические результаты. Version cohorts описательны: система не выбирает «лучшую» версию и ничего не продвигает автоматически.';
  return dashboard;
}

function buildModelQuality(settledRows, pendingRows, days, calibrationProfile = null) {
  const rows = verifiedSettledRows(settledRows, pendingRows);
  const evaluated = rows.length;
  const excluded = Math.max(0, (settledRows || []).length - evaluated);
  const correct = rows.filter(x => x.correct === true).length;
  const brier = average(rows.map(verifiedBrierScore).filter(Number.isFinite));
  const logLossValues = rows.map(row => {
    const key = String(row.actual_outcome || '');
    const p = Math.max(0.01, Math.min(0.99, Number(row[`${key}_prob`] || 0) / 100));
    return -Math.log(p);
  });
  const avgLogLoss = average(logLossValues);

  const calibrationDefs = [
    ['34–44%', 34, 45], ['45–54%', 45, 55], ['55–64%', 55, 65], ['65–74%', 65, 75], ['75%+', 75, 101],
  ];
  const calibration = calibrationDefs.map(([label, min, max]) => {
    const group = rows.filter(x => { const p = topProbabilityValue(x); return p >= min && p < max; });
    return {
      label, sample: group.length,
      avgPredicted: group.length ? Math.round((average(group.map(topProbabilityValue)) || 0) * 10) / 10 : null,
      hitRate: pct(group.filter(x => x.correct === true).length, group.length),
    };
  });

  const confidence = [
    qualityBucket(rows.filter(x => Number(x.confidence_score || 0) < 55), 'Низкая'),
    qualityBucket(rows.filter(x => Number(x.confidence_score || 0) >= 55 && Number(x.confidence_score || 0) < 72), 'Средняя'),
    qualityBucket(rows.filter(x => Number(x.confidence_score || 0) >= 72), 'Высокая'),
  ];

  const outcome = ['home','draw','away'].map(key => {
    const group = rows.filter(x => String(x.predicted_outcome || '') === key);
    return { key, sample: group.length, accuracy: pct(group.filter(x => x.correct === true).length, group.length) };
  });

  const signalNames = ['market','apiPrediction','recentForm','h2h'];
  const signals = signalNames.map(name => {
    const group = rows.filter(x => Array.isArray(x.signal_names) && x.signal_names.includes(name));
    return { name, sample: group.length, accuracy: pct(group.filter(x => x.correct === true).length, group.length), avgBrier: group.length ? Math.round((average(group.map(verifiedBrierScore).filter(Number.isFinite)) || 0) * 1000) / 1000 : null };
  });

  const signalPerformance = signalCalibrationStats(rows);
  const v37Rows = rows.filter(row => /^(?:3\.(?:[7-9]|[1-9]\d)|[4-9]\.)/.test(String(row.analysis_version || '')) && ['home','draw','away'].includes(String(row.actual_outcome || '')) && rowRawProbabilities(row));
  const rawBrier = averageMetric(v37Rows, row => brierFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
  const finalBrier = averageMetric(v37Rows, row => brierFromProbabilities(rowFinalProbabilities(row), row.actual_outcome));
  const rawLogLoss = averageMetric(v37Rows, row => logLossFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
  const finalLogLoss = averageMetric(v37Rows, row => logLossFromProbabilities(rowFinalProbabilities(row), row.actual_outcome));
  const calibrationImpact = {
    sample: v37Rows.length,
    rawBrier: Number.isFinite(rawBrier) ? Math.round(rawBrier * 1000) / 1000 : null,
    finalBrier: Number.isFinite(finalBrier) ? Math.round(finalBrier * 1000) / 1000 : null,
    brierDelta: Number.isFinite(rawBrier) && Number.isFinite(finalBrier) ? Math.round((rawBrier - finalBrier) * 1000) / 1000 : null,
    rawLogLoss: Number.isFinite(rawLogLoss) ? Math.round(rawLogLoss * 1000) / 1000 : null,
    finalLogLoss: Number.isFinite(finalLogLoss) ? Math.round(finalLogLoss * 1000) / 1000 : null,
    logLossDelta: Number.isFinite(rawLogLoss) && Number.isFinite(finalLogLoss) ? Math.round((rawLogLoss - finalLogLoss) * 1000) / 1000 : null,
  };

  const over25Rows = rows.filter(x => typeof x.over25_correct === 'boolean');
  const bttsRows = rows.filter(x => typeof x.btts_correct === 'boolean');
  const recent = rows.slice(0, 12).map(row => ({
    fixtureId: Number(row.fixture_id), kickoffAt: row.kickoff_at, league: row.league_name || '',
    home: row.home_name || '', away: row.away_name || '',
    score: `${Number(row.actual_home_goals)}:${Number(row.actual_away_goals)}`,
    predictedOutcome: row.predicted_outcome || '', actualOutcome: row.actual_outcome || '',
    predictedLabel: predictionOutcomeLabel(row.predicted_outcome, row.home_name, row.away_name),
    topProbability: Math.round(topProbabilityValue(row) * 10) / 10,
    correct: row.correct === true, brier: verifiedBrierScore(row), confidence: Number(row.confidence_score || 0) || null,
    analysisVersion: modelVersionName(row),
  }));

  return {
    periodDays: days,
    generatedAt: new Date().toISOString(),
    queryLimitPerStatus: 500,
    sample: { settled: evaluated, excluded, loadedSettled: (settledRows || []).length, pending: (pendingRows || []).length, ready: evaluated >= 20, calibrationReady: evaluated >= 50 },
    headline: {
      accuracy: pct(correct, evaluated),
      avgBrier: brier === null ? null : Math.round(brier * 1000) / 1000,
      avgLogLoss: avgLogLoss === null ? null : Math.round(avgLogLoss * 1000) / 1000,
      avgTopProbability: evaluated ? Math.round((average(rows.map(topProbabilityValue)) || 0) * 10) / 10 : null,
    },
    calibration,
    confidence,
    outcome,
    signals,
    signalPerformance,
    dashboard: buildModelDashboard(rows, days),
    integrity: buildPredictionIntegrity(settledRows, pendingRows),
    calibrationDiagnostics: {
      weightedTopCalibrationError: weightedTopCalibrationError(rows),
      label: 'Weighted top-probability calibration error',
      note: 'Средневзвешенный абсолютный разрыв между средней top-вероятностью и hit rate по 5 probability buckets; меньше — лучше. RC19 не использует эту метрику отдельно: продвижение требует двух holdout-окон и сравнения с champion.',
    },
    calibrationEngine: calibrationProfile || baselineCalibrationProfile(evaluated, signalPerformance),
    calibrationImpact,
    secondary: {
      over25: { sample: over25Rows.length, accuracy: pct(over25Rows.filter(x => x.over25_correct === true).length, over25Rows.length) },
      btts: { sample: bttsRows.length, accuracy: pct(bttsRows.filter(x => x.btts_correct === true).length, bttsRows.length) },
    },
    recent,
    methodology: {
      snapshot: 'Для каждого fixture сохраняется первый расчёт, сделанный до стартового свистка. Поздние перерасчёты не перезаписывают его.',
      outcome: 'Точность исхода = доля матчей, где максимальная вероятность 1X2 совпала с фактическим исходом.',
      brier: 'Brier score учитывает все три вероятности 1X2; ниже — лучше. В интерфейсе он показан вместе с размером выборки.',
      versionCohorts: 'Сравнение analysis_version является описательным и не используется для автоматического выбора/продвижения версии.',
      integrity: 'В model-quality и calibration входят только trusted settlement: confirmed после двух provider-проверок либо adjudicated после явного admin review. unverified, verified-first-pass, drift и void исключаются.',
      warning: evaluated < 20 ? 'Выборка пока мала: цифры считаются технической диагностикой, а не доказанной точностью модели.' : '',
    },
  };
}

async function apiModelQuality(request, cfg) {
  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get('days') || 90);
  const days = [30, 90, 180, 365].includes(requestedDays) ? requestedDays : 90;
  const forceCalibration = url.searchParams.get('refresh') === '1';
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  let settled = [], pending = [];
  if (hasSupabase(cfg)) {
    try {
      [settled, pending] = await Promise.all([
        supaSelectMany(cfg, 'model_predictions', { status: 'eq.settled', kickoff_at: `gte.${since}` }, { limit: 500, order: 'kickoff_at.desc' }),
        supaSelectMany(cfg, 'model_predictions', { status: 'eq.pending', kickoff_at: `gte.${since}` }, { limit: 500, order: 'kickoff_at.desc' }),
      ]);
    } catch (error) {
      return json({ available: false, reason: 'Таблица backtest ещё не создана. Выполните supabase_migration_v3_6.sql.', detail: String(error?.message || error).slice(0, 180) });
    }
  } else {
    const all = [...memory.modelPredictions.values()].filter(x => Date.parse(x.kickoff_at || '') >= Date.parse(since));
    settled = all.filter(x => x.status === 'settled').sort((a,b) => Date.parse(b.kickoff_at) - Date.parse(a.kickoff_at));
    pending = all.filter(x => x.status === 'pending');
  }
  const calibrationProfile = await getCalibrationProfile(cfg, { force: forceCalibration }).catch(() => baselineCalibrationProfile(settled.length));
  return json({ available: true, ...buildModelQuality(settled, pending, days, calibrationProfile) });
}


const SETTLEMENT_FINALITY_DELAY_HOURS = 6;
const SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS = 24;
const SETTLEMENT_FINALITY_LOOKBACK_DAYS = 7;
const SETTLEMENT_FINALITY_MAX_FIXTURES = 100;
const SETTLEMENT_FINALITY_MAX_DATES = 3;
const SETTLEMENT_FINALITY_DRIFT_STATUSES = new Set(['AWD', 'WO', 'CANC', 'ABD']);

async function probeSettlementFinalitySchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const predictionUrl = new URL(`${cfg.supabaseUrl}/rest/v1/model_predictions`);
    predictionUrl.searchParams.set('select', 'settlement_verification_state,settlement_verified_at,settlement_verified_status');
    predictionUrl.searchParams.set('limit', '1');
    const eventUrl = new URL(`${cfg.supabaseUrl}/rest/v1/settlement_verification_events`);
    eventUrl.searchParams.set('select', 'id,fixture_id,state,observed_at');
    eventUrl.searchParams.set('limit', '1');
    const [predictionResponse, eventResponse] = await Promise.all([
      fetchWithTimeout(predictionUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement finality prediction schema'),
      fetchWithTimeout(eventUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement finality event schema'),
    ]);
    if (!predictionResponse.ok || !eventResponse.ok) {
      return { ok: false, status: `prediction_${predictionResponse.status}_events_${eventResponse.status}` };
    }
    return { ok: true, status: 'ok' };
  } catch (error) {
    return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
  }
}


async function probeSettlementTrustSchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/model_predictions`);
    url.searchParams.set('select', 'settlement_verification_count,settlement_first_verified_at');
    url.searchParams.set('limit', '1');
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement trust schema');
    return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
  } catch (error) {
    return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
  }
}

function settlementFinalityVerdict(row, fixture) {
  const status = fixtureStatusShort(fixture).toUpperCase();
  if (SETTLEMENT_FINALITY_DRIFT_STATUSES.has(status)) {
    return { state: 'drift', reason: `provider_status_${status.toLowerCase()}`, status, score: regulationScore(fixture) };
  }
  if (!isFinishedStatus(status)) return { state: 'wait', reason: 'provider_not_final', status, score: null };
  const score = regulationScore(fixture);
  if (!score) return { state: 'wait', reason: 'score_unavailable', status, score: null };
  const storedHome = Number(row?.actual_home_goals);
  const storedAway = Number(row?.actual_away_goals);
  const storedOutcome = String(row?.actual_outcome || '');
  const providerOutcome = actualOutcomeFromGoals(score.home, score.away);
  if (!Number.isFinite(storedHome) || !Number.isFinite(storedAway) || !providerOutcome) {
    return { state: 'drift', reason: 'stored_settlement_incomplete', status, score, providerOutcome };
  }
  const same = storedHome === score.home && storedAway === score.away && storedOutcome === providerOutcome;
  if (!same) {
    return {
      state: 'drift',
      reason: 'score_or_outcome_changed',
      status,
      score,
      providerOutcome,
    };
  }

  const priorState = String(row?.settlement_verification_state || 'unverified');
  if (priorState === 'verified') {
    const priorStatus = String(row?.settlement_verified_status || '').toUpperCase();
    if (priorStatus && priorStatus !== status) {
      return {
        state: 'drift',
        reason: 'provider_final_status_changed',
        status,
        score,
        providerOutcome,
        priorStatus,
      };
    }
    return {
      state: 'confirmed',
      reason: 'second_pass_match',
      status,
      score,
      providerOutcome,
      priorStatus: priorStatus || status,
    };
  }

  return {
    state: 'verified',
    reason: 'first_pass_match',
    status,
    score,
    providerOutcome,
  };
}

function settlementFinalitySelfTest() {
  const row = { status: 'settled', actual_home_goals: 2, actual_away_goals: 1, actual_outcome: 'home', settlement_verification_state: 'unverified' };
  const fixture = (status, home, away) => ({
    fixture: { id: 1, status: { short: status } },
    score: { fulltime: { home, away } },
    goals: { home, away },
  });
  const verified = settlementFinalityVerdict(row, fixture('FT', 2, 1));
  const confirmed = settlementFinalityVerdict({ ...row, settlement_verification_state: 'verified', settlement_verified_status: 'FT' }, fixture('FT', 2, 1));
  const lateScoreDrift = settlementFinalityVerdict({ ...row, settlement_verification_state: 'verified', settlement_verified_status: 'FT' }, fixture('FT', 1, 1));
  const lateStatusDrift = settlementFinalityVerdict({ ...row, settlement_verification_state: 'verified', settlement_verified_status: 'FT' }, fixture('AET', 2, 1));
  const statusDrift = settlementFinalityVerdict(row, fixture('AWD', 2, 1));
  const wait = settlementFinalityVerdict(row, fixture('2H', 2, 1));
  return {
    pass: verified.state === 'verified' &&
      confirmed.state === 'confirmed' &&
      lateScoreDrift.state === 'drift' &&
      lateStatusDrift.state === 'drift' &&
      statusDrift.state === 'drift' &&
      wait.state === 'wait',
    verified: verified.state,
    confirmed: confirmed.state,
    lateScoreDrift: lateScoreDrift.state,
    lateStatusDrift: lateStatusDrift.state,
    wait: wait.state,
  };
}

function settlementFinalitySummary(rows = []) {
  const settled = (rows || []).filter(row => row?.status === 'settled');
  const count = state => settled.filter(row => String(row?.settlement_verification_state || 'unverified') === state).length;
  return {
    totalSettled: settled.length,
    verified: count('verified'),
    confirmed: count('confirmed'),
    drift: count('drift'),
    unverified: count('unverified'),
    adjudicated: count('adjudicated'),
    trustedForMetrics: count('confirmed') + count('adjudicated'),
  };
}


const SETTLEMENT_DRIFT_ACTIONS = new Set(['keep_stored', 'accept_provider', 'void_prediction']);

async function probeSettlementAdjudicationSchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const predictionUrl = new URL(`${cfg.supabaseUrl}/rest/v1/model_predictions`);
    predictionUrl.searchParams.set('select', 'settlement_resolved_at,settlement_resolution_action,settlement_resolution_event_id');
    predictionUrl.searchParams.set('limit', '1');
    const resolutionUrl = new URL(`${cfg.supabaseUrl}/rest/v1/settlement_drift_resolutions`);
    resolutionUrl.searchParams.set('select', 'source_event_id,fixture_id,action,reason,created_at');
    resolutionUrl.searchParams.set('limit', '1');
    const [predictionResponse, resolutionResponse] = await Promise.all([
      fetchWithTimeout(predictionUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement adjudication prediction schema'),
      fetchWithTimeout(resolutionUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement adjudication resolution schema'),
    ]);
    if (!predictionResponse.ok || !resolutionResponse.ok) {
      return { ok: false, status: `prediction_${predictionResponse.status}_resolution_${resolutionResponse.status}` };
    }
    return { ok: true, status: 'ok' };
  } catch (error) {
    return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
  }
}

function settlementDriftBeforeSnapshot(row = {}) {
  return {
    status: String(row.status || ''),
    homeGoals: Number.isFinite(Number(row.actual_home_goals)) ? Number(row.actual_home_goals) : null,
    awayGoals: Number.isFinite(Number(row.actual_away_goals)) ? Number(row.actual_away_goals) : null,
    outcome: String(row.actual_outcome || ''),
    correct: typeof row.correct === 'boolean' ? row.correct : null,
    brierScore: Number.isFinite(Number(row.brier_score)) ? Number(row.brier_score) : null,
    over25Actual: typeof row.over25_actual === 'boolean' ? row.over25_actual : null,
    over25Correct: typeof row.over25_correct === 'boolean' ? row.over25_correct : null,
    bttsActual: typeof row.btts_actual === 'boolean' ? row.btts_actual : null,
    bttsCorrect: typeof row.btts_correct === 'boolean' ? row.btts_correct : null,
  };
}

function settlementDriftProviderSnapshot(event = {}) {
  return {
    status: String(event.provider_status || ''),
    homeGoals: Number.isFinite(Number(event.provider_home_goals)) ? Number(event.provider_home_goals) : null,
    awayGoals: Number.isFinite(Number(event.provider_away_goals)) ? Number(event.provider_away_goals) : null,
    outcome: String(event.provider_outcome || ''),
    observedAt: event.observed_at || null,
    reason: String(event.reason || ''),
  };
}

function buildSettlementDriftResolution(row, event, action, resolvedAt = new Date().toISOString()) {
  const normalizedAction = String(action || '');
  if (!SETTLEMENT_DRIFT_ACTIONS.has(normalizedAction)) {
    return { valid: false, error: 'unsupported_action' };
  }
  const before = settlementDriftBeforeSnapshot(row);
  const provider = settlementDriftProviderSnapshot(event);
  const common = {
    settlement_verification_state: 'adjudicated',
    settlement_verification_count: Math.max(1, Number(row?.settlement_verification_count || 0)),
    settlement_resolved_at: resolvedAt,
    settlement_resolution_action: normalizedAction,
    settlement_resolution_event_id: Number(event?.id || 0) || null,
  };

  if (normalizedAction === 'keep_stored') {
    return {
      valid: true,
      patch: common,
      before,
      provider,
      after: { ...before, verificationState: 'adjudicated', resolutionAction: normalizedAction },
    };
  }

  if (normalizedAction === 'void_prediction') {
    return {
      valid: true,
      patch: { ...common, status: 'void' },
      before,
      provider,
      after: { ...before, status: 'void', verificationState: 'adjudicated', resolutionAction: normalizedAction },
    };
  }

  const providerStatus = String(event?.provider_status || '').toUpperCase();
  const home = Number(event?.provider_home_goals);
  const away = Number(event?.provider_away_goals);
  const outcome = actualOutcomeFromGoals(home, away);
  const eventOutcome = String(event?.provider_outcome || '');
  if (!isFinishedStatus(providerStatus) || !Number.isFinite(home) || !Number.isFinite(away) || !outcome ||
      (eventOutcome && eventOutcome !== outcome)) {
    return { valid: false, error: 'provider_result_not_safe_to_accept', before, provider };
  }
  const totalGoals = home + away;
  const over25Actual = totalGoals >= 3;
  const bttsActual = home > 0 && away > 0;
  const patch = {
    ...common,
    status: 'settled',
    actual_home_goals: home,
    actual_away_goals: away,
    actual_outcome: outcome,
    correct: String(row?.predicted_outcome || '') === outcome,
    brier_score: scoreBrier(row, outcome),
    over25_actual: over25Actual,
    over25_correct: row?.over25_prob === null || row?.over25_prob === undefined ? null : (Number(row.over25_prob) >= 50) === over25Actual,
    btts_actual: bttsActual,
    btts_correct: row?.btts_prob === null || row?.btts_prob === undefined ? null : (Number(row.btts_prob) >= 50) === bttsActual,
    settlement_verified_at: resolvedAt,
    settlement_verified_status: providerStatus,
  };
  return {
    valid: true,
    patch,
    before,
    provider,
    after: {
      status: 'settled',
      homeGoals: home,
      awayGoals: away,
      outcome,
      correct: patch.correct,
      brierScore: patch.brier_score,
      over25Actual,
      over25Correct: patch.over25_correct,
      bttsActual,
      bttsCorrect: patch.btts_correct,
      verificationState: 'adjudicated',
      resolutionAction: normalizedAction,
    },
  };
}

async function settlementDriftResolutionToken(row, event) {
  const source = [
    Number(row?.fixture_id || 0),
    String(row?.settlement_verification_state || ''),
    String(row?.status || ''),
    String(row?.actual_home_goals ?? ''),
    String(row?.actual_away_goals ?? ''),
    String(row?.actual_outcome || ''),
    Number(event?.id || 0),
    String(event?.observed_at || ''),
    String(event?.provider_home_goals ?? ''),
    String(event?.provider_away_goals ?? ''),
    String(event?.provider_outcome || ''),
    String(event?.provider_status || ''),
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(source));
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
}

function settlementDriftAdjudicationSelfTest() {
  const row = {
    status: 'settled',
    predicted_outcome: 'home',
    actual_home_goals: 2,
    actual_away_goals: 1,
    actual_outcome: 'home',
    correct: true,
    home_prob: 60,
    draw_prob: 25,
    away_prob: 15,
    over25_prob: 55,
    btts_prob: 52,
  };
  const event = {
    id: 11,
    provider_status: 'FT',
    provider_home_goals: 1,
    provider_away_goals: 1,
    provider_outcome: 'draw',
  };
  const keep = buildSettlementDriftResolution(row, event, 'keep_stored', '2026-01-01T00:00:00.000Z');
  const accept = buildSettlementDriftResolution(row, event, 'accept_provider', '2026-01-01T00:00:00.000Z');
  const voided = buildSettlementDriftResolution(row, event, 'void_prediction', '2026-01-01T00:00:00.000Z');
  const unsafe = buildSettlementDriftResolution(row, { ...event, provider_status: 'CANC' }, 'accept_provider', '2026-01-01T00:00:00.000Z');
  return {
    pass: keep.valid && keep.patch.settlement_verification_state === 'adjudicated' &&
      keep.patch.actual_home_goals === undefined &&
      accept.valid && accept.patch.actual_home_goals === 1 && accept.patch.actual_away_goals === 1 &&
      accept.patch.actual_outcome === 'draw' && accept.patch.correct === false &&
      voided.valid && voided.patch.status === 'void' &&
      !unsafe.valid,
    keep: keep.valid,
    accept: accept.valid ? accept.patch.actual_outcome : accept.error,
    void: voided.valid ? voided.patch.status : voided.error,
    unsafeAcceptBlocked: !unsafe.valid,
  };
}

async function loadSettlementDriftReview(cfg, limit = 20) {
  if (!hasSupabase(cfg)) return { schemaReady: false, items: [], unresolved: 0 };
  const schema = await probeSettlementAdjudicationSchema(cfg);
  if (!schema.ok) return { schemaReady: false, schemaStatus: schema.status, items: [], unresolved: 0 };
  const rows = await supaSelectMany(cfg, 'model_predictions', {
    status: 'eq.settled',
    settlement_verification_state: 'eq.drift',
  }, { limit: Math.max(1, Math.min(20, Number(limit || 20))), order: 'kickoff_at.desc' });
  if (!rows.length) return { schemaReady: true, schemaStatus: 'ok', items: [], unresolved: 0 };

  const ids = [...new Set(rows.map(row => Number(row.fixture_id)).filter(x => Number.isInteger(x) && x > 0))];
  const events = await supaSelectMany(cfg, 'settlement_verification_events', {
    state: 'eq.drift',
    fixture_id: `in.(${ids.join(',')})`,
  }, { limit: Math.min(100, Math.max(20, ids.length * 4)), order: 'observed_at.desc' });
  const eventByFixture = new Map();
  for (const event of events || []) {
    const id = Number(event.fixture_id);
    if (!eventByFixture.has(id)) eventByFixture.set(id, event);
  }
  const eventIds = [...new Set([...eventByFixture.values()].map(event => Number(event.id)).filter(Boolean))];
  let resolutions = [];
  if (eventIds.length) {
    resolutions = await supaSelectMany(cfg, 'settlement_drift_resolutions', {
      source_event_id: `in.(${eventIds.join(',')})`,
    }, { limit: eventIds.length + 5, order: 'created_at.desc' }).catch(() => []);
  }
  const resolutionByEvent = new Map((resolutions || []).map(row => [Number(row.source_event_id), row]));

  const items = await Promise.all(rows.map(async row => {
    const event = eventByFixture.get(Number(row.fixture_id)) || null;
    const locked = event ? resolutionByEvent.get(Number(event.id)) || null : null;
    const providerStatus = String(event?.provider_status || '').toUpperCase();
    const providerHome = Number(event?.provider_home_goals);
    const providerAway = Number(event?.provider_away_goals);
    const providerOutcome = actualOutcomeFromGoals(providerHome, providerAway);
    const providerAcceptable = Boolean(event && isFinishedStatus(providerStatus) &&
      Number.isFinite(providerHome) && Number.isFinite(providerAway) &&
      providerOutcome && (!event.provider_outcome || String(event.provider_outcome) === providerOutcome));
    return {
      fixtureId: Number(row.fixture_id),
      league: String(row.league_name || ''),
      home: String(row.home_name || ''),
      away: String(row.away_name || ''),
      kickoffAt: row.kickoff_at || null,
      eventId: Number(event?.id || 0) || null,
      observedAt: event?.observed_at || null,
      driftReason: String(event?.reason || ''),
      stored: settlementDriftBeforeSnapshot(row),
      provider: settlementDriftProviderSnapshot(event || {}),
      providerAcceptable,
      resolutionToken: event ? await settlementDriftResolutionToken(row, event) : '',
      lockedAction: locked ? String(locked.action || '') : '',
    };
  }));
  return {
    schemaReady: true,
    schemaStatus: 'ok',
    unresolved: items.length,
    maxItems: 20,
    actions: ['keep_stored', 'accept_provider', 'void_prediction'],
    items,
  };
}

async function resolveSettlementDrift(cfg, user, input = {}) {
  const schema = await probeSettlementAdjudicationSchema(cfg);
  if (!schema.ok) {
    const error = new Error('Нужна migration v6.6 для Settlement Drift Adjudication.');
    error.code = 'SETTLEMENT_ADJUDICATION_SCHEMA';
    throw error;
  }
  const fixtureId = Number(input.fixtureId || 0);
  const eventId = Number(input.eventId || 0);
  const action = String(input.resolutionAction || '');
  const reason = redactOpsString(input.reason || '', 220).trim();
  if (!Number.isInteger(fixtureId) || fixtureId <= 0 || !Number.isInteger(eventId) || eventId <= 0) {
    const error = new Error('Некорректный drift case.');
    error.code = 'SETTLEMENT_DRIFT_CASE';
    throw error;
  }
  if (!SETTLEMENT_DRIFT_ACTIONS.has(action)) {
    const error = new Error('Неизвестное действие adjudication.');
    error.code = 'SETTLEMENT_DRIFT_ACTION';
    throw error;
  }
  if (reason.length < 5) {
    const error = new Error('Укажите причину adjudication — минимум 5 символов.');
    error.code = 'SETTLEMENT_DRIFT_REASON';
    throw error;
  }

  const row = await supaSelectOne(cfg, 'model_predictions', { fixture_id: `eq.${fixtureId}` });
  if (!row || row.status !== 'settled' || String(row.settlement_verification_state || '') !== 'drift') {
    const error = new Error('Drift case уже изменён. Обновите dry-run.');
    error.code = 'SETTLEMENT_DRIFT_STALE';
    throw error;
  }
  const events = await supaSelectMany(cfg, 'settlement_verification_events', {
    fixture_id: `eq.${fixtureId}`,
    state: 'eq.drift',
  }, { limit: 1, order: 'observed_at.desc' });
  const event = events?.[0] || null;
  if (!event || Number(event.id) !== eventId) {
    const error = new Error('Drift event изменился. Обновите dry-run.');
    error.code = 'SETTLEMENT_DRIFT_EVENT_STALE';
    throw error;
  }
  const expectedToken = await settlementDriftResolutionToken(row, event);
  if (!input.resolutionToken || String(input.resolutionToken) !== expectedToken) {
    const error = new Error('Drift snapshot изменился. Обновите dry-run.');
    error.code = 'SETTLEMENT_DRIFT_TOKEN_STALE';
    throw error;
  }

  const resolution = buildSettlementDriftResolution(row, event, action);
  if (!resolution.valid) {
    const error = new Error(action === 'accept_provider'
      ? 'Provider-коррекцию нельзя безопасно принять для этого статуса/счёта. Используйте keep stored или void.'
      : 'Adjudication не может быть применена.');
    error.code = 'SETTLEMENT_DRIFT_UNSAFE';
    throw error;
  }

  const auditRow = {
    source_event_id: eventId,
    fixture_id: fixtureId,
    action,
    reason,
    admin_telegram_id: Number(user?.id || 0) || null,
    before_snapshot: resolution.before,
    provider_snapshot: resolution.provider,
    after_snapshot: resolution.after,
    created_at: new Date().toISOString(),
  };
  await supaInsertIgnore(cfg, 'settlement_drift_resolutions', auditRow, 'source_event_id');
  const persisted = await supaSelectOne(cfg, 'settlement_drift_resolutions', { source_event_id: `eq.${eventId}` });
  if (!persisted) {
    const error = new Error('Не удалось зафиксировать adjudication audit.');
    error.code = 'SETTLEMENT_DRIFT_AUDIT';
    throw error;
  }
  if (String(persisted.action || '') !== action) {
    const error = new Error(`Этот drift event уже заблокирован действием ${String(persisted.action || '')}. Обновите dry-run.`);
    error.code = 'SETTLEMENT_DRIFT_ALREADY_LOCKED';
    throw error;
  }

  await supaPatch(cfg, 'model_predictions', {
    fixture_id: `eq.${fixtureId}`,
    status: 'eq.settled',
    settlement_verification_state: 'eq.drift',
  }, resolution.patch);

  await recordOpsEvent(cfg, {
    severity: action === 'accept_provider' ? 'warning' : 'info',
    source: 'model',
    eventType: 'settlement_adjudication',
    code: action === 'accept_provider'
      ? 'SETTLEMENT_DRIFT_PROVIDER_ACCEPTED'
      : action === 'void_prediction'
        ? 'SETTLEMENT_DRIFT_VOIDED'
        : 'SETTLEMENT_DRIFT_STORED_CONFIRMED',
    message: reason,
    meta: {
      fixtureId,
      sourceEventId: eventId,
      action,
      stored: resolution.before,
      provider: resolution.provider,
      after: resolution.after,
    },
  }).catch(() => null);

  return {
    fixtureId,
    sourceEventId: eventId,
    action,
    resolvedAt: resolution.patch.settlement_resolved_at,
    before: resolution.before,
    provider: resolution.provider,
    after: resolution.after,
  };
}

async function runSettlementFinalityVerification(cfg) {
  if (!hasSupabase(cfg) || !cfg.apiFootballKey) return { skipped: 'no_persistent_database_or_provider' };
  const [schema, trustSchema] = await Promise.all([
    probeSettlementFinalitySchema(cfg),
    probeSettlementTrustSchema(cfg),
  ]);
  if (!schema.ok) return { skipped: 'finality_schema_missing', status: schema.status };
  if (!trustSchema.ok) return { skipped: 'trust_schema_missing', status: trustSchema.status };

  const markerKey = `settlement-finality:${todayUtc()}:v2`;
  if (await getCache(markerKey, cfg)) return { skipped: 'already_checked', date: todayUtc() };
  if (!automaticSettlementQuotaHealthy()) return { skipped: 'provider_quota_guard' };

  const since = new Date(Date.now() - SETTLEMENT_FINALITY_LOOKBACK_DAYS * 86400_000).toISOString();
  const verifyBefore = new Date(Date.now() - SETTLEMENT_FINALITY_DELAY_HOURS * 3600_000).toISOString();
  const confirmBeforeMs = Date.now() - SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS * 3600_000;

  let rows = await supaSelectMany(cfg, 'model_predictions', {
    status: 'eq.settled',
    settlement_verification_state: 'in.(unverified,verified)',
    kickoff_at: `gte.${since}`,
    settled_at: `lte.${verifyBefore}`,
  }, { limit: 200, order: 'kickoff_at.desc' });

  rows = (rows || []).filter(row => {
    const state = String(row?.settlement_verification_state || 'unverified');
    if (state === 'unverified') return true;
    const verifiedAt = Date.parse(row?.settlement_verified_at || row?.settlement_first_verified_at || '');
    return state === 'verified' && (!Number.isFinite(verifiedAt) || verifiedAt <= confirmBeforeMs);
  });

  if (!rows.length) {
    await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), candidates: 0, verified: 0, confirmed: 0, drift: 0 }, cfg, 1440).catch(() => null);
    return { ok: true, candidates: 0, verified: 0, confirmed: 0, drift: 0, skipped: 0 };
  }

  const selected = [];
  const dates = new Set();
  for (const row of rows) {
    const date = String(row?.kickoff_at || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!dates.has(date) && dates.size >= SETTLEMENT_FINALITY_MAX_DATES) continue;
    dates.add(date);
    selected.push(row);
    if (selected.length >= SETTLEMENT_FINALITY_MAX_FIXTURES) break;
  }

  const fixtureIds = new Set(selected.map(row => Number(row.fixture_id)).filter(Boolean));
  const fixtureMap = new Map();
  for (const date of dates) {
    const fixtures = await apiFootball('/fixtures', { date }, cfg);
    for (const fixture of fixtures || []) {
      const id = fixtureIdentity(fixture);
      if (fixtureIds.has(id)) fixtureMap.set(id, fixture);
    }
  }

  let verified = 0, confirmed = 0, drift = 0, skipped = 0;
  for (const row of selected) {
    const fixture = fixtureMap.get(Number(row.fixture_id));
    if (!fixture) { skipped++; continue; }
    const verdict = settlementFinalityVerdict(row, fixture);
    if (verdict.state === 'wait') { skipped++; continue; }

    const now = new Date().toISOString();
    const previousState = String(row?.settlement_verification_state || 'unverified');
    const previousCount = Math.max(0, Number(row?.settlement_verification_count || 0));
    const patch = {
      settlement_verification_state: verdict.state,
      settlement_verified_at: now,
      settlement_verified_status: verdict.status,
      settlement_verification_count: verdict.state === 'confirmed'
        ? 2
        : verdict.state === 'verified'
          ? Math.max(1, previousCount)
          : previousCount,
    };
    if (verdict.state === 'verified' && !row?.settlement_first_verified_at) {
      patch.settlement_first_verified_at = now;
    }
    await supaPatch(cfg, 'model_predictions', {
      fixture_id: `eq.${Number(row.fixture_id)}`,
      status: 'eq.settled',
      settlement_verification_state: `eq.${previousState}`,
    }, patch);

    if (verdict.state === 'verified') {
      verified++;
      continue;
    }
    if (verdict.state === 'confirmed') {
      confirmed++;
      continue;
    }

    drift++;
    await supaInsertIgnore(cfg, 'settlement_verification_events', {
      observed_at: now,
      fixture_id: Number(row.fixture_id),
      state: 'drift',
      reason: verdict.reason,
      stored_home_goals: Number.isFinite(Number(row.actual_home_goals)) ? Number(row.actual_home_goals) : null,
      stored_away_goals: Number.isFinite(Number(row.actual_away_goals)) ? Number(row.actual_away_goals) : null,
      stored_outcome: String(row.actual_outcome || ''),
      provider_home_goals: Number.isFinite(Number(verdict.score?.home)) ? Number(verdict.score.home) : null,
      provider_away_goals: Number.isFinite(Number(verdict.score?.away)) ? Number(verdict.score.away) : null,
      provider_outcome: String(verdict.providerOutcome || ''),
      provider_status: verdict.status,
      detail: {
        settledAt: row.settled_at || null,
        verificationDelayHours: SETTLEMENT_FINALITY_DELAY_HOURS,
        confirmationDelayHours: SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS,
        previousVerificationState: previousState,
        previousVerificationCount: previousCount,
        previousVerifiedAt: row.settlement_verified_at || null,
        previousVerifiedStatus: row.settlement_verified_status || null,
        appVersion: APP_VERSION,
      },
    });
  }

  const result = {
    ok: true,
    candidates: selected.length,
    verified,
    confirmed,
    drift,
    skipped,
    providerCalls: dates.size,
    dates: [...dates],
  };
  await recordOpsEvent(cfg, {
    severity: drift ? 'warning' : 'info',
    source: 'model',
    eventType: 'settlement_finality',
    code: drift ? 'SETTLEMENT_FINALITY_DRIFT' : confirmed ? 'SETTLEMENT_FINALITY_CONFIRMED' : 'SETTLEMENT_FINALITY_VERIFIED',
    message: drift
      ? `Settlement finality found ${drift} drift row(s); trusted metrics continue to exclude them.`
      : `Settlement finality: ${verified} first-pass verified, ${confirmed} second-pass confirmed.`,
    meta: result,
  }).catch(() => null);
  await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...result }, cfg, 1440).catch(() => null);
  return result;
}

function stalePredictionCandidates(rows, now = Date.now()) {
  return (rows || [])
    .filter(row => {
      const id = Number(row?.fixture_id || 0);
      const kickoff = Date.parse(row?.kickoff_at || '');
      return row?.status === 'pending' && Number.isInteger(id) && id > 0 &&
        Number.isFinite(kickoff) && kickoff < now - 36 * 3600_000;
    })
    .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0));
}

function selectRemediationBatch(candidates, maxFixtures = 20, maxDates = 5) {
  const selected = [];
  const dates = new Set();
  for (const row of candidates || []) {
    const date = String(row?.kickoff_at || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!dates.has(date) && dates.size >= maxDates) continue;
    dates.add(date);
    selected.push(row);
    if (selected.length >= maxFixtures) break;
  }
  return { selected, dates: [...dates] };
}

async function remediationFingerprint(rows) {
  const source = (rows || [])
    .map(row => `${Number(row?.fixture_id || 0)}:${String(row?.kickoff_at || '')}:${String(row?.captured_at || row?.created_at || '')}`)
    .sort()
    .join('|');
  if (!source) return '';
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(source));
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
}

async function loadPredictionRemediationRows(cfg, maxRows = 5000) {
  if (hasSupabase(cfg)) {
    return await supaSelectPaged(cfg, 'model_predictions', {}, {
      pageSize: 1000,
      maxRows,
      order: 'kickoff_at.desc',
    });
  }
  const rows = [...memory.modelPredictions.values()].sort((a, b) => Date.parse(b.kickoff_at || 0) - Date.parse(a.kickoff_at || 0));
  return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}

function publicRemediationAction(row) {
  return {
    actionId: String(row?.action_id || ''),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    finishedAt: row?.finished_at || null,
    actionType: String(row?.action_type || ''),
    triggerSource: String(row?.trigger_source || (row?.action_type === 'auto_recover' ? 'cron' : 'admin')),
    status: String(row?.status || ''),
    reason: String(row?.reason || ''),
    candidateCount: Number(row?.candidate_count || 0),
    inspectedCount: Number(row?.inspected_count || 0),
    settledCount: Number(row?.settled_count || 0),
    skippedCount: Number(row?.skipped_count || 0),
    attemptNo: Math.max(1, Number(row?.attempt_no || 1)),
    retryOfActionId: row?.retry_of_action_id ? String(row.retry_of_action_id) : null,
    detail: parseJsonObject(row?.detail),
  };
}

async function loadRemediationActions(cfg, limit = 10) {
  if (!hasSupabase(cfg)) return memory.modelRemediation.actions.slice(0, limit).map(publicRemediationAction);
  const rows = await supaSelectMany(cfg, 'prediction_integrity_actions', {}, {
    limit: Math.max(1, Math.min(20, Number(limit || 10))),
    order: 'created_at.desc',
  });
  return rows.map(publicRemediationAction);
}

async function probeSettlementWatchdogSchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const runtimeUrl = new URL(`${cfg.supabaseUrl}/rest/v1/runtime_controls`);
    runtimeUrl.searchParams.set('select', 'auto_settlement_recovery_enabled');
    runtimeUrl.searchParams.set('limit', '1');
    const actionUrl = new URL(`${cfg.supabaseUrl}/rest/v1/prediction_integrity_actions`);
    actionUrl.searchParams.set('select', 'trigger_source');
    actionUrl.searchParams.set('limit', '1');
    const [runtimeResponse, actionResponse] = await Promise.all([
      fetchWithTimeout(runtimeUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement watchdog runtime schema'),
      fetchWithTimeout(actionUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement watchdog audit schema'),
    ]);
    if (!runtimeResponse.ok || !actionResponse.ok) {
      return {
        ok: false,
        status: `runtime_${runtimeResponse.status}_audit_${actionResponse.status}`,
      };
    }
    return { ok: true, status: 'ok' };
  } catch (error) {
    return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
  }
}



const SETTLEMENT_RUN_STALE_MINUTES = 30;
const SETTLEMENT_RUN_MAX_ATTEMPTS = 3;

async function probeSettlementRunLedgerSchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/prediction_integrity_actions`);
    url.searchParams.set('select', 'updated_at,finished_at,attempt_no,retry_of_action_id');
    url.searchParams.set('limit', '1');
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement run ledger schema');
    return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
  } catch (error) {
    return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
  }
}

function settlementBatchKey(fixtureIds = []) {
  return [...new Set((fixtureIds || []).map(Number).filter(x => Number.isInteger(x) && x > 0))]
    .sort((a, b) => a - b)
    .join(',');
}

function settlementRetryDecision(latestAction, fixtureIds = []) {
  const currentKey = settlementBatchKey(fixtureIds);
  if (!latestAction || settlementBatchKey(latestAction.fixture_ids || latestAction.fixtureIds || []) !== currentKey) {
    return { attemptNo: 1, retryOfActionId: null, retryExhausted: false };
  }
  if (String(latestAction.status || '') !== 'interrupted') {
    return { attemptNo: 1, retryOfActionId: null, retryExhausted: false };
  }
  const previousAttempt = Math.max(1, Number(latestAction.attempt_no || latestAction.attemptNo || 1));
  if (previousAttempt >= SETTLEMENT_RUN_MAX_ATTEMPTS) {
    return {
      attemptNo: SETTLEMENT_RUN_MAX_ATTEMPTS,
      retryOfActionId: String(latestAction.action_id || latestAction.actionId || ''),
      retryExhausted: true,
    };
  }
  return {
    attemptNo: previousAttempt + 1,
    retryOfActionId: String(latestAction.action_id || latestAction.actionId || ''),
    retryExhausted: false,
  };
}

function settlementRunLedgerSelfTest() {
  const ids = [30, 10, 20];
  const fresh = settlementRetryDecision(null, ids);
  const retry = settlementRetryDecision({ status: 'interrupted', attempt_no: 1, action_id: 'a', fixture_ids: [20, 30, 10] }, ids);
  const exhausted = settlementRetryDecision({ status: 'interrupted', attempt_no: 3, action_id: 'b', fixture_ids: [10, 20, 30] }, ids);
  const different = settlementRetryDecision({ status: 'interrupted', attempt_no: 2, action_id: 'c', fixture_ids: [10, 20] }, ids);
  return {
    pass: fresh.attemptNo === 1 && !fresh.retryOfActionId &&
      retry.attemptNo === 2 && retry.retryOfActionId === 'a' && !retry.retryExhausted &&
      exhausted.attemptNo === 3 && exhausted.retryExhausted &&
      different.attemptNo === 1 && !different.retryOfActionId,
    fresh: fresh.attemptNo,
    retry: retry.attemptNo,
    exhausted: exhausted.retryExhausted,
    differentBatch: different.attemptNo,
  };
}

async function inspectSettlementRunLedger(cfg) {
  if (!hasSupabase(cfg)) return { active: [], stale: [], cutoff: null };
  const rows = await supaSelectMany(cfg, 'prediction_integrity_actions', {
    action_type: 'eq.auto_recover',
    status: 'eq.started',
  }, { limit: 20, order: 'updated_at.asc' });
  const cutoffTs = Date.now() - SETTLEMENT_RUN_STALE_MINUTES * 60_000;
  const active = [];
  const stale = [];
  for (const row of rows || []) {
    const ts = Date.parse(row.updated_at || row.created_at || 0);
    if (Number.isFinite(ts) && ts <= cutoffTs) stale.push(row);
    else active.push(row);
  }
  return { active, stale, cutoff: new Date(cutoffTs).toISOString() };
}

async function reconcileInterruptedSettlementActions(cfg) {
  const ledger = await inspectSettlementRunLedger(cfg);
  if (!ledger.stale.length) return { reconciled: [], active: ledger.active, cutoff: ledger.cutoff };
  const now = new Date().toISOString();
  const reconciled = [];
  for (const row of ledger.stale) {
    const detail = {
      ...parseJsonObject(row.detail),
      phase: 'interrupted',
      interruptedReason: 'stale_started_reconciled',
      interruptedAt: now,
    };
    await supaPatch(cfg, 'prediction_integrity_actions', { action_id: `eq.${String(row.action_id)}` }, {
      status: 'interrupted',
      updated_at: now,
      finished_at: now,
      detail,
    });
    reconciled.push({ ...row, status: 'interrupted', updated_at: now, finished_at: now, detail });
  }
  await noteSettlementWatchdogOutcome(cfg, 'failed', {
    actionId: reconciled[reconciled.length - 1]?.action_id || null,
    error: `${reconciled.length} stale started settlement run(s) reconciled as interrupted`,
  }).catch(() => null);
  await recordOpsEvent(cfg, {
    severity: 'warning',
    source: 'model',
    eventType: 'settlement_watchdog',
    code: 'SETTLEMENT_RUN_INTERRUPTED',
    message: `Reconciled ${reconciled.length} stale started settlement run(s) as interrupted.`,
    meta: {
      count: reconciled.length,
      staleMinutes: SETTLEMENT_RUN_STALE_MINUTES,
      actionIds: reconciled.map(x => String(x.action_id)).slice(0, 10),
    },
  }).catch(() => null);
  return { reconciled, active: ledger.active, cutoff: ledger.cutoff };
}

async function resolveSettlementRetryLineage(cfg, fixtureIds) {
  if (!hasSupabase(cfg)) return settlementRetryDecision(null, fixtureIds);
  const rows = await supaSelectMany(cfg, 'prediction_integrity_actions', {
    action_type: 'eq.auto_recover',
  }, { limit: 20, order: 'created_at.desc' });
  const key = settlementBatchKey(fixtureIds);
  const latest = (rows || []).find(row => settlementBatchKey(row.fixture_ids || []) === key) || null;
  return settlementRetryDecision(latest, fixtureIds);
}

const SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD = 2;
const SETTLEMENT_CIRCUIT_OPEN_HOURS = 72;

async function probeSettlementReliabilitySchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/settlement_watchdog_state`);
    url.searchParams.set('select', 'id,consecutive_failures,circuit_open_until,last_run_at,last_status,last_action_id,last_error,updated_at');
    url.searchParams.set('limit', '1');
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement reliability schema');
    return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
  } catch (error) {
    return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
  }
}

function normalizeSettlementReliability(row = {}) {
  const openUntil = row.circuit_open_until || row.circuitOpenUntil || null;
  const openTs = openUntil ? Date.parse(openUntil) : 0;
  return {
    consecutiveFailures: Math.max(0, Number(row.consecutive_failures ?? row.consecutiveFailures ?? 0)),
    circuitOpenUntil: openUntil,
    circuitOpen: Number.isFinite(openTs) && openTs > Date.now(),
    lastRunAt: row.last_run_at || row.lastRunAt || null,
    lastStatus: String(row.last_status || row.lastStatus || 'never'),
    lastActionId: row.last_action_id || row.lastActionId || null,
    lastError: String(row.last_error || row.lastError || '').slice(0, 180),
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

async function loadSettlementReliability(cfg) {
  if (!hasSupabase(cfg)) return normalizeSettlementReliability();
  const row = await supaSelectOne(cfg, 'settlement_watchdog_state', { id: 'eq.global' });
  return normalizeSettlementReliability(row || {});
}

async function saveSettlementReliability(cfg, patch = {}) {
  if (!hasSupabase(cfg)) return normalizeSettlementReliability(patch);
  const current = await loadSettlementReliability(cfg).catch(() => normalizeSettlementReliability());
  const merged = {
    id: 'global',
    consecutive_failures: Math.max(0, Number(patch.consecutiveFailures ?? current.consecutiveFailures ?? 0)),
    circuit_open_until: patch.circuitOpenUntil !== undefined ? patch.circuitOpenUntil : current.circuitOpenUntil,
    last_run_at: patch.lastRunAt !== undefined ? patch.lastRunAt : current.lastRunAt,
    last_status: String(patch.lastStatus ?? current.lastStatus ?? 'never').slice(0, 32),
    last_action_id: patch.lastActionId !== undefined ? patch.lastActionId : current.lastActionId,
    last_error: String(patch.lastError !== undefined ? patch.lastError : current.lastError || '').slice(0, 180),
    updated_at: new Date().toISOString(),
  };
  await supaUpsert(cfg, 'settlement_watchdog_state', merged, 'id');
  return normalizeSettlementReliability(merged);
}

async function noteSettlementWatchdogOutcome(cfg, status, meta = {}) {
  const current = await loadSettlementReliability(cfg).catch(() => normalizeSettlementReliability());
  const now = new Date().toISOString();
  if (['completed', 'partial'].includes(String(status))) {
    return await saveSettlementReliability(cfg, {
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastRunAt: now,
      lastStatus: String(status),
      lastActionId: meta.actionId || null,
      lastError: '',
    });
  }
  if (String(status) !== 'failed') {
    return await saveSettlementReliability(cfg, {
      lastRunAt: now,
      lastStatus: String(status || 'unknown'),
      lastActionId: meta.actionId || null,
      lastError: meta.error || '',
    });
  }
  const failures = Number(current.consecutiveFailures || 0) + 1;
  const circuitOpenUntil = failures >= SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD
    ? new Date(Date.now() + SETTLEMENT_CIRCUIT_OPEN_HOURS * 3600_000).toISOString()
    : current.circuitOpenUntil;
  return await saveSettlementReliability(cfg, {
    consecutiveFailures: failures,
    circuitOpenUntil,
    lastRunAt: now,
    lastStatus: 'failed',
    lastActionId: meta.actionId || null,
    lastError: meta.error || '',
  });
}

async function resetSettlementCircuit(cfg, user, reason) {
  const before = await loadSettlementReliability(cfg);
  const after = await saveSettlementReliability(cfg, {
    consecutiveFailures: 0,
    circuitOpenUntil: null,
    lastRunAt: before.lastRunAt,
    lastStatus: 'reset',
    lastActionId: null,
    lastError: '',
  });
  const action = await recordRemediationAction(cfg, user, {
    actionType: 'circuit_reset',
    triggerSource: 'admin',
    status: 'completed',
    reason,
    candidateCount: 0,
    inspectedCount: 0,
    settledCount: 0,
    skippedCount: 0,
    fixtureIds: [],
    detail: {
      previousFailures: Number(before.consecutiveFailures || 0),
      previousOpenUntil: before.circuitOpenUntil || null,
    },
  });
  await recordOpsEvent(cfg, {
    severity: 'info',
    source: 'model',
    eventType: 'settlement_watchdog',
    code: 'SETTLEMENT_CIRCUIT_RESET',
    message: reason,
    meta: { previousFailures: before.consecutiveFailures, previousOpenUntil: before.circuitOpenUntil },
  }).catch(() => null);
  return { before, after, action };
}

async function recordRemediationAction(cfg, user, action) {
  const now = new Date().toISOString();
  const actionStatus = String(action.status || 'completed');
  const row = {
    action_id: String(action.actionId || crypto.randomUUID()),
    action_type: String(action.actionType || 'recover'),
    ...(action.triggerSource ? { trigger_source: String(action.triggerSource).slice(0, 20) } : {}),
    status: actionStatus,
    reason: redactOpsString(action.reason || '', 220),
    updated_at: now,
    finished_at: actionStatus === 'started' ? null : now,
    attempt_no: Math.max(1, Math.min(SETTLEMENT_RUN_MAX_ATTEMPTS, Number(action.attemptNo || 1))),
    retry_of_action_id: action.retryOfActionId ? String(action.retryOfActionId) : null,
    admin_telegram_id: Number(user?.id || 0) || null,
    candidate_count: Number(action.candidateCount || 0),
    inspected_count: Number(action.inspectedCount || 0),
    settled_count: Number(action.settledCount || 0),
    skipped_count: Number(action.skippedCount || 0),
    fixture_ids: (action.fixtureIds || []).map(Number).filter(Number.isFinite).slice(0, 20),
    detail: action.detail || {},
  };
  if (hasSupabase(cfg)) await supaInsertIgnore(cfg, 'prediction_integrity_actions', row, 'action_id');
  memory.modelRemediation.actions.unshift({ ...row, created_at: now });
  memory.modelRemediation.actions = memory.modelRemediation.actions.slice(0, 20);
  return publicRemediationAction({ ...row, created_at: now });
}

async function finalizeRemediationAction(cfg, actionId, patch = {}) {
  const now = new Date().toISOString();
  const finalStatus = String(patch.status || 'completed');
  const update = {
    status: finalStatus,
    updated_at: now,
    finished_at: finalStatus === 'started' ? null : now,
    inspected_count: Number(patch.inspectedCount || 0),
    settled_count: Number(patch.settledCount || 0),
    skipped_count: Number(patch.skippedCount || 0),
    detail: patch.detail || {},
  };
  if (hasSupabase(cfg)) {
    await supaPatch(cfg, 'prediction_integrity_actions', { action_id: `eq.${String(actionId)}` }, update);
  }
  const idx = memory.modelRemediation.actions.findIndex(row => String(row?.action_id || '') === String(actionId));
  if (idx >= 0) memory.modelRemediation.actions[idx] = { ...memory.modelRemediation.actions[idx], ...update };
  const row = idx >= 0
    ? memory.modelRemediation.actions[idx]
    : { action_id: String(actionId), created_at: new Date().toISOString(), ...update };
  return publicRemediationAction(row);
}

async function buildModelRemediationReport(cfg, { maxRows = 5000 } = {}) {
  if (!hasSupabase(cfg) && !cfg.devMode) {
    return { available: false, reason: 'Supabase не настроен: remediation требует постоянную базу данных.' };
  }
  const [schema, watchdogSchema, reliabilitySchema, runLedgerSchema, finalitySchema, trustSchema, adjudicationSchema, reliability, runtimeState] = await Promise.all([
    hasSupabase(cfg) ? probeOptionalTable(cfg, 'prediction_integrity_actions') : Promise.resolve({ ok: true, status: 'memory' }),
    hasSupabase(cfg) ? probeSettlementWatchdogSchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
    hasSupabase(cfg) ? probeSettlementReliabilitySchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
    hasSupabase(cfg) ? probeSettlementRunLedgerSchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
    hasSupabase(cfg) ? probeSettlementFinalitySchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
    hasSupabase(cfg) ? probeSettlementTrustSchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
    hasSupabase(cfg) ? probeSettlementAdjudicationSchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
    hasSupabase(cfg) ? loadSettlementReliability(cfg).catch(() => normalizeSettlementReliability()) : Promise.resolve(normalizeSettlementReliability()),
    loadRuntimeControls(cfg),
  ]);
  const loaded = await loadPredictionRemediationRows(cfg, maxRows);
  const settled = loaded.rows.filter(row => row.status === 'settled');
  const pending = loaded.rows.filter(row => row.status === 'pending');
  const candidates = stalePredictionCandidates(pending);
  const batch = selectRemediationBatch(candidates);
  const candidateToken = await remediationFingerprint(batch.selected);
  let recentActions = [];
  if (schema.ok) recentActions = await loadRemediationActions(cfg, 10).catch(() => []);
  const runLedger = runLedgerSchema.ok
    ? await inspectSettlementRunLedger(cfg).catch(() => ({ active: [], stale: [], cutoff: null }))
    : { active: [], stale: [], cutoff: null };
  const integrity = buildPredictionIntegrity(settled, pending);
  const finality = settlementFinalitySummary(loaded.rows);
  const driftReview = adjudicationSchema.ok
    ? await loadSettlementDriftReview(cfg, 20).catch(error => ({ schemaReady: true, schemaStatus: 'error', unresolved: 0, items: [], error: redactOpsString(error?.message || error, 160) }))
    : { schemaReady: false, schemaStatus: adjudicationSchema.status || 'missing', unresolved: 0, items: [] };
  return {
    available: true,
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    schemaReady: Boolean(schema.ok),
    schemaStatus: schema.status || (schema.ok ? 'ok' : 'missing'),
    scan: {
      loadedRows: loaded.rows.length,
      settledRows: settled.length,
      pendingRows: pending.length,
      maxRows,
      truncated: Boolean(loaded.truncated),
    },
    integrity,
    recovery: {
      stalePending: candidates.length,
      selectedCount: batch.selected.length,
      candidateToken,
      fixtureIds: batch.selected.map(row => Number(row.fixture_id)),
      estimatedProviderCalls: batch.dates.length,
      maxFixturesPerRun: 20,
      maxDatesPerRun: 5,
      candidates: batch.selected.map(row => ({
        fixtureId: Number(row.fixture_id),
        kickoffAt: row.kickoff_at,
        league: String(row.league_name || ''),
        home: String(row.home_name || ''),
        away: String(row.away_name || ''),
        ageHours: Math.max(0, Math.floor((Date.now() - Date.parse(row.kickoff_at || 0)) / 3600_000)),
      })),
    },
    recentActions,
    driftReview,
    watchdog: {
      schemaReady: Boolean(watchdogSchema.ok),
      schemaStatus: watchdogSchema.status || (watchdogSchema.ok ? 'ok' : 'missing'),
      mode: runtimeState.value?.autoSettlementRecoveryEnabled ? 'active' : 'shadow',
      autoRecoveryEnabled: Boolean(runtimeState.value?.autoSettlementRecoveryEnabled),
      scheduleUtc: '04:00',
      maxRunsPerDay: 1,
      maxFixturesPerRun: 20,
      maxDatesPerRun: 5,
      quotaGuard: true,
      reliability: {
        schemaReady: Boolean(reliabilitySchema.ok),
        schemaStatus: reliabilitySchema.status || (reliabilitySchema.ok ? 'ok' : 'missing'),
        consecutiveFailures: Number(reliability.consecutiveFailures || 0),
        circuitOpen: Boolean(reliability.circuitOpen),
        circuitOpenUntil: reliability.circuitOpenUntil || null,
        lastRunAt: reliability.lastRunAt || null,
        lastStatus: reliability.lastStatus || 'never',
        lastActionId: reliability.lastActionId || null,
        lastError: reliability.lastError || '',
        failureThreshold: SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD,
        openHours: SETTLEMENT_CIRCUIT_OPEN_HOURS,
      },
      runLedger: {
        schemaReady: Boolean(runLedgerSchema.ok),
        schemaStatus: runLedgerSchema.status || (runLedgerSchema.ok ? 'ok' : 'missing'),
        activeStarted: Number(runLedger.active?.length || 0),
        staleStarted: Number(runLedger.stale?.length || 0),
        staleAfterMinutes: SETTLEMENT_RUN_STALE_MINUTES,
        maxAttempts: SETTLEMENT_RUN_MAX_ATTEMPTS,
      },
      finality: {
        schemaReady: Boolean(finalitySchema.ok && trustSchema.ok),
        schemaStatus: finalitySchema.ok && trustSchema.ok
          ? 'ok'
          : `finality_${finalitySchema.status || 'missing'}_trust_${trustSchema.status || 'missing'}`,
        trustSchemaReady: Boolean(trustSchema.ok),
        verified: Number(finality.verified || 0),
        confirmed: Number(finality.confirmed || 0),
        drift: Number(finality.drift || 0),
        unverified: Number(finality.unverified || 0),
        adjudicated: Number(finality.adjudicated || 0),
        trustedForMetrics: Number(finality.trustedForMetrics || 0),
        totalSettled: Number(finality.totalSettled || 0),
        scheduleUtc: '05:00',
        delayHours: SETTLEMENT_FINALITY_DELAY_HOURS,
        confirmationDelayHours: SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS,
        trustedStates: ['confirmed', 'adjudicated'],
        lookbackDays: SETTLEMENT_FINALITY_LOOKBACK_DAYS,
        maxDatesPerRun: SETTLEMENT_FINALITY_MAX_DATES,
      },
    },
    policy: {
      dryRunFirst: true,
      deletesPredictions: false,
      rewritesSnapshots: false,
      onlySettlesPending: true,
      adminIdExposed: false,
      automaticRecoveryRuntimeGated: true,
      note: 'GET выполняет read-only dry-run. RC15 вводит trusted metrics gate и two-pass finality: первый matching check даёт verified, повторный спустя 24+ часа — confirmed. Только confirmed/adjudicated участвуют в model-quality и calibration.',
    },
  };
}

async function apiModelRemediation(request, cfg, user) {
  if (request.method === 'GET') return json(await buildModelRemediationReport(cfg));
  if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);
  const body = await request.json().catch(() => ({}));
  const requestedAction = String(body?.action || '');
  const reason = redactOpsString(body?.reason || '', 220).trim();
  if (reason.length < 5) return json({ error: 'Укажите причину действия (минимум 5 символов).' }, 400);
  if (requestedAction === 'reset_circuit') {
    const schema = await probeSettlementReliabilitySchema(cfg);
    if (!schema.ok) return json({ error: 'Нужна migration v6.3 для Settlement Circuit Breaker.', code: 'SETTLEMENT_RELIABILITY_SCHEMA' }, 409);
    const reset = await resetSettlementCircuit(cfg, user, reason);
    const report = await buildModelRemediationReport(cfg).catch(() => null);
    return json({ ok: true, reset, report });
  }
  if (requestedAction === 'resolve_drift') {
    try {
      const resolution = await resolveSettlementDrift(cfg, user, {
        fixtureId: body?.fixtureId,
        eventId: body?.eventId,
        resolutionAction: body?.resolutionAction,
        resolutionToken: body?.resolutionToken,
        reason,
      });
      const report = await buildModelRemediationReport(cfg).catch(() => null);
      return json({ ok: true, resolution, report });
    } catch (error) {
      const status = ['SETTLEMENT_DRIFT_STALE','SETTLEMENT_DRIFT_EVENT_STALE','SETTLEMENT_DRIFT_TOKEN_STALE','SETTLEMENT_DRIFT_ALREADY_LOCKED'].includes(String(error?.code || '')) ? 409 : 400;
      return json({ error: error?.message || 'Drift adjudication не выполнена.', code: error?.code || 'SETTLEMENT_DRIFT' }, status);
    }
  }
  if (requestedAction !== 'recover') return json({ error: 'Поддерживаются action=recover, action=reset_circuit и action=resolve_drift.' }, 400);

  const report = await buildModelRemediationReport(cfg);
  if (!report.available) return json(report, 503);
  if (!report.schemaReady) return json({ error: 'Нужна migration v6.1 для audit trail.', code: 'MODEL_REMEDIATION_SCHEMA', report }, 409);
  const requestedIds = [...new Set((Array.isArray(body?.fixtureIds) ? body.fixtureIds : []).map(Number).filter(x => Number.isInteger(x) && x > 0))].sort((a, b) => a - b);
  const currentIds = [...(report.recovery?.fixtureIds || [])].map(Number).sort((a, b) => a - b);
  if (!report.recovery?.candidateToken || String(body?.candidateToken || '') !== report.recovery.candidateToken ||
      requestedIds.join(',') !== currentIds.join(',')) {
    return json({ error: 'Список кандидатов изменился. Обновите dry-run перед восстановлением.', code: 'REMEDIATION_STALE', report }, 409);
  }
  if (!currentIds.length) return json({ ok: true, execution: { status: 'nothing_to_do', settled: 0, skipped: 0 }, report });
  if (!freeQuotaHealthy(10, 3)) {
    return json({ error: 'Недостаточно безопасного остатка квоты API-Football. Повторите позже.', code: 'REMEDIATION_QUOTA', report }, 429);
  }

  const candidateMap = new Map((report.recovery?.candidates || []).map(row => [Number(row.fixtureId), row]));
  const dates = [...new Set([...candidateMap.values()].map(row => String(row.kickoffAt || '').slice(0, 10)).filter(Boolean))];
  const fixtureSet = new Set(currentIds);
  const fixtures = [];
  const actionId = crypto.randomUUID();
  try {
    for (const date of dates) {
      const rows = await apiFootball('/fixtures', { date }, cfg);
      fixtures.push(...rows.filter(fixture => fixtureSet.has(fixtureIdentity(fixture))));
    }
    const settlement = await settlePredictionsFromFixtures(fixtures, cfg);
    const after = hasSupabase(cfg)
      ? await supaSelectMany(cfg, 'model_predictions', { fixture_id: `in.(${currentIds.join(',')})` }, { limit: currentIds.length + 2 })
      : currentIds.map(id => memory.modelPredictions.get(id)).filter(Boolean);
    const settledCount = after.filter(row => row.status === 'settled').length;
    const skippedCount = Math.max(0, currentIds.length - settledCount);
    const status = skippedCount ? 'partial' : 'completed';
    const action = await recordRemediationAction(cfg, user, {
      actionId,
      actionType: 'recover',
      status,
      reason,
      candidateCount: report.recovery.stalePending,
      inspectedCount: currentIds.length,
      settledCount,
      skippedCount,
      fixtureIds: currentIds,
      detail: { providerCalls: dates.length, finishedFixtures: fixtures.filter(f => isFinishedStatus(fixtureStatusShort(f))).length, settlementChecked: settlement.checked },
    });
    memory.modelRemediation.lastRun = action;
    await noteSettlementWatchdogOutcome(cfg, status, { actionId }).catch(() => null);
    await recordOpsEvent(cfg, {
      severity: skippedCount ? 'warning' : 'info', source: 'model', eventType: 'prediction_remediation',
      code: skippedCount ? 'REMEDIATION_PARTIAL' : 'REMEDIATION_COMPLETED', message: reason,
      meta: { actionId, inspectedCount: currentIds.length, settledCount, skippedCount, providerCalls: dates.length },
    }).catch(() => null);
    const refreshedReport = await buildModelRemediationReport(cfg).catch(() => null);
    return json({ ok: true, execution: action, report: refreshedReport || report });
  } catch (error) {
    await recordRemediationAction(cfg, user, {
      actionId,
      actionType: 'recover',
      status: 'failed',
      reason,
      candidateCount: report.recovery.stalePending,
      inspectedCount: currentIds.length,
      settledCount: 0,
      skippedCount: currentIds.length,
      fixtureIds: currentIds,
      detail: { providerCalls: dates.length, error: redactOpsString(error?.message || error, 180) },
    }).catch(() => null);
    throw error;
  }
}

function settlementWatchdogDecision(report, runtime, { providerReady = true, quotaHealthy = true, schemaReady = true, runtimeVerified = true, circuitOpen = false } = {}) {
  const stalePending = Number(report?.recovery?.stalePending || 0);
  const selectedCount = Number(report?.recovery?.selectedCount || 0);
  const providerCalls = Number(report?.recovery?.estimatedProviderCalls || 0);
  if (!report?.available) return { state: 'unavailable', recover: false, stalePending, selectedCount, providerCalls };
  if (!schemaReady || !report?.schemaReady) return { state: 'schema_missing', recover: false, stalePending, selectedCount, providerCalls };
  if (!stalePending) return { state: 'clean', recover: false, stalePending, selectedCount, providerCalls };
  if (!runtimeVerified) return { state: 'runtime_unverified', recover: false, stalePending, selectedCount, providerCalls };
  if (!runtime?.autoSettlementRecoveryEnabled) return { state: 'observe', recover: false, stalePending, selectedCount, providerCalls };
  if (circuitOpen) return { state: 'circuit_open', recover: false, stalePending, selectedCount, providerCalls };
  if (!providerReady) return { state: 'provider_missing', recover: false, stalePending, selectedCount, providerCalls };
  if (!quotaHealthy) return { state: 'quota_guard', recover: false, stalePending, selectedCount, providerCalls };
  if (!selectedCount || !providerCalls) return { state: 'no_batch', recover: false, stalePending, selectedCount, providerCalls };
  return { state: 'recover', recover: true, stalePending, selectedCount, providerCalls };
}

function settlementWatchdogSelfTest() {
  const report = {
    available: true,
    schemaReady: true,
    recovery: { stalePending: 7, selectedCount: 5, estimatedProviderCalls: 2 },
  };
  const shadow = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: false }, { schemaReady: true, providerReady: true, quotaHealthy: true });
  const unverified = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, runtimeVerified: false, providerReady: true, quotaHealthy: true });
  const quota = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, runtimeVerified: true, providerReady: true, quotaHealthy: false });
  const circuit = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, runtimeVerified: true, providerReady: true, quotaHealthy: true, circuitOpen: true });
  const recover = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, runtimeVerified: true, providerReady: true, quotaHealthy: true });
  const clean = settlementWatchdogDecision({ ...report, recovery: { stalePending: 0, selectedCount: 0, estimatedProviderCalls: 0 } }, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, providerReady: true, quotaHealthy: true });
  return {
    pass: shadow.state === 'observe' && !shadow.recover && unverified.state === 'runtime_unverified' && !unverified.recover && quota.state === 'quota_guard' && !quota.recover && circuit.state === 'circuit_open' && !circuit.recover && recover.state === 'recover' && recover.recover && clean.state === 'clean',
    shadow: shadow.state,
    runtime: unverified.state,
    quota: quota.state,
    circuit: circuit.state,
    active: recover.state,
    clean: clean.state,
  };
}

function automaticSettlementQuotaHealthy() {
  const p = memory.provider || {};
  const paid = ['PRO', 'ULTRA', 'MEGA'].includes(String(p.plan || '').toUpperCase());
  if (paid) return !providerSnapshot().cooldownActive;
  const dailyKnown = Number.isFinite(Number(p.dailyRemaining));
  const minuteKnown = Number.isFinite(Number(p.minuteRemaining));
  if (!dailyKnown || !minuteKnown) return false;
  return freeQuotaHealthy(15, 4);
}

async function runSettlementWatchdog(cfg) {
  if (!hasSupabase(cfg)) return { skipped: 'no_persistent_database' };
  const markerKey = `settlement-watchdog:${todayUtc()}:v1`;
  const runLedgerSchema = await probeSettlementRunLedgerSchema(cfg);
  if (!runLedgerSchema.ok) return { skipped: 'run_ledger_schema_missing', status: runLedgerSchema.status };
  const reconciliation = await reconcileInterruptedSettlementActions(cfg);
  const ledgerAfter = await inspectSettlementRunLedger(cfg);
  if (ledgerAfter.active.length) {
    await recordOpsEvent(cfg, {
      severity: 'warning',
      source: 'model',
      eventType: 'settlement_watchdog',
      code: 'SETTLEMENT_RUN_IN_PROGRESS',
      message: 'Settlement watchdog skipped because another started run is still active.',
      meta: {
        activeRuns: ledgerAfter.active.length,
        staleAfterMinutes: SETTLEMENT_RUN_STALE_MINUTES,
        actionIds: ledgerAfter.active.map(x => String(x.action_id)).slice(0, 10),
      },
    }).catch(() => null);
    return { skipped: 'run_in_progress', activeRuns: ledgerAfter.active.length };
  }
  if (await getCache(markerKey, cfg)) return { skipped: 'already_checked', date: todayUtc(), reconciledInterrupted: reconciliation.reconciled.length };

  const report = await buildModelRemediationReport(cfg, { maxRows: 5000 });
  const runtimeState = await loadRuntimeControls(cfg);
  const runtime = runtimeState.value || DEFAULT_RUNTIME_CONTROLS;
  const decision = settlementWatchdogDecision(report, runtime, {
    schemaReady: Boolean(report?.watchdog?.schemaReady),
    runtimeVerified: runtimeState.source === 'supabase',
    providerReady: Boolean(cfg.apiFootballKey),
    quotaHealthy: automaticSettlementQuotaHealthy(),
    circuitOpen: Boolean(report?.watchdog?.reliability?.circuitOpen),
  });
  const baseMeta = {
    state: decision.state,
    stalePending: decision.stalePending,
    selectedCount: decision.selectedCount,
    providerCalls: decision.providerCalls,
    scanTruncated: Boolean(report?.scan?.truncated),
    autoRecoveryEnabled: Boolean(runtime.autoSettlementRecoveryEnabled),
    runtimeVerified: runtimeState.source === 'supabase',
    runtimeRevision: Number(runtime.revision || 1),
    circuitOpen: Boolean(report?.watchdog?.reliability?.circuitOpen),
    circuitOpenUntil: report?.watchdog?.reliability?.circuitOpenUntil || null,
    consecutiveFailures: Number(report?.watchdog?.reliability?.consecutiveFailures || 0),
    reconciledInterrupted: Number(reconciliation.reconciled?.length || 0),
    runLedgerActive: Number(ledgerAfter.active?.length || 0),
  };

  if (decision.state === 'clean') {
    await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...baseMeta }, cfg, 1440).catch(() => null);
    return { ok: true, ...baseMeta };
  }

  if (!decision.recover) {
    const severity = ['schema_missing', 'runtime_unverified', 'provider_missing', 'quota_guard', 'circuit_open', 'unavailable'].includes(decision.state) ? 'warning' : 'info';
    const code = ({
      observe: 'SETTLEMENT_WATCHDOG_OBSERVE',
      schema_missing: 'SETTLEMENT_WATCHDOG_SCHEMA',
      runtime_unverified: 'SETTLEMENT_WATCHDOG_RUNTIME',
      provider_missing: 'SETTLEMENT_WATCHDOG_PROVIDER',
      quota_guard: 'SETTLEMENT_WATCHDOG_QUOTA',
      circuit_open: 'SETTLEMENT_WATCHDOG_CIRCUIT_OPEN',
      no_batch: 'SETTLEMENT_WATCHDOG_NO_BATCH',
      unavailable: 'SETTLEMENT_WATCHDOG_UNAVAILABLE',
    })[decision.state] || 'SETTLEMENT_WATCHDOG';
    await recordOpsEvent(cfg, {
      severity,
      source: 'model',
      eventType: 'settlement_watchdog',
      code,
      message: decision.state === 'observe'
        ? `Settlement watchdog detected ${decision.stalePending} stale pending; automatic recovery is paused by runtime control.`
        : `Settlement watchdog did not execute recovery: ${decision.state}.`,
      meta: baseMeta,
    }).catch(() => null);
    if (decision.state !== 'quota_guard') {
      await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...baseMeta }, cfg, 1440).catch(() => null);
    }
    return { ok: true, ...baseMeta };
  }

  const currentIds = [...new Set((report.recovery?.fixtureIds || []).map(Number).filter(x => Number.isInteger(x) && x > 0))];
  const candidateMap = new Map((report.recovery?.candidates || []).map(row => [Number(row.fixtureId), row]));
  const dates = [...new Set(currentIds.map(id => String(candidateMap.get(id)?.kickoffAt || '').slice(0, 10)).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))];
  const fixtureSet = new Set(currentIds);
  const fixtures = [];
  const retry = await resolveSettlementRetryLineage(cfg, currentIds);
  if (retry.retryExhausted) {
    await recordOpsEvent(cfg, {
      severity: 'warning',
      source: 'model',
      eventType: 'settlement_watchdog',
      code: 'SETTLEMENT_RETRY_EXHAUSTED',
      message: 'Settlement retry lineage exhausted for the current exact fixture batch.',
      meta: { ...baseMeta, retryOfActionId: retry.retryOfActionId, maxAttempts: SETTLEMENT_RUN_MAX_ATTEMPTS },
    }).catch(() => null);
    await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...baseMeta, state: 'retry_exhausted' }, cfg, 1440).catch(() => null);
    return { ok: true, ...baseMeta, state: 'retry_exhausted', retryOfActionId: retry.retryOfActionId };
  }
  const actionId = crypto.randomUUID();
  const reason = 'RC12 scheduled settlement catch-up';
  let auditStarted = false;
  let executionResult = null;

  try {
    await recordRemediationAction(cfg, null, {
      actionId,
      actionType: 'auto_recover',
      triggerSource: 'cron',
      status: 'started',
      reason,
      attemptNo: retry.attemptNo,
      retryOfActionId: retry.retryOfActionId,
      candidateCount: Number(report.recovery?.stalePending || 0),
      inspectedCount: currentIds.length,
      settledCount: 0,
      skippedCount: currentIds.length,
      fixtureIds: currentIds,
      detail: {
        phase: 'preflight',
        providerCallsPlanned: dates.length,
        scanTruncated: Boolean(report.scan?.truncated),
        runtimeRevision: Number(runtime.revision || 1),
        candidateToken: String(report.recovery?.candidateToken || ''),
        batchKey: settlementBatchKey(currentIds),
        attemptNo: retry.attemptNo,
        retryOfActionId: retry.retryOfActionId,
      },
    });
    auditStarted = true;

    for (const date of dates) {
      const rows = await apiFootball('/fixtures', { date }, cfg);
      fixtures.push(...rows.filter(fixture => fixtureSet.has(fixtureIdentity(fixture))));
    }
    const settlement = await settlePredictionsFromFixtures(fixtures, cfg);
    const after = await supaSelectMany(cfg, 'model_predictions', { fixture_id: `in.(${currentIds.join(',')})` }, { limit: currentIds.length + 2 });
    const settledCount = after.filter(row => row.status === 'settled').length;
    const skippedCount = Math.max(0, currentIds.length - settledCount);
    const status = skippedCount ? 'partial' : 'completed';
    executionResult = { settledCount, skippedCount, status };
    const action = await finalizeRemediationAction(cfg, actionId, {
      status,
      inspectedCount: currentIds.length,
      settledCount,
      skippedCount,
      detail: {
        phase: 'final',
        providerCalls: dates.length,
        finishedFixtures: fixtures.filter(f => isFinishedStatus(fixtureStatusShort(f))).length,
        settlementChecked: settlement.checked,
        scanTruncated: Boolean(report.scan?.truncated),
        runtimeRevision: Number(runtime.revision || 1),
      },
    });
    memory.modelRemediation.lastRun = action;
    await recordOpsEvent(cfg, {
      severity: skippedCount ? 'warning' : 'info',
      source: 'model',
      eventType: 'settlement_watchdog',
      code: skippedCount ? 'SETTLEMENT_WATCHDOG_PARTIAL' : 'SETTLEMENT_WATCHDOG_COMPLETED',
      message: `${reason}: ${settledCount} settled, ${skippedCount} skipped.`,
      meta: { ...baseMeta, actionId, settledCount, skippedCount },
    }).catch(() => null);
    await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...baseMeta, actionId, settledCount, skippedCount, status }, cfg, 1440).catch(() => null);
    return { ok: true, ...baseMeta, actionId, settledCount, skippedCount, status };
  } catch (error) {
    if (executionResult) {
      await noteSettlementWatchdogOutcome(cfg, executionResult.status, { actionId }).catch(() => null);
      await recordOpsEvent(cfg, {
        severity: 'error',
        source: 'model',
        eventType: 'settlement_watchdog',
        code: 'SETTLEMENT_WATCHDOG_AUDIT_FINALIZE_FAILED',
        message: error?.message || error,
        meta: { ...baseMeta, actionId, ...executionResult, auditStatus: 'started' },
      }).catch(() => null);
      await setCache(markerKey, 0, {
        checkedAt: new Date().toISOString(),
        ...baseMeta,
        actionId,
        ...executionResult,
        auditPending: true,
      }, cfg, 1440).catch(() => null);
      return { ok: true, ...baseMeta, actionId, ...executionResult, auditPending: true };
    }
    await noteSettlementWatchdogOutcome(cfg, 'failed', { actionId, error: redactOpsString(error?.message || error, 180) }).catch(() => null);
    const failurePatch = {
      status: 'failed',
      inspectedCount: currentIds.length,
      settledCount: 0,
      skippedCount: currentIds.length,
      detail: {
        phase: auditStarted ? 'execution' : 'audit_preflight',
        providerCalls: dates.length,
        scanTruncated: Boolean(report.scan?.truncated),
        runtimeRevision: Number(runtime.revision || 1),
        error: redactOpsString(error?.message || error, 180),
      },
    };
    if (auditStarted) {
      await finalizeRemediationAction(cfg, actionId, failurePatch).catch(() => null);
    } else {
      await recordRemediationAction(cfg, null, {
        actionId,
        actionType: 'auto_recover',
        triggerSource: 'cron',
        status: 'failed',
        reason,
        attemptNo: retry.attemptNo,
        retryOfActionId: retry.retryOfActionId,
        candidateCount: Number(report.recovery?.stalePending || 0),
        inspectedCount: currentIds.length,
        settledCount: 0,
        skippedCount: currentIds.length,
        fixtureIds: currentIds,
        detail: failurePatch.detail,
      }).catch(() => null);
    }
    await recordOpsEvent(cfg, {
      severity: 'error',
      source: 'model',
      eventType: 'settlement_watchdog',
      code: 'SETTLEMENT_WATCHDOG_FAILED',
      message: error?.message || error,
      meta: { ...baseMeta, actionId },
    }).catch(() => null);
    return { ok: false, ...baseMeta, actionId, error: redactOpsString(error?.message || error, 180) };
  }
}

async function settleBacktestDaily(cfg) {
  if (!hasSupabase(cfg) || !cfg.apiFootballKey) return { skipped: 'no_persistent_database_or_provider' };
  const d = new Date(Date.now() - 86400_000);
  const date = d.toISOString().slice(0, 10);
  const markerKey = `backtest:settled:${date}:v1`;
  if (await getCache(markerKey, cfg)) return { skipped: 'already_checked', date };
  const start = `${date}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86400_000).toISOString();
  let pending = [];
  try {
    pending = await supaSelectMany(cfg, 'model_predictions', { status: 'eq.pending', kickoff_at: `gte.${start}` }, { limit: 200, order: 'kickoff_at.asc' });
  } catch (error) {
    console.warn('daily backtest pending read skipped', error?.message || error);
    return { skipped: 'prediction_table_unavailable' };
  }
  pending = pending.filter(x => Date.parse(x.kickoff_at || '') < Date.parse(end));
  if (!pending.length) {
    await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), pending: 0 }, cfg, 1440);
    return { date, pending: 0, settled: 0 };
  }
  if (!freeQuotaHealthy(12, 3)) return { skipped: 'provider_quota_guard', date, pending: pending.length };
  try {
    const fixtures = await apiFootball('/fixtures', { date }, cfg);
    const result = await settlePredictionsFromFixtures(fixtures, cfg);
    await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), pending: pending.length, settled: result.settled }, cfg, 1440);
    return { date, pending: pending.length, settled: result.settled };
  } catch (error) {
    console.warn('daily backtest settle skipped', error?.message || error);
    return { skipped: 'provider_error', date };
  }
}

async function recordHistory(userId, payload, cfg) {
  const match = payload?.match;
  if (!match?.fixtureId) return;
  const row = {
    telegram_id: Number(userId),
    fixture_id: Number(match.fixtureId),
    home_name: match.home?.name || '',
    away_name: match.away?.name || '',
    league_name: match.league || '',
    fixture_date: match.date || null,
    home_logo: match.home?.logo || null,
    away_logo: match.away?.logo || null,
    viewed_at: new Date().toISOString(),
  };
  if (hasSupabase(cfg)) {
    try { await supaUpsert(cfg, 'analysis_history', row, 'telegram_id,fixture_id'); } catch (e) { console.warn('history write skipped', e?.message || e); }
    return;
  }
  const key = Number(userId);
  const list = memory.history.get(key) || [];
  const next = [row, ...list.filter(x => Number(x.fixture_id) !== Number(row.fixture_id))].slice(0, 20);
  memory.history.set(key, next);
}

async function getHistory(userId, cfg) {
  if (hasSupabase(cfg)) {
    try {
      return await supaSelectMany(cfg, 'analysis_history', { telegram_id: `eq.${Number(userId)}` }, { limit: 20, order: 'viewed_at.desc' });
    } catch (e) {
      console.warn('history read skipped', e?.message || e);
      return [];
    }
  }
  return memory.history.get(Number(userId)) || [];
}


async function getFavorites(userId, cfg) {
  if (hasSupabase(cfg)) {
    try {
      return await supaSelectMany(cfg, 'favorites', { telegram_id: `eq.${Number(userId)}` }, { limit: 50, order: 'created_at.desc' });
    } catch (e) {
      console.warn('favorites read skipped', e?.message || e);
      return [];
    }
  }
  return memory.favorites.get(Number(userId)) || [];
}

async function addFavorite(userId, team, cfg) {
  const row = {
    telegram_id: Number(userId),
    team_id: Number(team.id),
    team_name: String(team.name || ''),
    team_logo: String(team.logo || ''),
    created_at: new Date().toISOString(),
  };
  if (!Number.isFinite(row.team_id) || row.team_id <= 0 || !row.team_name) throw new Error('Некорректная команда.');
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'favorites', row, 'telegram_id,team_id');
    return row;
  }
  const key = Number(userId);
  const list = memory.favorites.get(key) || [];
  memory.favorites.set(key, [row, ...list.filter(x => Number(x.team_id) !== row.team_id)].slice(0, 50));
  return row;
}

async function removeFavorite(userId, teamId, cfg) {
  const id = Number(teamId);
  if (hasSupabase(cfg)) {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/favorites`);
    url.searchParams.set('telegram_id', `eq.${Number(userId)}`);
    url.searchParams.set('team_id', `eq.${id}`);
    const r = await fetchWithTimeout(url, { method: 'DELETE', headers: supaHeaders(cfg, { Prefer: 'return=minimal' }) }, 7000, 'Supabase favorites');
    if (!r.ok) throw new Error(`Supabase favorites: HTTP ${r.status}`);
    return;
  }
  const key = Number(userId);
  memory.favorites.set(key, (memory.favorites.get(key) || []).filter(x => Number(x.team_id) !== id));
}

function normalizePreferences(row = {}) {
  const allowedFilters = new Set(['top', 'favorites', 'all']);
  const rawFilter = row.default_filter ?? row.defaultFilter ?? DEFAULT_PREFERENCES.defaultFilter;
  const reminder = Number(row.reminder_minutes ?? row.reminderMinutes ?? DEFAULT_PREFERENCES.reminderMinutes);
  return {
    defaultFilter: allowedFilters.has(String(rawFilter)) ? String(rawFilter) : DEFAULT_PREFERENCES.defaultFilter,
    reminderMinutes: [15, 30, 60].includes(reminder) ? reminder : DEFAULT_PREFERENCES.reminderMinutes,
    kickoffNotification: row.kickoff_notification ?? row.kickoffNotification ?? DEFAULT_PREFERENCES.kickoffNotification,
    hideYouth: row.hide_youth ?? row.hideYouth ?? DEFAULT_PREFERENCES.hideYouth,
    favoriteFirst: row.favorite_first ?? row.favoriteFirst ?? DEFAULT_PREFERENCES.favoriteFirst,
  };
}

async function getPreferences(userId, cfg) {
  if (hasSupabase(cfg)) {
    try {
      const row = await supaSelectOne(cfg, 'user_preferences', { telegram_id: `eq.${Number(userId)}` });
      return normalizePreferences(row || {});
    } catch (e) {
      console.warn('preferences read skipped', e?.message || e);
      return { ...DEFAULT_PREFERENCES };
    }
  }
  return normalizePreferences(memory.preferences.get(Number(userId)) || {});
}

async function savePreferences(userId, input, cfg) {
  const current = await getPreferences(userId, cfg);
  const next = normalizePreferences({
    defaultFilter: input.defaultFilter ?? current.defaultFilter,
    reminderMinutes: input.reminderMinutes ?? current.reminderMinutes,
    kickoffNotification: input.kickoffNotification ?? current.kickoffNotification,
    hideYouth: input.hideYouth ?? current.hideYouth,
    favoriteFirst: input.favoriteFirst ?? current.favoriteFirst,
  });
  const row = {
    telegram_id: Number(userId),
    default_filter: next.defaultFilter,
    reminder_minutes: next.reminderMinutes,
    kickoff_notification: Boolean(next.kickoffNotification),
    hide_youth: Boolean(next.hideYouth),
    favorite_first: Boolean(next.favoriteFirst),
    updated_at: new Date().toISOString(),
  };
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'user_preferences', row, 'telegram_id');
  } else {
    memory.preferences.set(Number(userId), row);
  }
  return next;
}

async function getReminders(userId, cfg) {
  if (hasSupabase(cfg)) {
    try {
      return await supaSelectMany(cfg, 'match_reminders', { telegram_id: `eq.${Number(userId)}`, enabled: 'eq.true' }, { limit: 50, order: 'fixture_date.asc' });
    } catch (e) {
      console.warn('reminders read skipped', e?.message || e);
      return [];
    }
  }
  return memory.reminders.get(Number(userId)) || [];
}

async function addReminder(userId, input, cfg) {
  const prefs = await getPreferences(userId, cfg);
  const requestedMinutes = Number(input.reminderMinutes ?? prefs.reminderMinutes);
  const reminderMinutes = [15, 30, 60].includes(requestedMinutes) ? requestedMinutes : 30;
  const kickoffNotify = input.kickoffNotify === undefined ? Boolean(prefs.kickoffNotification) : Boolean(input.kickoffNotify);
  const row = {
    telegram_id: Number(userId),
    fixture_id: Number(input.fixtureId),
    home_name: String(input.homeName || ''),
    away_name: String(input.awayName || ''),
    league_name: String(input.leagueName || ''),
    fixture_date: input.fixtureDate ? new Date(input.fixtureDate).toISOString() : null,
    enabled: true,
    remind_before_minutes: reminderMinutes,
    kickoff_notify: kickoffNotify,
    notified_at: null,
    kickoff_notified_at: null,
    prematch_claimed_at: null,
    kickoff_claimed_at: null,
    prematch_attempts: 0,
    kickoff_attempts: 0,
    delivery_last_error: null,
    delivery_last_attempt_at: null,
    delivery_last_success_at: null,
    delivery_disabled_reason: null,
    delivery_retry_after: null,
    created_at: new Date().toISOString(),
  };
  if (!Number.isFinite(row.fixture_id) || row.fixture_id <= 0 || !row.fixture_date || !row.home_name || !row.away_name) {
    throw new Error('Некорректные данные напоминания.');
  }
  if (Date.parse(row.fixture_date) <= Date.now() + 5 * 60_000) throw new Error('Матч уже начинается или начался.');
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'match_reminders', row, 'telegram_id,fixture_id');
    return row;
  }
  const key = Number(userId);
  const list = memory.reminders.get(key) || [];
  memory.reminders.set(key, [row, ...list.filter(x => Number(x.fixture_id) !== row.fixture_id)].slice(0, 50));
  return row;
}

async function removeReminder(userId, fixtureId, cfg) {
  const id = Number(fixtureId);
  if (hasSupabase(cfg)) {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${Number(userId)}`);
    url.searchParams.set('fixture_id', `eq.${id}`);
    const r = await fetchWithTimeout(url, { method: 'DELETE', headers: supaHeaders(cfg, { Prefer: 'return=minimal' }) }, 7000, 'Supabase reminders');
    if (!r.ok) throw new Error(`Supabase reminders: HTTP ${r.status}`);
    return;
  }
  const key = Number(userId);
  memory.reminders.set(key, (memory.reminders.get(key) || []).filter(x => Number(x.fixture_id) !== id));
}

async function patchReminder(row, patch, cfg) {
  if (!hasSupabase(cfg)) return;
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
  url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
  url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
  const r = await fetchWithTimeout(url, {
    method: 'PATCH',
    headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  }, 7000, 'Supabase reminders patch');
  if (!r.ok) throw new Error(`Supabase reminders patch: HTTP ${r.status}`);
}

function reminderDeliveryStatus(row) {
  if (row?.kickoff_notified_at) return 'kickoff_sent';
  if (row?.notified_at) return 'prematch_sent';
  if (row?.delivery_last_error) return 'retry_pending';
  return 'scheduled';
}

async function clearStaleReminderClaims(cfg) {
  if (!hasSupabase(cfg)) return { prematch: 0, kickoff: 0 };
  const cutoff = new Date(Date.now() - 20 * 60_000).toISOString();

  const clearColumn = async column => {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
    url.searchParams.set('enabled', 'eq.true');
    url.searchParams.set(column, `lt.${cutoff}`);
    const r = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, { Prefer: 'return=representation' }),
      body: JSON.stringify({ [column]: null }),
    }, 7000, 'Supabase reminder stale claim');
    if (!r.ok) throw new Error(`Supabase reminder claims: HTTP ${r.status}`);
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) ? rows.length : 0;
  };

  const prematch = await clearColumn('prematch_claimed_at').catch(() => 0);
  const kickoff = await clearColumn('kickoff_claimed_at').catch(() => 0);
  const total = prematch + kickoff;

  if (total > 0) {
    await recordOpsEvent(cfg, {
      severity: 'warning',
      source: 'reminders',
      eventType: 'reminder_delivery',
      code: 'REMINDER_STALE_CLAIMS',
      message: `Recovered ${total} stale reminder delivery claims.`,
      meta: { prematch, kickoff },
    }).catch(() => {});
  }

  return { prematch, kickoff };
}

async function claimReminderDelivery(row, kind, cfg) {
  if (!hasSupabase(cfg)) return { claimed: true, claimAt: new Date().toISOString() };

  const kickoff = kind === 'kickoff';
  const claimColumn = kickoff ? 'kickoff_claimed_at' : 'prematch_claimed_at';
  const doneColumn = kickoff ? 'kickoff_notified_at' : 'notified_at';
  const attemptsColumn = kickoff ? 'kickoff_attempts' : 'prematch_attempts';
  const claimAt = new Date().toISOString();

  const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
  url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
  url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
  url.searchParams.set('enabled', 'eq.true');
  url.searchParams.set(doneColumn, 'is.null');
  url.searchParams.set(claimColumn, 'is.null');

  const r = await fetchWithTimeout(url, {
    method: 'PATCH',
    headers: supaHeaders(cfg, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      [claimColumn]: claimAt,
      [attemptsColumn]: Math.max(0, Number(row?.[attemptsColumn] || 0)) + 1,
      delivery_last_attempt_at: claimAt,
      delivery_last_error: null,
    }),
  }, 7000, 'Supabase reminder claim');

  if (!r.ok) throw new Error(`Supabase reminder claim: HTTP ${r.status}`);
  const rows = await r.json().catch(() => []);
  return { claimed: Array.isArray(rows) && rows.length === 1, claimAt };
}

async function finishReminderDelivery(row, kind, claimAt, cfg) {
  if (!hasSupabase(cfg)) return;
  const kickoff = kind === 'kickoff';
  const claimColumn = kickoff ? 'kickoff_claimed_at' : 'prematch_claimed_at';
  const doneColumn = kickoff ? 'kickoff_notified_at' : 'notified_at';
  const doneAt = new Date().toISOString();

  const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
  url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
  url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
  url.searchParams.set(claimColumn, `eq.${claimAt}`);

  const patch = {
    [doneColumn]: doneAt,
    [claimColumn]: null,
    delivery_last_success_at: doneAt,
    delivery_last_error: null,
    delivery_retry_after: null,
  };

  if (kickoff && !row.notified_at) patch.notified_at = doneAt;

  const r = await fetchWithTimeout(url, {
    method: 'PATCH',
    headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  }, 7000, 'Supabase reminder finish');
  if (!r.ok) throw new Error(`Supabase reminder finish: HTTP ${r.status}`);
}

async function releaseReminderClaim(row, kind, claimAt, errorMessage, cfg, options = {}) {
  if (!hasSupabase(cfg)) return;
  const claimColumn = kind === 'kickoff' ? 'kickoff_claimed_at' : 'prematch_claimed_at';

  const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
  url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
  url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
  url.searchParams.set(claimColumn, `eq.${claimAt}`);

  const patch = {
    [claimColumn]: null,
    delivery_last_error: redactOpsString(errorMessage || 'Telegram delivery failed.', 240),
    delivery_last_attempt_at: new Date().toISOString(),
    delivery_retry_after: Number(options.retryAfter || 0) > 0
      ? new Date(Date.now() + Number(options.retryAfter) * 1000).toISOString()
      : null,
  };

  if (options.disable) {
    patch.enabled = false;
    patch.delivery_disabled_reason = redactOpsString(options.disableReason || 'telegram_forbidden', 80);
  }

  const r = await fetchWithTimeout(url, {
    method: 'PATCH',
    headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  }, 7000, 'Supabase reminder release');
  if (!r.ok) throw new Error(`Supabase reminder release: HTTP ${r.status}`);
}

async function sendTelegramMessage(chatId, text, cfg) {
  if (!cfg.botToken) {
    return { ok: false, status: 0, errorCode: 0, description: 'Bot token missing.', retryAfter: 0 };
  }

  try {
    const r = await fetchWithTimeout(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(chatId), text, disable_web_page_preview: true }),
    }, 7000, 'Telegram sendMessage');

    const body = await r.json().catch(() => null);
    return {
      ok: Boolean(r.ok && body?.ok !== false),
      status: Number(r.status || 0),
      errorCode: Number(body?.error_code || 0),
      description: redactOpsString(body?.description || (r.ok ? '' : `Telegram HTTP ${r.status}`), 220),
      retryAfter: Number(body?.parameters?.retry_after || r.headers.get('retry-after') || 0),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      errorCode: 0,
      description: redactOpsString(error?.message || 'Telegram network error.', 220),
      retryAfter: 0,
    };
  }
}

async function recordReminderDelivery(cfg, { row, kind, result, success, disabled = false }) {
  const code = success
    ? (kind === 'kickoff' ? 'REMINDER_SENT_KICKOFF' : 'REMINDER_SENT_PREMATCH')
    : disabled
      ? 'REMINDER_FORBIDDEN'
      : 'REMINDER_SEND_FAILED';

  await recordOpsEvent(cfg, {
    severity: success ? 'info' : 'warning',
    source: 'reminders',
    eventType: 'reminder_delivery',
    code,
    message: success
      ? `Reminder ${kind} delivered.`
      : `Reminder ${kind} delivery failed: ${result?.description || 'unknown error'}`,
    endpoint: 'cron:reminders',
    status: Number(result?.status || 0) || null,
    meta: {
      fixtureId: Number(row?.fixture_id || 0),
      kind,
      telegramStatus: Number(result?.status || 0) || null,
      telegramErrorCode: Number(result?.errorCode || 0) || null,
      retryAfter: Number(result?.retryAfter || 0) || null,
    },
  });
}

async function deliverClaimedReminder(row, kind, text, cfg) {
  const claim = await claimReminderDelivery(row, kind, cfg);
  if (!claim.claimed) return { state: 'already_claimed' };

  const result = await sendTelegramMessage(row.telegram_id, text, cfg);

  if (result.ok) {
    await finishReminderDelivery(row, kind, claim.claimAt, cfg);
    await recordReminderDelivery(cfg, { row, kind, result, success: true }).catch(() => {});
    return { state: 'sent', result };
  }

  const forbidden = Number(result.status) === 403 || Number(result.errorCode) === 403;

  await releaseReminderClaim(
    row,
    kind,
    claim.claimAt,
    result.description || 'Telegram delivery failed.',
    cfg,
    {
      disable: forbidden,
      disableReason: forbidden ? 'telegram_forbidden' : '',
      retryAfter: Number(result.retryAfter || 0),
    },
  ).catch(() => {});

  await recordReminderDelivery(cfg, {
    row,
    kind,
    result,
    success: false,
    disabled: forbidden,
  }).catch(() => {});

  return { state: forbidden ? 'disabled' : 'failed', result };
}

async function processDueReminders(cfg) {
  if (!hasSupabase(cfg) || !cfg.botToken) {
    return { checked: 0, sent: 0, kickoffSent: 0, failed: 0, claimed: 0, staleClaims: 0 };
  }

  const runtimeState = await loadRuntimeControls(cfg);
  if (runtimeState.value?.remindersEnabled === false) {
    return { checked: 0, sent: 0, kickoffSent: 0, failed: 0, claimed: 0, staleClaims: 0, disabled: true };
  }

  const stale = await clearStaleReminderClaims(cfg).catch(() => ({ prematch: 0, kickoff: 0 }));
  const now = Date.now();
  const from = new Date(now - 8 * 60_000).toISOString();
  const toMs = now + 65 * 60_000;
  let rows = [];

  try {
    rows = await supaSelectMany(cfg, 'match_reminders', {
      enabled: 'eq.true',
      fixture_date: `gte.${from}`,
    }, { limit: 250, order: 'fixture_date.asc' });
    rows = rows.filter(x => Date.parse(x.fixture_date) <= toMs);
  } catch (e) {
    await recordOpsEvent(cfg, {
      severity: 'error',
      source: 'reminders',
      eventType: 'reminder_scheduler',
      code: 'REMINDER_SCHEDULER_READ_FAILED',
      message: e?.message || e,
      endpoint: 'cron:reminders',
    }).catch(() => {});
    return { checked: 0, sent: 0, kickoffSent: 0, failed: 1, claimed: 0, staleClaims: stale.prematch + stale.kickoff };
  }

  let sent = 0;
  let kickoffSent = 0;
  let failed = 0;
  let claimed = 0;

  for (const row of rows) {
    const kickoffMs = Date.parse(row.fixture_date);
    if (!Number.isFinite(kickoffMs)) continue;

    const retryAfterMs = Date.parse(row.delivery_retry_after || '');
    if (Number.isFinite(retryAfterMs) && retryAfterMs > now) continue;

    const deltaMinutes = (kickoffMs - now) / 60000;
    const remindBefore = [15, 30, 60].includes(Number(row.remind_before_minutes))
      ? Number(row.remind_before_minutes)
      : 30;
    const kickoffEnabled = row.kickoff_notify !== false;

    try {
      // Cron cadence is 5 minutes in v5.6. This window is deliberately wider
      // than one cron interval so a slightly delayed execution still delivers.
      if (kickoffEnabled && !row.kickoff_notified_at && deltaMinutes <= 4 && deltaMinutes >= -7) {
        const text = `🔴 Матч начинается\n\n${row.home_name} — ${row.away_name}${row.league_name ? `\n${row.league_name}` : ''}\n\nОткройте Football Manager: LIVE-центр появится, когда провайдер обновит статус.`;
        const delivery = await deliverClaimedReminder(row, 'kickoff', text, cfg);
        if (delivery.state === 'sent') kickoffSent++;
        else if (delivery.state === 'already_claimed') claimed++;
        else failed++;
        continue;
      }

      const lowerBound = kickoffEnabled ? 5 : 0;
      if (!row.notified_at && deltaMinutes >= lowerBound && deltaMinutes <= remindBefore + 2) {
        const minutes = Math.max(1, Math.round(deltaMinutes));
        const text = `⚽ Скоро матч\n\n${row.home_name} — ${row.away_name}${row.league_name ? `\n${row.league_name}` : ''}\nСтарт примерно через ${minutes} мин.\n\nОткройте Football Manager для свежего предматчевого анализа.`;
        const delivery = await deliverClaimedReminder(row, 'prematch', text, cfg);
        if (delivery.state === 'sent') sent++;
        else if (delivery.state === 'already_claimed') claimed++;
        else failed++;
      }
    } catch (e) {
      failed++;
      await recordOpsEvent(cfg, {
        severity: 'warning',
        source: 'reminders',
        eventType: 'reminder_delivery',
        code: 'REMINDER_DELIVERY_EXCEPTION',
        message: e?.message || e,
        endpoint: 'cron:reminders',
        meta: { fixtureId: Number(row.fixture_id || 0) },
      }).catch(() => {});
    }
  }

  const summary = {
    checked: rows.length,
    sent,
    kickoffSent,
    failed,
    claimed,
    staleClaims: stale.prematch + stale.kickoff,
  };

  if (sent || kickoffSent || failed || summary.staleClaims) {
    await recordOpsEvent(cfg, {
      severity: failed ? 'warning' : 'info',
      source: 'reminders',
      eventType: 'reminder_scheduler',
      code: failed ? 'REMINDER_RUN_WITH_FAILURES' : 'REMINDER_RUN_OK',
      message: `Reminder cron: checked=${rows.length}, prematch=${sent}, kickoff=${kickoffSent}, failed=${failed}.`,
      endpoint: 'cron:reminders',
      meta: summary,
    }).catch(() => {});
  }

  return summary;
}

async function probeReminderReliabilitySchema(cfg) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };

  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
    url.searchParams.set(
      'select',
      'fixture_id,prematch_claimed_at,kickoff_claimed_at,prematch_attempts,kickoff_attempts,delivery_last_error,delivery_last_attempt_at,delivery_last_success_at,delivery_disabled_reason,delivery_retry_after'
    );
    url.searchParams.set('limit', '1');
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase reminder reliability schema');
    return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
  } catch (error) {
    return { ok: false, status: error?.code || 'error' };
  }
}

async function getReminderHealth(cfg) {
  const schema = await probeReminderReliabilitySchema(cfg);
  if (!schema.ok) {
    return {
      available: false,
      migrationReady: false,
      reason: 'Нужна supabase_migration_v5_6.sql.',
      scheduler: { cadenceMinutes: 5 },
    };
  }

  const now = Date.now();
  const fromIso = new Date(now - 24 * 3600_000).toISOString();
  let rows = [];

  try {
    rows = await supaSelectMany(cfg, 'match_reminders', {
      fixture_date: `gte.${fromIso}`,
    }, { limit: 500, order: 'fixture_date.asc' });
  } catch (error) {
    return {
      available: false,
      migrationReady: true,
      reason: redactOpsString(error?.message || 'Не удалось прочитать reminders.', 180),
      scheduler: { cadenceMinutes: 5 },
    };
  }

  const active = rows.filter(x => x.enabled !== false);
  const upcoming = active.filter(x => Date.parse(x.fixture_date || '') >= now);
  const dueSoon = upcoming.filter(x => Date.parse(x.fixture_date || '') <= now + 90 * 60_000);
  const prematchSent24h = rows.filter(x => Date.parse(x.notified_at || '') >= now - 24 * 3600_000).length;
  const kickoffSent24h = rows.filter(x => Date.parse(x.kickoff_notified_at || '') >= now - 24 * 3600_000).length;

  const failed24h = rows.filter(x =>
    x.delivery_last_error &&
    Date.parse(x.delivery_last_attempt_at || '') >= now - 24 * 3600_000
  );

  const staleClaims = rows.filter(x =>
    [x.prematch_claimed_at, x.kickoff_claimed_at].some(value => {
      const t = Date.parse(value || '');
      return Number.isFinite(t) && now - t > 20 * 60_000;
    })
  );

  const activeClaims = rows.filter(x =>
    [x.prematch_claimed_at, x.kickoff_claimed_at].some(value => {
      const t = Date.parse(value || '');
      return Number.isFinite(t) && now - t <= 20 * 60_000;
    })
  );

  const recent = [...rows]
    .filter(x => x.delivery_last_attempt_at || x.delivery_last_success_at)
    .sort((a, b) =>
      Date.parse(b.delivery_last_attempt_at || b.delivery_last_success_at || 0) -
      Date.parse(a.delivery_last_attempt_at || a.delivery_last_success_at || 0)
    )
    .slice(0, 12)
    .map(x => ({
      fixtureId: Number(x.fixture_id || 0),
      match: `${x.home_name || ''} — ${x.away_name || ''}`.trim(),
      fixtureDate: x.fixture_date || null,
      state: reminderDeliveryStatus(x),
      enabled: x.enabled !== false,
      prematchAttempts: Number(x.prematch_attempts || 0),
      kickoffAttempts: Number(x.kickoff_attempts || 0),
      lastAttemptAt: x.delivery_last_attempt_at || null,
      lastSuccessAt: x.delivery_last_success_at || null,
      hasError: Boolean(x.delivery_last_error),
      disabledReason: x.delivery_disabled_reason || null,
    }));

  return {
    available: true,
    migrationReady: true,
    generatedAt: new Date().toISOString(),
    scheduler: {
      cadenceMinutes: 5,
      claimTimeoutMinutes: 20,
      nextRunMaximumDelayMinutes: 5,
    },
    summary: {
      activeUpcoming: upcoming.length,
      dueNext90Minutes: dueSoon.length,
      prematchSent24h,
      kickoffSent24h,
      failed24h: failed24h.length,
      activeClaims: activeClaims.length,
      staleClaims: staleClaims.length,
      disabled24h: rows.filter(x => x.enabled === false && x.delivery_disabled_reason).length,
    },
    recent,
    health: staleClaims.length || failed24h.length >= 3
      ? { state: 'watch', label: 'Нужен контроль доставки' }
      : { state: 'healthy', label: 'Доставка выглядит штатно' },
    note: 'Delivery claims предотвращают параллельную отправку одного уведомления. Telegram 403 отключает конкретное недоставляемое напоминание.',
  };
}

async function apiReminderHealth(request, cfg, user) {
  if (request.method === 'GET') return json(await getReminderHealth(cfg));

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    if (body?.action !== 'test') return json({ error: 'Неизвестное действие.' }, 400);

    const result = await sendTelegramMessage(
      user.id,
      `✅ Football Manager\n\nТест уведомлений v6.2 RC10 прошёл. Если вы видите это сообщение, Telegram delivery работает.`,
      cfg
    );

    await recordOpsEvent(cfg, {
      severity: result.ok ? 'info' : 'warning',
      source: 'reminders',
      eventType: 'reminder_test',
      code: result.ok ? 'REMINDER_TEST_OK' : 'REMINDER_TEST_FAILED',
      message: result.ok ? 'Admin reminder test delivered.' : `Admin reminder test failed: ${result.description || 'unknown'}`,
      endpoint: '/api/reminder-health',
      status: Number(result.status || 0) || null,
      meta: {
        telegramStatus: Number(result.status || 0) || null,
        errorCode: Number(result.errorCode || 0) || null,
      },
    }).catch(() => {});

    return json({
      ok: result.ok,
      message: result.ok ? 'Тестовое Telegram-уведомление отправлено.' : 'Telegram не принял тестовое уведомление.',
      telegramStatus: Number(result.status || 0) || null,
      retryAfter: Number(result.retryAfter || 0) || null,
    }, result.ok ? 200 : 502);
  }

  return json({ error: 'Метод не поддерживается.' }, 405);
}


function inferFootballPlan(dailyLimit) {
  const n = Number(dailyLimit || 0);
  if (n >= 150000) return 'MEGA';
  if (n >= 75000) return 'ULTRA';
  if (n >= 7500) return 'PRO';
  if (n > 0) return 'FREE';
  return 'UNKNOWN';
}

function updateProviderFromHeaders(response) {
  const readNum = name => {
    const v = response.headers.get(name);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const dailyLimit = readNum('x-ratelimit-requests-limit');
  const dailyRemaining = readNum('x-ratelimit-requests-remaining');
  const minuteLimit = readNum('x-ratelimit-limit');
  const minuteRemaining = readNum('x-ratelimit-remaining');
  memory.provider = {
    ...memory.provider,
    name: 'API-Football',
    plan: dailyLimit !== null ? inferFootballPlan(dailyLimit) : (memory.provider?.plan || 'UNKNOWN'),
    dailyLimit: dailyLimit ?? memory.provider?.dailyLimit ?? null,
    dailyRemaining: dailyRemaining ?? memory.provider?.dailyRemaining ?? null,
    minuteLimit: minuteLimit ?? memory.provider?.minuteLimit ?? null,
    minuteRemaining: minuteRemaining ?? memory.provider?.minuteRemaining ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function quotaUsed(limit, remaining) {
  if (limit === null || limit === undefined || remaining === null || remaining === undefined || limit === '' || remaining === '') return null;
  const l = Number(limit), r = Number(remaining);
  return Number.isFinite(l) && Number.isFinite(r) ? Math.max(0, l - r) : null;
}

function quotaUsedPct(limit, remaining) {
  const l = Number(limit), used = quotaUsed(limit, remaining);
  return Number.isFinite(l) && l > 0 && Number.isFinite(used) ? Math.round((used / l) * 1000) / 10 : null;
}

function providerSnapshot() {
  const paid = ['PRO','ULTRA','MEGA'].includes(memory.provider?.plan || '');
  const cooldownUntil = memory.provider?.cooldownUntil || null;
  const cooldownActive = Boolean(cooldownUntil && Date.parse(cooldownUntil) > Date.now());
  const dailyUsed = quotaUsed(memory.provider?.dailyLimit, memory.provider?.dailyRemaining);
  const minuteUsed = quotaUsed(memory.provider?.minuteLimit, memory.provider?.minuteRemaining);
  const dailyUsedPct = quotaUsedPct(memory.provider?.dailyLimit, memory.provider?.dailyRemaining);
  const minuteUsedPct = quotaUsedPct(memory.provider?.minuteLimit, memory.provider?.minuteRemaining);
  let health = 'ok';
  if ((memory.provider?.plan || 'UNKNOWN') === 'UNKNOWN' && !memory.provider?.updatedAt) health = 'waiting';
  else if (cooldownActive || memory.provider?.lastError === 'rate_limit') health = 'critical';
  else if (memory.provider?.lastError || (Number.isFinite(Number(memory.provider?.minuteRemaining)) && Number(memory.provider.minuteRemaining) <= 2) || (Number.isFinite(dailyUsedPct) && dailyUsedPct >= 90)) health = 'warning';
  return {
    visibility: 'admin',
    ...(memory.provider || {}),
    dailyUsed,
    minuteUsed,
    dailyUsedPct,
    minuteUsedPct,
    health,
    liveOddsReady: paid,
    playerStatsReady: paid,
    oddsMovementReady: paid,
    endpointAccessModel: 'all_endpoints_quota_limited',
    cooldownActive,
    cooldownUntil: cooldownActive ? cooldownUntil : null,
  };
}

function liveRefreshSeconds() {
  const plan = memory.provider?.plan || 'UNKNOWN';
  if (plan === 'MEGA' || plan === 'ULTRA') return 15;
  if (plan === 'PRO') return 30;
  return 60;
}

function paidQuotaHealthy() {
  const p = memory.provider || {};
  if (!['PRO','ULTRA','MEGA'].includes(p.plan)) return false;
  if (Number.isFinite(Number(p.dailyRemaining)) && Number(p.dailyRemaining) < 50) return false;
  if (Number.isFinite(Number(p.minuteRemaining)) && Number(p.minuteRemaining) < 5) return false;
  return true;
}


const PROVIDER_PLAN_LIMITS = Object.freeze({
  FREE: { daily: 100, minute: 10, second: null, mode: 'economy' },
  PRO: { daily: 7500, minute: 300, second: 5, mode: 'expanded' },
  ULTRA: { daily: 75000, minute: 450, second: 7.5, mode: 'expanded-fast' },
  MEGA: { daily: 150000, minute: 900, second: 15, mode: 'expanded-fast' },
});

function providerTransitionProfile() {
  const snapshot = providerSnapshot();
  const plan = String(snapshot.plan || 'UNKNOWN').toUpperCase();
  const expected = PROVIDER_PLAN_LIMITS[plan] || null;
  const paid = ['PRO','ULTRA','MEGA'].includes(plan);
  const detected = plan !== 'UNKNOWN';
  const dailyMatchesExpected = expected && Number.isFinite(Number(snapshot.dailyLimit))
    ? Number(snapshot.dailyLimit) === Number(expected.daily)
    : null;
  const minuteMatchesExpected = expected && Number.isFinite(Number(snapshot.minuteLimit))
    ? Number(snapshot.minuteLimit) === Number(expected.minute)
    : null;
  return {
    visibility: 'admin',
    detected,
    plan,
    paid,
    mode: paid ? 'expanded' : plan === 'FREE' ? 'economy' : 'waiting',
    label: paid ? 'Расширенный режим' : plan === 'FREE' ? 'Экономный режим' : 'Ожидаем определение тарифа',
    expected,
    liveRefreshSeconds: liveRefreshSeconds(),
    quotaHealthy: paid ? paidQuotaHealthy() : freeQuotaHealthy(20, 3),
    headersMatchPlan: {
      daily: dailyMatchesExpected,
      minute: minuteMatchesExpected,
    },
    safety: {
      fullCoverageAuditAllowed: Boolean(paid && paidQuotaHealthy()),
      freeAuditGuard: !paid,
      auditMaxCalls: 9,
    },
    note: paid
      ? 'Повышенная квота обнаружена по rate-limit headers. Расширенные запросы разрешены guardrails приложения.'
      : 'Полный endpoint-аудит заблокирован на FREE, чтобы не тратить заметную часть дневных 100 запросов.',
  };
}


const PROVIDER_BUDGET_FLOORS = Object.freeze({
  FREE:  { dailyReserve: 20,  minuteReserve: 3,  conserveDailyPct: 25, conserveMinutePct: 35 },
  PRO:   { dailyReserve: 400, minuteReserve: 18, conserveDailyPct: 10, conserveMinutePct: 12 },
  ULTRA: { dailyReserve: 2500, minuteReserve: 30, conserveDailyPct: 8, conserveMinutePct: 10 },
  MEGA:  { dailyReserve: 4000, minuteReserve: 45, conserveDailyPct: 7, conserveMinutePct: 9 },
});

const PROVIDER_FEATURE_TTLS = Object.freeze({
  events:      { live: 30,  finished: 21600, upcoming: 300 },
  statistics:  { live: 45,  finished: 21600, upcoming: 300 },
  players:     { live: 120, finished: 21600, upcoming: 600 },
  lineups:     { live: 300, finished: 21600, upcoming: 300 },
  injuries:    { live: 1800, finished: 21600, upcoming: 1800 },
  liveOdds:    { live: 30,  finished: 300, upcoming: 120 },
});

function providerFeatureCounter(feature, type) {
  const root = memory.providerFeatureFetch;
  root[type] = Number(root[type] || 0) + 1;
  root.byFeature ||= {};
  root.byFeature[feature] ||= { api: 0, cache: 0, stale: 0, skipped: 0 };
  root.byFeature[feature][type] = Number(root.byFeature[feature][type] || 0) + 1;
  root.lastUpdatedAt = new Date().toISOString();
}

function quotaPercentRemaining(remaining, limit) {
  const r = Number(remaining), l = Number(limit);
  if (!Number.isFinite(r) || !Number.isFinite(l) || l <= 0) return null;
  return clamp(r / l * 100, 0, 100);
}

function providerBudgetProfile() {
  const p = memory.provider || {};
  const plan = String(p.plan || 'UNKNOWN').toUpperCase();
  const floors = PROVIDER_BUDGET_FLOORS[plan] || PROVIDER_BUDGET_FLOORS.FREE;
  const dailyPct = quotaPercentRemaining(p.dailyRemaining, p.dailyLimit);
  const minutePct = quotaPercentRemaining(p.minuteRemaining, p.minuteLimit);
  const dailyRemaining = Number.isFinite(Number(p.dailyRemaining)) ? Number(p.dailyRemaining) : null;
  const minuteRemaining = Number.isFinite(Number(p.minuteRemaining)) ? Number(p.minuteRemaining) : null;
  const cooldown = providerSnapshot().cooldownActive;
  const paid = ['PRO','ULTRA','MEGA'].includes(plan);

  let mode = paid ? 'expanded' : 'economy';
  if (plan === 'UNKNOWN') mode = 'waiting';
  if (cooldown) mode = 'emergency';
  else if (
    (dailyRemaining !== null && dailyRemaining <= floors.dailyReserve) ||
    (minuteRemaining !== null && minuteRemaining <= floors.minuteReserve)
  ) mode = 'emergency';
  else if (
    (dailyPct !== null && dailyPct <= floors.conserveDailyPct) ||
    (minutePct !== null && minutePct <= floors.conserveMinutePct)
  ) mode = 'conserve';

  const label = ({
    waiting: 'Ожидаем квоту',
    economy: 'Экономный режим',
    expanded: 'Расширенный режим',
    conserve: 'Режим экономии',
    emergency: 'Защитный резерв',
  })[mode] || mode;

  return {
    visibility: 'admin',
    plan,
    paid,
    mode,
    label,
    daily: {
      limit: Number.isFinite(Number(p.dailyLimit)) ? Number(p.dailyLimit) : null,
      remaining: dailyRemaining,
      remainingPct: dailyPct === null ? null : Math.round(dailyPct * 10) / 10,
      reserve: floors.dailyReserve,
    },
    minute: {
      limit: Number.isFinite(Number(p.minuteLimit)) ? Number(p.minuteLimit) : null,
      remaining: minuteRemaining,
      remainingPct: minutePct === null ? null : Math.round(minutePct * 10) / 10,
      reserve: floors.minuteReserve,
    },
    dailyRemainingPct: dailyPct === null ? null : Math.round(dailyPct * 10) / 10,
    liveRefreshSeconds: mode === 'conserve' ? Math.max(60, liveRefreshSeconds()) : mode === 'emergency' ? 90 : liveRefreshSeconds(),
    counters: {
      api: Number(memory.providerFeatureFetch?.api || 0),
      cache: Number(memory.providerFeatureFetch?.cache || 0),
      stale: Number(memory.providerFeatureFetch?.stale || 0),
      skipped: Number(memory.providerFeatureFetch?.skipped || 0),
      byFeature: memory.providerFeatureFetch?.byFeature || {},
      lastUpdatedAt: memory.providerFeatureFetch?.lastUpdatedAt || null,
    },
    note: mode === 'emergency'
      ? 'Дополнительные enrichment-запросы блокируются, пока квота не восстановится.'
      : mode === 'conserve'
        ? 'Часть enrichment-запросов замедлена или пропускается, чтобы сохранить резерв.'
        : paid
          ? 'Квота здорова: расширенные данные разрешены с feature-level cache.'
          : 'FREE работает в экономном режиме с приоритетом основных данных матча.',
  };
}

function providerPublicBudgetMode() {
  const budget = providerBudgetProfile();
  return {
    mode: budget.mode,
    label: budget.mode === 'expanded'
      ? 'Расширенное покрытие'
      : budget.mode === 'conserve'
        ? 'Сберегающий режим'
        : budget.mode === 'emergency'
          ? 'Ограниченное обновление'
          : 'Стандартное покрытие',
    liveRefreshSeconds: budget.liveRefreshSeconds,
  };
}

function providerFeaturePolicy(feature, context = {}) {
  const budget = providerBudgetProfile();
  const runtime = runtimeControlsSnapshot();
  const mode = context.mode || 'live';
  const paid = budget.paid;
  const limitedCoverage = Boolean(context.limitedCoverage);
  const featureTtl = PROVIDER_FEATURE_TTLS[feature] || { live: 60, finished: 3600, upcoming: 300 };
  let ttlSeconds = Number(featureTtl[mode] || featureTtl.live || 60);
  let allowed = true;
  let reason = '';

  if (limitedCoverage && ['events','statistics','players','lineups','injuries','liveOdds'].includes(feature)) {
    allowed = false;
    reason = 'limited_coverage';
  }

  if (runtime.expandedDataEnabled === false && ['players','lineups','injuries','liveOdds'].includes(feature)) {
    allowed = false;
    reason = 'runtime_disabled';
  }

  if (runtime.liveEnabled === false && feature === 'liveOdds') {
    allowed = false;
    reason = 'live_disabled';
  }

  if (['players','lineups','injuries','liveOdds'].includes(feature) && !paid) {
    allowed = false;
    reason = 'economy_plan';
  }

  if (budget.mode === 'emergency' && !['events','statistics'].includes(feature)) {
    allowed = false;
    reason = 'quota_reserve';
  }

  if (budget.mode === 'conserve') {
    ttlSeconds = Math.max(ttlSeconds, feature === 'events' ? 45 : feature === 'statistics' ? 75 : 300);
    if (['players','injuries','liveOdds'].includes(feature)) {
      allowed = false;
      reason = 'conserve_mode';
    }
  }

  if (mode === 'finished') ttlSeconds = Math.max(ttlSeconds, 21600);
  if (mode === 'upcoming' && feature === 'liveOdds') {
    allowed = false;
    reason = 'not_live';
  }

  return {
    feature,
    allowed,
    reason,
    ttlSeconds,
    budgetMode: budget.mode,
    priority: ['events','statistics'].includes(feature) ? 'core' : ['lineups','players'].includes(feature) ? 'enhanced' : 'optional',
  };
}

function featureCacheAgeSeconds(payload) {
  const t = Date.parse(payload?.fetchedAt || '');
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 1000)) : null;
}

async function providerFeatureFetch({ feature, path, params, fixtureId, cfg, context = {} }) {
  const policy = providerFeaturePolicy(feature, context);
  const cacheKey = `provider-feature:${feature}:${Number(fixtureId || 0)}:v4.9`;
  const freshEntry = await getCacheEntry(cacheKey, cfg, false).catch(() => null);
  if (freshEntry?.payload) {
    providerFeatureCounter(feature, 'cache');
    return {
      data: freshEntry.payload.data ?? [],
      meta: {
        feature,
        source: 'cache',
        fetchedAt: freshEntry.payload.fetchedAt || null,
        ageSeconds: featureCacheAgeSeconds(freshEntry.payload),
        expiresAt: freshEntry.expiresAt || null,
        policy,
      },
    };
  }

  const staleEntry = await getCacheEntry(cacheKey, cfg, true).catch(() => null);

  if (!policy.allowed) {
    providerFeatureCounter(feature, 'skipped');
    if (staleEntry?.payload) {
      providerFeatureCounter(feature, 'stale');
      return {
        data: staleEntry.payload.data ?? [],
        meta: {
          feature,
          source: 'stale',
          fetchedAt: staleEntry.payload.fetchedAt || null,
          ageSeconds: featureCacheAgeSeconds(staleEntry.payload),
          expiresAt: staleEntry.expiresAt || null,
          policy,
          reason: policy.reason,
        },
      };
    }
    return {
      data: [],
      meta: {
        feature,
        source: 'skipped',
        fetchedAt: null,
        ageSeconds: null,
        expiresAt: null,
        policy,
        reason: policy.reason,
      },
    };
  }

  try {
    const data = await apiFootball(path, params, cfg);
    const wrapped = { data, fetchedAt: new Date().toISOString() };
    await setCache(cacheKey, fixtureId, wrapped, cfg, policy.ttlSeconds / 60).catch(() => null);
    providerFeatureCounter(feature, 'api');
    return {
      data,
      meta: {
        feature,
        source: 'api',
        fetchedAt: wrapped.fetchedAt,
        ageSeconds: 0,
        expiresAt: new Date(Date.now() + policy.ttlSeconds * 1000).toISOString(),
        policy,
      },
    };
  } catch (error) {
    if (staleEntry?.payload) {
      providerFeatureCounter(feature, 'stale');
      return {
        data: staleEntry.payload.data ?? [],
        meta: {
          feature,
          source: 'stale',
          fetchedAt: staleEntry.payload.fetchedAt || null,
          ageSeconds: featureCacheAgeSeconds(staleEntry.payload),
          expiresAt: staleEntry.expiresAt || null,
          policy,
          reason: String(error?.code || 'api_error'),
        },
      };
    }
    providerFeatureCounter(feature, 'skipped');
    return {
      data: [],
      meta: {
        feature,
        source: 'error',
        fetchedAt: null,
        ageSeconds: null,
        expiresAt: null,
        policy,
        reason: String(error?.code || 'api_error'),
      },
    };
  }
}


function providerValidationStep(key, label, state, note, meta = {}) {
  return { key, label, state, note, meta };
}

function providerValidationStatus(steps = []) {
  const blocking = steps.filter(x => x.state === 'fail');
  const holds = steps.filter(x => x.state === 'hold');
  const warnings = steps.filter(x => x.state === 'warn');
  if (blocking.length) return { code: 'NEEDS_ATTENTION', label: 'Нужна проверка', ready: false };
  if (holds.length) return { code: 'HOLD', label: 'Ожидает расширенный тариф', ready: false };
  if (warnings.length) return { code: 'READY_WITH_LIMITATIONS', label: 'Готово с ограничениями', ready: true };
  return { code: 'READY', label: 'Готово к расширенному режиму', ready: true };
}

function providerFeatureSourcesSummary(dataFreshness = {}) {
  const summary = { api: 0, cache: 0, embedded: 0, stale: 0, skipped: 0, error: 0, other: 0 };
  for (const meta of Object.values(dataFreshness || {})) {
    const source = String(meta?.source || 'other');
    if (source in summary) summary[source] += 1;
    else summary.other += 1;
  }
  return summary;
}

async function responseJsonSafe(response) {
  try { return await response.json(); } catch { return null; }
}

async function loadLastProviderE2E(cfg) {
  if (memory.providerE2E?.last) return memory.providerE2E.last;
  const cached = await getCache('provider-e2e:last:v5.0', cfg).catch(() => null);
  if (cached) memory.providerE2E.last = cached;
  return cached || null;
}

async function saveProviderE2E(result, fixtureId, cfg) {
  memory.providerE2E.last = result;
  await setCache('provider-e2e:last:v5.0', Number(fixtureId || 0), result, cfg, 1440).catch(() => null);
}

async function apiProviderE2EValidation(request, cfg) {
  const url = new URL(request.url);
  const fixtureId = Number(url.searchParams.get('fixtureId') || 0);
  if (!fixtureId) return json({ error: 'Укажите fixtureId для E2E validation.' }, 400);

  const startedAt = Date.now();
  const steps = [];
  const before = providerSnapshot();

  // Step 1: refresh real provider headers. One request even on FREE.
  let probeOk = false;
  try {
    await apiFootball('/status', {}, cfg, { responseType: 'any' });
    probeOk = true;
  } catch (error) {
    steps.push(providerValidationStep(
      'provider_probe',
      'Связь с API-Football',
      'fail',
      redactOpsString(error?.message || 'Provider status недоступен.', 180),
    ));
  }

  const transition = providerTransitionProfile();
  const budget = providerBudgetProfile();
  const afterProbe = providerSnapshot();

  if (probeOk) {
    steps.push(providerValidationStep(
      'provider_probe',
      'Связь с API-Football',
      'pass',
      `Provider отвечает. Определён тариф ${transition.plan}.`,
      { plan: transition.plan },
    ));
  }

  steps.push(providerValidationStep(
    'paid_plan',
    'Расширенная квота',
    transition.paid ? 'pass' : 'hold',
    transition.paid
      ? `${transition.plan}: расширенный режим доступен.`
      : `${transition.plan}: код v5.0 готов, но полный E2E намеренно не запускается на FREE.`,
    { plan: transition.plan, paid: transition.paid },
  ));

  steps.push(providerValidationStep(
    'quota_budget',
    'Защитный резерв квоты',
    budget.mode === 'emergency' ? 'fail' : budget.mode === 'conserve' ? 'warn' : transition.paid ? 'pass' : 'hold',
    `${budget.label}. Daily: ${budget.daily?.remaining ?? '—'} / ${budget.daily?.limit ?? '—'}, minute: ${budget.minute?.remaining ?? '—'} / ${budget.minute?.limit ?? '—'}.`,
    { mode: budget.mode },
  ));

  steps.push(providerValidationStep(
    'monetization',
    'Оплата пользователей',
    cfg.monetizationEnabled ? 'fail' : 'pass',
    cfg.monetizationEnabled
      ? 'MONETIZATION_ENABLED включён — для текущего этапа это преждевременно.'
      : 'Монетизация остаётся paused, как запланировано.',
  ));

  // Important: FREE / reserve modes stop here. No audit or Match Center burst.
  if (!transition.paid || budget.mode === 'emergency') {
    const status = providerValidationStatus(steps);
    const result = {
      version: '5.0',
      generatedAt: new Date().toISOString(),
      fixtureId,
      blocked: true,
      reason: !transition.paid ? 'paid_plan_required' : 'quota_reserve',
      status,
      steps,
      provider: afterProbe,
      transition,
      budget,
      coverageAudit: null,
      matchCenter: null,
      cacheVerification: null,
      requestCost: {
        estimated: 1,
        observedDailyDelta: Number.isFinite(Number(before.dailyRemaining)) && Number.isFinite(Number(afterProbe.dailyRemaining))
          ? Math.max(0, Number(before.dailyRemaining) - Number(afterProbe.dailyRemaining))
          : null,
      },
      durationMs: Date.now() - startedAt,
      note: !transition.paid
        ? 'На FREE выполнен только /status. Полный E2E будет доступен сразу после обнаружения повышенной квоты.'
        : 'E2E остановлен защитным резервом квоты.',
    };
    await saveProviderE2E(result, fixtureId, cfg);
    await recordOpsEvent(cfg, {
      severity: 'info',
      source: 'provider',
      eventType: 'expanded_data_e2e',
      code: 'E2E_HOLD',
      message: result.note,
      meta: { fixtureId, plan: transition.plan, mode: budget.mode, status: status.code },
    }).catch(() => {});
    return json(result);
  }

  if (budget.mode === 'conserve') {
    steps.push(providerValidationStep(
      'e2e_execution',
      'Полный E2E запуск',
      'warn',
      'Quota Orchestrator находится в conserve. Проверка продолжится, но результат помечается ограниченным.',
    ));
  }

  // Step 2: real endpoint coverage. Reuse recent cached audit when available.
  let audit = null;
  try {
    const auditResponse = await apiProviderCoverageAudit(
      new Request(`https://internal/api/provider/coverage-audit?fixtureId=${fixtureId}`),
      cfg
    );
    audit = await responseJsonSafe(auditResponse);
  } catch (error) {
    audit = { error: error?.message || String(error), summary: { errors: 1, score: 0 } };
  }

  if (audit?.blocked) {
    steps.push(providerValidationStep(
      'coverage_audit',
      'Endpoint Coverage Audit',
      'hold',
      audit.note || 'Coverage Audit остановлен guardrail.',
    ));
  } else if (audit?.summary) {
    const errors = Number(audit.summary.errors || 0);
    const score = Number(audit.summary.score || 0);
    const state = errors > 1 || score < 45 ? 'fail' : errors > 0 || score < 75 ? 'warn' : 'pass';
    steps.push(providerValidationStep(
      'coverage_audit',
      'Endpoint Coverage Audit',
      state,
      `${audit.summary.label || 'Coverage'} · ${score}% · ошибок ${errors}.`,
      { score, errors, available: Number(audit.summary.available || 0), empty: Number(audit.summary.empty || 0) },
    ));
  } else {
    steps.push(providerValidationStep(
      'coverage_audit',
      'Endpoint Coverage Audit',
      'fail',
      audit?.error || 'Coverage Audit не вернул результат.',
    ));
  }

  // Step 3: actual product path. First call may populate cache, second must reuse Match Center cache.
  let firstCenter = null;
  let secondCenter = null;
  let firstMs = null;
  let secondMs = null;
  try {
    const firstStarted = Date.now();
    const firstResponse = await apiMatchCenter(
      new Request(`https://internal/api/match-center?fixtureId=${fixtureId}`),
      cfg
    );
    firstMs = Date.now() - firstStarted;
    firstCenter = await responseJsonSafe(firstResponse);

    const secondStarted = Date.now();
    const secondResponse = await apiMatchCenter(
      new Request(`https://internal/api/match-center?fixtureId=${fixtureId}`),
      cfg
    );
    secondMs = Date.now() - secondStarted;
    secondCenter = await responseJsonSafe(secondResponse);
  } catch (error) {
    firstCenter = { error: error?.message || String(error) };
  }

  const matchCenterOk = Boolean(
    firstCenter?.match?.fixtureId === fixtureId &&
    firstCenter?.match?.home?.name &&
    firstCenter?.match?.away?.name &&
    firstCenter?.mode
  );
  steps.push(providerValidationStep(
    'match_center',
    'Match Center end-to-end',
    matchCenterOk ? 'pass' : 'fail',
    matchCenterOk
      ? `${firstCenter.match.home.name} — ${firstCenter.match.away.name}; mode=${firstCenter.mode}; первый ответ ${firstMs} мс.`
      : (firstCenter?.error || 'Match Center не вернул корректный payload.'),
    { firstMs, mode: firstCenter?.mode || null },
  ));

  const cacheOk = Boolean(secondCenter?.cached);
  steps.push(providerValidationStep(
    'cache_reuse',
    'Повторный запрос без лишнего API',
    cacheOk ? 'pass' : 'warn',
    cacheOk
      ? `Второй Match Center обслужен общим cache за ${secondMs} мс.`
      : 'Второй ответ не был помечен cached — стоит проверить общий cache.',
    { secondMs, cached: cacheOk },
  ));

  const sources = providerFeatureSourcesSummary(firstCenter?.dataFreshness || {});
  const featureCount = Object.values(sources).reduce((sum, value) => sum + Number(value || 0), 0);
  steps.push(providerValidationStep(
    'feature_pipeline',
    'Expanded feature pipeline',
    !matchCenterOk ? 'fail' : sources.error > 0 ? 'warn' : featureCount > 0 ? 'pass' : 'warn',
    featureCount
      ? `Источники: API ${sources.api}, cache ${sources.cache}, fixture ${sources.embedded}, stale ${sources.stale}, skip ${sources.skipped}, error ${sources.error}.`
      : 'Матч не потребовал feature-level enrichment или данные не были доступны.',
    sources,
  ));

  const after = providerSnapshot();
  const budgetAfter = providerBudgetProfile();
  const observedDailyDelta =
    Number.isFinite(Number(before.dailyRemaining)) && Number.isFinite(Number(after.dailyRemaining))
      ? Math.max(0, Number(before.dailyRemaining) - Number(after.dailyRemaining))
      : null;

  steps.push(providerValidationStep(
    'post_run_quota',
    'Квота после теста',
    budgetAfter.mode === 'emergency' ? 'fail' : budgetAfter.mode === 'conserve' ? 'warn' : 'pass',
    `${budgetAfter.label}. Остаток daily ${budgetAfter.daily?.remaining ?? '—'}, minute ${budgetAfter.minute?.remaining ?? '—'}.`,
    { mode: budgetAfter.mode },
  ));

  const status = providerValidationStatus(steps);
  const result = {
    version: '5.0',
    generatedAt: new Date().toISOString(),
    fixtureId,
    blocked: false,
    status,
    steps,
    provider: after,
    transition: providerTransitionProfile(),
    budget: budgetAfter,
    coverageAudit: audit ? {
      blocked: Boolean(audit.blocked),
      fixture: audit.fixture || null,
      summary: audit.summary || null,
      cost: audit.cost || null,
      endpoints: (audit.endpoints || []).map(x => ({
        key: x.key, label: x.label, state: x.state, results: x.results ?? null,
        latencyMs: x.latencyMs ?? null, note: x.note || '',
      })),
    } : null,
    matchCenter: matchCenterOk ? {
      fixture: firstCenter.match,
      mode: firstCenter.mode,
      availability: firstCenter.availability || {},
      quotaMode: firstCenter.quotaMode || null,
      dataFreshness: firstCenter.dataFreshness || {},
      firstResponseMs: firstMs,
    } : { error: firstCenter?.error || 'invalid_payload', firstResponseMs: firstMs },
    cacheVerification: {
      cached: cacheOk,
      secondResponseMs: secondMs,
    },
    requestCost: {
      estimatedMax: 16,
      observedDailyDelta,
      note: 'Observed delta берётся из rate-limit headers и может быть недоступна, если провайдер не прислал оба значения.',
    },
    durationMs: Date.now() - startedAt,
    note: status.ready
      ? 'Кодовая часть expanded-data path прошла release gate. Это не включает пользовательскую монетизацию.'
      : 'Release gate нашёл пункт, который нужно проверить до полноценного expanded режима.',
  };

  await saveProviderE2E(result, fixtureId, cfg);
  await recordOpsEvent(cfg, {
    severity: status.code === 'NEEDS_ATTENTION' ? 'warning' : 'info',
    source: 'provider',
    eventType: 'expanded_data_e2e',
    code: `E2E_${status.code}`,
    message: result.note,
    meta: {
      fixtureId,
      plan: result.transition?.plan || 'UNKNOWN',
      status: status.code,
      coverageScore: result.coverageAudit?.summary?.score ?? null,
      cacheReuse: cacheOk,
      observedDailyDelta,
      durationMs: result.durationMs,
    },
  }).catch(() => {});
  return json(result);
}

async function apiProviderBudget(request, cfg) {
  return json({
    provider: providerSnapshot(),
    budget: providerBudgetProfile(),
    transition: providerTransitionProfile(),
    featureTtls: PROVIDER_FEATURE_TTLS,
  });
}

function providerEndpointLabel(key) {
  return ({
    fixture: 'Fixture bundle',
    events: 'Events',
    statistics: 'Match statistics',
    lineups: 'Lineups',
    players: 'Player statistics',
    injuries: 'Injuries',
    predictions: 'Predictions',
    odds: 'Pre-match odds',
    liveOdds: 'Live odds',
  })[key] || key;
}

function providerAuditEndpointPlan(fixture) {
  const status = String(fixture?.fixture?.status?.short || '').toUpperCase();
  const live = isLiveStatus(status);
  const finished = isFinishedStatus(status);
  const kickoffMs = Date.parse(fixture?.fixture?.date || '');
  const minsToKickoff = Number.isFinite(kickoffMs) ? Math.round((kickoffMs - Date.now()) / 60000) : null;
  const lineupsExpected = live || finished || (minsToKickoff !== null && minsToKickoff <= 120);
  return [
    { key: 'events', path: '/fixtures/events', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: live || finished, expectedData: live || finished },
    { key: 'statistics', path: '/fixtures/statistics', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: live || finished, expectedData: live || finished },
    { key: 'lineups', path: '/fixtures/lineups', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: lineupsExpected, expectedData: lineupsExpected },
    { key: 'players', path: '/fixtures/players', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: live || finished, expectedData: live || finished },
    { key: 'injuries', path: '/injuries', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: !finished, expectedData: false },
    { key: 'predictions', path: '/predictions', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: !finished, expectedData: !finished },
    { key: 'odds', path: '/odds', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: !live && !finished, expectedData: false },
    { key: 'liveOdds', path: '/odds/live', params: { fixture: Number(fixture?.fixture?.id || 0) }, applicable: live, expectedData: false },
  ];
}

async function providerAuditCall(item, cfg) {
  if (!item.applicable) {
    return {
      key: item.key,
      label: providerEndpointLabel(item.key),
      state: 'not_applicable',
      results: null,
      latencyMs: null,
      note: 'Не применяется к текущему статусу матча.',
    };
  }
  const startedAt = Date.now();
  try {
    const data = await apiFootball(item.path, item.params, cfg);
    const results = Array.isArray(data) ? data.length : (data ? 1 : 0);
    const state = results > 0 ? 'available' : 'empty';
    return {
      key: item.key,
      label: providerEndpointLabel(item.key),
      state,
      results,
      latencyMs: Date.now() - startedAt,
      note: results > 0
        ? 'Данные возвращены.'
        : item.expectedData
          ? 'Endpoint ответил без данных. Для этого матча покрытие может быть неполным.'
          : 'Пустой ответ допустим для этого endpoint/матча.',
    };
  } catch (error) {
    return {
      key: item.key,
      label: providerEndpointLabel(item.key),
      state: 'error',
      results: null,
      latencyMs: Date.now() - startedAt,
      code: String(error?.code || 'ERROR'),
      note: redactOpsString(error?.message || 'Ошибка endpoint.', 160),
    };
  }
}

function providerAuditScore(endpoints) {
  const relevant = (endpoints || []).filter(x => x.state !== 'not_applicable');
  if (!relevant.length) return 0;
  const points = relevant.reduce((sum, x) => {
    if (x.state === 'available') return sum + 1;
    if (x.state === 'empty') return sum + 0.6;
    return sum;
  }, 0);
  return Math.round(points / relevant.length * 100);
}

async function apiProviderProbe(request, cfg) {
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  if (!force && memory.provider?.updatedAt && Date.now() - Date.parse(memory.provider.updatedAt) < 30000) {
    return json({
      provider: providerSnapshot(),
      transition: providerTransitionProfile(),
      cached: true,
    });
  }

  // /status is deliberately admin-only and called only on explicit request.
  // We use it to refresh subscription/quota headers without exposing account data.
  let statusOk = false;
  let statusNote = '';
  try {
    await apiFootball('/status', {}, cfg, { responseType: 'any' });
    statusOk = true;
    statusNote = 'Тариф и квоты обновлены через /status.';
  } catch (error) {
    statusNote = redactOpsString(error?.message || 'Не удалось обновить provider status.', 160);
  }

  return json({
    provider: providerSnapshot(),
    transition: providerTransitionProfile(),
    probe: { ok: statusOk, note: statusNote, costRequests: 1 },
    cached: false,
  });
}

async function apiProviderCoverageAudit(request, cfg) {
  const url = new URL(request.url);
  const fixtureId = Number(url.searchParams.get('fixtureId') || 0);
  const force = url.searchParams.get('refresh') === '1';
  if (!fixtureId) return json({ error: 'Укажите fixtureId для Coverage Audit.' }, 400);

  const cacheKey = `provider-coverage-audit:${fixtureId}:v4.8`;
  if (!force) {
    const cached = await getCache(cacheKey, cfg).catch(() => null);
    if (cached) return json({ ...cached, cached: true });
  }

  const startedAt = Date.now();
  let fixture = null;
  try {
    fixture = (await apiFootball('/fixtures', { id: fixtureId }, cfg))[0] || null;
  } catch (error) {
    return json({
      error: error?.message || 'Не удалось загрузить fixture для аудита.',
      code: error?.code || 'AUDIT_FIXTURE',
      provider: providerSnapshot(),
      transition: providerTransitionProfile(),
    }, isFootballRateLimitError(error) ? 429 : 502);
  }
  if (!fixture) return json({ error: 'Fixture не найден у API-Football.' }, 404);

  const transition = providerTransitionProfile();
  const status = String(fixture.fixture?.status?.short || '').toUpperCase();
  const fixtureSummary = {
    fixtureId,
    date: fixture.fixture?.date || '',
    status,
    league: fixture.league?.name || '',
    home: fixture.teams?.home?.name || '',
    away: fixture.teams?.away?.name || '',
  };
  const plan = providerAuditEndpointPlan(fixture);

  if (!transition.paid || !transition.safety.fullCoverageAuditAllowed) {
    const preview = {
      available: true,
      blocked: true,
      reason: transition.paid ? 'quota_guard' : 'paid_plan_required',
      generatedAt: new Date().toISOString(),
      fixture: fixtureSummary,
      provider: providerSnapshot(),
      transition,
      cost: { usedNow: 1, maxFullAudit: 1 + plan.filter(x => x.applicable).length },
      endpoints: plan.map(x => ({
        key: x.key,
        label: providerEndpointLabel(x.key),
        state: x.applicable ? 'preview' : 'not_applicable',
        note: x.applicable ? 'Будет проверен после активации расширенного режима.' : 'Не применяется к текущему статусу матча.',
      })),
      note: transition.paid
        ? 'Полный аудит не запущен: quota guard считает остаток лимита недостаточным.'
        : 'На FREE выполнен только fixture-запрос. Полный аудит намеренно не тратит оставшиеся запросы.',
    };
    memory.providerAudit.last = preview;
    memory.providerAudit.byFixture.set(fixtureId, preview);
    return json(preview);
  }

  const results = [];
  for (const item of plan) {
    results.push(await providerAuditCall(item, cfg));
    // Conservative pacing for PRO and shared Worker bursts.
    if (item.applicable) await new Promise(resolve => setTimeout(resolve, 230));
  }

  const relevant = results.filter(x => x.state !== 'not_applicable');
  const errors = relevant.filter(x => x.state === 'error').length;
  const available = relevant.filter(x => x.state === 'available').length;
  const empty = relevant.filter(x => x.state === 'empty').length;
  const score = providerAuditScore(results);
  const audit = {
    available: true,
    blocked: false,
    generatedAt: new Date().toISOString(),
    fixture: fixtureSummary,
    provider: providerSnapshot(),
    transition: providerTransitionProfile(),
    cost: {
      usedNow: 1 + plan.filter(x => x.applicable).length,
      maxFullAudit: 1 + plan.filter(x => x.applicable).length,
    },
    summary: {
      score,
      label: errors ? 'Есть ошибки endpoint' : score >= 80 ? 'Покрытие хорошее' : score >= 55 ? 'Покрытие частичное' : 'Покрытие ограниченное',
      checked: relevant.length,
      available,
      empty,
      errors,
    },
    endpoints: results,
    durationMs: Date.now() - startedAt,
    note: 'Пустой ответ не всегда означает проблему: lineups, odds, injuries и live odds зависят от турнира, статуса и момента времени.',
  };

  memory.providerAudit.last = audit;
  memory.providerAudit.byFixture.set(fixtureId, audit);
  await setCache(cacheKey, fixtureId, audit, cfg, 15).catch(() => null);
  return json(audit);
}

function footballError(message, code = 'FOOTBALL_API', retryAfter = 0) {
  const error = new Error(message);
  error.code = code;
  error.retryAfter = Math.max(0, Number(retryAfter || 0));
  return error;
}

function isFootballRateLimitError(error) {
  return ['FOOTBALL_RATE_LIMIT', 'FOOTBALL_COOLDOWN'].includes(String(error?.code || ''))
    || /too many requests|rate.?limit|requests per minute|лимит запросов/i.test(String(error?.message || ''));
}

function footballCooldownRemaining() {
  const until = Date.parse(memory.provider?.cooldownUntil || '');
  return Number.isFinite(until) ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
}

function freeQuotaHealthy(minDaily = 25, minMinute = 5) {
  const p = memory.provider || {};
  if (['PRO','ULTRA','MEGA'].includes(p.plan)) return true;
  if (Number.isFinite(Number(p.dailyRemaining)) && Number(p.dailyRemaining) < minDaily) return false;
  if (Number.isFinite(Number(p.minuteRemaining)) && Number(p.minuteRemaining) < minMinute) return false;
  return !providerSnapshot().cooldownActive;
}

async function apiFootballNetwork(path, params, cfg, options = {}) {
  if (!cfg.apiFootballKey) {
    await recordOpsEvent(cfg, { severity: 'critical', source: 'provider', eventType: 'configuration', code: 'FOOTBALL_CONFIG', message: 'API_FOOTBALL_KEY отсутствует.' });
    throw footballError('API_FOOTBALL_KEY не настроен в Cloudflare.', 'FOOTBALL_CONFIG');
  }

  const cooldown = footballCooldownRemaining();
  if (cooldown > 0) {
    bumpTelemetry('quotaBlocks');
    throw footballError(`API-Football на паузе после ограничения. Повторите примерно через ${cooldown} сек.`, 'FOOTBALL_COOLDOWN', cooldown);
  }
  if (Number(memory.provider?.minuteRemaining) === 0 && memory.provider?.updatedAt) {
    const ageSec = Math.max(0, Math.floor((Date.now() - Date.parse(memory.provider.updatedAt)) / 1000));
    const waitSec = Math.max(1, 60 - ageSec);
    if (waitSec > 0 && ageSec < 60) {
      memory.provider.cooldownUntil = new Date(Date.now() + waitSec * 1000).toISOString();
      bumpTelemetry('quotaBlocks');
      throw footballError(`Минутная квота API-Football исчерпана. Повторите примерно через ${waitSec} сек.`, 'FOOTBALL_COOLDOWN', waitSec);
    }
  }

  const url = new URL(`https://v3.football.api-sports.io${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const startedAt = Date.now();
  bumpTelemetry('apiRequests');
  memory.provider.lastRequestAt = new Date(startedAt).toISOString();
  let r;
  try {
    r = await fetchWithTimeout(url, {
      headers: { 'x-apisports-key': cfg.apiFootballKey, Accept: 'application/json' },
    }, Number(options.timeoutMs || 10000), 'API-Football');
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    bumpTelemetry('apiErrors');
    memory.provider.lastStatus = null;
    memory.provider.lastLatencyMs = durationMs;
    memory.provider.lastError = 'network_error';
    await recordOpsEvent(cfg, {
      severity: 'error', source: 'provider', eventType: 'api_request', code: 'FOOTBALL_NETWORK',
      message: error?.message || 'Network error', endpoint: path, durationMs,
    });
    throw footballError('Не удалось подключиться к API-Football.', 'FOOTBALL_NETWORK');
  }

  const durationMs = Date.now() - startedAt;
  updateProviderFromHeaders(r);
  memory.provider.lastStatus = r.status;
  memory.provider.lastLatencyMs = durationMs;
  const body = await r.json().catch(() => ({}));

  if (r.status === 429) {
    const retryHeader = Number(r.headers.get('retry-after') || 0);
    const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 65;
    memory.provider.cooldownUntil = new Date(Date.now() + retryAfter * 1000).toISOString();
    memory.provider.lastError = 'rate_limit';
    bumpTelemetry('apiErrors');
    bumpTelemetry('rateLimits');
    await recordOpsEvent(cfg, {
      severity: 'warning', source: 'provider', eventType: 'rate_limit', code: 'FOOTBALL_RATE_LIMIT',
      message: `API-Football HTTP 429; retry ${retryAfter}s`, endpoint: path, status: r.status, durationMs,
      meta: { retryAfter, plan: memory.provider?.plan || 'UNKNOWN', minuteRemaining: memory.provider?.minuteRemaining, dailyRemaining: memory.provider?.dailyRemaining },
    });
    throw footballError(`API-Football достиг минутного лимита. Повторите примерно через ${retryAfter} сек.`, 'FOOTBALL_RATE_LIMIT', retryAfter);
  }
  if (!r.ok) {
    memory.provider.lastError = `http_${r.status}`;
    bumpTelemetry('apiErrors');
    await recordOpsEvent(cfg, {
      severity: r.status >= 500 ? 'error' : 'warning', source: 'provider', eventType: 'api_request', code: 'FOOTBALL_HTTP',
      message: `API-Football HTTP ${r.status}`, endpoint: path, status: r.status, durationMs,
    });
    throw footballError(`API-Football временно недоступен (HTTP ${r.status}).`, 'FOOTBALL_HTTP');
  }

  const errors = body?.errors && typeof body.errors === 'object' ? Object.values(body.errors).filter(Boolean) : [];
  if (errors.length) {
    const message = errors.join('; ');
    memory.provider.lastError = message.slice(0, 160);
    bumpTelemetry('apiErrors');
    if (/too many requests|rate.?limit|requests per minute/i.test(message)) {
      memory.provider.cooldownUntil = new Date(Date.now() + 65_000).toISOString();
      bumpTelemetry('rateLimits');
      await recordOpsEvent(cfg, {
        severity: 'warning', source: 'provider', eventType: 'rate_limit', code: 'FOOTBALL_RATE_LIMIT_BODY',
        message, endpoint: path, status: r.status, durationMs,
      });
      throw footballError('API-Football достиг лимита запросов. Покажем кэш, если он есть.', 'FOOTBALL_RATE_LIMIT', 65);
    }
    await recordOpsEvent(cfg, {
      severity: 'warning', source: 'provider', eventType: 'api_response', code: 'FOOTBALL_RESPONSE',
      message, endpoint: path, status: r.status, durationMs,
    });
    throw footballError(`API-Football: ${message}`, 'FOOTBALL_RESPONSE');
  }

  memory.provider.lastError = '';
  memory.provider.lastSuccessAt = new Date().toISOString();
  bumpTelemetry('apiSuccess');
  if (options.responseType === 'any') return body.response ?? null;
  return Array.isArray(body.response) ? body.response : [];
}

function providerRequestKey(path, params, options = {}) {
  const pairs = Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
  return `football:${path}?${pairs}:type=${options.responseType || 'array'}`;
}

async function apiFootball(path, params, cfg, options = {}) {
  return await withSingleFlight(
    providerRequestKey(path, params, options),
    () => apiFootballNetwork(path, params, cfg, options),
  );
}

async function probeSupabase(cfg) {
  if (!hasSupabase(cfg)) return { configured: false, ok: false, status: 'not_configured', latencyMs: null, cache: null };
  const startedAt = Date.now();
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
    url.searchParams.set('select', 'cache_key,expires_at');
    url.searchParams.set('order', 'expires_at.desc');
    url.searchParams.set('limit', '200');
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg, { Prefer: 'count=exact' }) }, 7000, 'Supabase diagnostics');
    const latencyMs = Date.now() - startedAt;
    if (!r.ok) {
      bumpTelemetry('supabaseErrors');
      const text = await r.text().catch(() => '');
      return { configured: true, ok: false, status: `http_${r.status}`, latencyMs, detail: redactOpsString(text, 180), cache: null };
    }
    const rows = await r.json().catch(() => []);
    const now = Date.now();
    const fresh = rows.filter(x => Date.parse(x.expires_at || '') > now).length;
    const stale = rows.filter(x => Date.parse(x.expires_at || '') <= now).length;
    const range = r.headers.get('content-range') || '';
    const totalRaw = range.includes('/') ? range.split('/').pop() : '';
    const total = /^\d+$/.test(totalRaw) ? Number(totalRaw) : rows.length;
    return {
      configured: true,
      ok: true,
      status: 'ok',
      latencyMs,
      cache: { total, sampled: rows.length, freshInSample: fresh, staleInSample: stale, newestExpiry: rows?.[0]?.expires_at || null },
    };
  } catch (error) {
    bumpTelemetry('supabaseErrors');
    return { configured: true, ok: false, status: 'network_error', latencyMs: Date.now() - startedAt, detail: redactOpsString(error?.message || error, 180), cache: null };
  }
}

async function readRecentOpsEvents(cfg, limit = 10) {
  const fallback = () => ({ persistent: false, migrationReady: false, items: memory.opsEvents.slice(0, limit) });
  if (!hasSupabase(cfg)) return fallback();
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    url.searchParams.set('select', 'created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(Math.max(1, Math.min(20, limit))));
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase ops');
    if (!r.ok) return fallback();
    const items = await r.json().catch(() => []);
    return { persistent: true, migrationReady: true, items };
  } catch {
    return fallback();
  }
}

async function collectDiagnostics(cfg) {
  const [supabase, ops, integrity] = await Promise.all([
    probeSupabase(cfg),
    readRecentOpsEvents(cfg, 12),
    readIntegrityDiagnostics(cfg, 12),
  ]);
  const provider = providerSnapshot();
  let overall;
  if (supabase.configured && !supabase.ok) overall = { state: 'critical', label: 'Нужна проверка Supabase' };
  else if (provider.health === 'critical') overall = { state: 'critical', label: 'API-Football временно ограничен' };
  else if (!ops.migrationReady && hasSupabase(cfg)) overall = { state: 'warning', label: 'Выполните migration v3.8' };
  else if (!integrity.migrationReady && hasSupabase(cfg)) overall = { state: 'warning', label: 'Выполните migration v3.9' };
  else if (integrity.lastRun?.health === 'critical') overall = { state: 'warning', label: 'Есть проблемы качества футбольных данных' };
  else if (provider.health === 'warning' || integrity.lastRun?.health === 'warning' || Number(memory.telemetry?.routeErrors || 0) > 0 || Number(memory.telemetry?.cacheWriteErrors || 0) > 0) overall = { state: 'warning', label: 'Есть предупреждения' };
  else if (provider.health === 'waiting') overall = { state: 'waiting', label: 'Ожидаем первый запрос к API' };
  else overall = { state: 'ok', label: 'Системы работают штатно' };

  const recommendations = [];
  if (supabase.ok && !ops.migrationReady && hasSupabase(cfg)) recommendations.push('Выполните supabase_migration_v3_8.sql, чтобы журнал ошибок сохранялся между перезапусками Worker.');
  if (!integrity.migrationReady && hasSupabase(cfg)) recommendations.push('Выполните supabase_migration_v3_9.sql, чтобы проверки качества матчей сохранялись и были видны после перезапуска Worker.');
  if (provider.cooldownActive) recommendations.push(`API-Football находится на паузе ещё примерно ${footballCooldownRemaining()} сек.; приложение должно использовать сохранённый кэш.`);
  if (supabase.configured && !supabase.ok) recommendations.push('Проверьте SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY и доступность PostgREST.');
  if (Number(provider.dailyUsedPct) >= 90) recommendations.push('Дневная квота API-Football использована более чем на 90%; до сброса лимита работаем в экономном режиме.');
  if (Number(integrity.lastRun?.quarantined || 0) > 0) recommendations.push(`Integrity Guard скрыл ${Number(integrity.lastRun.quarantined)} подозрительных матч(а/ей) из последней выборки. Проверьте список issue codes ниже.`);
  if (Number(integrity.lastRun?.warnings || 0) > 0 && !Number(integrity.lastRun?.quarantined || 0)) recommendations.push('В последней выборке есть предупреждения целостности данных; приложение оставило матчи доступными, но пометило их для контроля.');
  if (!recommendations.length) recommendations.push('Критичных действий сейчас не требуется.');

  return {
    available: true,
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    overall,
    provider,
    supabase,
    runtime: telemetrySnapshot(),
    observability: { persistent: ops.persistent, migrationReady: ops.migrationReady, retentionDays: cfg.opsRetentionDays, recentEvents: ops.items },
    integrity,
    recommendations,
  };
}


const CLIENT_TELEMETRY_EVENTS = new Set([
  'boot_ok',
  'boot_recovery',
  'compatibility_block',
  'network_recovery',
  'client_error',
]);

function clientTelemetryMetadata(body = {}) {
  const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};
  const out = {
    clientVersion: redactOpsString(meta.clientVersion || '', 40),
    apiContract: Number.isFinite(Number(meta.apiContract)) ? Number(meta.apiContract) : null,
    releaseChannel: redactOpsString(meta.releaseChannel || '', 30),
    view: redactOpsString(meta.view || '', 40),
    networkMode: redactOpsString(meta.networkMode || '', 30),
    bootMs: Number.isFinite(Number(meta.bootMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.bootMs)))) : null,
    manifestOk: typeof meta.manifestOk === 'boolean' ? meta.manifestOk : null,
    degraded: typeof meta.degraded === 'boolean' ? meta.degraded : null,
    blocking: typeof meta.blocking === 'boolean' ? meta.blocking : null,
    reason: redactOpsString(meta.reason || '', 80),
    errorKind: redactOpsString(meta.errorKind || '', 60),
  };
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== null && value !== ''));
}

async function apiClientTelemetry(request, cfg, user) {
  let body = {};
  try { body = await request.json(); } catch {}
  const event = String(body?.event || '').trim().toLowerCase();
  if (!CLIENT_TELEMETRY_EVENTS.has(event)) {
    return json({ ok: false, error: 'Unsupported telemetry event.' }, 400);
  }

  const meta = clientTelemetryMetadata(body);
  const dedupePart = meta.reason || meta.errorKind || meta.view || '';
  const dedupeKey = `${Number(user.id)}:${event}:${meta.clientVersion || ''}:${dedupePart}`;
  const last = Number(memory.clientTelemetryDedupe.get(dedupeKey) || 0);
  if (last && Date.now() - last < 5 * 60 * 1000) {
    return json({ ok: true, deduped: true });
  }
  memory.clientTelemetryDedupe.set(dedupeKey, Date.now());
  if (memory.clientTelemetryDedupe.size > 1500) pruneMemoryState();

  const severity = ['compatibility_block', 'client_error'].includes(event) ? 'warning' : 'info';
  await recordOpsEvent(cfg, {
    severity,
    source: 'client',
    eventType: 'client_telemetry',
    code: event.toUpperCase(),
    message: `Client event: ${event}`,
    endpoint: '/api/client-telemetry',
    meta,
  });
  return json({ ok: true, deduped: false });
}

async function readOpsEventsRange(cfg, startIso, endIso, limit = 600) {
  const startMs = Date.parse(startIso || '');
  const endMs = Date.parse(endIso || '');
  const fallbackItems = memory.opsEvents.filter(item => {
    const t = Date.parse(item?.created_at || '');
    return Number.isFinite(t) && t >= startMs && t < endMs;
  }).slice(0, limit);
  const fallback = () => ({ persistent: false, migrationReady: false, items: fallbackItems });
  if (!hasSupabase(cfg)) return fallback();
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    url.searchParams.set('select', 'created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
    url.searchParams.set('created_at', `gte.${startIso}`);
    url.searchParams.append('created_at', `lt.${endIso}`);
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(Math.max(1, Math.min(1000, Number(limit || 600)))));
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase release monitor');
    if (!r.ok) return fallback();
    const items = await r.json().catch(() => []);
    return { persistent: true, migrationReady: true, items };
  } catch {
    return fallback();
  }
}

function releaseTopGroups(items, keyFn, limit = 8) {
  const counts = new Map();
  for (const item of items || []) {
    const key = String(keyFn(item) || '').trim() || 'unknown';
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function summarizeReleaseWindow(items = [], hours = 24) {
  const severity = { info: 0, warning: 0, error: 0, critical: 0 };
  for (const item of items) {
    const key = String(item?.severity || 'info');
    if (key in severity) severity[key] += 1;
  }
  const client = items.filter(x => x?.source === 'client' && x?.event_type === 'client_telemetry');
  const clientCounts = Object.fromEntries(releaseTopGroups(client, x => x.code, 12).map(x => [x.key, x.count]));
  const errorLike = severity.error + severity.critical;
  const compatibilityBlocks = Number(clientCounts.COMPATIBILITY_BLOCK || 0);
  const clientErrors = Number(clientCounts.CLIENT_ERROR || 0);
  const bootRecovery = Number(clientCounts.BOOT_RECOVERY || 0);
  const bootOk = Number(clientCounts.BOOT_OK || 0);
  const networkRecovery = Number(clientCounts.NETWORK_RECOVERY || 0);
  const allowance = Math.max(2, Math.ceil((Number(hours || 24) / 24) * 5));
  return {
    total: items.length,
    severity,
    errorLike,
    warningLike: severity.warning,
    client: {
      total: client.length,
      bootOk,
      bootRecovery,
      compatibilityBlocks,
      clientErrors,
      networkRecovery,
    },
    topSources: releaseTopGroups(items, x => x.source, 8),
    topCodes: releaseTopGroups(items.filter(x => x.severity !== 'info'), x => x.code || x.event_type, 10),
    operationalBudget: {
      allowance,
      used: errorLike,
      remaining: Math.max(0, allowance - errorLike),
      exhausted: errorLike > allowance,
    },
  };
}

function releaseMonitorHealth(current, persistent) {
  const critical = Number(current?.severity?.critical || 0);
  const errors = Number(current?.severity?.error || 0);
  const warnings = Number(current?.severity?.warning || 0);
  const compat = Number(current?.client?.compatibilityBlocks || 0);
  const clientErrors = Number(current?.client?.clientErrors || 0);
  let state = 'healthy';
  if (critical > 0 || errors >= 8 || compat >= 3) state = 'incident';
  else if (errors >= 3 || warnings >= 8 || clientErrors >= 4 || !persistent) state = 'watch';

  const score = Math.max(0, Math.min(100,
    100 - critical * 25 - errors * 8 - warnings * 2 - compat * 10 - clientErrors * 4 - (persistent ? 0 : 8)
  ));
  const label = state === 'incident'
    ? 'Есть активные признаки инцидента'
    : state === 'watch'
      ? 'Нужен контроль перед расширением аудитории'
      : 'Релиз выглядит стабильным';
  return { state, label, score };
}

async function apiReleaseMonitor(request, cfg) {
  const url = new URL(request.url);
  const hours = Math.max(1, Math.min(168, Number(url.searchParams.get('hours') || 24)));
  const force = url.searchParams.get('refresh') === '1';
  const cacheKey = `h${hours}`;
  const cached = memory.releaseMonitor?.[cacheKey];
  if (!force && cached?.value && Date.now() - Number(cached.at || 0) < 30000) {
    return json({ ...cached.value, cached: true });
  }

  const end = new Date();
  const currentStart = new Date(end.getTime() - hours * 3600_000);
  const previousStart = new Date(currentStart.getTime() - hours * 3600_000);
  const source = await readOpsEventsRange(cfg, previousStart.toISOString(), end.toISOString(), 1000);
  const currentItems = source.items.filter(x => Date.parse(x.created_at || '') >= currentStart.getTime());
  const previousItems = source.items.filter(x => {
    const t = Date.parse(x.created_at || '');
    return Number.isFinite(t) && t >= previousStart.getTime() && t < currentStart.getTime();
  });
  const current = summarizeReleaseWindow(currentItems, hours);
  const previous = summarizeReleaseWindow(previousItems, hours);
  const health = releaseMonitorHealth(current, source.persistent);
  const incidents = currentItems
    .filter(x => ['warning','error','critical'].includes(String(x.severity || '')))
    .slice(0, 12)
    .map(x => ({
      createdAt: x.created_at,
      severity: x.severity,
      source: x.source,
      code: x.code || x.event_type,
      message: redactOpsString(x.message || '', 180),
      endpoint: x.endpoint || '',
    }));

  const value = {
    available: true,
    version: APP_VERSION,
    releaseCandidate: RC_NAME,
    generatedAt: new Date().toISOString(),
    hours,
    persistent: source.persistent,
    migrationReady: source.migrationReady,
    health,
    current,
    previous,
    trend: {
      errorsDelta: current.errorLike - previous.errorLike,
      warningsDelta: current.warningLike - previous.warningLike,
      clientErrorsDelta: Number(current.client?.clientErrors || 0) - Number(previous.client?.clientErrors || 0),
      bootRecoveryDelta: Number(current.client?.bootRecovery || 0) - Number(previous.client?.bootRecovery || 0),
    },
    incidents,
    runtime: telemetrySnapshot(),
    policy: {
      noFootballApiCalls: true,
      noUserDataMutation: true,
      telemetryPrivacy: 'Client telemetry is allowlisted and excludes free-form chat/user content.',
      note: 'Operational budget counts persisted error/critical ops events; it is a release signal, not a formal availability SLO.',
    },
  };
  memory.releaseMonitor ||= {};
  memory.releaseMonitor[cacheKey] = { at: Date.now(), value };
  return json(value);
}

async function apiDiagnostics(request, cfg) {
  return json(await collectDiagnostics(cfg));
}

async function probeOptionalTable(cfg, table) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', '*');
    url.searchParams.set('limit', '1');
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, `Supabase ${table} probe`);
    if (r.ok) return { ok: true, status: 'ok' };
    return { ok: false, status: `http_${r.status}` };
  } catch (error) {
    return { ok: false, status: 'network_error', detail: redactOpsString(error?.message || error, 120) };
  }
}

function releaseCheck(id, label, state, detail, blocking = false) {
  return { id, label, state, detail, blocking: Boolean(blocking) };
}

async function apiReleaseReadiness(request, cfg) {
  const now = Date.now();
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  if (!force && memory.releaseReadiness?.value && now - Number(memory.releaseReadiness.at || 0) < 30000) {
    return json({ ...memory.releaseReadiness.value, cached: true });
  }

  const [diagnostics, modelTable, remediationTable, runtimeTable, runtimeHistoryTable] = await Promise.all([
    collectDiagnostics(cfg),
    probeOptionalTable(cfg, 'model_predictions'),
    probeOptionalTable(cfg, 'prediction_integrity_actions'),
    probeOptionalTable(cfg, 'runtime_controls'),
    probeOptionalTable(cfg, 'runtime_control_history'),
  ]);
  const [runtimeState, watchdogSchema, runLedgerSchema, finalitySchema, adjudicationSchema, trustSchema, calibrationPromotionSchema, calibrationLifecycleSchema, backendSecurity] = await Promise.all([
    loadRuntimeControls(cfg, { force: true }),
    probeSettlementWatchdogSchema(cfg),
    probeSettlementRunLedgerSchema(cfg),
    probeSettlementFinalitySchema(cfg),
    probeSettlementAdjudicationSchema(cfg),
    probeSettlementTrustSchema(cfg),
    probeCalibrationPromotionSchema(cfg),
    probeCalibrationLifecycleSchema(cfg),
    readBackendSecurityContract(cfg),
  ]);
  const runtime = runtimeState.value;
  const provider = diagnostics.provider || {};
  const watchdogSelfTest = settlementWatchdogSelfTest();
  const checks = [
    releaseCheck('football_api', 'Ключ API-Football', cfg.apiFootballKey ? 'pass' : 'fail', cfg.apiFootballKey ? 'Ключ доступен Worker.' : 'API_FOOTBALL_KEY отсутствует.', true),
    releaseCheck('supabase_config', 'Настройка Supabase', hasSupabase(cfg) ? 'pass' : 'fail', hasSupabase(cfg) ? 'URL и service key доступны runtime.' : 'Не хватает SUPABASE_URL или service key.', true),
    releaseCheck('supabase_online', 'Supabase/PostgREST', diagnostics.supabase?.ok ? 'pass' : 'fail', diagnostics.supabase?.ok ? `Ответ ${Number(diagnostics.supabase?.latencyMs || 0)} мс.` : `Статус: ${diagnostics.supabase?.status || 'offline'}.`, true),
    releaseCheck('backend_security_contract', 'Контракт безопасности Supabase', backendSecurity.ok ? 'pass' : 'fail',
      backendSecurity.ok
        ? 'Все public-таблицы защищены RLS; anon/authenticated не имеют прямых прав; RPC закрыты.'
        : `RC19 security contract: ${backendSecurity.status || 'ошибка'}.`, true),
    releaseCheck('model_backtest', 'Схема исторической проверки v3.6+', modelTable.ok ? 'pass' : 'fail', modelTable.ok ? 'Таблица model_predictions доступна.' : `model_predictions: ${modelTable.status}.`, true),
    releaseCheck('prediction_integrity', 'Самопроверка целостности прогнозов', modelIntegritySelfTest().pass ? 'pass' : 'fail',
      modelIntegritySelfTest().pass ? 'Probabilities, captured_at timing и outcome consistency проходят synthetic self-test.' : 'Prediction Integrity self-test не прошёл.', true),
    releaseCheck('prediction_remediation', 'Восстановление прогнозов v6.1', remediationTable.ok ? 'pass' : 'fail',
      remediationTable.ok ? 'Audit trail remediation доступен.' : 'Нужна supabase_migration_v6_1.sql.', true),
    releaseCheck('settlement_watchdog_schema', 'Схема контроля результатов v6.4', watchdogSchema.ok ? 'pass' : 'fail',
      watchdogSchema.ok ? 'Runtime switch и cron audit source доступны.' : 'Нужна supabase_migration_v6_2.sql.', true),
    releaseCheck('settlement_watchdog_selftest', 'Самопроверка контроля результатов', watchdogSelfTest.pass ? 'pass' : 'fail',
      watchdogSelfTest.pass ? `shadow=${watchdogSelfTest.shadow}, runtime=${watchdogSelfTest.runtime}, quota=${watchdogSelfTest.quota}, active=${watchdogSelfTest.active}.` : 'Watchdog decision self-test не прошёл.', true),
    releaseCheck('settlement_run_ledger_schema', 'Схема журнала запусков v6.4', runLedgerSchema.ok ? 'pass' : 'fail',
      runLedgerSchema.ok ? 'Interrupted-run timestamps, attempt counter и retry lineage доступны.' : 'Нужна supabase_migration_v6_4.sql.', true),
    releaseCheck('settlement_run_ledger_selftest', 'Самопроверка журнала запусков', settlementRunLedgerSelfTest().pass ? 'pass' : 'fail',
      settlementRunLedgerSelfTest().pass ? 'Fresh=1, interrupted retry=2, attempt 3 exhausts lineage, different batch starts fresh.' : 'Run-ledger self-test не прошёл.', true),
    releaseCheck('settlement_finality_schema', 'Схема подтверждения результата v6.5', finalitySchema.ok ? 'pass' : 'fail',
      finalitySchema.ok ? 'Verification state и drift audit table доступны.' : 'Нужна supabase_migration_v6_5.sql.', true),
    releaseCheck('settlement_finality_selftest', 'Самопроверка подтверждения результата', settlementFinalitySelfTest().pass ? 'pass' : 'fail',
      settlementFinalitySelfTest().pass ? 'First matching pass verifies; second matching pass confirms; late score/status changes become drift.' : 'Settlement Finality self-test не прошёл.', true),
    releaseCheck('settlement_adjudication_schema', 'Схема разбора расхождений v6.6', adjudicationSchema.ok ? 'pass' : 'fail',
      adjudicationSchema.ok ? 'Resolution audit и model resolution fields доступны.' : 'Нужна supabase_migration_v6_6.sql.', true),
    releaseCheck('settlement_adjudication_selftest', 'Самопроверка разбора расхождений', settlementDriftAdjudicationSelfTest().pass ? 'pass' : 'fail',
      settlementDriftAdjudicationSelfTest().pass ? 'Keep/accept/void transitions valid; unsafe provider acceptance blocked.' : 'Settlement Adjudication self-test не прошёл.', true),
    releaseCheck('settlement_trust_schema', 'Схема доверенных метрик v6.7', trustSchema.ok ? 'pass' : 'fail',
      trustSchema.ok ? 'Verification count и first-pass timestamp доступны.' : 'Нужна supabase_migration_v6_7.sql.', true),
    releaseCheck('trusted_metrics_gate_selftest', 'Самопроверка доверенных метрик', trustedMetricsGateSelfTest().pass ? 'pass' : 'fail',
      trustedMetricsGateSelfTest().pass ? 'Только confirmed/adjudicated settled rows допускаются в metrics/calibration.' : 'Trusted Metrics Gate self-test не прошёл.', true),
    releaseCheck('calibration_promotion_schema', 'Схема продвижения калибровки v6.8', calibrationPromotionSchema.ok ? 'pass' : 'fail',
      calibrationPromotionSchema.ok ? 'Аудит holdout-решений доступен.' : 'Нужна supabase_migration_v6_8.sql.', true),
    releaseCheck('calibration_promotion_selftest', 'Самопроверка продвижения калибровки', calibrationPromotionSelfTest().pass ? 'pass' : 'fail',
      calibrationPromotionSelfTest().pass ? 'Устойчивое улучшение проходит gate, synthetic overfit блокируется.' : 'Calibration Promotion self-test не прошёл.', true),
    releaseCheck('calibration_lifecycle_schema', 'Atomic calibration lifecycle v6.10', calibrationLifecycleSchema.ok ? 'pass' : 'fail',
      calibrationLifecycleSchema.ok ? 'Atomic state, transition audit и rollback state доступны.' : 'Нужна supabase_migration_v6_10.sql.', true),
    releaseCheck('automatic_settlement_recovery', 'Автоматическое восстановление результатов', 'pass',
      runtime.autoSettlementRecoveryEnabled ? 'Runtime switch ON: cron catch-up разрешён guardrails.' : 'Runtime switch OFF: watchdog работает в shadow и только сигнализирует.', false),
    releaseCheck('runtime_controls_schema', 'Схема управления функциями v5.7', runtimeTable.ok ? 'pass' : 'fail', runtimeTable.ok ? 'Таблица runtime_controls доступна.' : 'Нужна supabase_migration_v5_7.sql.', true),
    releaseCheck('runtime_history_schema', 'История откатов v5.8', runtimeHistoryTable.ok ? 'pass' : 'fail', runtimeHistoryTable.ok ? 'История Runtime Controls доступна.' : 'Нужна supabase_migration_v5_8.sql.', true),
    releaseCheck('runtime_controls_state', 'Состояние управления функциями', runtime.maintenanceMode ? 'warn' : 'pass', runtime.maintenanceMode ? `Maintenance включён${runtime.message ? `: ${runtime.message}` : '.'}` : `Revision ${Number(runtime.revision || 1)} · рабочий режим.`, false),
    releaseCheck('observability', 'Схема журнала событий v3.8', diagnostics.observability?.migrationReady ? 'pass' : 'warn', diagnostics.observability?.migrationReady ? 'Постоянный журнал ops_events доступен.' : 'Журнал работает только в памяти Worker.', false),
    releaseCheck('integrity', 'Схема целостности данных v3.9', diagnostics.integrity?.migrationReady ? 'pass' : 'fail', diagnostics.integrity?.migrationReady ? 'История integrity-проверок доступна.' : 'Нужна migration v3.9.', true),
    releaseCheck('provider_health', 'Состояние API-Football', provider.health === 'critical' ? 'fail' : provider.health === 'warning' || provider.health === 'waiting' ? 'warn' : 'pass', provider.health === 'waiting' ? 'Ещё не было успешного provider-запроса после старта Worker.' : `Health: ${provider.health || 'unknown'}.`, provider.health === 'critical'),
    releaseCheck('provider_transition', 'Provider transition', providerTransitionProfile().paid ? 'pass' : 'warn', providerTransitionProfile().paid ? `${providerTransitionProfile().plan}: расширенный режим активен.` : `${providerTransitionProfile().plan}: приложение остаётся в экономном режиме до увеличения квоты.`, false),
    releaseCheck('quota_orchestrator', 'Quota Orchestrator', providerBudgetProfile().mode === 'emergency' ? 'warn' : 'pass', `${providerBudgetProfile().label}; feature cache api/cache=${Number(memory.providerFeatureFetch?.api || 0)}/${Number(memory.providerFeatureFetch?.cache || 0)}.`, false),
    releaseCheck(
      'expanded_e2e',
      'Expanded Data E2E',
      memory.providerE2E?.last?.status?.ready ? 'pass' : memory.providerE2E?.last?.status?.code === 'NEEDS_ATTENTION' ? 'warn' : 'warn',
      memory.providerE2E?.last
        ? `${memory.providerE2E.last.status?.label || 'Нет статуса'} · fixture ${memory.providerE2E.last.fixtureId || '—'}.`
        : 'E2E ещё не запускался. На FREE это ожидаемо.',
      false
    ),
    releaseCheck('telegram', 'Telegram bot runtime', cfg.botToken ? 'pass' : 'warn', cfg.botToken ? 'TELEGRAM_BOT_TOKEN доступен.' : 'Без bot token не будут работать Telegram-уведомления.', false),
    releaseCheck('production_mode', 'Production mode', cfg.devMode ? 'warn' : 'pass', cfg.devMode ? 'DEV_MODE=true — перед релизом выключить.' : 'DEV_MODE=false.', false),
    releaseCheck('load_safety', 'Защита от нагрузки', memory.productionReadiness?.value?.status === 'blocked' ? 'fail' : memory.productionReadiness?.value ? 'pass' : 'warn',
      memory.productionReadiness?.value ? `${memory.productionReadiness.value.label} · ${memory.productionReadiness.value.score}%.` : 'Production Safety Gate ещё не запускался.', false),
    releaseCheck('rc_regression', 'RC Regression Smoke', memory.rcRegression?.value?.status === 'blocked' ? 'fail' : memory.rcRegression?.value ? 'pass' : 'warn',
      memory.rcRegression?.value ? `${memory.rcRegression.value.label} · ${memory.rcRegression.value.score}%.` : 'RC smoke-test ещё не запускался.', false),
    releaseCheck('release_monitor', 'Release Monitor', memory.releaseMonitor?.h24?.value?.health?.state === 'incident' ? 'warn' : memory.releaseMonitor?.h24?.value ? 'pass' : 'warn',
      memory.releaseMonitor?.h24?.value ? `${memory.releaseMonitor.h24.value.health.label} · ${memory.releaseMonitor.h24.value.health.score}%.` : 'Release Monitor ещё не запускался.', false),
    releaseCheck('monetization', 'Монетизация', cfg.monetizationEnabled ? 'warn' : 'pass', cfg.monetizationEnabled ? 'Монетизация включена, хотя текущий план проекта — запускать её в финале.' : 'Оплата корректно остаётся на паузе.', false),
    releaseCheck('integrity_last_run', 'Последняя проверка матчей', diagnostics.integrity?.lastRun?.health === 'critical' ? 'warn' : 'pass', diagnostics.integrity?.lastRun ? `Health: ${diagnostics.integrity.lastRun.health || 'ok'}, quality ${Number(diagnostics.integrity.lastRun.qualityScore || 0)}%.` : 'Проверка появится после загрузки каталога матчей.', false),
  ];

  const blockers = checks.filter(x => x.state === 'fail' && x.blocking);
  const warnings = checks.filter(x => x.state === 'warn' || (x.state === 'fail' && !x.blocking));
  const passed = checks.filter(x => x.state === 'pass').length;
  const score = Math.round((passed / checks.length) * 100);
  const status = blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready';
  const label = blockers.length ? 'Есть блокирующие проверки' : warnings.length ? 'Ядро готово, есть предупреждения' : 'Core release candidate готов';

  const value = {
    available: true,
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    label,
    score,
    checks,
    blockers: blockers.map(x => x.id),
    warnings: warnings.map(x => x.id),
    diagnostics,
    policy: {
      monetizationExpected: 'paused',
      paymentTestingRequiredNow: false,
      providerUpgradeRequiredNow: false,
      note: 'RC13 добавляет ежедневный settlement watchdog и runtime-gated auto catch-up. Ручной dry-run/recovery RC9 сохраняется; immutable snapshots и пользовательская оплата не меняются.',
    },
  };
  memory.releaseReadiness = { at: now, value };
  return json(value);
}


async function runSingleFlightSelfTest() {
  const key = `selftest:${Date.now()}`;
  let executions = 0;
  const values = await Promise.all(Array.from({ length: 8 }, () =>
    withSingleFlight(key, async () => {
      executions += 1;
      await sleepMs(25);
      return 'ok';
    }, { countTelemetry: false })
  ));
  return { pass: executions === 1 && values.every(x => x === 'ok'), executions, callers: values.length };
}

function productionCheck(id, label, state, detail, blocking = false) {
  return { id, label, state, detail, blocking: Boolean(blocking) };
}

async function apiProductionReadiness(request, cfg) {
  const now = Date.now();
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  if (!force && memory.productionReadiness?.value && now - Number(memory.productionReadiness.at || 0) < 30000) {
    return json({ ...memory.productionReadiness.value, cached: true });
  }

  const [diagnostics, singleflightTest] = await Promise.all([
    collectDiagnostics(cfg),
    runSingleFlightSelfTest(),
  ]);
  const runLedgerSelfTest = settlementRunLedgerSelfTest();
  checks.push(rcCheck(
    'settlement_run_ledger_selftest',
    'safety',
    'Самопроверка журнала запусков',
    runLedgerSelfTest.pass ? 'pass' : 'fail',
    runLedgerSelfTest.pass
      ? `fresh=${runLedgerSelfTest.fresh}; retry=${runLedgerSelfTest.retry}; exhausted=${runLedgerSelfTest.exhausted}; differentBatch=${runLedgerSelfTest.differentBatch}.`
      : 'Settlement Run Ledger self-test не прошёл.',
    true
  ));

  const finalitySelfTest = settlementFinalitySelfTest();
  checks.push(rcCheck(
    'settlement_finality_selftest',
    'safety',
    'Самопроверка подтверждения результата',
    finalitySelfTest.pass ? 'pass' : 'fail',
    finalitySelfTest.pass
      ? `verified=${finalitySelfTest.verified}; scoreDrift=${finalitySelfTest.scoreDrift}; statusDrift=${finalitySelfTest.statusDrift}; wait=${finalitySelfTest.wait}.`
      : 'Settlement Finality self-test не прошёл.',
    true
  ));

  const adjudicationSelfTest = settlementDriftAdjudicationSelfTest();
  checks.push(rcCheck(
    'settlement_adjudication_selftest',
    'safety',
    'Самопроверка разбора расхождений',
    adjudicationSelfTest.pass ? 'pass' : 'fail',
    adjudicationSelfTest.pass
      ? `keep=${adjudicationSelfTest.keep}; accept=${adjudicationSelfTest.accept}; void=${adjudicationSelfTest.void}; unsafeBlocked=${adjudicationSelfTest.unsafeAcceptBlocked}.`
      : 'Settlement Adjudication self-test не прошёл.',
    true
  ));

  const trustedGateSelfTest = trustedMetricsGateSelfTest();
  checks.push(rcCheck(
    'trusted_metrics_gate_selftest',
    'safety',
    'Самопроверка доверенных метрик',
    trustedGateSelfTest.pass ? 'pass' : 'fail',
    trustedGateSelfTest.pass
      ? `confirmed=${trustedGateSelfTest.confirmed}; adjudicated=${trustedGateSelfTest.adjudicated}; verifiedBlocked=${trustedGateSelfTest.verifiedBlocked}; unverifiedBlocked=${trustedGateSelfTest.unverifiedBlocked}; driftBlocked=${trustedGateSelfTest.driftBlocked}; voidBlocked=${trustedGateSelfTest.voidBlocked}.`
      : 'Trusted Metrics Gate self-test не прошёл.',
    true
  ));

  const safety = productionSafetySnapshot();
  const providerBudget = providerBudgetProfile();
  const paidProvider = providerTransitionProfile().paid;
  const lastE2E = await loadLastProviderE2E(cfg);

  const checks = [
    productionCheck('supabase', 'Supabase отвечает', diagnostics.supabase?.ok ? 'pass' : 'fail',
      diagnostics.supabase?.ok ? `${Number(diagnostics.supabase?.latencyMs || 0)} мс.` : `${diagnostics.supabase?.status || 'offline'}.`, true),
    productionCheck('singleflight', 'Server-side SingleFlight', singleflightTest.pass ? 'pass' : 'fail',
      singleflightTest.pass ? `${singleflightTest.callers} параллельных вызовов → ${singleflightTest.executions} выполнение.` : 'Коалесинг параллельных запросов не прошёл self-test.', true),
    productionCheck('burst_guard', 'Burst Guard', ROUTE_BURST_POLICIES.length >= 6 ? 'pass' : 'fail',
      `${ROUTE_BURST_POLICIES.length} политик для дорогих маршрутов; блокировок в isolate: ${Number(memory.telemetry?.burstBlocks || 0)}.`, true),
    productionCheck('upstream_timeouts', 'Upstream timeouts', 'pass',
      'Supabase 7 сек., API-Football 10 сек.; зависшие upstream не держат Worker бесконечно.', true),
    productionCheck('user_sync', 'Telegram user sync cache', 'pass',
      `Повторная синхронизация users ограничена 1 разом / 10 минут; пропущено записей: ${Number(memory.telemetry?.userSyncSkips || 0)}.`, false),
    productionCheck('memory_bounds', 'Bounded L1 memory', memory.cache.size <= 600 ? 'pass' : 'warn',
      `${memory.cache.size} cache entries; soft target 500, prune threshold 600.`, false),
    productionCheck('quota_guard', 'Quota Orchestrator', providerBudget.mode === 'emergency' ? 'warn' : 'pass',
      `${providerBudget.label}; daily reserve ${Number(providerBudget.daily?.reserve || 0)}.`, false),
    productionCheck('expanded_e2e', 'Expanded Data E2E', !paidProvider ? 'warn' : lastE2E?.status?.ready ? 'pass' : 'warn',
      !paidProvider
        ? 'FREE: полноценный E2E отложен до увеличения квоты.'
        : lastE2E?.status?.ready
          ? `${lastE2E.status.label} · fixture ${lastE2E.fixtureId}.`
          : 'Расширенный тариф обнаружен, но Release Gate ещё не подтверждён.', false),
    productionCheck('monetization', 'Монетизация paused', cfg.monetizationEnabled ? 'fail' : 'pass',
      cfg.monetizationEnabled ? 'Монетизация включена раньше финального этапа.' : 'Пользовательские платежи остаются выключены.', true),
  ];

  const blockers = checks.filter(x => x.state === 'fail' && x.blocking);
  const warnings = checks.filter(x => x.state === 'warn' || (x.state === 'fail' && !x.blocking));
  const passed = checks.filter(x => x.state === 'pass').length;
  const status = blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready';
  const value = {
    available: true,
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    label: blockers.length ? 'Production gate заблокирован' : warnings.length ? 'Production-ready с ожидаемыми ограничениями' : 'Production safety gate пройден',
    score: Math.round(passed / checks.length * 100),
    checks,
    blockers: blockers.map(x => x.id),
    warnings: warnings.map(x => x.id),
    safety,
    diagnostics: {
      supabase: diagnostics.supabase,
      provider: diagnostics.provider,
      runtime: diagnostics.runtime,
    },
    policy: {
      payments: 'paused',
      externalLoadGenerator: false,
      note: 'Self-test не создаёт искусственный внешний трафик и не расходует API-Football. Реальный нагрузочный прогон выполняется позже на staging/production traffic.',
    },
  };
  memory.productionReadiness = { at: now, value };
  return json(value);
}


function rcCheck(id, group, label, state, detail, blocking = false) {
  return { id, group, label, state, detail, blocking: Boolean(blocking) };
}

async function rcReadRoute(label, factory) {
  const startedAt = Date.now();
  try {
    const response = await factory();
    const status = Number(response?.status || 0);
    const body = await responseJsonSafe(response);
    return {
      ok: status >= 200 && status < 300,
      status,
      latencyMs: Date.now() - startedAt,
      label,
      shape: body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : [],
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      label,
      error: redactOpsString(error?.message || error, 140),
      shape: [],
    };
  }
}

async function apiRcRegression(request, cfg, user) {
  const url = new URL(request.url);
  const force = url.searchParams.get('refresh') === '1';
  const now = Date.now();

  if (!force && memory.rcRegression?.value && now - Number(memory.rcRegression.at || 0) < 30000) {
    return json({ ...memory.rcRegression.value, cached: true });
  }

  const checks = [];
  const startedAt = Date.now();

  // 1) Core runtime / security configuration.
  checks.push(rcCheck('version', 'runtime', 'Версия RC', APP_VERSION === '6.11.0-rc19' ? 'pass' : 'fail',
    `Worker: ${APP_VERSION}; ожидается 6.11.0-rc19.`, true));
  checks.push(rcCheck('api_contract', 'runtime', 'Контракт API', API_CONTRACT_VERSION === 5 ? 'pass' : 'fail',
    `Contract ${API_CONTRACT_VERSION}; min client ${MIN_CLIENT_VERSION}.`, true));
  checks.push(rcCheck('app_manifest', 'runtime', 'Публичный манифест приложения', appManifest(cfg)?.version === APP_VERSION ? 'pass' : 'fail',
    `Release channel ${RELEASE_CHANNEL}; manifest ${appManifest(cfg)?.version || '—'}.`, true));
  checks.push(rcCheck('production_mode', 'runtime', 'DEV_MODE выключен', cfg.devMode ? 'fail' : 'pass',
    cfg.devMode ? 'DEV_MODE=true.' : 'DEV_MODE=false.', true));
  checks.push(rcCheck('monetization_paused', 'runtime', 'Монетизация на паузе', cfg.monetizationEnabled ? 'fail' : 'pass',
    cfg.monetizationEnabled ? 'MONETIZATION_ENABLED=true.' : 'Платёжный контур не активирован.', true));
  checks.push(rcCheck('telegram_runtime', 'runtime', 'Среда Telegram', cfg.botToken ? 'pass' : 'fail',
    cfg.botToken ? 'Bot token доступен Worker.' : 'TELEGRAM_BOT_TOKEN отсутствует.', true));
  checks.push(rcCheck('football_key', 'runtime', 'API-Football runtime', cfg.apiFootballKey ? 'pass' : 'fail',
    cfg.apiFootballKey ? 'API key доступен Worker.' : 'API_FOOTBALL_KEY отсутствует.', true));
  checks.push(rcCheck('supabase_runtime', 'runtime', 'Supabase runtime', hasSupabase(cfg) ? 'pass' : 'fail',
    hasSupabase(cfg) ? 'URL и service key доступны.' : 'SUPABASE_URL/service key отсутствуют.', true));

  const backendSecurity = await readBackendSecurityContract(cfg);
  checks.push(rcCheck(
    'backend_security_contract',
    'security',
    'Least-privilege контракт Supabase',
    backendSecurity.ok ? 'pass' : 'fail',
    backendSecurity.ok
      ? 'RLS включён; прямые права anon/authenticated и публичный EXECUTE отсутствуют.'
      : `Security contract: ${backendSecurity.status || 'ошибка'}; примените supabase_migration_v6_11.sql.`,
    true
  ));

  const currentAdminOk = isAdminUser(user, cfg);
  const failClosedOk = !cfg.devMode && !isAdminUser({ id: 0 }, cfg);
  const devIsolationOk = !isAdminUser({ id: 5195504559 }, { ...cfg, devMode: true, adminTelegramIds: [] })
    && isAdminUser({ id: DEVELOPMENT_TELEGRAM_ID, __developmentIdentity: true }, { ...cfg, devMode: true, adminTelegramIds: [] });
  checks.push(rcCheck('admin_current', 'security', 'Текущий пользователь — admin', currentAdminOk ? 'pass' : 'fail',
    currentAdminOk ? 'Server-side Telegram initData подтверждён и ID разрешён.' : 'Текущий user не проходит admin gate.', true));
  checks.push(rcCheck('admin_fail_closed', 'security', 'Защита доступа администратора', failClosedOk ? 'pass' : 'fail',
    failClosedOk ? 'Неизвестный Telegram ID не получает admin role.' : 'Проверьте DEV_MODE/admin gate.', true));
  checks.push(rcCheck('admin_dev_isolation', 'security', 'DEV_MODE не повышает реальных пользователей', devIsolationOk ? 'pass' : 'fail',
    devIsolationOk ? 'Только серверная synthetic dev-identity получает dev admin role.' : 'DEV_MODE admin isolation нарушена.', true));
  checks.push(rcCheck('admin_list', 'security', 'Список администраторов настроен', cfg.adminTelegramIds?.length ? 'pass' : 'fail',
    cfg.adminTelegramIds?.length ? `Настроено ID: ${cfg.adminTelegramIds.length}. Значения не раскрываются.` : 'Список администраторов пуст.', true));

  // 2) Persistence schema regression.
  const requiredTables = [
    ['users', 'Users', true],
    ['usage_daily', 'Usage quota', true],
    ['analysis_cache', 'Shared cache', true],
    ['analysis_history', 'Analysis history', true],
    ['favorites', 'Favorites', true],
    ['user_preferences', 'Preferences', true],
    ['match_reminders', 'Reminders', true],
    ['runtime_controls', 'Runtime controls', true],
    ['runtime_control_history', 'Runtime rollback history', true],
    ['model_predictions', 'Model predictions', true],
    ['model_calibration_validations', 'Calibration promotion audit', true],
    ['model_calibration_profiles', 'Calibration profile registry', true],
    ['model_calibration_state', 'Calibration active state', true],
    ['model_calibration_transitions', 'Atomic calibration transition audit', true],
    ['prediction_integrity_actions', 'Prediction remediation audit', true],
    ['ops_events', 'Observability', false],
    ['match_integrity_runs', 'Integrity runs', true],
    ['match_integrity_events', 'Integrity events', true],
    ['odds_snapshots', 'Odds history', false],
    ['billing_payments', 'Billing storage (paused)', false],
  ];

  const tableResults = await Promise.all(requiredTables.map(async ([table, label, blocking]) => {
    const result = await probeOptionalTable(cfg, table);
    return { table, label, blocking, ...result };
  }));

  for (const table of tableResults) {
    const state = table.ok ? 'pass' : table.blocking ? 'fail' : 'warn';
    checks.push(rcCheck(
      `table_${table.table}`,
      'database',
      table.label,
      state,
      table.ok ? `${table.table}: доступна.` : `${table.table}: ${table.status || 'ошибка'}.`,
      table.blocking
    ));
  }

  const runtimeState = await loadRuntimeControls(cfg, { force: true });
  checks.push(rcCheck(
    'runtime_controls_state',
    'runtime',
    'Управление функциями',
    runtimeState.schemaReady ? 'pass' : 'fail',
    runtimeState.schemaReady
      ? `Revision ${Number(runtimeState.value?.revision || 1)} · ${runtimeState.value?.maintenanceMode ? 'maintenance ON' : 'normal mode'} · auto-settlement ${runtimeState.value?.autoSettlementRecoveryEnabled ? 'ON' : 'shadow'}.`
      : 'Запустите supabase_migration_v5_7.sql.',
    true
  ));

  const watchdogSchema = await probeSettlementWatchdogSchema(cfg);
  checks.push(rcCheck(
    'settlement_watchdog_schema',
    'database',
    'Схема контроля результатов v6.4',
    watchdogSchema.ok ? 'pass' : 'fail',
    watchdogSchema.ok ? 'Runtime switch + trigger_source доступны.' : 'Запустите supabase_migration_v6_2.sql.',
    true
  ));

  const runtimeHistorySchema = await probeRuntimeHistorySchema(cfg);
  checks.push(rcCheck(
    'runtime_history_schema',
    'database',
    'История откатов v5.8',
    runtimeHistorySchema.ok ? 'pass' : 'fail',
    runtimeHistorySchema.ok ? 'История revision и rollback доступны.' : 'Запустите supabase_migration_v5_8.sql.',
    true
  ));

  const reminderSchema = await probeReminderReliabilitySchema(cfg);
  checks.push(rcCheck(
    'reminder_delivery_schema',
    'database',
    'Схема доставки уведомлений v5.6',
    reminderSchema.ok ? 'pass' : 'fail',
    reminderSchema.ok ? 'Atomic delivery claim columns доступны.' : 'Запустите supabase_migration_v5_6.sql.',
    true
  ));

  const calibrationSelfTest = calibrationPromotionSelfTest();
  checks.push(rcCheck(
    'calibration_promotion_selftest',
    'safety',
    'Calibration Promotion self-test',
    calibrationSelfTest.pass ? 'pass' : 'fail',
    calibrationSelfTest.pass
      ? `stableActive=${calibrationSelfTest.stableActive}; holdout=${calibrationSelfTest.stableValidation}; overfitBlocked=${calibrationSelfTest.overfitBlocked}.`
      : 'Calibration Promotion self-test не прошёл.',
    true
  ));

  // 3) Read-only user route regression. No mutation and no API-Football usage.
  const readRoutes = await Promise.all([
    rcReadRoute('Profile', () => apiMe(request, cfg, user)),
    rcReadRoute('Favorites', () => apiFavorites(new Request(request.url, { method: 'GET', headers: request.headers }), cfg, user)),
    rcReadRoute('Reminders', () => apiReminders(new Request(request.url, { method: 'GET', headers: request.headers }), cfg, user)),
    rcReadRoute('Preferences', () => apiPreferences(new Request(request.url, { method: 'GET', headers: request.headers }), cfg, user)),
    rcReadRoute('History', () => apiHistory(new Request(request.url, { method: 'GET', headers: request.headers }), cfg, user)),
  ]);

  for (const route of readRoutes) {
    checks.push(rcCheck(
      `read_${route.label.toLowerCase()}`,
      'user_routes',
      `${route.label} GET`,
      route.ok ? 'pass' : 'fail',
      route.ok
        ? `HTTP ${route.status} · ${route.latencyMs} мс · shape: ${route.shape.join(', ') || 'object'}.`
        : `HTTP ${route.status || '—'} · ${route.error || 'route failed'}.`,
      true
    ));
  }

  // 4) Existing release/safety gates.
  let release = null;
  let production = null;
  try { release = await responseJsonSafe(await apiReleaseReadiness(new Request(`${url.origin}/api/release-readiness?refresh=1`), cfg)); } catch {}
  try { production = await responseJsonSafe(await apiProductionReadiness(new Request(`${url.origin}/api/production-readiness?refresh=1`), cfg)); } catch {}

  checks.push(rcCheck(
    'release_gate',
    'gates',
    'Core Release Readiness',
    release?.status === 'blocked' ? 'fail' : release?.available ? (release?.status === 'ready' ? 'pass' : 'warn') : 'fail',
    release?.available ? `${release.label || release.status} · ${Number(release.score || 0)}%.` : 'Release Readiness недоступен.',
    true
  ));
  checks.push(rcCheck(
    'production_gate',
    'gates',
    'Защита от нагрузки',
    production?.status === 'blocked' ? 'fail' : production?.available ? (production?.status === 'ready' ? 'pass' : 'warn') : 'fail',
    production?.available ? `${production.label || production.status} · ${Number(production.score || 0)}%.` : 'Production Safety Gate недоступен.',
    true
  ));

  const transition = providerTransitionProfile();
  const budget = providerBudgetProfile();
  const lastE2E = await loadLastProviderE2E(cfg);

  checks.push(rcCheck(
    'provider_mode',
    'provider',
    'Provider mode',
    budget.mode === 'emergency' ? 'warn' : 'pass',
    `${transition.plan} · ${budget.label}.`,
    false
  ));
  checks.push(rcCheck(
    'expanded_e2e',
    'provider',
    'Expanded Data E2E',
    transition.paid
      ? (lastE2E?.status?.ready ? 'pass' : 'warn')
      : 'warn',
    transition.paid
      ? (lastE2E?.status?.ready ? `${lastE2E.status.label} · fixture ${lastE2E.fixtureId}.` : 'Расширенный тариф обнаружен, но E2E ещё не подтверждён.')
      : 'FREE/HOLD допустим для RC ядра; полный expanded E2E выполняется после увеличения квоты.',
    false
  ));

  // 5) Static server-side invariants.
  const integritySelfTest = modelIntegritySelfTest();
  checks.push(rcCheck(
    'prediction_integrity_selftest',
    'safety',
    'Самопроверка целостности прогнозов',
    integritySelfTest.pass ? 'pass' : 'fail',
    integritySelfTest.pass
      ? 'Synthetic missing/invalid probabilities, captured_at timing, stale pending и outcome consistency обнаруживаются ожидаемо.'
      : 'Prediction Integrity self-test не прошёл.',
    true
  ));

  const remediationSelfTest = modelRemediationSelfTest();
  checks.push(rcCheck(
    'prediction_remediation_selftest',
    'safety',
    'Prediction Remediation self-test',
    remediationSelfTest.pass ? 'pass' : 'fail',
    remediationSelfTest.pass
      ? `${remediationSelfTest.candidates} stale candidates → ${remediationSelfTest.selected} selected across ${remediationSelfTest.dates} date batch(es).`
      : 'Prediction Remediation selection self-test не прошёл.',
    true
  ));

  const watchdogSelfTest = settlementWatchdogSelfTest();
  checks.push(rcCheck(
    'settlement_watchdog_selftest',
    'safety',
    'Самопроверка контроля результатов',
    watchdogSelfTest.pass ? 'pass' : 'fail',
    watchdogSelfTest.pass
      ? `shadow=${watchdogSelfTest.shadow}; runtime=${watchdogSelfTest.runtime}; quota=${watchdogSelfTest.quota}; active=${watchdogSelfTest.active}; clean=${watchdogSelfTest.clean}.`
      : 'Settlement Watchdog decision self-test не прошёл.',
    true
  ));

  const safety = productionSafetySnapshot();
  checks.push(rcCheck('singleflight', 'safety', 'Server SingleFlight', 'pass',
    `${Number(safety.singleflight?.joins || 0)} joins; ${Number(safety.singleflight?.active || 0)} active.`, true));
  checks.push(rcCheck('burst_guard', 'safety', 'Burst Guard policies', Number(safety.burstGuard?.policies?.length || 0) >= 8 ? 'pass' : 'fail',
    `${Number(safety.burstGuard?.policies?.length || 0)} route policies.`, true));
  checks.push(rcCheck('timeouts', 'safety', 'Upstream timeouts', 'pass',
    `Supabase ${Number(safety.upstream?.supabaseTimeoutMs || 0)} мс; API-Football ${Number(safety.upstream?.apiFootballTimeoutMs || 0)} мс.`, true));
  checks.push(rcCheck('l1_bounds', 'safety', 'Bounded L1 cache', Number(safety.memory?.cacheEntries || 0) <= 600 ? 'pass' : 'warn',
    `${Number(safety.memory?.cacheEntries || 0)} entries; soft limit ${Number(safety.memory?.cacheSoftLimit || 500)}.`, false));

  const blockers = checks.filter(x => x.state === 'fail' && x.blocking);
  const warnings = checks.filter(x => x.state === 'warn' || (x.state === 'fail' && !x.blocking));
  const passed = checks.filter(x => x.state === 'pass').length;
  const score = Math.round((passed / Math.max(1, checks.length)) * 100);
  const status = blockers.length ? 'blocked' : warnings.length ? 'rc_with_holds' : 'rc_ready';

  const groups = {};
  for (const check of checks) {
    groups[check.group] ||= { total: 0, pass: 0, warn: 0, fail: 0 };
    groups[check.group].total += 1;
    groups[check.group][check.state] = Number(groups[check.group][check.state] || 0) + 1;
  }

  const value = {
    available: true,
    releaseCandidate: RC_NAME,
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    status,
    label: blockers.length
      ? 'RC заблокирован: есть обязательные ошибки'
      : warnings.length
        ? `${RC_NAME} готов к проверке, есть ожидаемые HOLD/WARN`
        : `${RC_NAME} regression gate пройден`,
    score,
    summary: {
      total: checks.length,
      passed,
      warnings: warnings.length,
      blockers: blockers.length,
    },
    groups,
    checks,
    readRoutes,
    tableResults: tableResults.map(x => ({ table: x.table, ok: x.ok, status: x.status, blocking: x.blocking })),
    provider: {
      plan: transition.plan,
      mode: budget.mode,
      expandedE2E: lastE2E?.status?.code || (transition.paid ? 'NOT_RUN' : 'HOLD_FREE'),
    },
    policy: {
      mutatesUserData: false,
      consumesFootballApi: false,
      sqlRequired: false,
      payments: 'paused',
      note: 'RC smoke-test проверяет runtime, schema, read-only user routes, security и safety gates. Он не запускает Analyze и не расходует API-Football.',
    },
  };

  memory.rcRegression = { at: now, value };
  await recordOpsEvent(cfg, {
    severity: blockers.length ? 'error' : warnings.length ? 'warning' : 'info',
    source: 'release',
    eventType: 'rc_regression',
    code: blockers.length ? 'RC_BLOCKED' : warnings.length ? 'RC_WITH_HOLDS' : 'RC_READY',
    message: value.label,
    meta: {
      releaseCandidate: RC_NAME,
      score,
      blockers: blockers.map(x => x.id),
      warnings: warnings.map(x => x.id),
      durationMs: value.durationMs,
    },
  }).catch(() => {});

  return json(value);
}

async function tavilySearch(query, cfg) {
  if (!cfg.tavilyKey) return { answer: '', results: [] };
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.tavilyKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `${query}. Дай только проверяемые факты. Итоговую краткую сводку сформулируй на русском языке.`,
        topic: 'general',
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!r.ok) return { answer: '', results: [] };
    const body = await r.json();
    return {
      answer: String(body.answer || ''),
      results: (body.results || []).slice(0, 5).map(x => ({
        title: x.title || '', url: x.url || '', content: x.content || '',
      })),
    };
  } catch {
    return { answer: '', results: [] };
  }
}

function parsePercent(value) {
  const num = Number(String(value ?? '').replace('%', '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}
function round1(n) { return Math.round(n * 10) / 10; }
function normalizeThree(a, b, c) {
  const sum = a + b + c;
  if (!sum) return null;
  return { home: round1(a / sum * 100), draw: round1(b / sum * 100), away: round1(c / sum * 100) };
}
function extractMarket(oddsRows) {
  const samples = [];
  for (const row of oddsRows || []) {
    for (const bookmaker of row.bookmakers || []) {
      const bet = (bookmaker.bets || []).find(b => String(b.name || '').toLowerCase().includes('match winner'));
      if (!bet) continue;
      const vals = bet.values || [];
      const home = Number(vals.find(v => String(v.value).toLowerCase() === 'home')?.odd);
      const draw = Number(vals.find(v => String(v.value).toLowerCase() === 'draw')?.odd);
      const away = Number(vals.find(v => String(v.value).toLowerCase() === 'away')?.odd);
      if (home > 1 && draw > 1 && away > 1) samples.push({ home, draw, away });
    }
  }
  if (!samples.length) return null;
  const avg = key => samples.reduce((s, x) => s + x[key], 0) / samples.length;
  const odds = { home: round1(avg('home')), draw: round1(avg('draw')), away: round1(avg('away')) };
  return { odds, probabilities: normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away), bookmakers: samples.length };
}
function extractLiveMarket(rows) {
  const candidates = [];
  const pushValues = (name, values, update = '') => {
    const key = String(name || '').toLowerCase();
    if (!/(match winner|winner|1x2|fulltime result|full time result)/i.test(key)) return;
    let home = null, draw = null, away = null;
    for (const v of values || []) {
      const label = String(v.value ?? v.name ?? v.label ?? '').trim().toLowerCase();
      const odd = Number(v.odd ?? v.odds ?? v.price);
      if (!(odd > 1)) continue;
      if (['home','1'].includes(label) || label.includes('home')) home = odd;
      else if (['draw','x'].includes(label) || label.includes('draw')) draw = odd;
      else if (['away','2'].includes(label) || label.includes('away')) away = odd;
    }
    if (home && draw && away) candidates.push({ home, draw, away, update });
  };
  for (const row of rows || []) {
    const update = row.update || row.updated_at || row.updatedAt || '';
    for (const bet of row.odds || []) pushValues(bet.name || bet.bet || bet.id, bet.values || bet.outcomes || [], update);
    for (const bookmaker of row.bookmakers || []) {
      for (const bet of bookmaker.bets || bookmaker.odds || []) pushValues(bet.name || bet.bet || bet.id, bet.values || bet.outcomes || [], update);
    }
  }
  if (!candidates.length) return null;
  const avg = key => candidates.reduce((sum, x) => sum + x[key], 0) / candidates.length;
  const odds = { home: round1(avg('home')), draw: round1(avg('draw')), away: round1(avg('away')) };
  return { odds, probabilities: normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away), sources: candidates.length, updatedAt: candidates.find(x => x.update)?.update || '' };
}


function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatPlayerLeaders(rows, homeId, awayId) {
  const sides = { home: [], away: [] };
  for (const teamRow of rows || []) {
    const teamId = Number(teamRow.team?.id || 0);
    const side = teamId === Number(homeId) ? 'home' : teamId === Number(awayId) ? 'away' : '';
    if (!side) continue;
    for (const entry of teamRow.players || []) {
      const st = entry.statistics?.[0] || {};
      const rating = numericValue(st.games?.rating);
      const minutes = numericValue(st.games?.minutes) || 0;
      const goals = numericValue(st.goals?.total) || 0;
      const assists = numericValue(st.goals?.assists) || 0;
      const saves = numericValue(st.goals?.saves) || 0;
      const shotsOn = numericValue(st.shots?.on) || 0;
      const keyPasses = numericValue(st.passes?.key) || 0;
      const tackles = numericValue(st.tackles?.total) || 0;
      const interceptions = numericValue(st.tackles?.interceptions) || 0;
      if (!minutes && rating === null && !goals && !assists && !saves && !shotsOn && !keyPasses) continue;
      const impact = (rating || 0) * 10 + goals * 20 + assists * 14 + saves * 2 + shotsOn * 2 + keyPasses * 1.5 + tackles + interceptions;
      sides[side].push({
        id: Number(entry.player?.id || 0),
        name: entry.player?.name || 'Игрок',
        photo: entry.player?.photo || '',
        position: st.games?.position || '',
        rating: rating !== null ? Math.round(rating * 10) / 10 : null,
        minutes,
        goals,
        assists,
        saves,
        shotsOn,
        keyPasses,
        tackles,
        interceptions,
        impact: Math.round(impact * 10) / 10,
      });
    }
  }
  for (const side of ['home','away']) {
    sides[side].sort((a,b) => b.impact - a.impact || (b.rating || 0) - (a.rating || 0) || b.minutes - a.minutes);
    sides[side] = sides[side].slice(0, 6);
  }
  return sides;
}

function livePressure(statistics) {
  const rows = statistics?.items || [];
  if (!rows.length) return null;
  const get = key => rows.find(x => x.key === key) || {};
  const val = (x, side) => numericValue(x?.[side]) || 0;
  const totalShots = get('Total Shots');
  const shotsOn = get('Shots on Goal');
  const corners = get('Corner Kicks');
  const possession = get('Ball Possession');
  const reds = get('Red Cards');
  const saves = get('Goalkeeper Saves');
  const score = side => (
    val(shotsOn, side) * 4.2 +
    val(totalShots, side) * 1.25 +
    val(corners, side) * 1.4 +
    val(possession, side) * 0.07 +
    val(saves, side === 'home' ? 'away' : 'home') * 0.8 -
    val(reds, side) * 7
  );
  const h = Math.max(0, score('home'));
  const a = Math.max(0, score('away'));
  if (h + a < 1) return null;
  const home = Math.round(h / (h + a) * 100);
  const away = 100 - home;
  const diff = home - away;
  return {
    home, away,
    leader: Math.abs(diff) < 10 ? 'balanced' : diff > 0 ? 'home' : 'away',
    note: 'Эвристика давления по ударам, владению, угловым, сейвам и карточкам. Это не вероятность победы.',
  };
}


function smartStat(statistics, key, side) {
  const row = (statistics?.items || []).find(x => x.key === key);
  return numericValue(row?.[side]);
}

function smartSideName(side, homeName, awayName) {
  return side === 'home' ? homeName : side === 'away' ? awayName : '';
}

function smartInsight(type, side, icon, title, text, importance = 'medium', metrics = []) {
  return { type, side, icon, title, text, importance, metrics };
}

function recentEventSummary(events, elapsed, homeName, awayName) {
  if (!Array.isArray(events) || !events.length || !Number.isFinite(Number(elapsed))) return null;
  const cutoff = Math.max(0, Number(elapsed) - 15);
  const recent = events.filter(e => Number(e.minute || 0) >= cutoff);
  if (!recent.length) return null;

  const score = { home: 0, away: 0 };
  const key = { home: 0, away: 0 };
  for (const e of recent) {
    const side = e.side === 'home' || e.side === 'away' ? e.side : '';
    if (!side) continue;
    const t = String(e.type || '').toLowerCase();
    const d = String(e.detail || '').toLowerCase();
    if (t === 'goal' && !d.includes('missed')) { score[side] += 1; key[side] += 4; }
    else if (t === 'card' && d.includes('red')) key[side] -= 2;
    else if (t === 'var') key[side] += 1;
  }

  const diff = key.home - key.away;
  if (score.home || score.away) {
    const leader = score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'balanced';
    return {
      leader,
      title: 'Последние 15 минут',
      text: leader === 'balanced'
        ? `На последнем отрезке команды обменялись голевыми событиями (${score.home}:${score.away}).`
        : `${smartSideName(leader, homeName, awayName)} активнее на последнем отрезке: голы за 15 минут — ${score[leader]}:${score[leader === 'home' ? 'away' : 'home']}.`,
      homeScore: key.home,
      awayScore: key.away,
    };
  }
  if (Math.abs(diff) >= 2) {
    const leader = diff > 0 ? 'home' : 'away';
    return {
      leader,
      title: 'Последний отрезок',
      text: `${smartSideName(leader, homeName, awayName)} чаще оказывается в центре ключевых событий последних 15 минут.`,
      homeScore: key.home,
      awayScore: key.away,
    };
  }
  return null;
}

function buildSmartMatchInsights({
  statistics, events, pressure, score, elapsed, status,
  homeName, awayName, playerLeaders, absences,
}) {
  const insights = [];
  const homeGoals = numericValue(score?.home) ?? 0;
  const awayGoals = numericValue(score?.away) ?? 0;

  const hs = smartStat(statistics, 'Total Shots', 'home');
  const as = smartStat(statistics, 'Total Shots', 'away');
  const hso = smartStat(statistics, 'Shots on Goal', 'home');
  const aso = smartStat(statistics, 'Shots on Goal', 'away');
  const hxg = smartStat(statistics, 'expected_goals', 'home');
  const axg = smartStat(statistics, 'expected_goals', 'away');
  const hpos = smartStat(statistics, 'Ball Possession', 'home');
  const apos = smartStat(statistics, 'Ball Possession', 'away');
  const hcorn = smartStat(statistics, 'Corner Kicks', 'home');
  const acorn = smartStat(statistics, 'Corner Kicks', 'away');
  const hsaves = smartStat(statistics, 'Goalkeeper Saves', 'home');
  const asaves = smartStat(statistics, 'Goalkeeper Saves', 'away');
  const hred = smartStat(statistics, 'Red Cards', 'home') || 0;
  const ared = smartStat(statistics, 'Red Cards', 'away') || 0;

  if (pressure && Math.abs(Number(pressure.home || 0) - Number(pressure.away || 0)) >= 12) {
    const side = pressure.home > pressure.away ? 'home' : 'away';
    const own = side === 'home' ? pressure.home : pressure.away;
    const opp = side === 'home' ? pressure.away : pressure.home;
    insights.push(smartInsight(
      'pressure', side, '⚡', 'Территориальное давление',
      `${smartSideName(side, homeName, awayName)} сильнее по совокупности ударов, владения, угловых и других доступных метрик (${own}:${opp} по индексу давления).`,
      Math.abs(own - opp) >= 24 ? 'high' : 'medium',
      [{ label: 'Индекс давления', home: pressure.home, away: pressure.away }]
    ));
  }

  if (hxg !== null && axg !== null && Math.abs(hxg - axg) >= 0.45) {
    const side = hxg > axg ? 'home' : 'away';
    insights.push(smartInsight(
      'chance_quality', side, '🎯', 'Качество моментов',
      `${smartSideName(side, homeName, awayName)} создаёт более качественные моменты по xG: ${hxg.toFixed(2)} — ${axg.toFixed(2)}.`,
      Math.abs(hxg - axg) >= 0.9 ? 'high' : 'medium',
      [{ label: 'xG', home: hxg, away: axg }]
    ));
  } else if (hso !== null && aso !== null && hs !== null && as !== null) {
    const shotEdge = (hso - aso) * 2 + (hs - as) * 0.45;
    if (Math.abs(shotEdge) >= 3) {
      const side = shotEdge > 0 ? 'home' : 'away';
      insights.push(smartInsight(
        'chance_volume', side, '🥅', 'Объём атак',
        `${smartSideName(side, homeName, awayName)} чаще доводит атаки до ударов: ${hs}:${as}, в створ — ${hso}:${aso}.`,
        'medium',
        [{ label: 'Удары', home: hs, away: as }, { label: 'В створ', home: hso, away: aso }]
      ));
    }
  }

  const scoreLeader = homeGoals > awayGoals ? 'home' : awayGoals > homeGoals ? 'away' : 'balanced';
  let performanceLeader = 'balanced';
  if (hxg !== null && axg !== null && Math.abs(hxg - axg) >= 0.5) performanceLeader = hxg > axg ? 'home' : 'away';
  else if (hso !== null && aso !== null && hs !== null && as !== null) {
    const perf = (hso - aso) * 2 + (hs - as) * 0.5;
    if (Math.abs(perf) >= 3.5) performanceLeader = perf > 0 ? 'home' : 'away';
  }
  if (scoreLeader !== 'balanced' && performanceLeader !== 'balanced' && scoreLeader !== performanceLeader) {
    insights.push(smartInsight(
      'score_mismatch', performanceLeader, '↔️', 'Счёт расходится с картиной игры',
      `${smartSideName(scoreLeader, homeName, awayName)} ведёт ${homeGoals}:${awayGoals}, но по качеству/объёму моментов сильнее выглядит ${smartSideName(performanceLeader, homeName, awayName)}.`,
      'high'
    ));
  } else if (scoreLeader === 'balanced' && performanceLeader !== 'balanced') {
    insights.push(smartInsight(
      'score_mismatch', performanceLeader, '↔️', 'При равном счёте есть перевес',
      `Счёт равный, но ${smartSideName(performanceLeader, homeName, awayName)} имеет заметное преимущество по доступным атакующим показателям.`,
      'medium'
    ));
  }

  if (hxg !== null && homeGoals - hxg >= 0.8) {
    insights.push(smartInsight('finishing', 'home', '🔥', 'Реализация выше ожидаемой',
      `${homeName} забил ${homeGoals} при xG ${hxg.toFixed(2)} — реализация заметно выше качества созданных моментов.`, 'medium'));
  }
  if (axg !== null && awayGoals - axg >= 0.8) {
    insights.push(smartInsight('finishing', 'away', '🔥', 'Реализация выше ожидаемой',
      `${awayName} забил ${awayGoals} при xG ${axg.toFixed(2)} — реализация заметно выше качества созданных моментов.`, 'medium'));
  }

  if (hred > 0 || ared > 0) {
    const side = hred > ared ? 'home' : ared > hred ? 'away' : 'balanced';
    const text = side === 'balanced'
      ? `У обеих команд есть удаления (${hred}:${ared}), что сильно меняет структуру матча.`
      : `${smartSideName(side, homeName, awayName)} играет в меньшинстве: красные карточки ${hred}:${ared}.`;
    insights.push(smartInsight('discipline', side, '🟥', 'Удаление влияет на матч', text, 'high'));
  }

  if (hsaves !== null && hsaves >= 4 && (aso === null || aso >= hsaves)) {
    insights.push(smartInsight('goalkeeper', 'home', '🧤', 'Вратарь удерживает хозяев',
      `Вратарь ${homeName} уже сделал ${hsaves} сейвов — его вклад заметен в текущем счёте.`, 'medium'));
  }
  if (asaves !== null && asaves >= 4 && (hso === null || hso >= asaves)) {
    insights.push(smartInsight('goalkeeper', 'away', '🧤', 'Вратарь удерживает гостей',
      `Вратарь ${awayName} уже сделал ${asaves} сейвов — его вклад заметен в текущем счёте.`, 'medium'));
  }

  if (hpos !== null && apos !== null && Math.abs(hpos - apos) >= 16) {
    const side = hpos > apos ? 'home' : 'away';
    insights.push(smartInsight('possession', side, '🧠', 'Контроль мяча',
      `${smartSideName(side, homeName, awayName)} значительно больше владеет мячом: ${hpos}% — ${apos}%. Владение само по себе не гарантирует более опасные моменты.`,
      'low'));
  }

  if (hcorn !== null && acorn !== null && Math.abs(hcorn - acorn) >= 5) {
    const side = hcorn > acorn ? 'home' : 'away';
    insights.push(smartInsight('territory', side, '🚩', 'Территориальный перевес',
      `${smartSideName(side, homeName, awayName)} чаще доводит атаки до угловых: ${hcorn}:${acorn}.`, 'low'));
  }

  const recent = recentEventSummary(events, elapsed, homeName, awayName);
  if (recent) {
    insights.push(smartInsight('recent_phase', recent.leader, '⏱️', recent.title, recent.text, 'medium'));
  }

  const leaders = [
    ...(playerLeaders?.home || []).map(p => ({ ...p, side: 'home' })),
    ...(playerLeaders?.away || []).map(p => ({ ...p, side: 'away' })),
  ].filter(p => Number(p.rating || 0) >= 7.5).sort((a,b) => Number(b.rating || 0) - Number(a.rating || 0));
  if (leaders[0]) {
    const p = leaders[0];
    insights.push(smartInsight('player', p.side, '⭐', 'Выделяется игрок',
      `${p.name} — один из самых заметных по доступной статистике${p.rating ? `, рейтинг ${Number(p.rating).toFixed(1)}` : ''}${p.goals ? `, голов: ${p.goals}` : ''}${p.assists ? `, ассистов: ${p.assists}` : ''}.`,
      'low'));
  }

  const hAbs = absences?.home?.length || 0;
  const aAbs = absences?.away?.length || 0;
  if (Math.abs(hAbs - aAbs) >= 2 && Math.max(hAbs, aAbs) >= 2) {
    const side = hAbs > aAbs ? 'home' : 'away';
    insights.push(smartInsight('availability', side, '🩺', 'Разница по потерям',
      `${smartSideName(side, homeName, awayName)} имеет больше подтверждённых потерь состава: ${hAbs}:${aAbs}.`, 'low'));
  }

  if (Number.isFinite(Number(elapsed)) && Number(elapsed) >= 20 && hs !== null && as !== null) {
    const projectedShots = ((hs + as) / Math.max(1, Number(elapsed))) * 90;
    if (projectedShots >= 28) {
      insights.push(smartInsight('tempo', 'balanced', '🏃', 'Высокий темп',
        `По текущей частоте ударов матч идёт в высоком темпе — около ${Math.round(projectedShots)} ударов в пересчёте на 90 минут.`, 'low'));
    } else if (projectedShots <= 13 && Number(elapsed) >= 35) {
      insights.push(smartInsight('tempo', 'balanced', '🧱', 'Закрытый характер',
        `Ударов немного для текущей минуты матча — темп создания моментов пока низкий.`, 'low'));
    }
  }

  const importanceRank = { high: 3, medium: 2, low: 1 };
  const typeRank = { score_mismatch: 9, discipline: 8, chance_quality: 7, pressure: 6, chance_volume: 5, goalkeeper: 4, recent_phase: 3, finishing: 3, possession: 2, territory: 2, player: 1, availability: 1, tempo: 1 };
  insights.sort((a,b) => (importanceRank[b.importance] - importanceRank[a.importance]) || ((typeRank[b.type] || 0) - (typeRank[a.type] || 0)));

  const coverageParts = [
    hxg !== null && axg !== null,
    hs !== null && as !== null,
    hso !== null && aso !== null,
    hpos !== null && apos !== null,
    Array.isArray(events) && events.length > 0,
    Boolean(pressure),
    (playerLeaders?.home?.length || 0) + (playerLeaders?.away?.length || 0) > 0,
  ];
  const dataScore = Math.round(coverageParts.filter(Boolean).length / coverageParts.length * 100);
  const dataLabel = dataScore >= 75 ? 'Высокое покрытие' : dataScore >= 45 ? 'Среднее покрытие' : 'Базовое покрытие';

  const main = insights[0] || null;
  const headline = main?.title || (pressure?.leader === 'balanced' ? 'Матч выглядит сбалансированным' : 'Недостаточно данных для сильного вывода');
  const summary = main?.text || 'Доступных событий и статистики пока недостаточно для содержательного автоматического вывода.';

  return {
    available: Boolean(insights.length),
    headline,
    summary,
    dataScore,
    dataLabel,
    insights: insights.slice(0, 7),
    methodology: 'Автоматические выводы строятся только из текущего счёта, событий и официальной статистики матча. Это объяснение происходящего, а не прогноз результата.',
    generatedForStatus: String(status || ''),
  };
}

async function getOddsSnapshots(fixtureId, cfg, limit = 12) {
  if (hasSupabase(cfg)) {
    try {
      const rows = await supaSelectMany(cfg, 'odds_snapshots', {
        fixture_id: `eq.${Number(fixtureId)}`,
        market: 'eq.1x2',
      }, { limit, order: 'snapshot_time.desc' });
      return (rows || []).map(x => ({
        at: x.snapshot_time,
        home: Number(x.home_odd), draw: Number(x.draw_odd), away: Number(x.away_odd),
        homeProb: Number(x.home_prob), drawProb: Number(x.draw_prob), awayProb: Number(x.away_prob),
        sources: Number(x.source_count || 0),
      }));
    } catch { return []; }
  }
  return (memory.oddsSnapshots.get(Number(fixtureId)) || []).slice(-limit).reverse();
}

async function saveOddsSnapshot(fixtureId, market, cfg) {
  if (!market?.odds) return false;
  const previous = await getOddsSnapshots(fixtureId, cfg, 1);
  const prev = previous[0];
  const now = new Date();
  const changed = !prev || ['home','draw','away'].some(k => Math.abs(Number(market.odds[k]) - Number(prev[k])) >= 0.03);
  const oldEnough = !prev?.at || (now.getTime() - Date.parse(prev.at)) >= 120000;
  if (!changed && !oldEnough) return false;
  const p = market.probabilities || {};
  const row = {
    fixture_id: Number(fixtureId), market: '1x2', snapshot_time: now.toISOString(),
    home_odd: Number(market.odds.home), draw_odd: Number(market.odds.draw), away_odd: Number(market.odds.away),
    home_prob: Number(p.home || 0), draw_prob: Number(p.draw || 0), away_prob: Number(p.away || 0),
    source_count: Number(market.sources || market.bookmakers || 0),
  };
  if (hasSupabase(cfg)) {
    try { await supaUpsert(cfg, 'odds_snapshots', row); return true; } catch { return false; }
  }
  const list = memory.oddsSnapshots.get(Number(fixtureId)) || [];
  list.push({ at: row.snapshot_time, home: row.home_odd, draw: row.draw_odd, away: row.away_odd, homeProb: row.home_prob, drawProb: row.draw_prob, awayProb: row.away_prob, sources: row.source_count });
  memory.oddsSnapshots.set(Number(fixtureId), list.slice(-50));
  return true;
}

function buildOddsMovement(snapshots, current) {
  if (!current?.odds) return null;
  const history = Array.isArray(snapshots) ? snapshots.filter(x => x && x.at) : [];
  const baseline = history.length ? history[history.length - 1] : null;
  if (!baseline) return { sample: 1, baseline: null, current: current.odds, probabilityChange: null };
  const currentP = current.probabilities || normalizeThree(1/current.odds.home,1/current.odds.draw,1/current.odds.away) || {};
  const baseP = (baseline.homeProb || baseline.drawProb || baseline.awayProb)
    ? { home: baseline.homeProb, draw: baseline.drawProb, away: baseline.awayProb }
    : normalizeThree(1/baseline.home,1/baseline.draw,1/baseline.away) || {};
  const delta = key => Math.round(((Number(currentP[key] || 0) - Number(baseP[key] || 0)) * 10)) / 10;
  return {
    sample: history.length + 1,
    from: baseline.at,
    baseline: { home: baseline.home, draw: baseline.draw, away: baseline.away },
    current: current.odds,
    probabilityChange: { home: delta('home'), draw: delta('draw'), away: delta('away') },
  };
}

function extractPrediction(rows) {
  const p = rows?.[0]?.predictions;
  if (!p) return null;
  const home = parsePercent(p.percent?.home), draw = parsePercent(p.percent?.draw), away = parsePercent(p.percent?.away);
  return {
    probabilities: home !== null && draw !== null && away !== null ? normalizeThree(home, draw, away) : null,
    winner: p.winner?.name || '',
    winnerComment: p.winner?.comment || '',
    advice: p.advice || '',
    underOver: p.under_over || '',
    goals: p.goals || null,
  };
}
function combineProbabilities(market, model) {
  const m = market?.probabilities, p = model?.probabilities;
  if (m && p) return normalizeThree(m.home * 0.55 + p.home * 0.45, m.draw * 0.55 + p.draw * 0.45, m.away * 0.55 + p.away * 0.45);
  return m || p || null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function ymd(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : todayUtc();
}

function teamResult(fixture, teamId) {
  const homeId = Number(fixture.teams?.home?.id || 0);
  const awayId = Number(fixture.teams?.away?.id || 0);
  const isHome = homeId === Number(teamId);
  const isAway = awayId === Number(teamId);
  if (!isHome && !isAway) return null;
  const hg = Number(fixture.goals?.home ?? 0);
  const ag = Number(fixture.goals?.away ?? 0);
  const gf = isHome ? hg : ag;
  const ga = isHome ? ag : hg;
  return {
    date: fixture.fixture?.date || '',
    venue: isHome ? 'home' : 'away',
    opponent: isHome ? fixture.teams?.away?.name || '' : fixture.teams?.home?.name || '',
    opponentLogo: isHome ? fixture.teams?.away?.logo || '' : fixture.teams?.home?.logo || '',
    league: fixture.league?.name || '',
    gf,
    ga,
    result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
  };
}

function summarizeFormRows(rows, teamId, preferredVenue) {
  const all = (rows || [])
    .map(x => teamResult(x, teamId))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0));
  const last = all.slice(0, 5);
  const venue = all.filter(x => x.venue === preferredVenue).slice(0, 3);
  const summarize = list => {
    if (!list.length) return null;
    const wins = list.filter(x => x.result === 'W').length;
    const draws = list.filter(x => x.result === 'D').length;
    const losses = list.filter(x => x.result === 'L').length;
    const gf = list.reduce((s, x) => s + x.gf, 0);
    const ga = list.reduce((s, x) => s + x.ga, 0);
    return {
      sample: list.length,
      wins, draws, losses,
      ppg: round1((wins * 3 + draws) / list.length),
      gfAvg: round1(gf / list.length),
      gaAvg: round1(ga / list.length),
      gdAvg: round1((gf - ga) / list.length),
      bttsPct: round1(list.filter(x => x.gf > 0 && x.ga > 0).length / list.length * 100),
      over25Pct: round1(list.filter(x => x.gf + x.ga >= 3).length / list.length * 100),
      cleanSheetPct: round1(list.filter(x => x.ga === 0).length / list.length * 100),
      form: list.map(x => x.result).join(''),
      matches: list,
    };
  };
  return { overall: summarize(last), venue: summarize(venue), preferredVenue };
}

async function getRecentTeamForm(teamId, preferredVenue, fixtureDate, fixtureId, cfg, { allowNetwork = true } = {}) {
  if (!teamId) return null;
  const targetMs = Number.isFinite(Date.parse(fixtureDate || '')) ? Date.parse(fixtureDate) : Date.now();
  const to = ymd(new Date(targetMs - 60_000));
  const from = ymd(new Date(targetMs - 90 * 86400_000));
  const cacheKey = `teamform:${Number(teamId)}:${preferredVenue}:${to}:v2`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return cached;
  if (!allowNetwork) return null;
  const rows = await apiFootball('/fixtures', { team: Number(teamId), from, to }, cfg);
  const usable = rows.filter(x => {
    const id = Number(x.fixture?.id || 0);
    const dateMs = Date.parse(x.fixture?.date || '');
    return id !== Number(fixtureId) && isFinishedStatus(x.fixture?.status?.short) && Number.isFinite(dateMs) && dateMs < targetMs;
  });
  const summary = summarizeFormRows(usable, teamId, preferredVenue);
  await setCache(cacheKey, Number(fixtureId || teamId), summary, cfg, 120);
  return summary;
}

function formProbabilities(homeForm, awayForm) {
  const h = homeForm?.overall, a = awayForm?.overall;
  if (!h?.sample || !a?.sample) return null;
  const hv = homeForm?.venue?.sample >= 2 ? homeForm.venue.ppg : h.ppg;
  const av = awayForm?.venue?.sample >= 2 ? awayForm.venue.ppg : a.ppg;
  let edge = 4; // conservative home-field prior
  edge += clamp((h.ppg - a.ppg) * 8, -18, 18);
  edge += clamp((h.gdAvg - a.gdAvg) * 2.6, -10, 10);
  edge += clamp((hv - av) * 3.5, -8, 8);
  edge = clamp(edge, -24, 24);
  const draw = clamp(28.5 - Math.abs(edge) * 0.24, 20, 29);
  const remaining = 100 - draw;
  const homeShare = 1 / (1 + Math.exp(-edge / 8.5));
  return normalizeThree(remaining * homeShare, draw, remaining * (1 - homeShare));
}

function h2hProbabilities(h2h) {
  const total = Number(h2h?.homeWins || 0) + Number(h2h?.draws || 0) + Number(h2h?.awayWins || 0);
  if (!total) return null;
  return normalizeThree(Number(h2h.homeWins || 0) + 1, Number(h2h.draws || 0) + 1, Number(h2h.awayWins || 0) + 1);
}

function blendProbabilitySignals({ market, model, form, h2h, weightOverrides = null }) {
  const configured = weightOverrides && typeof weightOverrides === 'object' ? weightOverrides : MODEL_BASE_WEIGHTS;
  const candidates = [
    ['market', market?.probabilities, Number(configured.market ?? MODEL_BASE_WEIGHTS.market)],
    ['apiPrediction', model?.probabilities, Number(configured.apiPrediction ?? MODEL_BASE_WEIGHTS.apiPrediction)],
    ['recentForm', form, Number(configured.recentForm ?? MODEL_BASE_WEIGHTS.recentForm)],
    ['h2h', h2h, Number(configured.h2h ?? MODEL_BASE_WEIGHTS.h2h)],
  ].filter(([, p, w]) => p && [p.home, p.draw, p.away].every(x => Number.isFinite(Number(x))) && Number.isFinite(w) && w > 0);
  if (!candidates.length) return { probabilities: null, weights: {}, signals: [] };
  const weightSum = candidates.reduce((sum, x) => sum + x[2], 0);
  const weights = {};
  let home = 0, draw = 0, away = 0;
  const signals = [];
  for (const [name, p, rawWeight] of candidates) {
    const w = rawWeight / weightSum;
    weights[name] = round1(w * 100);
    home += Number(p.home) * w;
    draw += Number(p.draw) * w;
    away += Number(p.away) * w;
    signals.push({ name, probabilities: p, weight: round1(w * 100) });
  }
  return { probabilities: normalizeThree(home, draw, away), weights, signals };
}

function applyAbsenceAdjustment(probabilities, absences) {
  if (!probabilities) return null;
  const homeCount = Math.min(6, absences?.home?.length || 0);
  const awayCount = Math.min(6, absences?.away?.length || 0);
  const shift = clamp((awayCount - homeCount) * 0.55, -3.3, 3.3);
  return normalizeThree(probabilities.home + shift, probabilities.draw, probabilities.away - shift);
}

function poissonGoalModel(homeForm, awayForm) {
  const h = homeForm?.overall, a = awayForm?.overall;
  if (!h?.sample || !a?.sample || h.sample < 3 || a.sample < 3) return null;
  const hv = homeForm?.venue?.sample >= 2 ? homeForm.venue : h;
  const av = awayForm?.venue?.sample >= 2 ? awayForm.venue : a;
  const homeLambda = clamp(((h.gfAvg + a.gaAvg + hv.gfAvg + av.gaAvg) / 4) + 0.12, 0.35, 3.4);
  const awayLambda = clamp(((a.gfAvg + h.gaAvg + av.gfAvg + hv.gaAvg) / 4) - 0.03, 0.25, 3.2);
  const total = homeLambda + awayLambda;
  const underOrEqual2 = Math.exp(-total) * (1 + total + (total * total) / 2);
  const over25 = clamp((1 - underOrEqual2) * 100, 0, 100);
  const btts = clamp((1 - Math.exp(-homeLambda)) * (1 - Math.exp(-awayLambda)) * 100, 0, 100);
  return {
    homeExpected: round1(homeLambda),
    awayExpected: round1(awayLambda),
    totalExpected: round1(total),
    over25: round1(over25),
    btts: round1(btts),
  };
}

function outcomeName(probabilities, homeName, awayName) {
  if (!probabilities) return 'Недостаточно данных';
  const rows = [
    { key: 'home', label: homeName || 'П1', value: Number(probabilities.home) },
    { key: 'draw', label: 'Ничья', value: Number(probabilities.draw) },
    { key: 'away', label: awayName || 'П2', value: Number(probabilities.away) },
  ].sort((a, b) => b.value - a.value);
  return rows[0]?.label || 'Недостаточно данных';
}

function signalDisagreement(signals, finalP) {
  if (!finalP || !signals?.length) return null;
  const values = signals.map(s => (
    Math.abs(Number(s.probabilities.home) - Number(finalP.home)) +
    Math.abs(Number(s.probabilities.draw) - Number(finalP.draw)) +
    Math.abs(Number(s.probabilities.away) - Number(finalP.away))
  ) / 3);
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

function confidenceModel(signals, finalP, homeForm, awayForm) {
  const coverage = clamp((signals?.length || 0) / 4, 0, 1);
  const formSample = Math.min(1, Math.min(homeForm?.overall?.sample || 0, awayForm?.overall?.sample || 0) / 5);
  const disagreement = signalDisagreement(signals, finalP) ?? 18;
  const score = Math.round(clamp(38 + coverage * 34 + formSample * 12 - disagreement * 0.65, 30, 88));
  return {
    score,
    label: score >= 72 ? 'Высокая' : score >= 55 ? 'Средняя' : 'Низкая',
    disagreement,
    coverage: round1(coverage * 100),
  };
}

function buildAnalysisNotes({ probabilities, market, model, homeForm, awayForm, h2h, absences, lineups, news, homeName, awayName, minutesToKickoff, confidence }) {
  const factors = [];
  const risks = [];
  const hp = homeForm?.overall?.ppg, ap = awayForm?.overall?.ppg;
  if (Number.isFinite(hp) && Number.isFinite(ap) && Math.abs(hp - ap) >= 0.35) {
    factors.push(`${hp > ap ? homeName : awayName} лучше по форме последних матчей: ${Math.max(hp, ap).toFixed(1)} против ${Math.min(hp, ap).toFixed(1)} очка за игру.`);
  }
  if (market?.probabilities) {
    const leader = outcomeName(market.probabilities, homeName, awayName);
    factors.push(`Рынок 1X2 сильнее всего оценивает вариант «${leader}».`);
  }
  if (model?.winner) factors.push(`Прогноз API-Football указывает: ${model.winner}.`);
  const homeAbs = absences?.home?.length || 0, awayAbs = absences?.away?.length || 0;
  if (Math.abs(homeAbs - awayAbs) >= 2) factors.push(`${homeAbs > awayAbs ? homeName : awayName} имеет больше отмеченных потерь состава (${Math.max(homeAbs, awayAbs)} против ${Math.min(homeAbs, awayAbs)}).`);
  const h2hTotal = (h2h?.homeWins || 0) + (h2h?.draws || 0) + (h2h?.awayWins || 0);
  if (h2hTotal >= 3 && Math.abs((h2h.homeWins || 0) - (h2h.awayWins || 0)) >= 2) factors.push(`В последних очных матчах преимущество по победам у ${h2h.homeWins > h2h.awayWins ? homeName : awayName}.`);
  if (!market) risks.push('Нет доступной линии 1X2 — итог сильнее зависит от статистических источников.');
  if (!model?.probabilities) risks.push('API-Football не отдал процентный prediction для этого матча.');
  if ((homeForm?.overall?.sample || 0) < 4 || (awayForm?.overall?.sample || 0) < 4) risks.push('Небольшая выборка недавних матчей одной из команд.');
  if (confidence?.disagreement >= 10) risks.push('Источники заметно расходятся между собой — уверенность модели снижена.');
  if (minutesToKickoff !== null && minutesToKickoff <= 120 && !lineups?.home && !lineups?.away) risks.push('Подтверждённые стартовые составы ещё не доступны.');
  if (!news?.answer) risks.push('Не удалось получить свежий новостной контекст из веб-поиска.');
  if (!factors.length && probabilities) factors.push(`Наибольшая расчётная вероятность сейчас у варианта «${outcomeName(probabilities, homeName, awayName)}».`);
  return { factors: factors.slice(0, 5), risks: risks.slice(0, 5) };
}


function probabilityRanking(probabilities, homeName, awayName) {
  if (!probabilities) return [];
  return [
    { key: 'home', label: homeName || 'П1', value: Number(probabilities.home || 0) },
    { key: 'draw', label: 'Ничья', value: Number(probabilities.draw || 0) },
    { key: 'away', label: awayName || 'П2', value: Number(probabilities.away || 0) },
  ].sort((a, b) => b.value - a.value);
}

function preMatchDriver({ type, icon, side = 'neutral', title, text, strength = 'medium', source = '', weight = null, values = null }) {
  return { type, icon, side, title, text, strength, source, weight, values };
}

function signalDisplayName(name) {
  return ({
    market: 'Рынок 1X2',
    apiPrediction: 'API Prediction',
    recentForm: 'Недавняя форма',
    h2h: 'Очные встречи',
  })[name] || name || 'Источник';
}

function signalIcon(name) {
  return ({
    market: '💹',
    apiPrediction: '🧠',
    recentForm: '📈',
    h2h: '🤝',
  })[name] || '•';
}

function buildPreMatchIntelligence({
  probabilities, rawProbabilities, market, apiPrediction, homeForm, awayForm,
  h2h, absences, lineups, goalModel, comparison, confidence, modelBreakdown,
  homeName, awayName, minutesToKickoff, news, completeness,
}) {
  const ranking = probabilityRanking(probabilities, homeName, awayName);
  const top = ranking[0] || { key: '', label: 'Недостаточно данных', value: 0 };
  const second = ranking[1] || { value: 0 };
  const gap = round1(Math.max(0, Number(top.value || 0) - Number(second.value || 0)));
  const closeMatch = gap < 7;
  const clearEdge = gap >= 12;
  const confidenceScore = Number(confidence?.score || 0);
  const disagreement = Number(confidence?.disagreement || 0);

  let headline = 'Матч выглядит близким по доступным данным';
  if (probabilities && clearEdge) headline = `Модель выделяет вариант «${top.label}»`;
  else if (probabilities && !closeMatch) headline = `Небольшой перевес у варианта «${top.label}»`;

  let summary = 'Доступные источники дают близкие оценки, поэтому небольшие новости по составам или движение рынка могут заметно изменить итоговые проценты.';
  if (probabilities && clearEdge) {
    summary = `Расчётная вероятность лидирующего варианта — ${round1(top.value)}%, отрыв от второго сценария — ${gap} п.п. Это преимущество модели, а не гарантия результата.`;
  } else if (probabilities && !closeMatch) {
    summary = `Лидирующий вариант имеет ${round1(top.value)}%, но отрыв от второго сценария составляет только ${gap} п.п., поэтому матч нельзя считать односторонним.`;
  }

  const drivers = [];
  const finalLeaderKey = top.key;

  for (const signal of (modelBreakdown?.signals || []).slice().sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))) {
    const sr = probabilityRanking(signal.probabilities, homeName, awayName);
    const sTop = sr[0];
    if (!sTop) continue;
    const agrees = sTop.key === finalLeaderKey;
    const text = agrees
      ? `${signalDisplayName(signal.name)} поддерживает общий лидер модели: «${sTop.label}» — ${round1(sTop.value)}%.`
      : `${signalDisplayName(signal.name)} расходится с итогом: здесь первым идёт «${sTop.label}» — ${round1(sTop.value)}%.`;
    drivers.push(preMatchDriver({
      type: `signal_${signal.name}`,
      icon: signalIcon(signal.name),
      side: sTop.key === 'home' ? 'home' : sTop.key === 'away' ? 'away' : 'neutral',
      title: signalDisplayName(signal.name),
      text,
      strength: Number(signal.weight || 0) >= 35 ? 'high' : Number(signal.weight || 0) >= 20 ? 'medium' : 'low',
      source: 'model',
      weight: round1(Number(signal.weight || 0)),
      values: signal.probabilities,
    }));
  }

  const hOverall = homeForm?.overall;
  const aOverall = awayForm?.overall;
  const hVenue = homeForm?.venue?.sample >= 2 ? homeForm.venue : hOverall;
  const aVenue = awayForm?.venue?.sample >= 2 ? awayForm.venue : aOverall;
  if (hVenue?.sample && aVenue?.sample && Number.isFinite(Number(hVenue.ppg)) && Number.isFinite(Number(aVenue.ppg))) {
    const diff = Number(hVenue.ppg) - Number(aVenue.ppg);
    if (Math.abs(diff) >= 0.35) {
      const side = diff > 0 ? 'home' : 'away';
      drivers.push(preMatchDriver({
        type: 'venue_form',
        icon: side === 'home' ? '🏠' : '✈️',
        side,
        title: 'Форма дома / в гостях',
        text: `${side === 'home' ? homeName : awayName} лучше по релевантной форме: ${Math.max(Number(hVenue.ppg), Number(aVenue.ppg)).toFixed(1)} против ${Math.min(Number(hVenue.ppg), Number(aVenue.ppg)).toFixed(1)} очка за матч.`,
        strength: Math.abs(diff) >= 0.8 ? 'high' : 'medium',
        source: 'form',
        values: { home: Number(hVenue.ppg), away: Number(aVenue.ppg) },
      }));
    }
  }

  const homeAbs = absences?.home?.length || 0;
  const awayAbs = absences?.away?.length || 0;
  if (homeAbs || awayAbs) {
    const diff = homeAbs - awayAbs;
    if (Math.abs(diff) >= 2) {
      const burdened = diff > 0 ? 'home' : 'away';
      drivers.push(preMatchDriver({
        type: 'absences',
        icon: '🩺',
        side: burdened,
        title: 'Потери состава',
        text: `${burdened === 'home' ? homeName : awayName} имеет больше подтверждённых потерь: ${homeAbs}:${awayAbs}. Модель делает только ограниченную числовую поправку и не оценивает качество каждого отсутствующего игрока.`,
        strength: Math.abs(diff) >= 4 ? 'high' : 'medium',
        source: 'injuries',
        values: { home: homeAbs, away: awayAbs },
      }));
    }
  }

  const h2hTotal = Number(h2h?.homeWins || 0) + Number(h2h?.draws || 0) + Number(h2h?.awayWins || 0);
  if (h2hTotal >= 3) {
    const hw = Number(h2h?.homeWins || 0), aw = Number(h2h?.awayWins || 0);
    if (Math.abs(hw - aw) >= 2) {
      const side = hw > aw ? 'home' : 'away';
      drivers.push(preMatchDriver({
        type: 'h2h_context',
        icon: '🤝',
        side,
        title: 'Контекст H2H',
        text: `${side === 'home' ? homeName : awayName} выиграл больше из последних ${h2hTotal} очных матчей (${hw}:${aw} по победам). H2H имеет небольшой вес и не считается главным сигналом.`,
        strength: 'low',
        source: 'h2h',
      }));
    }
  }

  if (market?.probabilities && probabilities) {
    const marketRanking = probabilityRanking(market.probabilities, homeName, awayName);
    const marketTop = marketRanking[0];
    const finalTop = ranking[0];
    if (marketTop && finalTop && marketTop.key !== finalTop.key) {
      drivers.unshift(preMatchDriver({
        type: 'market_divergence',
        icon: '↔️',
        side: 'neutral',
        title: 'Рынок и модель расходятся',
        text: `Рынок первым ставит «${marketTop.label}» (${round1(marketTop.value)}%), а объединённая модель — «${finalTop.label}» (${round1(finalTop.value)}%). Это повышает неопределённость.`,
        strength: 'high',
        source: 'market',
      }));
    } else if (marketTop && finalTop && Math.abs(Number(marketTop.value) - Number(finalTop.value)) >= 7) {
      drivers.push(preMatchDriver({
        type: 'market_strength_gap',
        icon: '💹',
        side: finalTop.key === 'home' ? 'home' : finalTop.key === 'away' ? 'away' : 'neutral',
        title: 'Сила сигнала отличается от рынка',
        text: `Направление рынка и модели совпадает, но уверенность различается: рынок ${round1(marketTop.value)}%, модель ${round1(finalTop.value)}%.`,
        strength: 'medium',
        source: 'market',
      }));
    }
  }

  const scenarios = [];
  if (probabilities) {
    if (closeMatch) {
      scenarios.push({
        key: 'balanced',
        icon: '⚖️',
        tone: 'balanced',
        title: 'Базовый сценарий: близкий матч',
        text: `Разрыв между двумя наиболее вероятными исходами — всего ${gap} п.п. Небольшой игровой эпизод, состав или изменение рынка может перевернуть порядок вероятностей.`,
        relevance: 'Основной',
      });
    } else {
      const side = top.key === 'home' ? 'home' : top.key === 'away' ? 'away' : 'neutral';
      scenarios.push({
        key: 'leader',
        icon: top.key === 'draw' ? '⚖️' : '🎯',
        tone: side,
        title: `Базовый сценарий: ${top.label}`,
        text: top.key === 'draw'
          ? `Ничья имеет наибольшую оценку (${round1(top.value)}%), что обычно означает отсутствие сильного перевеса одной стороны в доступных сигналах.`
          : `${top.label} получает наибольшую вероятность (${round1(top.value)}%). Ключевой вопрос — реализуется ли статистический перевес в реальных моментах.`,
        relevance: 'Основной',
      });
    }
  }

  if (goalModel) {
    const total = Number(goalModel.totalExpected || 0);
    if (total >= 2.8 || Number(goalModel.over25 || 0) >= 60) {
      scenarios.push({
        key: 'goals_high',
        icon: '🔥',
        tone: 'open',
        title: 'Голевой сценарий: более открытая игра',
        text: `Poisson-эвристика даёт ${goalModel.totalExpected} ожидаемых гола суммарно и ${round1(goalModel.over25)}% на ТБ 2.5. Это вспомогательная модель по недавней результативности.`,
        relevance: 'Дополнительный',
      });
    } else if (total > 0 && total <= 2.2) {
      scenarios.push({
        key: 'goals_low',
        icon: '🧱',
        tone: 'closed',
        title: 'Голевой сценарий: осторожная игра',
        text: `Суммарная голевая оценка — ${goalModel.totalExpected}. При таком профиле один гол может сильнее изменить структуру матча.`,
        relevance: 'Дополнительный',
      });
    }
    if (Number(goalModel.btts || 0) >= 62) {
      scenarios.push({
        key: 'btts',
        icon: '⚽',
        tone: 'open',
        title: 'Обе команды способны забить',
        text: `Эвристическая вероятность «обе забьют» — ${round1(goalModel.btts)}%. Это не букмекерская рекомендация, а производная от недавних голов команд.`,
        relevance: 'Дополнительный',
      });
    }
  }

  if (ranking[1] && Number(ranking[1].value) >= 28) {
    scenarios.push({
      key: 'alternative',
      icon: '🔄',
      tone: ranking[1].key === 'home' ? 'home' : ranking[1].key === 'away' ? 'away' : 'balanced',
      title: `Альтернативный сценарий: ${ranking[1].label}`,
      text: `Второй вариант сохраняет заметную вероятность — ${round1(ranking[1].value)}%. Поэтому основной исход не стоит читать как однозначный.`,
      relevance: 'Альтернатива',
    });
  }

  const watch = [];
  if (minutesToKickoff !== null && minutesToKickoff <= 180 && minutesToKickoff >= 0 && !lineups?.home && !lineups?.away) {
    watch.push('Подтверждённые стартовые составы: они ещё не опубликованы, а перед стартом могут изменить оценку.');
  }
  if (Math.abs(homeAbs - awayAbs) >= 2) {
    watch.push('Статус травмированных/дисквалифицированных: разница по потерям сейчас заметная.');
  }
  if (!market?.probabilities) {
    watch.push('Линия 1X2 отсутствует: пока нет рыночного якоря для сравнения с моделью.');
  } else if (drivers.some(x => x.type === 'market_divergence')) {
    watch.push('Движение рынка: рынок и итоговая модель сейчас выбирают разные основные сценарии.');
  }
  if ((homeForm?.overall?.sample || 0) < 4 || (awayForm?.overall?.sample || 0) < 4) {
    watch.push('Размер выборки формы: у одной из команд меньше четырёх недавних матчей в расчёте.');
  }
  if (disagreement >= 10) {
    watch.push('Согласованность источников: расхождение сигналов повышено, поэтому итог чувствителен к новым данным.');
  }
  if (!news?.answer) {
    watch.push('Свежий внешний контекст ограничен: новостная сводка не была доступна.');
  }

  let uncertaintyScore = Math.round(clamp(
    (100 - confidenceScore) * 0.72 +
    Math.min(30, disagreement * 1.2) +
    (closeMatch ? 10 : 0) +
    (!market?.probabilities ? 8 : 0) +
    ((!lineups?.home && !lineups?.away && minutesToKickoff !== null && minutesToKickoff <= 120) ? 6 : 0),
    10, 90
  ));
  const uncertainty = uncertaintyScore >= 62
    ? { level: 'high', label: 'Высокая неопределённость' }
    : uncertaintyScore >= 40
      ? { level: 'medium', label: 'Средняя неопределённость' }
      : { level: 'low', label: 'Умеренная неопределённость' };

  const completenessScore = Number(completeness?.score || 0);
  const completenessMax = Math.max(1, Number(completeness?.max || 10));
  const dataScore = Math.round(clamp(completenessScore / completenessMax * 100, 0, 100));

  const sourceRows = (modelBreakdown?.signals || []).map(signal => {
    const sr = probabilityRanking(signal.probabilities, homeName, awayName);
    const lead = sr[0] || {};
    return {
      key: signal.name,
      label: signalDisplayName(signal.name),
      icon: signalIcon(signal.name),
      weight: round1(Number(signal.weight || 0)),
      leader: lead.label || '—',
      leaderKey: lead.key || '',
      leaderProbability: round1(Number(lead.value || 0)),
      probabilities: signal.probabilities || null,
      agreesWithFinal: Boolean(lead.key && finalLeaderKey && lead.key === finalLeaderKey),
    };
  }).sort((a, b) => b.weight - a.weight);

  return {
    version: '4.6',
    headline,
    summary,
    leader: {
      key: top.key || '',
      label: top.label || '',
      probability: round1(Number(top.value || 0)),
      secondLabel: second.label || '',
      secondProbability: round1(Number(second.value || 0)),
      gap,
      closeMatch,
    },
    uncertainty: {
      score: uncertaintyScore,
      level: uncertainty.level,
      label: uncertainty.label,
      disagreement: round1(disagreement || 0),
    },
    dataScore,
    drivers: drivers.slice(0, 7),
    scenarios: scenarios.slice(0, 4),
    watch: watch.slice(0, 6),
    sourceRows,
    comparisonSummary: comparison?.balanceLabel || '',
    lineupStatus: {
      home: Boolean(lineups?.home),
      away: Boolean(lineups?.away),
      confirmed: Boolean(lineups?.home && lineups?.away),
    },
    absences: { home: homeAbs, away: awayAbs },
    methodology: 'Бриф объясняет уже рассчитанные вероятности через веса источников, форму, H2H, потери и голевую эвристику. Он не добавляет новый прогноз и не является рекомендацией для ставок.',
  };
}
function formatAbsences(rows, homeId, awayId) {
  const out = { home: [], away: [] };
  for (const item of rows || []) {
    const e = { name: item.player?.name || 'Игрок', type: item.player?.type || '', reason: item.player?.reason || '' };
    if (Number(item.team?.id) === Number(homeId)) out.home.push(e);
    if (Number(item.team?.id) === Number(awayId)) out.away.push(e);
  }
  return out;
}
function normalizeLineupPlayer(entry) {
  const p = entry?.player || {};
  if (!p?.name) return null;
  return {
    id: Number(p.id || 0),
    name: p.name || 'Игрок',
    number: p.number ?? null,
    pos: p.pos || '',
    grid: p.grid || '',
    photo: p.photo || '',
  };
}

function formatLineups(rows, homeId, awayId) {
  const out = { home: null, away: null };
  for (const x of rows || []) {
    const lineup = {
      formation: x.formation || '',
      coach: x.coach?.name || '',
      coachPhoto: x.coach?.photo || '',
      startXI: (x.startXI || []).map(normalizeLineupPlayer).filter(Boolean),
      substitutes: (x.substitutes || []).map(normalizeLineupPlayer).filter(Boolean),
    };
    if (Number(x.team?.id) === Number(homeId)) out.home = lineup;
    if (Number(x.team?.id) === Number(awayId)) out.away = lineup;
  }
  return out;
}
function formatH2H(rows, homeId, awayId) {
  let homeWins = 0, draws = 0, awayWins = 0;
  const matches = [];
  for (const x of rows || []) {
    const hg = Number(x.goals?.home ?? 0), ag = Number(x.goals?.away ?? 0);
    const hId = Number(x.teams?.home?.id), aId = Number(x.teams?.away?.id);
    let winnerId = null;
    if (hg > ag) winnerId = hId;
    if (ag > hg) winnerId = aId;
    if (!winnerId) draws++; else if (winnerId === Number(homeId)) homeWins++; else if (winnerId === Number(awayId)) awayWins++;
    matches.push({ date: x.fixture?.date || '', home: x.teams?.home?.name || '', away: x.teams?.away?.name || '', score: `${hg}:${ag}` });
  }
  return { homeWins, draws, awayWins, matches: matches.slice(0, 5) };
}

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

function isLiveStatus(status) { return LIVE_STATUSES.has(String(status || '').toUpperCase()); }
function isFinishedStatus(status) { return FINISHED_STATUSES.has(String(status || '').toUpperCase()); }

function statusLabel(status, elapsed) {
  const s = String(status || '').toUpperCase();
  const labels = {
    NS: 'Не начался', TBD: 'Время уточняется', '1H': '1-й тайм', HT: 'Перерыв', '2H': '2-й тайм',
    ET: 'Доп. время', BT: 'Перерыв', P: 'Пенальти', INT: 'Прерван', LIVE: 'LIVE',
    FT: 'Завершён', AET: 'Завершён после доп. времени', PEN: 'Завершён по пенальти',
    SUSP: 'Приостановлен', PST: 'Перенесён', CANC: 'Отменён', ABD: 'Прерван', AWD: 'Тех. результат', WO: 'Без игры',
  };
  const base = labels[s] || s || 'Статус неизвестен';
  return isLiveStatus(s) && Number.isFinite(Number(elapsed)) ? `${base} · ${Number(elapsed)}′` : base;
}

function normalizeStatValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  return String(value);
}

const STAT_KEYS = [
  ['Ball Possession', 'Владение'],
  ['Total Shots', 'Удары'],
  ['Shots on Goal', 'В створ'],
  ['Shots off Goal', 'Мимо'],
  ['Blocked Shots', 'Блокированные'],
  ['Corner Kicks', 'Угловые'],
  ['Offsides', 'Офсайды'],
  ['Fouls', 'Фолы'],
  ['Yellow Cards', 'Жёлтые'],
  ['Red Cards', 'Красные'],
  ['Goalkeeper Saves', 'Сейвы'],
  ['Total passes', 'Передачи'],
  ['Passes accurate', 'Точные передачи'],
  ['Passes %', 'Точность передач'],
  ['expected_goals', 'xG'],
];

function formatLiveStatistics(rows, homeId, awayId) {
  const byTeam = new Map();
  for (const row of rows || []) {
    const id = Number(row.team?.id || 0);
    const values = {};
    for (const stat of row.statistics || []) values[String(stat.type || '')] = normalizeStatValue(stat.value);
    byTeam.set(id, { teamId: id, teamName: row.team?.name || '', values });
  }
  const home = byTeam.get(Number(homeId)) || { teamId: Number(homeId), values: {} };
  const away = byTeam.get(Number(awayId)) || { teamId: Number(awayId), values: {} };
  const items = STAT_KEYS.map(([key, label]) => ({
    key, label, home: home.values[key] ?? null, away: away.values[key] ?? null,
  })).filter(x => x.home !== null || x.away !== null);
  return { home, away, items };
}

function translateEvent(type, detail) {
  const t = String(type || '').toLowerCase();
  const d = String(detail || '').toLowerCase();
  if (t === 'goal') {
    if (d.includes('own')) return '⚽ Автогол';
    if (d.includes('missed')) return '❌ Незабитый пенальти';
    if (d.includes('penalty')) return '⚽ Гол с пенальти';
    return '⚽ Гол';
  }
  if (t === 'card') {
    if (d.includes('red')) return '🟥 Красная карточка';
    if (d.includes('second yellow')) return '🟥 Вторая жёлтая';
    return '🟨 Жёлтая карточка';
  }
  if (t === 'subst') return '🔄 Замена';
  if (t === 'var') return '📺 VAR';
  return detail || type || 'Событие';
}

function formatLiveEvents(rows, homeId, awayId) {
  return (rows || []).map((event, index) => ({
    id: `${event.time?.elapsed || 0}-${event.time?.extra || 0}-${index}`,
    minute: Number(event.time?.elapsed || 0),
    extra: Number(event.time?.extra || 0),
    teamId: Number(event.team?.id || 0),
    side: Number(event.team?.id) === Number(homeId) ? 'home' : Number(event.team?.id) === Number(awayId) ? 'away' : '',
    teamName: event.team?.name || '',
    player: event.player?.name || '',
    assist: event.assist?.name || '',
    type: event.type || '',
    detail: event.detail || '',
    label: translateEvent(event.type, event.detail),
    comments: event.comments || '',
  })).sort((a, b) => a.minute - b.minute || a.extra - b.extra);
}

function scoreSnapshot(fixture) {
  return {
    home: fixture.goals?.home ?? null,
    away: fixture.goals?.away ?? null,
    halftime: fixture.score?.halftime || null,
    fulltime: fixture.score?.fulltime || null,
    extratime: fixture.score?.extratime || null,
    penalty: fixture.score?.penalty || null,
  };
}

function embeddedLiveData(fixture) {
  return {
    events: Array.isArray(fixture.events) ? fixture.events : [],
    lineups: Array.isArray(fixture.lineups) ? fixture.lineups : [],
    statistics: Array.isArray(fixture.statistics) ? fixture.statistics : [],
    players: Array.isArray(fixture.players) ? fixture.players : [],
  };
}


const COMPETITIONS = new Map([
  [1,   { name: 'Чемпионат мира', short: 'ЧМ', group: 'international', category: 'national', tier: 'elite', priority: 100 }],
  [2,   { name: 'Лига чемпионов УЕФА', short: 'ЛЧ', group: 'international', category: 'continental', tier: 'elite', priority: 100 }],
  [3,   { name: 'Лига Европы УЕФА', short: 'ЛЕ', group: 'international', category: 'continental', tier: 'elite', priority: 94 }],
  [4,   { name: 'Евро', short: 'Евро', group: 'international', category: 'national', tier: 'elite', priority: 98 }],
  [9,   { name: 'Копа Америка', short: 'Копа Америка', group: 'international', category: 'national', tier: 'elite', priority: 96 }],
  [15,  { name: 'Клубный чемпионат мира', short: 'КЧМ', group: 'international', category: 'continental', tier: 'elite', priority: 92 }],
  [39,  { name: 'Премьер-лига', short: 'АПЛ', group: 'england', category: 'league', tier: 'elite', priority: 100 }],
  [40,  { name: 'Чемпионшип', short: 'Чемпионшип', group: 'england', category: 'league', tier: 'major', priority: 72 }],
  [45,  { name: 'Кубок Англии', short: 'FA Cup', group: 'england', category: 'cup', tier: 'major', priority: 84 }],
  [48,  { name: 'Кубок английской лиги', short: 'EFL Cup', group: 'england', category: 'cup', tier: 'major', priority: 76 }],
  [61,  { name: 'Лига 1', short: 'Лига 1', group: 'france', category: 'league', tier: 'elite', priority: 92 }],
  [62,  { name: 'Лига 2', short: 'Лига 2', group: 'france', category: 'league', tier: 'major', priority: 60 }],
  [66,  { name: 'Кубок Франции', short: 'Кубок Франции', group: 'france', category: 'cup', tier: 'major', priority: 70 }],
  [71,  { name: 'Серия A Бразилии', short: 'Бразилия A', group: 'brazil', category: 'league', tier: 'major', priority: 78 }],
  [78,  { name: 'Бундеслига', short: 'Бундеслига', group: 'germany', category: 'league', tier: 'elite', priority: 94 }],
  [79,  { name: '2. Бундеслига', short: '2. Бундеслига', group: 'germany', category: 'league', tier: 'major', priority: 62 }],
  [81,  { name: 'Кубок Германии', short: 'DFB-Pokal', group: 'germany', category: 'cup', tier: 'major', priority: 74 }],
  [88,  { name: 'Эредивизи', short: 'Эредивизи', group: 'netherlands', category: 'league', tier: 'major', priority: 78 }],
  [94,  { name: 'Примейра-лига', short: 'Португалия', group: 'portugal', category: 'league', tier: 'major', priority: 78 }],
  [128, { name: 'Профессиональная лига Аргентины', short: 'Аргентина', group: 'argentina', category: 'league', tier: 'major', priority: 76 }],
  [135, { name: 'Серия A', short: 'Серия A', group: 'italy', category: 'league', tier: 'elite', priority: 94 }],
  [136, { name: 'Серия B', short: 'Серия B', group: 'italy', category: 'league', tier: 'major', priority: 62 }],
  [137, { name: 'Кубок Италии', short: 'Кубок Италии', group: 'italy', category: 'cup', tier: 'major', priority: 74 }],
  [140, { name: 'Ла Лига', short: 'Ла Лига', group: 'spain', category: 'league', tier: 'elite', priority: 96 }],
  [141, { name: 'Сегунда', short: 'Сегунда', group: 'spain', category: 'league', tier: 'major', priority: 62 }],
  [143, { name: 'Кубок Испании', short: 'Кубок Испании', group: 'spain', category: 'cup', tier: 'major', priority: 76 }],
  [203, { name: 'Суперлига Турции', short: 'Турция', group: 'turkey', category: 'league', tier: 'major', priority: 68 }],
  [253, { name: 'MLS', short: 'MLS', group: 'usa', category: 'league', tier: 'major', priority: 72 }],
  [307, { name: 'Саудовская Про-лига', short: 'Saudi Pro League', group: 'saudi', category: 'league', tier: 'major', priority: 70 }],
  [848, { name: 'Лига конференций УЕФА', short: 'ЛК', group: 'international', category: 'continental', tier: 'elite', priority: 88 }],
]);

const BIG_TEAM_RE = /arsenal|liverpool|chelsea|manchester (city|united)|tottenham|newcastle|real madrid|barcelona|atletico madrid|bayern|dortmund|paris saint|psg|inter|milan|juventus|napoli|roma|benfica|porto|sporting|ajax|psv|feyenoord|inter miami|flamengo|palmeiras|river plate|boca juniors/i;
const YOUTH_RESERVE_RE = /\bu-?1[789]\b|\bu-?2[013]\b|under ?(17|18|19|20|21|23)|youth|reserve|reserves|development|primavera|juniors?|academy/i;
const WOMEN_RE = /women|femen|femin|wsl|liga f|frauen|d1 f|feminine/i;
const FRIENDLY_RE = /friendly|friendlies|club friendly|товарищ/i;
const CUP_RE = /cup|copa|coppa|pokal|taça|taca|coupe|кубок/i;
const LOWER_RE = /division 3|division 4|third|fourth|regional|amateur|non league|national league north|national league south/i;

const COUNTRY_RU = new Map(Object.entries({
  England:'Англия', Spain:'Испания', Italy:'Италия', Germany:'Германия', France:'Франция',
  Portugal:'Португалия', Netherlands:'Нидерланды', Belgium:'Бельгия', Turkey:'Турция', Scotland:'Шотландия',
  Brazil:'Бразилия', Argentina:'Аргентина', USA:'США', Mexico:'Мексика', Colombia:'Колумбия',
  Ecuador:'Эквадор', Uruguay:'Уругвай', Chile:'Чили', Paraguay:'Парагвай', Peru:'Перу',
  'Saudi-Arabia':'Саудовская Аравия', 'Saudi Arabia':'Саудовская Аравия', Japan:'Япония', Korea:'Южная Корея',
  Australia:'Австралия', Russia:'Россия', Ukraine:'Украина', Poland:'Польша', Greece:'Греция',
  Austria:'Австрия', Switzerland:'Швейцария', Denmark:'Дания', Sweden:'Швеция', Norway:'Норвегия',
  'Czech-Republic':'Чехия', 'Czech Republic':'Чехия', Romania:'Румыния', Croatia:'Хорватия', Serbia:'Сербия',
  World:'Мир', Europe:'Европа', Africa:'Африка', Asia:'Азия',
}));

function normalizeCountryName(country = '') {
  const raw = String(country || '').trim();
  return COUNTRY_RU.get(raw) || raw || 'Мир';
}

function isYouthReserveMatch(leagueName = '', homeName = '', awayName = '') {
  return YOUTH_RESERVE_RE.test(`${leagueName || ''} ${homeName || ''} ${awayName || ''}`);
}

function detectCompetitionCategory(leagueId, leagueName = '', country = '', homeName = '', awayName = '') {
  const known = COMPETITIONS.get(Number(leagueId));
  const hay = `${leagueName} ${country} ${homeName} ${awayName}`;
  if (isYouthReserveMatch(leagueName, homeName, awayName)) return 'youth';
  if (WOMEN_RE.test(hay)) return 'women';
  if (FRIENDLY_RE.test(leagueName)) return 'friendly';
  if (known?.category) return known.category;
  if (/champions|europa|conference|world cup|euro|copa america|nations league|club world/i.test(leagueName)) return 'international';
  if (CUP_RE.test(leagueName)) return 'cup';
  if (LOWER_RE.test(leagueName)) return 'lower';
  return 'league';
}

function leagueGroup(leagueId, leagueName = '', country = '') {
  const known = COMPETITIONS.get(Number(leagueId));
  if (known?.group) return known.group;
  const n = String(leagueName).toLowerCase();
  const c = String(country).toLowerCase();
  if (/champions|europa|conference|world cup|euro|copa america|nations league|club world/.test(n)) return 'international';
  if (c === 'england') return 'england';
  if (c === 'spain') return 'spain';
  if (c === 'italy') return 'italy';
  if (c === 'germany') return 'germany';
  if (c === 'france') return 'france';
  if (c === 'portugal') return 'portugal';
  if (c === 'netherlands') return 'netherlands';
  if (c === 'brazil') return 'brazil';
  if (c === 'argentina') return 'argentina';
  return 'other';
}

function normalizeCompetition(leagueId, leagueName = '', country = '', homeName = '', awayName = '') {
  const id = Number(leagueId || 0);
  const known = COMPETITIONS.get(id);
  const category = detectCompetitionCategory(id, leagueName, country, homeName, awayName);
  const youth = category === 'youth';
  const friendly = category === 'friendly';
  const lower = category === 'lower';
  let tier = known?.tier || 'standard';
  let priority = Number(known?.priority || 45);
  const lname = String(leagueName || '').toLowerCase();
  if (!known && category === 'cup') priority = 52;
  if (!known && category === 'international') priority = 74;
  if (!known && /libertadores/.test(lname)) { tier = 'elite'; priority = 90; }
  if (!known && /sudamericana/.test(lname)) { tier = 'major'; priority = 82; }
  if (!known && /nations league/.test(lname)) { tier = 'major'; priority = 84; }
  if (!known && /afc champions|caf champions|concacaf champions/.test(lname)) { tier = 'major'; priority = 80; }
  if (category === 'women') { tier = 'standard'; priority = Math.max(priority, 50); }
  if (lower) { tier = 'basic'; priority = Math.min(priority, 28); }
  if (friendly) { tier = 'basic'; priority = Math.min(priority, 24); }
  if (youth) { tier = 'basic'; priority = 8; }
  const group = known?.group || leagueGroup(id, leagueName, country);
  return {
    id,
    originalName: String(leagueName || ''),
    name: known?.name || String(leagueName || 'Турнир'),
    shortName: known?.short || known?.name || String(leagueName || 'Турнир'),
    country: normalizeCountryName(country),
    countryRaw: String(country || ''),
    group,
    category,
    tier,
    priority,
    youth,
    friendly,
    lower,
    featured: priority >= 80 && !youth && !friendly && !lower,
  };
}

function isTopLeague(leagueId, leagueName = '') {
  const known = COMPETITIONS.get(Number(leagueId));
  if (known) return known.priority >= 80;
  if (YOUTH_RESERVE_RE.test(String(leagueName || ''))) return false;
  return /premier league|la liga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|world cup|copa america|major league soccer|primeira liga/i.test(String(leagueName));
}

function normalizeRoundLabel(round = '') {
  const raw = String(round || '').trim();
  if (!raw) return '';
  let m = raw.match(/Regular Season\s*-\s*(\d+)/i);
  if (m) return `Тур ${m[1]}`;
  m = raw.match(/Round\s*(\d+)/i);
  if (m) return `Раунд ${m[1]}`;
  m = raw.match(/Group Stage\s*-?\s*(.*)/i);
  if (m) return m[1] ? `Групповой этап · ${m[1]}` : 'Групповой этап';
  if (/Round of 32/i.test(raw)) return '1/16 финала';
  if (/Round of 16/i.test(raw)) return '1/8 финала';
  if (/Quarter/i.test(raw)) return '1/4 финала';
  if (/Semi/i.test(raw)) return '1/2 финала';
  if (/Final/i.test(raw) && !/Semi|Quarter/i.test(raw)) return 'Финал';
  if (/Play-?offs?/i.test(raw)) return raw.replace(/Play-?offs?/i, 'Плей-офф');
  return raw;
}

function matchInterestScore({ competition, leagueId, leagueName, country, homeName, awayName, status, date }) {
  const comp = competition || normalizeCompetition(leagueId, leagueName, country, homeName, awayName);
  let score = Math.max(8, Math.min(72, Number(comp.priority || 45)));
  if (BIG_TEAM_RE.test(homeName || '')) score += 12;
  if (BIG_TEAM_RE.test(awayName || '')) score += 12;
  if (isLiveStatus(status)) score += 8;
  if (date) {
    const mins = Math.abs((Date.parse(date) - Date.now()) / 60000);
    if (mins <= 180) score += 5;
  }
  if (comp.youth) score -= 28;
  if (comp.friendly) score -= 18;
  if (comp.lower) score -= 14;
  return Math.max(5, Math.min(99, Math.round(score)));
}

function catalogRank(match) {
  const cat = match?.competition?.category || match?.category || '';
  if (match?.live) return 0;
  if (match?.competition?.featured || match?.featured) return 1;
  if (cat === 'continental' || cat === 'national' || cat === 'international') return 2;
  if (cat === 'league' || cat === 'cup') return 3;
  if (cat === 'women') return 4;
  if (cat === 'friendly') return 6;
  if (cat === 'youth' || cat === 'lower') return 7;
  return 5;
}

function matchStatusRank(status) {
  if (isLiveStatus(status)) return 0;
  if (['NS','TBD'].includes(status)) return 1;
  if (isFinishedStatus(status)) return 2;
  return 3;
}


const KNOWN_FIXTURE_STATUSES = new Set(['TBD','NS','1H','HT','2H','ET','BT','P','SUSP','INT','FT','AET','PEN','PST','CANC','ABD','AWD','WO','LIVE']);
const INTEGRITY_SEVERITY_WEIGHT = Object.freeze({ info: 4, warning: 13, error: 38 });

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fixtureScorePair(fixture) {
  const home = finiteNonNegative(fixture?.goals?.home);
  const away = finiteNonNegative(fixture?.goals?.away);
  return { home, away };
}

function previousMatchMap(payload) {
  const map = new Map();
  for (const row of payload?.matches || []) {
    const id = Number(row?.fixtureId || 0);
    if (id > 0) map.set(id, row);
  }
  return map;
}

function validateFixtureIntegrity(fixture, requestedDate = '', previous = null) {
  const issues = [];
  const add = (severity, code, message, meta = {}) => issues.push({ severity, code, message, meta });
  const fixtureId = Number(fixture?.fixture?.id || 0);
  const date = String(fixture?.fixture?.date || '');
  const kickoffMs = Date.parse(date);
  const status = String(fixture?.fixture?.status?.short || '').toUpperCase();
  const elapsedRaw = fixture?.fixture?.status?.elapsed;
  const elapsed = elapsedRaw === null || elapsedRaw === undefined ? null : Number(elapsedRaw);
  const leagueId = Number(fixture?.league?.id || 0);
  const leagueName = String(fixture?.league?.name || '').trim();
  const homeId = Number(fixture?.teams?.home?.id || 0);
  const awayId = Number(fixture?.teams?.away?.id || 0);
  const homeName = String(fixture?.teams?.home?.name || '').trim();
  const awayName = String(fixture?.teams?.away?.name || '').trim();
  const score = fixtureScorePair(fixture);

  if (!Number.isFinite(fixtureId) || fixtureId <= 0) add('error', 'FIXTURE_ID_MISSING', 'Матч не имеет корректного fixture id.');
  if (!Number.isFinite(kickoffMs)) add('error', 'KICKOFF_INVALID', 'Некорректное время начала матча.', { date });
  if (!homeName || !awayName) add('error', 'TEAM_NAME_MISSING', 'У одной из команд отсутствует название.');
  if (homeId <= 0 || awayId <= 0) add('error', 'TEAM_ID_MISSING', 'У одной из команд отсутствует корректный team id.');
  if ((homeId > 0 && homeId === awayId) || (homeName && awayName && homeName.toLowerCase() === awayName.toLowerCase())) add('error', 'SAME_TEAM', 'Хозяева и гости определены как одна команда.');
  if (!leagueId || !leagueName) add('warning', 'LEAGUE_INCOMPLETE', 'Неполные данные турнира.', { leagueId, leagueName });
  if (!status || !KNOWN_FIXTURE_STATUSES.has(status)) add('warning', 'STATUS_UNKNOWN', 'Неизвестный статус матча.', { status });

  const rawScores = [fixture?.goals?.home, fixture?.goals?.away, fixture?.score?.halftime?.home, fixture?.score?.halftime?.away, fixture?.score?.fulltime?.home, fixture?.score?.fulltime?.away];
  if (rawScores.some(v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) < 0)) add('error', 'SCORE_NEGATIVE', 'Обнаружено отрицательное значение счёта.');

  if (isLiveStatus(status)) {
    if (Number.isFinite(kickoffMs) && kickoffMs > Date.now() + 20 * 60000) add('error', 'LIVE_BEFORE_KICKOFF', 'LIVE-статус получен задолго до времени начала.', { minutesAhead: Math.round((kickoffMs - Date.now()) / 60000) });
    if (elapsed !== null && (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 150)) add('warning', 'ELAPSED_INVALID', 'Подозрительное значение игровой минуты.', { elapsed });
    if (score.home === null || score.away === null) add('warning', 'LIVE_SCORE_MISSING', 'LIVE-матч пришёл без полного текущего счёта.');
  }

  if (isFinishedStatus(status)) {
    if (Number.isFinite(kickoffMs) && kickoffMs > Date.now() + 20 * 60000) add('error', 'FINISHED_BEFORE_KICKOFF', 'Завершённый статус получен до времени начала.');
    if (score.home === null || score.away === null) add('warning', 'FINAL_SCORE_MISSING', 'Завершённый матч пришёл без итогового счёта.');
    if (status === 'FT') {
      const ftHome = finiteNonNegative(fixture?.score?.fulltime?.home);
      const ftAway = finiteNonNegative(fixture?.score?.fulltime?.away);
      if (ftHome !== null && ftAway !== null && score.home !== null && score.away !== null && (ftHome !== score.home || ftAway !== score.away)) {
        add('warning', 'FINAL_SCORE_CONFLICT', 'Текущий и fulltime счёт не совпадают.', { goals: `${score.home}:${score.away}`, fulltime: `${ftHome}:${ftAway}` });
      }
    }
  }

  if (['NS','TBD'].includes(status) && Number.isFinite(kickoffMs) && Date.now() - kickoffMs > 6 * 3600000) {
    add('warning', 'STALE_PREMATCH_STATUS', 'Матч давно должен был начаться, но статус всё ещё предматчевый.', { hoursLate: Math.round((Date.now() - kickoffMs) / 3600000) });
  }
  if (['NS','TBD'].includes(status) && ((score.home || 0) > 0 || (score.away || 0) > 0)) add('warning', 'PREMATCH_WITH_SCORE', 'Предматчевый статус содержит ненулевой счёт.');

  if (!fixture?.teams?.home?.logo || !fixture?.teams?.away?.logo) add('info', 'TEAM_LOGO_MISSING', 'У одной из команд отсутствует логотип.');
  if (!fixture?.league?.logo) add('info', 'LEAGUE_LOGO_MISSING', 'У турнира отсутствует логотип.');

  if (Number.isFinite(kickoffMs) && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    const requestedNoon = Date.parse(`${requestedDate}T12:00:00Z`);
    if (Number.isFinite(requestedNoon) && Math.abs(kickoffMs - requestedNoon) > 38 * 3600000) add('warning', 'DATE_WINDOW_MISMATCH', 'Время матча сильно выходит за запрошенную дату.', { requestedDate, fixtureDate: date });
  }

  if (previous) {
    const prevStatus = String(previous.status || '').toUpperCase();
    const prevElapsed = Number(previous.elapsed);
    const prevHome = finiteNonNegative(previous?.score?.home);
    const prevAway = finiteNonNegative(previous?.score?.away);
    if ((isLiveStatus(prevStatus) || isFinishedStatus(prevStatus)) && ['NS','TBD'].includes(status)) add('warning', 'STATUS_REGRESSION', 'Статус матча откатился к предматчевому.', { previousStatus: prevStatus, currentStatus: status });
    if (isFinishedStatus(prevStatus) && !isFinishedStatus(status)) add('warning', 'FINISHED_STATUS_REGRESSION', 'Ранее завершённый матч вернулся в незавершённый статус.', { previousStatus: prevStatus, currentStatus: status });
    if (isLiveStatus(prevStatus) && isLiveStatus(status) && Number.isFinite(prevElapsed) && Number.isFinite(elapsed) && elapsed + 3 < prevElapsed) add('warning', 'ELAPSED_REGRESSION', 'Игровая минута уменьшилась относительно предыдущего снимка.', { previousElapsed: prevElapsed, currentElapsed: elapsed });
    if (prevHome !== null && prevAway !== null && score.home !== null && score.away !== null && (score.home < prevHome || score.away < prevAway)) add('warning', 'SCORE_REGRESSION', 'Счёт уменьшился относительно предыдущего снимка; возможна VAR-коррекция или конфликт данных.', { previous: `${prevHome}:${prevAway}`, current: `${score.home}:${score.away}` });
  }

  const quarantine = issues.some(x => x.severity === 'error');
  const warnings = issues.filter(x => x.severity === 'warning').length;
  const errors = issues.filter(x => x.severity === 'error').length;
  const infos = issues.filter(x => x.severity === 'info').length;
  const qualityScore = Math.max(0, Math.min(100, 100 - warnings * INTEGRITY_SEVERITY_WEIGHT.warning - errors * INTEGRITY_SEVERITY_WEIGHT.error - infos * INTEGRITY_SEVERITY_WEIGHT.info));
  const state = quarantine ? 'error' : warnings ? 'warning' : infos ? 'incomplete' : 'clean';
  return { fixtureId, state, qualityScore, quarantine, warnings, errors, infos, issues };
}

function integritySignature(fixture) {
  const leagueId = Number(fixture?.league?.id || 0);
  const homeId = Number(fixture?.teams?.home?.id || 0);
  const awayId = Number(fixture?.teams?.away?.id || 0);
  const ms = Date.parse(fixture?.fixture?.date || '');
  const minute = Number.isFinite(ms) ? Math.floor(ms / 60000) : 0;
  return `${leagueId}:${homeId}:${awayId}:${minute}`;
}

function runMatchIntegrityGuard(fixtures, requestedDate, previousPayload = null) {
  const previous = previousMatchMap(previousPayload);
  const accepted = [];
  const issues = [];
  const seenIds = new Set();
  const seenSignatures = new Map();
  let quarantined = 0, duplicates = 0, warningMatches = 0, incompleteMatches = 0, cleanMatches = 0, repaired = 0;

  for (const fixture of fixtures || []) {
    const fixtureId = Number(fixture?.fixture?.id || 0);
    let result = validateFixtureIntegrity(fixture, requestedDate, previous.get(fixtureId));
    if (fixtureId > 0 && seenIds.has(fixtureId)) {
      duplicates++;
      result = { ...result, state: 'error', quarantine: true, errors: result.errors + 1, qualityScore: 0, issues: [...result.issues, { severity: 'error', code: 'DUPLICATE_FIXTURE_ID', message: 'Повтор fixture id в одном ответе API.', meta: { fixtureId } }] };
    }
    const signature = integritySignature(fixture);
    if (!result.quarantine && signature && seenSignatures.has(signature)) {
      duplicates++;
      const firstId = seenSignatures.get(signature);
      result = { ...result, state: 'error', quarantine: true, errors: result.errors + 1, qualityScore: 0, issues: [...result.issues, { severity: 'error', code: 'DUPLICATE_MATCH_SIGNATURE', message: 'Найден дубликат того же матча с другим fixture id.', meta: { firstFixtureId: firstId, duplicateFixtureId: fixtureId } }] };
    }
    if (fixtureId > 0) seenIds.add(fixtureId);
    if (!result.quarantine && signature) seenSignatures.set(signature, fixtureId);

    for (const issue of result.issues) {
      if (issue.severity === 'info') continue;
      issues.push({ fixtureId: fixtureId || null, ...issue, home: fixture?.teams?.home?.name || '', away: fixture?.teams?.away?.name || '', league: fixture?.league?.name || '' });
    }

    if (result.quarantine) {
      quarantined++;
      continue;
    }
    if (result.state === 'warning') warningMatches++;
    else if (result.state === 'incomplete') incompleteMatches++;
    else cleanMatches++;
    accepted.push({ fixture, integrity: { state: result.state, score: result.qualityScore, warnings: result.warnings, infos: result.infos, issues: result.issues.filter(x => x.severity !== 'info').slice(0, 3).map(x => ({ severity: x.severity, code: x.code, message: x.message })) } });
  }

  const inspected = (fixtures || []).length;
  const errors = issues.filter(x => x.severity === 'error').length;
  const warnings = issues.filter(x => x.severity === 'warning').length;
  const qualityScore = inspected ? Math.round((accepted.reduce((sum, x) => sum + Number(x.integrity?.score || 0), 0) / inspected) * 10) / 10 : 100;
  const quarantinePct = inspected ? quarantined / inspected * 100 : 0;
  const health = quarantinePct >= 10 || errors >= 5 ? 'critical' : (quarantined || warnings ? 'warning' : 'ok');
  return {
    accepted,
    report: { requestedDate, inspected, accepted: accepted.length, clean: cleanMatches, incomplete: incompleteMatches, warningMatches, quarantined, duplicates, repaired, warnings, errors, qualityScore, health },
    issues,
  };
}

async function persistIntegrityRun(cfg, report, issues) {
  const runId = crypto.randomUUID();
  const observedAt = new Date().toISOString();
  const run = { runId, observedAt, ...report };
  memory.integrity.lastRun = run;
  memory.integrity.recentIssues = (issues || []).slice(0, 30).map(x => ({ observed_at: observedAt, run_id: runId, ...x }));
  bumpTelemetry('integrityRuns');
  bumpTelemetry('integrityWarnings', Number(report?.warnings || 0));
  bumpTelemetry('integrityErrors', Number(report?.errors || 0));
  bumpTelemetry('integrityQuarantined', Number(report?.quarantined || 0));
  bumpTelemetry('integrityDuplicates', Number(report?.duplicates || 0));
  if (!hasSupabase(cfg)) return run;
  try {
    await supaUpsert(cfg, 'match_integrity_runs', {
      run_id: runId,
      observed_at: observedAt,
      fixture_date: report?.requestedDate || null,
      inspected: Number(report?.inspected || 0), accepted: Number(report?.accepted || 0), clean: Number(report?.clean || 0), incomplete: Number(report?.incomplete || 0),
      warning_matches: Number(report?.warningMatches || 0), quarantined: Number(report?.quarantined || 0), duplicates: Number(report?.duplicates || 0), repaired: Number(report?.repaired || 0),
      warning_count: Number(report?.warnings || 0), error_count: Number(report?.errors || 0), quality_score: Number(report?.qualityScore || 0), health: report?.health || 'ok', metadata: {},
    }, 'run_id');
    const rows = (issues || []).slice(0, 60).map(issue => ({
      run_id: runId, observed_at: observedAt, fixture_date: report?.requestedDate || null, fixture_id: issue.fixtureId ? Number(issue.fixtureId) : null,
      severity: issue.severity || 'warning', issue_code: issue.code || 'DATA_QUALITY', message: String(issue.message || '').slice(0, 400),
      home_name: String(issue.home || '').slice(0, 120), away_name: String(issue.away || '').slice(0, 120), league_name: String(issue.league || '').slice(0, 160), metadata: safeOpsMetadata(issue.meta || {}),
    }));
    if (rows.length) await supaUpsert(cfg, 'match_integrity_events', rows);
  } catch (error) {
    bumpTelemetry('supabaseErrors');
    await recordOpsEvent(cfg, { severity: 'warning', source: 'integrity', eventType: 'persistence', code: 'INTEGRITY_DB_WRITE', message: error?.message || error, meta: { inspected: report?.inspected, quarantined: report?.quarantined } }).catch(() => {});
  }
  return run;
}

async function readIntegrityDiagnostics(cfg, limit = 12) {
  const fallback = () => ({ persistent: false, migrationReady: false, lastRun: memory.integrity.lastRun, recentIssues: memory.integrity.recentIssues.slice(0, limit) });
  if (!hasSupabase(cfg)) return { ...fallback(), migrationReady: true };
  try {
    const runs = await supaSelectMany(cfg, 'match_integrity_runs', {}, { limit: 1, order: 'observed_at.desc' });
    const events = await supaSelectMany(cfg, 'match_integrity_events', {}, { limit: Math.max(1, Math.min(30, limit)), order: 'observed_at.desc' });
    const row = runs?.[0] || null;
    const lastRun = row ? {
      runId: row.run_id, observedAt: row.observed_at, requestedDate: row.fixture_date, inspected: Number(row.inspected || 0), accepted: Number(row.accepted || 0), clean: Number(row.clean || 0), incomplete: Number(row.incomplete || 0),
      warningMatches: Number(row.warning_matches || 0), quarantined: Number(row.quarantined || 0), duplicates: Number(row.duplicates || 0), repaired: Number(row.repaired || 0), warnings: Number(row.warning_count || 0), errors: Number(row.error_count || 0), qualityScore: Number(row.quality_score || 0), health: row.health || 'ok',
    } : null;
    return { persistent: true, migrationReady: true, lastRun, recentIssues: events || [] };
  } catch {
    return fallback();
  }
}

async function apiDataIntegrity(request, cfg) {
  const data = await readIntegrityDiagnostics(cfg, 24);
  return json({ available: true, version: APP_VERSION, generatedAt: new Date().toISOString(), ...data });
}

async function apiMe(request, cfg, user) {
  const [quota, record, favorites, reminders, preferences] = await Promise.all([
    getQuota(user.id, cfg),
    getUserRecord(user.id, cfg),
    getFavorites(user.id, cfg),
    getReminders(user.id, cfg),
    getPreferences(user.id, cfg),
  ]);
  return json({
    user: {
      id: user.id,
      username: user.username || '',
      firstName: user.first_name || '',
      photoUrl: user.photo_url || '',
      createdAt: record?.created_at || null,
      subscriptionUntil: record?.subscription_until || null,
    },
    quota,
    billing: {
      plan: quota.plan,
      subscriptionUntil: record?.subscription_until || null,
      canceled: Boolean(record?.subscription_canceled),
      paymentChargeIdPresent: Boolean(record?.telegram_payment_charge_id),
    },
    features: {
      monetizationEnabled: cfg.monetizationEnabled,
      isAdmin: isAdminUser(user, cfg),
      role: isAdminUser(user, cfg) ? 'admin' : 'user',
      dataCapabilities: publicDataCapabilities(),
      runtime: publicRuntimeControls(),
    },
    preferences,
    stats: { favorites: favorites.length, reminders: reminders.length },
  });
}

async function apiHistory(request, cfg, user) {
  const rows = await getHistory(user.id, cfg);
  return json({
    items: rows.map(x => ({
      fixtureId: Number(x.fixture_id),
      homeName: x.home_name || '',
      awayName: x.away_name || '',
      leagueName: x.league_name || '',
      fixtureDate: x.fixture_date || '',
      homeLogo: x.home_logo || '',
      awayLogo: x.away_logo || '',
      viewedAt: x.viewed_at || '',
    })),
  });
}


async function apiFavorites(request, cfg, user) {
  if (request.method === 'GET') {
    const rows = await getFavorites(user.id, cfg);
    return json({ items: rows.map(x => ({ teamId: Number(x.team_id), teamName: x.team_name || '', teamLogo: x.team_logo || '' })) });
  }
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const row = await addFavorite(user.id, { id: body.teamId, name: body.teamName, logo: body.teamLogo }, cfg);
    return json({ ok: true, item: { teamId: row.team_id, teamName: row.team_name, teamLogo: row.team_logo } });
  }
  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const teamId = Number(url.searchParams.get('teamId'));
    if (!teamId) return json({ error: 'teamId обязателен.' }, 400);
    await removeFavorite(user.id, teamId, cfg);
    return json({ ok: true });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}

async function apiReminders(request, cfg, user) {
  if (request.method === 'GET') {
    const rows = await getReminders(user.id, cfg);
    return json({ items: rows.map(x => ({
      fixtureId: Number(x.fixture_id), homeName: x.home_name || '', awayName: x.away_name || '',
      leagueName: x.league_name || '', fixtureDate: x.fixture_date || '', notifiedAt: x.notified_at || null,
      remindBeforeMinutes: Number(x.remind_before_minutes || 30), kickoffNotify: x.kickoff_notify !== false, kickoffNotifiedAt: x.kickoff_notified_at || null,
      deliveryStatus: reminderDeliveryStatus(x),
      deliveryAttempts: Number(x.prematch_attempts || 0) + Number(x.kickoff_attempts || 0),
      deliveryLastAttemptAt: x.delivery_last_attempt_at || null,
    })) });
  }
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const row = await addReminder(user.id, body, cfg);
    return json({ ok: true, item: { fixtureId: row.fixture_id, fixtureDate: row.fixture_date } });
  }
  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const fixtureId = Number(url.searchParams.get('fixtureId'));
    if (!fixtureId) return json({ error: 'fixtureId обязателен.' }, 400);
    await removeReminder(user.id, fixtureId, cfg);
    return json({ ok: true });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}

async function apiPreferences(request, cfg, user) {
  if (request.method === 'GET') return json({ preferences: await getPreferences(user.id, cfg) });
  if (request.method === 'PUT' || request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const preferences = await savePreferences(user.id, body, cfg);
    return json({ ok: true, preferences });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}


const SEARCH_COMPETITION_ALIASES = new Map([
  [1, 'world cup чемпионат мира чм fifa'],
  [2, 'champions league ucl лига чемпионов лч'],
  [3, 'europa league uel лига европы ле'],
  [4, 'euro european championship евро'],
  [9, 'copa america копа америка'],
  [15, 'club world cup клубный чемпионат мира кчм'],
  [39, 'premier league epl english premier league апл премьер лига англия'],
  [40, 'championship efl championship чемпионшип англия'],
  [45, 'fa cup кубок англии'],
  [48, 'efl cup carabao cup league cup кубок лиги англия'],
  [61, 'ligue 1 лига 1 франция'],
  [62, 'ligue 2 лига 2 франция'],
  [66, 'coupe de france кубок франции'],
  [71, 'brasileirao serie a brazil бразилия серия а'],
  [78, 'bundesliga бундеслига германия'],
  [79, '2 bundesliga вторая бундеслига германия'],
  [81, 'dfb pokal кубок германии'],
  [88, 'eredivisie эредивизи нидерланды'],
  [94, 'primeira liga португалия примейра лига'],
  [128, 'argentina liga profesional аргентина'],
  [135, 'serie a italy серия а италия'],
  [136, 'serie b italy серия b италия'],
  [137, 'coppa italia кубок италии'],
  [140, 'la liga laliga примера испания ла лига'],
  [141, 'segunda division сегунда испания'],
  [143, 'copa del rey кубок испании'],
  [203, 'super lig turkey суперлига турция'],
  [253, 'mls major league soccer сша'],
  [307, 'saudi pro league саудовская про лига'],
  [848, 'conference league uecl лига конференций лк'],
]);

function searchText(value = '') {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function competitionCountryByGroup(group = '') {
  const map = {
    england: 'Англия', spain: 'Испания', italy: 'Италия', germany: 'Германия', france: 'Франция',
    portugal: 'Португалия', netherlands: 'Нидерланды', brazil: 'Бразилия', argentina: 'Аргентина',
    turkey: 'Турция', usa: 'США', saudi: 'Саудовская Аравия', international: 'Международные',
  };
  return map[String(group || '')] || 'Мир';
}

function searchKnownCompetitions(query = '') {
  const q = searchText(query);
  const season = new Date().getUTCFullYear();
  const rows = [];
  for (const [id, item] of COMPETITIONS.entries()) {
    const aliases = SEARCH_COMPETITION_ALIASES.get(Number(id)) || '';
    const hay = searchText(`${item.name || ''} ${item.short || ''} ${aliases} ${competitionCountryByGroup(item.group)}`);
    if (q && !hay.includes(q)) continue;
    let score = Number(item.priority || 0);
    if (q) {
      const name = searchText(item.name || '');
      const short = searchText(item.short || '');
      if (name === q || short === q) score += 120;
      else if (name.startsWith(q) || short.startsWith(q)) score += 70;
      else if (hay.includes(q)) score += 30;
    }
    rows.push({
      leagueId: Number(id), season,
      name: item.name || `Турнир ${id}`,
      shortName: item.short || item.name || `Турнир ${id}`,
      country: competitionCountryByGroup(item.group),
      category: item.category || 'league', tier: item.tier || 'standard', group: item.group || 'other',
      priority: Number(item.priority || 0), score,
    });
  }
  return rows.sort((a,b) => b.score - a.score || b.priority - a.priority).slice(0, q ? 8 : 10);
}

function normalizeSearchTeam(row = {}, query = '') {
  const team = row?.team || row || {};
  const name = String(team.name || '');
  const q = searchText(query);
  const n = searchText(name);
  let score = 0;
  if (q && n === q) score += 140;
  else if (q && n.startsWith(q)) score += 90;
  else if (q && n.includes(q)) score += 50;
  if (BIG_TEAM_RE.test(name)) score += 25;
  const youthReserve = YOUTH_RESERVE_RE.test(name);
  if (youthReserve) score -= 45;
  if (team.national) score += 10;
  return {
    id: Number(team.id || 0), name,
    code: String(team.code || ''), country: normalizeCountryName(team.country || ''), countryRaw: String(team.country || ''),
    logo: String(team.logo || ''), national: Boolean(team.national), founded: Number(team.founded || 0) || null,
    youthReserve, venue: row?.venue ? { name: row.venue.name || '', city: row.venue.city || '' } : null,
    score,
  };
}

async function apiSearch(request, cfg) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 60);
  const q = searchText(query);
  const competitions = searchKnownCompetitions(query);
  if (!q) return json({ query: '', teams: [], competitions, provider: publicDataCapabilities(), hint: 'Введите название команды или турнира.' });
  if (q.length < 3) return json({ query, teams: [], competitions, provider: publicDataCapabilities(), hint: 'Для поиска команды введите минимум 3 символа.' });

  const cacheKey = `search:teams:${encodeURIComponent(q)}:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached?.teams) return json({ ...cached, competitions, cached: true, provider: publicDataCapabilities() });

  let rows = [];
  let warning = '';
  try {
    if (!freeQuotaHealthy(8, 2)) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale?.teams) return json({ ...stale, competitions, cached: true, stale: true, warning: 'Поиск показан из кэша: бережём лимит API-Football.', provider: publicDataCapabilities() });
      return json({ query, teams: [], competitions, cached: false, warning: 'Поиск команд временно не запущен: бережём остаток бесплатной квоты API.', provider: publicDataCapabilities() });
    }
    rows = await apiFootball('/teams', { search: query }, cfg);
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale?.teams) return json({ ...stale, competitions, cached: true, stale: true, warning: 'Не удалось обновить поиск — показаны сохранённые результаты.', provider: publicDataCapabilities() });
    if (isFootballRateLimitError(error)) warning = 'API-Football временно ограничил поиск команд. Повторите чуть позже.';
    else throw error;
  }

  const seen = new Set();
  const teams = rows.map(x => normalizeSearchTeam(x, query))
    .filter(x => x.id > 0 && x.name && !seen.has(x.id) && seen.add(x.id))
    .sort((a,b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 16);
  const payload = { query, teams, warning, refreshedAt: new Date().toISOString() };
  await setCache(cacheKey, 0, payload, cfg, 720);
  return json({ ...payload, competitions, cached: false, provider: publicDataCapabilities() });
}

async function apiMatches(request, cfg) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('date') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayUtc();
  const isToday = date === todayUtc();
  const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const isYesterday = date === yesterday.toISOString().slice(0, 10);
  const cacheKey = `matches:${date}:v6-integrity`;

  const cached = await getCache(cacheKey, cfg);
  if (cached?.matches) return json({ ...cached, cached: true, stale: false });
  const previousPayload = await getStaleCache(cacheKey, cfg).catch(() => null);

  let fixtures;
  try {
    fixtures = await apiFootball('/fixtures', { date }, cfg);
  } catch (error) {
    const stale = previousPayload || await getStaleCache(cacheKey, cfg);
    if (stale?.matches && isFootballRateLimitError(error)) {
      return json({
        ...stale, cached: true, stale: true,
        warning: 'Показаны последние сохранённые данные: API-Football временно ограничил частоту запросов.',
        retryAfter: Number(error?.retryAfter || 60),
      });
    }
    throw error;
  }

  const integrityRun = runMatchIntegrityGuard(fixtures, date, previousPayload);
  await persistIntegrityRun(cfg, integrityRun.report, integrityRun.issues).catch(() => null);
  const verifiedFixtures = integrityRun.accepted;

  // Reuse the verified fixtures request we already made to settle tracked predictions at zero additional provider cost.
  await settlePredictionsFromFixtures(verifiedFixtures.map(x => x.fixture), cfg).catch(() => null);

  const matches = verifiedFixtures
    .filter(entry => !['CANC', 'PST', 'ABD', 'AWD', 'WO'].includes(entry.fixture?.fixture?.status?.short || ''))
    .map(entry => {
      const f = entry.fixture;
      const integrity = entry.integrity;
      const status = f.fixture?.status?.short || '';
      const elapsed = Number(f.fixture?.status?.elapsed ?? 0) || null;
      const leagueId = Number(f.league?.id || 0);
      const leagueName = f.league?.name || '';
      const country = f.league?.country || '';
      const homeName = f.teams?.home?.name || '';
      const awayName = f.teams?.away?.name || '';
      const competition = normalizeCompetition(leagueId, leagueName, country, homeName, awayName);
      const top = competition.featured || isTopLeague(leagueId, leagueName);
      const live = isLiveStatus(status);
      const finished = isFinishedStatus(status);
      const round = f.league?.round || '';
      const roundLabel = normalizeRoundLabel(round);
      return {
        fixtureId: f.fixture?.id,
        date: f.fixture?.date,
        status,
        statusLong: f.fixture?.status?.long || '',
        statusLabel: statusLabel(status, elapsed),
        elapsed,
        finished,
        live,
        score: scoreSnapshot(f),
        leagueId,
        season: Number(f.league?.season || 0) || null,
        league: competition.name,
        leagueOriginal: leagueName,
        leagueShort: competition.shortName,
        round,
        roundLabel,
        country: competition.country,
        countryRaw: country,
        leagueLogo: f.league?.logo || '',
        isTop: top,
        featured: Boolean(competition.featured),
        group: competition.group,
        category: competition.category,
        competition,
        youthReserve: competition.youth,
        lowPriority: competition.youth || competition.friendly || competition.lower,
        coverageTier: competition.youth || competition.lower ? 'basic' : competition.tier === 'elite' ? 'enhanced' : 'standard',
        interestScore: matchInterestScore({ competition, leagueId, leagueName, country, homeName, awayName, status, date: f.fixture?.date }),
        integrity,
        home: { id: f.teams?.home?.id, name: homeName, logo: f.teams?.home?.logo || '' },
        away: { id: f.teams?.away?.id, name: awayName, logo: f.teams?.away?.logo || '' },
      };
    })
    .sort((a, b) =>
      matchStatusRank(a.status) - matchStatusRank(b.status) ||
      catalogRank(a) - catalogRank(b) ||
      Number(b.interestScore || 0) - Number(a.interestScore || 0) ||
      Number(b.competition?.priority || 0) - Number(a.competition?.priority || 0) ||
      String(a.date || '').localeCompare(String(b.date || ''))
    )
    .slice(0, 120);

  const catalog = {
    featured: matches.filter(x => x.featured).length,
    live: matches.filter(x => x.live).length,
    major: matches.filter(x => ['elite','major'].includes(x.competition?.tier)).length,
    cups: matches.filter(x => x.category === 'cup').length,
    international: matches.filter(x => ['continental','national','international'].includes(x.category)).length,
    hiddenLowPriority: matches.filter(x => x.lowPriority).length,
  };
  const payload = { date, matches, catalog, integrity: integrityRun.report, refreshedAt: new Date().toISOString(), provider: publicDataCapabilities() };
  const ttl = isToday ? 1 : isYesterday ? 720 : cfg.cacheMinutes;
  await setCache(cacheKey, 0, payload, cfg, ttl);
  return json({ ...payload, cached: false, stale: false });
}


function normalizeStandingRow(row = {}) {
  const all = row?.all || {};
  const goals = all?.goals || {};
  return {
    rank: Number(row?.rank || 0),
    team: {
      id: Number(row?.team?.id || 0),
      name: String(row?.team?.name || ''),
      logo: String(row?.team?.logo || ''),
    },
    points: Number(row?.points || 0),
    goalsDiff: Number(row?.goalsDiff || 0),
    played: Number(all?.played || 0),
    win: Number(all?.win || 0),
    draw: Number(all?.draw || 0),
    lose: Number(all?.lose || 0),
    goalsFor: Number(goals?.for || 0),
    goalsAgainst: Number(goals?.against || 0),
    form: String(row?.form || '').slice(-6),
    description: String(row?.description || ''),
  };
}

async function apiTournament(request, cfg) {
  const url = new URL(request.url);
  const leagueId = Number(url.searchParams.get('leagueId'));
  const season = Number(url.searchParams.get('season'));
  if (!Number.isFinite(leagueId) || leagueId <= 0) return json({ error: 'leagueId обязателен.' }, 400);
  if (!Number.isFinite(season) || season < 2000 || season > 2100) return json({ error: 'season обязателен.' }, 400);

  const cacheKey = `tournament:${leagueId}:${season}:standings:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return json({ ...cached, cached: true, stale: false, provider: publicDataCapabilities() });

  // Таблица — дополнительный запрос. На FREE не тратим последний запрос минутной квоты.
  const minuteRemaining = Number(memory.provider?.minuteRemaining);
  if (Number.isFinite(minuteRemaining) && minuteRemaining <= 1) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Таблица показана из сохранённого кэша: минутная квота API почти исчерпана.', provider: publicDataCapabilities() });
    return json({
      leagueId, season, standings: [], groups: [], available: false,
      reason: 'Таблица временно не запрашивается: бережём последний запрос минутной квоты API-Football.',
      provider: publicDataCapabilities(),
    });
  }

  try {
    const response = await apiFootball('/standings', { league: leagueId, season }, cfg);
    const league = response?.[0]?.league || {};
    const groups = Array.isArray(league?.standings) ? league.standings : [];
    const normalizedGroups = groups.map((rows, index) => ({
      name: groups.length > 1 ? `Группа ${index + 1}` : '',
      rows: (Array.isArray(rows) ? rows : []).map(normalizeStandingRow).filter(x => x.team.id),
    })).filter(g => g.rows.length);
    const standings = normalizedGroups.flatMap(g => g.rows);
    const payload = {
      leagueId,
      season,
      available: standings.length > 0,
      league: {
        id: Number(league?.id || leagueId),
        name: String(league?.name || ''),
        country: normalizeCountryName(league?.country || ''),
        logo: String(league?.logo || ''),
        flag: String(league?.flag || ''),
        season: Number(league?.season || season),
      },
      groups: normalizedGroups,
      standings,
      refreshedAt: new Date().toISOString(),
      reason: standings.length ? '' : 'Провайдер не вернул таблицу для этого турнира и сезона.',
    };
    await setCache(cacheKey, 0, payload, cfg, 360);
    return json({ ...payload, cached: false, stale: false, provider: publicDataCapabilities() });
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Не удалось обновить таблицу — показана последняя сохранённая версия.', provider: publicDataCapabilities() });
    return json({
      leagueId, season, standings: [], groups: [], available: false,
      reason: `Таблица сейчас недоступна: ${String(error?.message || error).slice(0, 180)}`,
      provider: publicDataCapabilities(),
    });
  }
}


function normalizeTeamHubMatch(f, teamId) {
  const homeId = Number(f.teams?.home?.id || 0);
  const awayId = Number(f.teams?.away?.id || 0);
  const isHome = homeId === Number(teamId);
  const opponent = isHome ? f.teams?.away : f.teams?.home;
  const status = String(f.fixture?.status?.short || '');
  const elapsed = Number(f.fixture?.status?.elapsed ?? 0) || null;
  const competition = normalizeCompetition(Number(f.league?.id || 0), f.league?.name || '', f.league?.country || '', f.teams?.home?.name || '', f.teams?.away?.name || '');
  const result = isFinishedStatus(status) ? teamResult(f, teamId) : null;
  return {
    fixtureId: Number(f.fixture?.id || 0), date: f.fixture?.date || '', status,
    statusLong: f.fixture?.status?.long || '', statusLabel: statusLabel(status, elapsed), elapsed,
    live: isLiveStatus(status), finished: isFinishedStatus(status), score: scoreSnapshot(f),
    venue: isHome ? 'home' : 'away', result: result?.result || '', goalsFor: result?.gf ?? null, goalsAgainst: result?.ga ?? null,
    opponent: { id: Number(opponent?.id || 0), name: String(opponent?.name || ''), logo: String(opponent?.logo || '') },
    home: { id: homeId, name: f.teams?.home?.name || '', logo: f.teams?.home?.logo || '' },
    away: { id: awayId, name: f.teams?.away?.name || '', logo: f.teams?.away?.logo || '' },
    leagueId: Number(f.league?.id || 0), season: Number(f.league?.season || 0) || null,
    league: competition.name, leagueShort: competition.shortName, leagueLogo: f.league?.logo || '', country: competition.country,
    round: f.league?.round || '', roundLabel: normalizeRoundLabel(f.league?.round || ''), competition,
  };
}

function choosePrimaryTeamCompetition(matches = []) {
  const byLeague = new Map();
  for (const m of matches) {
    const id = Number(m.leagueId || 0);
    if (!id || m.competition?.youth || m.competition?.friendly) continue;
    const cur = byLeague.get(id) || { count: 0, item: m, priority: Number(m.competition?.priority || 0) };
    cur.count += 1;
    if (Number(m.competition?.priority || 0) > cur.priority) { cur.priority = Number(m.competition?.priority || 0); cur.item = m; }
    byLeague.set(id, cur);
  }
  const best = [...byLeague.values()].sort((a,b) => (b.count*10+b.priority) - (a.count*10+a.priority))[0];
  if (!best?.item) return null;
  const m = best.item;
  return { leagueId:Number(m.leagueId), season:Number(m.season || new Date().getFullYear()), name:m.league||'Турнир', shortName:m.leagueShort||m.league||'Турнир', logo:m.leagueLogo||'', country:m.country||'', category:m.competition?.category||'', tier:m.competition?.tier||'standard', priority:Number(m.competition?.priority||0) };
}

async function cachedTeamStanding(teamId, competition, cfg) {
  if (!competition?.leagueId || !competition?.season) return null;
  const cached = await getCache(`tournament:${Number(competition.leagueId)}:${Number(competition.season)}:standings:v1`, cfg);
  const row = cached?.standings?.find?.(x => Number(x.team?.id) === Number(teamId));
  if (!row) return null;
  return { rank:Number(row.rank||0), points:Number(row.points||0), played:Number(row.played||0), win:Number(row.win||0), draw:Number(row.draw||0), lose:Number(row.lose||0), goalsFor:Number(row.goalsFor||0), goalsAgainst:Number(row.goalsAgainst||0), goalsDiff:Number(row.goalsDiff||0), form:String(row.form||'') };
}

async function apiTeam(request, cfg) {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get('teamId'));
  if (!Number.isFinite(teamId) || teamId <= 0) return json({ error: 'teamId обязателен.' }, 400);
  const fromDate = new Date(); fromDate.setUTCDate(fromDate.getUTCDate() - 45);
  const toDate = new Date(); toDate.setUTCDate(toDate.getUTCDate() + 45);
  const from = fromDate.toISOString().slice(0,10), to = toDate.toISOString().slice(0,10);
  const cacheKey = `teamhub:${teamId}:${from}:${to}:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return json({ ...cached, standing: await cachedTeamStanding(teamId, cached.primaryCompetition, cfg), cached:true, stale:false, provider:publicDataCapabilities() });
  let fixtures;
  try { fixtures = await apiFootball('/fixtures', { team:teamId, from, to }, cfg); }
  catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale && isFootballRateLimitError(error)) return json({ ...stale, standing:await cachedTeamStanding(teamId, stale.primaryCompetition, cfg), cached:true, stale:true, warning:'Страница команды показана из последнего кэша из-за лимита API.', provider:publicDataCapabilities() });
    throw error;
  }
  const usable = (fixtures||[]).filter(f => !['CANC','ABD','AWD','WO'].includes(String(f.fixture?.status?.short||'')));
  const normalized = usable.map(f => normalizeTeamHubMatch(f, teamId)).filter(x => x.fixtureId);
  const now = Date.now();
  const recent = normalized.filter(x => x.finished).sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0)).slice(0,8);
  const upcoming = normalized.filter(x => !x.finished && (x.live || Date.parse(x.date||0) >= now - 3*60*60*1000)).sort((a,b)=>(a.live===b.live ? Date.parse(a.date||0)-Date.parse(b.date||0) : a.live ? -1 : 1)).slice(0,8);
  let rawTeam = null;
  for (const f of usable) {
    if (Number(f.teams?.home?.id)===teamId) { rawTeam=f.teams.home; break; }
    if (Number(f.teams?.away?.id)===teamId) { rawTeam=f.teams.away; break; }
  }
  const team = { id:teamId, name:String(rawTeam?.name || url.searchParams.get('name') || `Команда ${teamId}`), logo:String(rawTeam?.logo || url.searchParams.get('logo') || '') };
  const completedRaw = usable.filter(f => isFinishedStatus(f.fixture?.status?.short));
  const form = summarizeFormRows(completedRaw, teamId, 'home')?.overall || null;
  const primaryCompetition = choosePrimaryTeamCompetition(normalized);
  const standing = await cachedTeamStanding(teamId, primaryCompetition, cfg);
  const payload = { team, primaryCompetition, standing, form, recent, upcoming, liveNow:upcoming.find(x=>x.live)||null, nextMatch:upcoming.find(x=>!x.live)||upcoming[0]||null, refreshedAt:new Date().toISOString() };
  await setCache(cacheKey, teamId, payload, cfg, 120);
  return json({ ...payload, cached:false, stale:false, provider:publicDataCapabilities() });
}


function teamStatsNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function teamStatsAvg(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function teamStatsRate(part, total) {
  const p = teamStatsNum(part), t = teamStatsNum(total);
  return t > 0 ? Math.round((p / t) * 1000) / 10 : null;
}

function normalizeTeamSeasonStatistics(row, fallback = {}) {
  const fixtures = row?.fixtures || {};
  const played = fixtures.played || {};
  const wins = fixtures.wins || {};
  const draws = fixtures.draws || {};
  const loses = fixtures.loses || {};
  const goalsFor = row?.goals?.for || {};
  const goalsAgainst = row?.goals?.against || {};
  const totalPlayed = teamStatsNum(played.total);
  const points = teamStatsNum(wins.total) * 3 + teamStatsNum(draws.total);
  const homePlayed = teamStatsNum(played.home), awayPlayed = teamStatsNum(played.away);
  const homePoints = teamStatsNum(wins.home) * 3 + teamStatsNum(draws.home);
  const awayPoints = teamStatsNum(wins.away) * 3 + teamStatsNum(draws.away);
  const gf = teamStatsNum(goalsFor?.total?.total), ga = teamStatsNum(goalsAgainst?.total?.total);
  const clean = row?.clean_sheet || {}, failed = row?.failed_to_score || {};
  const biggest = row?.biggest || {};
  const penalties = row?.penalty || {};
  const lineups = Array.isArray(row?.lineups) ? row.lineups : [];
  const mostUsedLineup = [...lineups].sort((a,b) => teamStatsNum(b?.played) - teamStatsNum(a?.played))[0] || null;
  return {
    available: Boolean(row && (row.team?.id || fallback.teamId)),
    team: {
      id: Number(row?.team?.id || fallback.teamId || 0),
      name: String(row?.team?.name || fallback.teamName || ''),
      logo: String(row?.team?.logo || fallback.teamLogo || ''),
    },
    league: {
      id: Number(row?.league?.id || fallback.leagueId || 0),
      name: String(row?.league?.name || fallback.leagueName || ''),
      country: normalizeCountryName(row?.league?.country || fallback.country || ''),
      logo: String(row?.league?.logo || fallback.leagueLogo || ''),
      season: Number(row?.league?.season || fallback.season || 0),
    },
    form: String(row?.form || ''),
    fixtures: {
      played: { home: homePlayed, away: awayPlayed, total: totalPlayed },
      wins: { home: teamStatsNum(wins.home), away: teamStatsNum(wins.away), total: teamStatsNum(wins.total) },
      draws: { home: teamStatsNum(draws.home), away: teamStatsNum(draws.away), total: teamStatsNum(draws.total) },
      losses: { home: teamStatsNum(loses.home), away: teamStatsNum(loses.away), total: teamStatsNum(loses.total) },
    },
    goals: {
      for: { home: teamStatsNum(goalsFor?.total?.home), away: teamStatsNum(goalsFor?.total?.away), total: gf, average: teamStatsAvg(goalsFor?.average?.total) },
      against: { home: teamStatsNum(goalsAgainst?.total?.home), away: teamStatsNum(goalsAgainst?.total?.away), total: ga, average: teamStatsAvg(goalsAgainst?.average?.total) },
      difference: gf - ga,
    },
    cleanSheets: { home: teamStatsNum(clean.home), away: teamStatsNum(clean.away), total: teamStatsNum(clean.total) },
    failedToScore: { home: teamStatsNum(failed.home), away: teamStatsNum(failed.away), total: teamStatsNum(failed.total) },
    biggest: {
      winHome: String(biggest?.wins?.home || ''), winAway: String(biggest?.wins?.away || ''),
      lossHome: String(biggest?.loses?.home || ''), lossAway: String(biggest?.loses?.away || ''),
      goalsForHome: teamStatsNum(biggest?.goals?.for?.home), goalsForAway: teamStatsNum(biggest?.goals?.for?.away),
      goalsAgainstHome: teamStatsNum(biggest?.goals?.against?.home), goalsAgainstAway: teamStatsNum(biggest?.goals?.against?.away),
    },
    penalties: {
      scored: teamStatsNum(penalties?.scored?.total), missed: teamStatsNum(penalties?.missed?.total), total: teamStatsNum(penalties?.total),
    },
    mostUsedLineup: mostUsedLineup ? { formation: String(mostUsedLineup.formation || ''), played: teamStatsNum(mostUsedLineup.played) } : null,
    derived: {
      points,
      ppg: totalPlayed ? Math.round((points / totalPlayed) * 100) / 100 : null,
      homePpg: homePlayed ? Math.round((homePoints / homePlayed) * 100) / 100 : null,
      awayPpg: awayPlayed ? Math.round((awayPoints / awayPlayed) * 100) / 100 : null,
      winRate: teamStatsRate(wins.total, totalPlayed),
      cleanSheetRate: teamStatsRate(clean.total, totalPlayed),
      failedToScoreRate: teamStatsRate(failed.total, totalPlayed),
      goalsForPerMatch: totalPlayed ? Math.round((gf / totalPlayed) * 100) / 100 : null,
      goalsAgainstPerMatch: totalPlayed ? Math.round((ga / totalPlayed) * 100) / 100 : null,
    },
  };
}

async function apiTeamIntelligence(request, cfg) {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get('teamId'));
  const leagueId = Number(url.searchParams.get('leagueId'));
  const season = Number(url.searchParams.get('season'));
  if (!teamId || !leagueId || !season) return json({ error: 'teamId, leagueId и season обязательны.' }, 400);
  const cacheKey = `team:intelligence:${teamId}:${leagueId}:${season}:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return json({ ...cached, cached: true, stale: false, provider: publicDataCapabilities() });
  if (!freeQuotaHealthy(15, 2)) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Сезонная статистика показана из кэша: бережём лимит API-Football.', provider: publicDataCapabilities() });
    return json({ available: false, quotaGuard: true, reason: 'Сезонная статистика временно не запрашивается: сохраняем остаток квоты API-Football.', provider: publicDataCapabilities() });
  }
  try {
    const row = await apiFootball('/teams/statistics', { team: teamId, league: leagueId, season }, cfg, { responseType: 'any' });
    const stats = normalizeTeamSeasonStatistics(row, {
      teamId, leagueId, season,
      teamName: url.searchParams.get('teamName') || '', teamLogo: url.searchParams.get('teamLogo') || '',
      leagueName: url.searchParams.get('leagueName') || '', country: url.searchParams.get('country') || '', leagueLogo: url.searchParams.get('leagueLogo') || '',
    });
    const payload = { available: stats.available, stats, refreshedAt: new Date().toISOString(), reason: stats.available ? '' : 'Провайдер не вернул сезонную статистику для этой команды.' };
    await setCache(cacheKey, teamId, payload, cfg, 360);
    return json({ ...payload, cached: false, stale: false, provider: publicDataCapabilities() });
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Не удалось обновить сезонную статистику — показана сохранённая версия.', provider: publicDataCapabilities() });
    return json({ available: false, reason: `Сезонная статистика сейчас недоступна: ${String(error?.message || error).slice(0, 180)}`, provider: publicDataCapabilities() });
  }
}

function normalizeSquadPosition(position) {
  const p = String(position || '').toLowerCase();
  if (p.includes('goal')) return { key: 'goalkeeper', label: 'Вратари', order: 1 };
  if (p.includes('def')) return { key: 'defender', label: 'Защитники', order: 2 };
  if (p.includes('mid')) return { key: 'midfielder', label: 'Полузащитники', order: 3 };
  if (p.includes('att')) return { key: 'attacker', label: 'Нападающие', order: 4 };
  return { key: 'other', label: 'Другие', order: 5 };
}

function normalizeTeamSquad(rows, teamId) {
  const row = (Array.isArray(rows) ? rows : []).find(x => Number(x?.team?.id) === Number(teamId)) || rows?.[0] || null;
  if (!row) return { available: false, team: { id: Number(teamId) }, players: [], groups: [], summary: { total: 0, averageAge: null } };
  const players = (Array.isArray(row.players) ? row.players : []).map(p => {
    const pos = normalizeSquadPosition(p.position);
    return {
      id: Number(p.id || 0), name: String(p.name || ''), age: Number(p.age || 0) || null,
      number: Number(p.number || 0) || null, position: String(p.position || ''), positionKey: pos.key, positionLabel: pos.label,
      photo: String(p.photo || ''), order: pos.order,
    };
  }).filter(p => p.id || p.name).sort((a,b) => a.order - b.order || (a.number || 999) - (b.number || 999) || a.name.localeCompare(b.name));
  const ages = players.map(p => p.age).filter(Boolean);
  const groupMap = new Map();
  for (const p of players) {
    if (!groupMap.has(p.positionKey)) groupMap.set(p.positionKey, { key: p.positionKey, label: p.positionLabel, order: p.order, players: [] });
    groupMap.get(p.positionKey).players.push(p);
  }
  const groups = [...groupMap.values()].sort((a,b) => a.order - b.order);
  return {
    available: players.length > 0,
    team: { id: Number(row.team?.id || teamId), name: String(row.team?.name || ''), logo: String(row.team?.logo || '') },
    players, groups,
    summary: {
      total: players.length,
      averageAge: ages.length ? Math.round((ages.reduce((a,b)=>a+b,0) / ages.length) * 10) / 10 : null,
      goalkeepers: players.filter(p => p.positionKey === 'goalkeeper').length,
      defenders: players.filter(p => p.positionKey === 'defender').length,
      midfielders: players.filter(p => p.positionKey === 'midfielder').length,
      attackers: players.filter(p => p.positionKey === 'attacker').length,
    },
  };
}

async function apiTeamSquad(request, cfg) {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get('teamId'));
  if (!teamId) return json({ error: 'teamId обязателен.' }, 400);
  const cacheKey = `team:squad:${teamId}:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return json({ ...cached, cached: true, stale: false, provider: publicDataCapabilities() });
  if (!freeQuotaHealthy(10, 2)) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Состав показан из кэша: бережём лимит API-Football.', provider: publicDataCapabilities() });
    return json({ available: false, quotaGuard: true, reason: 'Состав временно не запрашивается: сохраняем остаток квоты API-Football.', provider: publicDataCapabilities() });
  }
  try {
    const rows = await apiFootball('/players/squads', { team: teamId }, cfg);
    const squad = normalizeTeamSquad(rows, teamId);
    const payload = { ...squad, refreshedAt: new Date().toISOString(), reason: squad.available ? '' : 'Провайдер не вернул текущий состав команды.' };
    await setCache(cacheKey, teamId, payload, cfg, 720);
    return json({ ...payload, cached: false, stale: false, provider: publicDataCapabilities() });
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Не удалось обновить состав — показана сохранённая версия.', provider: publicDataCapabilities() });
    return json({ available: false, reason: `Состав сейчас недоступен: ${String(error?.message || error).slice(0, 180)}`, provider: publicDataCapabilities() });
  }
}

async function apiMatchCenter(request, cfg) {
  const url = new URL(request.url);
  const fixtureId = Number(url.searchParams.get('fixtureId'));
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) return json({ error: 'fixtureId обязателен.' }, 400);

  // Shared across all users. During LIVE it expires after 60 seconds.
  const baseCacheKey = `match-center:${fixtureId}:v9-quota-orchestrator`;
  const cached = await getCache(baseCacheKey, cfg);
  if (cached) return json({ ...cached, cached: true });

  let fixture;
  try {
    fixture = (await apiFootball('/fixtures', { id: fixtureId }, cfg))[0];
  } catch (error) {
    const stale = await getStaleCache(baseCacheKey, cfg);
    if (stale && isFootballRateLimitError(error)) {
      return json({ ...stale, cached: true, stale: true, warning: 'LIVE-данные временно показаны из последнего кэша из-за лимита API.', retryAfter: Number(error?.retryAfter || 60) });
    }
    throw error;
  }
  if (!fixture) return json({ error: 'Матч не найден.' }, 404);
  const centerIntegrity = validateFixtureIntegrity(fixture, '', null);
  if (centerIntegrity.quarantine) {
    await recordOpsEvent(cfg, { severity: 'warning', source: 'integrity', eventType: 'single_fixture_guard', code: 'MATCH_CENTER_REJECTED', message: 'Match Center отклонил structurally invalid fixture.', meta: { fixtureId, issues: centerIntegrity.issues.filter(x => x.severity === 'error').map(x => x.code) } }).catch(() => {});
    return json({ error: 'Данные этого матча не прошли проверку целостности. Попробуйте позже.', code: 'MATCH_DATA_INVALID', integrity: centerIntegrity }, 409);
  }

  const status = fixture.fixture?.status?.short || '';
  const elapsed = Number(fixture.fixture?.status?.elapsed ?? 0) || null;
  const live = isLiveStatus(status);
  const finished = isFinishedStatus(status);
  const homeId = fixture.teams?.home?.id;
  const awayId = fixture.teams?.away?.id;
  const embedded = embeddedLiveData(fixture);
  const leagueName = fixture.league?.name || '';
  const homeName = fixture.teams?.home?.name || '';
  const awayName = fixture.teams?.away?.name || '';
  const limitedCoverage = isYouthReserveMatch(leagueName, homeName, awayName);
  const centerMode = live ? 'live' : finished ? 'finished' : 'upcoming';
  const featureMeta = {};

  // v4.9: every expensive enrichment feature gets its own cache + quota policy.
  // Do not burn extra /events + /statistics calls when coverage is predictably low.
  // For senior competitions, targeted fallbacks are still allowed when embedded
  // fixture data does not contain details.
  let events = embedded.events;
  let statistics = embedded.statistics;
  let playerRows = embedded.players;
  let lineupRows = embedded.lineups;
  let injuryRows = [];

  if (events.length) {
    featureMeta.events = { feature: 'events', source: 'embedded', ageSeconds: 0, policy: providerFeaturePolicy('events', { mode: centerMode, limitedCoverage }) };
  } else if (live || finished) {
    const result = await providerFeatureFetch({
      feature: 'events', path: '/fixtures/events', params: { fixture: fixtureId },
      fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
    });
    events = result.data;
    featureMeta.events = result.meta;
  }

  if (statistics.length) {
    featureMeta.statistics = { feature: 'statistics', source: 'embedded', ageSeconds: 0, policy: providerFeaturePolicy('statistics', { mode: centerMode, limitedCoverage }) };
  } else if (live || finished) {
    const result = await providerFeatureFetch({
      feature: 'statistics', path: '/fixtures/statistics', params: { fixture: fixtureId },
      fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
    });
    statistics = result.data;
    featureMeta.statistics = result.meta;
  }

  if (playerRows.length) {
    featureMeta.players = { feature: 'players', source: 'embedded', ageSeconds: 0, policy: providerFeaturePolicy('players', { mode: centerMode, limitedCoverage }) };
  } else if (live || finished) {
    const result = await providerFeatureFetch({
      feature: 'players', path: '/fixtures/players', params: { fixture: fixtureId },
      fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
    });
    playerRows = result.data;
    featureMeta.players = result.meta;
  }

  const kickoffMsCenter = fixture.fixture?.date ? Date.parse(fixture.fixture.date) : NaN;
  const minutesToKickoffCenter = Number.isFinite(kickoffMsCenter)
    ? Math.round((kickoffMsCenter - Date.now()) / 60000)
    : null;
  const lineupsWindow = live || finished || (
    minutesToKickoffCenter !== null && minutesToKickoffCenter <= 120 && minutesToKickoffCenter >= -300
  );

  if (lineupRows.length) {
    featureMeta.lineups = { feature: 'lineups', source: 'embedded', ageSeconds: 0, policy: providerFeaturePolicy('lineups', { mode: centerMode, limitedCoverage }) };
  } else if (lineupsWindow) {
    const result = await providerFeatureFetch({
      feature: 'lineups', path: '/fixtures/lineups', params: { fixture: fixtureId },
      fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
    });
    lineupRows = result.data;
    featureMeta.lineups = result.meta;
  }

  if (!finished) {
    const result = await providerFeatureFetch({
      feature: 'injuries', path: '/injuries', params: { fixture: fixtureId },
      fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
    });
    injuryRows = result.data;
    featureMeta.injuries = result.meta;
  }

  let liveOdds = null;
  let oddsMovement = null;
  if (live && cfg.liveOddsEnabled) {
    const result = await providerFeatureFetch({
      feature: 'liveOdds', path: '/odds/live', params: { fixture: fixtureId },
      fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
    });
    featureMeta.liveOdds = result.meta;
    liveOdds = extractLiveMarket(result.data);
    if (liveOdds) {
      await saveOddsSnapshot(fixtureId, liveOdds, cfg);
      const snapshots = await getOddsSnapshots(fixtureId, cfg, 12);
      oddsMovement = buildOddsMovement(snapshots, liveOdds);
    }
  }
  const refreshSeconds = live && runtimeControlsSnapshot().liveEnabled !== false ? providerBudgetProfile().liveRefreshSeconds : 0;
  const formattedStatistics = formatLiveStatistics(statistics, homeId, awayId);
  const playerLeaders = formatPlayerLeaders(playerRows, homeId, awayId);
  const lineups = formatLineups(lineupRows, homeId, awayId);
  const absences = formatAbsences(injuryRows, homeId, awayId);
  const pressure = (live || finished) ? livePressure(formattedStatistics) : null;
  const formattedEvents = formatLiveEvents(events, homeId, awayId);
  const smartInsights = (live || finished) ? buildSmartMatchInsights({
    statistics: formattedStatistics,
    events: formattedEvents,
    pressure,
    score: scoreSnapshot(fixture),
    elapsed,
    status,
    homeName,
    awayName,
    playerLeaders,
    absences,
  }) : null;

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: live ? 'live' : finished ? 'finished' : 'upcoming',
    match: {
      fixtureId,
      date: fixture.fixture?.date || '',
      status,
      statusLong: fixture.fixture?.status?.long || '',
      statusLabel: statusLabel(status, elapsed),
      elapsed,
      venue: fixture.fixture?.venue?.name || '',
      city: fixture.fixture?.venue?.city || '',
      referee: fixture.fixture?.referee || '',
      timezone: fixture.fixture?.timezone || '',
      league: leagueName,
      leagueId: Number(fixture.league?.id || 0),
      leagueLogo: fixture.league?.logo || '',
      country: fixture.league?.country || '',
      round: fixture.league?.round || '',
      score: scoreSnapshot(fixture),
      integrity: { state: centerIntegrity.state, score: centerIntegrity.qualityScore, warnings: centerIntegrity.warnings, issues: centerIntegrity.issues.filter(x => x.severity !== 'info').slice(0, 3) },
      home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
      away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
    },
    events: formattedEvents,
    statistics: formattedStatistics,
    livePressure: pressure,
    smartInsights,
    playerLeaders,
    lineups,
    absences,
    dataFreshness: featureMeta,
    quotaMode: providerPublicBudgetMode(),
    availability: {
      events: events.length > 0,
      statistics: statistics.length > 0,
      lineups: lineupRows.length > 0,
      players: playerLeaders.home.length > 0 || playerLeaders.away.length > 0,
      injuries: injuryRows.length > 0,
      limitedCoverage,
    },
    dataCapabilities: publicDataCapabilities(),
    liveOdds,
    oddsMovement,
    provider: publicDataCapabilities(),
    refreshSeconds,
    note: limitedCoverage
      ? 'Молодёжный/резервный турнир: дополнительные enrichment-запросы ограничены для экономии квоты.'
      : providerBudgetProfile().mode === 'emergency'
        ? 'API-квота в защитном резерве: часть расширенных данных временно берётся из кэша или пропускается.'
        : providerBudgetProfile().mode === 'conserve'
          ? 'Включён сберегающий режим: тяжёлые enrichment-запросы обновляются реже.'
          : (!events.length && !statistics.length)
            ? 'Для этого турнира или матча провайдер не отдаёт детальные события/статистику.'
            : '',
  };

  await setCache(baseCacheKey, fixtureId, payload, cfg, live ? Math.max(1/6, refreshSeconds / 60) : finished ? 720 : 5);
  return json({ ...payload, cached: false });
}


async function cachedSeasonStatsForComparison(teamId, leagueId, season, cfg) {
  if (!teamId || !leagueId || !season) return null;
  const cached = await getStaleCache(`team:intelligence:${Number(teamId)}:${Number(leagueId)}:${Number(season)}:v1`, cfg);
  return cached?.stats?.available ? cached.stats : null;
}

function comparisonNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function comparisonMetric({ key, label, homeValue, awayValue, format = 'number', better = 'higher', minGap = 0, note = '' }) {
  const home = comparisonNumber(homeValue);
  const away = comparisonNumber(awayValue);
  if (home === null || away === null) return null;
  const gap = Math.abs(home - away);
  let edge = 'even';
  if (gap > Number(minGap || 0)) {
    const homeBetter = better === 'lower' ? home < away : home > away;
    edge = homeBetter ? 'home' : 'away';
  }
  return { key, label, homeValue: home, awayValue: away, format, better, edge, note };
}

function buildMatchComparison({ homeName, awayName, homeForm, awayForm, homeStanding, awayStanding, homeSeasonStats, awaySeasonStats, goalModel, h2h, absences, hasInjuryData }) {
  const hOverall = homeForm?.overall || null;
  const aOverall = awayForm?.overall || null;
  const hVenue = homeForm?.venue || null;
  const aVenue = awayForm?.venue || null;
  const hSeason = homeSeasonStats?.derived || null;
  const aSeason = awaySeasonStats?.derived || null;

  const metrics = [
    comparisonMetric({ key:'form_ppg', label:'Форма · очки/матч', homeValue:hOverall?.ppg, awayValue:aOverall?.ppg, format:'decimal', minGap:.14, note:'Последние 5 завершённых матчей.' }),
    comparisonMetric({ key:'venue_ppg', label:'Дома / в гостях', homeValue:hVenue?.ppg, awayValue:aVenue?.ppg, format:'decimal', minGap:.14, note:'Хозяева дома против гостей на выезде.' }),
    comparisonMetric({ key:'attack', label:'Атака · гол/матч', homeValue:(hSeason && aSeason) ? hSeason.goalsForPerMatch : hOverall?.gfAvg, awayValue:(hSeason && aSeason) ? aSeason.goalsForPerMatch : aOverall?.gfAvg, format:'decimal', minGap:.14, note:(hSeason && aSeason) ? 'Сезонная статистика из уже загруженного кэша.' : 'Недавняя результативность.' }),
    comparisonMetric({ key:'defense', label:'Оборона · пропущено', homeValue:(hSeason && aSeason) ? hSeason.goalsAgainstPerMatch : hOverall?.gaAvg, awayValue:(hSeason && aSeason) ? aSeason.goalsAgainstPerMatch : aOverall?.gaAvg, format:'decimal', better:'lower', minGap:.14, note:'Меньше — лучше.' }),
    comparisonMetric({ key:'clean_sheets', label:'Сухие матчи', homeValue:(hSeason && aSeason) ? hSeason.cleanSheetRate : hOverall?.cleanSheetPct, awayValue:(hSeason && aSeason) ? aSeason.cleanSheetRate : aOverall?.cleanSheetPct, format:'percent', minGap:8, note:(hSeason && aSeason) ? 'Доля матчей сезона без пропущенных.' : 'Доля в последних матчах.' }),
    comparisonMetric({ key:'expected_goals', label:'Голевая оценка модели', homeValue:goalModel?.homeExpected, awayValue:goalModel?.awayExpected, format:'decimal', minGap:.14, note:'Poisson-эвристика по доступной форме.' }),
    comparisonMetric({ key:'table_rank', label:'Место в таблице', homeValue:homeStanding?.rank, awayValue:awayStanding?.rank, format:'rank', better:'lower', minGap:0, note:'Показывается только если таблица турнира уже была загружена.' }),
    ((Number(h2h?.homeWins||0)+Number(h2h?.awayWins||0)+Number(h2h?.draws||0)) > 0) ? comparisonMetric({ key:'h2h', label:'Победы в H2H', homeValue:h2h?.homeWins, awayValue:h2h?.awayWins, format:'integer', minGap:0, note:'Последние доступные очные встречи.' }) : null,
    hasInjuryData ? comparisonMetric({ key:'absences', label:'Отмеченные потери', homeValue:absences?.home?.length || 0, awayValue:absences?.away?.length || 0, format:'integer', better:'lower', minGap:0, note:'Только подтверждённые провайдером отсутствия.' }) : null,
  ].filter(Boolean);

  const descriptions = {
    form_ppg: 'лучше текущая форма', venue_ppg: 'сильнее профиль дома/в гостях', attack: 'выше результативность',
    defense: 'меньше пропускает', clean_sheets: 'чаще сохраняет ворота сухими', expected_goals: 'выше голевая оценка модели',
    table_rank: 'выше позиция в таблице', h2h: 'больше побед в очных матчах', absences: 'меньше отмеченных потерь состава',
  };
  const advantages = { home: [], away: [] };
  let homeEdges = 0, awayEdges = 0, even = 0;
  for (const metric of metrics) {
    if (metric.edge === 'home') { homeEdges += 1; if (advantages.home.length < 4) advantages.home.push(descriptions[metric.key] || metric.label); }
    else if (metric.edge === 'away') { awayEdges += 1; if (advantages.away.length < 4) advantages.away.push(descriptions[metric.key] || metric.label); }
    else even += 1;
  }

  let balanceLabel = 'Баланс доступных метрик близкий';
  if (homeEdges >= awayEdges + 2) balanceLabel = `${homeName} впереди по большему числу доступных метрик`;
  else if (awayEdges >= homeEdges + 2) balanceLabel = `${awayName} впереди по большему числу доступных метрик`;

  const sources = ['последние матчи', 'дом/выезд'];
  if (homeSeasonStats && awaySeasonStats) sources.push('кэш сезонной статистики');
  if (homeStanding && awayStanding) sources.push('кэш таблицы');
  if ((Number(h2h?.homeWins||0)+Number(h2h?.awayWins||0)+Number(h2h?.draws||0)) > 0) sources.push('H2H');
  if (hasInjuryData) sources.push('потери состава');

  return {
    metrics,
    advantages,
    score: { home: homeEdges, away: awayEdges, even },
    balanceLabel,
    dataReuse: {
      separateApiRequests: 0,
      seasonStatsCached: Boolean(homeSeasonStats && awaySeasonStats),
      standingsCached: Boolean(homeStanding && awayStanding),
      sources,
      note: 'Вкладка сравнения сама не делает дополнительных запросов к API-Football: она собирается из данных текущего анализа и уже существующего кэша.',
    },
  };
}

async function apiAnalyze(request, cfg, user) {
  let body = {};
  try { body = await request.json(); } catch {}
  const fixtureId = Number(body?.fixtureId);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) return json({ error: 'Некорректный fixtureId.' }, 400);

  const cacheKey = `fixture:${fixtureId}:v8-prematch-intelligence`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) {
    await recordHistory(user.id, cached, cfg);
    return json({ ...cached, cached: true, stale: false, quota: await getQuota(user.id, cfg) });
  }

  const staleBefore = await getStaleCache(cacheKey, cfg);
  const quotaBefore = await getQuota(user.id, cfg);
  if (quotaBefore.left <= 0) return json({ error: `Лимит исчерпан: ${quotaBefore.used}/${quotaBefore.limit} анализов сегодня.`, quota: quotaBefore }, 429);

  let fixture;
  try {
    fixture = (await apiFootball('/fixtures', { id: fixtureId }, cfg))[0];
  } catch (error) {
    if (staleBefore && isFootballRateLimitError(error)) {
      await recordHistory(user.id, staleBefore, cfg);
      return json({ ...staleBefore, cached: true, stale: true, warning: 'Показан последний сохранённый анализ: футбольный API временно ограничил запросы.', retryAfter: Number(error?.retryAfter || 60), quota: quotaBefore });
    }
    throw error;
  }
  if (!fixture) return json({ error: 'Матч не найден.' }, 404);
  const analysisIntegrity = validateFixtureIntegrity(fixture, '', null);
  if (analysisIntegrity.quarantine) {
    await recordOpsEvent(cfg, { severity: 'warning', source: 'integrity', eventType: 'single_fixture_guard', code: 'ANALYSIS_REJECTED', message: 'Анализ отклонён: fixture не прошёл структурную проверку.', meta: { fixtureId, issues: analysisIntegrity.issues.filter(x => x.severity === 'error').map(x => x.code) } }).catch(() => {});
    return json({ error: 'Данные матча выглядят противоречиво, поэтому анализ временно заблокирован.', code: 'MATCH_DATA_INVALID', integrity: analysisIntegrity, quota: quotaBefore }, 409);
  }
  // If this fixture has already finished, settle any earlier immutable pre-match snapshot without another football API call.
  if (isFinishedStatus(fixture.fixture?.status?.short)) await settlePredictionsFromFixtures([fixture], cfg).catch(() => null);

  const homeId = fixture.teams?.home?.id, awayId = fixture.teams?.away?.id;
  const homeName = fixture.teams?.home?.name || '', awayName = fixture.teams?.away?.name || '';
  const leagueName = fixture.league?.name || '';

  const kickoffMs = fixture.fixture?.date ? Date.parse(fixture.fixture.date) : NaN;
  const minutesToKickoff = Number.isFinite(kickoffMs) ? Math.round((kickoffMs - Date.now()) / 60000) : null;
  const status = fixture.fixture?.status?.short || '';
  const detailedCoverage = !isYouthReserveMatch(leagueName, homeName, awayName);
  const providerPlan = memory.provider?.plan || 'UNKNOWN';
  const paid = ['PRO','ULTRA','MEGA'].includes(providerPlan);
  const healthyFree = freeQuotaHealthy(30, 6);
  const minuteRemaining = Number(memory.provider?.minuteRemaining);
  const lowMinuteBudget = !paid && Number.isFinite(minuteRemaining) && minuteRemaining < 5;
  const veryLowMinuteBudget = !paid && Number.isFinite(minuteRemaining) && minuteRemaining < 3;
  const canFetchLineups = detailedCoverage && (paid || freeQuotaHealthy(15, 5)) && (
    isLiveStatus(status) || (minutesToKickoff !== null && minutesToKickoff <= 90 && minutesToKickoff >= -240)
  );
  const canFetchFreshForm = detailedCoverage && (paid || healthyFree);
  const canFetchH2H = detailedCoverage && (paid || !lowMinuteBudget);
  const canFetchInjuries = paid || !veryLowMinuteBudget;

  const skipped = [];
  if (!canFetchFreshForm && detailedCoverage) skipped.push('Свежая форма команд: сохранён API-лимит; используем кэш, если он есть.');
  if (!canFetchLineups && detailedCoverage && minutesToKickoff !== null && minutesToKickoff <= 120) skipped.push('Составы: запрос отложен из-за лимита или до публикации стартовых XI.');
  if (!canFetchH2H && detailedCoverage) skipped.push('H2H временно пропущен: осталось мало запросов в минутном окне.');
  if (!canFetchInjuries) skipped.push('Травмы временно пропущены: осталось критически мало запросов в минутном окне.');
  if (!detailedCoverage) skipped.push('Молодёжный/резервный турнир: расширенные запросы ограничены из-за слабого покрытия.');

  let injuries = [], predictions = [], odds = [], h2hRows = [], lineupsRows = [];
  try {
    [injuries, predictions, odds, h2hRows] = await Promise.all([
      canFetchInjuries ? apiFootball('/injuries', { fixture: fixtureId }, cfg).catch(() => []) : Promise.resolve([]),
      apiFootball('/predictions', { fixture: fixtureId }, cfg).catch(() => []),
      apiFootball('/odds', { fixture: fixtureId }, cfg).catch(() => []),
      canFetchH2H ? apiFootball('/fixtures/headtohead', { h2h: `${homeId}-${awayId}`, last: 5 }, cfg).catch(() => []) : Promise.resolve([]),
    ]);
    if (canFetchLineups) lineupsRows = await apiFootball('/fixtures/lineups', { fixture: fixtureId }, cfg).catch(() => []);
  } catch (error) {
    if (staleBefore && isFootballRateLimitError(error)) {
      await recordHistory(user.id, staleBefore, cfg);
      return json({ ...staleBefore, cached: true, stale: true, warning: 'Показан последний сохранённый анализ: API временно достиг лимита.', retryAfter: Number(error?.retryAfter || 60), quota: quotaBefore });
    }
    throw error;
  }

  const webPromise = tavilySearch(`${homeName} ${awayName} injuries team news probable lineups latest`, cfg);
  const homeFormPromise = detailedCoverage
    ? getRecentTeamForm(homeId, 'home', fixture.fixture?.date, fixtureId, cfg, { allowNetwork: canFetchFreshForm }).catch(() => null)
    : Promise.resolve(null);
  const awayFormPromise = detailedCoverage
    ? getRecentTeamForm(awayId, 'away', fixture.fixture?.date, fixtureId, cfg, { allowNetwork: canFetchFreshForm }).catch(() => null)
    : Promise.resolve(null);
  const [web, homeForm, awayForm] = await Promise.all([webPromise, homeFormPromise, awayFormPromise]);

  // v3.5 Match Comparison: reuse only already cached deep team data.
  // This adds Supabase cache reads but deliberately makes zero extra API-Football calls.
  const leagueId = Number(fixture.league?.id || 0);
  const season = Number(fixture.league?.season || 0) || null;
  const comparisonCompetition = { leagueId, season };
  const [homeStanding, awayStanding, homeSeasonStats, awaySeasonStats] = await Promise.all([
    cachedTeamStanding(homeId, comparisonCompetition, cfg).catch(() => null),
    cachedTeamStanding(awayId, comparisonCompetition, cfg).catch(() => null),
    cachedSeasonStatsForComparison(homeId, leagueId, season, cfg).catch(() => null),
    cachedSeasonStatsForComparison(awayId, leagueId, season, cfg).catch(() => null),
  ]);

  const market = extractMarket(odds);
  const apiPrediction = extractPrediction(predictions);
  const h2h = formatH2H(h2hRows, homeId, awayId);
  const absences = formatAbsences(injuries, homeId, awayId);
  const lineups = formatLineups(lineupsRows, homeId, awayId);
  const recentFormProb = formProbabilities(homeForm, awayForm);
  const h2hProb = h2hProbabilities(h2h);
  const calibrationProfile = await getCalibrationProfile(cfg).catch(() => baselineCalibrationProfile());
  const baselineBlend = blendProbabilitySignals({ market, model: apiPrediction, form: recentFormProb, h2h: h2hProb, weightOverrides: MODEL_BASE_WEIGHTS });
  const blended = calibrationProfile.weightsActive
    ? blendProbabilitySignals({ market, model: apiPrediction, form: recentFormProb, h2h: h2hProb, weightOverrides: calibrationProfile.signalWeights })
    : baselineBlend;
  const rawProbabilities = applyAbsenceAdjustment(baselineBlend.probabilities, absences);
  const weightedProbabilities = applyAbsenceAdjustment(blended.probabilities, absences);
  const probabilities = calibrationProfile.temperatureActive
    ? temperatureScaleProbabilities(weightedProbabilities, calibrationProfile.temperature)
    : weightedProbabilities;
  const goalModel = poissonGoalModel(homeForm, awayForm);
  const comparison = buildMatchComparison({
    homeName, awayName, homeForm, awayForm, homeStanding, awayStanding, homeSeasonStats, awaySeasonStats,
    goalModel, h2h, absences, hasInjuryData: injuries.length > 0,
  });
  const confidence = confidenceModel(blended.signals, probabilities, homeForm, awayForm);
  const notes = buildAnalysisNotes({
    probabilities, market, model: apiPrediction, homeForm, awayForm, h2h, absences, lineups, news: web,
    homeName, awayName, minutesToKickoff, confidence,
  });
  if (calibrationProfile.mode === 'active') {
    notes.factors.unshift(`Калибратор v4.0 active (${String(calibrationProfile.fingerprint || '').slice(0, 8) || 'baseline'}) на базе ${Number(calibrationProfile.sample || 0)} trusted-прогнозов.`);
  } else if (calibrationProfile.mode === 'shadow') {
    notes.risks.push('Калибратор пока работает в теневом режиме: выборка собирается, но итоговые вероятности ещё не корректируются автоматически.');
  }

  const availableSignals = [
    market && 'market',
    apiPrediction && 'apiPrediction',
    homeForm?.overall && awayForm?.overall && 'recentForm',
    h2hRows.length && 'h2h',
    injuries.length && 'injuries',
    lineupsRows.length && 'lineups',
    web.answer && 'web',
  ].filter(Boolean);

  const completenessPreview = {
    score: [fixture, market, apiPrediction, injuries.length, h2hRows.length, lineupsRows.length, web.answer, homeForm?.overall, awayForm?.overall, goalModel].filter(Boolean).length,
    max: 10,
  };
  const preMatchIntelligence = buildPreMatchIntelligence({
    probabilities,
    rawProbabilities,
    market,
    apiPrediction,
    homeForm,
    awayForm,
    h2h,
    absences,
    lineups,
    goalModel,
    comparison,
    confidence,
    modelBreakdown: { weights: blended.weights, signals: blended.signals },
    homeName,
    awayName,
    minutesToKickoff,
    news: web,
    completeness: completenessPreview,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    analysisVersion: '4.7.0-model-dashboard',
    match: {
      fixtureId, date: fixture.fixture?.date || '', status: fixture.fixture?.status?.short || '',
      venue: fixture.fixture?.venue?.name || '', city: fixture.fixture?.venue?.city || '',
      leagueId, season, league: leagueName, country: fixture.league?.country || '',
      home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
      away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
      integrity: { state: analysisIntegrity.state, score: analysisIntegrity.qualityScore, warnings: analysisIntegrity.warnings, issues: analysisIntegrity.issues.filter(x => x.severity !== 'info').slice(0, 3) },
    },
    probabilities,
    rawProbabilities,
    modelCalibration: {
      version: calibrationProfile.version || CALIBRATION_PROFILE_VERSION,
      fingerprint: calibrationProfile.fingerprint || '',
      mode: calibrationProfile.mode || 'baseline',
      sample: Number(calibrationProfile.sample || 0),
      temperature: Number(calibrationProfile.temperature || 1),
      temperatureActive: Boolean(calibrationProfile.temperatureActive),
      weightsActive: Boolean(calibrationProfile.weightsActive),
      signalWeights: calibrationProfile.signalWeights || { ...MODEL_BASE_WEIGHTS },
      validation: calibrationProfile.temperatureValidation || null,
      weightsValidation: calibrationProfile.weightsValidation || null,
      promotionGate: calibrationProfile.promotionGate || null,
      lifecycle: calibrationProfile.lifecycle || null,
      note: calibrationProfile.note || '',
    },
    confidence,
    likelyOutcome: outcomeName(probabilities, homeName, awayName),
    modelBreakdown: {
      weights: blended.weights,
      signals: blended.signals,
      method: 'Рынок, API prediction, форма и H2H объединяются динамически. v4.0 применяет постоянный active-профиль только после двух holdout-окон и атомарной champion–challenger проверки.',
    },
    dataPolicy: {
      dataMode: paid ? 'expanded' : 'standard',
      mode: paid ? 'full' : healthyFree ? 'balanced-free' : 'quota-saver',
      availableSignals,
      skipped,
    },
    dataCapabilities: publicDataCapabilities(),
    market, apiPrediction, recentForm: { home: homeForm, away: awayForm }, goalModel, comparison, absences, lineups, h2h,
    preMatchIntelligence,
    insights: notes.factors, risks: [...(notes.risks || []), ...skipped], news: web,
    completeness: completenessPreview,
    provider: publicDataCapabilities(),
    disclaimer: 'Расчёт основан на доступных статистических сигналах и не гарантирует исход матча. Это не финансовая рекомендация.',
  };

  let ttl = cfg.cacheMinutes;
  if (isFinishedStatus(status)) ttl = 720;
  else if (minutesToKickoff !== null && minutesToKickoff <= 120) ttl = 10;
  else if (minutesToKickoff !== null && minutesToKickoff > 360) ttl = 45;
  await setCache(cacheKey, fixtureId, payload, cfg, ttl);
  await captureModelPrediction(payload, cfg);
  await incrementUsage(user.id, cfg);
  await recordHistory(user.id, payload, cfg);
  return json({ ...payload, cached: false, stale: false, quota: await getQuota(user.id, cfg) });
}

export default {
  async fetch(request, env) {
    const cfg = config(env);
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({
        ok: true,
        version: APP_VERSION,
        database: hasSupabase(cfg) ? 'supabase' : 'memory',
        monetization: cfg.monetizationEnabled ? 'enabled' : 'paused',
        observability: 'enabled',
        dataIntegrity: 'enabled',
        performanceUx: 'enabled',
        visualDesign: 'enabled',
        releaseHardening: 'enabled',
        adminSecurity: 'enabled',
        expandedDataReady: 'enabled',
        matchCenter2: 'enabled',
        smartMatchInsights: 'enabled',
        preMatchIntelligence: 'enabled',
        modelDashboard2: 'enabled',
        providerTransition: 'enabled',
        coverageAudit: 'enabled',
        quotaOrchestrator: 'enabled',
        featureCache: 'enabled',
        expandedDataE2E: 'enabled',
        expandedDataReleaseGate: 'enabled',
        productionLoadSafety: 'enabled',
        serverSingleflight: 'enabled',
        burstGuard: 'enabled',
        upstreamTimeouts: 'enabled',
        failureRecovery: 'enabled',
        gracefulErrors: 'enabled',
        webviewRecovery: 'enabled',
        releaseCandidate: RC_NAME,
        regressionQA: 'enabled',
        rcSmokeTest: 'enabled',
        clientContractQA: 'enabled',
        appManifest: 'enabled',
        apiContract: API_CONTRACT_VERSION,
        startupSafety: 'enabled',
        rollbackSafety: 'enabled',
        releaseMonitor: 'enabled',
        clientTelemetry: 'enabled',
        operationalBudget: 'enabled',
        notificationReliability: 'enabled',
        reminderDeliveryClaims: 'enabled',
        reminderCronMinutes: 5,
        runtimeControls: 'enabled',
        emergencyKillSwitches: 'enabled',
        runtimeRollback: 'enabled',
        runtimeHistory: 'enabled',
        predictionIntegrity: 'enabled',
        modelVersionCohorts: 'enabled',
        calibrationDiagnostics: 'enabled',
        predictionRemediation: 'enabled',
        settlementRecovery: 'enabled',
        settlementWatchdog: 'enabled',
        automaticSettlementRecovery: 'runtime-controlled',
        settlementCircuitBreaker: 'enabled',
        settlementReliability: 'enabled',
        settlementRunLedger: 'enabled',
        interruptedRunRecovery: 'enabled',
        settlementFinalityVerification: 'enabled',
        settlementDriftGuard: 'enabled',
        settlementDriftReview: 'enabled',
        settlementAdjudication: 'enabled',
        trustedMetricsGate: 'enabled',
        twoPassSettlementFinality: 'enabled',
        calibrationPromotionGate: 'enabled',
        adaptiveWeightsHoldout: 'enabled',
        calibrationChampionChallenger: 'enabled',
        calibrationAutomaticRollback: 'enabled',
        calibrationAtomicTransitions: 'enabled',
        calibrationManualFreeze: 'enabled',
        adminDevModeIsolation: 'enabled',
        backendSecurityContract: 'enabled',
        runtimeControlsCacheSeconds: 30,
        devMode: cfg.devMode,
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/app-manifest') {
      await loadRuntimeControls(cfg);
      return json(appManifest(cfg));
    }

    if (request.method === 'GET' && url.pathname === '/api/runtime-status') {
      const runtimeState = await loadRuntimeControls(cfg);
      return json({
        ok: true,
        available: Boolean(runtimeState.schemaReady),
        runtime: publicRuntimeControls(runtimeState.value),
        source: runtimeState.source,
        cacheSeconds: Math.round(RUNTIME_CONTROLS_CACHE_MS / 1000),
      });
    }

    if (url.pathname === '/health/supabase') {
      return json({
        ok: false,
        error: 'Техническая проверка Supabase перенесена в защищённую админ-диагностику Mini App.',
        code: 'ADMIN_DIAGNOSTICS_ONLY',
      }, 404);
    }

    if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
      try {
        return await handleTelegramWebhook(request, cfg);
      } catch (error) {
        console.error('telegram webhook', error);
        bumpTelemetry('routeErrors');
        await recordOpsEvent(cfg, { severity: 'error', source: 'telegram', eventType: 'webhook', code: 'TELEGRAM_WEBHOOK', message: error?.message || error, endpoint: '/telegram/webhook' });
        return json({ ok: false }, 200);
      }
    }

    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    try {
      const user = await getRequestUser(request, cfg);
      if (!user) return json({ error: 'Откройте приложение внутри Telegram.' }, 401);

      const runtimeState = await loadRuntimeControls(cfg);
      const runtimeResponse = runtimeGuard(request, user, cfg, runtimeState.value);
      if (runtimeResponse) return runtimeResponse;

      const burstResponse = enforceRouteBurst(request, user);
      if (burstResponse) return burstResponse;

      if (request.method === 'GET' && url.pathname === '/api/me') return await apiMe(request, cfg, user);
      if (request.method === 'GET' && url.pathname === '/api/data-capabilities') return json({ dataCapabilities: publicDataCapabilities() });
      if (request.method === 'POST' && url.pathname === '/api/client-telemetry') return await apiClientTelemetry(request, cfg, user);
      if (url.pathname === '/api/runtime-controls') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiRuntimeControls(request, cfg, user);
      }
      if (url.pathname === '/api/runtime-controls/rollback') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiRuntimeRollback(request, cfg, user);
      }

      // v4.3 Admin Security: technical endpoints are protected server-side.
      // Hiding cards in the UI is not considered authorization.
      if (request.method === 'GET' && url.pathname === '/api/provider') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return json({
          provider: providerSnapshot(),
          transition: providerTransitionProfile(),
          budget: providerBudgetProfile(),
          lastAudit: memory.providerAudit.last,
          lastE2E: await loadLastProviderE2E(cfg),
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/provider/budget') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiProviderBudget(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/provider/e2e-validation') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiProviderE2EValidation(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/provider/probe') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiProviderProbe(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/provider/coverage-audit') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiProviderCoverageAudit(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/diagnostics') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiDiagnostics(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/release-readiness') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiReleaseReadiness(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/production-readiness') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiProductionReadiness(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/rc-regression') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiRcRegression(request, cfg, user);
      }
      if (request.method === 'GET' && url.pathname === '/api/release-monitor') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiReleaseMonitor(request, cfg);
      }
      if (url.pathname === '/api/reminder-health') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiReminderHealth(request, cfg, user);
      }
      if (request.method === 'GET' && url.pathname === '/api/data-integrity') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiDataIntegrity(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/model-quality') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiModelQuality(request, cfg);
      }
      if (url.pathname === '/api/calibration-control') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiCalibrationControl(request, cfg, user);
      }
      if (url.pathname === '/api/model-remediation') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiModelRemediation(request, cfg, user);
      }
      if (url.pathname.startsWith('/api/billing/')) {
        if (!cfg.monetizationEnabled) return json({ error: 'Монетизация отложена до финального этапа проекта.' }, 404);
        if (request.method === 'GET' && url.pathname === '/api/billing/plans') return await apiBillingPlans(request, cfg, user);
        if (request.method === 'POST' && url.pathname === '/api/billing/invoice') return await apiBillingInvoice(request, cfg, user);
        if (request.method === 'POST' && url.pathname === '/api/billing/sync') return await apiBillingSync(request, cfg, user);
        if (request.method === 'POST' && url.pathname === '/api/billing/subscription') return await apiBillingSubscription(request, cfg, user);
      }
      if (request.method === 'GET' && url.pathname === '/api/search') return await apiSearch(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/matches') return await apiMatches(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/tournament') return await apiTournament(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/team') return await apiTeam(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/team/intelligence') return await apiTeamIntelligence(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/team/squad') return await apiTeamSquad(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/match-center') return await apiMatchCenter(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/history') return await apiHistory(request, cfg, user);
      if (url.pathname === '/api/favorites') return await apiFavorites(request, cfg, user);
      if (url.pathname === '/api/reminders') return await apiReminders(request, cfg, user);
      if (url.pathname === '/api/preferences') return await apiPreferences(request, cfg, user);
      if (request.method === 'POST' && url.pathname === '/api/analyze') return await apiAnalyze(request, cfg, user);
      return json({ error: 'Маршрут не найден.' }, 404);
    } catch (error) {
      console.error(error);
      const rateLimited = isFootballRateLimitError(error);
      const publicError = publicRouteError(error, rateLimited);
      if (!rateLimited) {
        bumpTelemetry('routeErrors');
        await recordOpsEvent(cfg, {
          severity: 'error', source: 'api', eventType: 'route_error', code: error?.code || 'SERVER_ERROR',
          message: error?.message || 'Ошибка сервера.', endpoint: url.pathname, status: publicError.status,
        });
      }
      return json({
        ...publicError.body,
        provider: publicDataCapabilities(),
      }, publicError.status, publicError.body.retryAfter ? { 'retry-after': String(publicError.body.retryAfter) } : {});
    }
  },

  async scheduled(controller, env, ctx) {
    const cfg = config(env);
    const scheduledAt = new Date(Number(controller?.scheduledTime || Date.now()));
    const backtestTask = settleBacktestDaily(cfg);
    const tasks = [
      ['reminders', processDueReminders(cfg)],
      ['backtest', backtestTask],
    ];
    if (scheduledAt.getUTCHours() === 3 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['ops_cleanup', cleanupOpsEvents(cfg)]);
      tasks.push(['integrity_cleanup', cleanupIntegrityData(cfg)]);
    }
    if (scheduledAt.getUTCHours() === 4 && scheduledAt.getUTCMinutes() < 15) {
      // Sequence catch-up after the normal daily settlement so one cron invocation
      // never spends provider quota on both recovery paths concurrently.
      tasks.push(['settlement_watchdog', backtestTask.then(() => runSettlementWatchdog(cfg))]);
    }
    if (scheduledAt.getUTCHours() === 5 && scheduledAt.getUTCMinutes() < 15) {
      // Finality verification is intentionally delayed and read-mostly:
      // it never rewrites stored outcomes when provider data drift is detected.
      tasks.push(['settlement_finality', backtestTask.then(() => runSettlementFinalityVerification(cfg))]);
    }
    ctx.waitUntil((async () => {
      const results = await Promise.allSettled(tasks.map(([, promise]) => promise));
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
          await recordOpsEvent(cfg, { severity: 'error', source: 'cron', eventType: 'scheduled_task', code: 'CRON_TASK', message: results[i].reason?.message || results[i].reason, meta: { task: tasks[i][0] } });
        }
      }
    })());
  },
};
