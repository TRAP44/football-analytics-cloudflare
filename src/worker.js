import { createTelegramWebhookHandler } from './telegram-transport.js';
import { createAnalysisContextRuntime } from './analysis-context-runtime.js';
import { createAnalysisLifecycleRuntime } from './analysis-lifecycle-runtime.js';
import { createAnalysisQualityRuntime } from './analysis-quality-runtime.js';
import { createRefereeIntelligenceRuntime } from './referee-intelligence-runtime.js';
import { createTeamIntelligenceRuntime } from './team-intelligence-runtime.js';
import { createTeamTournamentRuntime } from './team-tournament-runtime.js';
import { createSearchDiscoveryRuntime } from './search-discovery-runtime.js';
import { createMatchFormattingRuntime } from './match-formatting-runtime.js';
import { createCompetitionIntegrityRuntime } from './competition-integrity-runtime.js';
import { createLiveMatchIntelligenceRuntime } from './live-match-intelligence-runtime.js';
import { createModelIntelligenceRuntime } from './model-intelligence-runtime.js';
import { createProviderFixtureRuntime } from './provider-fixture-runtime.js';
import { createProviderDataRuntime } from './provider-data-runtime.js';
import { createAnalysisRuntime } from './analysis-runtime.js';
import { createMatchCenterRuntime } from './match-center-runtime.js';
import { createTelegramUpdateProcessor } from './telegram-update-orchestration.js';
import { createApiFootballGateway } from './api-football-gateway.js';
import { createTelegramDedupeRuntime } from './telegram-dedupe.js';
import { createUserAuthRuntime } from './auth-user.js';
import { isAdminSensitivePath, privilegedLocalRatePolicy } from './security-route-registry.js';
import { accountRatePolicies, enforceDistributedAccountRateLimit } from './account-rate-limit.js';
import { createSharedCacheRuntime } from './cache-runtime.js';
import { dispatchApiRoute } from './router.js';
import { createHttpRuntime } from './http.js';
import {
  createPreAuthAbuseGuard,
  distributedPreAuthPolicies,
  enforceDistributedPreAuthRateLimit,
  preAuthRequestShapeDecision,
} from './security-gate.js';
import { cloudflareEdgeGuard, cloudflareEdgePolicies } from './edge-security.js';
import { isSecurityLockdownControls, telegramLockdownDecision } from './runtime-lockdown.js';
import { createRuntimeControlsRuntime } from './runtime-controls.js';
import { createGrowthReferralRuntime } from './growth-referral.js';
import { assessSecuritySignals, formatSecurityIncidentAlert, securityIncidentOpsEvent, securityIncidentTimeline } from './security-incidents.js';
import { channelPublisherState, publishChannelMessage } from './channel-publisher.js';
import {
  calibrationProfileFingerprint,
  evaluatePostPromotionRollback,
  evaluatePromotionWindows,
  splitRollingValidation,
} from './calibration-lifecycle.js';
import {
  DEVELOPMENT_TELEGRAM_ID,
  closedBetaAccessDecision,
  isAdminUser,
  isClosedBetaUser,
  isTelegramValidatedUser,
  telegramIdList,
} from './access-control.js';
import { createSupabaseClient } from './supabase-client.js';
import { runtimeReleaseIdentity } from './release-identity.js';
import { scopeOpsEventsToDeployment } from './release-event-attribution.js';
import { createReleaseFieldEvidenceRuntime } from './release-field-evidence.js';
import { postDeployRegressionReport } from './post-deploy-regression.js';
import { planPostDeployRegressionLifecycle } from './post-deploy-regression-lifecycle.js';
import { formatPostDeployRegressionAlert, planPostDeployRegressionAlert, postDeployRegressionAlertOpsEvents } from './post-deploy-regression-alerts.js';
import { planPostDeployRegressionResponseTransition, summarizePostDeployRegressionResponse } from './post-deploy-regression-response.js';
import { buildPostDeployRegressionSloDashboard } from './post-deploy-regression-slo.js';
import { createCompositeReadinessRuntime } from './readiness-contract.js';
import { createDiagnosticsRuntime } from './diagnostics-runtime.js';
import { createAppCapabilitiesRuntime } from './app-capabilities.js';
import { createAdminOperationalApi } from './admin-operational-api.js';
import { createSettlementRuntime } from './settlement-runtime.js';
import { createPublicHealthRuntime } from './public-health.js';
import { createPublicStatusRouter, createPublicStatusRuntime } from './public-status.js';
import { createAnalysisUsageCompensationRuntime, durableAnalysisUsageHeaders } from './analysis-usage-compensation.js';
import { markCachedSourceMeta, resolveProviderChain, sourceMeta } from './data-service.js';
import { applyFeatureFreshness, applyFeatureFreshnessMap } from './data-freshness.js';
import { assessExpectedGoalsQuality, sanitizeExpectedGoalsForDisplay, statisticsForTrustedExpectedGoals } from './xg-quality.js';
import { annotateStatisticsReliability, assessMatchStatisticsQuality, sanitizeStatisticsForDisplay, statisticsForTrustedAnalytics } from './statistics-quality.js';
import { annotateEventReliability, assessMatchEventQuality, eventsForTrustedAnalytics, sanitizeEventsForDisplay } from './event-quality.js';
import { annotateOddsReliability, assessOddsMarketQuality, oddsMarketForTrustedAnalytics, sanitizeOddsSnapshotsForMovement } from './odds-quality.js';
import { annotateAvailabilityReliability, assessFixtureAvailabilityQuality, enrichFixtureAbsencesWithSeasonRole, normalizeFixtureAbsences, sanitizeAvailabilityRows } from './availability.js';
import { annotateLineupReliability, assessLineupQuality, assessMatchLineups } from './lineup-quality.js';
import { normalizeOpenLigaMatchEvents, normalizeOpenLigaStandings, openLigaCompetition, openLigaMatchDataUrls, openLigaTableUrls } from './providers/openligadb.js';
import { footballDataScorersUrl, footballDataStandingsUrl, normalizeFootballDataStandings, normalizeFootballDataTeamScorers } from './providers/football-data.js';
import { normalizeTheOddsApiMarket, theOddsApiUrl } from './providers/the-odds-api.js';
import { createProviderRequestBoundary } from './providers/provider-request.js';
import {
  bytesToHex,
  constantTimeEqual,
  hmacSha256,
  validateTelegramInitData,
} from './crypto-utils.js';
import { createTelegramLinksRuntime } from './telegram-links.js';
import {
  PASS_TYPES,
  createEntitlementService,
  createPassInvoicePayload,
  parsePassInvoicePayload,
  passProductConfig,
} from './entitlements.js';
import {
  normalizeReferralCode,
  opaqueReferralCode,
  referralAttributionDecision,
  splitLaunchReferralParts,
} from './referral-attribution.js';
import { markTelegramWebhookEffect, markTelegramWebhookMutation } from './telegram-webhook-retry.js';
import { PERSONAL_WRITE_LIMITS } from './personal-write-guards.js';
import { createUserFavoritesService } from './user-favorites.js';
import { createFavoritePlayersService } from './user-player-favorites.js';
import { publicPlayerFollowNotificationContract } from './player-follow-contract.js';
import { createUserRemindersService } from './user-reminders.js';
import { createUserPreferencesService } from './user-preferences.js';
import { createUserHistoryService } from './user-history.js';
import { createReminderDeliveryStore } from './reminder-delivery-store.js';
import { createReminderDeliveryService } from './reminder-delivery-service.js';
import { createLineupNotificationService } from './lineup-notification-service.js';
import { createImportantChangeNotificationService } from './important-change-notification-service.js';
import { createSmartNotificationAudience } from './smart-notification-audience.js';
import { createSmartNotificationDeliveryService } from './smart-notification-delivery.js';
import { SMART_NOTIFICATION_POLICY, publicSmartNotificationCapabilities } from './smart-notification-policy.js';
import { createSmartNotificationService, radarStrongSignalState } from './smart-notification-service.js';
import { createScheduledJobsRuntime } from './scheduled-jobs.js';
import { createScheduledLeaseRuntime } from './scheduled-lease.js';
import { DAILY_DIGEST_POLICY, assessDailyDigestRun, planDailyDigestRecipients, runBoundedDailyDigest } from './daily-digest-delivery.js';
import { assessDailyDigestReliabilitySlo, buildDailyDigestIncidentReport, dailyDigestIncidentAlertOpsEvents, formatDailyDigestIncidentAlert, planDailyDigestIncidentAlert, planDailyDigestReliabilitySloEvent, summarizeDailyDigestOperationalStatus, summarizeDailyDigestReliability } from './daily-digest-incidents.js';
import { createProviderObservabilityRuntime } from './provider-observability.js';
import { analysisTimelineSnapshotRow, buildAiTimeline } from './ai-timeline.js';
import { buildProviderSloIncidentTimeline, providerSloIncidentOpsEvent, providerSloIncidentUpdateOpsEvent } from './provider-slo-incidents.js';
import {
  deliverOperationalIncidentAlert,
  deliverProviderIncidentAlert,
  planProviderIncidentAlert,
  providerIncidentAlertLedgerSummary,
  providerIncidentAlertOpsEvents,
  providerIncidentAlertSelfTest,
  providerIncidentBotIdentity,
  providerIncidentDestinationKey,
} from './provider-incident-alerts.js';

const memory = {
  users: new Map(),
  usage: new Map(),
  cache: new Map(),
  history: new Map(),
  favorites: new Map(),
  favoritePlayers: new Map(),
  reminders: new Map(),
  smartNotificationDeliveries: new Map(),
  preferences: new Map(),
  oddsSnapshots: new Map(),
  analysisTimelineSnapshots: new Map(),
  refereeMatchHistory: new Map(),
  botDigestSubscriptions: new Map(),
  billingPayments: new Map(),
  userEntitlements: new Map(),
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
  productionMonitor: null,
  runtimeControls: { value: null, loadedAt: 0, source: 'defaults', schemaReady: null },
  newsImpactRecoveryStrategy: { value: null, loadedAt: 0 },
  clientTelemetryDedupe: new Map(),
  inflight: new Map(),
  routeBurst: new Map(),
  authFailureBurst: new Map(),
  telegramBurst: new Map(),
  telegramUpdateDedupe: new Map(),
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
    supabaseProbeRecoveries: 0,
    supabaseProbeConfirmedFailures: 0,
    supabaseSchemaProbeRecoveries: 0,
    supabaseSchemaProbeConfirmedFailures: 0,
    routeErrors: 0,
    integrityRuns: 0,
    integrityWarnings: 0,
    integrityErrors: 0,
    integrityQuarantined: 0,
    integrityDuplicates: 0,
    singleflightJoins: 0,
    providerFixtureDateReuses: 0,
    providerTeamFixtureReuses: 0,
    burstBlocks: 0,
    telegramBurstBlocks: 0,
    telegramDuplicateUpdates: 0,
    telegramPersistentDuplicateUpdates: 0,
    telegramDedupeFallbacks: 0,
    securityShapeBlocks: 0,
    edgeRateLimitBlocks: 0,
    edgeRateLimitFallbacks: 0,
    edgeScannerBlocks: 0,
    securityCrossOriginBlocks: 0,
    securityOversizeBlocks: 0,
    securityInvalidAuthBlocks: 0,
    securityPreAuthBlocks: 0,
    securityPreAuthFallbacks: 0,
    securityPreAuthFailClosed: 0,
    upstreamTimeouts: 0,
    userSyncSkips: 0,
    memoryPrunes: 0,
    providerDistributedBlocks: 0,
    providerDistributedFallbacks: 0,
    quotaReservations: 0,
    quotaRefunds: 0,
    quotaRefundFailures: 0,
    passUsageRefunds: 0,
    passUsageRefundFailures: 0,
    analysisUsageCommits: 0,
    analysisUsageCommitFailures: 0,
    analysisUsageRefunds: 0,
    analysisUsageCompensationFailures: 0,
    analysisUsageReconciled: 0,
    analysisUsageReconciliationFailures: 0,
    analysisHistoryWriteErrors: 0,
    analysisHistoryRetryAttempts: 0,
    analysisHistoryWriteRecovered: 0,
    analysisHistoryWriteLosses: 0,
    analysisHistoryRetryPending: 0,
    digestDeliveryClaims: 0,
    digestDeliveryDuplicates: 0,
  },
  providerQuotaEvidenceAt: 0,
  provider: { name: 'API-Football', plan: 'UNKNOWN', dailyLimit: null, dailyRemaining: null, minuteLimit: null, minuteRemaining: null, updatedAt: null, cooldownUntil: null, lastError: '', lastStatus: null, lastLatencyMs: null, lastRequestAt: null, lastSuccessAt: null },
};

const enc = new TextEncoder();
const APP_VERSION = '6.120.0-rc144';
const API_CONTRACT_VERSION = 5;
const MIN_CLIENT_VERSION = '5.8.0';
const RELEASE_CHANNEL = 'rc144';
const RC_NAME = 'RC144';
const SUPABASE_SCHEMA_GUIDANCE = 'Проверьте схему Supabase: для новой установки используйте baseline v6.19 и примените миграции до v6.29.1; для существующей примените все доступные миграции из supabase/migrations до v6.29.1.';
const MAX_MEMORY_OPS_EVENTS = 50;
const EXPECTED_SCHEMA_CONTRACT_VERSION = 2;
const EXPECTED_SCHEMA_FINGERPRINT = '6a7f0fe444f49a2a52c4603e952ee9ea';
const FRESH_INSTALL_SCHEMA_FINGERPRINT = '8b3e6ec749079296e6746d3db8ae3d2e';
const COMPATIBLE_SCHEMA_FINGERPRINTS = Object.freeze([
  EXPECTED_SCHEMA_FINGERPRINT,
  FRESH_INSTALL_SCHEMA_FINGERPRINT,
]);

const { json, adminForbidden, publicRouteError } = createHttpRuntime({
  appVersion: APP_VERSION,
  apiContractVersion: API_CONTRACT_VERSION,
  minClientVersion: MIN_CLIENT_VERSION,
  releaseChannel: RELEASE_CHANNEL,
  personalWriteLimits: PERSONAL_WRITE_LIMITS,
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


function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function boolEnvState(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'missing';
  if (raw === 'true' || raw === 'false') return raw;
  return 'invalid';
}

function intEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function config(env) {
  return {
    devMode: boolEnv(env.DEV_MODE, false),
    apiFootballKey: env.API_FOOTBALL_KEY || '',
    footballDataToken: env.FOOTBALL_DATA_TOKEN || '',
    theOddsApiKey: env.THE_ODDS_API_KEY || '',
    tavilyKey: env.TAVILY_KEY || '',
    botToken: env.TELEGRAM_BOT_TOKEN || '',
    publisherBotToken: env.TELEGRAM_PUBLISHER_BOT_TOKEN || '',
    telegramChannelId: env.TELEGRAM_CHANNEL_ID || '',
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    adminTelegramIds: telegramIdList(env.ADMIN_TELEGRAM_IDS),
    betaTelegramIds: telegramIdList(env.BETA_TELEGRAM_IDS),
    // Public normal-user access is the default. Strict closed beta is an
    // explicit temporary mode enabled only by BETA_ACCESS_ENABLED=true.
    betaAccessConfigured: boolEnvState(env.BETA_ACCESS_ENABLED),
    betaAccessEnabled: boolEnv(env.BETA_ACCESS_ENABLED, false),
    supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
    cfVersionMetadata: env.CF_VERSION_METADATA || null,
    cacheMinutes: intEnv(env.CACHE_MINUTES, 20),
    liveOddsEnabled: boolEnv(env.ENABLE_LIVE_ODDS, true),
    // Монетизацию сознательно держим выключенной до финального этапа проекта.
    // Старый webhook может оставаться настроенным: pre-checkout будет отклонён,
    // а UI оплаты не показывается, пока флаг не включён явно.
    monetizationEnabled: boolEnv(env.MONETIZATION_ENABLED, false),
    opsRetentionDays: intEnv(env.OPS_RETENTION_DAYS, 14),
    growthRetentionDays: intEnv(env.GROWTH_RETENTION_DAYS, 90),
    limits: {
      FREE: intEnv(env.FREE_DAILY_LIMIT, 3),
      PRO: intEnv(env.PRO_DAILY_LIMIT, 20),
      PREMIUM: intEnv(env.PREMIUM_DAILY_LIMIT, 100),
    },
    starsPrices: {
      PRO: intEnv(env.PRO_STARS_PRICE, BILLING_PLANS.PRO.stars),
      PREMIUM: intEnv(env.PREMIUM_STARS_PRICE, BILLING_PLANS.PREMIUM.stars),
    },
    passPrices: {
      MATCH_PASS: intEnv(env.MATCH_PASS_STARS_PRICE, 39),
      DAY_PASS: intEnv(env.DAY_PASS_STARS_PRICE, 89),
      WEEKEND_PASS: intEnv(env.WEEKEND_PASS_STARS_PRICE, 149),
    },
    passDurations: {
      MATCH_PASS: intEnv(env.MATCH_PASS_DURATION_HOURS, 72),
      DAY_PASS: intEnv(env.DAY_PASS_DURATION_HOURS, 24),
      WEEKEND_PASS: intEnv(env.WEEKEND_PASS_DURATION_HOURS, 168),
    },
    passUsageLimits: {
      WEEKEND_PASS: intEnv(env.WEEKEND_PASS_USAGE_LIMIT, 0) || null,
    },
  };
}

function currentReleaseIdentity(cfg = {}) {
  return runtimeReleaseIdentity(cfg?.cfVersionMetadata,{
    appVersion:APP_VERSION,
    releaseCandidate:RC_NAME,
  });
}

let appCapabilitiesRuntime=null;

function getAppCapabilitiesRuntime() {
  if (!appCapabilitiesRuntime) {
    appCapabilitiesRuntime=createAppCapabilitiesRuntime({
      memory,
      appVersion:APP_VERSION,
      minClientVersion:MIN_CLIENT_VERSION,
      apiContractVersion:API_CONTRACT_VERSION,
      releaseChannel:RELEASE_CHANNEL,
      releaseCandidate:RC_NAME,
      paidQuotaHealthy,
      providerPublicBudgetMode,
      runtimeControlsSnapshot,
      isSecurityLockdownControls,
      publicRuntimeControls,
      currentReleaseIdentity,
    });
  }
  return appCapabilitiesRuntime;
}

function publicDataCapabilities() {
  return getAppCapabilitiesRuntime().publicDataCapabilities();
}

function appManifest(cfg) {
  return getAppCapabilitiesRuntime().appManifest(cfg);
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

  if (memory.telegramBurst.size > 2500) {
    for (const [key, bucket] of memory.telegramBurst) {
      if (now - Number(bucket?.startedAt || 0) > 5 * 60 * 1000) {
        memory.telegramBurst.delete(key);
        pruned++;
      }
    }
  }

  if (memory.telegramUpdateDedupe.size > 4000) {
    for (const [key, value] of memory.telegramUpdateDedupe) {
      if (now - Number(value?.at || 0) > 10 * 60 * 1000) {
        memory.telegramUpdateDedupe.delete(key);
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
  { test: p => p === '/api/client-telemetry', limit: 12, windowMs: 60000, label: 'client-telemetry' },
  { test: p => p === '/api/beta-feedback', limit: 4, windowMs: 60000, label: 'beta-feedback' },
]);

function routeBurstPolicy(pathname) {
  return ROUTE_BURST_POLICIES.find(policy => policy.test(pathname))
    || privilegedLocalRatePolicy(pathname);
}

function enforceRouteBurst(request, user) {
  const path = new URL(request.url).pathname;
  const policy = routeBurstPolicy(path);
  if (!policy) return null;

  const rawId=user?.id;
  const userId=typeof rawId==='number'
    ? (Number.isSafeInteger(rawId) && rawId>0 ? rawId : 0)
    : (typeof rawId==='string' && /^\d+$/.test(rawId.trim()) ? Number(rawId.trim()) : 0);
  if (!Number.isSafeInteger(userId) || userId<=0) return null;

  const now=Date.now();
  const key=`${userId}:${policy.label}`;
  const current=memory.routeBurst.get(key);
  const startedAt=typeof current?.startedAt==='number' && Number.isFinite(current.startedAt)
    ? current.startedAt
    : 0;
  const count=typeof current?.count==='number' && Number.isSafeInteger(current.count) && current.count>=0
    ? current.count
    : 0;
  const expired=!startedAt || now<startedAt || now-startedAt>=policy.windowMs;
  const bucket=expired ? {startedAt:now,count:1} : {startedAt,count:count+1};
  memory.routeBurst.set(key,bucket);

  if (bucket.count<=policy.limit) {
    if (memory.routeBurst.size>2500) pruneMemoryState();
    return null;
  }

  const retryAfter=Math.max(1,Math.ceil((policy.windowMs-(now-bucket.startedAt))/1000));
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
    distributedAnalysis: {
      claims:Number(memory.telemetry?.analysisLockClaims || 0),
      joins:Number(memory.telemetry?.analysisLockJoins || 0),
      joinHits:Number(memory.telemetry?.analysisLockJoinHits || 0),
      timeouts:Number(memory.telemetry?.analysisLockTimeouts || 0),
      failOpen:Number(memory.telemetry?.analysisLockFailOpen || 0),
      policy:distributedAnalysisLockPolicy(),
    },
    securityGuard: {
      invalidAuthBuckets: memory.authFailureBurst.size,
      edgeRateLimitBlocked:Number(memory.telemetry?.edgeRateLimitBlocks || 0),
      edgeRateLimitFallbacks:Number(memory.telemetry?.edgeRateLimitFallbacks || 0),
      edgeScannerBlocked:Number(memory.telemetry?.edgeScannerBlocks || 0),
      edgePolicies:cloudflareEdgePolicies(),
      invalidAuthBlocked:Number(memory.telemetry?.securityInvalidAuthBlocks || 0),
      distributedPreAuthBlocked:Number(memory.telemetry?.securityPreAuthBlocks || 0),
      distributedPreAuthFallbacks:Number(memory.telemetry?.securityPreAuthFallbacks || 0),
      distributedPreAuthFailClosed:Number(memory.telemetry?.securityPreAuthFailClosed || 0),
      distributedPreAuthPolicies:distributedPreAuthPolicies(),
      crossOriginBlocked:Number(memory.telemetry?.securityCrossOriginBlocks || 0),
      oversizeBlocked:Number(memory.telemetry?.securityOversizeBlocks || 0),
      shapeBlocked:Number(memory.telemetry?.securityShapeBlocks || 0),
    },
    burstGuard: {
      activeBuckets: memory.routeBurst.size,
      blocked: Number(memory.telemetry?.burstBlocks || 0),
      policies: ROUTE_BURST_POLICIES.map(x => ({ label: x.label, limit: x.limit, windowMs: x.windowMs })),
      distributedBlocked: Number(memory.telemetry?.distributedBurstBlocks || 0),
      distributedFallbacks: Number(memory.telemetry?.distributedBurstFallbacks || 0),
      distributedPolicies: accountRatePolicies(),
    },
    telegramWebhook: {
      activeBuckets: memory.telegramBurst.size,
      blocked: Number(memory.telemetry?.telegramBurstBlocks || 0),
      duplicateUpdates: Number(memory.telemetry?.telegramDuplicateUpdates || 0),
      persistentDuplicateUpdates: Number(memory.telemetry?.telegramPersistentDuplicateUpdates || 0),
      persistentFallbacks: Number(memory.telemetry?.telegramDedupeFallbacks || 0),
      dedupeEntries: memory.telegramUpdateDedupe.size,
      policies: Object.values(TELEGRAM_BURST_POLICIES).map(x=>({label:x.label,limit:x.limit,windowMs:x.windowMs})),
    },
    analysisHistoryPersistence: {
      writeErrors: Number(memory.telemetry?.analysisHistoryWriteErrors || 0),
      retryAttempts: Number(memory.telemetry?.analysisHistoryRetryAttempts || 0),
      recovered: Number(memory.telemetry?.analysisHistoryWriteRecovered || 0),
      acceptedDataLoss: Number(memory.telemetry?.analysisHistoryWriteLosses || 0),
      retryPending: Math.max(0, Number(memory.telemetry?.analysisHistoryRetryPending || 0)),
      sustainedFailureThreshold: 3,
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

const {
  observeProviderRequest: observeProviderRequestLocal,
  rotateWindow: rotateProviderObservabilityWindow,
  restoreWindow: restoreProviderObservabilityWindow,
  summarizeWindows: summarizeProviderObservabilityWindows,
  windowsFromBuckets: providerSloWindowsFromBuckets,
} = createProviderObservabilityRuntime({ memory });

function redactOpsString(value, max = 500) {
  return String(value ?? '')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/sb_secret_[A-Za-z0-9_-]+/gi, 'sb_secret_[redacted]')
    .replace(/x-apisports-key\s*[:=]\s*[^\s,;]+/gi, 'x-apisports-key=[redacted]')
    .slice(0, max);
}

const {
  hasSupabase,
  supaHeaders,
  supaSelectOne,
  supaSelectMany,
  supaSelectPaged,
  supaUpsert,
  supaInsertIgnore,
  supaPatch,
  supaDelete,
  supaRpc,
} = createSupabaseClient({
  fetchWithTimeout,
  redactMessage: redactOpsString,
});

const {
  finalizeAnalysisUsageReservation,
  reconcileAnalysisUsageReservations,
} = createAnalysisUsageCompensationRuntime({
  hasSupabase,
  supaRpc,
  recordOpsEvent,
  bumpTelemetry,
  redactOpsString,
});

const {
  runtimeControlsSnapshot,
  publicRuntimeControls,
  loadRuntimeControls,
  probeRuntimeHistorySchema,
  runtimeGuard,
  apiRuntimeControls,
  apiRuntimeRollback,
} = createRuntimeControlsRuntime({
  memory,
  DEFAULT_RUNTIME_CONTROLS,
  RUNTIME_CONTROLS_CACHE_MS,
  SUPABASE_SCHEMA_GUIDANCE,
  APP_VERSION,
  hasSupabase,
  supaSelectOne,
  supaInsertIgnore,
  supaSelectMany,
  fetchWithTimeout,
  supaHeaders,
  recordOpsEvent,
  redactOpsString,
  json,
  isAdminUser,
});

async function observeProviderRequest(event = {}, cfg = {}) {
  observeProviderRequestLocal(event);
  if (!hasSupabase(cfg)) return { ok:true, persistent:false, reason:'supabase_not_configured' };
  try {
    const result=await supaRpc(cfg,'record_provider_slo_observation',{
      p_provider:String(event?.provider || 'provider'),
      p_operation:String(event?.operation || 'unknown'),
      p_outcome:String(event?.outcome || event?.finalResult || ''),
      p_error_type:event?.errorType ? String(event.errorType) : null,
      p_latency_ms:Number.isFinite(Number(event?.latencyMs)) ? Math.max(0,Math.round(Number(event.latencyMs))) : null,
      p_observed_at:new Date().toISOString(),
    },2500);
    if (!result?.ok) throw new Error('Provider SLO observation was not confirmed.');
    return { ok:true, persistent:true, bucketStartedAt:result.bucketStartedAt || null };
  } catch (error) {
    bumpTelemetry('providerSloPersistenceErrors');
    return { ok:false, persistent:false, reason:redactOpsString(error?.message || error,160) };
  }
}

const {
  claimScheduledJob,
  completeScheduledJob,
  releaseScheduledJob,
} = createScheduledLeaseRuntime({
  hasSupabase,
  supaRpc,
  recordOpsEvent,
  redactOpsString,
});

const {
  getPreferences,
  savePreferences,
} = createUserPreferencesService({
  memory,
  hasSupabase,
  supaSelectOne,
  supaUpsert,
});

const {
  recordHistory,
  getHistory,
} = createUserHistoryService({
  memory,
  hasSupabase,
  supaUpsert,
  supaSelectMany,
  recordOpsEvent,
  bumpTelemetry,
  redactOpsString,
  correlationId: async (userId, fixtureId, cfg) => {
    if (!cfg?.botToken) return `fixture-${Number(fixtureId || 0)}`;
    const digest = await hmacSha256(
      enc.encode(cfg.botToken),
      `analysis-history:${Number(userId)}:${Number(fixtureId)}`,
    );
    return bytesToHex(digest).slice(0, 24);
  },
});

const {
  activatePassPurchase,
  listUserEntitlements,
  refundEntitlementUsage,
  refundPassByCharge,
  reserveEntitlementUsage,
  resolveUserEntitlements,
} = createEntitlementService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  getUserRecord: (...args) => getUserRecord(...args),
  markWebhookMutation: markTelegramWebhookMutation,
});

const {
  filterRecipients: filterSmartNotificationRecipients,
  loadFavoritePlayersByUser: loadFavoritePlayersForSmartNotifications,
} = createSmartNotificationAudience({
  hasSupabase,
  supaSelectMany,
  getPreferences,
  getUserRecord: (...args) => getUserRecord(...args),
  getFavoritePlayers: (...args) => getFavoritePlayers(...args),
});

const {
  reminderDeliveryStatus,
  clearStaleReminderClaims,
  claimReminderDelivery,
  markReminderDeliverySending,
  holdReminderDeliveryUnknown,
  finishReminderDelivery,
  releaseReminderClaim,
} = createReminderDeliveryStore({
  hasSupabase,
  fetchWithTimeout,
  supaHeaders,
  recordOpsEvent,
  redactOpsString,
});

const {
  deliverClaimedReminder,
  processDueReminders,
} = createReminderDeliveryService({
  hasSupabase,
  loadRuntimeControls,
  clearStaleReminderClaims,
  supaSelectPaged,
  recordOpsEvent,
  sendTelegramMessage,
  claimReminderDelivery,
  markReminderDeliverySending,
  holdReminderDeliveryUnknown,
  finishReminderDelivery,
  releaseReminderClaim,
  filterNotificationRecipients: filterSmartNotificationRecipients,
});

const {
  processLineupNotifications,
} = createLineupNotificationService({
  hasSupabase,
  loadRuntimeControls,
  supaSelectPaged,
  loadLineupNotificationSnapshot,
  deliverClaimedReminder,
  filterNotificationRecipients: filterSmartNotificationRecipients,
  recordOpsEvent,
  maxFixturesPerRun: 4,
});

const {
  processImportantChangeNotifications,
} = createImportantChangeNotificationService({
  hasSupabase,
  loadRuntimeControls,
  supaSelectPaged,
  getOddsSnapshots,
  deliverClaimedReminder,
  filterNotificationRecipients: filterSmartNotificationRecipients,
  recordOpsEvent,
  maxFixturesPerRun: 12,
  thresholdPp: SMART_NOTIFICATION_POLICY.marketThresholdPp,
});

const {
  getFavorites,
  addFavorite,
  removeFavorite,
} = createUserFavoritesService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  fetchWithTimeout,
  supaHeaders,
});

const {
  getFavoritePlayers,
  addFavoritePlayer,
  removeFavoritePlayer,
} = createFavoritePlayersService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  fetchWithTimeout,
  supaHeaders,
});

const {
  deliverSmartNotification,
} = createSmartNotificationDeliveryService({
  memory,
  hasSupabase,
  supaRpc,
  sendTelegramMessage,
  recordOpsEvent,
});

const {
  processSmartNotifications,
} = createSmartNotificationService({
  hasSupabase,
  loadRuntimeControls,
  supaSelectPaged,
  filterRecipients: filterSmartNotificationRecipients,
  loadFavoritePlayersByUser: loadFavoritePlayersForSmartNotifications,
  loadLiveNotificationSnapshot: loadSmartNotificationEventSnapshot,
  loadLineupSnapshot: loadLineupNotificationSnapshot,
  getAnalysisTimelineSnapshots,
  deliverSmartNotification,
  recordOpsEvent,
  maxFixturesPerRun: SMART_NOTIFICATION_POLICY.maxFixturesPerRun,
  aiThresholdPp: SMART_NOTIFICATION_POLICY.aiProbabilityThresholdPp,
  aiCooldownSeconds: SMART_NOTIFICATION_POLICY.aiCooldownSeconds,
  radarConfidenceThreshold: SMART_NOTIFICATION_POLICY.radarConfidenceThreshold,
  radarOutcomeThreshold: SMART_NOTIFICATION_POLICY.radarOutcomeThreshold,
  radarCooldownSeconds: SMART_NOTIFICATION_POLICY.radarCooldownSeconds,
});

const {
  getReminders,
  addReminder,
  removeReminder,
} = createUserRemindersService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  fetchWithTimeout,
  supaHeaders,
  getPreferences,
});

const {
  claimTelegramUpdate,
  completeTelegramUpdate,
  releaseTelegramUpdate,
  claimTelegramUpdatePersistent,
  completeTelegramUpdatePersistent,
  releaseTelegramUpdatePersistent,
  telegramPersistentDedupeSelfTest,
  readTelegramDedupeHealth,
  telegramDedupeObservabilitySelfTest,
  enforceTelegramBurst,
} = createTelegramDedupeRuntime({
  memory,
  pruneMemoryState,
  bumpTelemetry,
  hasSupabase,
  supaRpc,
  redactOpsString,
});

function sensitiveOpsMetadataKey(key = '') {
  return /token|secret|password|authorization|api.?key|init.?data|telegram.?id|user.?id|chat.?id|username|first.?name|last.?name|photo.?url/i.test(String(key));
}

function sanitizeOpsMetadataValue(value, depth = 0) {
  if (value === null || value === undefined || depth > 3) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactOpsString(value, depth === 0 ? 240 : 160);
  if (Array.isArray(value)) {
    return value.slice(0, 12)
      .map(item => sanitizeOpsMetadataValue(item, depth + 1))
      .filter(item => item !== undefined);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value).slice(0, 24)) {
      if (sensitiveOpsMetadataKey(key)) continue;
      const clean = sanitizeOpsMetadataValue(nested, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return redactOpsString(String(value), 160);
}

function safeOpsMetadata(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta || {}).slice(0, 32)) {
    if (sensitiveOpsMetadataKey(key)) continue;
    const clean = sanitizeOpsMetadataValue(value, 0);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

async function recordOpsEvent(cfg, event = {}) {
  const task = recordOpsEventTask(cfg, event);
  if (typeof cfg?.waitUntil === 'function') cfg.waitUntil(task);
  return await task;
}

async function recordOpsEventTask(cfg, event = {}) {
  const createdAt = new Date().toISOString();
  const row = {
    created_at: createdAt,
    severity: ['info','warning','error','critical'].includes(String(event.severity || '')) ? String(event.severity) : 'info',
    source: redactOpsString(event.source || 'worker', 80),
    event_type: redactOpsString(event.eventType || 'runtime', 100),
    code: redactOpsString(event.code || '', 100),
    message: redactOpsString(event.message || '', 500),
    endpoint: redactOpsString(event.endpoint || '', 160),
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : null,
    duration_ms: Number.isFinite(Number(event.durationMs)) ? Math.max(0, Math.round(Number(event.durationMs))) : null,
    transition_key: event.transitionKey ? redactOpsString(event.transitionKey, 220) : null,
    occurrence_count: 1,
    last_occurred_at: createdAt,
    metadata: {
      ...safeOpsMetadata({ ...currentReleaseIdentity(cfg), ...(event.meta || {}), ...currentReleaseIdentity(cfg) }),
      occurrenceCount:1,
      lastOccurredAt:createdAt,
    },
  };

  const memoryExisting = row.transition_key
    ? memory.opsEvents.find(item => String(item?.transition_key || '') === row.transition_key)
    : null;
  if (memoryExisting) {
    const nextCount=Math.max(1,Number(memoryExisting?.occurrence_count || memoryExisting?.metadata?.occurrenceCount || 1))+1;
    memoryExisting.occurrence_count=nextCount;
    memoryExisting.last_occurred_at=createdAt;
    memoryExisting.metadata={
      ...(memoryExisting.metadata || {}),
      occurrenceCount:nextCount,
      lastOccurredAt:createdAt,
    };
    row.occurrence_count=nextCount;
    row.metadata={...(row.metadata || {}),occurrenceCount:nextCount,lastOccurredAt:createdAt};
  } else {
    memory.opsEvents.unshift(row);
    memory.opsEvents = memory.opsEvents.slice(0, MAX_MEMORY_OPS_EVENTS);
  }

  const setPersistenceStatus = status => {
    Object.defineProperty(row, '_persistenceStatus', {
      value: status,
      enumerable: false,
      configurable: true,
    });
  };
  if (!hasSupabase(cfg)) {
    setPersistenceStatus('memory_only');
    return row;
  }

  if (row.transition_key) {
    try {
      const result=await supaRpc(cfg,'record_ops_event_occurrence',{
        p_created_at:row.created_at,
        p_severity:row.severity,
        p_source:row.source,
        p_event_type:row.event_type,
        p_transition_key:row.transition_key,
        p_code:row.code,
        p_message:row.message,
        p_endpoint:row.endpoint,
        p_status:row.status,
        p_duration_ms:row.duration_ms,
        p_metadata:row.metadata,
      },4000);
      if (!result?.ok) throw new Error('Persistent ops occurrence was not confirmed.');
      row.occurrence_count=Math.max(1,Number(result.occurrenceCount || result.occurrence_count || row.occurrence_count || 1));
      row.last_occurred_at=result.lastOccurredAt || result.last_occurred_at || row.last_occurred_at;
      row.metadata={
        ...(row.metadata || {}),
        occurrenceCount:row.occurrence_count,
        lastOccurredAt:row.last_occurred_at,
      };
      setPersistenceStatus('persistent');
      return row;
    } catch {
      // Backward-compatible DDL boundary: old schemas still dedupe transition
      // events safely, but cannot yet retain the true occurrence volume.
    }
  }

  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    const prefer = row.transition_key
      ? 'resolution=ignore-duplicates,return=minimal'
      : 'return=minimal';
    if (row.transition_key) url.searchParams.set('on_conflict', 'transition_key');
    const { occurrence_count: _occurrenceCount, last_occurred_at: _lastOccurredAt, ...legacyRow } = row;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: supaHeaders(cfg, { Prefer: prefer }),
      body: JSON.stringify(legacyRow),
    }, 4000, 'Supabase ops event');
    if (!response.ok) {
      const error = new Error(`Supabase ops event HTTP ${response.status}`);
      error.status = Number(response.status || 0);
      throw error;
    }
    setPersistenceStatus('persistent');
  } catch {
    // Observability must never become a new failure mode for the product.
    setPersistenceStatus('failed');
  }
  return row;
}

async function cleanupRateWindows(cfg) {
  if (!hasSupabase(cfg)) return { skipped: true };
  const cutoff = new Date(Date.now() - 2 * 86400_000).toISOString();
  try {
    await supaDelete(cfg, 'provider_rate_windows', { updated_at: `lt.${cutoff}` });
    return { ok: true, cutoff };
  } catch (error) {
    return { ok: false, error: redactOpsString(error?.message || error, 180) };
  }
}

async function cleanupScheduledJobLeases(cfg) {
  if (!hasSupabase(cfg)) return { skipped: true };
  const cutoff = new Date().toISOString();
  try {
    await supaDelete(cfg, 'scheduled_job_leases', { expires_at: `lt.${cutoff}` });
    return { ok: true, cutoff };
  } catch (error) {
    return { ok: false, error: redactOpsString(error?.message || error, 180) };
  }
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
  if (!hasSupabase(cfg)) return { skipped: true };
  const days = Math.max(1, Number(cfg.opsRetentionDays || 14));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const failedTables = [];

  for (const table of ['match_integrity_events', 'match_integrity_runs']) {
    try {
      await supaDelete(cfg, table, { observed_at: `lt.${cutoff}` });
    } catch (error) {
      failedTables.push({
        table,
        error: redactOpsString(error?.message || error, 180),
      });
    }
  }

  if (failedTables.length) {
    return {
      ok: false,
      error: `Integrity cleanup failed for: ${failedTables.map(item => item.table).join(', ')}`,
      cutoff,
      failedTables,
    };
  }
  return { ok: true, cutoff };
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
    supabaseProbeRecoveries: Number(t.supabaseProbeRecoveries || 0),
    supabaseProbeConfirmedFailures: Number(t.supabaseProbeConfirmedFailures || 0),
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
    providerDistributedBlocks: Number(t.providerDistributedBlocks || 0),
    providerDistributedFallbacks: Number(t.providerDistributedFallbacks || 0),
    providerRequests: Number(t.providerRequests || 0),
    providerErrors: Number(t.providerErrors || 0),
    providerTimeouts: Number(t.providerTimeouts || 0),
    providerRateLimits: Number(t.providerRateLimits || 0),
    providerRetries: Number(t.providerRetries || 0),
    providerAvgLatencyMs: Number(t.providerLatencySamples || 0)
      ? Math.round(Number(t.providerLatencyMs || 0) / Number(t.providerLatencySamples || 1))
      : null,
    providerSloPersistenceErrors: Number(t.providerSloPersistenceErrors || 0),
    quotaReservations: Number(t.quotaReservations || 0),
    quotaRefunds: Number(t.quotaRefunds || 0),
    analysisHistoryWriteErrors: Number(t.analysisHistoryWriteErrors || 0),
    analysisHistoryRetryAttempts: Number(t.analysisHistoryRetryAttempts || 0),
    analysisHistoryWriteRecovered: Number(t.analysisHistoryWriteRecovered || 0),
    analysisHistoryWriteLosses: Number(t.analysisHistoryWriteLosses || 0),
    analysisHistoryRetryPending: Number(t.analysisHistoryRetryPending || 0),
    digestDeliveryClaims: Number(t.digestDeliveryClaims || 0),
    digestDeliveryDuplicates: Number(t.digestDeliveryDuplicates || 0),
    inflightNow: memory.inflight.size,
    routeBucketsNow: memory.routeBurst.size,
    l1CacheEntries: memory.cache.size,
    note: 'Счётчики среды относятся к текущему серверному обработчику Cloudflare; квоты источника данных берутся из ответов API-Football.',
  };
}

const {
  getRequestUser,
  upsertUser,
  getUserRecord,
} = createUserAuthRuntime({
  memory,
  validateTelegramInitData,
  developmentTelegramId: DEVELOPMENT_TELEGRAM_ID,
  hasSupabase,
  supaUpsert,
  supaSelectOne,
  withSingleFlight,
  pruneMemoryState,
  bumpTelemetry,
  recordOpsEvent,
});

const {
  cleanLaunchPart,
  parseLaunchStartParam,
  ensureLaunchAttribution,
  recordGrowthEvent,
  ensureReferralCode,
  applyReferralAttribution,
  recordReferredPayment,
  cleanupGrowthEvents,
} = createGrowthReferralRuntime({
  memory,
  getUserRecord,
  hasSupabase,
  supaPatch,
  supaUpsert,
  supaSelectOne,
  supaDelete,
  safeOpsMetadata,
  redactOpsString,
  normalizeReferralCode,
  opaqueReferralCode,
  referralAttributionDecision,
  splitLaunchReferralParts,
});

function telegramStartPayload(text = '') {
  const match=String(text || '').match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?/i);
  return String(match?.[1] || '').slice(0,64);
}

function buildMediaCampaignPerformance(rows = []) {
  const map=new Map();
  for (const row of rows || []) {
    const event=String(row?.event_name || '');
    const source=cleanLaunchPart(row?.source || 'telegram',32) || 'telegram';
    const campaign=cleanLaunchPart(row?.campaign || 'direct',40) || 'direct';
    const content=cleanLaunchPart(row?.content || '',48);
    const mediaRelevant=Boolean(content)
      || ['media_link_created','share_created','share_link_created','share_card_created'].includes(event)
      || event==='fixture_deep_link_open'
      || ['media','press','partner','social'].includes(source);
    if (!mediaRelevant) continue;
    const key=`${source}|${campaign}|${content || 'default'}`;
    const bucket=map.get(key) || {
      source,campaign,content:content || 'default',
      users:new Set(),entries:new Set(),matchOpens:new Set(),quickAi:new Set(),fullAi:new Set(),
      deepLinkOpens:0,linksCreated:0,events:0,
    };
    const uid=Number(row?.telegram_id || 0);
    if (uid) bucket.users.add(uid);
    if (uid && ['bot_start','miniapp_open'].includes(event)) bucket.entries.add(uid);
    if (uid && event==='match_open') bucket.matchOpens.add(uid);
    if (uid && event==='quick_ai') bucket.quickAi.add(uid);
    if (uid && event==='full_ai') bucket.fullAi.add(uid);
    if (event==='fixture_deep_link_open') bucket.deepLinkOpens+=1;
    if (['media_link_created','share_created','share_link_created','share_card_created'].includes(event)) bucket.linksCreated+=1;
    bucket.events+=1;
    map.set(key,bucket);
  }
  return [...map.values()].map(x=>({
    source:x.source,
    campaign:x.campaign,
    content:x.content,
    users:x.users.size,
    entries:x.entries.size,
    matchOpens:x.matchOpens.size,
    quickAi:x.quickAi.size,
    fullAi:x.fullAi.size,
    deepLinkOpens:x.deepLinkOpens,
    linksCreated:x.linksCreated,
    events:x.events,
    matchOpenPct:x.entries.size ? Math.round((x.matchOpens.size/x.entries.size)*1000)/10 : 0,
    quickAiPct:x.entries.size ? Math.round((x.quickAi.size/x.entries.size)*1000)/10 : 0,
    fullAiConversionPct:x.entries.size ? Math.round((x.fullAi.size/x.entries.size)*1000)/10 : 0,
  })).sort((a,b)=>b.entries-a.entries || b.fullAi-a.fullAi || b.linksCreated-a.linksCreated || b.events-a.events).slice(0,30);
}

function mediaCampaignControlDrill() {
  const rows=[
    {telegram_id:1,event_name:'bot_start',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:1,event_name:'fixture_deep_link_open',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:1,event_name:'quick_ai',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:1,event_name:'full_ai',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:9,event_name:'media_link_created',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:2,event_name:'bot_start',source:'press',campaign:'ucl_launch',content:'article2'},
  ];
  const result=buildMediaCampaignPerformance(rows);
  const article1=result.find(x=>x.content==='article1');
  const article2=result.find(x=>x.content==='article2');
  return {
    pass:result.length===2
      && article1?.entries===1
      && article1?.deepLinkOpens===1
      && article1?.quickAi===1
      && article1?.fullAi===1
      && article1?.linksCreated===1
      && article1?.fullAiConversionPct===100
      && article2?.entries===1,
    cases:8,
  };
}

async function apiNewsImpactRecoveryIncidentAck(request,cfg,user) {
  if (request.method!=='POST') return json({error:'Метод не поддерживается.'},405);
  if (!hasSupabase(cfg)) return json({error:'Supabase не настроен.'},503);
  let body={};
  try { body=await request.json(); } catch {}
  const reason=NEWS_IMPACT_FAILURE_CODES.has(String(body?.reason || '')) ? String(body.reason) : '';
  const action=cleanNewsImpactActionCode(body?.action);
  const code=NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(body?.code || '')) ? String(body.code) : '';
  const lastSeenAt=String(body?.lastSeenAt || '');
  if (!reason || !action || !code || !Number.isFinite(Date.parse(lastSeenAt))) {
    return json({error:'Некорректный recovery-инцидент.'},400);
  }

  const loaded=await loadNewsImpactRecoveryStrategyEvidence(cfg);
  if (!loaded.available) return json({error:'Recovery evidence временно недоступно. Подтверждение не сохранено.'},503);
  const base=buildNewsImpactRecoveryStrategyMatrix(loaded.evidence,loaded.recentEvidence);
  const matrix=buildNewsImpactRecoveryDriftMatrix(base,loaded.priorEvidence,loaded.recentEvidence);
  const incidents=buildNewsImpactRecoveryIncidentCenter(
    matrix,
    loaded.incidentEvents || [],
    loaded.incidentAcknowledgements || [],
    loaded.reason,
  );
  const incident=incidents.find(x=>x.status==='active'
    && x.reason===reason
    && x.action===action
    && x.code===code
    && x.canAcknowledge
    && String(x.lastSeenAt || '')===lastSeenAt);
  if (!incident) {
    return json({error:'Инцидент уже изменился или больше не активен. Обновите Incident Center.'},409);
  }
  if (incident.acknowledged) {
    return json({ok:true,alreadyAcknowledged:true,acknowledgedAt:incident.acknowledgedAt || null});
  }

  const ok=await recordGrowthEvent(cfg,{
    userId:user.id,
    eventName:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT,
    channel:'system',
    metadata:{
      reason,
      action,
      incident_guard:code,
      incident_seen_at:lastSeenAt,
      ack_state:'acknowledged',
    },
  });
  if (!ok) return json({error:'Не удалось сохранить подтверждение инцидента.'},503);
  memory.newsImpactRecoveryStrategy={value:null,loadedAt:0};
  return json({
    ok:true,
    acknowledgedAt:new Date().toISOString(),
    incident:{reason,action,code,lastSeenAt},
  });
}

async function apiLaunchFunnel(request,cfg) {
  const url=new URL(request.url);
  const days=Math.max(1,Math.min(30,Number(url.searchParams.get('days') || 7)));
  if (!hasSupabase(cfg)) return json({available:false,reason:'Supabase не настроен.',days});
  const analyticsNowMs=Date.now();
  const since=new Date(analyticsNowMs-days*86400_000).toISOString();
  const previousSince=new Date(analyticsNowMs-days*2*86400_000).toISOString();
  let rows=[];
  let comparisonRows=[];
  let previousWindowRows=[];
  let truncated=false;
  let trendTruncated=false;
  let trendAvailable=true;
  try {
    const page=await supaSelectPaged(cfg,'growth_events',{created_at:`gte.${since}`},{pageSize:1000,maxRows:10000,order:'created_at.asc'});
    rows=page.rows;
    truncated=Boolean(page.truncated);
  } catch (error) {
    return json({available:false,reason:'Нужна миграция v6.15 или временно недоступна база.',days,error:redactOpsString(error?.message || error,120)});
  }
  try {
    const comparisonPage=await supaSelectPaged(cfg,'growth_events',{created_at:`gte.${previousSince}`},{pageSize:1000,maxRows:10000,order:'created_at.asc'});
    comparisonRows=comparisonPage.rows || [];
    previousWindowRows=comparisonRows.filter(row=>{
      const createdAt=Date.parse(String(row?.created_at || ''));
      return Number.isFinite(createdAt) && createdAt<Date.parse(since);
    });
    trendTruncated=Boolean(comparisonPage.truncated);
  } catch {
    trendAvailable=false;
    comparisonRows=[];
    previousWindowRows=[];
  }
  const setFor=(names)=>new Set(rows.filter(x=>names.includes(String(x.event_name || ''))).map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const entry=new Set([...setFor(['bot_start']),...setFor(['miniapp_open'])]);
  const stages=[
    ['entry','Вход',entry],
    ['search','Поиск',setFor(['search'])],
    ['match_open','Карточка матча',setFor(['match_open'])],
    ['quick_ai','AI в Telegram',setFor(['quick_ai'])],
    ['full_ai','Полный AI-разбор',setFor(['full_ai'])],
  ];
  const base=Math.max(1,entry.size);
  const funnel=stages.map(([key,label,set],index)=>({
    key,label,users:set.size,
    fromEntryPct:entry.size ? Math.round((set.size/base)*1000)/10 : 0,
    fromPreviousPct:index===0 ? 100 : stages[index-1][2].size ? Math.round((set.size/stages[index-1][2].size)*1000)/10 : 0,
  }));
  const campaignMap=new Map();
  for (const row of rows) {
    const source=cleanLaunchPart(row.source || 'telegram',32) || 'telegram';
    const campaign=cleanLaunchPart(row.campaign || 'direct',40) || 'direct';
    const key=`${source}|${campaign}`;
    const bucket=campaignMap.get(key) || {source,campaign,users:new Set(),entry:new Set(),fullAi:new Set(),events:0};
    const uid=Number(row.telegram_id || 0);
    if (uid) bucket.users.add(uid);
    if (uid && ['bot_start','miniapp_open'].includes(String(row.event_name || ''))) bucket.entry.add(uid);
    if (uid && row.event_name==='full_ai') bucket.fullAi.add(uid);
    bucket.events+=1;
    campaignMap.set(key,bucket);
  }
  const recheckRows=rows.filter(x=>String(x.event_name || '')==='analysis_recheck');
  const recheckFree=recheckRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.free : false)).length;
  const recheckMaterial=recheckRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.material : false)).length;
  const recheckStable=recheckRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.stable : false)).length;
  const handoffUsers=setFor(['ai_handoff']);
  const fullAiUsers=setFor(['full_ai']);
  const handoffToFull=new Set([...handoffUsers].filter(uid=>fullAiUsers.has(uid)));
  const newsOpen=setFor(['news_open']);
  const newsAiIntent=setFor(['news_ai_intent']);
  const smartNewsAiRows=rows.filter(x=>String(x.event_name || '')==='news_ai_intent' && String(x?.metadata && typeof x.metadata==='object' ? x.metadata.linking || '' : '')==='smart_fixture');
  const smartNewsAiUsers=new Set(smartNewsAiRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const newsReturn=setFor(['news_return']);
  const newsImpactRows=rows.filter(x=>String(x.event_name || '')==='news_impact_delta');
  const newsImpactCompared=new Set(newsImpactRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.compared : false)).map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const newsImpactMaterial=new Set(newsImpactRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.material : false)).map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const newsImpactDecision=(row)=>String(row?.metadata && typeof row.metadata==='object' ? row.metadata.decision || '' : '');
  const newsImpactDecisionSummary={
    total:newsImpactRows.length,
    material:newsImpactRows.filter(x=>newsImpactDecision(x)==='material').length,
    detail:newsImpactRows.filter(x=>newsImpactDecision(x)==='detail').length,
    stable:newsImpactRows.filter(x=>newsImpactDecision(x)==='stable').length,
    guarded:newsImpactRows.filter(x=>['guarded','baseline_missing'].includes(newsImpactDecision(x))).length,
    unavailable:newsImpactRows.filter(x=>newsImpactDecision(x)==='unavailable').length,
  };
  const newsImpactActionRows=rows.filter(x=>String(x.event_name || '')==='news_impact_action');
  const newsImpactAction=(row)=>String(row?.metadata && typeof row.metadata==='object' ? row.metadata.action || '' : '');
  const newsImpactActionSummary={
    total:newsImpactActionRows.length,
    users:new Set(newsImpactActionRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean)).size,
    fullAi:newsImpactActionRows.filter(x=>newsImpactAction(x)==='full_ai').length,
    squads:newsImpactActionRows.filter(x=>newsImpactAction(x)==='squads').length,
    market:newsImpactActionRows.filter(x=>newsImpactAction(x)==='market').length,
    recheck:newsImpactActionRows.filter(x=>newsImpactAction(x)==='recheck').length,
    news:newsImpactActionRows.filter(x=>newsImpactAction(x)==='news').length,
    share:newsImpactActionRows.filter(x=>newsImpactAction(x)==='share').length,
  };
  const newsImpactOutcomeRows=rows.filter(x=>String(x.event_name || '')==='news_impact_outcome');
  const newsImpactActionOutcomeQuality=buildNewsImpactActionOutcomeQuality(newsImpactActionRows,newsImpactOutcomeRows,{asOfMs:analyticsNowMs});
  const newsImpactOutcomeBottleneck=newsImpactOutcomeBottleneck(newsImpactActionOutcomeQuality);
  const newsImpactOutcomeSummary=newsImpactActionOutcomeQuality.reduce((acc,row)=>{
    acc.observed+=Number(row.observed || 0);
    acc.attempts+=Number(row.attempts || 0);
    acc.pending+=Number(row.pending || 0);
    acc.confirmed+=Number(row.confirmed || 0);
    return acc;
  },{observed:0,attempts:0,pending:0,confirmed:0,completionPct:0});
  newsImpactOutcomeSummary.completionPct=newsImpactOutcomeSummary.attempts
    ? Math.round((newsImpactOutcomeSummary.confirmed/newsImpactOutcomeSummary.attempts)*1000)/10
    : 0;
  const newsImpactOutcomeGuard={outcomeWindowMinutes:NEWS_IMPACT_OUTCOME_WINDOW_MINUTES,minimumSample:NEWS_IMPACT_FUNNEL_MIN_USERS,meaning:'confirmed_delivery_not_satisfaction'};
  const newsImpactFailureRows=rows.filter(x=>String(x.event_name || '')==='news_impact_outcome_failure');
  const newsImpactFailureDiagnostics=buildNewsImpactFailureDiagnostics(newsImpactFailureRows);
  const newsImpactFailureSummary={
    total:newsImpactFailureRows.length,
    users:new Set(newsImpactFailureRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean)).size,
    topReason:newsImpactFailureDiagnostics[0] || null,
  };
  const newsImpactFailureGuard={rawErrorsStored:false,meaning:'delivery_failure_not_user_dissatisfaction',taxonomy:[...NEWS_IMPACT_FAILURE_CODES]};
  const newsImpactRecoveryAttemptRows=rows.filter(x=>String(x.event_name || '')==='news_impact_recovery_attempt');
  const newsImpactRecoveryEffectiveness=buildNewsImpactRecoveryEffectiveness(newsImpactRecoveryAttemptRows,newsImpactOutcomeRows,newsImpactFailureRows,{asOfMs:analyticsNowMs});
  const newsImpactRecoveryBestStrategy=newsImpactRecoveryBest(newsImpactRecoveryEffectiveness);
  const newsImpactRecoverySummary=newsImpactRecoveryEffectiveness.reduce((acc,row)=>{
    acc.observed+=Number(row.observed || 0);
    acc.attempts+=Number(row.attempts || 0);
    acc.pending+=Number(row.pending || 0);
    acc.recovered+=Number(row.recovered || 0);
    acc.failed+=Number(row.failed || 0);
    return acc;
  },{observed:0,attempts:0,pending:0,recovered:0,failed:0,successPct:0});
  newsImpactRecoverySummary.successPct=newsImpactRecoverySummary.attempts
    ? Math.round((newsImpactRecoverySummary.recovered/newsImpactRecoverySummary.attempts)*1000)/10
    : 0;
  const newsImpactRecoveryGuard={windowMinutes:NEWS_IMPACT_RECOVERY_WINDOW_MINUTES,minimumSample:NEWS_IMPACT_FUNNEL_MIN_USERS,latestAttemptPerJourney:true,meaning:'confirmed_delivery_after_real_recovery_attempt'};
  const newsImpactRecoveryStrategyLoaded=await loadNewsImpactRecoveryStrategyEvidence(cfg);
  const newsImpactRecoveryStrategyEvidence=newsImpactRecoveryStrategyLoaded.available ? newsImpactRecoveryStrategyLoaded.evidence : [];
  const newsImpactRecoveryStrategyRecentEvidence=newsImpactRecoveryStrategyLoaded.available ? newsImpactRecoveryStrategyLoaded.recentEvidence : [];
  const newsImpactRecoveryStrategyPriorEvidence=newsImpactRecoveryStrategyLoaded.available ? newsImpactRecoveryStrategyLoaded.priorEvidence : [];
  const newsImpactRecoveryStrategyBaseMatrix=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryStrategyMatrix(newsImpactRecoveryStrategyEvidence,newsImpactRecoveryStrategyRecentEvidence)
    : [];
  const newsImpactRecoveryStrategyMatrix=buildNewsImpactRecoveryDriftMatrix(newsImpactRecoveryStrategyBaseMatrix,newsImpactRecoveryStrategyPriorEvidence,newsImpactRecoveryStrategyRecentEvidence);
  const newsImpactRecoveryTransitionHistory=newsImpactRecoveryStrategyLoaded.available
    ? (newsImpactRecoveryStrategyLoaded.transitionHistory || [])
    : [];
  const newsImpactRecoveryTransitionSummary=summarizeNewsImpactRecoveryTransitions(newsImpactRecoveryTransitionHistory);
  const newsImpactRecoveryIncidentEvents=newsImpactRecoveryStrategyLoaded.available
    ? (newsImpactRecoveryStrategyLoaded.incidentEvents || [])
    : [];
  const newsImpactRecoveryIncidentAcknowledgements=newsImpactRecoveryStrategyLoaded.available
    ? (newsImpactRecoveryStrategyLoaded.incidentAcknowledgements || [])
    : [];
  const newsImpactRecoveryIncidents=buildNewsImpactRecoveryIncidentCenter(
    newsImpactRecoveryStrategyMatrix,
    newsImpactRecoveryIncidentEvents,
    newsImpactRecoveryIncidentAcknowledgements,
    newsImpactRecoveryStrategyLoaded.reason,
    {asOfMs:analyticsNowMs},
  );
  const newsImpactRecoveryIncidentSummary=summarizeNewsImpactRecoveryIncidents(newsImpactRecoveryIncidents);
  const newsImpactRecoveryIncidentSloDashboard=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloDashboard(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,weeks:4},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        windowDays:28,
        weeks:4,
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{episodes:0,recurringPairs:0,ackSloPct:null,recoverySloPct:null},
        weekly:[],
        repeated:[],
        privacy:{telegramIdsExposed:false,rawErrorsExposed:false},
      };
  const newsImpactRecoveryIncidentSloBreachFeed=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloBreachFeed(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,limit:20},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{breachEpisodes:0,activeBreaches:0,critical:0,ackBreaches:0,recoveryBreaches:0,repeatedPairs:0},
        items:[],
        repeated:[],
        privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
        routingChanged:false,
      };
  const newsImpactRecoveryIncidentSloBreachWatchlist=buildNewsImpactRecoveryIncidentSloBreachWatchlist(
    newsImpactRecoveryIncidentSloBreachFeed,
    {limit:10},
  );
  const newsImpactRecoveryIncidentSloBreachTriage=buildNewsImpactRecoveryIncidentSloBreachTriage(
    newsImpactRecoveryIncidentSloBreachWatchlist,
    {limit:10},
  );
  const newsImpactRecoveryIncidentSloBreachTriageTrend=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloBreachTriageTrend(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,weeks:4},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        weeks:4,
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{currentTotal:0,totalDelta:0,recoveryOverdueDelta:0,ackCriticalDelta:0,ackOverdueDelta:0,stuckPairs:0},
        weekly:[],
        stuck:[],
        thresholds:{
          ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
          criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
          recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
          source:'rc87_existing_slo',
        },
        privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
        routingChanged:false,
        persistence:'none',
      };
  const newsImpactRecoveryIncidentSloBreachImpactRanking=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloBreachImpactRanking(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,limit:10},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{pairs:0,activePairs:0,breachEpisodes:0,totalOverdueMinutes:0,ackOverdueMinutes:0,recoveryOverdueMinutes:0,topContributionPct:0},
        ranking:[],
        thresholds:{
          ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
          criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
          recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
          source:'rc87_existing_slo',
        },
        methodology:'sum_minutes_above_existing_ack_and_recovery_slo',
        privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
        routingChanged:false,
        persistence:'none',
      };
  const newsImpactRecoveryIncidentSloBreachImpactTrend=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloBreachImpactTrend(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,weeks:4,limit:10},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        weeks:4,
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{currentOverdueMinutes:0,previousOverdueMinutes:0,deltaMinutes:0,increasedPairs:0,decreasedPairs:0,unchangedPairs:0},
        weekly:[],
        pairs:[],
        thresholds:{
          ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
          criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
          recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
          source:'rc87_existing_slo',
        },
        methodology:'weekly_overlap_minutes_above_existing_ack_and_recovery_slo',
        privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
        routingChanged:false,
        persistence:'none',
      };
  const newsImpactRecoveryIncidentSloImpactConcentration=buildNewsImpactRecoveryIncidentSloImpactConcentration(
    newsImpactRecoveryIncidentSloBreachImpactRanking,
  );
  const newsImpactRecoveryIncidentSloImpactConcentrationTrend=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,weeks:4},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        weeks:4,
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{
          currentPairs:0,previousPairs:0,pairDelta:0,currentOverdueMinutes:0,previousOverdueMinutes:0,
          top1ContributionPct:0,top3ContributionPct:0,top5ContributionPct:0,
          top1DeltaPctPoints:0,top3DeltaPctPoints:0,top5DeltaPctPoints:0,
          top1Direction:'unchanged',top3Direction:'unchanged',top5Direction:'unchanged',
        },
        weekly:[],
        methodology:'weekly_cumulative_share_of_total_overdue_minutes',
        thresholds:{
          ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
          criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
          recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
          source:'rc87_existing_slo',
        },
        privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
        routingChanged:false,
        persistence:'none',
      };
  const newsImpactRecoveryIncidentSloImpactExecutiveSummary=buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(
    newsImpactRecoveryIncidentSloBreachImpactRanking,
    newsImpactRecoveryIncidentSloBreachImpactTrend,
    newsImpactRecoveryIncidentSloImpactConcentration,
    newsImpactRecoveryIncidentSloImpactConcentrationTrend,
  );
  const newsImpactRecoveryIncidentSloImpactFocusQueue=buildNewsImpactRecoveryIncidentSloImpactFocusQueue(
    newsImpactRecoveryIncidentSloBreachImpactRanking,
    newsImpactRecoveryIncidentSloBreachImpactTrend,
    newsImpactRecoveryIncidentSloImpactExecutiveSummary,
    {limit:5},
  );
  const newsImpactRecoveryIncidentSloGuard={
    ackTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
    ackCriticalMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
    recoveryTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
    escalation:'derived_from_incident_age_and_ack_state',
    persistence:'none',
  };
  const newsImpactRecoveryStrategyAlerts=buildNewsImpactRecoveryAdminAlerts(
    newsImpactRecoveryStrategyMatrix,
    newsImpactRecoveryStrategyLoaded.reason,
    newsImpactRecoveryIncidents,
  );
  const newsImpactRecoveryAlertSummary=summarizeNewsImpactRecoveryAlerts(newsImpactRecoveryStrategyAlerts);
  const newsImpactRecoveryStrategySummary={
    available:Boolean(newsImpactRecoveryStrategyLoaded.available),
    evidenceReason:String(newsImpactRecoveryStrategyLoaded.reason || 'unknown'),
    rules:newsImpactRecoveryStrategyMatrix.length,
    adaptive:newsImpactRecoveryStrategyMatrix.filter(x=>x.strategy==='adaptive').length,
    fixed:newsImpactRecoveryStrategyMatrix.filter(x=>x.strategy==='fixed').length,
    stabilityBlocked:newsImpactRecoveryStrategyMatrix.filter(x=>['stability_sample','recent_regression'].includes(x.guardReason)).length,
    driftBlocked:newsImpactRecoveryStrategyMatrix.filter(x=>x.guardReason==='performance_drift').length,
    adaptiveUsed:newsImpactFailureRows.filter(x=>String(x?.metadata?.strategy || '')==='adaptive').length,
    fixedUsed:newsImpactFailureRows.filter(x=>String(x?.metadata?.strategy || 'fixed')!=='adaptive').length,
  };
  const newsImpactRecoveryStrategyGuard={
    minAttempts:NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS,
    minLiftPctPoints:NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS,
    lookbackDays:NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS,
    stabilityWindowDays:NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS,
    stabilityMinAttempts:NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS,
    sourceWindowMinutes:NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES,
    interval:'non_overlapping_wilson_95',
    recentRule:'candidate_not_worse',
    driftPriorMinAttempts:NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS,
    driftRecentMinAttempts:NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS,
    driftDropPctPoints:NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS,
    driftRule:'recent_upper_below_prior_lower_wilson_95',
    evidenceSource:'shared_runtime_loader',
    fallback:'fixed',
  };
  const newsImpactActionFunnel=buildNewsImpactActionFunnel(newsImpactRows,newsImpactActionRows,{asOfMs:analyticsNowMs});
  const newsImpactActionBottleneck=newsImpactActionFunnelBottleneck(newsImpactActionFunnel);
  const newsImpactActionConfidenceGuard={minUsers:NEWS_IMPACT_FUNNEL_MIN_USERS,stableUsers:NEWS_IMPACT_FUNNEL_STABLE_USERS,interval:'wilson_95'};
  const newsImpactActionAttributionGuard={actionWindowMinutes:NEWS_IMPACT_ACTION_WINDOW_MINUTES,maturationMinutes:NEWS_IMPACT_ACTION_WINDOW_MINUTES,requiresActionAfterDecision:true,allowsBoundaryFollowup:true};
  const previousNewsImpactRows=previousWindowRows.filter(x=>String(x.event_name || '')==='news_impact_delta');
  const previousNewsImpactActionRows=comparisonRows.filter(x=>String(x.event_name || '')==='news_impact_action');
  const previousNewsImpactActionFunnel=buildNewsImpactActionFunnel(previousNewsImpactRows,previousNewsImpactActionRows,{asOfMs:analyticsNowMs});
  const newsImpactActionTrend=trendAvailable ? buildNewsImpactActionTrend(newsImpactActionFunnel,previousNewsImpactActionFunnel) : [];
  const newsImpactActionTrendGuard={comparisonDays:days,requiresBothPeriods:true,signalRule:'non_overlapping_wilson_95'};
  const shareRows=rows.filter(x=>['share_created','share_link_created','share_card_created'].includes(String(x.event_name || '')));
  const deepLinkRows=rows.filter(x=>String(x.event_name || '')==='fixture_deep_link_open');
  const deepLinkUsers=new Set(deepLinkRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const deepLinkAiRows=rows.filter(x=>String(x.event_name || '')==='quick_ai' && String(x?.metadata && typeof x.metadata==='object' ? x.metadata.source || '' : '')==='deep_link');
  const deepLinkAiUsers=new Set(deepLinkAiRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const shareUsers=new Set(shareRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const searchResultRows=rows.filter(x=>String(x.event_name || '')==='search_result');
  const searchOutcome=(row)=>String(row?.metadata && typeof row.metadata==='object' ? row.metadata.outcome || '' : '');
  const searchMatches=searchResultRows.filter(x=>searchOutcome(x)==='match').length;
  const searchRecognizedNoMatch=searchResultRows.filter(x=>searchOutcome(x)==='recognized_no_match').length;
  const searchNotFound=searchResultRows.filter(x=>searchOutcome(x)==='not_found').length;
  const searchRecoveredRecent=searchResultRows.filter(x=>searchOutcome(x)==='match' && String(x?.metadata && typeof x.metadata==='object' ? x.metadata.recovery || '' : '')==='recent').length;
  const transitions=funnel.slice(1).map((stage,index)=>({
    from:funnel[index]?.key || '',to:stage.key,label:`${funnel[index]?.label || ''} → ${stage.label || ''}`,
    fromUsers:Number(funnel[index]?.users || 0),toUsers:Number(stage.users || 0),conversionPct:Number(stage.fromPreviousPct || 0),
    dropPct:Math.max(0,Math.round((100-Number(stage.fromPreviousPct || 0))*10)/10),
  }));
  const bottleneck=[...transitions].filter(x=>x.fromUsers>0).sort((a,b)=>b.dropPct-a.dropPct)[0] || null;
  const campaigns=[...campaignMap.values()].map(x=>({
    source:x.source,campaign:x.campaign,users:x.users.size,entries:x.entry.size,fullAi:x.fullAi.size,events:x.events,
    conversionPct:x.entry.size ? Math.round((x.fullAi.size/x.entry.size)*1000)/10 : 0,
  })).sort((a,b)=>b.entries-a.entries || b.fullAi-a.fullAi).slice(0,20);
  const mediaCampaigns=buildMediaCampaignPerformance(rows);
  const mediaSummary=mediaCampaigns.reduce((acc,x)=>{
    acc.linksCreated+=Number(x.linksCreated || 0);
    acc.entries+=Number(x.entries || 0);
    acc.deepLinkOpens+=Number(x.deepLinkOpens || 0);
    acc.quickAi+=Number(x.quickAi || 0);
    acc.fullAi+=Number(x.fullAi || 0);
    return acc;
  },{materials:mediaCampaigns.length,linksCreated:0,entries:0,deepLinkOpens:0,quickAi:0,fullAi:0,conversionPct:0});
  mediaSummary.conversionPct=mediaSummary.entries ? Math.round((mediaSummary.fullAi/mediaSummary.entries)*1000)/10 : 0;
  return json({
    available:true,
    days,
    generatedAt:new Date().toISOString(),
    retentionDays:Number(cfg.growthRetentionDays || 90),
    events:rows.length,
    truncated,
    uniqueUsers:new Set(rows.map(x=>Number(x.telegram_id || 0)).filter(Boolean)).size,
    funnel,
    bottleneck,
    handoff:{users:handoffUsers.size,fullAiUsers:handoffToFull.size,conversionPct:handoffUsers.size?Math.round((handoffToFull.size/handoffUsers.size)*1000)/10:0},
    rechecks:{total:recheckRows.length,free:recheckFree,charged:Math.max(0,recheckRows.length-recheckFree),material:recheckMaterial,stable:recheckStable},
    returnLoop:{newsOpen:newsOpen.size,newsReturn:newsReturn.size,aiIntent:newsAiIntent.size,smartFixtureIntent:smartNewsAiUsers.size,impactChecks:newsImpactRows.length,impactCompared:newsImpactCompared.size,impactMaterial:newsImpactMaterial.size,intentPct:newsOpen.size?Math.round((newsAiIntent.size/newsOpen.size)*1000)/10:0,conversionPct:newsOpen.size?Math.round((newsReturn.size/newsOpen.size)*1000)/10:0},
    newsImpactDecisionSummary,
    newsImpactActionSummary,
    newsImpactOutcomeSummary,
    newsImpactActionOutcomeQuality,
    newsImpactOutcomeBottleneck,
    newsImpactOutcomeGuard,
    newsImpactFailureSummary,
    newsImpactFailureDiagnostics,
    newsImpactFailureGuard,
    newsImpactRecoverySummary,
    newsImpactRecoveryEffectiveness,
    newsImpactRecoveryBestStrategy,
    newsImpactRecoveryGuard,
    newsImpactRecoveryStrategySummary,
    newsImpactRecoveryStrategyMatrix,
    newsImpactRecoveryStrategyGuard,
    newsImpactRecoveryTransitionHistory,
    newsImpactRecoveryTransitionSummary,
    newsImpactRecoveryStrategyAlerts,
    newsImpactRecoveryAlertSummary,
    newsImpactRecoveryIncidents,
    newsImpactRecoveryIncidentSummary,
    newsImpactRecoveryIncidentSloGuard,
    newsImpactRecoveryIncidentSloDashboard,
    newsImpactRecoveryIncidentSloBreachFeed,
    newsImpactRecoveryIncidentSloBreachWatchlist,
    newsImpactRecoveryIncidentSloBreachTriage,
    newsImpactRecoveryIncidentSloBreachTriageTrend,
    newsImpactRecoveryIncidentSloBreachImpactRanking,
    newsImpactRecoveryIncidentSloBreachImpactTrend,
    newsImpactRecoveryIncidentSloImpactConcentration,
    newsImpactRecoveryIncidentSloImpactConcentrationTrend,
    newsImpactRecoveryIncidentSloImpactExecutiveSummary,
    newsImpactRecoveryIncidentSloImpactFocusQueue,
    newsImpactActionFunnel,
    newsImpactActionBottleneck,
    newsImpactActionConfidenceGuard,
    newsImpactActionAttributionGuard,
    newsImpactActionTrend,
    newsImpactActionTrendGuard,
    trendAvailable,
    trendTruncated,
    mediaLoop:{shareEvents:shareRows.length,shareUsers:shareUsers.size,deepLinkOpens:deepLinkRows.length,deepLinkUsers:deepLinkUsers.size,aiUsers:deepLinkAiUsers.size,conversionPct:deepLinkUsers.size?Math.round((deepLinkAiUsers.size/deepLinkUsers.size)*1000)/10:0},
    searchQuality:{attempts:searchResultRows.length,match:searchMatches,recognizedNoMatch:searchRecognizedNoMatch,notFound:searchNotFound,recoveredRecent:searchRecoveredRecent,matchPct:searchResultRows.length?Math.round((searchMatches/searchResultRows.length)*1000)/10:0},
    campaigns,
    mediaCampaigns,
    mediaSummary,
    privacy:'Ответ содержит только агрегаты; Telegram ID и текст поисковых запросов пользователей не возвращаются.',
  });
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

async function reserveAnalysisQuota(userId, cfg) {
  const date = todayUtc();
  const user = await getUserRecord(userId, cfg);
  let plan = user?.plan || 'FREE';
  if (plan !== 'FREE' && user?.subscription_until && new Date(user.subscription_until) < new Date()) plan = 'FREE';
  const limit = Number(cfg.limits[plan] || cfg.limits.FREE);

  if (hasSupabase(cfg)) {
    const requestedOperationId = crypto.randomUUID();
    let result;
    try {
      result = await supaRpc(cfg, 'consume_analysis_quota', {
        p_telegram_id: Number(userId),
        p_usage_date: date,
        p_limit: limit,
      }, 7000, durableAnalysisUsageHeaders(requestedOperationId));
    } catch (error) {
      await recordOpsEvent(cfg, {
        severity: 'error',
        source: 'quota',
        eventType: 'analysis_usage_reservation',
        code: 'ANALYSIS_QUOTA_RESERVATION_OUTCOME_UNKNOWN',
        message: 'Analysis quota reservation response was not confirmed. A durable database reservation, if created, will be reconciled automatically.',
        meta: {
          operationId: requestedOperationId,
          usageDate: date,
          error: redactOpsString(error?.message || error, 180),
        },
      }).catch(() => null);
      throw error;
    }

    const used = Number(result?.used || 0);
    const operationId = String(result?.operationId || '').trim();
    const durable = Boolean(result?.allowed && result?.durable === true && operationId);
    if (result?.allowed) bumpTelemetry('quotaReservations');
    return {
      reserved: Boolean(result?.allowed),
      allowed: Boolean(result?.allowed),
      durable,
      operationId: durable ? operationId : null,
      kind: 'quota',
      userId: Number(userId),
      date,
      plan,
      used,
      limit,
      left: Math.max(0, limit - used),
      reason: String(result?.reason || ''),
    };
  }

  const used = await getUsage(userId, cfg);
  if (used >= limit) return { reserved:false, allowed:false, durable:false, kind:'quota', userId:Number(userId), date, plan, used, limit, left:0, reason:'quota_exhausted' };
  const next = used + 1;
  memory.usage.set(`${userId}:${date}`, next);
  bumpTelemetry('quotaReservations');
  return { reserved:true, allowed:true, durable:false, kind:'quota', userId:Number(userId), date, plan, used:next, limit, left:Math.max(0,limit-next), reason:'reserved_local' };
}

async function refundAnalysisQuota(userId, reservation, cfg) {
  if (!reservation?.reserved) return { ok:true, skipped:true, reason:'not_reserved' };
  if (hasSupabase(cfg)) {
    const result = await supaRpc(cfg, 'refund_analysis_quota', {
      p_telegram_id: Number(userId),
      p_usage_date: reservation.date || todayUtc(),
    });
    if (result?.refunded !== true) {
      const error = new Error(String(result?.reason || 'legacy_quota_refund_not_confirmed'));
      error.code = 'LEGACY_QUOTA_REFUND_NOT_CONFIRMED';
      throw error;
    }
  } else {
    const key=`${userId}:${reservation.date || todayUtc()}`;
    memory.usage.set(key, Math.max(0, Number(memory.usage.get(key) || 0) - 1));
  }
  bumpTelemetry('quotaRefunds');
  return { ok:true, refunded:true };
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
  if (!cfg.botToken) {
    const error = new Error('TELEGRAM_BOT_TOKEN не настроен.');
    error.code = 'TELEGRAM_CONFIG';
    throw error;
  }

  let r;
  try {
    r = await fetchWithTimeout(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }, 8000, `Telegram ${method}`);
  } catch (cause) {
    const timedOut = String(cause?.code || '') === 'UPSTREAM_TIMEOUT';
    const error = new Error(cause?.message || (timedOut ? `Telegram ${method} timeout` : `Telegram ${method} network error`));
    error.code = timedOut ? 'TELEGRAM_TIMEOUT' : 'TELEGRAM_NETWORK';
    error.retryAfter = Math.max(0, Number(cause?.retryAfter || 0));
    throw error;
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok) {
    const status = Number(r.status || 0);
    const error = new Error(data?.description || `Telegram ${method}: HTTP ${status}`);
    error.status = status;
    error.retryAfter = Math.max(0, Number(data?.parameters?.retry_after || r.headers.get('retry-after') || 0));
    error.code = status === 429
      ? 'TELEGRAM_RATE_LIMIT'
      : status >= 500
        ? 'TELEGRAM_UPSTREAM'
        : 'TELEGRAM_REJECTED';
    throw error;
  }

  if (!/^get[A-Z]/.test(String(method || ''))) markTelegramWebhookEffect(cfg, method);
  return data.result;
}

async function updateUserSubscription(userId, fields, cfg) {
  markTelegramWebhookMutation(cfg, 'user_subscription');
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
  markTelegramWebhookMutation(cfg, 'billing_payment');
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'billing_payments', row, 'telegram_payment_charge_id');
  } else {
    memory.billingPayments.set(String(row.telegram_payment_charge_id), row);
  }
}

async function findRefundableBillingCharge(userId, paymentChargeId, cfg) {
  const uid = Number(userId);
  const chargeId = String(paymentChargeId || '').trim();
  if (!Number.isSafeInteger(uid) || uid <= 0 || !chargeId || chargeId.length > 240) return null;

  let payment = null;
  if (hasSupabase(cfg)) {
    payment = await supaSelectOne(cfg, 'billing_payments', {
      telegram_payment_charge_id: `eq.${chargeId}`,
      telegram_id: `eq.${uid}`,
    }).catch(() => null);
  } else {
    const row = memory.billingPayments.get(chargeId) || null;
    if (row && Number(row.telegram_id) === uid) payment = row;
  }
  if (payment) return {
    kind: 'subscription',
    status: String(payment.status || 'paid').toLowerCase(),
    plan: String(payment.plan || ''),
  };

  const entitlements = await listUserEntitlements(uid, cfg).catch(() => []);
  const entitlement = entitlements.find(row =>
    String(row.payment_charge_id || row.paymentChargeId || '') === chargeId
    && Number(row.telegram_id || row.telegramId || 0) === uid
  );
  if (!entitlement) return null;
  return {
    kind: 'pass',
    status: String(entitlement.status || 'active').toLowerCase(),
    plan: String(entitlement.entitlement_type || entitlement.type || ''),
  };
}

async function applyRefundedPayment(userId, paymentChargeId, cfg) {
  const uid = Number(userId);
  const chargeId = String(paymentChargeId || '').trim();
  if (!Number.isSafeInteger(uid) || uid <= 0 || !chargeId) return { updated:false, reason:'invalid_refund' };

  try {
    markTelegramWebhookMutation(cfg, 'billing_refund');
    if (hasSupabase(cfg)) {
      await supaPatch(cfg, 'billing_payments', {
        telegram_payment_charge_id: `eq.${chargeId}`,
        telegram_id: `eq.${uid}`,
      }, {
        status: 'refunded',
        updated_at: new Date().toISOString(),
      });
    } else {
      const row = memory.billingPayments.get(chargeId);
      if (row && Number(row.telegram_id) === uid) {
        memory.billingPayments.set(chargeId, { ...row, status:'refunded', updated_at:new Date().toISOString() });
      }
    }

    // Pass revocation is part of the refund invariant. Do not turn a temporary
    // entitlement-store failure into a successful refund acknowledgement.
    const passRefund = await refundPassByCharge(userId, chargeId, cfg);
    const record = await getUserRecord(uid, cfg);
    let subscriptionRevoked = false;
    if (record && String(record.telegram_payment_charge_id || '') === chargeId) {
      await updateUserSubscription(uid, {
        plan: 'FREE',
        subscription_until: new Date().toISOString(),
        subscription_canceled: true,
        telegram_payment_charge_id: null,
      }, cfg);
      subscriptionRevoked = true;
    }
    return { updated:true, subscriptionRevoked, passRevoked:Boolean(passRefund?.updated) };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause || 'Refund reconciliation failed.'));
    error.code = 'BILLING_REFUND_RECONCILIATION';
    // Every mutation above is an idempotent move toward the same refunded
    // state, so Telegram may safely redeliver a refunded_payment update.
    error.telegramWebhookRetrySafe = true;
    throw error;
  }
}

async function applySuccessfulPayment(userId, payment, cfg, fallbackDate = Math.floor(Date.now() / 1000)) {
  if (!payment || payment.currency !== 'XTR') return false;
  const chargeId = String(payment.telegram_payment_charge_id || '');
  if (!chargeId) return false;

  const existingCharge = await findRefundableBillingCharge(userId, chargeId, cfg).catch(() => null);
  if (String(existingCharge?.status || '').toLowerCase() === 'refunded') {
    await recordOpsEvent(cfg, {
      severity:'warning',
      source:'billing',
      eventType:'refund_replay_blocked',
      code:'BILLING_REFUNDED_CHARGE_REPLAY_BLOCKED',
      message:'Refused to re-apply a refunded Telegram Stars charge.',
      endpoint:'telegram_stars_sync',
      status:200,
      meta:{
        kind:existingCharge?.kind || '',
        product:existingCharge?.plan || '',
        chargeSuffix:chargeId.slice(-8),
      },
    }).catch(() => null);
    return false;
  }

  const subscription = await parseInvoicePayload(payment.invoice_payload, cfg.botToken);
  if (subscription) {
    if (Number(subscription.userId) !== Number(userId)) return false;
    const planCfg = billingPlanConfig(subscription.plan, cfg);
    if (!planCfg || Number(payment.total_amount) !== Number(planCfg.stars)) return false;

    const expiresUnix = Number(payment.subscription_expiration_date || 0)
      || (Number(fallbackDate || Math.floor(Date.now() / 1000)) + SUBSCRIPTION_PERIOD_SECONDS);
    const expiresAt = new Date(expiresUnix * 1000).toISOString();

    await saveBillingPayment({
      telegram_payment_charge_id: chargeId,
      telegram_id: Number(userId),
      plan: subscription.plan,
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
      plan: subscription.plan,
      subscription_until: expiresAt,
      subscription_canceled: false,
      telegram_payment_charge_id: chargeId,
    }, cfg);
    await recordReferredPayment(userId,payment,subscription.plan,cfg).catch(()=>false);
    return true;
  }

  const pass = await parsePassInvoicePayload(payment.invoice_payload, cfg.botToken);
  if (!pass || Number(pass.userId) !== Number(userId)) return false;
  const product = passProductConfig(pass.passType, cfg);
  if (!product || Number(payment.total_amount) !== Number(product.stars)) return false;

  const activated = await activatePassPurchase({
    telegramId: Number(userId),
    passType: pass.passType,
    fixtureId: pass.fixtureId,
    starsAmount: Number(payment.total_amount),
    paymentChargeId: chargeId,
    invoicePayload: String(payment.invoice_payload || ''),
    paidAt: new Date(Number(fallbackDate || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  }, cfg);
  return Boolean(activated?.activated || activated?.duplicate);
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

const STAR_SYNC_PAGE_SIZE = 100;
const STAR_SYNC_MAX_PAGES = 5;

async function loadStarTransactionsForSync(cfg) {
  const transactions=[];
  let pagesScanned=0;
  let truncated=false;

  for (let page=0; page<STAR_SYNC_MAX_PAGES; page+=1) {
    const offset=page*STAR_SYNC_PAGE_SIZE;
    const tx=await telegramApi('getStarTransactions',cfg,{offset,limit:STAR_SYNC_PAGE_SIZE});
    const batch=Array.isArray(tx?.transactions) ? tx.transactions : [];
    transactions.push(...batch);
    pagesScanned+=1;
    if (batch.length < STAR_SYNC_PAGE_SIZE) {
      truncated=false;
      break;
    }
    truncated=page === STAR_SYNC_MAX_PAGES - 1;
  }

  return { transactions, pagesScanned, truncated };
}

async function syncBillingFromStars(userId, cfg) {
  const history=await loadStarTransactionsForSync(cfg);
  const list=history.transactions;
  const refundedChargeIds=new Set();
  let best = null;
  let passVerified = 0;
  let refundsReconciled = 0;

  // Telegram exposes purchase refunds as outgoing Star transactions whose id
  // matches the original incoming payment charge. Reconcile those first so an
  // older purchase page can never reactivate already-refunded access.
  for (const item of list) {
    const receiver=item?.receiver;
    if (!receiver || receiver.type !== 'user' || receiver.transaction_type !== 'invoice_payment') continue;
    if (Number(receiver.user?.id) !== Number(userId)) continue;
    const chargeId=String(item?.id || '').trim();
    if (!chargeId || refundedChargeIds.has(chargeId)) continue;
    refundedChargeIds.add(chargeId);
    const reconciled=await applyRefundedPayment(userId,chargeId,cfg);
    if (reconciled?.updated) refundsReconciled+=1;
  }

  const seenIncomingCharges=new Set();
  for (const item of list) {
    const source = item?.source;
    if (!source || source.type !== 'user' || source.transaction_type !== 'invoice_payment') continue;
    if (Number(source.user?.id) !== Number(userId)) continue;
    const chargeId=String(item?.id || '').trim();
    if (!chargeId || refundedChargeIds.has(chargeId) || seenIncomingCharges.has(chargeId)) continue;
    seenIncomingCharges.add(chargeId);

    const pass = await parsePassInvoicePayload(source.invoice_payload, cfg.botToken);
    if (pass && Number(pass.userId) === Number(userId)) {
      const product = passProductConfig(pass.passType, cfg);
      if (product && Number(item.amount) === Number(product.stars)) {
        const applied = await applySuccessfulPayment(userId, {
          currency: 'XTR',
          total_amount: Number(item.amount),
          invoice_payload: source.invoice_payload,
          telegram_payment_charge_id: chargeId,
          provider_payment_charge_id: '',
          is_recurring: false,
          is_first_recurring: false,
        }, cfg, Number(item.date || Math.floor(Date.now() / 1000)));
        if (applied) passVerified += 1;
      }
      continue;
    }

    const parsed = await parseInvoicePayload(source.invoice_payload, cfg.botToken);
    if (!parsed || Number(parsed.userId) !== Number(userId)) continue;
    const planCfg = billingPlanConfig(parsed.plan, cfg);
    if (!planCfg || Number(item.amount) !== Number(planCfg.stars)) continue;
    const period = Number(source.subscription_period || SUBSCRIPTION_PERIOD_SECONDS);
    const expiresUnix = Number(item.date || 0) + period;
    if (!best || expiresUnix > best.expiresUnix) best = { item, source, parsed, expiresUnix, chargeId };
  }

  let subscriptionSynced = false;
  if (best && best.expiresUnix * 1000 > Date.now()) {
    subscriptionSynced = await applySuccessfulPayment(userId, {
      currency: 'XTR',
      total_amount: Number(best.item.amount),
      invoice_payload: best.source.invoice_payload,
      telegram_payment_charge_id: best.chargeId,
      provider_payment_charge_id: '',
      subscription_expiration_date: best.expiresUnix,
      is_recurring: true,
      is_first_recurring: false,
    }, cfg, Number(best.item.date || Math.floor(Date.now() / 1000)));
  }

  return {
    synced: Boolean(subscriptionSynced || passVerified || refundsReconciled),
    subscriptionSynced: Boolean(subscriptionSynced),
    passVerified,
    refundsReconciled,
    transactionPagesScanned: history.pagesScanned,
    transactionHistoryTruncated: history.truncated,
    quota: await getQuota(userId, cfg),
  };
}

function telegramMiniAppE2EDrill() {
  const request=new Request('https://app.example/');
  const match={
    fixtureId:12345,
    status:'NS',
    home:{id:101,name:'Home FC',logo:''},
    away:{id:202,name:'Away FC',logo:''},
    league:'Test League',
  };
  const mainKeyboard=footballBotKeyboard(request);
  const searchKeyboard=footballSearchHandoffKeyboard(request,match,'https://app.example/?view=search');
  const quickKeyboard=footballQuickAiHandoffKeyboard(request,match,[], '');
  const actionKeyboard=footballMatchActionKeyboard(request,match,'',[]);
  const flatten=keyboard=>(keyboard?.inline_keyboard || keyboard?.keyboard || []).flat();
  const mainButtons=flatten(mainKeyboard).map(x=>String(x?.text || ''));
  const searchButtons=flatten(searchKeyboard);
  const quickButtons=flatten(quickKeyboard);
  const actionButtons=flatten(actionKeyboard);
  const searchSelect=searchButtons.find(x=>String(x?.callback_data || '')===`match:menu:${match.fixtureId}`);
  const fullButton=quickButtons.find(x=>String(x?.text || '').includes('Полный AI'));
  const fullUrl=String(fullButton?.web_app?.url || '');
  let handoffOk=false;
  try {
    const u=new URL(fullUrl);
    handoffOk=Number(u.searchParams.get('fixtureId'))===match.fixtureId
      && u.searchParams.get('action')==='analysis'
      && u.searchParams.get('tab')==='brief'
      && u.searchParams.get('handoff')==='1';
  } catch {}
  const favoriteCallbacks=new Set(actionButtons.map(x=>String(x?.callback_data || '')).filter(x=>x.startsWith('favorite:toggle:')));
  return {
    pass:mainButtons.includes('🔎 Найти матч')
      && Boolean(searchSelect)
      && handoffOk
      && favoriteCallbacks.has('favorite:toggle:101:12345')
      && favoriteCallbacks.has('favorite:toggle:202:12345'),
    cases:5,
    search:Boolean(searchSelect),
    handoff:handoffOk,
    favorites:favoriteCallbacks.size,
  };
}


async function apiFixtureShareLink(request, cfg, user) {
  const url=new URL(request.url);
  const fixtureId=Number(url.searchParams.get('fixtureId') || 0);
  if (!Number.isSafeInteger(fixtureId) || fixtureId<=0) return json({error:'Номер матча обязателен.'},400);
  const source=cleanLaunchPart(url.searchParams.get('source') || 'social',14) || 'social';
  const campaign=cleanLaunchPart(url.searchParams.get('campaign') || 'match_share',22) || 'match_share';
  const content=cleanLaunchPart(url.searchParams.get('content') || 'miniapp',16) || 'miniapp';
  try {
    const referralCode=await ensureReferralCode(user.id,cfg).catch(()=>'');
    const link=await fixtureTelegramDeepLink(cfg,fixtureId,{source,campaign,content,referralCode});
    void recordGrowthEvent(cfg,{
      userId:user.id,
      eventName:'share_created',
      channel:'miniapp',
      fixtureId,
      metadata:{source,campaign,content,surface:'miniapp',referral:Boolean(referralCode)},
    });
    return json({
      ok:true,
      fixtureId,
      url:link.url,
      startParam:link.startParam,
      telegramShareUrl:telegramShareComposerUrl(link.url,'Открой матч в MatchRadar — ссылка сразу приведёт к матчу и доступному AI-разбору.'),
      referral:{enabled:Boolean(referralCode),code:referralCode || null},
    });
  } catch (error) {
    return json({error:'Не удалось подготовить ссылку на матч.',detail:redactOpsString(error?.message || error,120)},503);
  }
}

function fixtureShareCardText(match = {}, analysis = null) {
  const card=normalizeBotFixtureCard(match || {});
  const ai=analysis?.aiInstructor || {};
  const signal=ai.betSignal || {};
  const confidence=Number.isFinite(Number(ai.confidenceScore)) ? `${Math.round(Number(ai.confidenceScore))}/100` : '';
  return [
    '⚽ <b>MatchRadar AI · МАТЧ</b>',
    '',
    `<b>${telegramHtmlEscape(card.homeName)} — ${telegramHtmlEscape(card.awayName)}</b>`,
    telegramHtmlEscape(card.league || 'Футбол'),
    card.date ? `🗓 ${telegramHtmlEscape(botFixtureDateTime(card.date))}` : '',
    signal.label ? `🧠 AI: <b>${telegramHtmlEscape(signal.label)}</b>${confidence?` · ${confidence}`:''}` : '🧠 AI-разбор откроется сразу по ссылке.',
    '',
    '<i>Информационная аналитика, не гарантия результата.</i>',
  ].filter(Boolean).join('\n');
}

async function sendBotFixtureShareCard(request,cfg,userId,chatId,fixtureId) {
  const referralCode=await ensureReferralCode(userId,cfg).catch(()=>'');
  const [match,analysis,link]=await Promise.all([
    loadBotFixtureCard(fixtureId,cfg),
    getCache(`fixture:${Number(fixtureId)}:v15-availability-quality-rc144`,cfg).catch(()=>null),
    fixtureTelegramDeepLink(cfg,fixtureId,{source:'social',campaign:'match_share',content:'telegram',referralCode}),
  ]);
  if (!match) throw new Error('Матч не найден.');
  const plain=`${match.homeName} — ${match.awayName}\nMatchRadar: открыть матч и доступный AI-разбор`;
  void recordGrowthEvent(cfg,{
    userId,
    eventName:'share_created',
    channel:'telegram',
    fixtureId,
    metadata:{surface:'match_card',referral:Boolean(referralCode)},
  });
  await telegramApi('sendMessage',cfg,{
    chat_id:chatId,
    parse_mode:'HTML',
    text:fixtureShareCardText(match,analysis),
    reply_markup:{inline_keyboard:[
      [{text:'↗ Отправить другу / в канал',url:telegramShareComposerUrl(link.url,plain)}],
      [{text:'🧠 Открыть самому',web_app:{url:telegramFullAnalysisUrl(request,fixtureId,'brief')}}],
    ]},
  });
}


async function apiChannelPublisherTest(request,cfg,user) {
  if (!isAdminUser(user,cfg)) return adminForbidden();
  const body=await readJson(request);
  const fixtureId=Number(body?.fixtureId || 0);
  if (!Number.isSafeInteger(fixtureId) || fixtureId<=0) return json({error:'Укажите корректный fixture ID.'},400);
  const text=String(body?.text || '').trim();
  if (!text) return json({error:'Текст тестового поста обязателен.'},400);

  const publisher=channelPublisherState(cfg);
  const link=await fixtureTelegramDeepLink(cfg,fixtureId,{source:'channel',campaign:'publisher_mvp',content:'manual'});
  const dryRun=body?.dryRun !== false;
  const preview={
    channelId:publisher.channelId || cfg.telegramChannelId || '',
    fixtureId,
    text,
    cta:{text:'Открыть матч в MatchRadar',url:link.url},
    publisher:{enabled:Boolean(publisher.enabled),reason:publisher.reason},
  };

  if (dryRun) return json({ok:true,dryRun:true,published:false,preview});

  if (!publisher.enabled) {
    return json({
      ok:false,
      published:false,
      disabled:true,
      code:'PUBLISHER_DISABLED',
      reason:publisher.reason,
    },503);
  }

  try {
    const result=await publishChannelMessage({
      cfg,
      fixtureId,
      text,
      ctaUrl:link.url,
      idempotencyKey:String(body?.idempotencyKey || '').trim(),
    },{
      claimIdempotency:(key,meta)=>claimChannelPublishIdempotency(key,meta,cfg),
      completeIdempotency:(key,meta)=>completeChannelPublishIdempotency(key,meta,cfg),
      releaseIdempotency:(key,meta)=>releaseChannelPublishIdempotency(key,meta,cfg),
    });
    return json({...result,dryRun:false,fixtureId,cta:preview.cta},result.ok?200:503);
  } catch (error) {
    void recordOpsEvent(cfg,{
      severity:'error',
      source:'channel_publisher',
      eventType:'manual_publish',
      code:String(error?.code || 'CHANNEL_PUBLISH_FAILED'),
      message:error?.message || error,
      endpoint:'/api/admin/channel-publisher/test',
      status:502,
      meta:{fixtureId},
    }).catch(()=>null);
    return json({
      ok:false,
      published:false,
      code:String(error?.code || 'CHANNEL_PUBLISH_FAILED'),
      error:'Не удалось отправить тестовый пост в Telegram-канал.',
    },502);
  }
}


function fixtureDeepLinkDrill() {
  const p=fixtureShareStartParam(123456,{source:'media',campaign:'launch',content:'sportnews'});
  const parsed=parseLaunchStartParam(p);
  return {pass:p.length<=64 && parsed.fixtureId===123456 && parsed.source==='media' && parsed.campaign==='launch' && parsed.content==='sportnews',length:p.length};
}


function mediaPublisherCopy(match = {}, deepLink = '', attribution = {}) {
  const card=normalizeBotFixtureCard(match || {});
  const title=card.fixtureId && card.homeName && card.awayName
    ? `${card.homeName} — ${card.awayName}`
    : `Матч #${Number(card.fixtureId || 0) || '—'}`;
  const meta=[card.league,card.date ? botFixtureDateTime(card.date) : ''].filter(Boolean).join(' · ');
  const body=[
    `⚽ ${title}`,
    meta,
    '',
    'MatchRadar AI: составы, судья, рынок, риски и AI-разбор матча.',
    deepLink ? `Открыть матч: ${deepLink}` : '',
    '',
    'Информационная аналитика. Не гарантия результата.',
  ].filter(Boolean).join('\n');
  return {
    title,
    body,
    source:String(attribution.source || ''),
    campaign:String(attribution.campaign || ''),
    content:String(attribution.content || ''),
  };
}

function campaignPublisherCopy(deepLink = '', attribution = {}) {
  const body=[
    '⚽ MatchRadar — футбольная аналитика в Telegram',
    '',
    'Матчи, форма команд, составы, события, статистика и AI-разбор — в одном Mini App.',
    'Открой MatchRadar, выбери матч и посмотри доступный разбор.',
    deepLink ? `Открыть MatchRadar: ${deepLink}` : '',
    '',
    'Информационная аналитика. Не гарантия результата.',
  ].filter(Boolean).join('\n');
  return {
    title:'MatchRadar — футбольная аналитика',
    body,
    source:String(attribution.source || ''),
    campaign:String(attribution.campaign || ''),
    content:String(attribution.content || ''),
  };
}

async function apiMediaPublisherLink(request,cfg,user) {
  if (!isAdminUser(user,cfg)) return adminForbidden();
  const body=await readJson(request);
  const fixtureId=Number(body?.fixtureId || 0);
  if (fixtureId && (!Number.isSafeInteger(fixtureId) || fixtureId<=0)) return json({error:'Укажите корректный fixture ID или оставьте поле пустым.'},400);
  const source=cleanLaunchPart(body?.source || 'social',fixtureId>0?14:24) || 'social';
  const campaign=cleanLaunchPart(body?.campaign || 'soft_launch',fixtureId>0?22:28) || 'soft_launch';
  const content=cleanLaunchPart(body?.content || 'promo1',fixtureId>0?16:20) || 'promo1';

  let link;
  let copy;
  let mode='campaign';
  if (fixtureId>0) {
    mode='fixture';
    link=await fixtureTelegramDeepLink(cfg,fixtureId,{source,campaign,content});
    const cached=await getCache(`bot:fixture-card:${fixtureId}:v2`,cfg).catch(()=>null);
    const analyzed=await getCache(`fixture:${fixtureId}:v15-availability-quality-rc144`,cfg).catch(()=>null);
    const match=normalizeBotFixtureCard(cached?.match || analyzed?.match || {fixtureId,homeName:'Матч',awayName:String(fixtureId),league:'Футбол'});
    copy=mediaPublisherCopy(match,link.url,{source,campaign,content});
  } else {
    link=await telegramCampaignDeepLink(cfg,{source,campaign,content});
    copy=campaignPublisherCopy(link.url,{source,campaign,content});
  }

  void recordGrowthEvent(cfg,{
    userId:user.id,
    eventName:'media_link_created',
    channel:'miniapp',
    fixtureId:fixtureId || null,
    metadata:{source,campaign,content,admin:true,mode},
    attribution:{source,campaign,content,startParam:link.startParam},
  });
  return json({
    ok:true,
    mode,
    fixtureId:fixtureId || null,
    startParam:link.startParam,
    deepLink:link.url,
    telegramShareUrl:telegramShareComposerUrl(link.url,copy.title),
    copy,
  });
}

function mediaPublisherDrill() {
  const fixtureParam=fixtureShareStartParam(998877,{source:'press',campaign:'ucl_launch',content:'article1'});
  const fixtureParsed=parseLaunchStartParam(fixtureParam);
  const campaignParam=campaignStartParam({source:'telegram_channel',campaign:'soft_launch',content:'post1'});
  const campaignParsed=parseLaunchStartParam(campaignParam);
  const fixtureCopy=mediaPublisherCopy({fixtureId:998877,homeName:'A',awayName:'B',league:'Cup'},'https://t.me/test?start='+fixtureParam,{source:'press',campaign:'ucl_launch',content:'article1'});
  const campaignCopy=campaignPublisherCopy('https://t.me/test?start='+campaignParam,{source:'telegram_channel',campaign:'soft_launch',content:'post1'});
  return {pass:fixtureParsed.fixtureId===998877
    && fixtureParsed.source==='press'
    && fixtureParsed.campaign==='ucl_launch'
    && campaignParsed.source==='telegram_channel'
    && campaignParsed.campaign==='soft_launch'
    && campaignParsed.content==='post1'
    && fixtureCopy.body.includes('A — B')
    && campaignCopy.body.includes('MatchRadar'),cases:8};
}

function publicSiteUrl(request, pathname = '/') {
  const url=new URL(request.url);
  url.pathname=pathname.startsWith('/') ? pathname : `/${pathname}`;
  url.search='';
  url.hash='';
  return url.toString();
}

function footballBotKeyboard(request) {
  return {
    keyboard: [
      [{ text: '⚽ Матчи' }, { text: '🔎 Найти матч' }],
      [{ text: '🔴 LIVE' }, { text: '⭐ Мои команды' }],
      [{ text: '🤖 AI-подборка' }, { text: '••• Ещё' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Команда, матч или вопрос…',
  };
}

function footballBotMoreKeyboard(request) {
  return {
    keyboard: [
      [{ text: '🕘 Последний разбор' }, { text: '📰 Новости' }],
      [{ text: '📈 Протокол AI' }, { text: '☀️ Утренняя подборка' }],
      [{ text: 'ℹ️ Как это работает' }, { text: '← Главное меню' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function favoriteTeamIdSet(rows = []) {
  return new Set((rows || []).map(x=>Number(x.team_id || x.teamId || 0)).filter(Boolean));
}

function favoriteMatchTeamRow(match = {}, favorites = []) {
  const fav=favoriteTeamIdSet(favorites);
  const fixtureId=Number(match?.fixtureId || 0);
  const teams=[match?.home,match?.away].filter(x=>Number(x?.id || 0)>0 && x?.name);
  if (!teams.length) return [];
  return teams.map(team=>({
    text:`${fav.has(Number(team.id))?'★':'☆'} ${String(team.name || 'Команда').slice(0,22)}`,
    callback_data:`favorite:toggle:${Number(team.id)}:${fixtureId}`,
  }));
}

function footballMatchActionKeyboard(request, match = {}, searchUrl = '', favorites = []) {
  const fixtureId = Number(match?.fixtureId || 0);
  if (!fixtureId) return footballBotKeyboard(request);
  const favoriteRow=favoriteMatchTeamRow(match,favorites);
  if (match?.live || match?.finished) {
    const rows = [];
    if (favoriteRow.length) rows.push(favoriteRow);
    if (match.finished) rows.push([
      { text: '🧠 Итог AI', callback_data: `match:review:${fixtureId}` },
      { text: '📋 Центр матча', web_app: { url: telegramWebAppUrl(request, { fixtureId, action: 'center' }) } },
    ]);
    else rows.push([{ text: '🔴 Открыть LIVE-центр', web_app: { url: telegramWebAppUrl(request, { fixtureId, action: 'center' }) } }]);
    rows.push([{text:'↗ Поделиться матчем',callback_data:`match:share:${fixtureId}`}]);
    if (searchUrl) rows.push([{ text: '🔎 Вернуться к поиску', web_app: { url: searchUrl } }]);
    return { inline_keyboard: rows };
  }
  const rows = [];
  if (favoriteRow.length) rows.push(favoriteRow);
  rows.push(
    [
      { text: '🧠 AI-вердикт', callback_data: `match:verdict:${fixtureId}` },
      { text: '🧑‍⚖️ Судья', callback_data: `match:referee:${fixtureId}` },
    ],
    [
      { text: '👥 Составы и потери', callback_data: `match:squads:${fixtureId}` },
      { text: '💹 Рынок и риски', callback_data: `match:market:${fixtureId}` },
    ],
    [
      { text: '🔄 Обновить AI', callback_data: `match:refresh:${fixtureId}` },
      { text: '📊 Полный AI-разбор', web_app: { url: telegramFullAnalysisUrl(request, fixtureId, 'brief') } },
    ],
    [{text:'↗ Поделиться матчем',callback_data:`match:share:${fixtureId}`}],
  );
  if (searchUrl) rows.push([{ text: '🔎 Другие результаты', web_app: { url: searchUrl } }]);
  return { inline_keyboard: rows };
}

function footballQuickAiHandoffKeyboard(request, match = {}, favorites = [], searchUrl = '') {
  const fixtureId=Number(match?.fixtureId || 0);
  if (!fixtureId) return footballBotKeyboard(request);
  const rows=[[{text:'📊 Полный AI-разбор',web_app:{url:telegramFullAnalysisUrl(request,fixtureId,'brief')}}]];
  const favoriteRow=favoriteMatchTeamRow(match,favorites);
  if (favoriteRow.length) rows.push(favoriteRow);
  rows.push(
    [
      {text:'🧑‍⚖️ Судья',callback_data:`match:referee:${fixtureId}`},
      {text:'👥 Составы',callback_data:`match:squads:${fixtureId}`},
    ],
    [
      {text:'💹 Рынок и риски',callback_data:`match:market:${fixtureId}`},
      {text:'🔄 Обновить AI',callback_data:`match:refresh:${fixtureId}`},
    ],
    [{text:'↗ Поделиться матчем',callback_data:`match:share:${fixtureId}`}],
  );
  if (searchUrl) rows.push([{text:'🔎 Другие результаты',web_app:{url:searchUrl}}]);
  return {inline_keyboard:rows};
}

function footballSearchHandoffKeyboard(request, match = {}, searchUrl = '') {
  const fixtureId=Number(match?.fixtureId || 0);
  if (!fixtureId) return footballBotKeyboard(request);
  if (match?.live || match?.finished) return footballMatchActionKeyboard(request,match,searchUrl,[]);
  const label=match?.selection?.primary ? '⭐ Короткая AI-оценка' : '🧠 Короткая AI-оценка';
  const rows=[
    [{text:label,callback_data:`match:menu:${fixtureId}`}],
    [{text:'📊 Сразу полный AI-разбор',web_app:{url:telegramFullAnalysisUrl(request,fixtureId,'brief')}}],
  ];
  if (searchUrl) rows.push([{text:'🔎 Другие результаты',web_app:{url:searchUrl}}]);
  return {inline_keyboard:rows};
}

function normalizeBotFixtureCard(match = {}) {
  const fixtureId = Number(match?.fixtureId || match?.fixture?.id || 0);
  const status = String(match?.status || match?.fixture?.status?.short || '');
  const homeSource=match?.home || match?.teams?.home || {};
  const awaySource=match?.away || match?.teams?.away || {};
  const homeName = String(homeSource?.name || match?.homeName || 'Хозяева');
  const awayName = String(awaySource?.name || match?.awayName || 'Гости');
  const leagueSource=match?.league;
  const league = String((typeof leagueSource==='object' ? leagueSource?.name : leagueSource) || match?.leagueShort || 'Турнир');
  return {
    fixtureId,
    date:String(match?.date || match?.fixture?.date || ''),
    status,
    statusLabel:String(match?.statusLabel || statusLabel(status, match?.fixture?.status?.elapsed)),
    live:Boolean(match?.live) || isLiveStatus(status),
    finished:Boolean(match?.finished) || isFinishedStatus(status),
    elapsed:Number(match?.elapsed || match?.fixture?.status?.elapsed || 0) || null,
    home:{id:Number(homeSource?.id || 0),name:homeName,logo:String(homeSource?.logo || '')},
    away:{id:Number(awaySource?.id || 0),name:awayName,logo:String(awaySource?.logo || '')},
    homeName,
    awayName,
    league,
    leagueId:Number(match?.leagueId || (typeof leagueSource==='object' ? leagueSource?.id : 0) || 0),
    country:String(match?.country || (typeof leagueSource==='object' ? leagueSource?.country : '') || ''),
    round:String(match?.roundLabel || match?.round || (typeof leagueSource==='object' ? leagueSource?.round : '') || ''),
  };
}

async function rememberBotFixtureCards(matches = [], cfg) {
  await Promise.allSettled((matches || []).map(async match => {
    const card = normalizeBotFixtureCard(match);
    if (!card.fixtureId) return;
    const writes=[setCache(`bot:fixture-card:${card.fixtureId}:v2`, card.fixtureId, { match:card, savedAt:new Date().toISOString() }, cfg, 180)];
    for (const team of [card.home,card.away]) {
      if (Number(team?.id || 0)>0 && team?.name) writes.push(setCache(`bot:team-card:${Number(team.id)}:v1`,Number(team.id),{team,savedAt:new Date().toISOString()},cfg,720));
    }
    await Promise.allSettled(writes);
  }));
}

async function loadBotTeamCard(teamId,cfg) {
  const id=Number(teamId || 0);
  if (!id) return null;
  const cached=await getCache(`bot:team-card:${id}:v1`,cfg).catch(()=>null);
  if (cached?.team?.name) return cached.team;
  return null;
}

async function loadBotFixtureCard(fixtureId, cfg) {
  const id = Number(fixtureId || 0);
  if (!id) return null;
  const saved = await getCache(`bot:fixture-card:${id}:v2`, cfg).catch(()=>null);
  if (saved?.match) return normalizeBotFixtureCard(saved.match);
  const analyzed = await getCache(`fixture:${id}:v10-ai-instructor`, cfg).catch(()=>null);
  if (analyzed?.match) {
    const card=normalizeBotFixtureCard(analyzed.match);
    await rememberBotFixtureCards([card],cfg);
    return card;
  }
  if (!freeQuotaHealthy(6,1)) return { fixtureId:id, home:{id:0,name:'Матч',logo:''}, away:{id:0,name:String(id),logo:''}, homeName:'Матч', awayName:String(id), league:'Футбол', live:false, finished:false };
  const fixture = await loadProviderFixture(id,cfg).catch(()=>null);
  if (!fixture) return null;
  const card = normalizeBotFixtureCard(fixture);
  await rememberBotFixtureCards([card], cfg);
  return card;
}

function botFixtureDateTime(iso = '') {
  const d=new Date(iso || '');
  if (!Number.isFinite(d.getTime())) return 'время уточняется';
  return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(d)+' UTC';
}

function botFixtureCardText(match = {}, { aiReady=false } = {}) {
  const card = normalizeBotFixtureCard(match);
  const status = card.live ? `🔴 ${card.statusLabel || 'Матч идёт'}` : card.finished ? '✅ Матч завершён' : `🗓 ${botFixtureDateTime(card.date)}`;
  const round=card.round ? ` · ${telegramHtmlEscape(card.round)}` : '';
  const aiState=card.finished ? '📋 Доступен центр матча' : aiReady ? '🧠 AI-разбор уже сохранён' : '🧠 AI готов собрать полный разбор';
  return [
    '⚽ <b>MatchRadar AI · MATCH</b>',
    '',
    `<b>${telegramHtmlEscape(card.homeName)} — ${telegramHtmlEscape(card.awayName)}</b>`,
    `${telegramHtmlEscape(card.league)}${round}`,
    telegramHtmlEscape(status),
    `<i>${telegramHtmlEscape(aiState)}</i>`,
    '',
    'Выберите нужный блок. ☆/★ добавляет клуб в «Мои команды».',
  ].join('\n');
}

async function botAnalyzeFixtureDefault(request,cfg,userId,fixtureId) {
  const data=await botAnalyzeFixture(request,cfg,userId,fixtureId);
  return data;
}

async function sendBotFixtureMenu(request, cfg, userId, chatId, fixtureId, options = {}) {
  void recordGrowthEvent(cfg,{userId,eventName:'match_open',channel:'telegram',fixtureId,attribution:options.attribution || null,metadata:{source:options.source || 'match_select'}});
  const [match,favorites] = await Promise.all([
    loadBotFixtureCard(fixtureId,cfg),
    getFavorites(userId,cfg).catch(()=>[]),
  ]);
  if (!match) {
    await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Матч больше не найден в доступных данных.',reply_markup:footballBotKeyboard(request)});
    return;
  }
  await rememberBotFixtureCards([match],cfg);
  if (match.live || match.finished) {
    const analysis=await getCache(`fixture:${Number(fixtureId)}:v10-ai-instructor`,cfg).catch(()=>null);
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      parse_mode:'HTML',
      text:botFixtureCardText(match,{aiReady:Boolean(analysis)}),
      reply_markup:footballMatchActionKeyboard(request,match,'',favorites),
    });
    return;
  }
  try {
    markTelegramWebhookMutation(cfg, 'analysis_quota_or_history');
    const data=options.newsImpactDelta
      ? await botAnalyzeFixture(request,cfg,userId,fixtureId,{
          newsImpactRecheck:true,
          newsPublishedAt:options.newsPublishedAt || '',
        })
      : await botAnalyzeFixtureDefault(request,cfg,userId,fixtureId);
    const analyzedMatch=normalizeBotFixtureCard(data.match || match);
    await rememberBotFixtureCards([analyzedMatch],cfg);
    void recordGrowthEvent(cfg,{userId,eventName:'quick_ai',channel:'telegram',fixtureId,attribution:options.attribution || null,metadata:{section:'handoff',cached:Boolean(data.cached),source:options.source || 'match_select'}});
    if (options.newsImpactDelta) {
      const decision=newsImpactDecisionCard(data?.newsImpact || null);
      void recordGrowthEvent(cfg,{userId,eventName:'news_impact_delta',channel:'telegram',fixtureId,metadata:{
        compared:Boolean(data?.newsImpact?.compared),
        material:Boolean(data?.newsImpact?.material),
        stable:Boolean(data?.newsImpact?.stable),
        reason:String(data?.newsImpact?.reasonCode || '').slice(0,32),
        decision:String(decision?.code || '').slice(0,24),
        changeCount:Number(data?.newsImpact?.items?.length || 0),
      }});
    }
    if (options.attribution) {
      void recordGrowthEvent(cfg,{userId,eventName:'ai_handoff',channel:'telegram',fixtureId,attribution:options.attribution,metadata:{cached:Boolean(data.cached),source:options.source || 'deep_link'}});
    } else {
      void recordGrowthEvent(cfg,{userId,eventName:'ai_handoff',channel:'telegram',fixtureId,metadata:{cached:Boolean(data.cached),source:'match_select'}});
    }
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      parse_mode:'HTML',
      text:botAiHandoffText(data),
      reply_markup:options.newsImpactDelta
        ? newsImpactDecisionKeyboard(request,analyzedMatch,favorites,data?.newsImpact || null)
        : footballQuickAiHandoffKeyboard(request,analyzedMatch,favorites),
    });
  } catch (error) {
    const status=Number(error?.status || 0);
    const message=status===429
      ? 'Короткий AI-разбор сейчас недоступен из-за лимита. Матч выбран — можно повторить позже.'
      : status===409
        ? 'Данные матча сейчас противоречивы, поэтому AI временно не строит вывод.'
        : error?.message || 'Не удалось собрать короткую AI-оценку.';
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      parse_mode:'HTML',
      text:`⚠️ ${telegramHtmlEscape(message)}\n\n${botFixtureCardText(match,{aiReady:false})}`,
      reply_markup:footballMatchActionKeyboard(request,match,'',favorites),
    });
  }
}
async function botAnalyzeFixture(request, cfg, userId, fixtureId, options = {}) {
  const inner = options.newsImpactRecheck
    ? new Request(request.url, {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          fixtureId:Number(fixtureId),
          origin:'telegram_quick',
          recheck:true,
          newsImpactRecheck:true,
          newsPublishedAt:String(options.newsPublishedAt || '').slice(0,40),
        }),
      })
    : new Request(request.url, {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({fixtureId:Number(fixtureId),origin:'telegram_quick',recheck:true}),
      });
  const response = await apiAnalyze(inner, cfg, { id:Number(userId) });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload?.error || 'Не удалось получить AI-разбор матча.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function botAiVerdictText(data = {}) {
  const match = data.match || {};
  const ai = data.aiInstructor || {};
  const signal = ai.betSignal || {};
  const verdict = ai.verdict || {};
  const trust = ai.dataTrust || {};
  const referee = ai.refereeHistory?.available
    ? `${ai.refereeHistory.name || ai.refereeProfile?.name || match.referee || 'Судья'} · ${ai.refereeHistory.styleLabel} · ${ai.refereeHistory.avgYellow} жёлт./матч`
    : ai.refereeProfile?.name || ai.referee || match.referee || 'ещё не назначен';
  const skip = signal.code === 'skip';
  const headline = skip ? '⛔ <b>Лучше пропустить</b>' : '🧠 <b>AI-вердикт</b>';
  const confidence = Number.isFinite(Number(ai.confidenceScore)) ? `${Math.round(Number(ai.confidenceScore))}/100` : '—';
  const trustScore = Number.isFinite(Number(trust.score)) ? `${Math.round(Number(trust.score))}%` : '—';
  return [
    headline,
    `<b>${telegramHtmlEscape(match.home?.name || 'Хозяева')} — ${telegramHtmlEscape(match.away?.name || 'Гости')}</b>`,
    '',
    `🎯 Идея: <b>${telegramHtmlEscape(signal.label || 'Нет выраженного сигнала')}</b>`,
    `📊 Исход: ${telegramHtmlEscape(verdict.outcome || '—')}`,
    `⚽ Тотал: ${telegramHtmlEscape(verdict.total || '—')}`,
    `🥅 Обе забьют: ${telegramHtmlEscape(verdict.btts || '—')}`,
    `🧠 Уверенность: <b>${telegramHtmlEscape(ai.confidenceLabel || '—')}</b> · ${confidence}`,
    `🗂 Качество данных: <b>${telegramHtmlEscape(trust.label || '—')}</b> · ${trustScore}`,
    `⚠️ Риск: <b>${telegramHtmlEscape(ai.riskLabel || '—')}</b>`,
    `🧑‍⚖️ Судья: ${telegramHtmlEscape(referee)}`,
    '',
    `Почему: ${telegramHtmlEscape(signal.reason || ai.riskNote || 'Оцениваю доступные данные матча.')}`,
    skip ? 'Сильного перевеса нет — не нужно искать ставку любой ценой.' : 'Перед стартом ещё раз проверьте составы и движение рынка.',
    '',
    '<i>AI-сигнал основан на доступных данных и не гарантирует результат.</i>',
  ].join('\n');
}

function newsImpactDecisionCard(newsImpact = {}) {
  if (!newsImpact?.requested) return null;
  const reason=String(newsImpact.reasonCode || '');
  if (newsImpact.compared && newsImpact.material) return {
    code:'material',icon:'🔴',label:'Существенное изменение',
    headline:'После новости свежая проверка обнаружила заметный сдвиг во входных данных AI.',
    action:'Открыть полный разбор и проверить обновлённый сценарий матча.',priority:4,
  };
  if (newsImpact.compared && newsImpact.stable) return {
    code:'stable',icon:'🟢',label:'Сценарий стабилен',
    headline:'После новости значимых изменений в AI-входах не найдено.',
    action:'Срочного действия нет; продолжайте следить за составами и рынком.',priority:1,
  };
  if (newsImpact.compared) return {
    code:'detail',icon:'🟡',label:'Изменились детали',
    headline:'Изменились отдельные данные, но основной AI-сценарий не сдвинулся существенно.',
    action:'Проверить изменившиеся блоки перед стартом матча.',priority:2,
  };
  if (reason==='snapshot_not_before_news') return {
    code:'guarded',icon:'🟦',label:'Причинность не подтверждается',
    headline:'Сохранённый AI-снимок не был сделан до новости, поэтому сравнение «до/после» нельзя трактовать как влияние новости.',
    action:'Текущий анализ станет новой базовой точкой.',priority:0,
  };
  if (reason==='baseline_missing') return {
    code:'baseline_missing',icon:'⚪',label:'Нет базового снимка',
    headline:'До новости не было сохранённого анализа для честного сравнения.',
    action:'Текущий анализ станет базой для следующей News Impact проверки.',priority:0,
  };
  return {
    code:'unavailable',icon:'🟠',label:'Перепроверка недоступна',
    headline:'Новость связана с матчем, но сравнительный расчёт сейчас не завершён.',
    action:'Повторить обновление AI позже.',priority:0,
  };
}

const NEWS_IMPACT_DECISION_CODES = new Set(['material','detail','stable','guarded','baseline_missing','unavailable']);
const NEWS_IMPACT_ACTION_CODES = new Set(['full_ai','squads','market','recheck','news','share']);

function cleanNewsImpactDecisionCode(value = '') {
  const code=String(value || '').toLowerCase().trim();
  return NEWS_IMPACT_DECISION_CODES.has(code) ? code : '';
}

function cleanNewsImpactActionCode(value = '') {
  const code=String(value || '').toLowerCase().trim();
  return NEWS_IMPACT_ACTION_CODES.has(code) ? code : '';
}

function newsImpactActionCallback(decision, action, fixtureId) {
  const d=cleanNewsImpactDecisionCode(decision);
  const a=cleanNewsImpactActionCode(action);
  const id=Number(fixtureId || 0);
  return d && a && Number.isSafeInteger(id) && id>0 ? `news:impact:${d}:${a}:${id}` : '';
}

function newsImpactTrackedAnalysisUrl(request, fixtureId, decision) {
  const d=cleanNewsImpactDecisionCode(decision);
  return telegramWebAppUrl(request,{
    ...telegramAnalysisHandoffParams(fixtureId,'brief'),
    ...(d ? {newsImpactDecision:d,newsImpactAction:'full_ai'} : {}),
  });
}

function cleanNewsImpactRecoveryCode(value = '') {
  const code=String(value || '').toLowerCase().trim();
  return NEWS_IMPACT_RECOVERY_CODES.has(code) ? code : '';
}

function newsImpactRecoveryCallback(decision, action, recovery, fixtureId) {
  const d=cleanNewsImpactDecisionCode(decision);
  const a=cleanNewsImpactActionCode(action);
  const r=cleanNewsImpactRecoveryCode(recovery);
  const id=Number(fixtureId || 0);
  return d && a && r && Number.isSafeInteger(id) && id>0 ? `ni:r:${d}:${a}:${r}:${id}` : '';
}

function newsImpactRecoveryAnalysisUrl(request, fixtureId, decision, sourceAction = '', recovery = 'open_full_ai') {
  const d=cleanNewsImpactDecisionCode(decision);
  const source=cleanNewsImpactActionCode(sourceAction);
  const r=cleanNewsImpactRecoveryCode(recovery) || 'open_full_ai';
  return telegramWebAppUrl(request,{
    ...telegramAnalysisHandoffParams(fixtureId,'brief'),
    ...(d ? {newsImpactDecision:d,newsImpactAction:'full_ai'} : {}),
    newsImpactRecoveryCode:r,
    ...(source ? {newsImpactRecoveryFrom:source} : {}),
  });
}

function newsImpactActionDrill() {
  const callback=newsImpactActionCallback('material','market',12345);
  return {
    pass:callback==='news:impact:material:market:12345'
      && cleanNewsImpactDecisionCode('stable')==='stable'
      && cleanNewsImpactDecisionCode('other')===''
      && cleanNewsImpactActionCode('full_ai')==='full_ai'
      && cleanNewsImpactActionCode('raw_text')==='',
    cases:5,
  };
}

const NEWS_IMPACT_FUNNEL_DECISIONS = [
  ['material','🔴 Существенное изменение'],
  ['detail','🟡 Изменились детали'],
  ['stable','🟢 Сценарий стабилен'],
  ['guarded','🟦 Причинность не подтверждается'],
  ['baseline_missing','⚪ Нет базового снимка'],
  ['unavailable','🟠 Перепроверка недоступна'],
];

const NEWS_IMPACT_ACTION_LABELS = {
  full_ai:'Полный AI',
  squads:'Составы',
  market:'Рынок',
  recheck:'Перепроверка',
  news:'Новости',
  share:'Поделиться',
};

function newsImpactRowDecision(row = {}) {
  return cleanNewsImpactDecisionCode(row?.metadata && typeof row.metadata==='object' ? row.metadata.decision : '');
}

function newsImpactRowAction(row = {}) {
  return cleanNewsImpactActionCode(row?.metadata && typeof row.metadata==='object' ? row.metadata.action : '');
}

const NEWS_IMPACT_FUNNEL_MIN_USERS = 10;
const NEWS_IMPACT_FUNNEL_STABLE_USERS = 30;

function newsImpactConversionConfidence(actedUsers = 0, users = 0) {
  const n=Math.max(0,Math.trunc(Number(users || 0)));
  const k=Math.min(n,Math.max(0,Math.trunc(Number(actedUsers || 0))));
  if (!n) return {
    status:'empty',label:'нет данных',users:0,actedUsers:0,
    lowerPct:0,upperPct:0,eligibleForBottleneck:false,stable:false,
  };
  const z=1.96;
  const p=k/n;
  const denominator=1+(z*z/n);
  const center=(p+(z*z/(2*n)))/denominator;
  const margin=(z*Math.sqrt((p*(1-p)+(z*z/(4*n)))/n))/denominator;
  const lowerPct=Math.round(Math.max(0,center-margin)*1000)/10;
  const upperPct=Math.round(Math.min(1,center+margin)*1000)/10;
  const status=n>=NEWS_IMPACT_FUNNEL_STABLE_USERS ? 'stable'
    : n>=NEWS_IMPACT_FUNNEL_MIN_USERS ? 'early'
      : 'insufficient';
  const label=status==='stable' ? 'устойчивая выборка'
    : status==='early' ? 'ранний сигнал'
      : 'мало данных';
  return {
    status,label,users:n,actedUsers:k,lowerPct,upperPct,
    eligibleForBottleneck:n>=NEWS_IMPACT_FUNNEL_MIN_USERS,
    stable:n>=NEWS_IMPACT_FUNNEL_STABLE_USERS,
  };
}

const NEWS_IMPACT_ACTION_WINDOW_MINUTES = 30;

function newsImpactEventTime(row = {}) {
  const at=Date.parse(String(row?.created_at || ''));
  return Number.isFinite(at) ? at : NaN;
}

function buildNewsImpactActionFunnel(decisionRows = [], actionRows = [], options = {}) {
  const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
  const actionWindowMinutes=Math.max(1,Math.min(180,Number(options?.actionWindowMinutes || NEWS_IMPACT_ACTION_WINDOW_MINUTES)));
  const actionWindowMs=actionWindowMinutes*60_000;
  const maturityCutoff=asOfMs-actionWindowMs;
  return NEWS_IMPACT_FUNNEL_DECISIONS.map(([code,label])=>{
    const observedDecisionUsers=new Set();
    const decisionTimesByUser=new Map();
    for (const row of decisionRows) {
      if (newsImpactRowDecision(row)!==code) continue;
      const uid=Number(row.telegram_id || 0);
      const decisionAt=newsImpactEventTime(row);
      if (!uid) continue;
      observedDecisionUsers.add(uid);
      if (!Number.isFinite(decisionAt) || decisionAt>maturityCutoff) continue;
      const times=decisionTimesByUser.get(uid) || [];
      times.push(decisionAt);
      decisionTimesByUser.set(uid,times);
    }
    const decisionUsers=new Set(decisionTimesByUser.keys());
    const immatureUsers=[...observedDecisionUsers].filter(uid=>!decisionUsers.has(uid)).length;
    const actionUsersByCode={};
    for (const action of NEWS_IMPACT_ACTION_CODES) actionUsersByCode[action]=new Set();
    for (const row of actionRows) {
      if (newsImpactRowDecision(row)!==code) continue;
      const uid=Number(row.telegram_id || 0);
      const action=newsImpactRowAction(row);
      const actionAt=newsImpactEventTime(row);
      if (!uid || !action || !decisionUsers.has(uid) || !Number.isFinite(actionAt)) continue;
      const decisionTimes=decisionTimesByUser.get(uid) || [];
      const attributed=decisionTimes.some(decisionAt=>actionAt>=decisionAt && actionAt<=decisionAt+actionWindowMs);
      if (!attributed) continue;
      actionUsersByCode[action].add(uid);
    }
    const actedUsers=new Set();
    for (const set of Object.values(actionUsersByCode)) for (const uid of set) actedUsers.add(uid);
    const actionBreakdown=Object.entries(actionUsersByCode)
      .map(([action,set])=>({action,label:NEWS_IMPACT_ACTION_LABELS[action] || action,users:set.size}))
      .filter(x=>x.users>0)
      .sort((a,b)=>b.users-a.users || a.action.localeCompare(b.action));
    const users=decisionUsers.size;
    const conversionPct=users ? Math.round((actedUsers.size/users)*1000)/10 : 0;
    const confidence=newsImpactConversionConfidence(actedUsers.size,users);
    return {
      code,label,
      observedUsers:observedDecisionUsers.size,
      users,
      immatureUsers,
      actedUsers:actedUsers.size,
      conversionPct,
      dropPct:users ? Math.max(0,Math.round((100-conversionPct)*10)/10) : 0,
      actionWindowMinutes,
      topAction:actionBreakdown[0] || null,
      actions:actionBreakdown,
      confidence,
    };
  });
}

function newsImpactActionFunnelBottleneck(rows = []) {
  const eligible=(rows || []).filter(x=>Boolean(x?.confidence?.eligibleForBottleneck));
  if (!eligible.length) return null;
  return [...eligible].sort((a,b)=>Number(a.conversionPct || 0)-Number(b.conversionPct || 0) || Number(b.users || 0)-Number(a.users || 0))[0] || null;
}

function newsImpactActionFunnelDrill() {
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');
  const matureAt='2026-09-23T10:00:00Z';
  const actionsAt='2026-09-23T10:10:00Z';
  const decisions=[
    ...Array.from({length:10},(_,i)=>({telegram_id:i+1,created_at:matureAt,metadata:{decision:'material'}})),
    ...Array.from({length:30},(_,i)=>({telegram_id:i+11,created_at:matureAt,metadata:{decision:'stable'}})),
  ];
  const actions=[
    ...Array.from({length:5},(_,i)=>({telegram_id:i+1,created_at:actionsAt,metadata:{decision:'material',action:'market'}})),
    ...Array.from({length:30},(_,i)=>({telegram_id:i+11,created_at:actionsAt,metadata:{decision:'stable',action:'full_ai'}})),
    {telegram_id:999,created_at:actionsAt,metadata:{decision:'material',action:'share'}},
  ];
  const rows=buildNewsImpactActionFunnel(decisions,actions,{asOfMs});
  const material=rows.find(x=>x.code==='material');
  const stable=rows.find(x=>x.code==='stable');
  const bottleneck=newsImpactActionFunnelBottleneck(rows);
  return {
    pass:material?.users===10
      && material?.actedUsers===5
      && material?.conversionPct===50
      && material?.topAction?.action==='market'
      && material?.confidence?.status==='early'
      && stable?.conversionPct===100
      && stable?.confidence?.status==='stable'
      && bottleneck?.code==='material',
    cases:8,
  };
}

function newsImpactTemporalAttributionDrill() {
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');
  const decisions=[
    {telegram_id:1,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material'}},
    {telegram_id:2,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material'}},
    {telegram_id:3,created_at:'2026-09-23T11:50:00Z',metadata:{decision:'material'}},
  ];
  const actions=[
    {telegram_id:1,created_at:'2026-09-23T09:59:00Z',metadata:{decision:'material',action:'market'}},
    {telegram_id:1,created_at:'2026-09-23T10:10:00Z',metadata:{decision:'material',action:'market'}},
    {telegram_id:2,created_at:'2026-09-23T10:45:00Z',metadata:{decision:'material',action:'full_ai'}},
    {telegram_id:3,created_at:'2026-09-23T11:55:00Z',metadata:{decision:'material',action:'share'}},
  ];
  const row=buildNewsImpactActionFunnel(decisions,actions,{asOfMs}).find(x=>x.code==='material');
  return {
    pass:row?.observedUsers===3
      && row?.users===2
      && row?.immatureUsers===1
      && row?.actedUsers===1
      && row?.market===undefined
      && row?.topAction?.action==='market'
      && row?.actionWindowMinutes===30,
    cases:7,
  };
}

const NEWS_IMPACT_OUTCOME_WINDOW_MINUTES = 5;

const NEWS_IMPACT_OUTCOME_CODES = {
  full_ai:'analysis_delivered',
  squads:'section_delivered',
  market:'section_delivered',
  recheck:'recheck_delivered',
  news:'news_delivered',
  share:'share_card_delivered',
};

function newsImpactOutcomeCode(action = '') {
  return NEWS_IMPACT_OUTCOME_CODES[cleanNewsImpactActionCode(action)] || '';
}

async function recordNewsImpactOutcome(cfg,{
  userId,
  fixtureId,
  decision,
  action,
  channel='telegram',
  delivery='',
}={}) {
  const safeDecision=cleanNewsImpactDecisionCode(decision);
  const safeAction=cleanNewsImpactActionCode(action);
  const outcome=newsImpactOutcomeCode(safeAction);
  if (!safeDecision || !safeAction || !outcome) return false;
  return await recordGrowthEvent(cfg,{
    userId,
    eventName:'news_impact_outcome',
    channel,
    fixtureId,
    metadata:{
      decision:safeDecision,
      action:safeAction,
      outcome,
      ...(delivery ? {delivery:String(delivery).slice(0,24)} : {}),
    },
  });
}

function newsImpactJourneyKey(row = {}) {
  const uid=Number(row.telegram_id || 0);
  const fixtureId=Number(row.fixture_id || 0);
  const decision=newsImpactRowDecision(row);
  const action=newsImpactRowAction(row);
  return uid && fixtureId && decision && action ? `${uid}|${fixtureId}|${decision}|${action}` : '';
}

function buildNewsImpactActionOutcomeQuality(actionRows = [], outcomeRows = [], options = {}) {
  const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
  const outcomeWindowMinutes=Math.max(1,Math.min(30,Number(options?.outcomeWindowMinutes || NEWS_IMPACT_OUTCOME_WINDOW_MINUTES)));
  const outcomeWindowMs=outcomeWindowMinutes*60_000;
  const actionByKey=new Map();
  for (const row of actionRows || []) {
    const key=newsImpactJourneyKey(row);
    const actionAt=newsImpactEventTime(row);
    if (!key || !Number.isFinite(actionAt)) continue;
    const existing=actionByKey.get(key);
    if (!existing || actionAt<existing.actionAt) actionByKey.set(key,{row,actionAt});
  }
  const confirmed=new Set();
  const outcomeCodesByKey=new Map();
  for (const row of outcomeRows || []) {
    const key=newsImpactJourneyKey(row);
    const outcomeAt=newsImpactEventTime(row);
    const action=actionByKey.get(key);
    if (!key || !action || !Number.isFinite(outcomeAt)) continue;
    if (outcomeAt<action.actionAt || outcomeAt>action.actionAt+outcomeWindowMs) continue;
    confirmed.add(key);
    const code=String(row?.metadata && typeof row.metadata==='object' ? row.metadata.outcome || '' : '').slice(0,32);
    if (code) outcomeCodesByKey.set(key,code);
  }
  return [...NEWS_IMPACT_ACTION_CODES].map(actionCode=>{
    const observed=[...actionByKey.entries()].filter(([,value])=>newsImpactRowAction(value.row)===actionCode);
    const eligible=observed.filter(([key,value])=>confirmed.has(key) || value.actionAt<=asOfMs-outcomeWindowMs);
    const confirmedKeys=eligible.filter(([key])=>confirmed.has(key)).map(([key])=>key);
    const attempts=eligible.length;
    const confirmedOutcomes=confirmedKeys.length;
    const pending=Math.max(0,observed.length-attempts);
    const completionPct=attempts ? Math.round((confirmedOutcomes/attempts)*1000)/10 : 0;
    const confidence=newsImpactConversionConfidence(confirmedOutcomes,attempts);
    const outcomes={};
    for (const key of confirmedKeys) {
      const code=outcomeCodesByKey.get(key) || newsImpactOutcomeCode(actionCode);
      outcomes[code]=(outcomes[code] || 0)+1;
    }
    return {
      action:actionCode,
      label:NEWS_IMPACT_ACTION_LABELS[actionCode] || actionCode,
      observed:observed.length,
      attempts,
      pending,
      confirmed:confirmedOutcomes,
      completionPct,
      confidence,
      outcomes,
    };
  });
}

function newsImpactOutcomeBottleneck(rows = []) {
  const eligible=(rows || []).filter(x=>Boolean(x?.confidence?.eligibleForBottleneck));
  if (!eligible.length) return null;
  return [...eligible].sort((a,b)=>Number(a.completionPct || 0)-Number(b.completionPct || 0) || Number(b.attempts || 0)-Number(a.attempts || 0))[0] || null;
}

function newsImpactOutcomeQualityDrill() {
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');
  const actions=[
    ...Array.from({length:10},(_,i)=>({telegram_id:i+1,fixture_id:100+i,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material',action:'full_ai'}})),
    {telegram_id:50,fixture_id:500,created_at:'2026-09-23T11:58:00Z',metadata:{decision:'stable',action:'share'}},
  ];
  const outcomes=[
    ...Array.from({length:8},(_,i)=>({telegram_id:i+1,fixture_id:100+i,created_at:'2026-09-23T10:01:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}})),
    {telegram_id:9,fixture_id:108,created_at:'2026-09-23T09:59:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}},
    {telegram_id:10,fixture_id:109,created_at:'2026-09-23T10:08:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}},
    {telegram_id:50,fixture_id:500,created_at:'2026-09-23T11:59:00Z',metadata:{decision:'stable',action:'share',outcome:'share_card_delivered'}},
  ];
  const quality=buildNewsImpactActionOutcomeQuality(actions,outcomes,{asOfMs});
  const fullAi=quality.find(x=>x.action==='full_ai');
  const share=quality.find(x=>x.action==='share');
  return {
    pass:fullAi?.attempts===10
      && fullAi?.confirmed===8
      && fullAi?.completionPct===80
      && fullAi?.confidence?.status==='early'
      && share?.attempts===1
      && share?.confirmed===1
      && share?.pending===0
      && newsImpactOutcomeBottleneck(quality)?.action==='full_ai',
    cases:8,
  };
}

const NEWS_IMPACT_FAILURE_CODES = new Set([
  'provider_rate_limit','provider_unavailable','quota_exhausted','analysis_warming',
  'match_missing','invalid_fixture','data_invalid','telegram_delivery','timeout','server_error',
]);
const NEWS_IMPACT_RECOVERY_CODES = new Set([
  'retry','retry_soon','retry_later','wait_quota_reset','open_search','open_full_ai',
]);
const NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES = new Set([
  'fixed_default','baseline_sample','no_significant_better','significant_better',
  'stability_sample','recent_regression','stable_significant_better','performance_drift',
  'supabase_unavailable','truncated','load_failed','evidence_unavailable',
]);
const NEWS_IMPACT_FAILURE_LABELS = {
  provider_rate_limit:'Лимит источника данных',
  provider_unavailable:'Источник данных недоступен',
  quota_exhausted:'Дневной лимит AI',
  analysis_warming:'AI уже рассчитывается',
  match_missing:'Матч недоступен',
  invalid_fixture:'Некорректный матч',
  data_invalid:'Данные матча противоречивы',
  telegram_delivery:'Доставка в Telegram',
  timeout:'Тайм-аут',
  server_error:'Временная серверная ошибка',
};
const NEWS_IMPACT_RECOVERY_LABELS = {
  retry:'повторить',
  retry_soon:'повторить через несколько секунд',
  retry_later:'повторить позже',
  wait_quota_reset:'дождаться обновления лимита',
  open_search:'вернуться к поиску',
  open_full_ai:'открыть полный AI',
};

function newsImpactFailureCode(error = null, fallback = 'server_error') {
  const status=Number(error?.status || error?.statusCode || error?.payload?.status || 0);
  const code=String(error?.code || error?.payload?.code || '').toLowerCase();
  const message=String(error?.message || error?.payload?.error || '').toLowerCase();
  const text=`${code} ${message}`;
  if (isFootballRateLimitError(error) || /football.*(?:rate|limit)|provider.*(?:rate|limit)/.test(text)) return 'provider_rate_limit';
  if (/provider|api-football|upstream/.test(text) && /unavailable|failed|error|503|502/.test(text)) return 'provider_unavailable';
  if (/analysis_warming|warming|already.*calculat|уже рассчитывается/.test(text)) return 'analysis_warming';
  if (status===408 || /timeout|timed out|тайм-аут/.test(text)) return 'timeout';
  if (/match_data_invalid|data_invalid|противоречив/.test(text) || status===409) return 'data_invalid';
  if (/invalid.*fixture|некорректн.*матч/.test(text)) return 'invalid_fixture';
  if (/match.*not.*found|матч не найден|fixture.*not.*found/.test(text) || status===404) return 'match_missing';
  if (status===429) return 'quota_exhausted';
  if (/telegram/.test(text) || ([400,403].includes(status) && fallback==='telegram_delivery')) return 'telegram_delivery';
  return NEWS_IMPACT_FAILURE_CODES.has(String(fallback || '')) ? String(fallback) : 'server_error';
}

function newsImpactRecoveryForFailure(reason = 'server_error', action = '') {
  const code=NEWS_IMPACT_FAILURE_CODES.has(String(reason || '')) ? String(reason) : 'server_error';
  const safeAction=cleanNewsImpactActionCode(action);
  if (code==='quota_exhausted') return {code:'wait_quota_reset',action:'wait',message:'Дневной лимит AI исчерпан. Повторите после обновления лимита.'};
  if (code==='provider_rate_limit') return {code:'retry_later',action:'retry',message:'Источник футбольных данных временно ограничил запросы. Повторите позже.'};
  if (code==='provider_unavailable') return {code:'retry_later',action:'retry',message:'Источник данных временно недоступен. Попробуйте позже.'};
  if (code==='analysis_warming') return {code:'retry_soon',action:'retry',message:'AI-разбор уже рассчитывается. Повторите через несколько секунд.'};
  if (code==='match_missing' || code==='invalid_fixture') return {code:'open_search',action:'search',message:'Этот матч сейчас недоступен. Вернитесь к поиску и выберите актуальный матч.'};
  if (code==='data_invalid') return {code:'retry_later',action:'retry',message:'Данные матча сейчас противоречивы. Анализ безопаснее повторить позже.'};
  if (code==='timeout') return {code:'retry_soon',action:'retry',message:'Ответ занял слишком много времени. Повторите запрос.'};
  if (code==='telegram_delivery') return {code:safeAction==='full_ai'?'open_full_ai':'retry',action:safeAction==='full_ai'?'open_full_ai':'retry',message:'Не удалось доставить результат в Telegram. Можно повторить действие или открыть полный AI.'};
  return {code:'retry',action:'retry',message:'Результат временно не доставлен. Повторите действие.'};
}

async function recordNewsImpactFailure(cfg,{
  userId,
  fixtureId,
  decision,
  action,
  channel='telegram',
  reason='server_error',
  recovery='',
  strategy='fixed',
  strategyReason='',
  status=0,
}={}) {
  const safeDecision=cleanNewsImpactDecisionCode(decision);
  const safeAction=cleanNewsImpactActionCode(action);
  const safeReason=NEWS_IMPACT_FAILURE_CODES.has(String(reason || '')) ? String(reason) : 'server_error';
  const recommended=newsImpactRecoveryForFailure(safeReason,safeAction);
  const safeRecovery=NEWS_IMPACT_RECOVERY_CODES.has(String(recovery || '')) ? String(recovery) : recommended.code;
  const safeStrategy=String(strategy || '')==='adaptive' ? 'adaptive' : 'fixed';
  const safeStrategyReason=NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES.has(String(strategyReason || ''))
    ? String(strategyReason)
    : '';
  if (!safeDecision || !safeAction) return false;
  return await recordGrowthEvent(cfg,{
    userId,
    eventName:'news_impact_outcome_failure',
    channel,
    fixtureId,
    metadata:{
      decision:safeDecision,
      action:safeAction,
      reason:safeReason,
      recovery:safeRecovery,
      strategy:safeStrategy,
      ...(safeStrategyReason ? {strategy_guard:safeStrategyReason} : {}),
      ...(Number(status || 0)>0 ? {status:Number(status)} : {}),
    },
  });
}

function buildNewsImpactFailureDiagnostics(rows = []) {
  const byReason=new Map();
  for (const row of rows || []) {
    const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
    const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : 'server_error';
    const action=cleanNewsImpactActionCode(meta.action);
    const recovery=NEWS_IMPACT_RECOVERY_CODES.has(String(meta.recovery || '')) ? String(meta.recovery) : newsImpactRecoveryForFailure(reason,action).code;
    const bucket=byReason.get(reason) || {
      reason,label:NEWS_IMPACT_FAILURE_LABELS[reason] || reason,events:0,users:new Set(),actions:{},recoveries:{},
    };
    bucket.events+=1;
    const uid=Number(row.telegram_id || 0);
    if (uid) bucket.users.add(uid);
    if (action) bucket.actions[action]=(bucket.actions[action] || 0)+1;
    if (recovery) bucket.recoveries[recovery]=(bucket.recoveries[recovery] || 0)+1;
    byReason.set(reason,bucket);
  }
  return [...byReason.values()].map(x=>({
    reason:x.reason,label:x.label,events:x.events,users:x.users.size,
    actions:Object.entries(x.actions).map(([action,count])=>({action,label:NEWS_IMPACT_ACTION_LABELS[action] || action,count})).sort((a,b)=>b.count-a.count || a.action.localeCompare(b.action)),
    recoveries:Object.entries(x.recoveries).map(([recovery,count])=>({recovery,label:NEWS_IMPACT_RECOVERY_LABELS[recovery] || recovery,count})).sort((a,b)=>b.count-a.count || a.recovery.localeCompare(b.recovery)),
  })).sort((a,b)=>b.events-a.events || a.reason.localeCompare(b.reason));
}

function newsImpactFailureDiagnosticsDrill() {
  const rows=[
    {telegram_id:1,metadata:{decision:'material',action:'full_ai',reason:'provider_rate_limit',recovery:'retry_later'}},
    {telegram_id:2,metadata:{decision:'material',action:'full_ai',reason:'provider_rate_limit',recovery:'retry_later'}},
    {telegram_id:1,metadata:{decision:'stable',action:'share',reason:'telegram_delivery',recovery:'retry'}},
  ];
  const diagnostics=buildNewsImpactFailureDiagnostics(rows);
  const provider=diagnostics.find(x=>x.reason==='provider_rate_limit');
  const telegram=diagnostics.find(x=>x.reason==='telegram_delivery');
  const recovery=newsImpactRecoveryForFailure('analysis_warming','full_ai');
  return {
    pass:provider?.events===2
      && provider?.users===2
      && provider?.actions?.[0]?.action==='full_ai'
      && telegram?.events===1
      && recovery?.code==='retry_soon'
      && newsImpactFailureCode({status:429,code:'ANALYSIS_WARMING'},'server_error')==='analysis_warming',
    cases:6,
  };
}

const NEWS_IMPACT_RECOVERY_WINDOW_MINUTES = 5;
const NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS = 30;
const NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS = 5;
const NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS = 30;
const NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS = 7;
const NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS = 10;
const NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS = 20;
const NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS = 10;
const NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS = 15;
const NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT = 'news_impact_recovery_incident_ack';
const NEWS_IMPACT_RECOVERY_INCIDENT_CODES = new Set(['performance_drift','recent_regression']);
const NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES = 30;
const NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES = 120;
const NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES = 360;
const NEWS_IMPACT_RECOVERY_STRATEGY_CACHE_MS = 300_000;
const NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES = 30;

async function recordNewsImpactRecoveryAttempt(cfg,{
  userId,
  fixtureId,
  decision,
  action,
  recovery,
  sourceAction='',
  channel='telegram',
}={}) {
  const safeDecision=cleanNewsImpactDecisionCode(decision);
  const safeAction=cleanNewsImpactActionCode(action);
  const safeRecovery=cleanNewsImpactRecoveryCode(recovery);
  const safeSource=cleanNewsImpactActionCode(sourceAction);
  if (!safeDecision || !safeAction || !safeRecovery) return false;
  return await recordGrowthEvent(cfg,{
    userId,
    eventName:'news_impact_recovery_attempt',
    channel,
    fixtureId,
    metadata:{
      decision:safeDecision,
      action:safeAction,
      recovery:safeRecovery,
      ...(safeSource ? {sourceAction:safeSource} : {}),
    },
  });
}

function newsImpactRecoveryJourneyKey(row = {}) {
  const base=newsImpactJourneyKey(row);
  const recovery=cleanNewsImpactRecoveryCode(row?.metadata && typeof row.metadata==='object' ? row.metadata.recovery : '');
  return base && recovery ? `${base}|${recovery}` : '';
}

function buildNewsImpactRecoveryEffectiveness(attemptRows = [], outcomeRows = [], failureRows = [], options = {}) {
  const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
  const windowMinutes=Math.max(1,Math.min(30,Number(options?.windowMinutes || NEWS_IMPACT_RECOVERY_WINDOW_MINUTES)));
  const windowMs=windowMinutes*60_000;
  const latestAttempts=new Map();
  for (const row of attemptRows || []) {
    const key=newsImpactRecoveryJourneyKey(row);
    const attemptAt=newsImpactEventTime(row);
    if (!key || !Number.isFinite(attemptAt)) continue;
    const previous=latestAttempts.get(key);
    if (!previous || attemptAt>previous.attemptAt) latestAttempts.set(key,{row,attemptAt});
  }
  const outcomesByJourney=new Map();
  for (const row of outcomeRows || []) {
    const key=newsImpactJourneyKey(row);
    const at=newsImpactEventTime(row);
    if (!key || !Number.isFinite(at)) continue;
    const list=outcomesByJourney.get(key) || [];
    list.push({row,at});
    outcomesByJourney.set(key,list);
  }
  const failuresByJourney=new Map();
  for (const row of failureRows || []) {
    const key=newsImpactJourneyKey(row);
    const at=newsImpactEventTime(row);
    if (!key || !Number.isFinite(at)) continue;
    const list=failuresByJourney.get(key) || [];
    list.push({row,at});
    failuresByJourney.set(key,list);
  }
  const states=[...latestAttempts.values()].map(item=>{
    const journey=newsImpactJourneyKey(item.row);
    const recovery=cleanNewsImpactRecoveryCode(item.row?.metadata?.recovery);
    const after=(list)=>[...(list || [])]
      .filter(event=>event.at>=item.attemptAt && event.at<=item.attemptAt+windowMs)
      .sort((a,b)=>a.at-b.at)[0] || null;
    const outcome=after(outcomesByJourney.get(journey));
    const failure=after(failuresByJourney.get(journey));
    let state='pending';
    let terminalAt=null;
    if (outcome && (!failure || outcome.at<=failure.at)) { state='recovered'; terminalAt=outcome.at; }
    else if (failure) { state='failed'; terminalAt=failure.at; }
    else if (item.attemptAt<=asOfMs-windowMs) state='failed';
    return {row:item.row,recovery,state,attemptAt:item.attemptAt,terminalAt};
  });
  return [...NEWS_IMPACT_RECOVERY_CODES].map(recovery=>{
    const observed=states.filter(x=>x.recovery===recovery);
    const matured=observed.filter(x=>x.state!=='pending');
    const recovered=matured.filter(x=>x.state==='recovered').length;
    const failed=matured.filter(x=>x.state==='failed').length;
    const attempts=matured.length;
    const pending=observed.length-attempts;
    const successPct=attempts ? Math.round((recovered/attempts)*1000)/10 : 0;
    const confidence=newsImpactConversionConfidence(recovered,attempts);
    const actionCounts={};
    for (const item of observed) {
      const action=newsImpactRowAction(item.row);
      if (action) actionCounts[action]=(actionCounts[action] || 0)+1;
    }
    return {
      recovery,
      label:NEWS_IMPACT_RECOVERY_LABELS[recovery] || recovery,
      observed:observed.length,
      attempts,
      pending,
      recovered,
      failed,
      successPct,
      confidence,
      actions:Object.entries(actionCounts).map(([action,count])=>({action,label:NEWS_IMPACT_ACTION_LABELS[action] || action,count})).sort((a,b)=>b.count-a.count || a.action.localeCompare(b.action)),
    };
  });
}

function newsImpactRecoveryBest(rows = []) {
  const eligible=(rows || []).filter(x=>Boolean(x?.confidence?.eligibleForBottleneck));
  if (!eligible.length) return null;
  return [...eligible].sort((a,b)=>Number(b.successPct || 0)-Number(a.successPct || 0) || Number(b.attempts || 0)-Number(a.attempts || 0))[0] || null;
}

function newsImpactRecoveryEffectivenessDrill() {
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');
  const attempts=[
    ...Array.from({length:10},(_,i)=>({telegram_id:i+1,fixture_id:200+i,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material',action:'full_ai',recovery:'retry'}})),
    ...Array.from({length:5},(_,i)=>({telegram_id:30+i,fixture_id:300+i,created_at:'2026-09-23T11:58:00Z',metadata:{decision:'detail',action:'full_ai',recovery:'open_full_ai'}})),
  ];
  const outcomes=[
    ...Array.from({length:7},(_,i)=>({telegram_id:i+1,fixture_id:200+i,created_at:'2026-09-23T10:02:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}})),
    ...Array.from({length:2},(_,i)=>({telegram_id:30+i,fixture_id:300+i,created_at:'2026-09-23T11:59:00Z',metadata:{decision:'detail',action:'full_ai',outcome:'analysis_delivered'}})),
  ];
  const failures=[
    {telegram_id:8,fixture_id:207,created_at:'2026-09-23T10:03:00Z',metadata:{decision:'material',action:'full_ai',reason:'provider_rate_limit',recovery:'retry_later'}},
    {telegram_id:9,fixture_id:208,created_at:'2026-09-23T10:03:00Z',metadata:{decision:'material',action:'full_ai',reason:'server_error',recovery:'retry'}},
  ];
  const rows=buildNewsImpactRecoveryEffectiveness(attempts,outcomes,failures,{asOfMs});
  const retry=rows.find(x=>x.recovery==='retry');
  const fullAi=rows.find(x=>x.recovery==='open_full_ai');
  return {
    pass:retry?.attempts===10
      && retry?.recovered===7
      && retry?.failed===3
      && retry?.successPct===70
      && retry?.confidence?.status==='early'
      && fullAi?.recovered===2
      && fullAi?.pending===3
      && newsImpactRecoveryBest(rows)?.recovery==='retry',
    cases:8,
  };
}

function newsImpactRecoveryPresentation(reason = 'server_error', action = '', recovery = '') {
  const safeReason=NEWS_IMPACT_FAILURE_CODES.has(String(reason || '')) ? String(reason) : 'server_error';
  const safeAction=cleanNewsImpactActionCode(action);
  const fixed=newsImpactRecoveryForFailure(safeReason,safeAction);
  const code=cleanNewsImpactRecoveryCode(recovery) || fixed.code;
  if (code===fixed.code) return {...fixed};
  if (code==='retry') return {code,action:'retry',message:'Повторите действие — по накопленной статистике это сейчас наиболее надёжный вариант.'};
  if (code==='retry_soon') return {code,action:'retry',message:'Повторите действие через несколько секунд.'};
  if (code==='retry_later') return {code,action:'retry',message:'Попробуйте это действие позже.'};
  if (code==='wait_quota_reset') return {code,action:'wait',message:'Дождитесь обновления лимита и повторите действие.'};
  if (code==='open_search') return {code,action:'search',message:'Вернитесь к поиску и выберите актуальный матч.'};
  if (code==='open_full_ai') return {code,action:'open_full_ai',message:'Откройте полный AI-разбор — по накопленной статистике этот fallback доставляет результат надёжнее.'};
  return {...fixed};
}

function buildNewsImpactRecoveryStrategyEvidence(attemptRows = [], outcomeRows = [], failureRows = [], options = {}) {
  const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
  const recoveryWindowMs=Math.max(1,Math.min(30,Number(options?.recoveryWindowMinutes || NEWS_IMPACT_RECOVERY_WINDOW_MINUTES)))*60_000;
  const sourceWindowMs=Math.max(5,Math.min(180,Number(options?.sourceWindowMinutes || NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES)))*60_000;
  const latestAttempts=new Map();
  for (const row of attemptRows || []) {
    const key=newsImpactRecoveryJourneyKey(row);
    const at=newsImpactEventTime(row);
    if (!key || !Number.isFinite(at)) continue;
    const previous=latestAttempts.get(key);
    if (!previous || at>previous.at) latestAttempts.set(key,{row,at});
  }
  const failuresByJourney=new Map();
  for (const row of failureRows || []) {
    const key=newsImpactJourneyKey(row);
    const at=newsImpactEventTime(row);
    if (!key || !Number.isFinite(at)) continue;
    const list=failuresByJourney.get(key) || [];
    list.push({row,at});
    failuresByJourney.set(key,list);
  }
  for (const list of failuresByJourney.values()) list.sort((a,b)=>a.at-b.at);
  const outcomesByJourney=new Map();
  for (const row of outcomeRows || []) {
    const key=newsImpactJourneyKey(row);
    const at=newsImpactEventTime(row);
    if (!key || !Number.isFinite(at)) continue;
    const list=outcomesByJourney.get(key) || [];
    list.push({row,at});
    outcomesByJourney.set(key,list);
  }
  for (const list of outcomesByJourney.values()) list.sort((a,b)=>a.at-b.at);

  const samples=[];
  for (const {row,at:attemptAt} of latestAttempts.values()) {
    const journey=newsImpactJourneyKey(row);
    const recovery=cleanNewsImpactRecoveryCode(row?.metadata?.recovery);
    const action=newsImpactRowAction(row);
    if (!journey || !recovery || !action) continue;
    const priorFailures=(failuresByJourney.get(journey) || []).filter(x=>x.at<=attemptAt && x.at>=attemptAt-sourceWindowMs);
    const sourceFailure=priorFailures[priorFailures.length-1] || null;
    const reason=String(sourceFailure?.row?.metadata?.reason || '');
    if (!NEWS_IMPACT_FAILURE_CODES.has(reason)) continue;
    const nextOutcome=(outcomesByJourney.get(journey) || []).find(x=>x.at>=attemptAt && x.at<=attemptAt+recoveryWindowMs) || null;
    const nextFailure=(failuresByJourney.get(journey) || []).find(x=>x.at>=attemptAt && x.at<=attemptAt+recoveryWindowMs) || null;
    let state='pending';
    if (nextOutcome && (!nextFailure || nextOutcome.at<=nextFailure.at)) state='recovered';
    else if (nextFailure) state='failed';
    else if (attemptAt<=asOfMs-recoveryWindowMs) state='failed';
    samples.push({reason,action,recovery,state});
  }

  const groups=new Map();
  for (const sample of samples) {
    const key=`${sample.reason}|${sample.action}|${sample.recovery}`;
    const bucket=groups.get(key) || {
      reason:sample.reason,
      reasonLabel:NEWS_IMPACT_FAILURE_LABELS[sample.reason] || sample.reason,
      action:sample.action,
      actionLabel:NEWS_IMPACT_ACTION_LABELS[sample.action] || sample.action,
      recovery:sample.recovery,
      recoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[sample.recovery] || sample.recovery,
      observed:0,attempts:0,pending:0,recovered:0,failed:0,
    };
    bucket.observed+=1;
    if (sample.state==='pending') bucket.pending+=1;
    else {
      bucket.attempts+=1;
      if (sample.state==='recovered') bucket.recovered+=1;
      else bucket.failed+=1;
    }
    groups.set(key,bucket);
  }
  return [...groups.values()].map(x=>{
    const successPct=x.attempts ? Math.round((x.recovered/x.attempts)*1000)/10 : 0;
    return {...x,successPct,confidence:newsImpactConversionConfidence(x.recovered,x.attempts)};
  }).sort((a,b)=>a.reason.localeCompare(b.reason) || a.action.localeCompare(b.action) || b.attempts-a.attempts || a.recovery.localeCompare(b.recovery));
}

function newsImpactRecoveryStrategyDecision(reason = 'server_error', action = '', evidenceRows = [], recentEvidenceRows = null) {
  const safeReason=NEWS_IMPACT_FAILURE_CODES.has(String(reason || '')) ? String(reason) : 'server_error';
  const safeAction=cleanNewsImpactActionCode(action);
  const fixed=newsImpactRecoveryForFailure(safeReason,safeAction);
  const relevant=(evidenceRows || []).filter(x=>x.reason===safeReason && x.action===safeAction);
  const baseline=relevant.find(x=>x.recovery===fixed.code) || null;
  const stable=(row)=>Boolean(row)
    && Number(row.attempts || 0)>=NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS
    && row?.confidence?.status==='stable';
  const baseResult={
    reason:safeReason,
    reasonLabel:NEWS_IMPACT_FAILURE_LABELS[safeReason] || safeReason,
    action:safeAction,
    actionLabel:NEWS_IMPACT_ACTION_LABELS[safeAction] || safeAction,
    fixedRecovery:fixed.code,
    fixedRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[fixed.code] || fixed.code,
    selectedRecovery:fixed.code,
    selectedRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[fixed.code] || fixed.code,
    proposedRecovery:'',
    proposedRecoveryLabel:'',
    strategy:'fixed',
    guardReason:'fixed_default',
    stability:'fixed',
    fixedAttempts:Number(baseline?.attempts || 0),
    fixedSuccessPct:Number(baseline?.successPct || 0),
    fixedConfidence:baseline?.confidence || newsImpactConversionConfidence(0,0),
    selectedAttempts:Number(baseline?.attempts || 0),
    selectedSuccessPct:Number(baseline?.successPct || 0),
    selectedConfidence:baseline?.confidence || newsImpactConversionConfidence(0,0),
    liftPctPoints:0,
    recentFixedAttempts:0,
    recentFixedSuccessPct:0,
    recentSelectedAttempts:0,
    recentSelectedSuccessPct:0,
    recentLiftPctPoints:0,
  };
  if (!stable(baseline)) return {...baseResult,guardReason:'baseline_sample'};
  const candidates=relevant
    .filter(x=>x.recovery!==fixed.code && stable(x))
    .map(x=>({...x,liftPctPoints:Math.round((Number(x.successPct || 0)-Number(baseline.successPct || 0))*10)/10}))
    .filter(x=>Number(x.liftPctPoints || 0)>=NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS)
    .filter(x=>Number(x?.confidence?.lowerPct || 0)>Number(baseline?.confidence?.upperPct || 100))
    .sort((a,b)=>Number(b?.confidence?.lowerPct || 0)-Number(a?.confidence?.lowerPct || 0)
      || Number(b.successPct || 0)-Number(a.successPct || 0)
      || Number(b.attempts || 0)-Number(a.attempts || 0));
  const candidate=candidates[0] || null;
  if (!candidate) return {...baseResult,guardReason:'no_significant_better'};
  const adaptiveResult={
    ...baseResult,
    selectedRecovery:candidate.recovery,
    selectedRecoveryLabel:candidate.recoveryLabel || NEWS_IMPACT_RECOVERY_LABELS[candidate.recovery] || candidate.recovery,
    proposedRecovery:candidate.recovery,
    proposedRecoveryLabel:candidate.recoveryLabel || NEWS_IMPACT_RECOVERY_LABELS[candidate.recovery] || candidate.recovery,
    strategy:'adaptive',
    guardReason:'significant_better',
    stability:'legacy_confirmed',
    selectedAttempts:Number(candidate.attempts || 0),
    selectedSuccessPct:Number(candidate.successPct || 0),
    selectedConfidence:candidate.confidence,
    liftPctPoints:Number(candidate.liftPctPoints || 0),
  };
  if (!Array.isArray(recentEvidenceRows)) return adaptiveResult;

  const recentRelevant=recentEvidenceRows.filter(x=>x.reason===safeReason && x.action===safeAction);
  const recentBaseline=recentRelevant.find(x=>x.recovery===fixed.code) || null;
  const recentCandidate=recentRelevant.find(x=>x.recovery===candidate.recovery) || null;
  const recentReady=(row)=>Boolean(row) && Number(row.attempts || 0)>=NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS;
  const proposed={
    ...baseResult,
    proposedRecovery:candidate.recovery,
    proposedRecoveryLabel:candidate.recoveryLabel || NEWS_IMPACT_RECOVERY_LABELS[candidate.recovery] || candidate.recovery,
    liftPctPoints:Number(candidate.liftPctPoints || 0),
    recentFixedAttempts:Number(recentBaseline?.attempts || 0),
    recentFixedSuccessPct:Number(recentBaseline?.successPct || 0),
    recentSelectedAttempts:Number(recentCandidate?.attempts || 0),
    recentSelectedSuccessPct:Number(recentCandidate?.successPct || 0),
  };
  if (!recentReady(recentBaseline) || !recentReady(recentCandidate)) {
    return {...proposed,guardReason:'stability_sample',stability:'insufficient'};
  }
  const recentLiftPctPoints=Math.round((Number(recentCandidate.successPct || 0)-Number(recentBaseline.successPct || 0))*10)/10;
  const recentConfidenceOk=Number(recentCandidate?.confidence?.lowerPct || 0)>=Number(recentBaseline?.confidence?.lowerPct || 0);
  if (recentLiftPctPoints<0 || !recentConfidenceOk) {
    return {...proposed,guardReason:'recent_regression',stability:'regressed',recentLiftPctPoints};
  }
  return {
    ...adaptiveResult,
    guardReason:'stable_significant_better',
    stability:'confirmed',
    recentFixedAttempts:Number(recentBaseline.attempts || 0),
    recentFixedSuccessPct:Number(recentBaseline.successPct || 0),
    recentSelectedAttempts:Number(recentCandidate.attempts || 0),
    recentSelectedSuccessPct:Number(recentCandidate.successPct || 0),
    recentLiftPctPoints,
  };
}
function buildNewsImpactRecoveryStrategyMatrix(evidenceRows = [], recentEvidenceRows = null) {
  const keys=new Set((evidenceRows || []).map(x=>`${x.reason}|${x.action}`));
  return [...keys].map(key=>{
    const [reason,action]=key.split('|');
    return newsImpactRecoveryStrategyDecision(reason,action,evidenceRows,recentEvidenceRows);
  }).sort((a,b)=>(a.strategy==='adaptive'?0:1)-(b.strategy==='adaptive'?0:1)
    || b.liftPctPoints-a.liftPctPoints
    || a.reason.localeCompare(b.reason)
    || a.action.localeCompare(b.action));
}

function newsImpactRecoveryDriftDecision(decision = null, priorEvidenceRows = [], recentEvidenceRows = []) {
  if (!decision || typeof decision!=='object') return decision;
  const base={
    ...decision,
    driftStatus:'not_applicable',
    driftDetected:false,
    driftDropPctPoints:0,
    priorSelectedAttempts:0,
    priorSelectedSuccessPct:0,
    recentDriftAttempts:0,
    recentDriftSuccessPct:0,
  };
  if (decision.strategy!=='adaptive' || !decision.selectedRecovery) return base;
  const prior=(priorEvidenceRows || []).find(x=>x.reason===decision.reason && x.action===decision.action && x.recovery===decision.selectedRecovery) || null;
  const recent=(recentEvidenceRows || []).find(x=>x.reason===decision.reason && x.action===decision.action && x.recovery===decision.selectedRecovery) || null;
  const priorAttempts=Number(prior?.attempts || 0);
  const recentAttempts=Number(recent?.attempts || 0);
  const snapshot={
    ...base,
    driftStatus:'insufficient',
    priorSelectedAttempts:priorAttempts,
    priorSelectedSuccessPct:Number(prior?.successPct || 0),
    recentDriftAttempts:recentAttempts,
    recentDriftSuccessPct:Number(recent?.successPct || 0),
  };
  if (priorAttempts<NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS || recentAttempts<NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS) {
    return snapshot;
  }
  const dropPctPoints=Math.round((Number(prior.successPct || 0)-Number(recent.successPct || 0))*10)/10;
  const confidenceSeparated=Number(recent?.confidence?.upperPct || 100)<Number(prior?.confidence?.lowerPct || 0);
  if (dropPctPoints>=NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS && confidenceSeparated) {
    return {
      ...snapshot,
      selectedRecovery:decision.fixedRecovery,
      selectedRecoveryLabel:decision.fixedRecoveryLabel,
      strategy:'fixed',
      guardReason:'performance_drift',
      stability:'drift_blocked',
      driftStatus:'blocked',
      driftDetected:true,
      driftDropPctPoints:dropPctPoints,
      selectedAttempts:Number(decision.fixedAttempts || 0),
      selectedSuccessPct:Number(decision.fixedSuccessPct || 0),
      selectedConfidence:decision.fixedConfidence,
    };
  }
  return {...snapshot,driftStatus:'stable',driftDropPctPoints:Math.max(0,dropPctPoints)};
}

function buildNewsImpactRecoveryDriftMatrix(strategyRows = [], priorEvidenceRows = [], recentEvidenceRows = []) {
  return (strategyRows || []).map(row=>newsImpactRecoveryDriftDecision(row,priorEvidenceRows,recentEvidenceRows))
    .sort((a,b)=>(a.strategy==='adaptive'?0:1)-(b.strategy==='adaptive'?0:1)
      || (a.driftDetected?0:1)-(b.driftDetected?0:1)
      || Number(b.liftPctPoints || 0)-Number(a.liftPctPoints || 0)
      || String(a.reason || '').localeCompare(String(b.reason || ''))
      || String(a.action || '').localeCompare(String(b.action || '')));
}


function buildNewsImpactRecoveryTransitionHistory(failureRows = [], {limit = 20} = {}) {
  const ordered=[...(failureRows || [])]
    .map(row=>({row,at:newsImpactEventTime(row)}))
    .filter(x=>Number.isFinite(x.at))
    .sort((a,b)=>a.at-b.at);
  const state=new Map();
  const transitions=[];
  for (const item of ordered) {
    const row=item.row;
    const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
    const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : 'server_error';
    const action=cleanNewsImpactActionCode(meta.action);
    if (!action) continue;
    const fixed=newsImpactRecoveryForFailure(reason,action);
    const recovery=NEWS_IMPACT_RECOVERY_CODES.has(String(meta.recovery || '')) ? String(meta.recovery) : fixed.code;
    const strategy=String(meta.strategy || '')==='adaptive' ? 'adaptive' : 'fixed';
    const guardReason=NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES.has(String(meta.strategy_guard || ''))
      ? String(meta.strategy_guard)
      : '';
    const key=`${reason}|${action}`;
    const current={strategy,recovery,guardReason,at:item.at};
    const previous=state.get(key) || null;
    if (previous && (previous.strategy!==strategy || previous.recovery!==recovery)) {
      transitions.push({
        at:new Date(item.at).toISOString(),
        reason,
        reasonLabel:NEWS_IMPACT_FAILURE_LABELS[reason] || reason,
        action,
        actionLabel:NEWS_IMPACT_ACTION_LABELS[action] || action,
        fromStrategy:previous.strategy,
        fromRecovery:previous.recovery,
        fromRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[previous.recovery] || previous.recovery,
        toStrategy:strategy,
        toRecovery:recovery,
        toRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[recovery] || recovery,
        guardReason,
      });
    }
    state.set(key,current);
  }
  return transitions
    .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
    .slice(0,Math.max(1,Math.min(50,Number(limit || 20))));
}

function summarizeNewsImpactRecoveryTransitions(rows = []) {
  const list=Array.isArray(rows) ? rows : [];
  return {
    total:list.length,
    fixedToAdaptive:list.filter(x=>x.fromStrategy==='fixed' && x.toStrategy==='adaptive').length,
    adaptiveToFixed:list.filter(x=>x.fromStrategy==='adaptive' && x.toStrategy==='fixed').length,
    recoveryChanged:list.filter(x=>x.fromRecovery!==x.toRecovery).length,
    last:list[0] || null,
  };
}

function buildNewsImpactRecoveryAdminAlerts(strategyRows = [], evidenceReason = 'ok', incidentRows = []) {
  const alerts=[];
  const suppressed=new Set((incidentRows || [])
    .filter(x=>x.status==='active' && x.acknowledged && x.alertSuppressed)
    .map(x=>newsImpactRecoveryIncidentKey(x.reason,x.action,x.code)));
  if (String(evidenceReason || 'ok')!=='ok') {
    alerts.push({
      severity:'warning',
      code:'strategy_evidence_unavailable',
      reason:'',
      action:'',
      reasonLabel:'Recovery Strategy',
      actionLabel:'',
      message:'Историческое evidence временно недоступно; runtime использует fixed fallback.',
    });
    return alerts;
  }
  for (const row of strategyRows || []) {
    if (NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(row.guardReason || ''))
      && suppressed.has(newsImpactRecoveryIncidentKey(row.reason,row.action,row.guardReason))) continue;
    if (row.guardReason==='performance_drift') {
      alerts.push({
        severity:'warning',
        code:'performance_drift',
        reason:row.reason,
        action:row.action,
        reasonLabel:row.reasonLabel || row.reason,
        actionLabel:row.actionLabel || row.action,
        message:`Adaptive recovery отключён после подтверждённого падения на ${Number(row.driftDropPctPoints || 0).toFixed(1)} п.п.; включён fixed fallback.`,
      });
    } else if (row.guardReason==='recent_regression') {
      alerts.push({
        severity:'warning',
        code:'recent_regression',
        reason:row.reason,
        action:row.action,
        reasonLabel:row.reasonLabel || row.reason,
        actionLabel:row.actionLabel || row.action,
        message:'Свежая выборка не подтверждает adaptive recovery; используется fixed fallback.',
      });
    } else if (row.guardReason==='stability_sample' && row.proposedRecovery) {
      alerts.push({
        severity:'info',
        code:'stability_sample',
        reason:row.reason,
        action:row.action,
        reasonLabel:row.reasonLabel || row.reason,
        actionLabel:row.actionLabel || row.action,
        message:'Есть adaptive-кандидат, но свежей выборки пока недостаточно для безопасного переключения.',
      });
    }
  }
  for (const incident of incidentRows || []) {
    if (incident.status!=='active' || !incident.escalated) continue;
    const recoveryBreach=incident?.slo?.recoveryStatus==='breached';
    const ackBreach=incident?.slo?.ackStatus==='breached' && !incident.acknowledged;
    if (!recoveryBreach && !ackBreach) continue;
    alerts.push({
      severity:incident.effectivePriority==='critical' ? 'critical' : 'warning',
      code:recoveryBreach ? 'incident_recovery_slo_breach' : 'incident_ack_slo_breach',
      reason:incident.reason,
      action:incident.action,
      reasonLabel:incident.reasonLabel || incident.reason,
      actionLabel:incident.actionLabel || incident.action,
      message:recoveryBreach
        ? `Recovery-инцидент не восстановлен в пределах ${NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES} минут; приоритет повышен.`
        : `Recovery-инцидент не просмотрен в пределах ${NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES} минут; приоритет повышен.`,
    });
  }
  return alerts.slice(0,12);
}

function summarizeNewsImpactRecoveryAlerts(rows = []) {
  const list=Array.isArray(rows) ? rows : [];
  return {
    total:list.length,
    warnings:list.filter(x=>x.severity==='warning').length,
    info:list.filter(x=>x.severity==='info').length,
    critical:list.filter(x=>x.severity==='critical').length,
  };
}


function buildNewsImpactRecoveryIncidentEvents(failureRows = [], {limit = 100} = {}) {
  const normalized=(failureRows || []).map(row=>{
    const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
    const guardReason=NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES.has(String(meta.strategy_guard || ''))
      ? String(meta.strategy_guard)
      : '';
    const at=newsImpactEventTime(row);
    const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : 'server_error';
    const action=cleanNewsImpactActionCode(meta.action);
    if (!Number.isFinite(at) || !action) return null;
    const recovery=NEWS_IMPACT_RECOVERY_CODES.has(String(meta.recovery || ''))
      ? String(meta.recovery)
      : newsImpactRecoveryForFailure(reason,action).code;
    return {
      at,
      reason,
      reasonLabel:NEWS_IMPACT_FAILURE_LABELS[reason] || reason,
      action,
      actionLabel:NEWS_IMPACT_ACTION_LABELS[action] || action,
      strategy:String(meta.strategy || '')==='adaptive' ? 'adaptive' : 'fixed',
      recovery,
      recoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[recovery] || recovery,
      guardReason,
    };
  }).filter(Boolean).sort((a,b)=>a.at-b.at);

  const openByPair=new Map();
  const incidentEvents=[];
  for (const event of normalized) {
    const pairKey=`${event.reason}|${event.action}`;
    const adverse=NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(event.guardReason);
    let open=openByPair.get(pairKey) || null;
    if (!adverse) {
      if (open) {
        open.episode.recoveredAt=new Date(event.at).toISOString();
        openByPair.delete(pairKey);
      }
      continue;
    }
    if (!open || open.episode.guardReason!==event.guardReason) {
      if (open) open.episode.recoveredAt=new Date(event.at).toISOString();
      const episode={
        guardReason:event.guardReason,
        startedAt:new Date(event.at).toISOString(),
        lastSeenAt:new Date(event.at).toISOString(),
        recoveredAt:null,
        occurrences:0,
      };
      open={episode};
      openByPair.set(pairKey,open);
    }
    open.episode.lastSeenAt=new Date(event.at).toISOString();
    open.episode.occurrences+=1;
    incidentEvents.push({...event,episode:open.episode});
  }

  return incidentEvents.map(event=>({
    at:new Date(event.at).toISOString(),
    reason:event.reason,
    reasonLabel:event.reasonLabel,
    action:event.action,
    actionLabel:event.actionLabel,
    strategy:event.strategy,
    recovery:event.recovery,
    recoveryLabel:event.recoveryLabel,
    guardReason:event.guardReason,
    priority:event.guardReason==='performance_drift' ? 'high' : 'medium',
    episodeStartedAt:event.episode.startedAt,
    episodeLastSeenAt:event.episode.lastSeenAt,
    episodeRecoveredAt:event.episode.recoveredAt,
    episodeOccurrences:event.episode.occurrences,
  })).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
    .slice(0,Math.max(1,Math.min(250,Number(limit || 100))));
}

function newsImpactRecoveryIncidentKey(reason = '', action = '', code = '') {
  return `${String(reason || '')}|${String(action || '')}|${String(code || '')}`;
}

function newsImpactRecoveryIncidentRunbook(code = '') {
  if (code==='performance_drift') return {
    title:'Performance drift',
    steps:[
      'Проверить prior → recent success rate и достаточность выборки.',
      'Проверить API-Football, Supabase и runtime controls на совпадающую деградацию.',
      'Не форсировать adaptive: circuit breaker уже держит fixed fallback.',
      'Снять инцидент только после новой устойчивой выборки и нормализации guard.',
    ],
    automaticSafety:'fixed fallback уже включён автоматически',
  };
  if (code==='recent_regression') return {
    title:'Recent regression',
    steps:[
      'Проверить свежую 7-дневную выборку baseline и adaptive-кандидата.',
      'Сверить падение с provider/rate-limit и delivery-событиями.',
      'Оставить fixed fallback до восстановления подтверждённой статистики.',
    ],
    automaticSafety:'adaptive не включается, пока свежая выборка не восстановится',
  };
  return {
    title:'Strategy evidence unavailable',
    steps:[
      'Проверить доступность Supabase и shared recovery loader.',
      'Проверить, не усечена ли 30-дневная выборка.',
      'Не менять routing вручную до восстановления evidence.',
    ],
    automaticSafety:'runtime остаётся на fixed fallback',
  };
}

function buildNewsImpactRecoveryIncidentAcknowledgements(rows = []) {
  const latest=new Map();
  for (const row of rows || []) {
    const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
    const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : '';
    const action=cleanNewsImpactActionCode(meta.action);
    const code=NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(meta.incident_guard || '')) ? String(meta.incident_guard) : '';
    const acknowledgedAt=newsImpactEventTime(row);
    const seenAt=Date.parse(String(meta.incident_seen_at || ''));
    if (!reason || !action || !code || !Number.isFinite(acknowledgedAt) || !Number.isFinite(seenAt)) continue;
    const key=newsImpactRecoveryIncidentKey(reason,action,code);
    const value={
      reason,
      action,
      code,
      acknowledgedAt:new Date(acknowledgedAt).toISOString(),
      incidentSeenAt:new Date(seenAt).toISOString(),
    };
    const previous=latest.get(key);
    if (!previous || Date.parse(value.acknowledgedAt)>Date.parse(previous.acknowledgedAt)) latest.set(key,value);
  }
  return [...latest.values()];
}


function buildNewsImpactRecoveryIncidentAcknowledgementHistory(rows = []) {
  return (rows || []).map(row=>{
    const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
    const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : '';
    const action=cleanNewsImpactActionCode(meta.action);
    const code=NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(meta.incident_guard || '')) ? String(meta.incident_guard) : '';
    const acknowledgedAt=newsImpactEventTime(row);
    const seenAt=Date.parse(String(meta.incident_seen_at || ''));
    if (!reason || !action || !code || !Number.isFinite(acknowledgedAt) || !Number.isFinite(seenAt)) return null;
    return {
      reason,
      action,
      code,
      acknowledgedAt:new Date(acknowledgedAt).toISOString(),
      incidentSeenAt:new Date(seenAt).toISOString(),
    };
  }).filter(Boolean).sort((a,b)=>Date.parse(a.acknowledgedAt)-Date.parse(b.acknowledgedAt));
}

function buildNewsImpactRecoveryIncidentEpisodeHistory(failureRows = [], acknowledgementRows = []) {
  const normalized=(failureRows || []).map(row=>{
    const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
    const at=newsImpactEventTime(row);
    const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : 'server_error';
    const action=cleanNewsImpactActionCode(meta.action);
    const guardReason=NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES.has(String(meta.strategy_guard || ''))
      ? String(meta.strategy_guard)
      : '';
    if (!Number.isFinite(at) || !action) return null;
    return {
      at,
      reason,
      reasonLabel:NEWS_IMPACT_FAILURE_LABELS[reason] || reason,
      action,
      actionLabel:NEWS_IMPACT_ACTION_LABELS[action] || action,
      guardReason,
    };
  }).filter(Boolean).sort((a,b)=>a.at-b.at);

  const openByPair=new Map();
  const episodes=[];
  for (const event of normalized) {
    const key=`${event.reason}|${event.action}`;
    const adverse=NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(event.guardReason);
    let episode=openByPair.get(key) || null;
    if (!adverse) {
      if (episode) {
        episode.recoveredAt=new Date(event.at).toISOString();
        episode.closedByGuard=event.guardReason || 'safe';
        openByPair.delete(key);
      }
      continue;
    }
    if (!episode) {
      episode={
        reason:event.reason,
        reasonLabel:event.reasonLabel,
        action:event.action,
        actionLabel:event.actionLabel,
        startedAt:new Date(event.at).toISOString(),
        lastSeenAt:new Date(event.at).toISOString(),
        recoveredAt:null,
        closedByGuard:'',
        occurrences:0,
        guardCodes:[],
      };
      episodes.push(episode);
      openByPair.set(key,episode);
    }
    episode.lastSeenAt=new Date(event.at).toISOString();
    episode.occurrences+=1;
    if (!episode.guardCodes.includes(event.guardReason)) episode.guardCodes.push(event.guardReason);
  }

  const ackHistory=buildNewsImpactRecoveryIncidentAcknowledgementHistory(acknowledgementRows);
  return episodes.map(episode=>{
    const startMs=Date.parse(episode.startedAt);
    const lastSeenMs=Date.parse(episode.lastSeenAt);
    const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
    const ack=ackHistory.find(item=>{
      if (item.reason!==episode.reason || item.action!==episode.action) return false;
      if (!episode.guardCodes.includes(item.code)) return false;
      const seenMs=Date.parse(item.incidentSeenAt);
      const ackMs=Date.parse(item.acknowledgedAt);
      return Number.isFinite(seenMs)
        && Number.isFinite(ackMs)
        && seenMs>=startMs
        && seenMs<=lastSeenMs
        && ackMs>=startMs
        && (!Number.isFinite(recoveredMs) || ackMs<=recoveredMs);
    }) || null;
    return {
      ...episode,
      firstAcknowledgedAt:ack?.acknowledgedAt || null,
      firstAcknowledgedGuard:ack?.code || '',
      active:!episode.recoveredAt,
    };
  }).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
}

function newsImpactRecoveryEpisodeSloState(episode = null, asOfMs = Date.now()) {
  if (!episode) return null;
  const startMs=Date.parse(String(episode.startedAt || ''));
  if (!Number.isFinite(startMs)) return null;
  const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
  const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
  const terminalMs=Number.isFinite(recoveredMs) ? recoveredMs : asOfMs;
  const elapsedMinutes=Math.max(0,Math.round((terminalMs-startMs)/60000));
  const ackLatencyMinutes=Number.isFinite(ackMs) ? Math.max(0,Math.round((ackMs-startMs)/60000)) : null;
  const recoveryLatencyMinutes=Number.isFinite(recoveredMs) ? elapsedMinutes : null;
  const ackEligible=Number.isFinite(ackMs) || elapsedMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES;
  const ackMet=ackEligible && Number.isFinite(ackLatencyMinutes) && ackLatencyMinutes<=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES;
  const ackBreached=ackEligible && !ackMet;
  const recoveryEligible=Number.isFinite(recoveredMs) || elapsedMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES;
  const recoveryMet=recoveryEligible && Number.isFinite(recoveryLatencyMinutes) && recoveryLatencyMinutes<=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES;
  const recoveryBreached=recoveryEligible && !recoveryMet;
  return {
    elapsedMinutes,
    ackLatencyMinutes,
    recoveryLatencyMinutes,
    ackEligible,
    ackMet,
    ackBreached,
    ackStatus:ackMet ? 'met' : ackBreached ? 'breached' : 'pending',
    recoveryEligible,
    recoveryMet,
    recoveryBreached,
    recoveryStatus:recoveryMet ? 'met' : recoveryBreached ? 'breached' : 'pending',
  };
}

function newsImpactRecoverySloPct(met = 0, eligible = 0) {
  return eligible>0 ? Math.round((Number(met || 0)/Number(eligible))*1000)/10 : null;
}

function buildNewsImpactRecoveryIncidentSloDashboard(episodeRows = [], {asOfMs = Date.now(), weeks = 4} = {}) {
  const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
  const weekMs=7*86400_000;
  const earliestMs=asOfMs-safeWeeks*weekMs;
  const episodes=(episodeRows || []).map(episode=>({
    ...episode,
    slo:newsImpactRecoveryEpisodeSloState(episode,asOfMs),
  })).filter(x=>x.slo && Date.parse(x.startedAt)>=earliestMs && Date.parse(x.startedAt)<=asOfMs);

  const summarize=(rows=[])=>{
    const ackEligible=rows.filter(x=>x.slo.ackEligible).length;
    const ackMet=rows.filter(x=>x.slo.ackMet).length;
    const ackBreached=rows.filter(x=>x.slo.ackBreached).length;
    const recoveryEligible=rows.filter(x=>x.slo.recoveryEligible).length;
    const recoveryMet=rows.filter(x=>x.slo.recoveryMet).length;
    const recoveryBreached=rows.filter(x=>x.slo.recoveryBreached).length;
    const ackLatencies=rows.map(x=>x.slo.ackLatencyMinutes).filter(Number.isFinite);
    const recoveryLatencies=rows.map(x=>x.slo.recoveryLatencyMinutes).filter(Number.isFinite);
    return {
      episodes:rows.length,
      active:rows.filter(x=>x.active).length,
      recovered:rows.filter(x=>!x.active).length,
      ackEligible,
      ackMet,
      ackBreached,
      ackSloPct:newsImpactRecoverySloPct(ackMet,ackEligible),
      recoveryEligible,
      recoveryMet,
      recoveryBreached,
      recoverySloPct:newsImpactRecoverySloPct(recoveryMet,recoveryEligible),
      avgAckMinutes:ackLatencies.length ? Math.round((ackLatencies.reduce((a,b)=>a+b,0)/ackLatencies.length)*10)/10 : null,
      avgRecoveryMinutes:recoveryLatencies.length ? Math.round((recoveryLatencies.reduce((a,b)=>a+b,0)/recoveryLatencies.length)*10)/10 : null,
    };
  };

  const weekly=[];
  for (let offset=safeWeeks-1; offset>=0; offset-=1) {
    const startMs=asOfMs-(offset+1)*weekMs;
    const endMs=asOfMs-offset*weekMs;
    const rows=episodes.filter(x=>{
      const at=Date.parse(x.startedAt);
      return at>=startMs && at<endMs;
    });
    weekly.push({
      startAt:new Date(startMs).toISOString(),
      endAt:new Date(endMs).toISOString(),
      label:`${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`,
      ...summarize(rows),
    });
  }

  const recurrence=new Map();
  for (const episode of episodes) {
    const key=`${episode.reason}|${episode.action}`;
    const bucket=recurrence.get(key) || {
      reason:episode.reason,
      reasonLabel:episode.reasonLabel || episode.reason,
      action:episode.action,
      actionLabel:episode.actionLabel || episode.action,
      episodes:0,
      active:0,
      ackBreaches:0,
      recoveryBreaches:0,
      lastStartedAt:episode.startedAt,
      guards:new Set(),
    };
    bucket.episodes+=1;
    if (episode.active) bucket.active+=1;
    if (episode.slo.ackBreached) bucket.ackBreaches+=1;
    if (episode.slo.recoveryBreached) bucket.recoveryBreaches+=1;
    if (Date.parse(episode.startedAt)>Date.parse(bucket.lastStartedAt)) bucket.lastStartedAt=episode.startedAt;
    for (const code of episode.guardCodes || []) bucket.guards.add(code);
    recurrence.set(key,bucket);
  }
  const repeatedAll=[...recurrence.values()].map(x=>({
    reason:x.reason,
    reasonLabel:x.reasonLabel,
    action:x.action,
    actionLabel:x.actionLabel,
    episodes:x.episodes,
    active:x.active,
    ackBreaches:x.ackBreaches,
    recoveryBreaches:x.recoveryBreaches,
    lastStartedAt:x.lastStartedAt,
    guards:[...x.guards].sort(),
  })).filter(x=>x.episodes>=2)
    .sort((a,b)=>b.episodes-a.episodes || b.recoveryBreaches-a.recoveryBreaches || b.ackBreaches-a.ackBreaches || Date.parse(b.lastStartedAt)-Date.parse(a.lastStartedAt));
  const repeated=repeatedAll.slice(0,10);

  const summary=summarize(episodes);
  const current=weekly[weekly.length-1] || null;
  const previous=weekly[weekly.length-2] || null;
  const delta=(a,b)=>Number.isFinite(Number(a)) && Number.isFinite(Number(b))
    ? Math.round((Number(a)-Number(b))*10)/10
    : null;
  return {
    available:true,
    windowDays:safeWeeks*7,
    weeks:safeWeeks,
    generatedAt:new Date(asOfMs).toISOString(),
    summary:{
      ...summary,
      recurringPairs:repeatedAll.length,
      ackDeltaPctPoints:delta(current?.ackSloPct,previous?.ackSloPct),
      recoveryDeltaPctPoints:delta(current?.recoverySloPct,previous?.recoverySloPct),
    },
    weekly,
    repeated,
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false},
  };
}


function buildNewsImpactRecoveryIncidentSloBreachFeed(episodeRows = [], {asOfMs = Date.now(), limit = 20} = {}) {
  const priorityRank={critical:0,high:1,medium:2};
  const safeLimit=Math.max(1,Math.min(50,Number(limit || 20)));
  const items=(episodeRows || []).map(episode=>{
    const slo=newsImpactRecoveryEpisodeSloState(episode,asOfMs);
    if (!slo || (!slo.ackBreached && !slo.recoveryBreached)) return null;
    const breachTypes=[];
    if (slo.ackBreached) breachTypes.push('ack');
    if (slo.recoveryBreached) breachTypes.push('recovery');
    let severity='medium';
    if (episode.active && slo.recoveryBreached) severity='critical';
    else if (episode.active && slo.ackBreached && Number(slo.elapsedMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES) severity='critical';
    else if (episode.active && slo.ackBreached) severity='high';
    else if (slo.recoveryBreached) severity='high';
    return {
      reason:String(episode.reason || ''),
      reasonLabel:String(episode.reasonLabel || episode.reason || ''),
      action:String(episode.action || ''),
      actionLabel:String(episode.actionLabel || episode.action || ''),
      startedAt:episode.startedAt || null,
      lastSeenAt:episode.lastSeenAt || null,
      recoveredAt:episode.recoveredAt || null,
      active:Boolean(episode.active),
      occurrences:Number(episode.occurrences || 0),
      guards:Array.isArray(episode.guardCodes) ? [...episode.guardCodes].sort() : [],
      breachTypes,
      severity,
      ackStatus:slo.ackStatus,
      recoveryStatus:slo.recoveryStatus,
      ageMinutes:slo.elapsedMinutes,
      ackLatencyMinutes:slo.ackLatencyMinutes,
      recoveryLatencyMinutes:slo.recoveryLatencyMinutes,
    };
  }).filter(Boolean).sort((a,b)=>
    (priorityRank[a.severity] ?? 9)-(priorityRank[b.severity] ?? 9)
    || Number(b.active)-Number(a.active)
    || Date.parse(String(b.startedAt || 0))-Date.parse(String(a.startedAt || 0))
  );

  const pairs=new Map();
  for (const item of items) {
    const key=String(item.reason || '')+'|'+String(item.action || '');
    const bucket=pairs.get(key) || {
      reason:item.reason,
      reasonLabel:item.reasonLabel,
      action:item.action,
      actionLabel:item.actionLabel,
      breachEpisodes:0,
      activeBreaches:0,
      ackBreaches:0,
      recoveryBreaches:0,
      lastStartedAt:item.startedAt,
    };
    bucket.breachEpisodes+=1;
    if (item.active) bucket.activeBreaches+=1;
    if (item.breachTypes.includes('ack')) bucket.ackBreaches+=1;
    if (item.breachTypes.includes('recovery')) bucket.recoveryBreaches+=1;
    if (Date.parse(String(item.startedAt || 0))>Date.parse(String(bucket.lastStartedAt || 0))) bucket.lastStartedAt=item.startedAt;
    pairs.set(key,bucket);
  }
  const repeated=[...pairs.values()]
    .filter(x=>x.breachEpisodes>=2)
    .sort((a,b)=>b.activeBreaches-a.activeBreaches || b.recoveryBreaches-a.recoveryBreaches || b.ackBreaches-a.ackBreaches || b.breachEpisodes-a.breachEpisodes)
    .slice(0,10);

  return {
    available:true,
    generatedAt:new Date(asOfMs).toISOString(),
    summary:{
      breachEpisodes:items.length,
      activeBreaches:items.filter(x=>x.active).length,
      critical:items.filter(x=>x.severity==='critical').length,
      ackBreaches:items.filter(x=>x.breachTypes.includes('ack')).length,
      recoveryBreaches:items.filter(x=>x.breachTypes.includes('recovery')).length,
      repeatedPairs:repeated.length,
    },
    items:items.slice(0,safeLimit),
    repeated,
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
  };
}


function buildNewsImpactRecoveryIncidentSloBreachWatchlist(feed = {}, {limit = 10} = {}) {
  const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
  const items=Array.isArray(feed?.items) ? feed.items : [];
  const repeated=Array.isArray(feed?.repeated) ? feed.repeated : [];
  const active=items.filter(x=>x?.active);
  const activeSorted=[...active].sort((a,b)=>
    Number(b?.severity==='critical')-Number(a?.severity==='critical')
    || Number(b?.ageMinutes || 0)-Number(a?.ageMinutes || 0)
    || Date.parse(String(a?.startedAt || 0))-Date.parse(String(b?.startedAt || 0))
  );
  const activeRepeatedPairs=repeated
    .filter(x=>Number(x?.activeBreaches || 0)>0)
    .sort((a,b)=>Number(b.activeBreaches || 0)-Number(a.activeBreaches || 0)
      || Number(b.breachEpisodes || 0)-Number(a.breachEpisodes || 0))
    .slice(0,10);
  return {
    available:feed?.available!==false,
    generatedAt:feed?.generatedAt || null,
    summary:{
      active:active.length,
      criticalActive:active.filter(x=>x?.severity==='critical').length,
      ackActive:active.filter(x=>Array.isArray(x?.breachTypes) && x.breachTypes.includes('ack')).length,
      recoveryActive:active.filter(x=>Array.isArray(x?.breachTypes) && x.breachTypes.includes('recovery')).length,
      oldestActiveMinutes:active.length ? Math.max(...active.map(x=>Number(x?.ageMinutes || 0))) : null,
      repeatedActivePairs:activeRepeatedPairs.length,
    },
    items:activeSorted.slice(0,safeLimit),
    repeated:activeRepeatedPairs,
    thresholds:{
      ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
      criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
      recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
      source:'rc87_existing_slo',
    },
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
    persistence:'none',
  };
}


function buildNewsImpactRecoveryIncidentSloBreachTriage(watchlist = {}, {limit = 10} = {}) {
  const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
  const items=Array.isArray(watchlist?.items) ? watchlist.items : [];
  const thresholds=watchlist?.thresholds || {};
  const criticalAckMinutes=Number(thresholds.criticalAckMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES);
  const recoveryMinutes=Number(thresholds.recoveryMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES);
  const stageRank={recovery_overdue:0,ack_critical:1,ack_overdue:2};
  const triageItems=items.filter(x=>x?.active).map(item=>{
    const breachTypes=Array.isArray(item?.breachTypes) ? item.breachTypes : [];
    const ageMinutes=Number(item?.ageMinutes || 0);
    let triageStage='ack_overdue';
    let triageLabel='ACK просрочен';
    if (breachTypes.includes('recovery') || ageMinutes>=recoveryMinutes) {
      triageStage='recovery_overdue';
      triageLabel='Recovery просрочен';
    } else if (breachTypes.includes('ack') && ageMinutes>=criticalAckMinutes) {
      triageStage='ack_critical';
      triageLabel='ACK критически просрочен';
    }
    return {...item,triageStage,triageLabel};
  }).sort((a,b)=>
    (stageRank[a.triageStage] ?? 9)-(stageRank[b.triageStage] ?? 9)
    || Number(b.ageMinutes || 0)-Number(a.ageMinutes || 0)
    || Date.parse(String(a.startedAt || 0))-Date.parse(String(b.startedAt || 0))
  );
  return {
    available:watchlist?.available!==false,
    generatedAt:watchlist?.generatedAt || null,
    summary:{
      total:triageItems.length,
      recoveryOverdue:triageItems.filter(x=>x.triageStage==='recovery_overdue').length,
      ackCritical:triageItems.filter(x=>x.triageStage==='ack_critical').length,
      ackOverdue:triageItems.filter(x=>x.triageStage==='ack_overdue').length,
    },
    items:triageItems.slice(0,safeLimit),
    thresholds:{
      ackMinutes:Number(thresholds.ackMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
      criticalAckMinutes,
      recoveryMinutes,
      source:'rc87_existing_slo',
    },
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
    persistence:'none',
  };
}


function newsImpactRecoveryIncidentTriageStageAt(episode = null, atMs = Date.now()) {
  if (!episode) return null;
  const startMs=Date.parse(String(episode.startedAt || ''));
  if (!Number.isFinite(startMs) || startMs>atMs) return null;
  const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
  if (Number.isFinite(recoveredMs) && recoveredMs<=atMs) return null;
  const ageMinutes=Math.max(0,Math.floor((atMs-startMs)/60000));
  const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
  const ackLatencyMinutes=Number.isFinite(ackMs) ? Math.max(0,Math.round((ackMs-startMs)/60000)) : null;
  const ackBreached=Number.isFinite(ackMs) && ackMs<=atMs
    ? Number(ackLatencyMinutes || 0)>NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES
    : ageMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES;
  if (ageMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES) return 'recovery_overdue';
  if (ackBreached && ageMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES) return 'ack_critical';
  if (ackBreached) return 'ack_overdue';
  return null;
}

function buildNewsImpactRecoveryIncidentSloBreachTriageTrend(episodeRows = [], {asOfMs = Date.now(), weeks = 4} = {}) {
  const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
  const weekMs=7*86400_000;
  const weekly=[];
  const pairSnapshots=new Map();
  for (let i=safeWeeks-1;i>=0;i-=1) {
    const snapshotAtMs=asOfMs-i*weekMs;
    const counts={total:0,recoveryOverdue:0,ackCritical:0,ackOverdue:0};
    const seenPairs=new Map();
    for (const episode of episodeRows || []) {
      const stage=newsImpactRecoveryIncidentTriageStageAt(episode,snapshotAtMs);
      if (!stage) continue;
      counts.total+=1;
      if (stage==='recovery_overdue') counts.recoveryOverdue+=1;
      else if (stage==='ack_critical') counts.ackCritical+=1;
      else counts.ackOverdue+=1;
      const key=String(episode.reason || '')+'|'+String(episode.action || '');
      const current=seenPairs.get(key) || {
        reason:String(episode.reason || ''),
        reasonLabel:String(episode.reasonLabel || episode.reason || ''),
        action:String(episode.action || ''),
        actionLabel:String(episode.actionLabel || episode.action || ''),
        stage,
      };
      if (stage==='recovery_overdue' || (stage==='ack_critical' && current.stage==='ack_overdue')) current.stage=stage;
      seenPairs.set(key,current);
    }
    for (const [key,pair] of seenPairs) {
      const bucket=pairSnapshots.get(key) || {
        reason:pair.reason,
        reasonLabel:pair.reasonLabel,
        action:pair.action,
        actionLabel:pair.actionLabel,
        weeksPresent:0,
        recoveryOverdueWeeks:0,
        ackCriticalWeeks:0,
        ackOverdueWeeks:0,
        latestStage:pair.stage,
      };
      bucket.weeksPresent+=1;
      if (pair.stage==='recovery_overdue') bucket.recoveryOverdueWeeks+=1;
      else if (pair.stage==='ack_critical') bucket.ackCriticalWeeks+=1;
      else bucket.ackOverdueWeeks+=1;
      bucket.latestStage=pair.stage;
      pairSnapshots.set(key,bucket);
    }
    weekly.push({
      snapshotAt:new Date(snapshotAtMs).toISOString(),
      ...counts,
    });
  }
  const current=weekly[weekly.length-1] || {total:0,recoveryOverdue:0,ackCritical:0,ackOverdue:0};
  const previous=weekly[weekly.length-2] || current;
  const stuck=[...pairSnapshots.values()]
    .filter(x=>x.weeksPresent>=2)
    .sort((a,b)=>b.recoveryOverdueWeeks-a.recoveryOverdueWeeks
      || b.ackCriticalWeeks-a.ackCriticalWeeks
      || b.weeksPresent-a.weeksPresent
      || String(a.reason).localeCompare(String(b.reason)))
    .slice(0,10);
  return {
    available:true,
    weeks:safeWeeks,
    generatedAt:new Date(asOfMs).toISOString(),
    summary:{
      currentTotal:Number(current.total || 0),
      totalDelta:Number(current.total || 0)-Number(previous.total || 0),
      recoveryOverdueDelta:Number(current.recoveryOverdue || 0)-Number(previous.recoveryOverdue || 0),
      ackCriticalDelta:Number(current.ackCritical || 0)-Number(previous.ackCritical || 0),
      ackOverdueDelta:Number(current.ackOverdue || 0)-Number(previous.ackOverdue || 0),
      stuckPairs:stuck.length,
    },
    weekly,
    stuck,
    thresholds:{
      ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
      criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
      recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
      source:'rc87_existing_slo',
    },
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
    persistence:'none',
  };
}


function newsImpactRecoveryIncidentSloBurden(episode = null, asOfMs = Date.now()) {
  if (!episode) return null;
  const startMs=Date.parse(String(episode.startedAt || ''));
  if (!Number.isFinite(startMs) || startMs>asOfMs) return null;
  const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
  const terminalMs=Number.isFinite(recoveredMs) && recoveredMs<=asOfMs ? recoveredMs : asOfMs;
  const elapsedMinutes=Math.max(0,Math.round((terminalMs-startMs)/60000));
  const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
  const ackTerminalMs=Number.isFinite(ackMs) && ackMs<=terminalMs ? ackMs : terminalMs;
  const ackElapsedMinutes=Math.max(0,Math.round((ackTerminalMs-startMs)/60000));
  const ackOverdueMinutes=Math.max(0,ackElapsedMinutes-NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES);
  const recoveryOverdueMinutes=Math.max(0,elapsedMinutes-NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES);
  return {
    active:!(Number.isFinite(recoveredMs) && recoveredMs<=asOfMs),
    elapsedMinutes,
    ackOverdueMinutes,
    recoveryOverdueMinutes,
    totalOverdueMinutes:ackOverdueMinutes+recoveryOverdueMinutes,
  };
}

function buildNewsImpactRecoveryIncidentSloBreachImpactRanking(episodeRows = [], {asOfMs = Date.now(), limit = 10} = {}) {
  const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
  const groups=new Map();
  for (const episode of episodeRows || []) {
    const burden=newsImpactRecoveryIncidentSloBurden(episode,asOfMs);
    if (!burden || burden.totalOverdueMinutes<=0) continue;
    const key=String(episode.reason || '')+'|'+String(episode.action || '');
    const bucket=groups.get(key) || {
      reason:String(episode.reason || ''),
      reasonLabel:String(episode.reasonLabel || episode.reason || ''),
      action:String(episode.action || ''),
      actionLabel:String(episode.actionLabel || episode.action || ''),
      episodes:0,
      activeEpisodes:0,
      ackBreachEpisodes:0,
      recoveryBreachEpisodes:0,
      ackOverdueMinutes:0,
      recoveryOverdueMinutes:0,
      totalOverdueMinutes:0,
      oldestActiveMinutes:null,
      latestStage:null,
    };
    bucket.episodes+=1;
    if (burden.active) {
      bucket.activeEpisodes+=1;
      bucket.oldestActiveMinutes=bucket.oldestActiveMinutes==null
        ? burden.elapsedMinutes
        : Math.max(bucket.oldestActiveMinutes,burden.elapsedMinutes);
      const stage=newsImpactRecoveryIncidentTriageStageAt(episode,asOfMs);
      const stageRank={recovery_overdue:0,ack_critical:1,ack_overdue:2};
      if (stage && (bucket.latestStage==null || (stageRank[stage] ?? 9)<(stageRank[bucket.latestStage] ?? 9))) {
        bucket.latestStage=stage;
      }
    }
    if (burden.ackOverdueMinutes>0) bucket.ackBreachEpisodes+=1;
    if (burden.recoveryOverdueMinutes>0) bucket.recoveryBreachEpisodes+=1;
    bucket.ackOverdueMinutes+=burden.ackOverdueMinutes;
    bucket.recoveryOverdueMinutes+=burden.recoveryOverdueMinutes;
    bucket.totalOverdueMinutes+=burden.totalOverdueMinutes;
    groups.set(key,bucket);
  }
  const all=[...groups.values()].sort((a,b)=>
    b.totalOverdueMinutes-a.totalOverdueMinutes
    || b.recoveryOverdueMinutes-a.recoveryOverdueMinutes
    || b.ackOverdueMinutes-a.ackOverdueMinutes
    || b.episodes-a.episodes
    || String(a.reason).localeCompare(String(b.reason))
  );
  const totalOverdueMinutes=all.reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0);
  const ranking=all.slice(0,safeLimit).map((row,index)=>({
    ...row,
    rank:index+1,
    contributionPct:totalOverdueMinutes>0
      ? Math.round((Number(row.totalOverdueMinutes || 0)/totalOverdueMinutes)*1000)/10
      : 0,
  }));
  return {
    available:true,
    generatedAt:new Date(asOfMs).toISOString(),
    summary:{
      pairs:all.length,
      activePairs:all.filter(x=>x.activeEpisodes>0).length,
      breachEpisodes:all.reduce((sum,row)=>sum+Number(row.episodes || 0),0),
      totalOverdueMinutes,
      ackOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.ackOverdueMinutes || 0),0),
      recoveryOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.recoveryOverdueMinutes || 0),0),
      topContributionPct:ranking[0]?.contributionPct || 0,
    },
    ranking,
    thresholds:{
      ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
      criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
      recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
      source:'rc87_existing_slo',
    },
    methodology:'sum_minutes_above_existing_ack_and_recovery_slo',
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
    persistence:'none',
  };
}


function newsImpactRecoveryIncidentOverdueWithinWindow(episode = null, windowStartMs = 0, windowEndMs = Date.now()) {
  if (!episode || !Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs<=windowStartMs) return null;
  const startMs=Date.parse(String(episode.startedAt || ''));
  if (!Number.isFinite(startMs) || startMs>=windowEndMs) return null;
  const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
  const terminalMs=Number.isFinite(recoveredMs) && recoveredMs<windowEndMs ? recoveredMs : windowEndMs;
  if (terminalMs<=windowStartMs) return null;
  const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
  const ackTerminalMs=Number.isFinite(ackMs) && ackMs<terminalMs ? ackMs : terminalMs;
  const overlapMinutes=(fromMs,toMs)=>{
    const from=Math.max(windowStartMs,fromMs);
    const to=Math.min(windowEndMs,toMs);
    return to>from ? Math.max(0,Math.round((to-from)/60000)) : 0;
  };
  const ackOverdueStartMs=startMs+NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES*60000;
  const recoveryOverdueStartMs=startMs+NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES*60000;
  const ackOverdueMinutes=overlapMinutes(ackOverdueStartMs,ackTerminalMs);
  const recoveryOverdueMinutes=overlapMinutes(recoveryOverdueStartMs,terminalMs);
  return {
    ackOverdueMinutes,
    recoveryOverdueMinutes,
    totalOverdueMinutes:ackOverdueMinutes+recoveryOverdueMinutes,
  };
}

function buildNewsImpactRecoveryIncidentSloBreachImpactTrend(episodeRows = [], {asOfMs = Date.now(), weeks = 4, limit = 10} = {}) {
  const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
  const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
  const weekMs=7*86400_000;
  const weekly=[];
  const pairSeries=new Map();
  for (let i=safeWeeks-1;i>=0;i-=1) {
    const windowEndMs=asOfMs-i*weekMs;
    const windowStartMs=windowEndMs-weekMs;
    const groups=new Map();
    for (const episode of episodeRows || []) {
      const burden=newsImpactRecoveryIncidentOverdueWithinWindow(episode,windowStartMs,windowEndMs);
      if (!burden || burden.totalOverdueMinutes<=0) continue;
      const key=String(episode.reason || '')+'|'+String(episode.action || '');
      const bucket=groups.get(key) || {
        reason:String(episode.reason || ''),
        reasonLabel:String(episode.reasonLabel || episode.reason || ''),
        action:String(episode.action || ''),
        actionLabel:String(episode.actionLabel || episode.action || ''),
        episodes:0,
        ackOverdueMinutes:0,
        recoveryOverdueMinutes:0,
        totalOverdueMinutes:0,
      };
      bucket.episodes+=1;
      bucket.ackOverdueMinutes+=burden.ackOverdueMinutes;
      bucket.recoveryOverdueMinutes+=burden.recoveryOverdueMinutes;
      bucket.totalOverdueMinutes+=burden.totalOverdueMinutes;
      groups.set(key,bucket);
    }
    const all=[...groups.values()].sort((a,b)=>
      b.totalOverdueMinutes-a.totalOverdueMinutes
      || b.recoveryOverdueMinutes-a.recoveryOverdueMinutes
      || b.ackOverdueMinutes-a.ackOverdueMinutes
      || String(a.reason).localeCompare(String(b.reason))
    );
    const totalOverdueMinutes=all.reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0);
    const pairMap=new Map(all.map(row=>[String(row.reason)+'|'+String(row.action),row]));
    weekly.push({
      windowStart:new Date(windowStartMs).toISOString(),
      windowEnd:new Date(windowEndMs).toISOString(),
      totalOverdueMinutes,
      ackOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.ackOverdueMinutes || 0),0),
      recoveryOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.recoveryOverdueMinutes || 0),0),
      pairs:all.length,
      top:all[0] ? {
        reason:all[0].reason,
        reasonLabel:all[0].reasonLabel,
        action:all[0].action,
        actionLabel:all[0].actionLabel,
        totalOverdueMinutes:all[0].totalOverdueMinutes,
        contributionPct:totalOverdueMinutes>0 ? Math.round((all[0].totalOverdueMinutes/totalOverdueMinutes)*1000)/10 : 0,
      } : null,
    });
    for (const row of all) {
      const key=String(row.reason)+'|'+String(row.action);
      if (!pairSeries.has(key)) pairSeries.set(key,{
        reason:row.reason,
        reasonLabel:row.reasonLabel,
        action:row.action,
        actionLabel:row.actionLabel,
        values:new Array(safeWeeks).fill(null).map(()=>({ackOverdueMinutes:0,recoveryOverdueMinutes:0,totalOverdueMinutes:0,episodes:0})),
      });
    }
    const weekIndex=weekly.length-1;
    for (const [key,series] of pairSeries) {
      const row=pairMap.get(key);
      if (row) series.values[weekIndex]={
        ackOverdueMinutes:Number(row.ackOverdueMinutes || 0),
        recoveryOverdueMinutes:Number(row.recoveryOverdueMinutes || 0),
        totalOverdueMinutes:Number(row.totalOverdueMinutes || 0),
        episodes:Number(row.episodes || 0),
      };
    }
  }
  const currentWeek=weekly[weekly.length-1] || {totalOverdueMinutes:0};
  const previousWeek=weekly[weekly.length-2] || currentWeek;
  const pairTrends=[...pairSeries.values()].map(series=>{
    const current=series.values[series.values.length-1] || {totalOverdueMinutes:0};
    const previous=series.values[series.values.length-2] || {totalOverdueMinutes:0};
    const deltaMinutes=Number(current.totalOverdueMinutes || 0)-Number(previous.totalOverdueMinutes || 0);
    return {
      reason:series.reason,
      reasonLabel:series.reasonLabel,
      action:series.action,
      actionLabel:series.actionLabel,
      currentOverdueMinutes:Number(current.totalOverdueMinutes || 0),
      previousOverdueMinutes:Number(previous.totalOverdueMinutes || 0),
      deltaMinutes,
      direction:deltaMinutes>0 ? 'increased' : deltaMinutes<0 ? 'decreased' : 'unchanged',
      currentContributionPct:Number(currentWeek.totalOverdueMinutes || 0)>0
        ? Math.round((Number(current.totalOverdueMinutes || 0)/Number(currentWeek.totalOverdueMinutes || 0))*1000)/10
        : 0,
      weekly:series.values,
    };
  }).sort((a,b)=>
    Math.abs(b.deltaMinutes)-Math.abs(a.deltaMinutes)
    || b.currentOverdueMinutes-a.currentOverdueMinutes
    || String(a.reason).localeCompare(String(b.reason))
  );
  return {
    available:true,
    weeks:safeWeeks,
    generatedAt:new Date(asOfMs).toISOString(),
    summary:{
      currentOverdueMinutes:Number(currentWeek.totalOverdueMinutes || 0),
      previousOverdueMinutes:Number(previousWeek.totalOverdueMinutes || 0),
      deltaMinutes:Number(currentWeek.totalOverdueMinutes || 0)-Number(previousWeek.totalOverdueMinutes || 0),
      increasedPairs:pairTrends.filter(x=>x.direction==='increased').length,
      decreasedPairs:pairTrends.filter(x=>x.direction==='decreased').length,
      unchangedPairs:pairTrends.filter(x=>x.direction==='unchanged').length,
    },
    weekly,
    pairs:pairTrends.slice(0,safeLimit),
    thresholds:{
      ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
      criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
      recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
      source:'rc87_existing_slo',
    },
    methodology:'weekly_overlap_minutes_above_existing_ack_and_recovery_slo',
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
    persistence:'none',
  };
}


function buildNewsImpactRecoveryIncidentSloImpactConcentration(impactRanking = {}) {
  const ranking=Array.isArray(impactRanking?.ranking) ? impactRanking.ranking : [];
  const totalPairs=Math.max(0,Number(impactRanking?.summary?.pairs || ranking.length));
  const cumulativePct=(count)=>Math.round(ranking.slice(0,count).reduce((sum,row)=>sum+Number(row?.contributionPct || 0),0)*10)/10;
  const top1Pct=cumulativePct(1);
  const top3Pct=cumulativePct(3);
  const top5Pct=cumulativePct(5);
  const concentrationRows=ranking.slice(0,5).map((row,index)=>({
    rank:index+1,
    reason:String(row?.reason || ''),
    reasonLabel:String(row?.reasonLabel || row?.reason || ''),
    action:String(row?.action || ''),
    actionLabel:String(row?.actionLabel || row?.action || ''),
    contributionPct:Number(row?.contributionPct || 0),
    cumulativeContributionPct:cumulativePct(index+1),
    totalOverdueMinutes:Number(row?.totalOverdueMinutes || 0),
    activeEpisodes:Number(row?.activeEpisodes || 0),
  }));
  return {
    available:impactRanking?.available!==false,
    generatedAt:impactRanking?.generatedAt || null,
    summary:{
      pairs:totalPairs,
      totalOverdueMinutes:Number(impactRanking?.summary?.totalOverdueMinutes || 0),
      top1ContributionPct:top1Pct,
      top3ContributionPct:top3Pct,
      top5ContributionPct:top5Pct,
      residualAfterTop5Pct:Math.max(0,Math.round((100-top5Pct)*10)/10),
      coveredPairs:Math.min(5,totalPairs),
    },
    rows:concentrationRows,
    methodology:'cumulative_share_of_total_overdue_minutes',
    thresholds:{
      ackMinutes:Number(impactRanking?.thresholds?.ackMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
      criticalAckMinutes:Number(impactRanking?.thresholds?.criticalAckMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES),
      recoveryMinutes:Number(impactRanking?.thresholds?.recoveryMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES),
      source:'rc87_existing_slo',
    },
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
    persistence:'none',
  };
}


function buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(episodeRows = [], {asOfMs = Date.now(), weeks = 4} = {}) {
  const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
  const weekMs=7*86400_000;
  const weekly=[];
  const direction=(delta)=>delta>0 ? 'increased' : delta<0 ? 'decreased' : 'unchanged';
  for (let i=safeWeeks-1;i>=0;i-=1) {
    const windowEndMs=asOfMs-i*weekMs;
    const windowStartMs=windowEndMs-weekMs;
    const groups=new Map();
    for (const episode of episodeRows || []) {
      const burden=newsImpactRecoveryIncidentOverdueWithinWindow(episode,windowStartMs,windowEndMs);
      if (!burden || burden.totalOverdueMinutes<=0) continue;
      const key=String(episode.reason || '')+'|'+String(episode.action || '');
      const bucket=groups.get(key) || {
        reason:String(episode.reason || ''),
        reasonLabel:String(episode.reasonLabel || episode.reason || ''),
        action:String(episode.action || ''),
        actionLabel:String(episode.actionLabel || episode.action || ''),
        totalOverdueMinutes:0,
      };
      bucket.totalOverdueMinutes+=Number(burden.totalOverdueMinutes || 0);
      groups.set(key,bucket);
    }
    const all=[...groups.values()].sort((a,b)=>
      b.totalOverdueMinutes-a.totalOverdueMinutes
      || String(a.reason).localeCompare(String(b.reason))
      || String(a.action).localeCompare(String(b.action))
    );
    const totalOverdueMinutes=all.reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0);
    const share=(count)=>totalOverdueMinutes>0
      ? Math.round((all.slice(0,count).reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0)/totalOverdueMinutes)*1000)/10
      : 0;
    const top1ContributionPct=share(1);
    const top3ContributionPct=share(3);
    const top5ContributionPct=share(5);
    weekly.push({
      windowStart:new Date(windowStartMs).toISOString(),
      windowEnd:new Date(windowEndMs).toISOString(),
      pairs:all.length,
      totalOverdueMinutes,
      top1ContributionPct,
      top3ContributionPct,
      top5ContributionPct,
      residualAfterTop5Pct:Math.max(0,Math.round((100-top5ContributionPct)*10)/10),
      topPair:all[0] ? {
        reason:all[0].reason,
        reasonLabel:all[0].reasonLabel,
        action:all[0].action,
        actionLabel:all[0].actionLabel,
        totalOverdueMinutes:Number(all[0].totalOverdueMinutes || 0),
      } : null,
    });
  }
  const current=weekly[weekly.length-1] || {pairs:0,totalOverdueMinutes:0,top1ContributionPct:0,top3ContributionPct:0,top5ContributionPct:0};
  const previous=weekly[weekly.length-2] || current;
  const top1DeltaPctPoints=Math.round((Number(current.top1ContributionPct || 0)-Number(previous.top1ContributionPct || 0))*10)/10;
  const top3DeltaPctPoints=Math.round((Number(current.top3ContributionPct || 0)-Number(previous.top3ContributionPct || 0))*10)/10;
  const top5DeltaPctPoints=Math.round((Number(current.top5ContributionPct || 0)-Number(previous.top5ContributionPct || 0))*10)/10;
  return {
    available:true,
    weeks:safeWeeks,
    generatedAt:new Date(asOfMs).toISOString(),
    summary:{
      currentPairs:Number(current.pairs || 0),
      previousPairs:Number(previous.pairs || 0),
      pairDelta:Number(current.pairs || 0)-Number(previous.pairs || 0),
      currentOverdueMinutes:Number(current.totalOverdueMinutes || 0),
      previousOverdueMinutes:Number(previous.totalOverdueMinutes || 0),
      top1ContributionPct:Number(current.top1ContributionPct || 0),
      top3ContributionPct:Number(current.top3ContributionPct || 0),
      top5ContributionPct:Number(current.top5ContributionPct || 0),
      top1DeltaPctPoints,
      top3DeltaPctPoints,
      top5DeltaPctPoints,
      top1Direction:direction(top1DeltaPctPoints),
      top3Direction:direction(top3DeltaPctPoints),
      top5Direction:direction(top5DeltaPctPoints),
    },
    weekly,
    methodology:'weekly_cumulative_share_of_total_overdue_minutes',
    thresholds:{
      ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
      criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
      recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
      source:'rc87_existing_slo',
    },
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
    persistence:'none',
  };
}


function buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(
  impactRanking = {},
  impactTrend = {},
  concentration = {},
  concentrationTrend = {},
) {
  const topPair=Array.isArray(impactRanking?.ranking) && impactRanking.ranking.length ? impactRanking.ranking[0] : null;
  const rankingSummary=impactRanking?.summary || {};
  const trendSummary=impactTrend?.summary || {};
  const concentrationSummary=concentration?.summary || {};
  const concentrationTrendSummary=concentrationTrend?.summary || {};
  const available=[impactRanking,impactTrend,concentration,concentrationTrend].every(x=>x?.available!==false);
  return {
    available,
    generatedAt:impactRanking?.generatedAt || impactTrend?.generatedAt || concentrationTrend?.generatedAt || concentration?.generatedAt || null,
    summary:{
      cumulativeOverdueMinutes:Number(rankingSummary.totalOverdueMinutes || 0),
      cumulativeAckOverdueMinutes:Number(rankingSummary.ackOverdueMinutes || 0),
      cumulativeRecoveryOverdueMinutes:Number(rankingSummary.recoveryOverdueMinutes || 0),
      breachPairs:Number(rankingSummary.pairs || 0),
      activePairs:Number(rankingSummary.activePairs || 0),
      breachEpisodes:Number(rankingSummary.breachEpisodes || 0),
      currentWeekOverdueMinutes:Number(trendSummary.currentOverdueMinutes || 0),
      previousWeekOverdueMinutes:Number(trendSummary.previousOverdueMinutes || 0),
      weekDeltaMinutes:Number(trendSummary.deltaMinutes || 0),
      weeklyIncreasedPairs:Number(trendSummary.increasedPairs || 0),
      weeklyDecreasedPairs:Number(trendSummary.decreasedPairs || 0),
      weeklyUnchangedPairs:Number(trendSummary.unchangedPairs || 0),
      top1ContributionPct:Number(concentrationSummary.top1ContributionPct || 0),
      top3ContributionPct:Number(concentrationSummary.top3ContributionPct || 0),
      top5ContributionPct:Number(concentrationSummary.top5ContributionPct || 0),
      top1WeeklyDeltaPctPoints:Number(concentrationTrendSummary.top1DeltaPctPoints || 0),
      top3WeeklyDeltaPctPoints:Number(concentrationTrendSummary.top3DeltaPctPoints || 0),
      top5WeeklyDeltaPctPoints:Number(concentrationTrendSummary.top5DeltaPctPoints || 0),
      top1WeeklyDirection:String(concentrationTrendSummary.top1Direction || 'unchanged'),
      top3WeeklyDirection:String(concentrationTrendSummary.top3Direction || 'unchanged'),
      top5WeeklyDirection:String(concentrationTrendSummary.top5Direction || 'unchanged'),
    },
    topPair:topPair ? {
      reason:String(topPair.reason || ''),
      reasonLabel:String(topPair.reasonLabel || topPair.reason || ''),
      action:String(topPair.action || ''),
      actionLabel:String(topPair.actionLabel || topPair.action || ''),
      totalOverdueMinutes:Number(topPair.totalOverdueMinutes || 0),
      contributionPct:Number(topPair.contributionPct || 0),
      activeEpisodes:Number(topPair.activeEpisodes || 0),
      ackOverdueMinutes:Number(topPair.ackOverdueMinutes || 0),
      recoveryOverdueMinutes:Number(topPair.recoveryOverdueMinutes || 0),
    } : null,
    sourceReleases:['RC93','RC94','RC95','RC96'],
    methodology:'summary_of_existing_slo_impact_views',
    thresholds:{
      ackMinutes:Number(impactRanking?.thresholds?.ackMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
      criticalAckMinutes:Number(impactRanking?.thresholds?.criticalAckMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES),
      recoveryMinutes:Number(impactRanking?.thresholds?.recoveryMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES),
      source:'rc87_existing_slo',
    },
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
    persistence:'none',
  };
}


function buildNewsImpactRecoveryIncidentSloImpactFocusQueue(
  impactRanking = {},
  impactTrend = {},
  executiveSummary = {},
  {limit = 5} = {},
) {
  const safeLimit=Math.max(1,Math.min(10,Number(limit || 5)));
  const ranking=Array.isArray(impactRanking?.ranking) ? impactRanking.ranking : [];
  const trendPairs=Array.isArray(impactTrend?.pairs) ? impactTrend.pairs : [];
  const trendByKey=new Map(trendPairs.map(row=>[
    String(row?.reason || '')+'|'+String(row?.action || ''),
    row,
  ]));
  const rows=ranking.map(row=>{
    const key=String(row?.reason || '')+'|'+String(row?.action || '');
    const trend=trendByKey.get(key) || {};
    return {
      reason:String(row?.reason || ''),
      reasonLabel:String(row?.reasonLabel || row?.reason || ''),
      action:String(row?.action || ''),
      actionLabel:String(row?.actionLabel || row?.action || ''),
      totalOverdueMinutes:Number(row?.totalOverdueMinutes || 0),
      contributionPct:Number(row?.contributionPct || 0),
      activeEpisodes:Number(row?.activeEpisodes || 0),
      ackOverdueMinutes:Number(row?.ackOverdueMinutes || 0),
      recoveryOverdueMinutes:Number(row?.recoveryOverdueMinutes || 0),
      currentWeekOverdueMinutes:Number(trend?.currentOverdueMinutes || 0),
      previousWeekOverdueMinutes:Number(trend?.previousOverdueMinutes || 0),
      weekDeltaMinutes:Number(trend?.deltaMinutes || 0),
      weekDirection:String(trend?.direction || 'unchanged'),
      currentContributionPct:Number(trend?.currentContributionPct || 0),
    };
  }).sort((a,b)=>
    b.currentWeekOverdueMinutes-a.currentWeekOverdueMinutes
    || b.weekDeltaMinutes-a.weekDeltaMinutes
    || b.totalOverdueMinutes-a.totalOverdueMinutes
    || String(a.reason).localeCompare(String(b.reason))
    || String(a.action).localeCompare(String(b.action))
  ).slice(0,safeLimit).map((row,index)=>({...row,queuePosition:index+1}));

  const summary=executiveSummary?.summary || {};
  return {
    available:[impactRanking,impactTrend,executiveSummary].every(x=>x?.available!==false),
    generatedAt:executiveSummary?.generatedAt || impactTrend?.generatedAt || impactRanking?.generatedAt || null,
    summary:{
      queuedPairs:rows.length,
      breachPairs:Number(summary.breachPairs || impactRanking?.summary?.pairs || 0),
      activePairs:Number(summary.activePairs || impactRanking?.summary?.activePairs || 0),
      currentWeekOverdueMinutes:Number(summary.currentWeekOverdueMinutes || impactTrend?.summary?.currentOverdueMinutes || 0),
      weekDeltaMinutes:Number(summary.weekDeltaMinutes || impactTrend?.summary?.deltaMinutes || 0),
      increasingQueuedPairs:rows.filter(x=>x.weekDirection==='increased').length,
      decreasingQueuedPairs:rows.filter(x=>x.weekDirection==='decreased').length,
      unchangedQueuedPairs:rows.filter(x=>x.weekDirection==='unchanged').length,
    },
    rows,
    ordering:'current_week_overdue_then_week_delta_then_cumulative_overdue',
    sourceReleases:['RC93','RC94','RC97'],
    thresholds:{
      ackMinutes:Number(impactRanking?.thresholds?.ackMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
      criticalAckMinutes:Number(impactRanking?.thresholds?.criticalAckMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES),
      recoveryMinutes:Number(impactRanking?.thresholds?.recoveryMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES),
      source:'rc87_existing_slo',
    },
    privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
    routingChanged:false,
    persistence:'none',
  };
}

function buildNewsImpactRecoveryIncidentCenter(strategyRows = [], incidentEvents = [], acknowledgements = [], evidenceReason = 'ok', options = {}) {
  const priorityRank={critical:0,high:1,medium:2,low:3};
  const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
  const current=new Map((strategyRows || []).map(row=>[`${row.reason}|${row.action}`,row]));
  const ackMap=new Map((acknowledgements || []).map(row=>[newsImpactRecoveryIncidentKey(row.reason,row.action,row.code),row]));
  const groups=new Map();
  for (const event of incidentEvents || []) {
    const key=newsImpactRecoveryIncidentKey(event.reason,event.action,event.guardReason);
    const bucket=groups.get(key) || {
      code:event.guardReason,
      priority:event.priority || (event.guardReason==='performance_drift' ? 'high' : 'medium'),
      reason:event.reason,
      reasonLabel:event.reasonLabel || event.reason,
      action:event.action,
      actionLabel:event.actionLabel || event.action,
      firstSeenAt:event.at,
      lastSeenAt:event.at,
      occurrences:0,
      lastStrategy:event.strategy || 'fixed',
      lastRecovery:event.recovery || '',
      lastRecoveryLabel:event.recoveryLabel || event.recovery || '',
      episodeStartedAt:event.episodeStartedAt || event.at,
      episodeLastSeenAt:event.episodeLastSeenAt || event.at,
      episodeRecoveredAt:event.episodeRecoveredAt || null,
      episodeOccurrences:Number(event.episodeOccurrences || 1),
    };
    bucket.occurrences+=1;
    if (Date.parse(event.at)<Date.parse(bucket.firstSeenAt)) bucket.firstSeenAt=event.at;
    if (Date.parse(event.at)>Date.parse(bucket.lastSeenAt)) {
      bucket.lastSeenAt=event.at;
      bucket.lastStrategy=event.strategy || bucket.lastStrategy;
      bucket.lastRecovery=event.recovery || bucket.lastRecovery;
      bucket.lastRecoveryLabel=event.recoveryLabel || bucket.lastRecoveryLabel;
      bucket.episodeStartedAt=event.episodeStartedAt || event.at;
      bucket.episodeLastSeenAt=event.episodeLastSeenAt || event.at;
      bucket.episodeRecoveredAt=event.episodeRecoveredAt || null;
      bucket.episodeOccurrences=Number(event.episodeOccurrences || 1);
    }
    groups.set(key,bucket);
  }

  const withAcknowledgement=(item,active,currentOnly=false)=>{
    const ack=ackMap.get(newsImpactRecoveryIncidentKey(item.reason,item.action,item.code)) || null;
    const acknowledged=Boolean(
      active
      && !currentOnly
      && item.lastSeenAt
      && ack
      && String(ack.incidentSeenAt || '')===String(item.lastSeenAt || '')
      && Date.parse(ack.acknowledgedAt)>=Date.parse(item.lastSeenAt),
    );
    const status=active ? 'active' : 'recovered';
    const startedAt=item.episodeStartedAt || item.firstSeenAt || null;
    const lastEpisodeSeenAt=item.episodeLastSeenAt || item.lastSeenAt || null;
    const recoveredAt=!active ? (item.episodeRecoveredAt || null) : null;
    const startedMs=Date.parse(String(startedAt || ''));
    const recoveredMs=Date.parse(String(recoveredAt || ''));
    const acknowledgedMs=Date.parse(String(acknowledged ? ack?.acknowledgedAt || '' : ''));
    const ageMinutes=active && Number.isFinite(startedMs)
      ? Math.max(0,Math.floor((asOfMs-startedMs)/60000))
      : null;
    const ackLatencyMinutes=acknowledged && Number.isFinite(startedMs) && Number.isFinite(acknowledgedMs)
      ? Math.max(0,Math.round((acknowledgedMs-startedMs)/60000))
      : null;
    const recoveryLatencyMinutes=!active && Number.isFinite(startedMs) && Number.isFinite(recoveredMs)
      ? Math.max(0,Math.round((recoveredMs-startedMs)/60000))
      : null;
    const ackStatus=currentOnly || !Number.isFinite(startedMs)
      ? 'unavailable'
      : acknowledged
        ? (Number(ackLatencyMinutes || 0)<=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES ? 'met' : 'breached')
        : active
          ? (Number(ageMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES ? 'breached' : 'pending')
          : 'unavailable';
    const recoveryStatus=currentOnly || !Number.isFinite(startedMs)
      ? 'unavailable'
      : active
        ? (Number(ageMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES ? 'breached' : 'pending')
        : Number.isFinite(recoveredMs)
          ? (Number(recoveryLatencyMinutes || 0)<=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES ? 'met' : 'breached')
          : 'unavailable';
    let effectivePriority=item.priority || 'medium';
    let escalationReason='';
    if (active && recoveryStatus==='breached') {
      effectivePriority='critical';
      escalationReason='recovery_slo_breach';
    } else if (active && !acknowledged && Number(ageMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES) {
      effectivePriority='critical';
      escalationReason='ack_critical_overdue';
    } else if (active && !acknowledged && ackStatus==='breached') {
      effectivePriority=effectivePriority==='medium' ? 'high' : 'critical';
      escalationReason='ack_slo_breach';
    }
    return {
      ...item,
      status,
      acknowledged,
      acknowledgedAt:acknowledged ? ack.acknowledgedAt : null,
      alertSuppressed:acknowledged,
      canAcknowledge:Boolean(active && !currentOnly && item.lastSeenAt && NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(item.code)),
      runbook:newsImpactRecoveryIncidentRunbook(item.code),
      currentOnly:Boolean(currentOnly),
      effectivePriority,
      escalated:effectivePriority!==(item.priority || 'medium'),
      escalationReason,
      slo:{
        startedAt,
        lastSeenAt:lastEpisodeSeenAt,
        recoveredAt,
        ageMinutes,
        ackTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        ackCriticalMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        ackLatencyMinutes,
        recoveryLatencyMinutes,
        ackStatus,
        recoveryStatus,
      },
    };
  };

  const rows=[...groups.values()].map(item=>{
    const now=current.get(`${item.reason}|${item.action}`) || null;
    const active=Boolean(now && now.guardReason===item.code);
    return withAcknowledgement({
      ...item,
      currentStrategy:now?.strategy || '',
      currentRecovery:now?.selectedRecovery || '',
      currentRecoveryLabel:now?.selectedRecoveryLabel || now?.selectedRecovery || '',
      currentGuardReason:now?.guardReason || '',
    },active,false);
  });

  for (const now of strategyRows || []) {
    if (!NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(now.guardReason || ''))) continue;
    const exists=rows.some(x=>x.reason===now.reason && x.action===now.action && x.code===now.guardReason && x.status==='active');
    if (exists) continue;
    rows.push(withAcknowledgement({
      code:now.guardReason,
      priority:now.guardReason==='performance_drift' ? 'high' : 'medium',
      reason:now.reason,
      reasonLabel:now.reasonLabel || now.reason,
      action:now.action,
      actionLabel:now.actionLabel || now.action,
      firstSeenAt:null,
      lastSeenAt:null,
      occurrences:0,
      lastStrategy:now.strategy || 'fixed',
      lastRecovery:now.selectedRecovery || '',
      lastRecoveryLabel:now.selectedRecoveryLabel || now.selectedRecovery || '',
      currentStrategy:now.strategy || '',
      currentRecovery:now.selectedRecovery || '',
      currentRecoveryLabel:now.selectedRecoveryLabel || now.selectedRecovery || '',
      currentGuardReason:now.guardReason || '',
    },true,true));
  }

  if (String(evidenceReason || 'ok')!=='ok') {
    rows.unshift({
      code:'strategy_evidence_unavailable',
      priority:'medium',
      reason:'',
      reasonLabel:'Recovery Strategy',
      action:'',
      actionLabel:'',
      firstSeenAt:null,
      lastSeenAt:null,
      occurrences:0,
      lastStrategy:'fixed',
      lastRecovery:'',
      lastRecoveryLabel:'',
      status:'active',
      currentStrategy:'fixed',
      currentRecovery:'',
      currentRecoveryLabel:'',
      currentGuardReason:String(evidenceReason || 'evidence_unavailable'),
      currentOnly:true,
      acknowledged:false,
      acknowledgedAt:null,
      alertSuppressed:false,
      canAcknowledge:false,
      runbook:newsImpactRecoveryIncidentRunbook('strategy_evidence_unavailable'),
      effectivePriority:'medium',
      escalated:false,
      escalationReason:'',
      slo:{
        startedAt:null,lastSeenAt:null,recoveredAt:null,ageMinutes:null,
        ackTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        ackCriticalMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        ackLatencyMinutes:null,recoveryLatencyMinutes:null,ackStatus:'unavailable',recoveryStatus:'unavailable',
      },
    });
  }

  return rows.sort((a,b)=>(a.status==='active'?0:1)-(b.status==='active'?0:1)
    || (a.acknowledged?1:0)-(b.acknowledged?1:0)
    || (priorityRank[a.effectivePriority || a.priority] ?? 9)-(priorityRank[b.effectivePriority || b.priority] ?? 9)
    || (Date.parse(b.lastSeenAt || 0)-Date.parse(a.lastSeenAt || 0))
    || String(a.reason || '').localeCompare(String(b.reason || ''))
    || String(a.action || '').localeCompare(String(b.action || '')))
    .slice(0,30);
}
function summarizeNewsImpactRecoveryIncidents(rows = []) {
  const list=Array.isArray(rows) ? rows : [];
  const ackLatencies=list.map(x=>Number(x?.slo?.ackLatencyMinutes)).filter(Number.isFinite);
  const recoveryLatencies=list.map(x=>Number(x?.slo?.recoveryLatencyMinutes)).filter(Number.isFinite);
  return {
    total:list.length,
    active:list.filter(x=>x.status==='active').length,
    recovered:list.filter(x=>x.status==='recovered').length,
    highActive:list.filter(x=>x.status==='active' && x.priority==='high').length,
    mediumActive:list.filter(x=>x.status==='active' && x.priority==='medium').length,
    acknowledgedActive:list.filter(x=>x.status==='active' && x.acknowledged).length,
    unacknowledgedActive:list.filter(x=>x.status==='active' && !x.acknowledged).length,
    suppressedAlerts:list.filter(x=>x.status==='active' && x.alertSuppressed).length,
    escalatedActive:list.filter(x=>x.status==='active' && x.escalated).length,
    criticalActive:list.filter(x=>x.status==='active' && x.effectivePriority==='critical').length,
    ackSloBreached:list.filter(x=>x.status==='active' && x?.slo?.ackStatus==='breached').length,
    recoverySloBreached:list.filter(x=>x.status==='active' && x?.slo?.recoveryStatus==='breached').length,
    ackMeasured:ackLatencies.length,
    recoveryMeasured:recoveryLatencies.length,
    avgAckMinutes:ackLatencies.length ? Math.round((ackLatencies.reduce((a,b)=>a+b,0)/ackLatencies.length)*10)/10 : null,
    avgRecoveryMinutes:recoveryLatencies.length ? Math.round((recoveryLatencies.reduce((a,b)=>a+b,0)/recoveryLatencies.length)*10)/10 : null,
    latest:list.filter(x=>x.lastSeenAt).sort((a,b)=>Date.parse(b.lastSeenAt)-Date.parse(a.lastSeenAt))[0] || null,
  };
}

async function loadNewsImpactRecoveryStrategyEvidence(cfg) {
  const now=Date.now();
  const cached=memory.newsImpactRecoveryStrategy || {value:null,loadedAt:0};
  if (cached.value && now-Number(cached.loadedAt || 0)<NEWS_IMPACT_RECOVERY_STRATEGY_CACHE_MS) return cached.value;
  if (!hasSupabase(cfg)) {
    const value={available:false,truncated:false,reason:'supabase_unavailable',evidence:[],recentEvidence:[],priorEvidence:[],transitionHistory:[],incidentEvents:[],incidentAcknowledgements:[],incidentEpisodeHistory:[]};
    memory.newsImpactRecoveryStrategy={value,loadedAt:now};
    return value;
  }
  try {
    const since=new Date(now-NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS*86400_000).toISOString();
    const page=await supaSelectPaged(cfg,'growth_events',{
      created_at:`gte.${since}`,
      event_name:`in.(news_impact_outcome_failure,news_impact_recovery_attempt,news_impact_outcome,${NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT})`,
    },{pageSize:1000,maxRows:10000,order:'created_at.asc'});
    const rows=page.rows || [];
    const attempts=rows.filter(x=>String(x.event_name || '')==='news_impact_recovery_attempt');
    const outcomes=rows.filter(x=>String(x.event_name || '')==='news_impact_outcome');
    const failures=rows.filter(x=>String(x.event_name || '')==='news_impact_outcome_failure');
    const incidentAckRows=rows.filter(x=>String(x.event_name || '')===NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT);
    const recentCutoffMs=now-NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS*86400_000;
    const recentAttempts=attempts.filter(row=>{
      const at=newsImpactEventTime(row);
      return Number.isFinite(at) && at>=recentCutoffMs;
    });
    const priorAttempts=attempts.filter(row=>{
      const at=newsImpactEventTime(row);
      return Number.isFinite(at) && at<recentCutoffMs;
    });
    const evidence=buildNewsImpactRecoveryStrategyEvidence(attempts,outcomes,failures,{asOfMs:now});
    const recentEvidence=buildNewsImpactRecoveryStrategyEvidence(recentAttempts,outcomes,failures,{asOfMs:now});
    const priorEvidence=buildNewsImpactRecoveryStrategyEvidence(priorAttempts,outcomes,failures,{asOfMs:now});
    const transitionHistory=buildNewsImpactRecoveryTransitionHistory(failures,{limit:20});
    const incidentEvents=buildNewsImpactRecoveryIncidentEvents(failures,{limit:100});
    const incidentAcknowledgements=buildNewsImpactRecoveryIncidentAcknowledgements(incidentAckRows);
    const incidentEpisodeHistory=buildNewsImpactRecoveryIncidentEpisodeHistory(failures,incidentAckRows);
    const value={available:!page.truncated,truncated:Boolean(page.truncated),reason:page.truncated?'truncated':'ok',evidence,recentEvidence,priorEvidence,transitionHistory,incidentEvents,incidentAcknowledgements,incidentEpisodeHistory};
    memory.newsImpactRecoveryStrategy={value,loadedAt:now};
    return value;
  } catch {
    const value={available:false,truncated:false,reason:'load_failed',evidence:[],recentEvidence:[],priorEvidence:[],transitionHistory:[],incidentEvents:[],incidentAcknowledgements:[],incidentEpisodeHistory:[]};
    memory.newsImpactRecoveryStrategy={value,loadedAt:now};
    return value;
  }
}

async function selectNewsImpactRecoveryStrategy(cfg, reason = 'server_error', action = '') {
  const fixed=newsImpactRecoveryForFailure(reason,action);
  const loaded=await loadNewsImpactRecoveryStrategyEvidence(cfg);
  if (!loaded.available) {
    return {...fixed,strategy:'fixed',guardReason:loaded.reason || 'evidence_unavailable'};
  }
  const decision=newsImpactRecoveryStrategyDecision(reason,action,loaded.evidence,loaded.recentEvidence);
  const driftDecision=newsImpactRecoveryDriftDecision(decision,loaded.priorEvidence,loaded.recentEvidence);
  const recovery=newsImpactRecoveryPresentation(reason,action,driftDecision.selectedRecovery);
  return {...recovery,strategy:driftDecision.strategy,guardReason:driftDecision.guardReason,driftStatus:driftDecision.driftStatus};
}

function newsImpactRecoveryStrategyDrill() {
  const fixedRetry={reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',recovery:'retry',recoveryLabel:'повторить',observed:30,attempts:30,pending:0,recovered:6,failed:24,successPct:20,confidence:newsImpactConversionConfidence(6,30)};
  const better={reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',recovery:'open_full_ai',recoveryLabel:'открыть полный AI',observed:30,attempts:30,pending:0,recovered:25,failed:5,successPct:83.3,confidence:newsImpactConversionConfidence(25,30)};
  const adaptive=newsImpactRecoveryStrategyDecision('server_error','full_ai',[fixedRetry,better]);
  const lowBase={...fixedRetry,attempts:9,recovered:2,failed:7,successPct:22.2,confidence:newsImpactConversionConfidence(2,9)};
  const guarded=newsImpactRecoveryStrategyDecision('server_error','full_ai',[lowBase,better]);
  const overlapA={...fixedRetry,recovered:15,failed:15,successPct:50,confidence:newsImpactConversionConfidence(15,30)};
  const overlapB={...better,recovered:18,failed:12,successPct:60,confidence:newsImpactConversionConfidence(18,30)};
  const overlap=newsImpactRecoveryStrategyDecision('server_error','full_ai',[overlapA,overlapB]);
  return {
    pass:adaptive.strategy==='adaptive'
      && adaptive.selectedRecovery==='open_full_ai'
      && adaptive.liftPctPoints>NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS
      && guarded.strategy==='fixed'
      && guarded.guardReason==='baseline_sample'
      && overlap.strategy==='fixed'
      && overlap.guardReason==='no_significant_better',
    cases:6,
  };
}

function newsImpactRecoveryStabilityDrill() {
  const fixedLong={reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',recovery:'retry',recoveryLabel:'повторить',observed:40,attempts:40,pending:0,recovered:8,failed:32,successPct:20,confidence:newsImpactConversionConfidence(8,40)};
  const candidateLong={reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',recovery:'open_full_ai',recoveryLabel:'открыть полный AI',observed:40,attempts:40,pending:0,recovered:34,failed:6,successPct:85,confidence:newsImpactConversionConfidence(34,40)};
  const fixedRecent={...fixedLong,observed:10,attempts:10,recovered:3,failed:7,successPct:30,confidence:newsImpactConversionConfidence(3,10)};
  const candidateRecent={...candidateLong,observed:10,attempts:10,recovered:8,failed:2,successPct:80,confidence:newsImpactConversionConfidence(8,10)};
  const stable=newsImpactRecoveryStrategyDecision('server_error','full_ai',[fixedLong,candidateLong],[fixedRecent,candidateRecent]);
  const lowRecent={...candidateRecent,observed:5,attempts:5,recovered:4,failed:1,successPct:80,confidence:newsImpactConversionConfidence(4,5)};
  const sampleGuard=newsImpactRecoveryStrategyDecision('server_error','full_ai',[fixedLong,candidateLong],[fixedRecent,lowRecent]);
  const regressedRecent={...candidateRecent,recovered:2,failed:8,successPct:20,confidence:newsImpactConversionConfidence(2,10)};
  const regressionGuard=newsImpactRecoveryStrategyDecision('server_error','full_ai',[fixedLong,candidateLong],[fixedRecent,regressedRecent]);
  return {
    pass:stable.strategy==='adaptive'
      && stable.guardReason==='stable_significant_better'
      && stable.selectedRecovery==='open_full_ai'
      && sampleGuard.strategy==='fixed'
      && sampleGuard.guardReason==='stability_sample'
      && sampleGuard.proposedRecovery==='open_full_ai'
      && regressionGuard.strategy==='fixed'
      && regressionGuard.guardReason==='recent_regression',
    cases:7,
  };
}

function newsImpactRecoveryDriftDrill() {
  const adaptive={
    reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',
    fixedRecovery:'retry',fixedRecoveryLabel:'повторить',selectedRecovery:'open_full_ai',selectedRecoveryLabel:'открыть полный AI',
    proposedRecovery:'open_full_ai',proposedRecoveryLabel:'открыть полный AI',strategy:'adaptive',
    guardReason:'stable_significant_better',stability:'confirmed',
    fixedAttempts:50,fixedSuccessPct:35,fixedConfidence:newsImpactConversionConfidence(18,50),
    selectedAttempts:60,selectedSuccessPct:88.3,selectedConfidence:newsImpactConversionConfidence(53,60),liftPctPoints:53.3,
  };
  const prior=[{reason:'server_error',action:'full_ai',recovery:'open_full_ai',attempts:50,recovered:45,failed:5,successPct:90,confidence:newsImpactConversionConfidence(45,50)}];
  const driftRecent=[{reason:'server_error',action:'full_ai',recovery:'open_full_ai',attempts:10,recovered:4,failed:6,successPct:40,confidence:newsImpactConversionConfidence(4,10)}];
  const stableRecent=[{reason:'server_error',action:'full_ai',recovery:'open_full_ai',attempts:10,recovered:8,failed:2,successPct:80,confidence:newsImpactConversionConfidence(8,10)}];
  const shortRecent=[{reason:'server_error',action:'full_ai',recovery:'open_full_ai',attempts:5,recovered:2,failed:3,successPct:40,confidence:newsImpactConversionConfidence(2,5)}];
  const blocked=newsImpactRecoveryDriftDecision(adaptive,prior,driftRecent);
  const stable=newsImpactRecoveryDriftDecision(adaptive,prior,stableRecent);
  const insufficient=newsImpactRecoveryDriftDecision(adaptive,prior,shortRecent);
  return {
    pass:blocked.strategy==='fixed'
      && blocked.guardReason==='performance_drift'
      && blocked.driftDetected===true
      && blocked.selectedRecovery==='retry'
      && stable.strategy==='adaptive'
      && stable.driftStatus==='stable'
      && insufficient.strategy==='adaptive'
      && insufficient.driftStatus==='insufficient',
    cases:8,
  };
}

function newsImpactRecoveryTransitionDrill() {
  const rows=[
    {telegram_id:1,created_at:'2026-09-01T10:00:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'baseline_sample'}},
    {telegram_id:2,created_at:'2026-09-05T10:00:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'open_full_ai',strategy:'adaptive',strategy_guard:'stable_significant_better'}},
    {telegram_id:3,created_at:'2026-09-10T10:00:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'open_full_ai',strategy:'adaptive',strategy_guard:'stable_significant_better'}},
    {telegram_id:4,created_at:'2026-09-15T10:00:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'performance_drift'}},
    {telegram_id:5,created_at:'2026-09-16T10:00:00Z',metadata:{reason:'timeout',action:'share',recovery:'retry_soon',strategy:'fixed',strategy_guard:'fixed_default'}},
  ];
  const history=buildNewsImpactRecoveryTransitionHistory(rows);
  const summary=summarizeNewsImpactRecoveryTransitions(history);
  const alerts=buildNewsImpactRecoveryAdminAlerts([
    {reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',guardReason:'performance_drift',driftDropPctPoints:22.5},
    {reason:'timeout',reasonLabel:'Тайм-аут',action:'share',actionLabel:'Поделиться',guardReason:'stability_sample',proposedRecovery:'retry_soon'},
  ],'ok');
  return {
    pass:history.length===2
      && summary.fixedToAdaptive===1
      && summary.adaptiveToFixed===1
      && history[0]?.guardReason==='performance_drift'
      && !Object.prototype.hasOwnProperty.call(history[0] || {},'telegram_id')
      && alerts.filter(x=>x.severity==='warning').length===1
      && alerts.filter(x=>x.severity==='info').length===1
      && summarizeNewsImpactRecoveryAlerts(alerts).total===2,
    cases:8,
  };
}

function newsImpactRecoveryIncidentDrill() {
  const events=[
    {at:'2026-09-10T10:00:00.000Z',reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',recovery:'retry',recoveryLabel:'повторить',guardReason:'performance_drift',priority:'high'},
    {at:'2026-09-11T10:00:00.000Z',reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',recovery:'retry',recoveryLabel:'повторить',guardReason:'performance_drift',priority:'high'},
    {at:'2026-09-12T10:00:00.000Z',reason:'timeout',reasonLabel:'Тайм-аут',action:'share',actionLabel:'Поделиться',strategy:'fixed',recovery:'retry_soon',recoveryLabel:'повторить скоро',guardReason:'recent_regression',priority:'medium'},
  ];
  const current=[
    {reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',strategy:'adaptive',selectedRecovery:'open_full_ai',selectedRecoveryLabel:'открыть полный AI',guardReason:'stable_significant_better'},
    {reason:'timeout',reasonLabel:'Тайм-аут',action:'share',actionLabel:'Поделиться',strategy:'fixed',selectedRecovery:'retry_soon',selectedRecoveryLabel:'повторить скоро',guardReason:'recent_regression'},
    {reason:'provider_unavailable',reasonLabel:'Провайдер временно недоступен',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',selectedRecovery:'retry_later',selectedRecoveryLabel:'повторить позже',guardReason:'performance_drift'},
  ];
  const incidents=buildNewsImpactRecoveryIncidentCenter(current,events,[],'ok');
  const summary=summarizeNewsImpactRecoveryIncidents(incidents);
  return {
    pass:incidents.length===3
      && summary.active===2
      && summary.recovered===1
      && summary.highActive===1
      && summary.mediumActive===1
      && incidents.some(x=>x.reason==='server_error' && x.status==='recovered' && x.occurrences===2)
      && incidents.some(x=>x.reason==='provider_unavailable' && x.status==='active' && x.currentOnly===true)
      && !Object.prototype.hasOwnProperty.call(incidents[0] || {},'telegram_id'),
    cases:8,
  };
}

function newsImpactRecoveryIncidentSloDashboardDrill() {
  const asOfMs=Date.parse('2026-09-23T18:00:00.000Z');
  const failures=[
    {created_at:'2026-09-02T10:00:00.000Z',metadata:{reason:'server_error',action:'full_ai',strategy_guard:'performance_drift'}},
    {created_at:'2026-09-02T10:20:00.000Z',metadata:{reason:'server_error',action:'full_ai',strategy_guard:'fixed_default'}},
    {created_at:'2026-09-10T10:00:00.000Z',metadata:{reason:'timeout',action:'share',strategy_guard:'recent_regression'}},
    {created_at:'2026-09-10T17:00:00.000Z',metadata:{reason:'timeout',action:'share',strategy_guard:'fixed_default'}},
    {created_at:'2026-09-17T10:00:00.000Z',metadata:{reason:'provider_unavailable',action:'full_ai',strategy_guard:'performance_drift'}},
    {created_at:'2026-09-22T10:00:00.000Z',metadata:{reason:'server_error',action:'full_ai',strategy_guard:'recent_regression'}},
    {created_at:'2026-09-22T10:15:00.000Z',metadata:{reason:'server_error',action:'full_ai',strategy_guard:'fixed_default'}},
  ];
  const acknowledgements=[
    {created_at:'2026-09-02T10:10:00.000Z',metadata:{reason:'server_error',action:'full_ai',incident_guard:'performance_drift',incident_seen_at:'2026-09-02T10:00:00.000Z'}},
    {created_at:'2026-09-10T10:40:00.000Z',metadata:{reason:'timeout',action:'share',incident_guard:'recent_regression',incident_seen_at:'2026-09-10T10:00:00.000Z'}},
    {created_at:'2026-09-17T10:10:00.000Z',metadata:{reason:'provider_unavailable',action:'full_ai',incident_guard:'performance_drift',incident_seen_at:'2026-09-17T10:00:00.000Z'}},
    {created_at:'2026-09-22T10:05:00.000Z',metadata:{reason:'server_error',action:'full_ai',incident_guard:'recent_regression',incident_seen_at:'2026-09-22T10:00:00.000Z'}},
  ];
  const episodes=buildNewsImpactRecoveryIncidentEpisodeHistory(failures,acknowledgements);
  const dashboard=buildNewsImpactRecoveryIncidentSloDashboard(episodes,{asOfMs,weeks:4});
  const serverRepeat=dashboard.repeated.find(x=>x.reason==='server_error' && x.action==='full_ai');
  return {
    pass:episodes.length===4
      && dashboard.weekly.length===4
      && dashboard.summary.episodes===4
      && dashboard.summary.ackEligible===4
      && dashboard.summary.ackMet===3
      && dashboard.summary.recoveryEligible===4
      && dashboard.summary.recoveryMet===2
      && dashboard.summary.recurringPairs===1
      && serverRepeat?.episodes===2
      && dashboard.summary.ackDeltaPctPoints===100
      && dashboard.privacy.telegramIdsExposed===false
      && dashboard.privacy.rawErrorsExposed===false,
    cases:11,
  };
}


function newsImpactRecoveryIncidentSloBreachFeedDrill() {
  const asOfMs=Date.parse('2026-09-23T18:00:00.000Z');
  const episodes=[
    {
      reason:'server_error',reasonLabel:'Ошибка сервера',action:'full_ai',actionLabel:'Полный AI',
      startedAt:'2026-09-23T08:00:00.000Z',lastSeenAt:'2026-09-23T12:00:00.000Z',recoveredAt:null,
      occurrences:3,guardCodes:['performance_drift'],firstAcknowledgedAt:null,active:true,
    },
    {
      reason:'timeout',reasonLabel:'Таймаут',action:'share',actionLabel:'Поделиться',
      startedAt:'2026-09-20T08:00:00.000Z',lastSeenAt:'2026-09-20T10:00:00.000Z',recoveredAt:'2026-09-20T15:30:00.000Z',
      occurrences:2,guardCodes:['recent_regression'],firstAcknowledgedAt:'2026-09-20T08:10:00.000Z',active:false,
    },
    {
      reason:'match_missing',reasonLabel:'Матч не найден',action:'news',actionLabel:'Новости',
      startedAt:'2026-09-22T10:00:00.000Z',lastSeenAt:'2026-09-22T10:10:00.000Z',recoveredAt:'2026-09-22T10:20:00.000Z',
      occurrences:1,guardCodes:['recent_regression'],firstAcknowledgedAt:null,active:false,
    },
  ];
  const feed=buildNewsImpactRecoveryIncidentSloBreachFeed(episodes,{asOfMs,limit:20});
  return {
    pass:feed.summary.breachEpisodes===2
      && feed.summary.activeBreaches===1
      && feed.summary.critical===1
      && feed.summary.ackBreaches===1
      && feed.summary.recoveryBreaches===2
      && feed.items[0]?.severity==='critical'
      && feed.items.some(x=>x.reason==='timeout' && x.recoveryStatus==='breached' && x.ackStatus==='met')
      && feed.routingChanged===false
      && feed.privacy.telegramIdsExposed===false
      && feed.privacy.rawErrorsExposed===false
      && feed.privacy.freeTextExposed===false,
    cases:10,
  };
}


function newsImpactRecoveryIncidentSloBreachWatchlistDrill() {
  const feed={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    items:[
      {reason:'server_error',action:'full_ai',active:true,severity:'critical',ageMinutes:610,breachTypes:['ack','recovery'],startedAt:'2026-09-23T08:00:00.000Z'},
      {reason:'timeout',action:'share',active:true,severity:'high',ageMinutes:70,breachTypes:['ack'],startedAt:'2026-09-23T16:50:00.000Z'},
      {reason:'timeout',action:'share',active:false,severity:'high',ageMinutes:450,breachTypes:['recovery'],startedAt:'2026-09-20T08:00:00.000Z'},
    ],
    repeated:[
      {reason:'server_error',action:'full_ai',breachEpisodes:3,activeBreaches:1},
      {reason:'timeout',action:'share',breachEpisodes:2,activeBreaches:0},
    ],
  };
  const watchlist=buildNewsImpactRecoveryIncidentSloBreachWatchlist(feed,{limit:10});
  return {
    pass:watchlist.summary.active===2
      && watchlist.summary.criticalActive===1
      && watchlist.summary.ackActive===2
      && watchlist.summary.recoveryActive===1
      && watchlist.summary.oldestActiveMinutes===610
      && watchlist.summary.repeatedActivePairs===1
      && watchlist.items[0]?.reason==='server_error'
      && watchlist.thresholds.source==='rc87_existing_slo'
      && watchlist.routingChanged===false
      && watchlist.persistence==='none'
      && watchlist.privacy.telegramIdsExposed===false
      && watchlist.privacy.rawErrorsExposed===false
      && watchlist.privacy.freeTextExposed===false,
    cases:13,
  };
}


function newsImpactRecoveryIncidentSloBreachTriageDrill() {
  const watchlist={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    thresholds:{ackMinutes:30,criticalAckMinutes:120,recoveryMinutes:360,source:'rc87_existing_slo'},
    items:[
      {reason:'server_error',action:'full_ai',active:true,severity:'critical',ageMinutes:610,breachTypes:['ack','recovery'],startedAt:'2026-09-23T08:00:00.000Z'},
      {reason:'provider_unavailable',action:'full_ai',active:true,severity:'critical',ageMinutes:180,breachTypes:['ack'],startedAt:'2026-09-23T15:00:00.000Z'},
      {reason:'timeout',action:'share',active:true,severity:'high',ageMinutes:70,breachTypes:['ack'],startedAt:'2026-09-23T16:50:00.000Z'},
    ],
  };
  const triage=buildNewsImpactRecoveryIncidentSloBreachTriage(watchlist,{limit:10});
  return {
    pass:triage.summary.total===3
      && triage.summary.recoveryOverdue===1
      && triage.summary.ackCritical===1
      && triage.summary.ackOverdue===1
      && triage.items[0]?.triageStage==='recovery_overdue'
      && triage.items[1]?.triageStage==='ack_critical'
      && triage.items[2]?.triageStage==='ack_overdue'
      && triage.thresholds.source==='rc87_existing_slo'
      && triage.routingChanged===false
      && triage.persistence==='none'
      && triage.privacy.telegramIdsExposed===false
      && triage.privacy.rawErrorsExposed===false
      && triage.privacy.freeTextExposed===false,
    cases:13,
  };
}


function newsImpactRecoveryIncidentSloBreachTriageTrendDrill() {
  const asOfMs=Date.parse('2026-09-23T18:00:00.000Z');
  const episodes=[
    {
      reason:'server_error',reasonLabel:'Ошибка сервера',action:'full_ai',actionLabel:'Полный AI',
      startedAt:'2026-09-03T08:00:00.000Z',recoveredAt:null,firstAcknowledgedAt:null,
    },
    {
      reason:'timeout',reasonLabel:'Таймаут',action:'share',actionLabel:'Поделиться',
      startedAt:'2026-09-15T08:00:00.000Z',recoveredAt:null,firstAcknowledgedAt:'2026-09-15T09:00:00.000Z',
    },
    {
      reason:'provider_unavailable',reasonLabel:'Провайдер недоступен',action:'full_ai',actionLabel:'Полный AI',
      startedAt:'2026-09-23T15:30:00.000Z',recoveredAt:null,firstAcknowledgedAt:null,
    },
    {
      reason:'match_missing',reasonLabel:'Матч не найден',action:'news',actionLabel:'Новости',
      startedAt:'2026-09-10T10:00:00.000Z',recoveredAt:'2026-09-11T10:00:00.000Z',firstAcknowledgedAt:null,
    },
  ];
  const trend=buildNewsImpactRecoveryIncidentSloBreachTriageTrend(episodes,{asOfMs,weeks:4});
  const server=trend.stuck.find(x=>x.reason==='server_error' && x.action==='full_ai');
  return {
    pass:trend.weekly.length===4
      && trend.summary.currentTotal===3
      && trend.weekly[0].total===0
      && trend.weekly[1].total===1
      && trend.weekly[2].total===2
      && trend.weekly[3].recoveryOverdue===2
      && trend.summary.totalDelta===1
      && trend.summary.recoveryOverdueDelta===0
      && trend.summary.stuckPairs===2
      && server?.weeksPresent===3
      && server?.recoveryOverdueWeeks===3
      && trend.thresholds.source==='rc87_existing_slo'
      && trend.routingChanged===false
      && trend.persistence==='none'
      && trend.privacy.telegramIdsExposed===false,
    cases:14,
  };
}


function newsImpactRecoveryIncidentSloBreachImpactRankingDrill() {
  const asOfMs=Date.parse('2026-09-23T18:00:00.000Z');
  const episodes=[
    {
      reason:'server_error',reasonLabel:'Ошибка сервера',action:'full_ai',actionLabel:'Полный AI',
      startedAt:'2026-09-23T08:00:00.000Z',recoveredAt:null,firstAcknowledgedAt:null,
    },
    {
      reason:'server_error',reasonLabel:'Ошибка сервера',action:'full_ai',actionLabel:'Полный AI',
      startedAt:'2026-09-22T12:00:00.000Z',recoveredAt:'2026-09-22T20:00:00.000Z',firstAcknowledgedAt:'2026-09-22T13:00:00.000Z',
    },
    {
      reason:'timeout',reasonLabel:'Таймаут',action:'share',actionLabel:'Поделиться',
      startedAt:'2026-09-23T16:00:00.000Z',recoveredAt:null,firstAcknowledgedAt:'2026-09-23T17:00:00.000Z',
    },
    {
      reason:'match_missing',reasonLabel:'Матч не найден',action:'news',actionLabel:'Новости',
      startedAt:'2026-09-23T17:50:00.000Z',recoveredAt:'2026-09-23T17:55:00.000Z',firstAcknowledgedAt:null,
    },
  ];
  const result=buildNewsImpactRecoveryIncidentSloBreachImpactRanking(episodes,{asOfMs,limit:10});
  const top=result.ranking[0];
  const second=result.ranking[1];
  return {
    pass:result.summary.pairs===2
      && result.summary.activePairs===2
      && result.summary.breachEpisodes===3
      && result.summary.totalOverdueMinutes===990
      && result.summary.ackOverdueMinutes===630
      && result.summary.recoveryOverdueMinutes===360
      && result.summary.topContributionPct===97
      && top?.reason==='server_error'
      && top?.action==='full_ai'
      && top?.totalOverdueMinutes===960
      && top?.ackOverdueMinutes===600
      && top?.recoveryOverdueMinutes===360
      && top?.contributionPct===97
      && second?.reason==='timeout'
      && second?.totalOverdueMinutes===30
      && result.methodology==='sum_minutes_above_existing_ack_and_recovery_slo'
      && result.thresholds.source==='rc87_existing_slo'
      && result.routingChanged===false
      && result.persistence==='none'
      && result.privacy.telegramIdsExposed===false,
    cases:18,
  };
}


function newsImpactRecoveryIncidentSloBreachImpactTrendDrill() {
  const asOfMs=Date.parse('2026-09-23T18:00:00.000Z');
  const episodes=[
    {
      reason:'server_error',reasonLabel:'Ошибка сервера',action:'full_ai',actionLabel:'Полный AI',
      startedAt:'2026-09-03T00:00:00.000Z',recoveredAt:'2026-09-12T00:00:00.000Z',firstAcknowledgedAt:'2026-09-03T02:00:00.000Z',
    },
    {
      reason:'timeout',reasonLabel:'Таймаут',action:'share',actionLabel:'Поделиться',
      startedAt:'2026-09-17T18:00:00.000Z',recoveredAt:null,firstAcknowledgedAt:'2026-09-17T19:00:00.000Z',
    },
    {
      reason:'provider_unavailable',reasonLabel:'Провайдер недоступен',action:'market',actionLabel:'Рынок',
      startedAt:'2026-09-01T00:00:00.000Z',recoveredAt:null,firstAcknowledgedAt:null,
    },
  ];
  const trend=buildNewsImpactRecoveryIncidentSloBreachImpactTrend(episodes,{asOfMs,weeks:4,limit:10});
  const timeout=trend.pairs.find(x=>x.reason==='timeout');
  const server=trend.pairs.find(x=>x.reason==='server_error');
  const provider=trend.pairs.find(x=>x.reason==='provider_unavailable');
  return {
    pass:trend.weekly.length===4
      && trend.weekly[2].totalOverdueMinutes===23400
      && trend.weekly[3].totalOverdueMinutes===28470
      && trend.summary.currentOverdueMinutes===28470
      && trend.summary.previousOverdueMinutes===23400
      && trend.summary.deltaMinutes===5070
      && trend.summary.increasedPairs===1
      && trend.summary.decreasedPairs===1
      && trend.summary.unchangedPairs===1
      && timeout?.deltaMinutes===8310
      && timeout?.direction==='increased'
      && timeout?.currentContributionPct===29.2
      && server?.deltaMinutes===-3240
      && server?.direction==='decreased'
      && provider?.deltaMinutes===0
      && provider?.direction==='unchanged'
      && trend.methodology==='weekly_overlap_minutes_above_existing_ack_and_recovery_slo'
      && trend.thresholds.source==='rc87_existing_slo'
      && trend.routingChanged===false
      && trend.persistence==='none'
      && trend.privacy.telegramIdsExposed===false,
    cases:18,
  };
}


function newsImpactRecoveryIncidentSloImpactConcentrationDrill() {
  const ranking={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    summary:{pairs:6,totalOverdueMinutes:1000},
    thresholds:{ackMinutes:30,criticalAckMinutes:120,recoveryMinutes:360,source:'rc87_existing_slo'},
    ranking:[
      {reason:'server_error',action:'full_ai',contributionPct:40,totalOverdueMinutes:400,activeEpisodes:1},
      {reason:'timeout',action:'share',contributionPct:25,totalOverdueMinutes:250,activeEpisodes:1},
      {reason:'provider_unavailable',action:'full_ai',contributionPct:15,totalOverdueMinutes:150,activeEpisodes:0},
      {reason:'match_missing',action:'news',contributionPct:10,totalOverdueMinutes:100,activeEpisodes:1},
      {reason:'data_invalid',action:'recheck',contributionPct:5,totalOverdueMinutes:50,activeEpisodes:0},
      {reason:'other',action:'market',contributionPct:5,totalOverdueMinutes:50,activeEpisodes:0},
    ],
  };
  const result=buildNewsImpactRecoveryIncidentSloImpactConcentration(ranking);
  return {
    pass:result.summary.pairs===6
      && result.summary.totalOverdueMinutes===1000
      && result.summary.top1ContributionPct===40
      && result.summary.top3ContributionPct===80
      && result.summary.top5ContributionPct===95
      && result.summary.residualAfterTop5Pct===5
      && result.summary.coveredPairs===5
      && result.rows.length===5
      && result.rows[2]?.cumulativeContributionPct===80
      && result.methodology==='cumulative_share_of_total_overdue_minutes'
      && result.thresholds.source==='rc87_existing_slo'
      && result.routingChanged===false
      && result.persistence==='none'
      && result.privacy.telegramIdsExposed===false,
    cases:13,
  };
}


function newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill() {
  const asOfMs=Date.parse('2026-09-23T18:00:00.000Z');
  const mk=(reason,action,startedAt,ackAt,recoveredAt)=>({
    reason,reasonLabel:reason,action,actionLabel:action,startedAt,firstAcknowledgedAt:ackAt,recoveredAt,
  });
  const episodes=[
    mk('a','full_ai','2026-09-10T00:00:00.000Z','2026-09-10T02:00:00.000Z','2026-09-10T02:10:00.000Z'),
    mk('b','share','2026-09-11T00:00:00.000Z','2026-09-11T01:30:00.000Z','2026-09-11T01:40:00.000Z'),
    mk('c','news','2026-09-12T00:00:00.000Z','2026-09-12T01:00:00.000Z','2026-09-12T01:10:00.000Z'),
    mk('d','market','2026-09-13T00:00:00.000Z','2026-09-13T00:40:00.000Z','2026-09-13T00:50:00.000Z'),
    mk('e','recheck','2026-09-14T00:00:00.000Z','2026-09-14T00:40:00.000Z','2026-09-14T00:50:00.000Z'),
    mk('f','squads','2026-09-15T00:00:00.000Z','2026-09-15T00:40:00.000Z','2026-09-15T00:50:00.000Z'),
    mk('a','full_ai','2026-09-17T00:00:00.000Z','2026-09-17T02:30:00.000Z','2026-09-17T02:40:00.000Z'),
    mk('b','share','2026-09-18T00:00:00.000Z','2026-09-18T01:30:00.000Z','2026-09-18T01:40:00.000Z'),
    mk('c','news','2026-09-19T00:00:00.000Z','2026-09-19T01:00:00.000Z','2026-09-19T01:10:00.000Z'),
    mk('d','market','2026-09-20T00:00:00.000Z','2026-09-20T00:50:00.000Z','2026-09-20T01:00:00.000Z'),
    mk('e','recheck','2026-09-21T00:00:00.000Z','2026-09-21T00:40:00.000Z','2026-09-21T00:50:00.000Z'),
    mk('f','squads','2026-09-22T00:00:00.000Z','2026-09-22T00:40:00.000Z','2026-09-22T00:50:00.000Z'),
  ];
  const result=buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(episodes,{asOfMs,weeks:2});
  const previous=result.weekly[0];
  const current=result.weekly[1];
  return {
    pass:result.weekly.length===2
      && previous?.totalOverdueMinutes===210
      && previous?.top1ContributionPct===42.9
      && previous?.top3ContributionPct===85.7
      && previous?.top5ContributionPct===95.2
      && current?.totalOverdueMinutes===250
      && current?.top1ContributionPct===48
      && current?.top3ContributionPct===84
      && current?.top5ContributionPct===96
      && result.summary.top1DeltaPctPoints===5.1
      && result.summary.top3DeltaPctPoints===-1.7
      && result.summary.top5DeltaPctPoints===0.8
      && result.summary.top1Direction==='increased'
      && result.summary.top3Direction==='decreased'
      && result.summary.top5Direction==='increased'
      && result.methodology==='weekly_cumulative_share_of_total_overdue_minutes'
      && result.thresholds.source==='rc87_existing_slo'
      && result.routingChanged===false
      && result.persistence==='none'
      && result.privacy.telegramIdsExposed===false,
    cases:18,
  };
}


function newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill() {
  const ranking={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    summary:{pairs:4,activePairs:2,breachEpisodes:7,totalOverdueMinutes:1000,ackOverdueMinutes:650,recoveryOverdueMinutes:350},
    thresholds:{ackMinutes:30,criticalAckMinutes:120,recoveryMinutes:360,source:'rc87_existing_slo'},
    ranking:[
      {reason:'server_error',reasonLabel:'Ошибка сервера',action:'full_ai',actionLabel:'Полный AI',totalOverdueMinutes:400,contributionPct:40,activeEpisodes:1,ackOverdueMinutes:250,recoveryOverdueMinutes:150},
    ],
  };
  const trend={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    summary:{currentOverdueMinutes:300,previousOverdueMinutes:220,deltaMinutes:80,increasedPairs:2,decreasedPairs:1,unchangedPairs:1},
  };
  const concentration={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    summary:{top1ContributionPct:40,top3ContributionPct:85,top5ContributionPct:100},
  };
  const concentrationTrend={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    summary:{
      top1DeltaPctPoints:5,
      top3DeltaPctPoints:-2,
      top5DeltaPctPoints:0,
      top1Direction:'increased',
      top3Direction:'decreased',
      top5Direction:'unchanged',
    },
  };
  const result=buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(ranking,trend,concentration,concentrationTrend);
  return {
    pass:result.available===true
      && result.summary.cumulativeOverdueMinutes===1000
      && result.summary.cumulativeAckOverdueMinutes===650
      && result.summary.cumulativeRecoveryOverdueMinutes===350
      && result.summary.currentWeekOverdueMinutes===300
      && result.summary.weekDeltaMinutes===80
      && result.summary.activePairs===2
      && result.summary.top1ContributionPct===40
      && result.summary.top3ContributionPct===85
      && result.summary.top1WeeklyDeltaPctPoints===5
      && result.summary.top3WeeklyDirection==='decreased'
      && result.topPair?.reason==='server_error'
      && result.topPair?.totalOverdueMinutes===400
      && result.sourceReleases.join(',')==='RC93,RC94,RC95,RC96'
      && result.methodology==='summary_of_existing_slo_impact_views'
      && result.thresholds.source==='rc87_existing_slo'
      && result.routingChanged===false
      && result.persistence==='none'
      && result.privacy.telegramIdsExposed===false,
    cases:19,
  };
}


function newsImpactRecoveryIncidentSloImpactFocusQueueDrill() {
  const ranking={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    summary:{pairs:4,activePairs:3},
    thresholds:{ackMinutes:30,criticalAckMinutes:120,recoveryMinutes:360,source:'rc87_existing_slo'},
    ranking:[
      {reason:'a',action:'full_ai',totalOverdueMinutes:900,contributionPct:45,activeEpisodes:1,ackOverdueMinutes:500,recoveryOverdueMinutes:400},
      {reason:'b',action:'share',totalOverdueMinutes:700,contributionPct:35,activeEpisodes:1,ackOverdueMinutes:400,recoveryOverdueMinutes:300},
      {reason:'c',action:'news',totalOverdueMinutes:300,contributionPct:15,activeEpisodes:1,ackOverdueMinutes:200,recoveryOverdueMinutes:100},
      {reason:'d',action:'market',totalOverdueMinutes:100,contributionPct:5,activeEpisodes:0,ackOverdueMinutes:100,recoveryOverdueMinutes:0},
    ],
  };
  const trend={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    summary:{currentOverdueMinutes:500,deltaMinutes:80},
    pairs:[
      {reason:'a',action:'full_ai',currentOverdueMinutes:180,previousOverdueMinutes:200,deltaMinutes:-20,direction:'decreased',currentContributionPct:36},
      {reason:'b',action:'share',currentOverdueMinutes:210,previousOverdueMinutes:120,deltaMinutes:90,direction:'increased',currentContributionPct:42},
      {reason:'c',action:'news',currentOverdueMinutes:90,previousOverdueMinutes:80,deltaMinutes:10,direction:'increased',currentContributionPct:18},
      {reason:'d',action:'market',currentOverdueMinutes:20,previousOverdueMinutes:20,deltaMinutes:0,direction:'unchanged',currentContributionPct:4},
    ],
  };
  const executive={
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    summary:{breachPairs:4,activePairs:3,currentWeekOverdueMinutes:500,weekDeltaMinutes:80},
  };
  const result=buildNewsImpactRecoveryIncidentSloImpactFocusQueue(ranking,trend,executive,{limit:3});
  return {
    pass:result.summary.queuedPairs===3
      && result.summary.breachPairs===4
      && result.summary.activePairs===3
      && result.summary.currentWeekOverdueMinutes===500
      && result.summary.weekDeltaMinutes===80
      && result.summary.increasingQueuedPairs===2
      && result.summary.decreasingQueuedPairs===1
      && result.rows[0]?.reason==='b'
      && result.rows[0]?.queuePosition===1
      && result.rows[1]?.reason==='a'
      && result.rows[2]?.reason==='c'
      && result.ordering==='current_week_overdue_then_week_delta_then_cumulative_overdue'
      && result.thresholds.source==='rc87_existing_slo'
      && result.routingChanged===false
      && result.persistence==='none'
      && result.privacy.telegramIdsExposed===false,
    cases:16,
  };
}

function newsImpactRecoveryIncidentSloDrill() {
  const asOfMs=Date.parse('2026-09-23T18:00:00.000Z');
  const failures=[
    {created_at:'2026-09-23T15:00:00.000Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'performance_drift'}},
    {created_at:'2026-09-23T15:10:00.000Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'performance_drift'}},
    {created_at:'2026-09-23T16:00:00.000Z',metadata:{reason:'timeout',action:'share',recovery:'retry_soon',strategy:'fixed',strategy_guard:'recent_regression'}},
    {created_at:'2026-09-23T16:40:00.000Z',metadata:{reason:'timeout',action:'share',recovery:'retry_soon',strategy:'fixed',strategy_guard:'fixed_default'}},
    {created_at:'2026-09-23T11:00:00.000Z',metadata:{reason:'provider_unavailable',action:'full_ai',recovery:'retry_later',strategy:'fixed',strategy_guard:'performance_drift'}},
  ];
  const events=buildNewsImpactRecoveryIncidentEvents(failures);
  const acknowledgements=buildNewsImpactRecoveryIncidentAcknowledgements([
    {created_at:'2026-09-23T11:20:00.000Z',metadata:{reason:'provider_unavailable',action:'full_ai',incident_guard:'performance_drift',incident_seen_at:'2026-09-23T11:00:00.000Z'}},
  ]);
  const current=[
    {reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',selectedRecovery:'retry',selectedRecoveryLabel:'повторить',guardReason:'performance_drift'},
    {reason:'timeout',reasonLabel:'Тайм-аут',action:'share',actionLabel:'Поделиться',strategy:'fixed',selectedRecovery:'retry_soon',selectedRecoveryLabel:'повторить скоро',guardReason:'fixed_default'},
    {reason:'provider_unavailable',reasonLabel:'Источник данных недоступен',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',selectedRecovery:'retry_later',selectedRecoveryLabel:'повторить позже',guardReason:'performance_drift'},
  ];
  const incidents=buildNewsImpactRecoveryIncidentCenter(current,events,acknowledgements,'ok',{asOfMs});
  const summary=summarizeNewsImpactRecoveryIncidents(incidents);
  const server=incidents.find(x=>x.reason==='server_error');
  const timeout=incidents.find(x=>x.reason==='timeout');
  const provider=incidents.find(x=>x.reason==='provider_unavailable');
  return {
    pass:server?.status==='active'
      && server?.slo?.ageMinutes===180
      && server?.slo?.ackStatus==='breached'
      && server?.effectivePriority==='critical'
      && timeout?.status==='recovered'
      && timeout?.slo?.recoveryLatencyMinutes===40
      && timeout?.slo?.recoveryStatus==='met'
      && provider?.acknowledged===true
      && provider?.slo?.ackLatencyMinutes===20
      && provider?.slo?.recoveryStatus==='breached'
      && provider?.effectivePriority==='critical'
      && summary.criticalActive===2
      && summary.ackSloBreached===1
      && summary.recoverySloBreached===1,
    cases:14,
  };
}

function newsImpactRecoveryIncidentAckDrill() {
  const events=[
    {at:'2026-09-10T10:00:00.000Z',reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',recovery:'retry',recoveryLabel:'повторить',guardReason:'performance_drift',priority:'high'},
    {at:'2026-09-12T10:00:00.000Z',reason:'timeout',reasonLabel:'Тайм-аут',action:'share',actionLabel:'Поделиться',strategy:'fixed',recovery:'retry_soon',recoveryLabel:'повторить скоро',guardReason:'recent_regression',priority:'medium'},
  ];
  const ackRows=[
    {created_at:'2026-09-10T10:05:00.000Z',metadata:{reason:'server_error',action:'full_ai',incident_guard:'performance_drift',incident_seen_at:'2026-09-10T10:00:00.000Z'}},
    {created_at:'2026-09-12T09:00:00.000Z',metadata:{reason:'timeout',action:'share',incident_guard:'recent_regression',incident_seen_at:'2026-09-11T10:00:00.000Z'}},
  ];
  const acknowledgements=buildNewsImpactRecoveryIncidentAcknowledgements(ackRows);
  const current=[
    {reason:'server_error',reasonLabel:'Временная серверная ошибка',action:'full_ai',actionLabel:'Полный AI',strategy:'fixed',selectedRecovery:'retry',selectedRecoveryLabel:'повторить',guardReason:'performance_drift'},
    {reason:'timeout',reasonLabel:'Тайм-аут',action:'share',actionLabel:'Поделиться',strategy:'fixed',selectedRecovery:'retry_soon',selectedRecoveryLabel:'повторить скоро',guardReason:'recent_regression'},
  ];
  const incidents=buildNewsImpactRecoveryIncidentCenter(current,events,acknowledgements,'ok');
  const alerts=buildNewsImpactRecoveryAdminAlerts(current,'ok',incidents);
  const drift=incidents.find(x=>x.code==='performance_drift');
  const regression=incidents.find(x=>x.code==='recent_regression');
  return {
    pass:drift?.acknowledged===true
      && drift?.alertSuppressed===true
      && drift?.canAcknowledge===true
      && regression?.acknowledged===false
      && alerts.some(x=>x.code==='recent_regression')
      && !alerts.some(x=>x.code==='performance_drift')
      && newsImpactRecoveryIncidentRunbook('performance_drift').steps.length>=3
      && !Object.prototype.hasOwnProperty.call(drift || {},'telegram_id'),
    cases:8,
  };
}

function newsImpactRecoveryKeyboard(request, decision, action, fixtureId, recovery = 'retry') {
  const r=cleanNewsImpactRecoveryCode(recovery) || 'retry';
  const retryLabel=r==='retry_soon' ? '🔄 Повторить через несколько секунд'
    : r==='retry_later' ? '🕒 Повторить позже'
      : r==='wait_quota_reset' ? '⏳ Повторить после обновления лимита'
        : '🔄 Повторить';
  const rows=[];
  if (r==='open_search') {
    rows.push([{text:'🔎 Выбрать другой матч',web_app:{url:telegramWebAppUrl(request,{view:'search'})}}]);
  } else if (r==='open_full_ai') {
    rows.push([{text:'📊 Открыть полный AI',web_app:{url:newsImpactRecoveryAnalysisUrl(request,fixtureId,decision,action,'open_full_ai')}}]);
  } else {
    rows.push([{text:retryLabel,callback_data:newsImpactRecoveryCallback(decision,action,r,fixtureId)}]);
  }
  if (action!=='full_ai' && r!=='open_full_ai') rows.push([{text:'📊 Открыть полный AI',web_app:{url:newsImpactRecoveryAnalysisUrl(request,fixtureId,decision,action,'open_full_ai')}}]);
  return {inline_keyboard:rows};
}

async function sendNewsImpactRecoveryMessage(request,cfg,{userId,chatId,fixtureId,decision,action,error,fallback='server_error'}={}) {
  const reason=newsImpactFailureCode(error,fallback);
  const recovery=await selectNewsImpactRecoveryStrategy(cfg,reason,action);
  await recordNewsImpactFailure(cfg,{
    userId,fixtureId,decision,action,channel:'telegram',reason,recovery:recovery.code,strategy:recovery.strategy,strategyReason:recovery.guardReason,status:Number(error?.status || 0),
  });
  await telegramApi('sendMessage',cfg,{
    chat_id:chatId,
    text:`⚠️ ${recovery.message}`,
    reply_markup:newsImpactRecoveryKeyboard(request,decision,action,fixtureId,recovery.code),
  }).catch(()=>null);
  return {reason,recovery};
}

function newsImpactFunnelConfidenceDrill() {
  const insufficient=newsImpactConversionConfidence(1,3);
  const early=newsImpactConversionConfidence(5,10);
  const stable=newsImpactConversionConfidence(24,30);
  return {
    pass:insufficient.status==='insufficient'
      && insufficient.eligibleForBottleneck===false
      && early.status==='early'
      && early.eligibleForBottleneck===true
      && early.lowerPct<50
      && early.upperPct>50
      && stable.status==='stable'
      && stable.stable===true,
    cases:8,
  };
}

function newsImpactTrendSignal(current = {}, previous = {}) {
  const currentConfidence=current?.confidence || {};
  const previousConfidence=previous?.confidence || {};
  if (!currentConfidence.eligibleForBottleneck || !previousConfidence.eligibleForBottleneck) return 'insufficient';
  if (Number(currentConfidence.lowerPct || 0)>Number(previousConfidence.upperPct || 0)) return 'improved';
  if (Number(currentConfidence.upperPct || 0)<Number(previousConfidence.lowerPct || 0)) return 'weakened';
  return 'uncertain';
}

function buildNewsImpactActionTrend(currentRows = [], previousRows = []) {
  const previousByCode=new Map((previousRows || []).map(row=>[String(row.code || ''),row]));
  return (currentRows || []).map(current=>{
    const previous=previousByCode.get(String(current.code || '')) || {
      code:String(current.code || ''),label:String(current.label || ''),
      users:0,actedUsers:0,conversionPct:0,
      confidence:newsImpactConversionConfidence(0,0),
    };
    const signal=newsImpactTrendSignal(current,previous);
    const deltaPctPoints=Math.round((Number(current.conversionPct || 0)-Number(previous.conversionPct || 0))*10)/10;
    return {
      code:String(current.code || ''),
      label:String(current.label || ''),
      signal,
      deltaPctPoints,
      currentUsers:Number(current.users || 0),
      previousUsers:Number(previous.users || 0),
      currentPct:Number(current.conversionPct || 0),
      previousPct:Number(previous.conversionPct || 0),
      currentConfidence:current.confidence || newsImpactConversionConfidence(0,0),
      previousConfidence:previous.confidence || newsImpactConversionConfidence(0,0),
    };
  });
}

function newsImpactActionTrendDrill() {
  const current=[
    {code:'material',label:'material',users:30,conversionPct:66.7,confidence:newsImpactConversionConfidence(20,30)},
    {code:'stable',label:'stable',users:30,conversionPct:50,confidence:newsImpactConversionConfidence(15,30)},
    {code:'detail',label:'detail',users:5,conversionPct:40,confidence:newsImpactConversionConfidence(2,5)},
  ];
  const previous=[
    {code:'material',label:'material',users:30,conversionPct:16.7,confidence:newsImpactConversionConfidence(5,30)},
    {code:'stable',label:'stable',users:30,conversionPct:46.7,confidence:newsImpactConversionConfidence(14,30)},
    {code:'detail',label:'detail',users:5,conversionPct:20,confidence:newsImpactConversionConfidence(1,5)},
  ];
  const trend=buildNewsImpactActionTrend(current,previous);
  return {
    pass:trend.find(x=>x.code==='material')?.signal==='improved'
      && trend.find(x=>x.code==='stable')?.signal==='uncertain'
      && trend.find(x=>x.code==='detail')?.signal==='insufficient'
      && trend.find(x=>x.code==='material')?.deltaPctPoints===50,
    cases:4,
  };
}

function newsImpactDecisionKeyboard(request, match = {}, favorites = [], newsImpact = null) {
  const fixtureId=Number(match?.fixtureId || 0);
  if (!fixtureId) return footballBotKeyboard(request);
  const card=newsImpactDecisionCard(newsImpact);
  const decision=cleanNewsImpactDecisionCode(card?.code) || 'unavailable';
  const tracked=(action,text)=>({text,callback_data:newsImpactActionCallback(decision,action,fixtureId)});
  const fullAi=(text)=>({text,web_app:{url:newsImpactTrackedAnalysisUrl(request,fixtureId,decision)}});
  const rows=[];
  if (decision==='material') {
    rows.push([fullAi('📊 Открыть обновлённый AI-разбор')]);
    rows.push([tracked('squads','👥 Проверить составы'),tracked('market','💹 Проверить рынок')]);
  } else if (decision==='detail') {
    rows.push([fullAi('🧠 Открыть полный разбор')]);
    rows.push([tracked('recheck','🔄 Перепроверить AI')]);
  } else if (decision==='stable') {
    rows.push([tracked('news','📰 Ещё новости'),fullAi('📊 Полный AI-разбор')]);
  } else {
    rows.push([tracked('recheck','🔄 Повторить AI-проверку'),fullAi('📊 Полный AI-разбор')]);
  }
  const favoriteRow=favoriteMatchTeamRow(match,favorites);
  if (favoriteRow.length) rows.push(favoriteRow);
  rows.push([tracked('share','↗ Поделиться матчем')]);
  return {inline_keyboard:rows};
}
function newsImpactDecisionDrill() {
  const material=newsImpactDecisionCard({requested:true,compared:true,material:true,stable:false,reasonCode:'material_change'});
  const stable=newsImpactDecisionCard({requested:true,compared:true,material:false,stable:true,reasonCode:'stable'});
  const guarded=newsImpactDecisionCard({requested:true,compared:false,material:false,stable:true,reasonCode:'snapshot_not_before_news'});
  return {pass:material?.code==='material' && material?.priority===4 && stable?.code==='stable' && guarded?.code==='guarded' && guarded?.label==='Причинность не подтверждается',cases:5};
}

function botAiHandoffText(data = {}) {
  const match=data.match || {};
  const ai=data.aiInstructor || {};
  const signal=ai.betSignal || {};
  const verdict=ai.verdict || {};
  const trust=ai.dataTrust || {};
  const confidence=Number.isFinite(Number(ai.confidenceScore)) ? `${Math.round(Number(ai.confidenceScore))}/100` : '—';
  const trustScore=Number.isFinite(Number(trust.score)) ? `${Math.round(Number(trust.score))}%` : '—';
  const skip=signal.code==='skip';
  const freshness=data.freshness || analysisFreshness(data);
  const handoff=data.kickoffHandoff || analysisKickoffHandoff(data);
  const handoffLocked=Boolean(handoff?.locked);
  const freshIcon=freshness.needsRecheck?'🟠':freshness.state==='started'?'⚪':'🟢';
  const delta=data?.recheck?.performed ? data?.recheck?.delta : null;
  const newsImpact=data?.newsImpact || null;
  const deltaLines=!newsImpact?.requested && delta?.available ? [delta.summary,...(delta.items || []).slice(0,3).map(item=>`• ${item.title}${item.after?`: ${item.after}`:''}`)] : [];
  const newsDecision=newsImpactDecisionCard(newsImpact);
  const newsImpactLines=newsImpact?.requested
    ? [
        newsDecision ? `${newsDecision.icon} ${newsDecision.label}` : 'Новостной контекст проверен.',
        newsDecision?.headline || newsImpact.summary || 'Новостной контекст проверен.',
        newsImpact.compared
          ? `Существенность: ${newsImpact.material ? 'есть существенные изменения' : newsImpact.stable ? 'значимых изменений нет' : 'изменились отдельные детали'}.`
          : 'Существенность: сравнение до/после не выполнено.',
        ...(newsImpact.items || []).slice(0,3).map(item=>`• ${item.title}${item.before&&item.after?`: ${item.before} → ${item.after}`:item.after?`: ${item.after}`:''}`),
        newsDecision?.action ? `Что делать: ${newsDecision.action}` : '',
      ].filter(Boolean)
    : [];
  return [
    '🧠 <b>MatchRadar AI · короткая оценка</b>',
    `<b>${telegramHtmlEscape(match.home?.name || 'Хозяева')} — ${telegramHtmlEscape(match.away?.name || 'Гости')}</b>`,
    '',
    handoffLocked
      ? `⏱ <b>Предматчевый сигнал зафиксирован: ${telegramHtmlEscape(signal.label || 'без сигнала')}</b>`
      : `🎯 ${skip ? '<b>Сигнала нет — матч лучше пропустить</b>' : `<b>${telegramHtmlEscape(signal.label || 'Изучить матч')}</b>`}`,
    `📊 Исход: ${telegramHtmlEscape(verdict.outcome || '—')}`,
    `🧠 Уверенность: ${telegramHtmlEscape(ai.confidenceLabel || '—')} · ${confidence}`,
    `⚠️ Риск: ${telegramHtmlEscape(ai.riskLabel || '—')}`,
    `🗂 Данные: ${telegramHtmlEscape(trust.label || '—')} · ${trustScore}`,
    `${freshIcon} Свежесть: <b>${telegramHtmlEscape(freshness.label || '—')}</b> · ${Number(freshness.ageMinutes || 0)} мин.`,
    '',
    handoffLocked
      ? `До старта AI объяснял сигнал так: ${telegramHtmlEscape(signal.reason || ai.riskNote || 'по доступным предматчевым данным')}`
      : `Почему: ${telegramHtmlEscape(signal.reason || ai.riskNote || 'Оцениваю доступные данные матча.')}`,
    freshness.reason ? `Свежесть: ${telegramHtmlEscape(freshness.reason)}` : '',
    handoff?.state==='imminent' ? `⏳ ${telegramHtmlEscape(handoff.label)}: ${telegramHtmlEscape(handoff.reason)}` : '',
    handoffLocked ? `➡️ ${telegramHtmlEscape(handoff.reason)}` : '',
    ...(newsImpactLines.length ? ['',`📰 <b>News Impact Delta</b>`,...newsImpactLines.map(telegramHtmlEscape)] : []),
    ...(deltaLines.length ? ['',`🔄 <b>Что изменилось после перепроверки</b>`,...deltaLines.map(telegramHtmlEscape)] : []),
    '',
    handoffLocked
      ? '<i>После стартового свистка MatchRadar AI не превращает предматчевый сигнал в live-рекомендацию. Используйте центр матча для счёта, событий и статистики.</i>'
      : '<i>Полный AI-разбор откроется сразу на этом матче — повторно искать его не нужно.</i>',
  ].join('\n');
}

function botRefereeText(data = {}) {
  const match=data.match || {};
  const ai=data.aiInstructor || {};
  const history=ai.refereeHistory || {};
  const name=history.name || ai.refereeProfile?.name || ai.referee || match.referee || '';
  if (!name) return '🧑‍⚖️ Судья на этот матч ещё не опубликован источником данных.';
  const rows=[`🧑‍⚖️ <b>Судья · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`, '', `Арбитр: <b>${telegramHtmlEscape(name)}</b>`];
  if (history.available) {
    rows.push(`Стиль: ${telegramHtmlEscape(history.styleLabel || '—')}`);
    rows.push(`Средние карточки: ${Number(history.avgYellow || 0)} жёлт. · ${Number(history.avgRed || 0)} красн.`);
    rows.push(`Фолы: ${Number(history.avgFouls || 0)} за матч · выборка ${Number(history.sample || 0)} матчей`);
  } else {
    rows.push(telegramHtmlEscape(ai.refereeNote || 'Подтверждённой исторической выборки пока недостаточно.'));
  }
  return rows.join('\n');
}

function botSquadsText(data = {}) {
  const match=data.match || {};
  const impact=data.lineupImpact || data.aiInstructor?.lineupImpact || {};
  const abs=data.absences || {home:[],away:[]};
  const lineups=data.lineups || {};
  const side=(name,list,lineup)=>{
    const misses=(list || []).slice(0,4).map(x=>telegramHtmlEscape(x.name || 'Игрок')).join(', ') || 'нет подтверждённых потерь';
    const confirmed=lineup?.quality?.confirmed===true || (!lineup?.quality && Number(lineup?.startXI?.length || 0)===11);
    return `<b>${telegramHtmlEscape(name)}</b>\nПотери: ${misses}\nСостав: ${confirmed ? `подтверждён · ${telegramHtmlEscape(lineup?.formation || 'схема не указана')}` : 'ещё не подтверждён'}`;
  };
  return [
    `👥 <b>Составы и потери · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`,
    '',
    side(match.home?.name || 'Хозяева',abs.home,lineups.home),
    '',
    side(match.away?.name || 'Гости',abs.away,lineups.away),
    '',
    `AI-контекст: ${telegramHtmlEscape(impact.note || 'Проверяйте стартовые составы ближе к матчу.')}`,
  ].join('\n');
}

function botMarketRiskText(data = {}) {
  const match=data.match || {};
  const ai=data.aiInstructor || {};
  const market=data.market || {};
  const odds=market.odds || {};
  const oddsLine=odds.home && odds.draw && odds.away ? `П1 ${odds.home} · X ${odds.draw} · П2 ${odds.away}` : 'актуальные 1X2 коэффициенты недоступны';
  const risks=(ai.risks || data.risks || []).slice(0,3);
  return [
    `💹 <b>Рынок и риски · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`,
    '',
    `Коэффициенты: ${telegramHtmlEscape(oddsLine)}`,
    `Движение: ${telegramHtmlEscape(ai.marketNote || marketMovementNote(data.marketMovement || {}))}`,
    `Риск AI: <b>${telegramHtmlEscape(ai.riskLabel || '—')}</b>`,
    ...(risks.length ? ['', '<b>Что может сломать сценарий:</b>', ...risks.map(x=>`• ${telegramHtmlEscape(x)}`)] : []),
  ].join('\n');
}


async function botMatchCenterFixture(request, cfg, fixtureId) {
  const url=new URL(request.url);
  url.pathname='/api/match-center';
  url.search='';
  url.searchParams.set('fixtureId',String(Number(fixtureId || 0)));
  const response=await apiMatchCenter(new Request(url.toString(),{method:'GET'}),cfg);
  let payload={};
  try { payload=await response.json(); } catch {}
  if (!response.ok) {
    const error=new Error(payload?.error || 'Не удалось открыть центр матча.');
    error.status=response.status;
    error.payload=payload;
    throw error;
  }
  return payload;
}

function botPostMatchReviewText(data = {}) {
  const match=data.match || {};
  const review=data.postMatchReview || {};
  if (!review.available) {
    return [
      `🧠 <b>Итог AI · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`,
      '',
      telegramHtmlEscape(review.summary || 'Для этого матча нет сохранённого предматчевого снимка, поэтому честное сравнение с AI-прогнозом недоступно.'),
      '',
      '<i>Фактические события и статистика доступны в центре матча.</i>',
    ].join('\n');
  }
  const outcome=review.outcome || {};
  const score=review.score || {};
  const marketLines=(review.markets || []).map(x=>`${x.correct?'✓':'✕'} ${x.label}: ${x.predicted}${Number.isFinite(Number(x.probability))?` (${Number(x.probability)}%)`:''} → ${x.actual}`);
  const evidence=(review.evidence || []).slice(0,3).map(x=>`• ${x.icon || '•'} ${x.title}: ${x.text}`);
  return [
    `🧠 <b>Итог AI · ${telegramHtmlEscape(match.home?.name || '')} — ${telegramHtmlEscape(match.away?.name || '')}</b>`,
    `Счёт: <b>${Number(score.home)}:${Number(score.away)}</b>`,
    '',
    `${outcome.correct?'✅':'❌'} <b>${telegramHtmlEscape(review.headline || '')}</b>`,
    `До матча: ${telegramHtmlEscape(outcome.predictedLabel || '—')}${Number.isFinite(Number(outcome.probability))?` · ${Number(outcome.probability)}%`:''}`,
    `Факт: ${telegramHtmlEscape(outcome.actualLabel || '—')}`,
    ...(marketLines.length ? ['', '<b>Дополнительные рынки:</b>', ...marketLines.map(telegramHtmlEscape)] : []),
    ...(evidence.length ? ['', '<b>Что видно по матчу:</b>', ...evidence.map(telegramHtmlEscape)] : []),
    '',
    telegramHtmlEscape(review.calibration?.note || ''),
    '<i>Наблюдаемые факторы не доказывают причинность результата.</i>',
  ].filter(Boolean).join('\n');
}

async function sendBotFixtureSection(request, cfg, userId, chatId, fixtureId, section = 'verdict', options = {}) {
  try {
    if (section !== 'review') markTelegramWebhookMutation(cfg, 'analysis_quota_or_history');
    const data = section === 'review'
      ? await botMatchCenterFixture(request, cfg, fixtureId)
      : await botAnalyzeFixture(request, cfg, userId, fixtureId);
    const text = section === 'review' ? botPostMatchReviewText(data)
      : section === 'referee' ? botRefereeText(data)
        : section === 'squads' ? botSquadsText(data)
          : section === 'market' ? botMarketRiskText(data)
            : botAiVerdictText(data);
    const match=normalizeBotFixtureCard(data.match);
    await rememberBotFixtureCards([match],cfg);
    const favorites=await getFavorites(userId,cfg).catch(()=>[]);
    if (section === 'verdict') void recordGrowthEvent(cfg,{userId,eventName:'quick_ai',channel:'telegram',fixtureId,metadata:{section}});
    if (section === 'review') void recordGrowthEvent(cfg,{userId,eventName:'post_match_review',channel:'telegram',fixtureId,metadata:{available:Boolean(data?.postMatchReview?.available)}});
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      parse_mode:'HTML',
      text,
      reply_markup:footballMatchActionKeyboard(request, match, '', favorites),
    });
    return {ok:true,status:200};
  } catch (error) {
    const status=Number(error?.status || 0);
    const message=status===429
      ? 'Лимит AI-разборов или источника данных временно исчерпан. Попробуйте позже.'
      : status===409
        ? 'Данные матча сейчас противоречивы, поэтому AI-разбор временно заблокирован.'
        : error?.message || 'Не удалось получить AI-разбор матча.';
    if (!options.suppressFallback) {
      await telegramApi('sendMessage',cfg,{
        chat_id:chatId,
        text:`⚠️ ${message}`,
        reply_markup:{inline_keyboard:[[{text:'📊 Открыть матч',web_app:{url:telegramFullAnalysisUrl(request,Number(fixtureId),'brief')}}]]},
      }).catch(()=>null);
    }
    return {ok:false,status,code:String(error?.code || error?.payload?.code || ''),message};
  }
}

async function toggleBotFavorite(userId, teamId, cfg) {
  const id=Number(teamId || 0);
  if (!id) throw new Error('Команда не определена.');
  const favorites=await getFavorites(userId,cfg);
  const current=favorites.find(x=>Number(x.team_id)===id);
  if (current) {
    await removeFavorite(userId,id,cfg);
    return {active:false,team:{id,name:current.team_name || 'Команда',logo:current.team_logo || ''}};
  }
  const team=await loadBotTeamCard(id,cfg);
  if (!team?.name) throw new Error('Данные клуба устарели. Откройте карточку матча заново.');
  await addFavorite(userId,team,cfg);
  return {active:true,team};
}

async function configureFootballBot(request, cfg, chatId) {
  const appUrl = telegramWebAppUrl(request);
  await Promise.allSettled([
    telegramApi('setMyCommands', cfg, { commands: [] }),
    telegramApi('setMyName', cfg, { name: 'MatchRadar AI' }),
    telegramApi('setMyShortDescription', cfg, { short_description: 'Матчи, LIVE и AI-разбор — быстро и по делу.' }),
    telegramApi('setMyDescription', cfg, { description: 'AI-футбольный ассистент в Telegram: матчи, команды, LIVE и понятный разбор ключевых факторов.' }),
    telegramApi('setChatMenuButton', cfg, { chat_id: chatId, menu_button: { type: 'web_app', text: '⚽ MatchRadar AI', web_app: { url: appUrl } } }),
  ]);
}

async function sendFootballBotHome(request, cfg, chatId, telegramUser = {}) {
  const firstName=String(telegramUser?.first_name || '').trim().slice(0,40);
  const hello=firstName ? `Привет, <b>${telegramHtmlEscape(firstName)}</b>.` : 'Привет.';
  await telegramApi('sendMessage', cfg, {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: [
      '⚽ <b>MatchRadar AI</b>',
      'Видим, что меняет матч.',
      '',
      `${hello} Напишите клуб прямо в чат — например «Реал», «Арсенал», «Бавария», «Бока Хуниорс» или «Интер Майами».`,
      '',
      '<b>Что будет дальше:</b> я найду ближайший матч; после одного нажатия сразу покажу короткую AI-оценку в чате.',
      '📊 Кнопка полного AI-разбора откроет Mini App сразу на выбранном матче — повторный поиск не нужен.',
      '📰 Новости и 🔴 LIVE остаются здесь, в Telegram.',
      '',
      '<i>Если данных мало или перевеса нет, MatchRadar AI прямо предложит пропустить матч.</i>',
    ].join('\n'),
    reply_markup: footballBotKeyboard(request),
  });
}

async function sendFootballBotHelp(request, cfg, chatId) {
  await telegramApi('sendMessage', cfg, {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: [
      '<b>Как пользоваться MatchRadar AI</b>',
      '',
      '⚽ <b>Матчи сегодня</b> — персональная лента матчей.',
      '🔴 <b>LIVE</b> — матчи, которые идут сейчас.',
      '🧠 <b>AI-подборка</b> — три заметных матча дня.',
      '🔎 <b>Найти матч</b> — бот попросит написать команду или игру.',
      '⭐ <b>Мои команды</b> — избранное.',
      '🕘 <b>Последний разбор</b> — сохранённый AI-вердикт.',
      '📈 <b>Протокол AI</b> — подтверждённая история прогнозов без рекламного «процента побед».',
      '📰 <b>Новости</b> — важные события с источниками и объяснением контекста.',
      '☀️ <b>Утренняя подборка</b> — матчи дня и главное за утро.',
      '',
      'После одного нажатия на матч короткая AI-оценка появляется прямо в Telegram. <b>Полный AI-разбор</b> открывается в Mini App сразу на этом fixture.',
      '',
      '<i>MatchRadar AI — информационно-аналитический сервис. Он не гарантирует исход матча и не является финансовой или букмекерской рекомендацией.</i>',
      '',
      `<a href="${telegramHtmlEscape(publicSiteUrl(request,'/privacy.html'))}">Privacy</a> · <a href="${telegramHtmlEscape(publicSiteUrl(request,'/terms.html'))}">Terms</a> · <a href="${telegramHtmlEscape(publicSiteUrl(request,'/status.html'))}">Status</a>`,
    ].join('\n'),
    reply_markup: footballBotKeyboard(request),
  });
}

async function sendDigestControls(request, cfg, chatId) {
  await telegramApi('sendMessage', cfg, {
    chat_id: chatId,
    text: '☀️ Утренняя подборка MatchRadar AI\n\nПримерно в 07:00 UTC: до 3 заметных матчей дня + короткий блок важных футбольных новостей с источниками. Выберите режим:',
    reply_markup: { inline_keyboard: [[
      { text: '✅ Включить', callback_data: 'digest:on' },
      { text: '🔕 Выключить', callback_data: 'digest:off' },
    ]] },
  });
}

function digestFixtureRows(fixtures = [], limit = 3) {
  return (fixtures || []).filter(f => {
    const status = String(f.fixture?.status?.short || '');
    const home = String(f.teams?.home?.name || '');
    const away = String(f.teams?.away?.name || '');
    return !['CANC','PST','ABD','AWD','WO'].includes(status) && !isYouthReserveMatch(f.league?.name || '', home, away);
  }).map(f => {
    const leagueId = Number(f.league?.id || 0);
    const homeName = f.teams?.home?.name || '';
    const awayName = f.teams?.away?.name || '';
    const competition = normalizeCompetition(leagueId, f.league?.name || '', f.league?.country || '', homeName, awayName);
    const status = String(f.fixture?.status?.short || '');
    return {
      fixtureId:Number(f.fixture?.id || 0), date:f.fixture?.date || '', status, live:isLiveStatus(status),
      home:{id:Number(f.teams?.home?.id || 0),name:homeName,logo:String(f.teams?.home?.logo || '')},
      away:{id:Number(f.teams?.away?.id || 0),name:awayName,logo:String(f.teams?.away?.logo || '')},
      homeName, awayName, league:competition.shortName || competition.name || f.league?.name || 'Турнир',
      score:matchInterestScore({ competition, leagueId, leagueName:f.league?.name || '', country:f.league?.country || '', homeName, awayName, status, date:f.fixture?.date || '' }),
      priority:Number(competition.priority || 0), featured:Boolean(competition.featured),
    };
  }).filter(x => x.fixtureId)
    .sort((a,b) => Number(b.live)-Number(a.live) || Number(b.featured)-Number(a.featured) || b.score-a.score || b.priority-a.priority || String(a.date).localeCompare(String(b.date)))
    .slice(0, Math.max(1, Math.min(20, Number(limit || 3))));
}

function digestTime(iso) {
  const d = new Date(iso || '');
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(d) + ' UTC';
}

function dailyDigestText(rows = []) {
  if (!rows.length) return '⚽ Сегодня пока нет подходящих матчей для короткой AI-подборки.';
  return ['🧠 <b>3 матча дня · AI-подборка</b>','',...rows.map((x,i)=>`${i+1}. <b>${x.homeName} — ${x.awayName}</b>\n${x.league} · ${x.live ? '🔴 идёт сейчас' : digestTime(x.date)}`),'','Нажмите на матч — короткая AI-оценка придёт сразу в Telegram. Полный разбор откроется одним нажатием.'].join('\n');
}

function expandedDailyDigestText(rows = [], radarByFixture = new Map()) {
  const base=dailyDigestText(rows);
  const radarLines=(rows || []).slice(0,3).map(match=>{
    const state=radarByFixture.get(Number(match?.fixtureId || 0));
    if (!state || state.reason!=='evaluated' || !state.latest || !state.strongest) return '';
    const sideName=state.strongest.side==='home'
      ? String(match?.homeName || 'Хозяева')
      : state.strongest.side==='away'
        ? String(match?.awayName || 'Гости')
        : 'Ничья';
    const confidence=Number(state.latest.confidence);
    return `• <b>${telegramHtmlEscape(match?.homeName || 'Хозяева')} — ${telegramHtmlEscape(match?.awayName || 'Гости')}</b>: ${telegramHtmlEscape(sideName)} ${Number(state.strongest.probability || 0).toFixed(1)}%${Number.isFinite(confidence) ? ` · Radar ${Math.round(confidence)}/100` : ''}`;
  }).filter(Boolean);
  if (!radarLines.length) return base;
  return [
    base,
    '',
    '📡 <b>PRO · Radar-контекст</b>',
    ...radarLines,
    '<i>Контекст построен только по сохранённым снимкам модели; это не гарантия результата.</i>',
  ].join('\n');
}

async function getBotDigestSubscription(userId, cfg) {
  const telegramId=Number(userId || 0);
  if (!telegramId) return null;
  if (hasSupabase(cfg)) {
    return await supaSelectOne(cfg,'bot_digest_subscriptions',{telegram_id:`eq.${telegramId}`});
  }
  return memory.botDigestSubscriptions.get(telegramId) || null;
}

async function setBotDigestSubscription(userId, chatId, enabled, cfg, appUrl = '') {
  markTelegramWebhookMutation(cfg, 'digest_subscription');
  const telegramId=Number(userId || 0);
  const previous=await getBotDigestSubscription(telegramId,cfg);
  const row = {
    telegram_id:telegramId,
    chat_id:Number(previous?.chat_id || chatId || telegramId),
    enabled:Boolean(enabled),
    hour_utc:DAILY_DIGEST_POLICY.deliveryHourUtc,
    app_url:String(appUrl || previous?.app_url || '').slice(0,500),
    updated_at:new Date().toISOString(),
  };
  if (hasSupabase(cfg)) await supaUpsert(cfg,'bot_digest_subscriptions',row,'telegram_id');
  else memory.botDigestSubscriptions.set(telegramId,{...previous,...row,last_sent_date:previous?.last_sent_date || null});
  return {...previous,...row};
}

function publicDigestSettings(row = null, plan = 'FREE', favorites = []) {
  const hourUtc=DAILY_DIGEST_POLICY.deliveryHourUtc;
  const normalizedPlan=['FREE','PRO','PREMIUM'].includes(String(plan || '').toUpperCase())
    ? String(plan).toUpperCase()
    : 'FREE';
  return {
    enabled:row?.enabled === true,
    configured:Boolean(row?.telegram_id),
    plan:normalizedPlan,
    delivery:{
      hourUtc,
      label:`${String(hourUtc).padStart(2,'0')}:00 UTC`,
      timezone:'UTC',
      editable:false,
      executionWindow:`${String(hourUtc).padStart(2,'0')}:00–${String(hourUtc).padStart(2,'0')}:55 UTC`,
    },
    favoriteTeams:(favorites || []).map(item=>({
      teamId:Number(item.team_id || item.teamId || 0),
      teamName:String(item.team_name || item.teamName || '').slice(0,80),
    })).filter(item=>item.teamId && item.teamName).slice(0,6),
    capabilities:{
      baseDigest:true,
      morningNews:true,
      favoritePriority:false,
      customDeliveryTime:false,
      planSpecificContent:normalizedPlan!=='FREE',
      smartRadarContext:normalizedPlan!=='FREE',
    },
    updatedAt:row?.updated_at || null,
  };
}

async function loadBotDigestSubscriptions(cfg) {
  if (hasSupabase(cfg)) {
    return await supaSelectPaged(cfg,'bot_digest_subscriptions',{enabled:'eq.true'},{
      pageSize:500,
      maxRows:10000,
      order:'telegram_id.asc',
    });
  }
  return {
    rows:[...memory.botDigestSubscriptions.values()].filter(x=>x.enabled),
    truncated:false,
  };
}

async function claimDigestDelivery(row,date,cfg) {
  if (hasSupabase(cfg)) {
    const claimed=Boolean(await supaRpc(cfg,'claim_daily_digest',{p_telegram_id:Number(row.telegram_id),p_delivery_date:date,p_lease_seconds:DAILY_DIGEST_POLICY.claimLeaseSeconds},2500));
    if (claimed) bumpTelemetry('digestDeliveryClaims'); else bumpTelemetry('digestDeliveryDuplicates');
    return claimed;
  }
  const current=memory.botDigestSubscriptions.get(Number(row.telegram_id)) || row;
  const lockedUntil=Date.parse(String(current.delivery_locked_until || ''));
  const activeClaim=String(current.delivery_claim_date || '')===date && Number.isFinite(lockedUntil) && lockedUntil>Date.now();
  if (String(current.last_sent_date || '')===date || activeClaim) {
    bumpTelemetry('digestDeliveryDuplicates');
    return false;
  }
  memory.botDigestSubscriptions.set(Number(row.telegram_id),{
    ...current,
    delivery_claim_date:date,
    delivery_claimed_at:new Date().toISOString(),
    delivery_locked_until:new Date(Date.now()+DAILY_DIGEST_POLICY.claimLeaseSeconds*1000).toISOString(),
  });
  bumpTelemetry('digestDeliveryClaims');
  return true;
}

function digestDeliverySealUntil(date) {
  const nextDay=new Date(`${String(date || '')}T00:00:00.000Z`);
  if (!Number.isFinite(nextDay.getTime())) return new Date(Date.now()+24*3600_000).toISOString();
  nextDay.setUTCDate(nextDay.getUTCDate()+1);
  return nextDay.toISOString();
}

async function armDigestDelivery(row,date,cfg) {
  const lockedUntil=digestDeliverySealUntil(date);
  if (hasSupabase(cfg)) {
    await supaPatch(cfg,'bot_digest_subscriptions',{
      telegram_id:`eq.${Number(row.telegram_id)}`,
      delivery_claim_date:`eq.${date}`,
    },{
      delivery_locked_until:lockedUntil,
      updated_at:new Date().toISOString(),
    });
    return true;
  }
  const current=memory.botDigestSubscriptions.get(Number(row.telegram_id)) || row;
  if (String(current.delivery_claim_date || '')!==date || String(current.last_sent_date || '')===date) return false;
  memory.botDigestSubscriptions.set(Number(row.telegram_id),{...current,delivery_locked_until:lockedUntil});
  return true;
}

async function markDigestSent(row, date, cfg) {
  if (hasSupabase(cfg)) return await supaRpc(cfg,'complete_daily_digest',{p_telegram_id:Number(row.telegram_id),p_delivery_date:date},2500);
  memory.botDigestSubscriptions.set(Number(row.telegram_id),{...row,last_sent_date:date,delivery_claim_date:null,delivery_locked_until:null,updated_at:new Date().toISOString()});
}

async function releaseDigestDelivery(row,date,cfg) {
  if (hasSupabase(cfg)) return await supaRpc(cfg,'release_daily_digest',{p_telegram_id:Number(row.telegram_id),p_delivery_date:date},2500).catch(()=>false);
  const current=memory.botDigestSubscriptions.get(Number(row.telegram_id)) || row;
  memory.botDigestSubscriptions.set(Number(row.telegram_id),{...current,delivery_claim_date:null,delivery_locked_until:null});
  return true;
}

function digestRowsFromMatchCache(matches = [], limit = 3) {
  return (matches || []).map(normalizeBotFixtureCard).filter(match => match.fixtureId).map(match => ({
    fixtureId:Number(match.fixtureId || 0),
    date:String(match.date || ''),
    status:String(match.status || ''),
    live:Boolean(match.live),
    home:{id:Number(match.home?.id || 0),name:String(match.home?.name || match.homeName || ''),logo:String(match.home?.logo || '')},
    away:{id:Number(match.away?.id || 0),name:String(match.away?.name || match.awayName || ''),logo:String(match.away?.logo || '')},
    homeName:String(match.home?.name || match.homeName || ''),
    awayName:String(match.away?.name || match.awayName || ''),
    league:String(match.league || 'Турнир'),
    score:Number(match.interestScore || 0),
    priority:Number(match.competition?.priority || 0),
    featured:Boolean(match.featured),
  })).sort((a,b) =>
    Number(b.live)-Number(a.live)
    || Number(b.featured)-Number(a.featured)
    || b.score-a.score
    || b.priority-a.priority
    || String(a.date).localeCompare(String(b.date))
  ).slice(0,Math.max(1,Math.min(20,Number(limit || 3))));
}

async function currentDailyDigest(cfg) {
  const date=todayUtc();
  const cacheKey=`bot:digest:${date}:v1`;
  const cached=await getCache(cacheKey,cfg);
  if (cached?.rows) return cached;
  try {
    const fixtures=await loadProviderFixturesForDate(date,cfg);
    const payload={date,rows:digestFixtureRows(fixtures),generatedAt:new Date().toISOString(),source:'provider',providerDegraded:false};
    await setCache(cacheKey,0,payload,cfg,10);
    return payload;
  } catch (error) {
    const matchCacheKey=`matches:${date}:v6-integrity`;
    const matchCache=await getCache(matchCacheKey,cfg).catch(()=>null)
      || await getStaleCache(matchCacheKey,cfg).catch(()=>null);
    const rows=digestRowsFromMatchCache(matchCache?.matches || [],3);
    if (rows.length) {
      return {
        date,
        rows,
        generatedAt:new Date().toISOString(),
        source:'matches_cache',
        providerDegraded:true,
        providerRateLimited:isFootballRateLimitError(error),
      };
    }
    throw error;
  }
}

async function loadBotDayMatches(cfg, { liveOnly = false, limit = 8 } = {}) {
  const date=todayUtc();
  const cached=await getCache(`matches:${date}:v6-integrity`,cfg).catch(()=>null);
  let matches=(cached?.matches || []).map(normalizeBotFixtureCard).filter(x=>x.fixtureId);
  if (!matches.length && freeQuotaHealthy(8,1)) {
    const fixtures=await loadProviderFixturesForDate(date,cfg).catch(()=>[]);
    matches=digestFixtureRows(fixtures,20).map(normalizeBotFixtureCard).filter(x=>x.fixtureId);
  }
  if (liveOnly) matches=matches.filter(x=>x.live);
  matches.sort((a,b)=>Number(b.live)-Number(a.live) || Date.parse(a.date || 0)-Date.parse(b.date || 0));
  return matches.slice(0,Math.max(1,Math.min(12,Number(limit || 8))));
}

function botDayMatchesText(matches = [], { liveOnly = false } = {}) {
  if (!matches.length) return liveOnly
    ? '🔴 Сейчас в доступных данных нет матчей в прямом эфире.'
    : '⚽ На сегодня подходящие матчи пока не найдены.';
  const title=liveOnly ? '🔴 <b>LIVE сейчас</b>' : '⚽ <b>Матчи сегодня</b>';
  return [title,'',...matches.map((m,i)=>`${i+1}. <b>${telegramHtmlEscape(m.homeName)} — ${telegramHtmlEscape(m.awayName)}</b>\n${telegramHtmlEscape(m.league || 'Турнир')} · ${m.live ? telegramHtmlEscape(m.statusLabel || 'идёт сейчас') : digestTime(m.date)}`),'','Нажмите на матч — сразу покажу короткую AI-оценку и кнопку полного разбора.'].join('\n');
}

async function sendBotDayMatches(request,cfg,chatId,{liveOnly=false}={}) {
  const matches=await loadBotDayMatches(cfg,{liveOnly,limit:8});
  await rememberBotFixtureCards(matches,cfg);
  const rows=matches.map(m=>[{text:`${m.live?'🔴':'⚽'} ${String(m.homeName || '').slice(0,20)} — ${String(m.awayName || '').slice(0,20)}`,callback_data:`match:menu:${Number(m.fixtureId)}`}]);
  if (!rows.length) rows.push([{text:'🔄 Обновить',callback_data:liveOnly?'feed:live':'feed:today'}]);
  await telegramApi('sendMessage',cfg,{chat_id:chatId,parse_mode:'HTML',text:botDayMatchesText(matches,{liveOnly}),reply_markup:{inline_keyboard:rows}});
}

async function botTeamIdMatches(teamId,cfg) {
  const id=Number(teamId || 0);
  if (!id) return [];
  const fromDate=new Date(); fromDate.setUTCDate(fromDate.getUTCDate()-7);
  const toDate=new Date(); toDate.setUTCDate(toDate.getUTCDate()+30);
  const from=fromDate.toISOString().slice(0,10), to=toDate.toISOString().slice(0,10);
  const cacheKey=`bot:team-id-matches:${id}:${from}:${to}:v1`;
  const cached=await getCache(cacheKey,cfg).catch(()=>null);
  if (cached?.matches) return cached.matches.map(normalizeBotFixtureCard);
  if (!freeQuotaHealthy(8,1)) return [];
  let fixtures=await apiFootball('/fixtures',{team:id,next:8},cfg).catch(()=>[]);
  if (!fixtures.length) fixtures=await apiFootball('/fixtures',{team:id,last:6},cfg).catch(()=>[]);
  const matches=(fixtures || []).filter(f=>!['CANC','PST','ABD','AWD','WO'].includes(String(f.fixture?.status?.short||''))).map(f=>normalizeBotFixtureCard(f)).filter(x=>x.fixtureId)
    .sort((a,b)=>Number(b.live)-Number(a.live) || Number(a.finished)-Number(b.finished) || Date.parse(a.date||0)-Date.parse(b.date||0)).slice(0,6);
  await setCache(cacheKey,id,{matches,refreshedAt:new Date().toISOString()},cfg,120).catch(()=>null);
  await rememberBotFixtureCards(matches,cfg);
  return matches;
}

async function sendBotFavoriteTeams(request,cfg,userId,chatId) {
  const favorites=await getFavorites(userId,cfg);
  if (!favorites.length) {
    await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'⭐ <b>Мои команды пока пусты</b>\n\nОткройте любой матч и нажмите ☆ рядом с нужным клубом. После этого здесь появятся его ближайшие игры, а в MatchRadar AI · Новости — персональные новости.',parse_mode:'HTML',reply_markup:footballBotKeyboard(request)});
    return;
  }
  const rows=favorites.slice(0,12).map(x=>[{text:`⭐ ${String(x.team_name || 'Команда').slice(0,40)}`,callback_data:`favorite:team:${Number(x.team_id)}`}]);
  await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'⭐ Мои команды\n\nВыберите клуб — покажу его ближайшие матчи прямо в чате.',reply_markup:{inline_keyboard:rows}});
}

async function sendBotFavoriteTeamMatches(request,cfg,userId,chatId,teamId) {
  const favorites=await getFavorites(userId,cfg);
  const team=favorites.find(x=>Number(x.team_id)===Number(teamId));
  if (!team) {
    await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Команда не найдена в вашем избранном.'});
    return;
  }
  const matches=await botTeamIdMatches(teamId,cfg);
  const rows=matches.map(m=>[{text:botMatchButtonText(m),callback_data:`match:menu:${Number(m.fixtureId)}`}]);
  const body=matches.length
    ? matches.map((m,i)=>`${i+1}. <b>${telegramHtmlEscape(m.homeName)} — ${telegramHtmlEscape(m.awayName)}</b> · ${m.live?'LIVE':digestTime(m.date)}`).join('\n')
    : 'Ближайшие матчи сейчас не найдены или источник данных временно ограничен.';
  const buttons=rows.length?rows:[[{text:'🔄 Повторить',callback_data:`favorite:team:${Number(teamId)}`}]];
  buttons.push([{text:'📰 Новости клуба',callback_data:`news:team:${Number(teamId)}`}]);
  await telegramApi('sendMessage',cfg,{chat_id:chatId,parse_mode:'HTML',text:`⭐ <b>${telegramHtmlEscape(team.team_name || 'Команда')}</b>\n\n${body}`,reply_markup:{inline_keyboard:buttons}});
}

async function sendDailyPicks(request,cfg,chatId) {
  const digest=await currentDailyDigest(cfg);
  await rememberBotFixtureCards(digest.rows || [], cfg);
  const rows=(digest.rows || []).map(match => [{
    text:`⚽ ${String(match.homeName || 'Хозяева').slice(0,20)} — ${String(match.awayName || 'Гости').slice(0,20)}`,
    callback_data:`match:menu:${Number(match.fixtureId)}`,
  }]);
  rows.push([{text:'⚽ Все матчи сегодня',callback_data:'feed:today'}]);
  await telegramApi('sendMessage',cfg,{
    chat_id:chatId, parse_mode:'HTML', text:dailyDigestText(digest.rows),
    reply_markup:{inline_keyboard:rows},
  });
}

async function processDailyDigests(cfg,scheduledAt=new Date()) {
  if (!cfg.botToken) return {sent:0,skipped:'bot_token_missing'};
  const startedAt=Date.now();
  const hour=scheduledAt.getUTCHours();
  const date=scheduledAt.toISOString().slice(0,10);
  const subscriptionPage=await loadBotDigestSubscriptions(cfg);
  const plan=planDailyDigestRecipients(subscriptionPage.rows || [],{
    date,
    hourUtc:hour,
    pageSize:DAILY_DIGEST_POLICY.pageSize,
    maxRecipients:DAILY_DIGEST_POLICY.maxRecipientsPerRun,
    truncated:Boolean(subscriptionPage.truncated),
  });

  if (subscriptionPage.truncated) {
    await recordOpsEvent(cfg,{
      severity:'warning',
      source:'telegram',
      eventType:'daily_digest',
      code:'DIGEST_SUBSCRIPTIONS_TRUNCATED',
      message:'Daily digest subscription scan reached the 10000-row safety cap.',
      endpoint:'cron:daily-digest',
      meta:{loaded:plan.scanned,eligible:plan.eligible,cap:DAILY_DIGEST_POLICY.scanCap,pages:plan.pages},
    }).catch(()=>null);
  }

  if (!plan.pending.length) {
    const summary={
      date,scanned:plan.scanned,pages:plan.pages,eligible:plan.eligible,claimed:0,sent:0,
      duplicate:plan.duplicate,activeClaims:plan.activeClaims,freshClaims:plan.freshClaims,
      sealedClaims:plan.sealedClaims,oldestActiveClaimAgeMs:plan.oldestActiveClaimAgeMs,
      expiredClaims:plan.expiredClaims,failed:0,rateLimited:0,deferred:0,remaining:0,backlog:0,
      truncated:Boolean(plan.truncated),duration:Date.now()-startedAt,
    };
    const health=assessDailyDigestRun(summary,scheduledAt);
    await recordOpsEvent(cfg,{
      severity:health.severity,
      source:'telegram',
      eventType:'daily_digest',
      code:plan.truncated?'DAILY_DIGEST_RUN_TRUNCATED':health.code,
      message:plan.truncated
        ? 'Daily digest run finished with a truncated subscription scan.'
        : health.reason==='sealed_claims'
          ? `Daily digest has ${summary.sealedClaims} sealed claim(s) requiring observation.`
          : 'Daily digest run completed with no pending recipients.',
      endpoint:'cron:daily-digest',
      meta:{...summary,health},
    }).catch(()=>null);
    return summary;
  }

  // Shared provider-backed payloads are resolved once per cron invocation, never
  // once per recipient/page. Main digest data is required, while morning news is
  // optional and must not block the primary delivery path.
  let digest;
  try {
    digest=await currentDailyDigest(cfg);
  } catch (error) {
    const summary={
      date,
      scanned:plan.scanned,
      pages:plan.pages,
      eligible:plan.eligible,
      claimed:0,
      sent:0,
      duplicate:plan.duplicate,
      activeClaims:plan.activeClaims,
      freshClaims:plan.freshClaims,
      sealedClaims:plan.sealedClaims,
      oldestActiveClaimAgeMs:plan.oldestActiveClaimAgeMs,
      expiredClaims:plan.expiredClaims,
      failed:0,
      rateLimited:isFootballRateLimitError(error) ? 1 : 0,
      providerDegraded:true,
      payloadUnavailable:true,
      deferred:plan.pending.length,
      remaining:plan.pending.length,
      backlog:plan.pending.length,
      truncated:Boolean(plan.truncated),
      completionRate:null,
      duration:Date.now()-startedAt,
    };
    const health=assessDailyDigestRun(summary,scheduledAt);
    await recordOpsEvent(cfg,{
      severity:'warning',
      source:'telegram',
      eventType:'daily_digest',
      code:'DAILY_DIGEST_RUN_DEGRADED',
      message:isFootballRateLimitError(error)
        ? 'Daily digest payload unavailable because API-Football is rate limited; recipients remain pending for the next cron slot.'
        : 'Daily digest payload unavailable; recipients remain pending for the next cron slot.',
      endpoint:'cron:daily-digest',
      meta:{...summary,health,payloadSource:'unavailable',retryable:true},
    }).catch(()=>null);
    return summary;
  }

  const morningNews=await currentMorningFootballNews(cfg).catch(()=>({
    date,
    items:[],
    generatedAt:new Date().toISOString(),
    degraded:true,
  }));
  const matchButtons=(digest.rows || []).slice(0,3).map(match=>[{
    text:`⚽ ${String(match.homeName || '').slice(0,18)} — ${String(match.awayName || '').slice(0,18)}`,
    callback_data:`match:menu:${Number(match.fixtureId)}`,
  }]);
  matchButtons.push([{text:'⚽ Все матчи сегодня',callback_data:'feed:today'}]);
  const digestText=dailyDigestText(digest.rows);
  let expandedDigestText=digestText;
  let expandedDigestRecipientIds=new Set();
  let expandedDigestMatches=0;
  try {
    const paidDigestAudience=await filterSmartNotificationRecipients(plan.pending || [],'ai.digest_expanded',cfg);
    expandedDigestRecipientIds=new Set((paidDigestAudience?.rows || []).map(row=>Number(row?.telegram_id || 0)).filter(Boolean));
    if (expandedDigestRecipientIds.size) {
      const radarEntries=await Promise.all((digest.rows || []).slice(0,3).map(async match=>{
        const fixtureId=Number(match?.fixtureId || 0);
        if (!fixtureId) return [0,null];
        const snapshots=await getAnalysisTimelineSnapshots(fixtureId,cfg,10).catch(()=>[]);
        const state=radarStrongSignalState(snapshots,{
          confidenceThreshold:SMART_NOTIFICATION_POLICY.radarConfidenceThreshold,
          outcomeThreshold:SMART_NOTIFICATION_POLICY.radarOutcomeThreshold,
          maxSignalAgeMinutes:SMART_NOTIFICATION_POLICY.maxSignalAgeMinutes,
          now:scheduledAt.getTime(),
        });
        return [fixtureId,state];
      }));
      const radarByFixture=new Map(radarEntries.filter(([fixtureId,state])=>fixtureId && state?.reason==='evaluated'));
      expandedDigestMatches=radarByFixture.size;
      expandedDigestText=expandedDailyDigestText(digest.rows,radarByFixture);
    }
  } catch (error) {
    await recordOpsEvent(cfg,{
      severity:'warning',
      source:'smart_notifications',
      eventType:'expanded_digest',
      code:'EXPANDED_DIGEST_CONTEXT_UNAVAILABLE',
      message:error?.message || error,
      endpoint:'cron:daily-digest',
      meta:{date},
    }).catch(()=>null);
  }
  const newsText=morningNews.items?.length ? morningNewsText(morningNews.items) : '';
  const newsKeyboard=morningNews.items?.length
    ? newsConversionKeyboard(morningNews.items,[[{text:'📰 Новости MatchRadar AI',callback_data:'news:general'}]])
    : null;

  const result=await runBoundedDailyDigest({
    plan,
    date,
    claim:(row,deliveryDate)=>claimDigestDelivery(row,deliveryDate,cfg),
    arm:(row,deliveryDate)=>armDigestDelivery(row,deliveryDate,cfg),
    release:(row,deliveryDate)=>releaseDigestDelivery(row,deliveryDate,cfg),
    complete:(row,deliveryDate)=>markDigestSent(row,deliveryDate,cfg),
    sendDigest:row=>telegramApi('sendMessage',cfg,{
      chat_id:Number(row.chat_id),
      parse_mode:'HTML',
      text:expandedDigestRecipientIds.has(Number(row?.telegram_id || 0)) ? expandedDigestText : digestText,
      reply_markup:{inline_keyboard:matchButtons},
    }),
    sendNews:newsText
      ? row=>telegramApi('sendMessage',cfg,{
          chat_id:Number(row.chat_id),
          parse_mode:'HTML',
          text:newsText,
          reply_markup:newsKeyboard,
          disable_web_page_preview:true,
        })
      : null,
    sleep:sleepMs,
    maxRecipients:DAILY_DIGEST_POLICY.maxRecipientsPerRun,
    concurrency:DAILY_DIGEST_POLICY.concurrency,
    minSendIntervalMs:DAILY_DIGEST_POLICY.minSendIntervalMs,
    executionBudgetMs:DAILY_DIGEST_POLICY.executionBudgetMs,
  });

  const summary={
    ...result,
    date,
    freshClaims:plan.freshClaims,
    sealedClaims:plan.sealedClaims,
    oldestActiveClaimAgeMs:plan.oldestActiveClaimAgeMs,
    expiredClaims:plan.expiredClaims,
    news:Number(morningNews.items?.length || 0),
    newsDegraded:Boolean(morningNews.degraded),
    expandedDigestRecipients:expandedDigestRecipientIds.size,
    expandedDigestMatches,
    providerDegraded:Boolean(digest.providerDegraded),
    providerRateLimited:Boolean(digest.providerRateLimited),
    payloadSource:String(digest.source || 'provider'),
    completionRate:result.claimed>0 ? Number((result.sent/result.claimed).toFixed(4)) : 1,
    duration:Date.now()-startedAt,
  };
  const health=assessDailyDigestRun(summary,scheduledAt);
  await recordOpsEvent(cfg,{
    severity:health.severity,
    source:'telegram',
    eventType:'daily_digest',
    code:health.code,
    message:health.reason==='late_backlog'
      ? `Daily digest late backlog: ${summary.remaining} recipient(s) remain near the end of the delivery window.`
      : health.reason==='sealed_claims'
        ? `Daily digest has ${summary.sealedClaims} sealed claim(s); oldest active claim age ${summary.oldestActiveClaimAgeMs}ms.`
        : health.reason==='claim_recovery'
          ? `Daily digest recovered ${summary.recoveredClaims} expired claim(s).`
          : `Daily digest: sent ${summary.sent}/${summary.eligible}, deferred ${summary.deferred}, failed ${summary.failed}.`,
    endpoint:'cron:daily-digest',
    meta:{...summary,health},
  }).catch(()=>null);
  return summary;
}

function telegramHtmlEscape(value = '') {
  return String(value || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function botSearchParts(raw = '') {
  const cleaned = String(raw || '').replace(/^\/(?:search|ask)(?:@\w+)?(?:\s+|$)/i,'').trim().slice(0,100);
  const normalized = searchText(cleaned);
  const intent = /^(?:кто\s+судья|судья)(?:\s|$)/.test(normalized)
    ? 'referee'
    : /^(?:что\s+поставить|ставка|идея)(?:\s|$)/.test(normalized)
      ? 'pick'
      : /^(?:разбери|разбор|анализ|прогноз)(?:\s|$)/.test(normalized)
        ? 'analysis'
        : 'search';
  const query = cleaned
    .replace(/^(?:что\s+поставить(?:\s+на)?|кто\s+судья(?:\s+на)?|судья(?:\s+на)?|ставка(?:\s+на)?|идея(?:\s+на)?|разбери(?:\s+матч)?|разбор(?:\s+матча)?|анализ(?:\s+матча)?|прогноз(?:\s+на)?|найди(?:\s+матч)?|покажи(?:\s+матч)?)\s*[:—–-]?\s*/i,'')
    .trim().slice(0,60);
  const parts = query.split(/(?:\s*[—–]\s*|\s+-\s+|\s+\bvs\.?\b\s+|\s+\bпротив\b\s+)/i).map(x => x.trim()).filter(Boolean).slice(0,2);
  return { query, first: parts[0] || query, second: parts[1] || '', intent };
}

function botIntentLead(parts = {}) {
  if (parts.intent === 'referee') return '🧑‍⚖️ Нашёл матч. В AI-разборе покажу назначенного судью и доступную историю его матчей.';
  if (parts.intent === 'pick') return '🧠 Нашёл матч для разбора. Отдельно покажу идею, риск и качество исходных данных.';
  if (parts.intent === 'analysis') return '🧠 Нашёл матч. Откройте AI-разбор — там будут вероятности, сценарий, риски, составы, рынок и судья.';
  return '⚽ Нашёл подходящие матчи.';
}

function botMatchScore(match, parts) {
  const q = searchText(parts.query);
  const first = searchText(parts.first);
  const second = searchText(parts.second);
  const home = searchText(match?.home?.name || match?.homeName || '');
  const away = searchText(match?.away?.name || match?.awayName || '');
  const league = searchText(match?.league || '');
  let score = 0;
  if (second) {
    const direct = home.includes(first) && away.includes(second);
    const reverse = away.includes(first) && home.includes(second);
    if (!direct && !reverse) return 0;
    score += direct ? 280 : 250;
  } else {
    if (!q) return 0;
    if (home === q || away === q) score += 220;
    else if (home.startsWith(q) || away.startsWith(q)) score += 180;
    else if (home.includes(q) || away.includes(q)) score += 140;
    else if (`${home} ${away} ${league}`.includes(q)) score += 55;
    else return 0;
  }
  if (match?.live) score += 50;
  if (!match?.finished) score += 24;
  if (match?.featured) score += 12;
  return score;
}

function botMatchButtonText(match) {
  const home = String(match?.home?.name || match?.homeName || 'Хозяева');
  const away = String(match?.away?.name || match?.awayName || 'Гости');
  const prefix = match?.selection?.primary ? '⭐' : match?.live ? '🔴' : match?.finished ? '📋' : '🧠';
  const label = `${prefix} ${home} — ${away}`;
  return label.length > 58 ? `${label.slice(0,55)}…` : label;
}

function botMatchLine(match, index) {
  const home = telegramHtmlEscape(match?.home?.name || match?.homeName || 'Хозяева');
  const away = telegramHtmlEscape(match?.away?.name || match?.awayName || 'Гости');
  const league = telegramHtmlEscape(match?.league || 'Турнир');
  const status = match?.live
    ? `🔴 ${telegramHtmlEscape(match.statusLabel || 'идёт сейчас')}`
    : match?.finished
      ? `завершён · ${match?.score?.home ?? '—'}:${match?.score?.away ?? '—'}`
      : digestTime(match?.date);
  const primary=match?.selection?.primary ? `⭐ <b>Основной матч для анализа</b> · ${telegramHtmlEscape(match.selection.reason || '')}\n` : '';
  return `${primary}${index + 1}. <b>${home} — ${away}</b>\n${league} · ${status}`;
}

async function botCachedDayMatches(parts, cfg) {
  const payload = await getCache(`matches:${todayUtc()}:v6-integrity`, cfg).catch(() => null);
  return (payload?.matches || []).map(match => ({ match, score:botMatchScore(match,parts) }))
    .filter(x => x.score > 0).sort((a,b) => b.score-a.score || String(a.match.date||'').localeCompare(String(b.match.date||''))).slice(0,3).map(x=>x.match);
}

async function botRemoteTeamMatches(parts, cfg) {
  const query = String(parts.first || '').trim();
  const plan=topTeamSearchPlan(query);
  const highIntent=Number(plan.best?.score || 0)>=170;
  if ((query.length < 3 && Number(plan.best?.score || 0) < 280) || (!freeQuotaHealthy(10,2) && !(highIntent && freeQuotaHealthy(2,1)))) return [];
  const q = searchText(plan.providerQuery || query);
  const teamCacheKey = `search:teams:${encodeURIComponent(q)}:v2-global`;
  let teams = (await getCache(teamCacheKey,cfg).catch(()=>null))?.teams || [];
  if (!teams.length) {
    const rows = await apiFootball('/teams',{search:plan.providerQuery || query},cfg).catch(()=>[]);
    teams = rows.map(x=>normalizeSearchTeam(x,query,plan.candidates)).filter(x=>x.id&&x.name).sort((a,b)=>b.score-a.score).slice(0,5);
    if (teams.length) await setCache(teamCacheKey,0,{query,resolvedQuery:plan.resolved?plan.providerQuery:'',teams,warning:'',refreshedAt:new Date().toISOString()},cfg,1440).catch(()=>null);
  }
  const team = teams[0];
  if (!team?.id) return [];
  const discovery=await loadSearchTeamMatches(team,cfg,{secondQuery:parts.second});
  return (discovery.matches || []).slice(0,3);
}

async function sendBotFootballSearch(request, cfg, userId, chatId, rawText) {
  const parts=botSearchParts(rawText);
  if (parts.query.length < 2) {
    await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Напишите название команды или вопрос о матче. Например: «Арсенал», «что поставить на Арсенал — Челси» или «кто судья Интер — Милан».',reply_markup:{inline_keyboard:[[{text:'🔎 Открыть поиск',web_app:{url:telegramWebAppUrl(request,{view:'search'})}}]]}});
    return;
  }
  void recordGrowthEvent(cfg,{userId,eventName:'search',channel:'telegram',metadata:{intent:parts.intent}});
  const searchPlan=topTeamSearchPlan(parts.first);
  const recognized=Boolean(searchPlan.best && Number(searchPlan.best.score || 0)>=170);
  let matches=await botCachedDayMatches(parts,cfg);
  if (!matches.length) matches=await botRemoteTeamMatches(parts,cfg);
  matches=rankTeamDiscoveryMatches(matches).slice(0,3);
  const searchUrl=telegramWebAppUrl(request,{view:'search',q:parts.query});
  if (!matches.length) {
    const known=recognized;
    void recordGrowthEvent(cfg,{userId,eventName:'search_result',channel:'telegram',metadata:{intent:parts.intent,outcome:known?'recognized_no_match':'not_found',recognized:known}});
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      parse_mode:'HTML',
      text:known
        ? `✅ Клуб распознан: <b>${telegramHtmlEscape(searchPlan.best.canonical)}</b>. Ближайший матч сейчас не вернулся из источника данных — откройте глобальный поиск, там сохраняется распознанный клуб и доступные матчи из кэша.`
        : `🔎 По запросу <b>${telegramHtmlEscape(parts.query)}</b> подходящий матч сейчас не найден. Попробуйте полное название клуба или глобальный поиск по лигам и странам.`,
      reply_markup:{inline_keyboard:[[{text:'🌍 Глобальный поиск',web_app:{url:searchUrl}}]]},
    });
    return;
  }
  const recovery=matches.some(match=>!match.finished)?'upcoming':'recent';
  const primaryFixtureId=Number(matches.find(match=>match.selection?.primary)?.fixtureId || matches[0]?.fixtureId || 0);
  void recordGrowthEvent(cfg,{userId,eventName:'search_result',channel:'telegram',metadata:{intent:parts.intent,outcome:'match',recognized,recovery,primaryFixtureId,count:Math.min(3,matches.length)}});
  await rememberBotFixtureCards(matches, cfg);
  const favorites=await getFavorites(userId,cfg).catch(()=>[]);
  const rows=matches.map((match,index)=>botMatchLine(match,index));
  const replyMarkup = matches.length === 1
    ? footballSearchHandoffKeyboard(request, matches[0], searchUrl)
    : { inline_keyboard: [
        ...matches.map(match=>[{text:botMatchButtonText(match),callback_data:`match:menu:${Number(match.fixtureId)}`}]),
        [{text:'🔎 Все результаты поиска',web_app:{url:searchUrl}}],
      ] };
  await telegramApi('sendMessage',cfg,{
    chat_id:chatId,
    parse_mode:'HTML',
    text:[`<b>${telegramHtmlEscape(botIntentLead(parts))}</b>`,`Запрос: «${telegramHtmlEscape(parts.query)}»`,'',...rows,'',matches.length === 1 ? 'Матч найден. Нажмите один раз — сразу покажу короткую AI-оценку.' : '⭐ Первый матч — основной выбор MatchRadar AI. Нажмите на любой матч — сразу получите короткую AI-оценку.'].join('\n'),
    reply_markup:replyMarkup,
  });
}

function lastAiVerdictText(row = {}) {
  if (!row?.fixture_id) return 'История AI-разборов пока пуста.';
  const teams = `${row.home_name || 'Хозяева'} — ${row.away_name || 'Гости'}`;
  if (!row.ai_signal_label) return `Последний анализ: ${teams}. Он был создан до сохранения быстрых AI-вердиктов; откройте историю в приложении.`;
  const confidence = Number.isFinite(Number(row.ai_confidence)) ? ` · уверенность ${Math.round(Number(row.ai_confidence))}/100` : '';
  const risk = row.ai_risk ? ` · риск ${String(row.ai_risk).toLowerCase()}` : '';
  const outcome = row.ai_outcome ? `\nИсход: ${row.ai_outcome}` : '';
  return `🧠 Последний AI-разбор\n${teams}\n${row.ai_signal_label}${confidence}${risk}${outcome}`;
}


function botAiTrackRecordText(record = {}) {
  if (!record?.available) return '📈 Протокол AI временно недоступен.';
  const sample=record.sample || {};
  const brier=record.probabilityQuality?.avgBrier;
  const recent=(record.recent || []).slice(0,5);
  const recentLines=recent.map(row=>`${row.matched?'✅':'❌'} ${telegramHtmlEscape(row.home)} — ${telegramHtmlEscape(row.away)} · ${telegramHtmlEscape(row.score)}\n   AI: ${telegramHtmlEscape(row.predictedLabel)}${Number.isFinite(Number(row.topProbability))?` · ${Number(row.topProbability)}%`:''} → факт ${telegramHtmlEscape(row.actualLabel)}`);
  return [
    '📈 <b>Протокол MatchRadar AI</b>',
    `Период: последние ${Number(record.periodDays || 180)} дней`,
    '',
    `Проверенных матчей: <b>${Number(sample.verified || 0)}</b>`,
    `Совпало / не совпало: <b>${Number(sample.matched || 0)} / ${Number(sample.missed || 0)}</b>`,
    `Статус выборки: <b>${telegramHtmlEscape(sample.label || '—')}</b>`,
    telegramHtmlEscape(sample.message || ''),
    Number.isFinite(Number(brier)) ? `Ошибка Брайера: <b>${Number(brier).toFixed(3)}</b> · ниже лучше` : 'Ошибка Брайера: пока недостаточно данных',
    ...(recentLines.length ? ['', '<b>Последние подтверждённые:</b>', ...recentLines] : []),
    '',
    '<i>Это история вероятностей модели, а не «винрейт» и не показатель доходности ставок. Прошлые результаты не гарантируют будущие.</i>',
  ].filter(Boolean).join('\n');
}

async function sendBotAiTrackRecord(request, cfg, chatId) {
  const record=await loadPublicAiTrackRecord(cfg,180).catch(()=>({available:false}));
  await telegramApi('sendMessage',cfg,{
    chat_id:chatId,
    parse_mode:'HTML',
    text:botAiTrackRecordText(record),
    reply_markup:{inline_keyboard:[
      [{text:'🧠 Открыть историю AI',web_app:{url:telegramWebAppUrl(request,{view:'history'})}}],
      [{text:'⚽ Матчи сегодня',callback_data:'feed:today'}],
    ]},
  });
}

async function sendLastAiVerdict(request, cfg, userId, chatId) {
  const rows = await getHistory(userId, cfg);
  const row = rows[0];
  await telegramApi('sendMessage', cfg, {
    chat_id:chatId,
    text:lastAiVerdictText(row),
    reply_markup: row?.fixture_id
      ? footballMatchActionKeyboard(request, { fixtureId:Number(row.fixture_id) }, telegramWebAppUrl(request,{view:'history'}))
      : {inline_keyboard:[[{text:'🕘 Открыть историю',web_app:{url:telegramWebAppUrl(request,{view:'history'})}}]]},
  });
}
async function apiBillingPlans(request, cfg, user) {
  const webhook = cfg.monetizationEnabled
    ? await billingWebhookStatus(request, cfg)
    : { ready:false, reason:'monetization_paused', expectedUrl:`${new URL(request.url).origin}/telegram/webhook`, currentUrl:'', lastError:'' };
  const quota = await getQuota(user.id, cfg);
  const record = await getUserRecord(user.id, cfg);
  return json({
    enabled: Boolean(cfg.monetizationEnabled),
    ready: Boolean(cfg.monetizationEnabled && webhook.ready),
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
    passes: {
      MATCH_PASS: passProductConfig(PASS_TYPES.MATCH, cfg),
      DAY_PASS: passProductConfig(PASS_TYPES.DAY, cfg),
      WEEKEND_PASS: passProductConfig(PASS_TYPES.WEEKEND, cfg),
    },
  });
}

async function apiEntitlements(request, cfg, user) {
  const url = new URL(request.url);
  const rawFixtureId = url.searchParams.get('fixtureId');
  const fixtureId = rawFixtureId == null || rawFixtureId === '' ? 0 : Number(rawFixtureId);
  if (!Number.isSafeInteger(fixtureId) || fixtureId < 0) {
    return json({ error: 'Некорректный fixtureId.', code: 'ENTITLEMENT_INVALID_FIXTURE' }, 400);
  }
  return json({
    entitlement: await resolveUserEntitlements(user.id, fixtureId, cfg),
    paymentsEnabled: Boolean(cfg.monetizationEnabled),
    products: {
      MATCH_PASS: passProductConfig(PASS_TYPES.MATCH, cfg),
      DAY_PASS: passProductConfig(PASS_TYPES.DAY, cfg),
      WEEKEND_PASS: passProductConfig(PASS_TYPES.WEEKEND, cfg),
    },
  });
}

async function apiBillingInvoice(request, cfg, user) {
  const webhook = await billingWebhookStatus(request, cfg);
  if (!webhook.ready) return json({ error: 'Оплата ещё не активирована: Telegram webhook не настроен.', webhook }, 503);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Некорректное тело запроса.', code: 'BILLING_INVALID_JSON' }, 400); }

  const passType = String(body?.passType || '').trim().toUpperCase();
  if (passType) {
    const product = passProductConfig(passType, cfg);
    if (!product) return json({ error: 'Неизвестный Pass.', code: 'BILLING_UNKNOWN_PASS' }, 400);
    if (!product.saleReady) {
      return json({
        error: 'Этот Pass ещё не готов к продаже: серверный лимит использования не настроен.',
        code: 'BILLING_PASS_USAGE_LIMIT_REQUIRED',
      }, 503);
    }

    const fixtureId = passType === PASS_TYPES.MATCH ? Number(body?.fixtureId || 0) : 0;
    if (passType === PASS_TYPES.MATCH && (!Number.isSafeInteger(fixtureId) || fixtureId <= 0)) {
      return json({ error: 'Для Match Pass нужен корректный fixtureId.', code: 'BILLING_FIXTURE_REQUIRED' }, 400);
    }
    if (passType !== PASS_TYPES.MATCH && body?.fixtureId != null && Number(body.fixtureId || 0) !== 0) {
      return json({ error: 'Этот Pass не привязывается к матчу.', code: 'BILLING_FIXTURE_NOT_ALLOWED' }, 400);
    }

    const currentAccess = await resolveUserEntitlements(user.id, fixtureId, cfg);
    if (currentAccess.store?.available !== true) {
      return json({
        error: 'Pass-покупки временно недоступны: хранилище доступов ещё не готово.',
        code: 'BILLING_ENTITLEMENT_STORE_UNAVAILABLE',
      }, 503);
    }
    if (currentAccess.subscriptionActive) {
      return json({ error: 'Активная подписка уже включает расширенный доступ.', code: 'BILLING_SUBSCRIPTION_HAS_ACCESS' }, 409);
    }

    const payload = await createPassInvoicePayload(user.id, passType, fixtureId, cfg.botToken);
    const invoiceUrl = await telegramApi('createInvoiceLink', cfg, {
      title: product.title,
      description: product.description,
      payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: product.title, amount: product.stars }],
    });
    return json({ invoiceUrl, passType, fixtureId: fixtureId || null, stars: product.stars });
  }

  const plan = String(body?.plan || '').toUpperCase();
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
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Некорректное тело запроса.', code: 'BILLING_INVALID_JSON' }, 400);
  }
  const action = String(body?.action || '').trim().toLowerCase();
  if (!['cancel', 'resume'].includes(action)) {
    return json({ error: 'Укажите действие cancel или resume.', code: 'BILLING_INVALID_ACTION' }, 400);
  }
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

async function listRefundableBillingCharges(userId, cfg) {
  const uid = Number(userId);
  if (!Number.isSafeInteger(uid) || uid <= 0) return [];

  const items = [];
  let payments = [];
  if (hasSupabase(cfg)) {
    payments = await supaSelectMany(cfg, 'billing_payments', {
      telegram_id: `eq.${uid}`,
    }, {
      limit: 20,
      order: 'created_at.desc',
    }).catch(() => []);
  } else {
    payments = [...memory.billingPayments.values()]
      .filter(row => Number(row?.telegram_id || 0) === uid)
      .sort((a, b) => Date.parse(b?.created_at || 0) - Date.parse(a?.created_at || 0))
      .slice(0, 20);
  }

  for (const row of payments || []) {
    const chargeId = String(row?.telegram_payment_charge_id || '').trim();
    const status = String(row?.status || 'paid').toLowerCase();
    if (!chargeId || status !== 'paid') continue;
    items.push({
      kind: 'subscription',
      product: String(row?.plan || ''),
      stars: Math.max(0, Number(row?.stars_amount || 0)),
      status,
      createdAt: row?.created_at || null,
      expiresAt: row?.subscription_expiration_date || null,
      fixtureId: null,
      paymentChargeId: chargeId,
      chargeSuffix: chargeId.slice(-8),
    });
  }

  const entitlements = await listUserEntitlements(uid, cfg).catch(() => []);
  for (const row of entitlements || []) {
    const chargeId = String(row?.payment_charge_id || row?.paymentChargeId || '').trim();
    const status = String(row?.status || 'active').toLowerCase();
    if (!chargeId || status !== 'active') continue;
    items.push({
      kind: 'pass',
      product: String(row?.entitlement_type || row?.type || ''),
      stars: Math.max(0, Number(row?.stars_amount || row?.starsAmount || 0)),
      status,
      createdAt: row?.created_at || row?.createdAt || null,
      expiresAt: row?.expires_at || row?.expiresAt || null,
      fixtureId: Number(row?.fixture_id || row?.fixtureId || 0) || null,
      paymentChargeId: chargeId,
      chargeSuffix: chargeId.slice(-8),
    });
  }

  const seen = new Set();
  return items
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .filter(item => {
      if (seen.has(item.paymentChargeId)) return false;
      seen.add(item.paymentChargeId);
      return true;
    })
    .slice(0, 20);
}

async function apiBillingRefundLookup(request, cfg, user) {
  const url = new URL(request.url);
  const targetUserId = Number(url.searchParams.get('telegramId') || user?.id || 0);
  if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
    return json({ error:'Укажите корректный Telegram ID.', code:'BILLING_REFUND_INVALID_TARGET' }, 400);
  }
  const items = await listRefundableBillingCharges(targetUserId, cfg);
  return json({
    ok:true,
    telegramId:targetUserId,
    items,
  });
}

async function apiBillingRefund(request, cfg, user) {
  if (!isAdminUser(user, cfg)) return adminForbidden();

  let body;
  try { body = await request.json(); }
  catch { return json({ error:'Некорректное тело запроса.', code:'BILLING_INVALID_JSON' }, 400); }

  const targetUserId = Number(body?.telegramId || 0);
  const chargeId = String(body?.telegramPaymentChargeId || '').trim();
  const reason = String(body?.reason || '').trim().slice(0, 240);
  if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0 || !chargeId || chargeId.length > 240) {
    return json({ error:'Нужны корректные telegramId и Telegram payment charge ID.', code:'BILLING_REFUND_INVALID_TARGET' }, 400);
  }
  if (reason.length < 3) {
    return json({ error:'Для ручного возврата укажите причину.', code:'BILLING_REFUND_REASON_REQUIRED' }, 400);
  }

  const source = await findRefundableBillingCharge(targetUserId, chargeId, cfg);
  if (!source) return json({ error:'Платёж с таким charge ID не принадлежит указанному пользователю.', code:'BILLING_REFUND_NOT_FOUND' }, 404);

  let alreadyRefunded = source.status === 'refunded';
  if (!alreadyRefunded) {
    try {
      await telegramApi('refundStarPayment', cfg, {
        user_id: targetUserId,
        telegram_payment_charge_id: chargeId,
      });
    } catch (error) {
      // A previous manual attempt may have refunded Stars successfully before
      // the internal entitlement/subscription reconciliation failed. Telegram
      // documents CHARGE_ALREADY_REFUNDED for that retry; continue with the
      // idempotent internal reconciliation instead of issuing a second refund.
      if (!/CHARGE_ALREADY_REFUNDED/i.test(String(error?.message || ''))) throw error;
      alreadyRefunded = true;
    }
  }
  const revoked = await applyRefundedPayment(targetUserId, chargeId, cfg);
  await recordOpsEvent(cfg, {
    severity:'warning',
    source:'billing',
    eventType:'manual_refund',
    code:'BILLING_MANUAL_REFUND',
    message:'Администратор выполнил ручной возврат Telegram Stars.',
    endpoint:'/api/admin/billing/refund',
    status:200,
    meta:{
      kind:source.kind,
      product:source.plan,
      chargeSuffix:chargeId.slice(-8),
      reason,
      actorRole:'admin',
    },
  }).catch(() => null);

  return json({
    ok:true,
    refunded:true,
    reconciled:true,
    alreadyRefunded,
    kind:source.kind,
    subscriptionRevoked:Boolean(revoked?.subscriptionRevoked),
    passRevoked:Boolean(revoked?.passRevoked),
  });
}

const {
  getCacheEntry,
  getCache,
  getStaleCache,
  setCache,
} = createSharedCacheRuntime({
  memory,
  bumpTelemetry,
  phase5ProviderCacheUsage,
  hasSupabase,
  supaSelectOne,
  supaUpsert,
  pruneMemoryState,
  recordOpsEvent,
});

const {
  telegramWebAppUrl,
  telegramAnalysisHandoffParams,
  telegramFullAnalysisUrl,
  oneTapHandoffDrill,
  fixtureShareStartParam,
  campaignStartParam,
  telegramBotUsername,
  fixtureTelegramDeepLink,
  telegramCampaignDeepLink,
  telegramShareComposerUrl,
} = createTelegramLinksRuntime({
  cleanLaunchPart,
  getCache,
  setCache,
  telegramApi,
});


const CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES = 7 * 24 * 60;

async function claimChannelPublishIdempotency(cacheKey, meta = {}, cfg) {
  const key=String(cacheKey || '').slice(0,160);
  const fixtureId=Number(meta.fixtureId || 0);
  if (!key.startsWith('telegram:channel-publish:v1:')) return {claimed:false,unavailable:true};
  try {
    const existing=await getCacheEntry(key,cfg,true);
    if (existing && !existing.expired) {
      return {
        claimed:false,
        duplicate:true,
        inProgress:existing.payload?.state === 'publishing',
        messageId:Number(existing.payload?.messageId || 0) || null,
      };
    }
    if (existing?.expired) {
      memory.cache.delete(key);
      if (hasSupabase(cfg)) await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`}).catch(()=>null);
    }

    const claimId=crypto.randomUUID();
    const expiresAt=new Date(Date.now()+CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES*60_000).toISOString();
    const payload={
      state:'publishing',
      claimId,
      fixtureId,
      channelId:String(meta.channelId || '').slice(0,80),
      claimedAt:new Date().toISOString(),
      version:APP_VERSION,
    };

    if (!hasSupabase(cfg)) {
      memory.cache.set(key,{payload,expiresAt:Date.parse(expiresAt)});
      return {claimed:true,claimId,shared:false};
    }

    const url=new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
    url.searchParams.set('on_conflict','cache_key');
    const response=await fetchWithTimeout(url,{
      method:'POST',
      headers:supaHeaders(cfg,{Prefer:'resolution=ignore-duplicates,return=representation'}),
      body:JSON.stringify([{cache_key:key,fixture_id:fixtureId,payload,expires_at:expiresAt}]),
    },7000,'Telegram channel publish idempotency');
    if (!response.ok) throw new Error(`channel publisher idempotency HTTP ${response.status}`);
    const rows=await response.json().catch(()=>[]);
    if (Array.isArray(rows) && rows.length===1) {
      memory.cache.set(key,{payload,expiresAt:Date.parse(expiresAt)});
      return {claimed:true,claimId,shared:true};
    }
    const current=await getCacheEntry(key,cfg,true).catch(()=>null);
    return {
      claimed:false,
      duplicate:true,
      inProgress:current?.payload?.state === 'publishing',
      messageId:Number(current?.payload?.messageId || 0) || null,
      shared:true,
    };
  } catch (error) {
    void recordOpsEvent(cfg,{
      severity:'error',
      source:'channel_publisher',
      eventType:'idempotency',
      code:'CHANNEL_PUBLISH_IDEMPOTENCY_UNAVAILABLE',
      message:error?.message || error,
      endpoint:'/api/admin/channel-publisher/test',
      meta:{fixtureId},
    }).catch(()=>null);
    return {claimed:false,unavailable:true};
  }
}

async function completeChannelPublishIdempotency(cacheKey, meta = {}, cfg) {
  const key=String(cacheKey || '').slice(0,160);
  await setCache(key,Number(meta.fixtureId || 0),{
    state:'sent',
    claimId:String(meta.claimId || ''),
    fixtureId:Number(meta.fixtureId || 0),
    channelId:String(meta.channelId || '').slice(0,80),
    messageId:Number(meta.messageId || 0) || null,
    sentAt:new Date().toISOString(),
    version:APP_VERSION,
  },cfg,CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES);
}

async function releaseChannelPublishIdempotency(cacheKey, meta = {}, cfg) {
  const key=String(cacheKey || '').slice(0,160);
  const claimId=String(meta.claimId || '');
  if (!key || !claimId) return;
  try {
    const current=await getCacheEntry(key,cfg,true).catch(()=>null);
    if (String(current?.payload?.claimId || '')!==claimId || current?.payload?.state!=='publishing') return;
    memory.cache.delete(key);
    if (hasSupabase(cfg)) await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`});
  } catch {
    // A retained claim is safer than a duplicate channel post; TTL clears it later.
  }
}


const DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS = 90;
const DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS = 4;
const DISTRIBUTED_ANALYSIS_WAIT_MS = 1600;

function distributedAnalysisLockKey(fixtureId) {
  return `analysis:compute-lock:${Number(fixtureId || 0)}:v1`;
}

function distributedAnalysisLockPolicy() {
  return {
    ttlSeconds:DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS,
    waitAttempts:DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS,
    waitMs:DISTRIBUTED_ANALYSIS_WAIT_MS,
    maxWaitMs:DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS*DISTRIBUTED_ANALYSIS_WAIT_MS,
  };
}

async function claimDistributedAnalysisLock(fixtureId,cfg) {
  const id=Number(fixtureId || 0);
  const key=distributedAnalysisLockKey(id);
  if (!hasSupabase(cfg)) return {claimed:true,key,claimId:'local-only',shared:false,degraded:false};
  try {
    const existing=await getCacheEntry(key,cfg,true).catch(()=>null);
    if (existing && !existing.expired) {
      bumpTelemetry('analysisLockJoins');
      return {claimed:false,key,claimId:'',shared:true,degraded:false};
    }
    if (existing?.expired) {
      memory.cache.delete(key);
      await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`}).catch(()=>null);
    }

    const claimId=crypto.randomUUID();
    const expiresAt=new Date(Date.now()+DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS*1000).toISOString();
    const payload={state:'computing',fixtureId:id,claimId,claimedAt:new Date().toISOString(),version:APP_VERSION};
    const url=new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
    url.searchParams.set('on_conflict','cache_key');
    const r=await fetchWithTimeout(url,{
      method:'POST',
      headers:supaHeaders(cfg,{Prefer:'resolution=ignore-duplicates,return=representation'}),
      body:JSON.stringify([{cache_key:key,fixture_id:id,payload,expires_at:expiresAt}]),
    },7000,'Supabase analysis compute lock');
    if (!r.ok) throw new Error(`analysis lock HTTP ${r.status}`);
    const rows=await r.json().catch(()=>[]);
    if (Array.isArray(rows) && rows.length===1) {
      memory.cache.set(key,{payload,expiresAt:Date.parse(expiresAt)});
      bumpTelemetry('analysisLockClaims');
      return {claimed:true,key,claimId,shared:true,degraded:false};
    }
    bumpTelemetry('analysisLockJoins');
    return {claimed:false,key,claimId:'',shared:true,degraded:false};
  } catch (error) {
    bumpTelemetry('analysisLockFailOpen');
    void recordOpsEvent(cfg,{
      severity:'error',
      source:'analysis_lock',
      eventType:'analysis_lock_degraded',
      code:'ANALYSIS_LOCK_FAIL_CLOSED',
      message:error?.message || error,
      endpoint:'/api/analyze',
      meta:{fixtureId:id},
    }).catch(()=>null);
    return {claimed:false,key,claimId:'',shared:false,degraded:true,unavailable:true};
  }
}

async function releaseDistributedAnalysisLock(lock,cfg) {
  if (!lock?.shared || !lock?.claimId) return;
  try {
    const row=await supaSelectOne(cfg,'analysis_cache',{cache_key:`eq.${lock.key}`});
    if (String(row?.payload?.claimId || '')!==String(lock.claimId)) return;
    memory.cache.delete(lock.key);
    await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${lock.key}`});
  } catch {
    // TTL is the final safety net if cleanup fails.
  }
}

async function waitForSharedAnalysis(cacheKey,cfg) {
  for (let attempt=0;attempt<DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS;attempt++) {
    await sleepMs(DISTRIBUTED_ANALYSIS_WAIT_MS);
    const ready=await getCache(cacheKey,cfg).catch(()=>null);
    if (ready) {
      bumpTelemetry('analysisLockJoinHits');
      return ready;
    }
  }
  bumpTelemetry('analysisLockTimeouts');
  return null;
}

function distributedAnalysisLockDrill() {
  const p=distributedAnalysisLockPolicy();
  const key=distributedAnalysisLockKey(12345);
  return {pass:key==='analysis:compute-lock:12345:v1' && p.ttlSeconds>=60 && p.maxWaitMs>=5000 && p.maxWaitMs<15000,ttlSeconds:p.ttlSeconds,maxWaitMs:p.maxWaitMs};
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
    return { active: false, temperature: 1, candidateTemperature: 1, sample: valid.length, trainSample: 0, validationSample: 0, validationWindows: [], baselineLogLoss: null, calibratedLogLoss: null, improvement: null, reason: 'Нужно минимум 80 доверенных матчей для двух последовательных окон отложенной выборки.' };
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
      reason: 'Нужно минимум 80 доверенных матчей для двух последовательных окон проверки весов.',
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

  // RC30 gate: both sequential holdout windows must beat the baseline.
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
  if (!split.ready) return { pass: false, status: 'shadow', windows: [], reason: 'Недостаточно доверенных матчей для сравнения активной модели и кандидата.' };
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
    promote: 'активирована новая модель',
    rollback: 'выполнен автоматический откат',
    manual_rollback: 'выполнен ручной откат',
    freeze: 'жизненный цикл заморожен',
    unfreeze: 'жизненный цикл разморожен',
  };
  const text = `⚙️ Калибровка модели: ${labels[action] || action}.${detail ? `\n${String(detail).slice(0, 500)}` : ''}`;
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
      lifecycle: { available: false, status: 'blocked', activeFingerprint: baseline.fingerprint, challengerFingerprint: fingerprint, reason: 'Нужен файл миграции supabase_migration_v6_10.sql; рабочая версия остаётся на базовом профиле.' },
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
        reason: 'Инициализация базового жизненного цикла модели.',
        metadata: { appVersion: APP_VERSION },
      });
      lifecycle = { state, active: baseline, previous: null };
      await notifyCalibrationAdmins(cfg, 'initialize', `Активный профиль: ${baseline.fingerprint.slice(0, 12)}`);
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
      reason: 'Недостаточно доверенных матчей для отдельной проверки весов на отложенной выборке.',
    },
    promotionGate: {
      status: sample >= 20 ? 'shadow' : 'baseline',
      validationReady: false,
      trustedSample: sample,
      note: sample >= 20 ? 'Кандидат калибровки собирает доказательства в тени.' : 'Сначала нужно накопить достаточно доверенных завершённых прогнозов.',
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
        ? 'Автокалибровка прошла два последовательных окна доверенной отложенной выборки и готова к сравнению с активной моделью.'
        : validationReady
          ? 'Кандидат остаётся в режиме наблюдения: отложенная выборка ещё не подтвердила безопасное улучшение.'
          : 'Кандидат остаётся в режиме наблюдения до достаточной доверенной отложенной выборки.',
    },
    note: active
      ? 'Кандидат прошёл два окна отложенной выборки; постоянный жизненный цикл решает, можно ли заменить активную модель.'
      : shadow
        ? 'Кандидат измеряется в режиме наблюдения; рабочая система использует только подтверждённый активный профиль.'
        : 'Недостаточно доверенных прогнозов для безопасной автоматической калибровки.',
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
        return { ...baseline, lifecycle: { available: false, status: 'fallback', activeFingerprint: baseline.fingerprint, challengerFingerprint: candidate.fingerprint || null, reason: 'Не удалось сохранить жизненный цикл модели; рабочая версия остаётся на базовом профиле.' } };
      })
    : { ...candidate, fingerprint: await calibrationPromotionFingerprint(candidate), lifecycle: { available: false, status: 'memory' } };
  try { await setCache(CALIBRATION_CACHE_KEY, 0, profile, cfg, CALIBRATION_CACHE_MINUTES); } catch {}
  return profile;
}

async function captureAnalysisTimelineSnapshot(payload, cfg, { delta = null } = {}) {
  const row = analysisTimelineSnapshotRow(payload, { delta });
  if (!row) return false;

  const fixtureId = Number(row.fixture_id || 0);
  const local = memory.analysisTimelineSnapshots.get(fixtureId) || [];
  if (!local.some(item => item.snapshot_key === row.snapshot_key)) {
    local.push(row);
    local.sort((a, b) => Date.parse(a.captured_at || 0) - Date.parse(b.captured_at || 0));
    memory.analysisTimelineSnapshots.set(fixtureId, local.slice(-80));
  }

  if (!hasSupabase(cfg)) return true;
  try {
    await supaInsertIgnore(cfg, 'analysis_timeline_snapshots', row, 'snapshot_key');
    return true;
  } catch (error) {
    console.warn('AI timeline snapshot persistence skipped', error?.message || error);
    return false;
  }
}

async function getAnalysisTimelineSnapshots(fixtureId, cfg, limit = 80) {
  const id = Number(fixtureId || 0);
  if (!id) return [];
  if (hasSupabase(cfg)) {
    try {
      return await supaSelectMany(cfg, 'analysis_timeline_snapshots', {
        fixture_id: `eq.${id}`,
      }, {
        limit: Math.max(1, Math.min(120, Number(limit || 80))),
        order: 'captured_at.asc',
      });
    } catch (error) {
      console.warn('AI timeline history read skipped', error?.message || error);
    }
  }
  return (memory.analysisTimelineSnapshots.get(id) || []).slice(-Math.max(1, Math.min(120, Number(limit || 80))));
}

async function loadFixtureAiTimeline({ fixtureId, match = {}, events = [], cfg } = {}) {
  const id = Number(fixtureId || 0);
  if (!id) return buildAiTimeline({ match, events });
  const [snapshotRows, modelPrediction, oddsSnapshots] = await Promise.all([
    getAnalysisTimelineSnapshots(id, cfg, 80),
    loadModelPredictionForFixture(id, cfg).catch(() => null),
    getOddsSnapshots(id, cfg, 20).catch(() => []),
  ]);
  return buildAiTimeline({
    snapshotRows,
    modelPrediction,
    oddsSnapshots,
    events,
    match,
  });
}


async function loadModelPredictionForFixture(fixtureId, cfg) {
  const id=Number(fixtureId || 0);
  if (!id) return null;
  if (hasSupabase(cfg)) {
    try { return await supaSelectOne(cfg,'model_predictions',{fixture_id:`eq.${id}`}); }
    catch (error) { console.warn('post-match prediction read skipped',error?.message || error); return null; }
  }
  return memory.modelPredictions.get(id) || null;
}

function postMatchOutcomeLabel(value = '') {
  const key=String(value || '');
  return key==='home'?'П1':key==='draw'?'Н':key==='away'?'П2':'—';
}

function postMatchPredictionProbability(row = {}, outcome = '') {
  const key=String(outcome || '');
  const value=key==='home'?row.home_prob:key==='draw'?row.draw_prob:key==='away'?row.away_prob:null;
  return Number.isFinite(Number(value)) ? Math.round(Number(value)*10)/10 : null;
}

function postMatchStatValue(statistics = {}, key = '', side = 'home') {
  const item=(statistics?.items || []).find(x=>String(x?.key || '')===String(key));
  if (!item) return null;
  const raw=item?.[side];
  if (raw===null || raw===undefined || raw==='') return null;
  const n=Number(String(raw).replaceAll('%','').replace(',','.'));
  return Number.isFinite(n) ? n : null;
}

function buildPostMatchReview({prediction,fixture,statistics,events,homeName='',awayName=''}) {
  if (!prediction?.fixture_id) {
    return {available:false,state:'no_snapshot',headline:'Нет сохранённого предматчевого снимка',summary:'Этот матч можно изучить по фактической статистике, но честно сравнить его с AI-прогнозом нельзя: до старта снимок модели не был сохранён.',evidence:[],markets:[],calibration:{included:false}};
  }
  const score=regulationScore(fixture) || (
    Number.isFinite(Number(prediction.actual_home_goals)) && Number.isFinite(Number(prediction.actual_away_goals))
      ? {home:Number(prediction.actual_home_goals),away:Number(prediction.actual_away_goals)}
      : null
  );
  const actualOutcome=String(prediction.actual_outcome || (score ? actualOutcomeFromGoals(score.home,score.away) : ''));
  if (!score || !actualOutcome) {
    return {available:false,state:'awaiting_result',headline:'Жду финальный результат',summary:'Предматчевый снимок сохранён, но итог матча ещё не подтверждён для сравнения.',evidence:[],markets:[],calibration:{included:false}};
  }

  const predictedOutcome=String(prediction.predicted_outcome || '');
  const predictedProbability=postMatchPredictionProbability(prediction,predictedOutcome);
  const outcomeCorrect=predictedOutcome===actualOutcome;
  const settled=String(prediction.status || '')==='settled';
  const totalGoals=Number(score.home)+Number(score.away);
  const overActual=prediction.over25_actual===null || prediction.over25_actual===undefined ? totalGoals>=3 : Boolean(prediction.over25_actual);
  const bttsActual=prediction.btts_actual===null || prediction.btts_actual===undefined ? Number(score.home)>0 && Number(score.away)>0 : Boolean(prediction.btts_actual);
  const markets=[];

  if (Number.isFinite(Number(prediction.over25_prob))) {
    const overPred=Number(prediction.over25_prob)>=50;
    markets.push({code:'over25',label:'Тотал 2.5',predicted:overPred?'ТБ 2.5':'ТМ 2.5',probability:Math.round(Number(prediction.over25_prob)*10)/10,actual:overActual?'ТБ 2.5':'ТМ 2.5',correct:overPred===overActual});
  }
  if (Number.isFinite(Number(prediction.btts_prob))) {
    const bttsPred=Number(prediction.btts_prob)>=50;
    markets.push({code:'btts',label:'Обе забьют',predicted:bttsPred?'Да':'Нет',probability:Math.round(Number(prediction.btts_prob)*10)/10,actual:bttsActual?'Да':'Нет',correct:bttsPred===bttsActual});
  }

  const evidence=[];
  const add=(code,icon,title,text,importance='medium')=>evidence.push({code,icon,title,text,importance});
  const hred=postMatchStatValue(statistics,'Red Cards','home') || 0;
  const ared=postMatchStatValue(statistics,'Red Cards','away') || 0;
  const redEvents=(events || []).filter(x=>String(x?.detail || '').toLowerCase().includes('red') || String(x?.label || '').includes('🟥'));
  if (hred+ared>0 || redEvents.length) {
    const redSide=hred>ared?homeName:ared>hred?awayName:(redEvents[0]?.teamName || 'одной из команд');
    add('red_card','🟥','Удаление в матче',`У ${redSide || 'одной из команд'} была красная карточка. Такое событие могло заметно изменить игровой сценарий.`,'high');
  }

  const hxg=postMatchStatValue(statistics,'expected_goals','home');
  const axg=postMatchStatValue(statistics,'expected_goals','away');
  if (hxg!==null && axg!==null && Math.abs(hxg-axg)>=0.45) {
    const side=hxg>axg?(homeName || 'Хозяева'):(awayName || 'Гости');
    add('xg','📈','Разница по xG',`${side} создал больше качества моментов по доступному xG: ${hxg.toFixed(2)} — ${axg.toFixed(2)}.`,Math.abs(hxg-axg)>=1?'high':'medium');
  }

  const hso=postMatchStatValue(statistics,'Shots on Goal','home');
  const aso=postMatchStatValue(statistics,'Shots on Goal','away');
  if (hso!==null && aso!==null && Math.abs(hso-aso)>=2) {
    const side=hso>aso?(homeName || 'Хозяева'):(awayName || 'Гости');
    add('shots_on_goal','🎯','Удары в створ',`${side} имел заметный перевес по ударам в створ: ${hso} — ${aso}.`,'medium');
  }

  const earlyGoal=(events || []).find(x=>String(x?.type || '').toLowerCase()==='goal' && Number(x?.minute || 0)>0 && Number(x.minute)<=20);
  if (earlyGoal) add('early_goal','⚽','Ранний гол',`Гол на ${Number(earlyGoal.minute)}-й минуте мог изменить исходный план команд и дальнейший рисунок игры.`,'medium');

  const hpos=postMatchStatValue(statistics,'Ball Possession','home');
  const apos=postMatchStatValue(statistics,'Ball Possession','away');
  if (hpos!==null && apos!==null && Math.abs(hpos-apos)>=15) {
    const side=hpos>apos?(homeName || 'Хозяева'):(awayName || 'Гости');
    add('possession','🧭','Контроль мяча',`${side} заметно больше контролировал мяч: ${Math.round(hpos)}% — ${Math.round(apos)}%.`,'low');
  }

  if (!evidence.length) add('scoreline','📌','Итоговый счёт',`Матч завершился ${score.home}:${score.away}. Детальных событий или статистики недостаточно для более глубокого объяснения.`,'low');

  const predictedLabel=postMatchOutcomeLabel(predictedOutcome);
  const actualLabel=postMatchOutcomeLabel(actualOutcome);
  const summary=`До матча максимальная вероятность была у ${predictedLabel}${predictedProbability===null?'':` — ${predictedProbability}%`}. Факт: ${actualLabel}, счёт ${score.home}:${score.away}.`;
  const brier=Number.isFinite(Number(prediction.brier_score)) ? Math.round(Number(prediction.brier_score)*1000)/1000 : null;
  return {
    available:true,
    state:'reviewed',
    headline:outcomeCorrect?'Главный исход совпал':'Главный исход не совпал',
    summary,
    score:{home:Number(score.home),away:Number(score.away)},
    outcome:{predicted:predictedOutcome,predictedLabel,probability:predictedProbability,actual:actualOutcome,actualLabel,correct:outcomeCorrect},
    markets,
    evidence:evidence.slice(0,3),
    quality:{
      brier,
      confidence:Number.isFinite(Number(prediction.confidence_score))?Math.round(Number(prediction.confidence_score)):null,
      completeness:Number(prediction.completeness_max || 0)>0?Math.round(Number(prediction.completeness_score || 0)/Number(prediction.completeness_max)*100):null,
      calibrationMode:String(prediction.calibration_mode || 'baseline'),
    },
    calibration:{
      included:settled,
      verificationState:String(prediction.settlement_verification_state || ''),
      note:settled
        ? 'Результат сохранён в журнале калибровки. Один матч не перенастраивает модель — изменения принимаются только по накопленной выборке.'
        : 'Предматчевый снимок сохранён, но settlement ещё не завершён.',
    },
    disclaimer:'Факторы ниже описывают наблюдаемую статистику и события матча; они не доказывают причинность результата.',
  };
}

function postMatchReviewDrill() {
  const prediction={fixture_id:7,status:'settled',predicted_outcome:'home',home_prob:56,draw_prob:25,away_prob:19,actual_home_goals:2,actual_away_goals:1,actual_outcome:'home',brier_score:0.11,over25_prob:62,over25_actual:true,btts_prob:55,btts_actual:true,confidence_score:71,completeness_score:8,completeness_max:10};
  const fixture={fixture:{id:7,status:{short:'FT'}},goals:{home:2,away:1},score:{fulltime:{home:2,away:1}}};
  const statistics={items:[{key:'expected_goals',home:1.9,away:0.8},{key:'Shots on Goal',home:6,away:2}]};
  const review=buildPostMatchReview({prediction,fixture,statistics,events:[{type:'Goal',minute:12}],homeName:'Home',awayName:'Away'});
  return {pass:review.available && review.outcome.correct===true && review.markets.length===2 && review.markets.every(x=>x.correct===true) && review.evidence.some(x=>x.code==='xg'),cases:4};
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
      text: `В периоде ${sample} завершённых прогнозов. Разрезы по лигам и уверенности пока нужно читать как диагностику, а не как устойчивые закономерности.`,
    });
  }

  if (sample >= 20 && Number.isFinite(Number(overall.calibrationGap)) && Number(overall.calibrationGap) >= 8) {
    notes.push({
      level: 'warn',
      title: 'Модель выглядит переуверенной',
      text: `Средняя максимальная вероятность выше фактической точности примерно на ${Number(overall.calibrationGap).toFixed(1)} п.п. Калибровку стоит продолжать проверять на новых матчах.`,
    });
  }

  const high = (dashboard?.confidence || []).find(x => x.label === '80+');
  const mid = (dashboard?.confidence || []).find(x => x.label === '60–69');
  if (Number(high?.sample || 0) >= 12 && Number(mid?.sample || 0) >= 12 &&
      Number.isFinite(Number(high?.accuracy)) && Number.isFinite(Number(mid?.accuracy)) &&
      Number(high.accuracy) <= Number(mid.accuracy)) {
    notes.push({
      level: 'warn',
      title: 'Высокая уверенность пока не даёт прироста',
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
      text: `${weakLeague.leagueName}: n=${weakLeague.sample}, ошибка Брайера ${Number(weakLeague.avgBrier).toFixed(3)} против общего значения ${Number(overall.avgBrier).toFixed(3)}. Возможна специфика турнира или просто шум выборки.`,
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
      title: 'Один источник слабее итогового объединённого прогноза',
      text: `${weakSignal.label}: собственная ошибка Брайера ${Number(weakSignal.signalBrier).toFixed(3)}, итоговый прогноз на тех же матчах ${Number(weakSignal.finalBrier).toFixed(3)}. Текущий вес уже ограничен защитными правилами.`,
    });
  }

  const latest = (dashboard?.trend || []).slice(-3);
  if (latest.length >= 3 && latest.every(x => Number(x.sample || 0) >= 4)) {
    const first = Number(latest[0]?.avgBrier);
    const last = Number(latest[latest.length - 1]?.avgBrier);
    if (Number.isFinite(first) && Number.isFinite(last) && last <= first - 0.025) {
      notes.push({
        level: 'good',
        title: 'Последние недели выглядят лучше по ошибке Брайера',
        text: `Ошибка Брайера снизилась примерно с ${first.toFixed(3)} до ${last.toFixed(3)}. Нужна более длинная серия, чтобы считать это устойчивым улучшением.`,
      });
    }
  }

  if (!notes.length) {
    notes.push({
      level: 'info',
      title: 'Явных диагностических отклонений нет',
      text: 'Продолжаем накапливать неизменяемые предматчевые снимки. Контроль результатов и безопасное восстановление не меняют веса модели автоматически.',
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
  dashboard.note = 'Панель использует неизменяемые предматчевые снимки и фактические результаты. Группы версий носят описательный характер: система не выбирает «лучшую» версию и ничего не продвигает автоматически.';
  return dashboard;
}


function publicTrackRecordSampleState(sample = 0) {
  const n=Math.max(0,Number(sample || 0));
  if (!n) return {code:'empty',label:'Данных пока нет',message:'Подтверждённая история модели только формируется.'};
  if (n<20) return {code:'early',label:'Малая выборка',message:'Матчей пока мало — цифры показывают только раннюю историю и могут заметно меняться.'};
  if (n<50) return {code:'forming',label:'Выборка формируется',message:'История уже полезна для проверки модели, но всё ещё чувствительна к каждому новому матчу.'};
  return {code:'informative',label:'Выборка информативнее',message:'Накоплено больше подтверждённых матчей, но прошлые результаты всё равно не гарантируют будущие.'};
}

function buildPublicAiTrackRecord(settledRows = [], pendingRows = [], days = 180) {
  const rows=verifiedSettledRows(settledRows,pendingRows);
  const matched=rows.filter(row=>row.correct===true).length;
  const missed=rows.filter(row=>row.correct===false).length;
  const brierValues=rows.map(verifiedBrierScore).filter(Number.isFinite);
  const avgBrier=brierValues.length ? Math.round((average(brierValues) || 0)*1000)/1000 : null;
  const overRows=rows.filter(row=>typeof row.over25_correct==='boolean');
  const bttsRows=rows.filter(row=>typeof row.btts_correct==='boolean');
  const sampleState=publicTrackRecordSampleState(rows.length);
  const recent=rows.slice(0,8).map(row=>({
    fixtureId:Number(row.fixture_id || 0),
    kickoffAt:row.kickoff_at || null,
    league:String(row.league_name || ''),
    home:String(row.home_name || ''),
    away:String(row.away_name || ''),
    score:`${Number(row.actual_home_goals)}:${Number(row.actual_away_goals)}`,
    predictedOutcome:String(row.predicted_outcome || ''),
    predictedLabel:predictionOutcomeLabel(row.predicted_outcome,row.home_name,row.away_name),
    actualOutcome:String(row.actual_outcome || ''),
    actualLabel:predictionOutcomeLabel(row.actual_outcome,row.home_name,row.away_name),
    topProbability:Math.round(topProbabilityValue(row)*10)/10,
    matched:row.correct===true,
    brier:Number.isFinite(verifiedBrierScore(row)) ? Math.round(verifiedBrierScore(row)*1000)/1000 : null,
  }));
  return {
    available:true,
    periodDays:Number(days || 180),
    generatedAt:new Date().toISOString(),
    sample:{
      verified:rows.length,
      matched,
      missed,
      pending:Number((pendingRows || []).length),
      excluded:Math.max(0,Number((settledRows || []).length)-rows.length),
      state:sampleState.code,
      label:sampleState.label,
      message:sampleState.message,
    },
    probabilityQuality:{
      avgBrier,
      label:'Ошибка Брайера',
      explanation:'Показывает качество всех вероятностей П1 / Н / П2 одновременно. Ниже — лучше; размер выборки всегда показывается рядом.',
    },
    secondary:{
      over25:{sample:overRows.length,matched:overRows.filter(row=>row.over25_correct===true).length,missed:overRows.filter(row=>row.over25_correct===false).length},
      btts:{sample:bttsRows.length,matched:bttsRows.filter(row=>row.btts_correct===true).length,missed:bttsRows.filter(row=>row.btts_correct===false).length},
    },
    recent,
    methodology:{
      immutablePrematch:true,
      verifiedOnly:true,
      profitabilityMetric:false,
      note:'Используются только неизменяемые предматчевые снимки с подтверждённым или административно разобранным финальным результатом.',
      disclaimer:'Совпадение исхода не равно доходности ставки. MatchRadar AI показывает историю модели и качество вероятностей, а не обещание будущего результата.',
    },
  };
}

async function loadPublicAiTrackRecord(cfg, days = 180, options = {}) {
  const allowed=[90,180,365];
  const period=allowed.includes(Number(days))?Number(days):180;
  const cacheKey=`public:ai-track-record:${period}:v1`;
  if (!options.force) {
    const cached=await getCache(cacheKey,cfg).catch(()=>null);
    if (cached?.available) return {...cached,cached:true};
  }
  const since=new Date(Date.now()-period*86400_000).toISOString();
  let settled=[],pending=[];
  if (hasSupabase(cfg)) {
    [settled,pending]=await Promise.all([
      supaSelectMany(cfg,'model_predictions',{status:'eq.settled',kickoff_at:`gte.${since}`},{limit:500,order:'kickoff_at.desc'}),
      supaSelectMany(cfg,'model_predictions',{status:'eq.pending',kickoff_at:`gte.${since}`},{limit:500,order:'kickoff_at.desc'}),
    ]);
  } else {
    const all=[...memory.modelPredictions.values()].filter(row=>Date.parse(row.kickoff_at || '')>=Date.parse(since));
    settled=all.filter(row=>row.status==='settled').sort((a,b)=>Date.parse(b.kickoff_at || 0)-Date.parse(a.kickoff_at || 0));
    pending=all.filter(row=>row.status==='pending');
  }
  const result=buildPublicAiTrackRecord(settled,pending,period);
  await setCache(cacheKey,0,result,cfg,10).catch(()=>null);
  return result;
}

async function apiAiTrackRecord(request, cfg) {
  const url=new URL(request.url);
  const days=Number(url.searchParams.get('days') || 180);
  try {
    return json(await loadPublicAiTrackRecord(cfg,days,{force:url.searchParams.get('refresh')==='1'}));
  } catch (error) {
    return json({available:false,reason:'История качества AI временно недоступна.',detail:redactOpsString(error?.message || error,160)},503);
  }
}

function publicAiTrackRecordDrill() {
  const base={status:'settled',settlement_verification_state:'confirmed',captured_at:'2026-09-22T17:00:00Z',kickoff_at:'2026-09-22T18:00:00Z',home_prob:55,draw_prob:25,away_prob:20,predicted_outcome:'home',home_name:'Home',away_name:'Away',league_name:'League',over25_prob:60,btts_prob:52};
  const hit={...base,fixture_id:1,actual_home_goals:2,actual_away_goals:1,actual_outcome:'home',correct:true,over25_correct:true,btts_correct:true};
  const miss={...base,fixture_id:2,kickoff_at:'2026-09-21T18:00:00Z',captured_at:'2026-09-21T17:00:00Z',actual_home_goals:0,actual_away_goals:1,actual_outcome:'away',correct:false,over25_correct:false,btts_correct:false};
  const unverified={...hit,fixture_id:3,settlement_verification_state:'unverified'};
  const result=buildPublicAiTrackRecord([hit,miss,unverified],[],180);
  return {pass:result.sample.verified===2 && result.sample.matched===1 && result.sample.missed===1 && result.sample.state==='early' && result.recent.length===2 && result.methodology.profitabilityMetric===false,cases:6};
}


const SETTLEMENT_FINALITY_DELAY_HOURS = 6;
const SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS = 24;
const SETTLEMENT_FINALITY_LOOKBACK_DAYS = 7;
const SETTLEMENT_FINALITY_MAX_FIXTURES = 100;
const SETTLEMENT_FINALITY_MAX_DATES = 3;
const SETTLEMENT_FINALITY_DRIFT_STATUSES = new Set(['AWD', 'WO', 'CANC', 'ABD']);


const SETTLEMENT_DRIFT_ACTIONS = new Set(['keep_stored', 'accept_provider', 'void_prediction']);


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


const SETTLEMENT_RUN_STALE_MINUTES = 30;
const SETTLEMENT_RUN_MAX_ATTEMPTS = 3;


const SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD = 2;
const SETTLEMENT_CIRCUIT_OPEN_HOURS = 72;


const POST_MATCH_RETURN_MIN_DELAY_MINUTES = 105;
const POST_MATCH_RETURN_MAX_AGE_HOURS = 18;
const POST_MATCH_RETURN_COOLDOWN_MINUTES = 30;
const POST_MATCH_RETURN_MARKER_DAYS = 30;

function postMatchReturnDisabledKey(userId) {
  return `postmatch:return:disabled:${Number(userId || 0)}:v1`;
}
function postMatchReturnCooldownKey(userId) {
  return `postmatch:return:cooldown:${Number(userId || 0)}:v1`;
}
function postMatchReturnDeliveryKey(userId, fixtureId) {
  return `postmatch:return:delivery:${Number(userId || 0)}:${Number(fixtureId || 0)}:v1`;
}

function postMatchReturnEligibility(history = {}, prediction = {}, now = Date.now()) {
  const userId=Number(history.telegram_id || 0);
  const fixtureId=Number(history.fixture_id || 0);
  const kickoffMs=Date.parse(history.fixture_date || '');
  const settled=String(prediction?.status || '')==='settled';
  const homeGoals=Number(prediction?.actual_home_goals);
  const awayGoals=Number(prediction?.actual_away_goals);
  if (!userId || !fixtureId || !Number.isFinite(kickoffMs)) return {eligible:false,reason:'identity'};
  if (kickoffMs > now-POST_MATCH_RETURN_MIN_DELAY_MINUTES*60_000) return {eligible:false,reason:'too_early'};
  if (kickoffMs < now-POST_MATCH_RETURN_MAX_AGE_HOURS*3600_000) return {eligible:false,reason:'too_old'};
  if (!settled || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return {eligible:false,reason:'not_settled'};
  return {eligible:true,reason:'settled',userId,fixtureId,kickoffMs};
}

function postMatchReturnMessage(history = {}, prediction = {}) {
  const fixtureId=Number(history.fixture_id || prediction.fixture_id || 0);
  const home=String(history.home_name || prediction.home_name || 'Хозяева');
  const away=String(history.away_name || prediction.away_name || 'Гости');
  const homeGoals=Number(prediction.actual_home_goals);
  const awayGoals=Number(prediction.actual_away_goals);
  const predicted=String(prediction.predicted_outcome || '');
  const actual=String(prediction.actual_outcome || actualOutcomeFromGoals(homeGoals,awayGoals));
  const predictedLabel=postMatchOutcomeLabel(predicted);
  const actualLabel=postMatchOutcomeLabel(actual);
  const probability=postMatchPredictionProbability(prediction,predicted);
  const correct=prediction.correct===true || (predicted && predicted===actual);
  const signal=String(history.ai_signal_label || '').trim();
  const text=[
    '🏁 <b>Матч завершён · MatchRadar AI</b>',
    `<b>${telegramHtmlEscape(home)} — ${telegramHtmlEscape(away)} · ${homeGoals}:${awayGoals}</b>`,
    history.league_name ? telegramHtmlEscape(history.league_name) : '',
    '',
    signal ? `🧠 До матча: <b>${telegramHtmlEscape(signal)}</b>` : '',
    `📊 Исход модели: <b>${telegramHtmlEscape(predictedLabel)}</b>${probability===null?'':` · ${probability}%`} → факт <b>${telegramHtmlEscape(actualLabel)}</b>`,
    correct ? '✅ Главный исход совпал.' : '❌ Главный исход не совпал.',
    '',
    'Откройте итог AI — сверю исход, тотал, обе забьют и фактический контекст матча.',
  ].filter(Boolean).join('\n');
  return {
    text,
    replyMarkup:{inline_keyboard:[
      [{text:'🧠 Открыть итог AI',callback_data:`match:return_review:${fixtureId}`}],
      [{text:'⚽ Матчи сегодня',callback_data:'feed:today'},{text:'🔕 Не присылать итоги',callback_data:'postmatch:return:off'}],
    ]},
    correct,
  };
}

function postMatchReturnDrill() {
  const now=Date.parse('2026-09-23T22:00:00Z');
  const history={telegram_id:10,fixture_id:77,fixture_date:'2026-09-23T19:30:00Z',home_name:'Home',away_name:'Away',league_name:'League',ai_signal_label:'П1 осторожно'};
  const settled={fixture_id:77,status:'settled',predicted_outcome:'home',home_prob:58,draw_prob:24,away_prob:18,actual_home_goals:2,actual_away_goals:0,actual_outcome:'home',correct:true};
  const pending={...settled,status:'pending'};
  const eligible=postMatchReturnEligibility(history,settled,now);
  const blockedPending=postMatchReturnEligibility(history,pending,now);
  const blockedEarly=postMatchReturnEligibility({...history,fixture_date:'2026-09-23T21:00:00Z'},settled,now);
  const message=postMatchReturnMessage(history,settled);
  return {pass:eligible.eligible && !blockedPending.eligible && !blockedEarly.eligible && message.correct && message.text.includes('2:0') && message.replyMarkup.inline_keyboard[0][0].callback_data==='match:return_review:77',cases:4};
}

async function loadPostMatchReturnCandidates(cfg, now = Date.now()) {
  if (!hasSupabase(cfg)) return {rows:[],truncated:false};
  const since=new Date(now-POST_MATCH_RETURN_MAX_AGE_HOURS*3600_000).toISOString();
  const cutoff=now-POST_MATCH_RETURN_MIN_DELAY_MINUTES*60_000;
  const page=await supaSelectPaged(cfg,'analysis_history',{fixture_date:`gte.${since}`},{
    pageSize:500,
    maxRows:5000,
    order:'fixture_date.desc',
  });
  return {
    rows:(page.rows || []).filter(row=>{
      const kickoff=Date.parse(row.fixture_date || '');
      return Number(row.telegram_id || 0)>0 && Number(row.fixture_id || 0)>0 && Number.isFinite(kickoff) && kickoff<=cutoff;
    }),
    truncated:Boolean(page.truncated),
  };
}

async function loadPostMatchReturnPredictions(fixtureIds = [], cfg) {
  const ids=[...new Set((fixtureIds || []).map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))];
  const rows=[];
  for (let i=0;i<ids.length;i+=60) {
    const chunk=ids.slice(i,i+60);
    const page=await supaSelectMany(cfg,'model_predictions',{fixture_id:`in.(${chunk.join(',')})`},{limit:chunk.length+5});
    rows.push(...(page || []));
  }
  return rows;
}

async function refreshPostMatchSettlement(candidates = [], predictions = [], cfg) {
  const byId=new Map((predictions || []).map(row=>[Number(row.fixture_id),row]));
  const pendingIds=new Set((candidates || [])
    .map(row=>Number(row.fixture_id || 0))
    .filter(id=>id && String(byId.get(id)?.status || '')==='pending'));
  if (!pendingIds.size) return {probed:0,settled:0,skipped:'no_pending'};
  if (!freeQuotaHealthy(15,2)) return {probed:0,settled:0,skipped:'quota_guard'};

  const dates=[...new Set((candidates || [])
    .filter(row=>pendingIds.has(Number(row.fixture_id || 0)))
    .map(row=>String(row.fixture_date || '').slice(0,10))
    .filter(Boolean))].slice(0,2);
  let probed=0, settled=0;
  for (const date of dates) {
    const markerKey=`postmatch:return:probe:${date}:v1`;
    if (await getCache(markerKey,cfg)) continue;
    await setCache(markerKey,0,{state:'probing',at:new Date().toISOString()},cfg,30);
    try {
      const fixtures=await loadProviderFixturesForDate(date,cfg);
      const relevant=(fixtures || []).filter(f=>pendingIds.has(fixtureIdentity(f)));
      const result=await settlePredictionsFromFixtures(relevant,cfg);
      probed++;
      settled+=Number(result.settled || 0);
      await setCache(markerKey,0,{state:'done',at:new Date().toISOString(),checked:result.checked,settled:result.settled},cfg,30);
    } catch (error) {
      await setCache(markerKey,0,{state:'failed',at:new Date().toISOString(),error:redactOpsString(error?.message || error,120)},cfg,10);
    }
  }
  return {probed,settled};
}

async function claimPostMatchReturnDelivery(userId, fixtureId, cfg) {
  const key=postMatchReturnDeliveryKey(userId,fixtureId);
  if (!hasSupabase(cfg)) return {claimed:false,key};
  const prior=await getCacheEntry(key,cfg,true).catch(()=>null);
  const priorClaimedAt=Date.parse(prior?.payload?.claimedAt || '');
  if (prior?.payload?.state==='claimed' && Number.isFinite(priorClaimedAt) && priorClaimedAt < Date.now()-15*60_000) {
    memory.cache.delete(key);
    await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`}).catch(()=>null);
  }
  const expiresAt=new Date(Date.now()+POST_MATCH_RETURN_MARKER_DAYS*86400_000).toISOString();
  const url=new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
  url.searchParams.set('on_conflict','cache_key');
  const payload={state:'claimed',userId:Number(userId),fixtureId:Number(fixtureId),claimedAt:new Date().toISOString(),version:APP_VERSION};
  const r=await fetchWithTimeout(url,{
    method:'POST',
    headers:supaHeaders(cfg,{Prefer:'resolution=ignore-duplicates,return=representation'}),
    body:JSON.stringify([{cache_key:key,fixture_id:Number(fixtureId),payload,expires_at:expiresAt}]),
  },7000,'Supabase post-match return claim');
  if (!r.ok) throw new Error(`Supabase post-match return claim: HTTP ${r.status}`);
  const rows=await r.json().catch(()=>[]);
  if (Array.isArray(rows) && rows.length===1) {
    memory.cache.set(key,{payload,expiresAt:Date.parse(expiresAt)});
    return {claimed:true,key};
  }
  return {claimed:false,key};
}

async function finishPostMatchReturnClaim(key, userId, fixtureId, cfg) {
  if (!key) return;
  const payload={state:'sent',userId:Number(userId),fixtureId:Number(fixtureId),sentAt:new Date().toISOString(),version:APP_VERSION};
  const expiresAt=Date.now()+POST_MATCH_RETURN_MARKER_DAYS*86400_000;
  memory.cache.set(key,{payload,expiresAt});
  if (hasSupabase(cfg)) await supaPatch(cfg,'analysis_cache',{cache_key:`eq.${key}`},{payload,expires_at:new Date(expiresAt).toISOString()}).catch(()=>null);
}

async function releasePostMatchReturnClaim(key, cfg) {
  if (!key) return;
  memory.cache.delete(key);
  if (hasSupabase(cfg)) await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`}).catch(()=>null);
}

async function processPostMatchReturns(cfg) {
  return await withSingleFlight('cron:post-match-return', async()=>{
    if (!hasSupabase(cfg) || !cfg.botToken) return {checked:0,eligible:0,sent:0,failed:0,skipped:'not_configured'};
    const runtime=await loadRuntimeControls(cfg);
    if (runtime.value?.remindersEnabled===false) return {checked:0,eligible:0,sent:0,failed:0,skipped:'notifications_disabled'};

    const now=Date.now();
    let candidatePage={rows:[],truncated:false};
    try { candidatePage=await loadPostMatchReturnCandidates(cfg,now); }
    catch (error) {
      await recordOpsEvent(cfg,{severity:'warning',source:'post_match_return',eventType:'post_match_return',code:'RETURN_HISTORY_READ_FAILED',message:error?.message || error,endpoint:'cron:post-match-return'}).catch(()=>null);
      return {checked:0,eligible:0,sent:0,failed:1,truncated:false};
    }
    const candidates=candidatePage.rows || [];
    if (candidatePage.truncated) {
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'post_match_return',
        eventType:'post_match_return',
        code:'RETURN_HISTORY_TRUNCATED',
        message:'Post-match return history scan reached the 5000-row safety cap.',
        endpoint:'cron:post-match-return',
        meta:{loaded:Number(candidates.length || 0),cap:5000},
      }).catch(()=>null);
    }
    if (!candidates.length) return {checked:0,eligible:0,sent:0,failed:0,truncated:Boolean(candidatePage.truncated)};

    const ids=[...new Set(candidates.map(row=>Number(row.fixture_id || 0)).filter(Boolean))];
    let predictions=await loadPostMatchReturnPredictions(ids,cfg).catch(()=>[]);
    const refresh=await refreshPostMatchSettlement(candidates,predictions,cfg);
    if (Number(refresh.settled || 0)>0) predictions=await loadPostMatchReturnPredictions(ids,cfg).catch(()=>predictions);
    const predictionMap=new Map(predictions.map(row=>[Number(row.fixture_id),row]));

    let eligible=0,sent=0,failed=0,deduped=0,disabled=0,cooldown=0;
    const sentUsers=new Set();
    for (const history of candidates) {
      const userId=Number(history.telegram_id || 0);
      const fixtureId=Number(history.fixture_id || 0);
      const prediction=predictionMap.get(fixtureId);
      const state=postMatchReturnEligibility(history,prediction,now);
      if (!state.eligible) continue;
      eligible++;
      if (sentUsers.has(userId)) { cooldown++; continue; }
      if (await getCache(postMatchReturnDisabledKey(userId),cfg)) { disabled++; continue; }
      if (await getCache(postMatchReturnCooldownKey(userId),cfg)) { cooldown++; continue; }

      let claim;
      try { claim=await claimPostMatchReturnDelivery(userId,fixtureId,cfg); }
      catch (error) { failed++; continue; }
      if (!claim.claimed) { deduped++; continue; }

      const message=postMatchReturnMessage(history,prediction);
      const result=await sendTelegramMessage(userId,message.text,cfg,{parseMode:'HTML',replyMarkup:message.replyMarkup});
      if (result.ok) {
        sent++;
        sentUsers.add(userId);
        await finishPostMatchReturnClaim(claim.key,userId,fixtureId,cfg);
        await setCache(postMatchReturnCooldownKey(userId),fixtureId,{sentAt:new Date().toISOString(),fixtureId},cfg,POST_MATCH_RETURN_COOLDOWN_MINUTES);
        void recordGrowthEvent(cfg,{userId,eventName:'post_match_return_sent',channel:'telegram',fixtureId,metadata:{correct:Boolean(message.correct)}});
      } else {
        failed++;
        const forbidden=Number(result.status)===403 || Number(result.errorCode)===403;
        if (forbidden) {
          await setCache(postMatchReturnDisabledKey(userId),fixtureId,{reason:'telegram_forbidden',at:new Date().toISOString()},cfg,525600);
        } else {
          await releasePostMatchReturnClaim(claim.key,cfg);
        }
      }
    }

    const summary={checked:candidates.length,eligible,sent,failed,deduped,disabled,cooldown,truncated:Boolean(candidatePage.truncated),providerProbes:Number(refresh.probed || 0),newlySettled:Number(refresh.settled || 0)};
    if (sent || failed) await recordOpsEvent(cfg,{severity:failed?'warning':'info',source:'post_match_return',eventType:'post_match_return',code:failed?'RETURN_RUN_WITH_FAILURES':'RETURN_RUN_OK',message:`Post-match return: отправлено ${sent}, ошибок ${failed}.`,endpoint:'cron:post-match-return',meta:summary}).catch(()=>null);
    return summary;
  },{countTelemetry:false});
}

async function sendTelegramMessage(chatId, text, cfg, options = {}) {
  if (!cfg.botToken) {
    return {
      ok:false,
      status:0,
      outcome:'not_started',
      errorCode:0,
      description:'Токен Telegram-бота отсутствует.',
      retryAfter:0,
    };
  }

  try {
    const r = await fetchWithTimeout(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body:JSON.stringify({
        chat_id:Number(chatId),
        text,
        disable_web_page_preview:options.disableWebPagePreview !== false,
        ...(options.parseMode ? { parse_mode:String(options.parseMode) } : {}),
        ...(options.replyMarkup ? { reply_markup:options.replyMarkup } : {}),
      }),
    },7000,'Telegram sendMessage');

    const body = await r.json().catch(() => null);
    const ok = Boolean(r.ok && body?.ok !== false);
    return {
      ok,
      status:Number(r.status || 0),
      outcome:ok ? 'sent' : 'confirmed_failure',
      errorCode:Number(body?.error_code || 0),
      description:redactOpsString(body?.description || (r.ok ? '' : `Telegram HTTP ${r.status}`),220),
      retryAfter:Number(body?.parameters?.retry_after || r.headers.get('retry-after') || 0),
    };
  } catch (error) {
    return {
      ok:false,
      status:0,
      outcome:'unknown',
      errorCode:0,
      description:redactOpsString(error?.message || 'Telegram network error.',220),
      retryAfter:0,
    };
  }
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

const PROVIDER_QUOTA_SHARED_CACHE_KEY = 'provider-state:api-football:quota:v1';
const PROVIDER_COOLDOWN_SHARED_CACHE_KEY = 'provider-state:api-football:cooldown:v1';

function completeProviderQuotaSnapshot(value = {}) {
  return String(value?.plan || 'UNKNOWN') !== 'UNKNOWN'
    && [value?.dailyLimit, value?.dailyRemaining, value?.minuteLimit, value?.minuteRemaining]
      .every(item => Number.isFinite(Number(item)));
}

async function loadSharedProviderState(cfg) {
  if (!hasSupabase(cfg)) return;
  const [quota, cooldown] = await Promise.all([
    getCache(PROVIDER_QUOTA_SHARED_CACHE_KEY, cfg).catch(() => null),
    getCache(PROVIDER_COOLDOWN_SHARED_CACHE_KEY, cfg).catch(() => null),
  ]);

  if (quota && completeProviderQuotaSnapshot(quota)) {
    const sharedAt = Date.parse(quota.updatedAt || '');
    const localAt = Date.parse(memory.provider?.updatedAt || '');
    if (!Number.isFinite(localAt) || (Number.isFinite(sharedAt) && sharedAt >= localAt)) {
      memory.provider = {
        ...memory.provider,
        name: 'API-Football',
        plan: String(quota.plan),
        dailyLimit: Number(quota.dailyLimit),
        dailyRemaining: Number(quota.dailyRemaining),
        minuteLimit: Number(quota.minuteLimit),
        minuteRemaining: Number(quota.minuteRemaining),
        updatedAt: quota.updatedAt || new Date().toISOString(),
      };
    }
  }

  const sharedUntil = Date.parse(cooldown?.cooldownUntil || '');
  const localUntil = Date.parse(memory.provider?.cooldownUntil || '');
  if (Number.isFinite(sharedUntil) && sharedUntil > Date.now() && (!Number.isFinite(localUntil) || sharedUntil > localUntil)) {
    memory.provider.cooldownUntil = cooldown.cooldownUntil;
    memory.provider.lastError = cooldown.reason || memory.provider.lastError || 'rate_limit';
  }
}

async function persistSharedProviderQuota(cfg) {
  const p = memory.provider || {};
  if (!completeProviderQuotaSnapshot(p)) return;
  await setCache(PROVIDER_QUOTA_SHARED_CACHE_KEY, 0, {
    provider: 'api-football',
    plan: String(p.plan),
    dailyLimit: Number(p.dailyLimit),
    dailyRemaining: Number(p.dailyRemaining),
    minuteLimit: Number(p.minuteLimit),
    minuteRemaining: Number(p.minuteRemaining),
    updatedAt: p.updatedAt || new Date().toISOString(),
  }, cfg, 30);
}

async function persistSharedProviderCooldown(cfg, retryAfter, reason = 'rate_limit') {
  phase5ProviderUsage(cfg,'sharedCooldowns',1);
  const seconds = Math.max(1, Number(retryAfter || 60));
  const cooldownUntil = new Date(Date.now() + seconds * 1000).toISOString();
  memory.provider.cooldownUntil = cooldownUntil;
  memory.provider.lastError = reason || 'rate_limit';
  await setCache(PROVIDER_COOLDOWN_SHARED_CACHE_KEY, 0, {
    provider: 'api-football',
    cooldownUntil,
    reason: String(reason || 'rate_limit').slice(0, 80),
    updatedAt: new Date().toISOString(),
  }, cfg, Math.max(1 / 6, seconds / 60));
}

function providerQuotaEvidence(cfg) {
  const p=memory.provider || {};
  const raw=[p.dailyLimit,p.dailyRemaining,p.minuteLimit,p.minuteRemaining];
  if (raw.some(value=>value===null || value===undefined || value==='')) return;
  const values=raw.map(Number);
  if (String(p.plan || 'UNKNOWN')==='UNKNOWN' || !values.every(Number.isFinite)) return;
  const now=Date.now();
  if (now-Number(memory.providerQuotaEvidenceAt || 0)<10*60_000) return;
  memory.providerQuotaEvidenceAt=now;
  void recordOpsEvent(cfg,{
    severity:'info',
    source:'provider',
    eventType:'quota_probe',
    code:'PROVIDER_QUOTA_CONFIRMED',
    message:'API-Football quota confirmed from real provider response headers.',
    endpoint:'api-football',
    meta:{
      plan:String(p.plan),
      dailyLimit:Number(p.dailyLimit),
      dailyRemaining:Number(p.dailyRemaining),
      minuteLimit:Number(p.minuteLimit),
      minuteRemaining:Number(p.minuteRemaining),
      evidenceSource:'response_headers',
    },
  }).catch(()=>{ memory.providerQuotaEvidenceAt=0; });
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
  // FREE/UNKNOWN stays intentionally slower so one LIVE user cannot consume
  // most of the provider minute allowance by polling fixture + core features.
  return 90;
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
      ? 'Повышенная квота обнаружена по заголовкам лимитов. Расширенные запросы разрешены защитными правилами приложения.'
      : 'Полная проверка методов API заблокирована на бесплатном тарифе, чтобы не тратить заметную часть дневного лимита.',
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
  const observedDailyLimit = Number.isFinite(Number(p.dailyLimit)) ? Number(p.dailyLimit) : null;
  const observedMinuteLimit = Number.isFinite(Number(p.minuteLimit)) ? Number(p.minuteLimit) : null;

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

  const proBaseline = PROVIDER_PLAN_LIMITS.PRO;
  const broadTrafficReady = Boolean(
    paid
    && observedDailyLimit !== null
    && observedMinuteLimit !== null
    && observedDailyLimit >= Number(proBaseline.daily || 0)
    && observedMinuteLimit >= Number(proBaseline.minute || 0)
    && mode !== 'emergency'
  );
  const launchCapacity = {
    broadTrafficReady,
    recommendedMode: broadTrafficReady ? 'public' : 'limited_beta',
    blocker: broadTrafficReady
      ? ''
      : plan === 'FREE'
        ? 'provider_free_plan'
        : plan === 'UNKNOWN'
          ? 'provider_quota_unconfirmed'
          : 'provider_capacity_guard',
    observedDailyLimit,
    observedMinuteLimit,
    protectedDailyReserve: Number(floors.dailyReserve || 0),
    usableDailyRemaining: dailyRemaining === null ? null : Math.max(0, dailyRemaining - Number(floors.dailyReserve || 0)),
  };

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
    launchCapacity,
    counters: {
      api: Number(memory.providerFeatureFetch?.api || 0),
      cache: Number(memory.providerFeatureFetch?.cache || 0),
      stale: Number(memory.providerFeatureFetch?.stale || 0),
      skipped: Number(memory.providerFeatureFetch?.skipped || 0),
      fixtureDateReuses: Number(memory.telemetry?.providerFixtureDateReuses || 0),
      teamFixtureReuses: Number(memory.telemetry?.providerTeamFixtureReuses || 0),
      byFeature: memory.providerFeatureFetch?.byFeature || {},
      lastUpdatedAt: memory.providerFeatureFetch?.lastUpdatedAt || null,
    },
    note: mode === 'emergency'
      ? 'Защитный резерв активен: новые запросы ограничиваются, а приложение переходит на сохранённые данные.'
      : mode === 'conserve'
        ? 'Часть дополнительных запросов замедлена или пропускается, чтобы сохранить резерв.'
        : broadTrafficReady
          ? 'Квота подходит для публичного трафика по текущему техническому порогу; кэш и защитные лимиты остаются активны.'
          : plan === 'FREE'
            ? 'FREE-квота подходит только для ограниченной beta. Широкое продвижение не запускайте до повышения лимита.'
            : 'Ёмкость источника ещё не подтверждена для широкого публичного трафика.',
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

  // Core LIVE data remains available on FREE, but its shared cache outlives
  // one UI poll so multiple beta users reuse the same events/statistics snapshot.
  if (!paid && mode === 'live' && ['events','statistics'].includes(feature)) {
    ttlSeconds = Math.max(ttlSeconds, 180);
  }

  // On the 10 req/min FREE plan, the interactive Match Center must not consume
  // the request that AI Analysis needs for predictions/odds. Events can fall back
  // to OpenLigaDB; API-Football statistics remain the primary LIVE enrichment.
  if (!paid && context.preserveAiBudget === true && feature === 'events') {
    allowed = false;
    reason = 'interactive_ai_reserve';
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


const {
  footballError,
  isFootballRateLimitError,
  footballCooldownRemaining,
  freeQuotaHealthy,
  distributedProviderMinuteLimit,
  claimDistributedProviderBudget,
  apiFootballNetwork,
  providerRequestKey,
  isRetryableFootballTransportError,
  apiFootball,
} = createApiFootballGateway({
  memory,
  providerPlanLimits: PROVIDER_PLAN_LIMITS,
  providerBudgetFloors: PROVIDER_BUDGET_FLOORS,
  hasSupabase,
  supaRpc,
  bumpTelemetry,
  observeProviderRequest,
  recordOpsEvent,
  loadSharedProviderState,
  phase5ProviderUsage,
  persistSharedProviderCooldown,
  fetchWithTimeout,
  updateProviderFromHeaders,
  persistSharedProviderQuota,
  providerQuotaEvidence,
  providerSnapshot,
  withSingleFlight,
  sleepMs,
});

const {
  providerFailureState,
  providerDataState,
  providerDataReliabilitySummary,
  providerDataReliabilitySelfTest,
  analysisProviderFetch,
  providerFeatureFetch,
  providerValidationStep,
  providerValidationStatus,
  providerFeatureSourcesSummary,
  responseJsonSafe,
  loadLastProviderE2E,
  saveProviderE2E,
  providerEndpointLabel,
  providerAuditEndpointPlan,
  providerAuditCall,
  providerAuditScore,
} = createProviderDataRuntime({
  apiFootball,
  featureCacheAgeSeconds,
  getCache,
  getCacheEntry,
  isFinishedStatus,
  isFootballRateLimitError,
  isLiveStatus,
  memory,
  providerFeatureCounter,
  providerFeaturePolicy,
  redactOpsString,
  setCache,
});

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

function combineSupabaseProbeAttempts(first = {}, second = null) {
  const firstOk=Boolean(first?.ok);
  if (firstOk) {
    return {
      ...first,
      attempts:1,
      recovered:false,
      confirmedFailure:false,
      initialStatus:first?.status || 'ok',
      initialLatencyMs:Number(first?.latencyMs || 0) || null,
    };
  }

  if (second && second.ok) {
    return {
      ...second,
      attempts:2,
      recovered:true,
      confirmedFailure:false,
      initialStatus:first?.status || 'unknown',
      initialLatencyMs:Number(first?.latencyMs || 0) || null,
    };
  }

  const final=second || first;
  return {
    ...final,
    attempts:second ? 2 : 1,
    recovered:false,
    confirmedFailure:true,
    initialStatus:first?.status || 'unknown',
    initialLatencyMs:Number(first?.latencyMs || 0) || null,
  };
}

async function probeSupabaseConfirmed(cfg, options = {}) {
  const first=await probeSupabase(cfg);
  if (first.ok || !first.configured) return combineSupabaseProbeAttempts(first);
  const retryDelayMs=Math.max(0,Math.min(1500,Number(options.retryDelayMs ?? 250)));
  if (retryDelayMs) await sleepMs(retryDelayMs);
  const second=await probeSupabase(cfg);
  const combined=combineSupabaseProbeAttempts(first,second);
  if (combined.recovered) bumpTelemetry('supabaseProbeRecoveries');
  if (combined.confirmedFailure) bumpTelemetry('supabaseProbeConfirmedFailures');
  return combined;
}

async function probeSupabaseReadiness(cfg) {
  if (!hasSupabase(cfg)) return { configured:false, ok:false, status:'not_configured', latencyMs:null };
  const startedAt=Date.now();
  try {
    const url=new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
    url.searchParams.set('select','cache_key');
    url.searchParams.set('limit','1');
    const response=await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase readiness');
    const latencyMs=Date.now()-startedAt;
    if (!response.ok) {
      bumpTelemetry('supabaseErrors');
      const detail=await response.text().catch(()=>'');
      return {configured:true,ok:false,status:`http_${response.status}`,latencyMs,detail:redactOpsString(detail,180)};
    }
    return {configured:true,ok:true,status:'ok',latencyMs};
  } catch (error) {
    bumpTelemetry('supabaseErrors');
    return {configured:true,ok:false,status:'network_error',latencyMs:Date.now()-startedAt,detail:redactOpsString(error?.message || error,180)};
  }
}

async function probeSupabaseReadinessConfirmed(cfg, options = {}) {
  const first=await probeSupabaseReadiness(cfg);
  if (first.ok || !first.configured) return combineSupabaseProbeAttempts(first);
  const retryDelayMs=Math.max(0,Math.min(1500,Number(options.retryDelayMs ?? 250)));
  if (retryDelayMs) await sleepMs(retryDelayMs);
  const second=await probeSupabaseReadiness(cfg);
  const combined=combineSupabaseProbeAttempts(first,second);
  if (combined.recovered) bumpTelemetry('supabaseProbeRecoveries');
  if (combined.confirmedFailure) bumpTelemetry('supabaseProbeConfirmedFailures');
  return combined;
}

const { readCompositeReadiness } = createCompositeReadinessRuntime({
  hasSupabase,
  supaRpc,
  probeConnectivity: cfg => probeSupabaseReadinessConfirmed(cfg),
  expectedFingerprint: EXPECTED_SCHEMA_FINGERPRINT,
  expectedFingerprints: COMPATIBLE_SCHEMA_FINGERPRINTS,
  expectedContractVersion: EXPECTED_SCHEMA_CONTRACT_VERSION,
  readinessRpc: 'backend_readiness_contract_v2',
});

function supabaseProbeConfirmationSelfTest() {
  const direct=combineSupabaseProbeAttempts({configured:true,ok:true,status:'ok',latencyMs:40});
  const recovered=combineSupabaseProbeAttempts(
    {configured:true,ok:false,status:'network_error',latencyMs:7000},
    {configured:true,ok:true,status:'ok',latencyMs:52}
  );
  const confirmed=combineSupabaseProbeAttempts(
    {configured:true,ok:false,status:'network_error',latencyMs:7000},
    {configured:true,ok:false,status:'http_503',latencyMs:120}
  );
  return {
    pass:direct.ok && direct.attempts===1
      && recovered.ok && recovered.attempts===2 && recovered.recovered && !recovered.confirmedFailure
      && !confirmed.ok && confirmed.attempts===2 && confirmed.confirmedFailure,
    direct:direct.ok,
    recovered:recovered.recovered,
    confirmedFailure:confirmed.confirmedFailure,
  };
}

const {
  readRecentOpsEvents,
  collectDiagnostics,
} = createDiagnosticsRuntime({
  memory,
  appVersion:APP_VERSION,
  supabaseSchemaGuidance:SUPABASE_SCHEMA_GUIDANCE,
  hasSupabase,
  fetchWithTimeout,
  supaHeaders,
  probeSupabaseConfirmed,
  readIntegrityDiagnostics,
  readTelegramDedupeHealth,
  providerSloReport,
  providerSnapshot,
  footballCooldownRemaining,
  telemetrySnapshot,
});

const CLIENT_TELEMETRY_EVENTS = new Set([
  'boot_ok',
  'boot_recovery',
  'compatibility_block',
  'network_recovery',
  'client_error',
  'product_action',
  'action_error',
  'operation_timing',
  'data_coverage',
]);

const CLIENT_PRODUCT_ACTIONS = new Set([
  'matches_open',
  'search_used',
  'search_found',
  'search_empty',
  'match_open',
  'live_open',
  'ai_start',
  'ai_complete',
  'history_open',
  'history_item_open',
  'profile_open',
]);

const CLIENT_ACTION_ERROR_REASONS = new Set([
  'matches',
  'search',
  'match',
  'live_refresh',
  'ai',
  'history',
  'profile',
]);

const CLIENT_ACTION_ERROR_KINDS = new Set([
  'offline',
  'maintenance',
  'feature_disabled',
  'auth',
  'timeout',
  'rate_limit',
  'integrity',
  'database',
  'provider',
  'service',
  'unknown',
]);

const CLIENT_TIMING_OPERATIONS = new Set(['search', 'match', 'ai', 'live']);
const CLOSED_BETA_COHORT = 'closed_beta_v1';

async function closedBetaTelemetrySubject(user, cfg = {}) {
  if (!isClosedBetaUser(user, cfg) || !cfg.botToken) return '';
  try {
    const digest=await hmacSha256(enc.encode(cfg.botToken),`${CLOSED_BETA_COHORT}:${Number(user.id)}`);
    return bytesToHex(digest).slice(0,32);
  } catch {
    return '';
  }
}


const PHASE5_VALIDATION_COHORT = 'phase5_public_v2';
const PHASE5_SESSION_HEADER = 'x-phase5-session';
const PHASE5_PROVIDER_KINDS = new Set(['search','matches_feed','match_center','ai','live_refresh']);

function phase5ValidationRequestKind(url) {
  const path=String(url?.pathname || '');
  if (path==='/api/search') return 'search';
  if (path==='/api/matches') return 'matches_feed';
  if (path==='/api/match-center') return url?.searchParams?.has('t') ? 'live_refresh' : 'match_center';
  if (path==='/api/analyze') return 'ai';
  return '';
}

async function phase5ValidationContext(request,user,cfg,url) {
  if (!isTelegramValidatedUser(user) || isAdminUser(user,cfg) || !cfg.botToken) return null;
  const rawSession=String(request?.headers?.get(PHASE5_SESSION_HEADER) || '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(rawSession)) return null;
  try {
    const subjectDigest=await hmacSha256(enc.encode(cfg.botToken),`${PHASE5_VALIDATION_COHORT}:user:${Number(user.id)}`);
    const sessionDigest=await hmacSha256(enc.encode(cfg.botToken),`${PHASE5_VALIDATION_COHORT}:session:${Number(user.id)}:${rawSession}`);
    return {
      cohort:PHASE5_VALIDATION_COHORT,
      verified:true,
      subject:bytesToHex(subjectDigest).slice(0,32),
      session:bytesToHex(sessionDigest).slice(0,32),
      requestKind:phase5ValidationRequestKind(url),
    };
  } catch {
    return null;
  }
}

function phase5ProviderUsage(cfg,key,amount=1) {
  const context=cfg?.phase5Validation;
  if (!context?.verified || !PHASE5_PROVIDER_KINDS.has(String(context.requestKind || ''))) return;
  const usage=cfg.phase5ProviderUsage ||= {networkRequests:0,cacheHits:0,staleCacheHits:0,quotaBlocks:0,sharedCooldowns:0};
  usage[key]=Number(usage[key] || 0)+Math.max(0,Number(amount || 0));
}

function phase5ProviderCacheUsage(cfg,cacheKey,key) {
  const name=String(cacheKey || '');
  if (!name || /(quota|cooldown|compute-lock|runtime|webhook|attribution)/i.test(name)) return;
  phase5ProviderUsage(cfg,key,1);
}

async function recordPhase5ProviderRequestSummary(cfg) {
  const context=cfg?.phase5Validation;
  if (!context?.verified || !PHASE5_PROVIDER_KINDS.has(String(context.requestKind || ''))) return;
  const usage=cfg.phase5ProviderUsage || {};
  await recordOpsEvent(cfg,{
    severity:'info',
    source:'phase5',
    eventType:'provider_usage',
    code:'PHASE5_PROVIDER_USAGE',
    message:'Aggregated provider usage for one verified normal-user request.',
    endpoint:String(context.requestKind || ''),
    meta:{
      validationCohort:PHASE5_VALIDATION_COHORT,
      validationVerified:true,
      validationSubject:String(context.subject || ''),
      validationSession:String(context.session || ''),
      requestKind:String(context.requestKind || ''),
      networkRequests:Number(usage.networkRequests || 0),
      cacheHits:Number(usage.cacheHits || 0),
      staleCacheHits:Number(usage.staleCacheHits || 0),
      quotaBlocks:Number(usage.quotaBlocks || 0),
      sharedCooldowns:Number(usage.sharedCooldowns || 0),
    },
  });
}

const CLIENT_TELEMETRY_VIEWS = new Set([
  'matchesView',
  'myTeamsView',
  'searchView',
  'tournamentView',
  'teamView',
  'analysisView',
  'historyView',
  'profileView',
  'unknown',
]);

function clientTelemetryMetadata(body = {}, event = '') {
  const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};
  const rawReason = String(meta.reason || '').trim().toLowerCase();
  const rawErrorKind = String(meta.errorKind || '').trim().toLowerCase();
  const rawView = String(meta.view || '').trim();
  const rawDurationMs = Number(meta.durationMs);
  const reason = event === 'product_action'
    ? (CLIENT_PRODUCT_ACTIONS.has(rawReason) ? rawReason : '')
    : event === 'action_error'
      ? (CLIENT_ACTION_ERROR_REASONS.has(rawReason) ? rawReason : '')
      : event === 'operation_timing'
        ? (CLIENT_TIMING_OPERATIONS.has(rawReason) ? rawReason : '')
        : redactOpsString(rawReason, 80);
  const errorKind = event === 'action_error'
    ? (CLIENT_ACTION_ERROR_KINDS.has(rawErrorKind) ? rawErrorKind : 'unknown')
    : redactOpsString(rawErrorKind, 60);
  const out = {
    clientVersion: redactOpsString(meta.clientVersion || '', 40),
    apiContract: Number.isFinite(Number(meta.apiContract)) ? Number(meta.apiContract) : null,
    releaseChannel: redactOpsString(meta.releaseChannel || '', 30),
    view: CLIENT_TELEMETRY_VIEWS.has(rawView) ? rawView : 'unknown',
    networkMode: redactOpsString(meta.networkMode || '', 30),
    bootMs: Number.isFinite(Number(meta.bootMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.bootMs)))) : null,
    durationMs: event === 'operation_timing' && Number.isFinite(rawDurationMs) ? Math.max(0, Math.min(120000, Math.round(rawDurationMs))) : null,
    moduleReadyMs: event === 'boot_ok' && Number.isFinite(Number(meta.moduleReadyMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.moduleReadyMs)))) : null,
    navigationReadyMs: event === 'boot_ok' && Number.isFinite(Number(meta.navigationReadyMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.navigationReadyMs)))) : null,
    responseEndMs: event === 'boot_ok' && Number.isFinite(Number(meta.responseEndMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.responseEndMs)))) : null,
    domContentLoadedMs: event === 'boot_ok' && Number.isFinite(Number(meta.domContentLoadedMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.domContentLoadedMs)))) : null,
    firstContentfulPaintMs: event === 'boot_ok' && Number.isFinite(Number(meta.firstContentfulPaintMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.firstContentfulPaintMs)))) : null,
    manifestMs: event === 'boot_ok' && Number.isFinite(Number(meta.manifestMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.manifestMs)))) : null,
    identityMs: event === 'boot_ok' && Number.isFinite(Number(meta.identityMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.identityMs)))) : null,
    feedMs: event === 'boot_ok' && Number.isFinite(Number(meta.feedMs)) ? Math.max(0, Math.min(60000, Math.round(Number(meta.feedMs)))) : null,
    revealDelayMs: event === 'boot_ok' && Number.isFinite(Number(meta.revealDelayMs)) ? Math.max(0, Math.min(5000, Math.round(Number(meta.revealDelayMs)))) : null,
    viewportWidth: event === 'boot_ok' && Number.isFinite(Number(meta.viewportWidth)) ? Math.max(200, Math.min(2400, Math.round(Number(meta.viewportWidth)))) : null,
    matchMode: event === 'data_coverage' && ['upcoming','live','finished'].includes(String(meta.matchMode || '').toLowerCase())
      ? String(meta.matchMode || '').toLowerCase()
      : null,
    lineupsAvailable: event === 'data_coverage' && typeof meta.lineupsAvailable === 'boolean' ? meta.lineupsAvailable : null,
    injuriesAvailable: event === 'data_coverage' && typeof meta.injuriesAvailable === 'boolean' ? meta.injuriesAvailable : null,
    statisticsAvailable: event === 'data_coverage' && typeof meta.statisticsAvailable === 'boolean' ? meta.statisticsAvailable : null,
    xgAvailable: event === 'data_coverage' && typeof meta.xgAvailable === 'boolean' ? meta.xgAvailable : null,
    oddsAvailable: event === 'data_coverage' && typeof meta.oddsAvailable === 'boolean' ? meta.oddsAvailable : null,
    manifestOk: typeof meta.manifestOk === 'boolean' ? meta.manifestOk : null,
    degraded: typeof meta.degraded === 'boolean' ? meta.degraded : null,
    blocking: typeof meta.blocking === 'boolean' ? meta.blocking : null,
    reason,
    errorKind,
    startParam: String(meta.startParam || '').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64),
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

  const meta = clientTelemetryMetadata(body, event);
  if (event === 'product_action' && !meta.reason) return json({ ok: false, error: 'Unsupported product action.' }, 400);
  if (event === 'action_error' && !meta.reason) return json({ ok: false, error: 'Unsupported action error.' }, 400);
  if (event === 'operation_timing' && (!meta.reason || !Number.isFinite(Number(meta.durationMs)))) {
    return json({ ok: false, error: 'Unsupported operation timing.' }, 400);
  }
  if (event === 'data_coverage' && (
    !meta.matchMode
    || ['lineupsAvailable','injuriesAvailable','statisticsAvailable','xgAvailable','oddsAvailable']
      .some(key=>typeof meta[key] !== 'boolean')
  )) {
    return json({ ok: false, error: 'Unsupported data coverage telemetry.' }, 400);
  }
  const shouldDedupe = event !== 'operation_timing';
  if (shouldDedupe) {
    const dedupePart = event === 'data_coverage'
      ? `${meta.matchMode}:${Number(meta.lineupsAvailable)}${Number(meta.injuriesAvailable)}${Number(meta.statisticsAvailable)}${Number(meta.xgAvailable)}${Number(meta.oddsAvailable)}`
      : (meta.reason || meta.errorKind || meta.view || '');
    const validationSession=String(cfg?.phase5Validation?.session || '');
    const dedupeKey = `${Number(user.id)}:${event}:${meta.clientVersion || ''}:${validationSession}:${dedupePart}`;
    const last = Number(memory.clientTelemetryDedupe.get(dedupeKey) || 0);
    if (last && Date.now() - last < 5 * 60 * 1000) {
      return json({ ok: true, deduped: true });
    }
    memory.clientTelemetryDedupe.set(dedupeKey, Date.now());
    if (memory.clientTelemetryDedupe.size > 1500) pruneMemoryState();
  }

  const validation=cfg?.phase5Validation;
  const phase5Meta=validation?.verified
    ? {
        validationCohort:PHASE5_VALIDATION_COHORT,
        validationVerified:true,
        validationSubject:String(validation.subject || ''),
        validationSession:String(validation.session || ''),
      }
    : {};
  const betaParticipant=isClosedBetaUser(user, cfg);
  const betaSubject=betaParticipant ? await closedBetaTelemetrySubject(user,cfg) : '';
  const betaMeta=betaParticipant && betaSubject
    ? { betaCohort:CLOSED_BETA_COHORT,betaMembershipVerified:true,betaSubject }
    : {};
  // Closed-beta client telemetry is kept out of growth_events because that legacy
  // table requires a raw Telegram ID. The privacy-safe beta view is sourced from
  // ops_events with an HMAC-derived subject that is never returned by the API.
  if (!betaParticipant && event === 'boot_ok') {
    const attribution=await ensureLaunchAttribution(user.id,meta.startParam || '',cfg);
    void recordGrowthEvent(cfg,{userId:user.id,eventName:'miniapp_open',channel:'miniapp',attribution,metadata:{view:meta.view || '',clientVersion:meta.clientVersion || '',releaseChannel:meta.releaseChannel || ''}});
  }
  if (!betaParticipant && event === 'product_action') {
    void recordGrowthEvent(cfg,{
      userId:user.id,
      eventName:`miniapp_${meta.reason}`,
      channel:'miniapp',
      metadata:{view:meta.view || 'unknown',clientVersion:meta.clientVersion || '',releaseChannel:meta.releaseChannel || ''},
    });
  }
  if (!betaParticipant && event === 'action_error') {
    void recordGrowthEvent(cfg,{
      userId:user.id,
      eventName:'miniapp_error',
      channel:'miniapp',
      metadata:{action:meta.reason,errorKind:meta.errorKind || 'unknown',view:meta.view || 'unknown',clientVersion:meta.clientVersion || '',releaseChannel:meta.releaseChannel || ''},
    });
  }
  const severity = ['compatibility_block', 'client_error'].includes(event)
    || (event === 'action_error' && !['offline','rate_limit'].includes(meta.errorKind))
    ? 'warning'
    : 'info';
  await recordOpsEvent(cfg, {
    severity,
    source: 'client',
    eventType: 'client_telemetry',
    code: event.toUpperCase(),
    message: `Client event: ${event}`,
    endpoint: '/api/client-telemetry',
    durationMs: event === 'operation_timing' ? meta.durationMs : null,
    meta:{...meta,...phase5Meta,...betaMeta},
  });
  return json({ ok: true, deduped: false });
}


const BETA_FEEDBACK_CATEGORIES = new Set(['search','matches','ai','live','ux','data_sources','performance']);
const BETA_FEEDBACK_SEVERITIES = new Set(['BLOCKER','MAJOR','MINOR']);

function betaPercentileMs(values = [], percentile = 0.5) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * Math.max(0, Math.min(1, Number(percentile || 0)));
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return Math.round(sorted[lower]);
  const value = sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
  return Math.round(value);
}

function betaIssueMeta(category = '') {
  const map = {
    search: {
      label:'Поиск',
      impact:'Пользователь не находит нужный матч или не может продолжить основной путь.',
      fix:'Проверить воспроизводимость поиска, ответ источника и состояние пустой выдачи; исправлять только подтверждённую причину.',
    },
    matches: {
      label:'Матчи',
      impact:'Карточка или центр матча открывается нестабильно либо не открывается.',
      fix:'Сопоставить ошибки открытия с логами match-center, доступностью данных и повторным воспроизведением.',
    },
    ai: {
      label:'AI',
      impact:'AI-анализ не запускается либо не завершается после явного действия пользователя.',
      fix:'Сверить ai_start/ai_complete, категорию ошибки и серверные события; не менять модель ради улучшения процента.',
    },
    live: {
      label:'LIVE',
      impact:'LIVE-экран или его обновление работает нестабильно.',
      fix:'Проверить refresh-путь, timeout/rate-limit и доступность live-данных; сохранить fail-soft поведение.',
    },
    ux: {
      label:'UX',
      impact:'Интерфейс непонятен или мешает пройти основной сценарий без технического сбоя.',
      fix:'Подтвердить повторяемость жалобы и путь пользователя; менять интерфейс после нескольких согласованных сигналов.',
    },
    data_sources: {
      label:'Источники данных',
      impact:'Нужные футбольные данные отсутствуют или источник ограничивает запросы.',
      fix:'Сопоставить provider/rate-limit с частотой отсутствующих данных; платный или новый provider рассматривать только при устойчивом подтверждённом дефиците.',
    },
    performance: {
      label:'Производительность',
      impact:'Основные операции отвечают слишком долго или завершаются timeout.',
      fix:'Сопоставить P50/P90 с timeout-событиями и серверной диагностикой; оптимизировать подтверждённое узкое место.',
    },
  };
  return map[category] || map.ux;
}

async function apiBetaFeedback(request, cfg, user) {
  if (request.method !== 'POST') return json({error:'Метод не поддерживается.'},405);
  if (!isClosedBetaUser(user,cfg)) {
    return json({error:'Обратная связь закрытой beta доступна только приглашённым тестировщикам.',code:'BETA_MEMBERSHIP_REQUIRED'},403);
  }
  let body={};
  try { body=await request.json(); } catch {}
  const category=String(body?.category || '').trim().toLowerCase();
  const betaSeverity=String(body?.severity || '').trim().toUpperCase();
  const note=redactOpsString(String(body?.note || '').trim(),600);
  if (!BETA_FEEDBACK_CATEGORIES.has(category)) return json({error:'Выберите раздел проблемы.'},400);
  if (!BETA_FEEDBACK_SEVERITIES.has(betaSeverity)) return json({error:'Выберите важность проблемы.'},400);
  if (note.length < 5) return json({error:'Кратко опишите, что произошло.'},400);
  const severity=betaSeverity==='BLOCKER' ? 'critical' : betaSeverity==='MAJOR' ? 'warning' : 'info';
  await recordOpsEvent(cfg,{
    severity,
    source:'beta',
    eventType:'beta_feedback',
    code:'BETA_FEEDBACK',
    message:`Beta feedback: ${note}`,
    endpoint:'/api/beta-feedback',
    meta:{category,betaSeverity,explicitUserFeedback:true,betaCohort:CLOSED_BETA_COHORT,betaMembershipVerified:true},
  });
  return json({ok:true});
}

function betaClientEventRows(rows = [], eventName = '') {
  const target=String(eventName || '');
  return (rows || []).filter(row=>{
    if (row?.source!=='client' || row?.event_type!=='client_telemetry') return false;
    const code=String(row?.code || '');
    if (target==='miniapp_open') return code==='BOOT_OK';
    if (target==='miniapp_error') return code==='ACTION_ERROR';
    if (!target.startsWith('miniapp_')) return false;
    return code==='PRODUCT_ACTION' && String(row?.metadata?.reason || '')===target.slice('miniapp_'.length);
  });
}

function betaMetricSummary(rows = [], eventName = '') {
  const matched=betaClientEventRows(rows,eventName);
  const users=new Set(matched
    .map(row=>String(row?.metadata?.betaSubject || ''))
    .filter(subject=>/^[0-9a-f]{32}$/.test(subject)));
  return {events:matched.length,users:users.size};
}

function betaTimingSummary(opsRows = [], operation = '') {
  const values=(opsRows || [])
    .filter(row=>row?.source==='client' && row?.event_type==='client_telemetry' && row?.code==='OPERATION_TIMING'
      && String(row?.metadata?.reason || '')===operation)
    .map(row=>Number(row?.duration_ms))
    .filter(value=>Number.isFinite(value) && value>=0 && value<=120000);
  return {
    samples:values.length,
    medianMs:values.length>=3 ? betaPercentileMs(values,0.5) : null,
    p90Ms:values.length>=10 ? betaPercentileMs(values,0.9) : null,
    percentileRule:'median>=3 samples; p90>=10 samples',
  };
}

function betaFeedbackCounts(feedbackRows = [], category = '') {
  const rows=feedbackRows.filter(row=>String(row?.metadata?.category || '')===category);
  const severity={BLOCKER:0,MAJOR:0,MINOR:0};
  for (const row of rows) {
    const key=String(row?.metadata?.betaSeverity || '').toUpperCase();
    if (key in severity) severity[key]+=1;
  }
  return {total:rows.length,severity};
}

function betaErrorCountByAction(errorRows = [], action = '') {
  return errorRows.filter(row=>String(row?.metadata?.action || row?.metadata?.reason || '')===action).length;
}

function betaErrorCountByKind(errorRows = [], kinds = []) {
  const allowed=new Set(kinds);
  return errorRows.filter(row=>allowed.has(String(row?.metadata?.errorKind || ''))).length;
}

function betaCoverageSummary(rows = []) {
  const coverageRows=(rows || []).filter(row=>row?.source==='client' && row?.event_type==='client_telemetry' && row?.code==='DATA_COVERAGE');
  const keys=['lineups','injuries','statistics','xg','odds'];
  const summarizeMissing=(sampleRows=[])=>{
    const missing={};
    for (const key of keys) {
      const field=`${key}Available`;
      const observed=(sampleRows || []).filter(row=>typeof row?.metadata?.[field] === 'boolean');
      const missingCount=observed.filter(row=>row.metadata[field]===false).length;
      missing[key]={
        samples:observed.length,
        missing:missingCount,
        missingPct:observed.length ? Math.round((missingCount/observed.length)*1000)/10 : 0,
      };
    }
    return missing;
  };
  const byMode={};
  for (const row of coverageRows) {
    const mode=String(row?.metadata?.matchMode || 'unknown');
    byMode[mode]=Number(byMode[mode] || 0)+1;
  }
  const liveRows=coverageRows.filter(row=>String(row?.metadata?.matchMode || '')==='live');
  return {
    samples:coverageRows.length,
    missing:summarizeMissing(coverageRows),
    byMode,
    live:{
      samples:liveRows.length,
      missing:summarizeMissing(liveRows),
    },
  };
}

function betaExpansionDecision({
  launchBlockers=[],
  metrics={},
  journey={},
  timings={},
  coverage={},
  issues=[],
  opsSampleLimited=false,
  providerEvidence='insufficient_evidence',
} = {}) {
  const betaUsers=Number(journey.betaUsers || 0);
  const sessionStarts=Number(metrics.miniAppLaunch?.events || 0);
  const fullJourneys=Number(journey.fullCompleted || 0);
  const blockerCount=(issues || []).filter(issue=>issue?.classification==='BLOCKER').length;
  const majorCount=(issues || []).filter(issue=>issue?.classification==='MAJOR').length;
  const needsMoreEvidence=(issues || []).filter(issue=>issue?.classification==='NEEDS_MORE_EVIDENCE').length;
  const coreTimingSamples={
    search:Number(timings?.search?.samples || 0),
    match:Number(timings?.match?.samples || 0),
    ai:Number(timings?.ai?.samples || 0),
  };
  const requirements={
    verifiedUsers:{required:2,actual:betaUsers,pass:betaUsers>=2},
    verifiedSessionStarts:{required:7,actual:sessionStarts,pass:sessionStarts>=7},
    fullJourneys:{required:2,actual:fullJourneys,pass:fullJourneys>=2},
    searchTimingSamples:{required:3,actual:coreTimingSamples.search,pass:coreTimingSamples.search>=3},
    matchTimingSamples:{required:3,actual:coreTimingSamples.match,pass:coreTimingSamples.match>=3},
    aiTimingSamples:{required:3,actual:coreTimingSamples.ai,pass:coreTimingSamples.ai>=3},
    coverageSamples:{required:10,actual:Number(coverage?.samples || 0),pass:Number(coverage?.samples || 0)>=10},
  };
  const evidenceComplete=Object.values(requirements).every(item=>item.pass);
  const hardBlockers=[
    ...(launchBlockers || []),
    ...(opsSampleLimited ? ['beta_ops_sample_truncated'] : []),
    ...(blockerCount>0 ? ['confirmed_blocker'] : []),
    ...(majorCount>0 ? ['confirmed_major'] : []),
  ];
  const dataCoverageDecision=Number(coverage?.samples || 0)<10
    ? 'collect_more_coverage'
    : providerEvidence==='review_provider_options'
      ? 'review_new_or_paid_provider'
      : 'keep_current_provider';
  let status='collecting_verified_beta';
  if (hardBlockers.length) status='hold';
  else if (evidenceComplete && dataCoverageDecision==='review_new_or_paid_provider') status='expand_with_data_limitations';
  else if (evidenceComplete) status='ready_to_expand';
  const expansionAllowed=['ready_to_expand','expand_with_data_limitations'].includes(status);
  return {
    status,
    expansionAllowed,
    closedBetaLaunchStageComplete:expansionAllowed,
    requirements,
    hardBlockers,
    blockerCount,
    majorCount,
    needsMoreEvidence,
    dataCoverageDecision,
    providerEvidence,
    decisionRule:'Expansion requires real verified beta users/sessions, repeated full journeys, core latency evidence, coverage evidence, zero BLOCKER/MAJOR and no launch/runtime blocker.',
    sessionDefinition:'One verified beta session start equals an accepted server-side closed_beta_v1 BOOT_OK event after telemetry dedupe.',
  };
}


function quotaRemainingPct(limit,remaining) {
  const l=Number(limit);
  const r=Number(remaining);
  if (!Number.isFinite(l) || l<=0 || !Number.isFinite(r)) return null;
  return Math.max(0,Math.min(100,Math.round((r/l)*1000)/10));
}

function betaProductionMonitorSummary(rows = [], nowMs = Date.now()) {
  const recent=(rows || [])
    .filter(row=>row?.source==='monitor' && row?.event_type==='production_monitor')
    .filter(row=>{
      const at=Date.parse(row?.created_at || '');
      return Number.isFinite(at) && nowMs-at<=6*60*60_000;
    })
    .sort((a,b)=>Date.parse(b?.created_at || 0)-Date.parse(a?.created_at || 0));
  const latest=recent[0] || null;
  const latestCode=String(latest?.code || '');
  const state=!latest ? 'unknown'
    : latestCode==='PRODUCTION_MONITOR_INCIDENT' ? 'incident'
      : latestCode==='PRODUCTION_MONITOR_WATCH' ? 'watch'
        : ['PRODUCTION_MONITOR_HEALTHY','PRODUCTION_MONITOR_RECOVERED'].includes(latestCode) ? 'healthy'
          : 'unknown';
  return {
    state,
    latestCode,
    lastSeen:latest?.created_at || null,
    samples:recent.length,
    incidentCount:recent.filter(row=>String(row?.code || '')==='PRODUCTION_MONITOR_INCIDENT').length,
    watchCount:recent.filter(row=>String(row?.code || '')==='PRODUCTION_MONITOR_WATCH').length,
  };
}

function controlledBetaExpansionDecision({
  expansionDecision={},
  assignedBetaUsers=0,
  journey={},
  metrics={},
  timings={},
  coverage={},
  issues=[],
  errorRows=[],
  clientErrorRows=[],
  providerQuota={},
  productionMonitor={},
  supabaseOk=false,
  telegramConfirmed=false,
} = {}) {
  const verifiedUsers=Number(journey?.betaUsers || 0);
  const assignedUsers=Number(assignedBetaUsers || 0);
  const fullJourneys=Number(journey?.fullCompleted || 0);
  const blockerCount=(issues || []).filter(issue=>issue?.classification==='BLOCKER').length;
  const majorCount=(issues || []).filter(issue=>issue?.classification==='MAJOR').length;
  const searchTimeouts=(errorRows || []).filter(row=>String(row?.metadata?.action || '')==='search' && String(row?.metadata?.errorKind || '')==='timeout').length;
  const providerRateLimit=(errorRows || []).filter(row=>String(row?.metadata?.errorKind || '')==='rate_limit').length;
  const providerErrors=(errorRows || []).filter(row=>String(row?.metadata?.errorKind || '')==='provider').length;
  const actionErrors=Number((errorRows || []).length || 0);
  const dailyRemainingPct=quotaRemainingPct(providerQuota?.dailyLimit,providerQuota?.dailyRemaining);
  const minuteRemainingPct=quotaRemainingPct(providerQuota?.minuteLimit,providerQuota?.minuteRemaining);
  const quotaPressure=Boolean(providerQuota?.confirmed && (
    (dailyRemainingPct!==null && dailyRemainingPct<=10)
    || (minuteRemainingPct!==null && minuteRemainingPct<=10)
  ));
  const liveMissingCategories=Object.values(coverage?.live?.missing || {})
    .filter(item=>Number(item?.samples || 0)>=5 && Number(item?.missingPct || 0)>=70).length;
  const liveCoverageDeficit=Number(coverage?.live?.samples || 0)>=5 && liveMissingCategories>=2;
  const providerReviewSignal=expansionDecision?.dataCoverageDecision==='review_new_or_paid_provider'
    || providerRateLimit>=3
    || quotaPressure
    || liveCoverageDeficit;

  const wave1Observed=verifiedUsers>=4;
  const wave2Observed=verifiedUsers>=6;
  const coreLatencyEnough=['search','match','ai'].every(key=>Number(timings?.[key]?.samples || 0)>=5);
  const liveLatencyEnough=Number(timings?.live?.samples || 0)>=3;
  const expandedEvidenceEnough=wave2Observed
    && fullJourneys>=4
    && Number(coverage?.samples || 0)>=20
    && coreLatencyEnough
    && liveLatencyEnough;
  const runtimeHealthy=Boolean(
    supabaseOk
    && telegramConfirmed
    && productionMonitor?.state==='healthy'
    && blockerCount===0
    && majorCount===0
    && !quotaPressure
  );

  const providerValidationDecision=!wave1Observed
    ? 'collecting_expanded_beta'
    : providerReviewSignal
      ? 'review_new_or_paid_provider'
      : 'keep_current_provider';

  let finalDecision='BETA HOLD';
  if (expansionDecision?.expansionAllowed) {
    if (blockerCount>0 || majorCount>0 || !supabaseOk || !telegramConfirmed || productionMonitor?.state==='incident') {
      finalDecision='BETA HOLD';
    } else if (wave1Observed && providerValidationDecision==='review_new_or_paid_provider') {
      finalDecision='DATA PROVIDER UPGRADE REQUIRED';
    } else if (expandedEvidenceEnough && runtimeHealthy && providerValidationDecision==='keep_current_provider') {
      finalDecision='BETA READY FOR PUBLIC PRE-LAUNCH';
    } else {
      finalDecision='BETA CONTINUE';
    }
  }

  const nextWaveTarget=!expansionDecision?.expansionAllowed ? null
    : verifiedUsers<4 ? 4
      : verifiedUsers<6 ? 6
        : null;
  const currentAssignmentsObserved=assignedUsers>0 && verifiedUsers>=Math.min(assignedUsers,6);
  const canAddNextWave=Boolean(
    finalDecision==='BETA CONTINUE'
    && nextWaveTarget
    && assignedUsers<nextWaveTarget
    && currentAssignmentsObserved
    && blockerCount===0
    && majorCount===0
    && !quotaPressure
    && providerValidationDecision!=='review_new_or_paid_provider'
  );

  const initialGateGaps=Object.entries(expansionDecision?.requirements || {})
    .filter(([,value])=>!value?.pass)
    .map(([key])=>key);
  const launchBlockers=[...new Set((expansionDecision?.hardBlockers || []).map(String).filter(Boolean))];
  const launchBlockerSet=new Set(launchBlockers);
  const fieldBlockers=[];
  if (assignedUsers<2) fieldBlockers.push('beta_users_not_assigned');
  if (verifiedUsers===0) fieldBlockers.push('verified_beta_telemetry_missing');
  if (!expansionDecision?.expansionAllowed) fieldBlockers.push('initial_expansion_gate_closed');
  for (const code of launchBlockers) if (!fieldBlockers.includes(code)) fieldBlockers.push(code);
  if (blockerCount>0 || majorCount>0) fieldBlockers.push('beta_product_issue');
  if (!supabaseOk || !telegramConfirmed || productionMonitor?.state==='incident') fieldBlockers.push('runtime_unhealthy');
  if (quotaPressure) fieldBlockers.push('provider_quota_pressure');
  if (wave1Observed && providerValidationDecision==='review_new_or_paid_provider') fieldBlockers.push('provider_review_required');

  const nextRequiredAction=assignedUsers<2
    ? 'assign_real_beta_users'
    : launchBlockerSet.has('beta_admin_overlap')
      ? 'remove_beta_admin_overlap'
      : launchBlockerSet.has('strict_beta_access_disabled')
        ? 'enable_strict_beta_access'
        : launchBlockerSet.has('telegram_webhook_unconfirmed')
          ? 'confirm_telegram_webhook'
          : launchBlockerSet.has('provider_quota_unconfirmed')
            ? 'confirm_provider_quota'
            : verifiedUsers<Math.min(assignedUsers,2)
              ? 'collect_verified_beta_usage'
              : !expansionDecision?.expansionAllowed
                ? 'close_initial_expansion_requirements'
                : blockerCount>0 || majorCount>0 || !supabaseOk || !telegramConfirmed || productionMonitor?.state==='incident'
                  ? 'restore_runtime_health'
                  : wave1Observed && providerValidationDecision==='review_new_or_paid_provider'
                    ? 'run_provider_evaluation'
                    : verifiedUsers<4
                      ? 'observe_wave_1'
                      : verifiedUsers<6
                        ? 'observe_wave_2'
                        : !expandedEvidenceEnough
                          ? 'collect_expanded_beta_evidence'
                          : 'none';

  return {
    finalDecision,
    expansionAllowed:Boolean(expansionDecision?.expansionAllowed),
    automaticExpansion:false,
    waveSize:2,
    assignedUsers,
    verifiedUsers,
    waves:{
      baseline:{target:2,observed:verifiedUsers>=2},
      wave1:{target:4,observed:wave1Observed},
      wave2:{target:6,observed:wave2Observed},
    },
    nextWave:nextWaveTarget ? {
      targetAssigned:nextWaveTarget,
      add:Math.max(0,Math.min(2,nextWaveTarget-assignedUsers)),
      allowed:canAddNextWave,
    } : null,
    fieldBlockers,
    launchBlockers,
    initialGateGaps,
    nextRequiredAction,
    evidenceTargets:{
      verifiedUsers:6,
      fullJourneys:4,
      coverageSamples:20,
      coreLatencySamplesPerOperation:5,
      liveLatencySamples:3,
    },
    providerValidationDecision,
    providerReviewSignal,
    providerSignals:{
      rateLimit:providerRateLimit,
      providerErrors,
      quotaPressure,
      dailyRemainingPct,
      minuteRemainingPct,
      liveCoverageDeficit,
      liveMissingCategories,
    },
    checks:{
      miniAppLaunch:Number(metrics?.miniAppLaunch?.events || 0),
      search:{
        used:Number(metrics?.searchUsed?.events || 0),
        success:Number(metrics?.searchFound?.events || 0),
        empty:Number(metrics?.searchEmpty?.events || 0),
        timeout:searchTimeouts,
      },
      matchOpen:Number(metrics?.matchOpen?.events || 0),
      ai:{
        start:Number(metrics?.aiStart?.events || 0),
        complete:Number(metrics?.aiComplete?.events || 0),
      },
      fullJourneys,
      reentries:Number(journey?.stages?.reentry || 0),
      latency:timings,
      actionErrors,
      clientErrors:Number((clientErrorRows || []).length || 0),
      blockerCount,
      majorCount,
      supabaseOk:Boolean(supabaseOk),
      telegramConfirmed:Boolean(telegramConfirmed),
      productionMonitor,
      live:{
        opens:Number(metrics?.liveOpen?.events || 0),
        timingSamples:Number(timings?.live?.samples || 0),
        coverageSamples:Number(coverage?.live?.samples || 0),
      },
    },
    readinessRule:'Two manual expansion waves of +2 users are observed before public pre-launch. Every wave remains fail-closed on BLOCKER/MAJOR, runtime health, provider quota pressure and provider-review evidence.',
  };
}

function buildBetaIssueGroups({metrics,errorRows,feedbackRows,timings,clientErrorRows=[]}) {
  const configs=[
    {category:'search',errors:betaErrorCountByAction(errorRows,'search'),attempts:Number(metrics.searchUsed?.events || 0)},
    {category:'matches',errors:betaErrorCountByAction(errorRows,'match'),attempts:Number(metrics.matchOpen?.events || 0)+betaErrorCountByAction(errorRows,'match')},
    {category:'ai',errors:betaErrorCountByAction(errorRows,'ai'),attempts:Number(metrics.aiStart?.events || 0)},
    {category:'live',errors:betaErrorCountByAction(errorRows,'live_refresh'),attempts:Number(metrics.liveOpen?.events || 0)+betaErrorCountByAction(errorRows,'live_refresh')},
    {category:'ux',errors:betaErrorCountByAction(errorRows,'history')+betaErrorCountByAction(errorRows,'profile')+Number(clientErrorRows.length || 0),attempts:Number(metrics.miniAppLaunch?.events || 0)+Number(metrics.historyOpen?.events || 0)+Number(metrics.profileOpen?.events || 0)},
    {category:'data_sources',errors:betaErrorCountByKind(errorRows,['provider','rate_limit']),attempts:0},
    {category:'performance',errors:betaErrorCountByKind(errorRows,['timeout']),attempts:0},
  ];
  return configs.map(item=>{
    const feedback=betaFeedbackCounts(feedbackRows,item.category);
    const frequency=Number(item.errors || 0)+Number(feedback.total || 0);
    const failureRatePct=item.attempts>0 ? Math.round((Number(item.errors || 0)/Math.max(1,item.attempts))*1000)/10 : null;
    const correlated=Number(item.errors || 0)>0 && Number(feedback.total || 0)>0;
    let classification=null;
    if ((item.attempts>=4 && Number(failureRatePct || 0)>=50) || feedback.severity.BLOCKER>=2) classification='BLOCKER';
    else if (Number(item.errors || 0)>=2 || feedback.severity.MAJOR>=2 || correlated) classification='MAJOR';
    else if (feedback.severity.MINOR>=2) classification='MINOR';
    else if (frequency>0) classification='NEEDS_MORE_EVIDENCE';
    const meta=betaIssueMeta(item.category);
    const timing=timings?.[item.category==='matches'?'match':item.category] || null;
    return {
      category:item.category,
      label:meta.label,
      classification,
      active:['BLOCKER','MAJOR','MINOR'].includes(classification),
      frequency,
      telemetryErrors:Number(item.errors || 0),
      feedback:Number(feedback.total || 0),
      failureRatePct,
      timing,
      evidence:correlated ? 'feedback+telemetry' : Number(item.errors || 0)>=2 ? 'repeated_telemetry' : Number(feedback.total || 0)>=2 ? 'repeated_feedback' : frequency ? 'needs_more_evidence' : 'no_signal',
      userImpact:meta.impact,
      recommendedFix:meta.fix,
    };
  });
}

function betaJourneyEventName(row = {}) {
  if (row?.source!=='client' || row?.event_type!=='client_telemetry') return '';
  const code=String(row?.code || '');
  if (code==='BOOT_OK') return 'miniapp_open';
  if (code!=='PRODUCT_ACTION') return '';
  const reason=String(row?.metadata?.reason || '');
  return reason ? `miniapp_${reason}` : '';
}

function betaJourneySummary(rows = []) {
  const stages=[
    'miniapp_open',
    'miniapp_search_used',
    'miniapp_search_found',
    'miniapp_match_open',
    'miniapp_ai_start',
    'miniapp_ai_complete',
    'miniapp_history_open',
    'miniapp_open',
  ];
  const subjects=new Map();
  for (const row of rows || []) {
    const subject=String(row?.metadata?.betaSubject || '');
    if (!/^[0-9a-f]{32}$/.test(subject)) continue;
    if (!subjects.has(subject)) subjects.set(subject,[]);
    subjects.get(subject).push(row);
  }
  const reached=Array(stages.length).fill(0);
  let fullCompleted=0;
  let analysisCompleted=0;
  for (const subjectRows of subjects.values()) {
    const ordered=[...subjectRows].sort((a,b)=>Date.parse(a?.created_at || 0)-Date.parse(b?.created_at || 0));
    let index=0;
    for (const row of ordered) {
      const eventName=betaJourneyEventName(row);
      if (eventName && eventName===stages[index]) {
        reached[index]+=1;
        index+=1;
        if (index>=stages.length) break;
      }
    }
    if (index>=6) analysisCompleted+=1;
    if (index>=stages.length) fullCompleted+=1;
  }
  const labels=['launch','searchUsed','searchFound','matchOpen','aiStart','aiComplete','historyOpen','reentry'];
  return {
    betaUsers:subjects.size,
    analysisCompleted,
    analysisCompletionPct:subjects.size ? Math.round((analysisCompleted/subjects.size)*1000)/10 : 0,
    fullCompleted,
    fullCompletionPct:subjects.size ? Math.round((fullCompleted/subjects.size)*1000)/10 : 0,
    stages:Object.fromEntries(labels.map((label,index)=>[label,reached[index]])),
    definition:'open -> search_used -> search_found -> match_open -> ai_start -> ai_complete -> history_open -> reopen',
  };
}

function latestConfirmedProviderQuota(rows = [], nowMs = Date.now()) {
  const candidates=(rows || [])
    .filter(row=>row?.source==='provider' && row?.event_type==='quota_probe' && row?.code==='PROVIDER_QUOTA_CONFIRMED')
    .filter(row=>{
      const at=Date.parse(row?.created_at || '');
      return Number.isFinite(at) && nowMs-at<=24*60*60_000;
    })
    .sort((a,b)=>Date.parse(b?.created_at || 0)-Date.parse(a?.created_at || 0));
  const row=candidates[0] || null;
  if (!row) return {confirmed:false,source:'none',confirmedAt:null};
  const meta=row.metadata || {};
  const complete=String(meta.plan || 'UNKNOWN')!=='UNKNOWN'
    && [meta.dailyLimit,meta.dailyRemaining,meta.minuteLimit,meta.minuteRemaining]
      .every(value=>Number.isFinite(Number(value)));
  return {
    confirmed:complete,
    source:'provider_monitor',
    confirmedAt:complete ? row.created_at : null,
    plan:complete ? String(meta.plan || '') : '',
    dailyLimit:complete ? Number(meta.dailyLimit) : null,
    dailyRemaining:complete ? Number(meta.dailyRemaining) : null,
    minuteLimit:complete ? Number(meta.minuteLimit) : null,
    minuteRemaining:complete ? Number(meta.minuteRemaining) : null,
  };
}


function phase5MetricSummary(rows = [], eventName = '') {
  const matched=betaClientEventRows(rows,eventName);
  const users=new Set();
  const sessions=new Set();
  for (const row of matched) {
    const subject=String(row?.metadata?.validationSubject || '');
    const session=String(row?.metadata?.validationSession || '');
    if (/^[0-9a-f]{32}$/.test(subject)) users.add(subject);
    if (/^[0-9a-f]{32}$/.test(session)) sessions.add(session);
  }
  return {events:matched.length,users:users.size,sessions:sessions.size};
}

function phase5JourneySummary(rows = []) {
  const valid=(rows || []).filter(row=>
    row?.source==='client'
    && row?.event_type==='client_telemetry'
    && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSubject || ''))
    && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSession || ''))
  );
  const bootRows=valid.filter(row=>String(row?.code || '')==='BOOT_OK');
  const users=new Set(bootRows.map(row=>String(row.metadata.validationSubject)));
  const sessions=new Set(bootRows.map(row=>String(row.metadata.validationSession)));
  const bySubject=new Map();
  for (const row of valid) {
    const subject=String(row.metadata.validationSubject);
    if (!bySubject.has(subject)) bySubject.set(subject,[]);
    bySubject.get(subject).push(row);
  }
  const stages={home:0,search:0,matchCenter:0,ai:0,favoriteTeam:0,history:0,reopen:0};
  let fullCompleted=0;
  let reopenUsers=0;
  for (const subject of users) {
    const ordered=(bySubject.get(subject) || []).slice().sort((a,b)=>Date.parse(a?.created_at || 0)-Date.parse(b?.created_at || 0));
    const bootSessions=[...new Set(ordered.filter(row=>String(row?.code || '')==='BOOT_OK').map(row=>String(row?.metadata?.validationSession || '')))];
    if (bootSessions.length>=2) reopenUsers+=1;
    stages.home+=1;
    let stage=0;
    let historyAt=0;
    const firstSession=bootSessions[0] || '';
    for (const row of ordered) {
      const code=String(row?.code || '');
      const reason=String(row?.metadata?.reason || '');
      const view=String(row?.metadata?.view || '');
      const event=code==='PRODUCT_ACTION' ? reason : '';
      if (stage===0 && event==='search_used') { stage=1; stages.search+=1; continue; }
      if (stage===1 && event==='match_open') { stage=2; stages.matchCenter+=1; continue; }
      if (stage===2 && event==='ai_complete') { stage=3; stages.ai+=1; continue; }
      if (stage===3 && event==='matches_open' && view==='myTeamsView') { stage=4; stages.favoriteTeam+=1; continue; }
      if (stage===4 && event==='history_open') { stage=5; stages.history+=1; historyAt=Date.parse(row?.created_at || 0); }
    }
    if (stage>=5) {
      const reopened=ordered.some(row=>
        String(row?.code || '')==='BOOT_OK'
        && String(row?.metadata?.validationSession || '')!==firstSession
        && Date.parse(row?.created_at || 0)>historyAt
      );
      if (reopened) { stages.reopen+=1; fullCompleted+=1; }
    }
  }
  return {
    verifiedNormalUsers:users.size,
    sessions:sessions.size,
    fullCompleted,
    reopenUsers,
    returnRatePct:users.size ? Math.round((reopenUsers/users.size)*1000)/10 : 0,
    stages,
    abandonment:{
      home:Math.max(0,stages.home-stages.search),
      search:Math.max(0,stages.search-stages.matchCenter),
      matchCenter:Math.max(0,stages.matchCenter-stages.ai),
      ai:Math.max(0,stages.ai-stages.favoriteTeam),
      favoriteTeam:Math.max(0,stages.favoriteTeam-stages.history),
      history:Math.max(0,stages.history-stages.reopen),
    },
    definition:'verified Telegram BOOT_OK -> search_used -> match_open -> ai_complete -> My Teams -> history_open -> BOOT_OK in a later session',
  };
}

function phase5ProviderSummary(rows = [], {sessions=0,users=0,fullJourneys=0} = {}) {
  const usageRows=(rows || []).filter(row=>
    row?.source==='phase5'
    && row?.event_type==='provider_usage'
    && row?.code==='PHASE5_PROVIDER_USAGE'
    && row?.metadata?.validationCohort===PHASE5_VALIDATION_COHORT
    && row?.metadata?.validationVerified===true
  );
  const totals={networkRequests:0,cacheHits:0,staleCacheHits:0,quotaBlocks:0,sharedCooldowns:0};
  const byFeature={};
  const blockedSessions=new Set();
  const liveUsers=new Set();
  for (const row of usageRows) {
    const m=row.metadata || {};
    const kind=String(m.requestKind || 'other');
    const bucket=byFeature[kind] ||= {requests:0,networkRequests:0,cacheHits:0,staleCacheHits:0,quotaBlocks:0,sharedCooldowns:0};
    bucket.requests+=1;
    for (const key of Object.keys(totals)) {
      const value=Math.max(0,Number(m[key] || 0));
      totals[key]+=value;
      bucket[key]+=value;
    }
    if (Number(m.quotaBlocks || 0)>0 || Number(m.sharedCooldowns || 0)>0) blockedSessions.add(String(m.validationSession || ''));
    if (kind==='live_refresh') liveUsers.add(String(m.validationSubject || ''));
  }
  const round=value=>Number.isFinite(value) ? Math.round(value*100)/100 : null;
  const requestsPerSession=sessions ? round(totals.networkRequests/sessions) : null;
  const requestsPerCompletedJourney=fullJourneys ? round(totals.networkRequests/fullJourneys) : null;
  const cacheDenominator=totals.cacheHits+totals.networkRequests;
  const cacheHitRatePct=cacheDenominator ? Math.round((totals.cacheHits/cacheDenominator)*1000)/10 : null;
  const aiRequestsPerUser=users ? round(Number(byFeature.ai?.networkRequests || 0)/users) : null;
  const liveRequestsPerActiveUser=liveUsers.size ? round(Number(byFeature.live_refresh?.networkRequests || 0)/liveUsers.size) : null;
  const sessionsPerUser=users ? sessions/users : null;
  return {
    ...totals,
    requestsPerSession,
    requestsPerCompletedJourney,
    cacheHitRatePct,
    aiRequestsPerUser,
    liveRequestsPerActiveUser,
    activeLiveUsers:liveUsers.size,
    blockedSessions:[...blockedSessions].filter(value=>/^[0-9a-f]{32}$/.test(value)).length,
    byFeature,
    capacity:{
      evidenceSufficient:sessions>=10 && requestsPerSession!==null,
      concurrent10:requestsPerCompletedJourney===null ? null : round(requestsPerCompletedJourney*10),
      concurrent25:requestsPerCompletedJourney===null ? null : round(requestsPerCompletedJourney*25),
      concurrent50:requestsPerCompletedJourney===null ? null : round(requestsPerCompletedJourney*50),
      dailyActive100:requestsPerSession===null || sessionsPerUser===null ? null : round(requestsPerSession*sessionsPerUser*100),
      dailyActive500:requestsPerSession===null || sessionsPerUser===null ? null : round(requestsPerSession*sessionsPerUser*500),
      note:'Projection uses observed production requests/session and observed sessions/user; it is not inferred from provider documentation.',
    },
  };
}

function phase5EvidenceGate({journey={},timings={},coverage={},opsSampleLimited=false}={}) {
  const requirements={
    verifiedNormalUsers:{required:5,actual:Number(journey.verifiedNormalUsers || 0)},
    sessions:{required:10,actual:Number(journey.sessions || 0)},
    fullJourneys:{required:5,actual:Number(journey.fullCompleted || 0)},
    searchSamples:{required:10,actual:Number(timings?.search?.samples || 0)},
    matchCenterSamples:{required:10,actual:Number(timings?.match?.samples || 0)},
    aiSamples:{required:10,actual:Number(timings?.ai?.samples || 0)},
    coverageObservations:{required:20,actual:Number(coverage?.samples || 0)},
  };
  for (const value of Object.values(requirements)) value.pass=value.actual>=value.required;
  const thresholdsMet=Object.values(requirements).every(value=>value.pass) && !opsSampleLimited;
  const liveSamples=Math.max(Number(timings?.live?.samples || 0),Number(coverage?.live?.samples || 0));
  return {
    status:thresholdsMet ? 'EVIDENCE THRESHOLDS MET' : 'COLLECT MORE EVIDENCE',
    thresholdsMet,
    requirements,
    liveStatus:liveSamples>0 ? 'OBSERVED' : 'INSUFFICIENT_LIVE_SAMPLE',
    opsSampleLimited:Boolean(opsSampleLimited),
  };
}

async function apiPhase5Dashboard(request,cfg) {
  const url=new URL(request.url);
  const days=Math.max(1,Math.min(30,Number(url.searchParams.get('days') || 7)));
  if (!hasSupabase(cfg)) return json({available:false,reason:'Для Phase 5 validation нужен Supabase.',days});
  const now=Date.now();
  const since=new Date(now-days*86400_000).toISOString();
  const end=new Date(now+1000).toISOString();
  const [opsResult,diagnostics]=await Promise.all([
    readOpsEventsRange(cfg,since,end,1000),
    collectDiagnostics(cfg).catch(()=>({})),
  ]);
  const allOpsRows=opsResult.items || [];
  const phase5Rows=allOpsRows.filter(row=>
    row?.metadata?.validationCohort===PHASE5_VALIDATION_COHORT
    && row?.metadata?.validationVerified===true
    && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSubject || ''))
    && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSession || ''))
  );
  const clientRows=phase5Rows.filter(row=>row?.source==='client' && row?.event_type==='client_telemetry');
  const metrics={};
  for (const [key,eventName] of Object.entries({
    miniAppLaunch:'miniapp_open',searchUsed:'miniapp_search_used',searchFound:'miniapp_search_found',
    searchEmpty:'miniapp_search_empty',matchOpen:'miniapp_match_open',aiStart:'miniapp_ai_start',
    aiComplete:'miniapp_ai_complete',liveOpen:'miniapp_live_open',historyOpen:'miniapp_history_open',
    profileOpen:'miniapp_profile_open',
  })) metrics[key]=phase5MetricSummary(clientRows,eventName);
  const journey=phase5JourneySummary(clientRows);
  const timings={
    search:betaTimingSummary(clientRows,'search'),
    match:betaTimingSummary(clientRows,'match'),
    ai:betaTimingSummary(clientRows,'ai'),
    live:betaTimingSummary(clientRows,'live'),
  };
  const coverage=betaCoverageSummary(clientRows);
  const evidenceGate=phase5EvidenceGate({journey,timings,coverage,opsSampleLimited:allOpsRows.length>=1000});
  const provider=phase5ProviderSummary(phase5Rows,{sessions:journey.sessions,users:journey.verifiedNormalUsers,fullJourneys:journey.fullCompleted});
  const persistedQuota=latestConfirmedProviderQuota(allOpsRows,now);
  const providerNow=providerSnapshot();
  const providerNowFresh=Boolean(providerNow.updatedAt && now-Date.parse(providerNow.updatedAt)<=10*60_000);
  const providerNowComplete=providerNowFresh
    && String(providerNow.plan || 'UNKNOWN')!=='UNKNOWN'
    && [providerNow.dailyLimit,providerNow.dailyRemaining,providerNow.minuteLimit,providerNow.minuteRemaining].every(value=>Number.isFinite(Number(value)));
  const quotaState=providerNowComplete ? {
    confirmed:true,source:'provider_runtime',confirmedAt:providerNow.updatedAt,plan:String(providerNow.plan || ''),
    dailyLimit:Number(providerNow.dailyLimit),dailyRemaining:Number(providerNow.dailyRemaining),
    minuteLimit:Number(providerNow.minuteLimit),minuteRemaining:Number(providerNow.minuteRemaining),
  } : persistedQuota;
  const errorRows=betaClientEventRows(clientRows,'miniapp_error');
  const errorKinds={};
  for (const row of errorRows) {
    const key=String(row?.metadata?.errorKind || 'unknown');
    errorKinds[key]=Number(errorKinds[key] || 0)+1;
  }
  const issues=buildBetaIssueGroups({metrics,errorRows,feedbackRows:[],timings,clientErrorRows:clientRows.filter(row=>String(row?.code || '')==='CLIENT_ERROR')});
  const repeatedProductBlocker=issues.some(issue=>issue?.classification==='BLOCKER');
  const systematicMissing=Object.entries(coverage.missing || {}).filter(([,item])=>Number(item?.samples || 0)>=10 && Number(item?.missingPct || 0)>=70).map(([key])=>key);
  const coverageDecision=coverage.samples<20
    ? 'COLLECT MORE EVIDENCE'
    : systematicMissing.length>=2 ? 'DATA COVERAGE REVIEW REQUIRED' : 'KEEP CURRENT PROVIDER';
  const requestsPerSession=Number(provider.requestsPerSession);
  const providerBehaviorObserved=Number.isFinite(requestsPerSession)
    && (Number(provider.networkRequests || 0)>0 || Number(provider.cacheHits || 0)>0 || Number(provider.staleCacheHits || 0)>0);
  const cacheBehaviorObserved=provider.cacheHitRatePct!==null
    || Number(provider.staleCacheHits || 0)>0
    || Number(provider.networkRequests || 0)>0;
  const dailyHeadroomSessions=quotaState.confirmed && requestsPerSession>0
    ? Math.floor(Math.max(0,Number(quotaState.dailyRemaining || 0))/requestsPerSession)
    : null;
  const typicalSessionExceedsMinuteLimit=Boolean(
    quotaState.confirmed
    && requestsPerSession>0
    && Number(quotaState.minuteLimit || 0)>0
    && requestsPerSession>Number(quotaState.minuteLimit)
  );
  const repeatedCapacityPressure=Number(provider.quotaBlocks || 0)>=2 || Number(provider.sharedCooldowns || 0)>=2;
  const constrainedDailyHeadroom=dailyHeadroomSessions!==null && dailyHeadroomSessions<10;
  const capacityEvidenceReady=Boolean(
    evidenceGate.requirements.sessions.pass
    && quotaState.confirmed
    && providerBehaviorObserved
    && cacheBehaviorObserved
  );
  const capacityDecision=!capacityEvidenceReady
    ? 'COLLECT MORE EVIDENCE'
    : repeatedCapacityPressure && (typicalSessionExceedsMinuteLimit || constrainedDailyHeadroom)
      ? 'CAPACITY REVIEW REQUIRED'
      : 'KEEP CURRENT PROVIDER';
  let status='COLLECT MORE EVIDENCE';
  if (evidenceGate.thresholdsMet) {
    if (repeatedProductBlocker) status='PRODUCT BLOCKER HOLD';
    else if (capacityDecision==='CAPACITY REVIEW REQUIRED') status='PROVIDER CAPACITY REVIEW REQUIRED';
    else if (coverageDecision==='DATA COVERAGE REVIEW REQUIRED') status='DATA COVERAGE REVIEW REQUIRED';
    else status='PUBLIC VALIDATION HEALTHY';
  }
  return json({
    available:true,
    generatedAt:new Date().toISOString(),
    periodDays:days,
    cohort:PHASE5_VALIDATION_COHORT,
    status,
    privacy:{
      aggregatedOnly:true,telegramIdsReturned:false,telegramIdsStoredInValidationTelemetry:false,
      rawSessionTokensStored:false,hmacSubjectsOnly:true,adminExcluded:true,unsignedExcluded:true,
      syntheticDevIdentityExcluded:true,smokeAndHealthExcluded:true,duplicateClientEventsDeduped:true,
    },
    accessMode:{
      publicByDefault:!cfg.betaAccessEnabled,
      strictBetaAccess:Boolean(cfg.betaAccessEnabled),
      note:'BETA_ACCESS_ENABLED controls access only; BETA_TELEGRAM_IDS is not a Phase 5 evidence membership requirement.',
    },
    users:{
      verifiedNormalUsers:journey.verifiedNormalUsers,sessions:journey.sessions,
      completedJourneys:journey.fullCompleted,reopenUsers:journey.reopenUsers,returnRatePct:journey.returnRatePct,
    },
    product:{
      searchSamples:Number(timings.search.samples || 0),matchCenterSamples:Number(timings.match.samples || 0),
      aiSamples:Number(timings.ai.samples || 0),
      liveSamples:Math.max(Number(timings.live.samples || 0),Number(coverage.live?.samples || 0)),
      metrics,abandonmentStage:journey.abandonment,journeyStages:journey.stages,
    },
    performance:timings,
    provider:{...provider,quotaState,capacityDecision,capacityInputs:{requestsPerSession:Number.isFinite(requestsPerSession)?requestsPerSession:null,cacheHitRatePct:provider.cacheHitRatePct,staleCacheHits:Number(provider.staleCacheHits || 0),dailyHeadroomSessions,typicalSessionExceedsMinuteLimit,repeatedCapacityPressure},upgradeAutomatic:false,decisionRule:'Capacity is evaluated from real verified sessions, observed network requests/session, cache behavior and confirmed quota. A review signal does not automatically upgrade the provider.'},
    coverage:{
      observations:Number(coverage.samples || 0),
      lineups:coverage.missing?.lineups || {samples:0,missing:0,missingPct:0},
      injuries:coverage.missing?.injuries || {samples:0,missing:0,missingPct:0},
      statistics:coverage.missing?.statistics || {samples:0,missing:0,missingPct:0},
      xg:coverage.missing?.xg || {samples:0,missing:0,missingPct:0},
      odds:coverage.missing?.odds || {samples:0,missing:0,missingPct:0},
      live:{status:evidenceGate.liveStatus,samples:Number(coverage.live?.samples || 0),missing:coverage.live?.missing || {}},
      decision:coverageDecision,systematicMissing,
    },
    evidenceGate,
    runtime:{
      supabase:Boolean(diagnostics?.supabase?.ok) ? 'ok' : String(diagnostics?.supabase?.status || 'problem'),
      telegram:String(diagnostics?.telegramWebhook?.state || (cfg.botToken ? 'configured' : 'not_configured')),
      providerRateLimit:Number(errorKinds.rate_limit || 0),providerErrors:Number(errorKinds.provider || 0),
      timeouts:Number(errorKinds.timeout || 0),
      clientErrors:clientRows.filter(row=>String(row?.code || '')==='CLIENT_ERROR').length,
      productBlockerPattern:repeatedProductBlocker,issues,
    },
    sample:{
      clientEvents:clientRows.length,
      providerUsageRows:phase5Rows.filter(row=>row?.source==='phase5' && row?.event_type==='provider_usage').length,
      opsPersistent:Boolean(opsResult.persistent),opsSampleLimited:allOpsRows.length>=1000,
      evidenceStartsWithTaggedPhase5ProductionEvents:true,legacyClosedBetaRowsExcluded:true,
    },
  });
}

async function apiBetaDashboard(request,cfg) {
  const url=new URL(request.url);
  const days=Math.max(1,Math.min(30,Number(url.searchParams.get('days') || 7)));
  if (!hasSupabase(cfg)) return json({available:false,reason:'Для наблюдения closed beta нужен Supabase.',days});
  const now=Date.now();
  const since=new Date(now-days*86400_000).toISOString();
  const end=new Date(now+1000).toISOString();
  const [opsResult,diagnostics,telegramWebhookProbe]=await Promise.all([
    readOpsEventsRange(cfg,since,end,1000),
    collectDiagnostics(cfg).catch(()=>({})),
    billingWebhookStatus(request,cfg).catch(()=>({ready:false,reason:'webhook_check_failed'})),
  ]);
  const allOpsRows=opsResult.items || [];
  const opsRows=allOpsRows.filter(row=>String(row?.metadata?.betaCohort || '')===CLOSED_BETA_COHORT && row?.metadata?.betaMembershipVerified===true);
  const betaClientRows=opsRows.filter(row=>row?.source==='client' && row?.event_type==='client_telemetry'
    && /^[0-9a-f]{32}$/.test(String(row?.metadata?.betaSubject || '')));

  const metricDefs={
    miniAppLaunch:'miniapp_open',
    searchUsed:'miniapp_search_used',
    searchFound:'miniapp_search_found',
    searchEmpty:'miniapp_search_empty',
    matchOpen:'miniapp_match_open',
    aiStart:'miniapp_ai_start',
    aiComplete:'miniapp_ai_complete',
    liveOpen:'miniapp_live_open',
    historyOpen:'miniapp_history_open',
    profileOpen:'miniapp_profile_open',
  };
  const metrics={};
  for (const [key,eventName] of Object.entries(metricDefs)) metrics[key]=betaMetricSummary(betaClientRows,eventName);

  const journey=betaJourneySummary(betaClientRows);
  const entrySize=Number(journey.betaUsers || 0);

  const errorRows=betaClientEventRows(betaClientRows,'miniapp_error');
  const clientErrorRows=betaClientRows.filter(row=>String(row?.code || '')==='CLIENT_ERROR');
  const errorKinds={};
  const errorActions={};
  for (const row of errorRows) {
    const kind=String(row?.metadata?.errorKind || 'unknown');
    const action=String(row?.metadata?.action || row?.metadata?.reason || 'unknown');
    errorKinds[kind]=Number(errorKinds[kind] || 0)+1;
    errorActions[action]=Number(errorActions[action] || 0)+1;
  }

  const timings={
    search:betaTimingSummary(betaClientRows,'search'),
    match:betaTimingSummary(betaClientRows,'match'),
    ai:betaTimingSummary(betaClientRows,'ai'),
    live:betaTimingSummary(betaClientRows,'live'),
  };
  const feedbackRows=opsRows.filter(row=>row?.source==='beta' && row?.event_type==='beta_feedback' && row?.code==='BETA_FEEDBACK');
  const coverage=betaCoverageSummary(betaClientRows);
  const productionMonitor=betaProductionMonitorSummary(allOpsRows,now);
  const issues=buildBetaIssueGroups({metrics,errorRows,feedbackRows,timings,clientErrorRows});
  const activeIssues=issues.filter(issue=>issue.active);
  const evidencePending=issues.filter(issue=>issue.classification==='NEEDS_MORE_EVIDENCE');
  const topBreak=Object.entries(errorActions).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0] || null;
  const providerRateLimit=Number(errorKinds.rate_limit || 0);
  const providerErrors=Number(errorKinds.provider || 0);
  const timeouts=Number(errorKinds.timeout || 0);
  const supabaseOk=Boolean(diagnostics?.supabase?.ok);
  const telegramState=String(diagnostics?.telegramWebhook?.state || (cfg.botToken ? 'configured' : 'not_configured'));
  const blockerCount=activeIssues.filter(issue=>issue.classification==='BLOCKER').length;
  const majorCount=activeIssues.filter(issue=>issue.classification==='MAJOR').length;
  const telegramProblem=['incident','critical','failed','not_configured'].includes(telegramState);
  const healthState=blockerCount>0 || !supabaseOk || telegramProblem
    ? 'incident'
    : activeIssues.length>0 || providerRateLimit>0 || timeouts>0 || clientErrorRows.length>0
      ? 'watch'
      : 'healthy';

  const usedFeatures=Object.entries(metrics)
    .map(([key,value])=>({key,events:Number(value.events || 0),users:Number(value.users || 0)}))
    .sort((a,b)=>b.events-a.events || a.key.localeCompare(b.key));
  const lowUsageFeatures=usedFeatures.filter(item=>item.events===0 || (entrySize>=5 && item.users<=Math.max(1,Math.floor(entrySize*0.1))));
  const dataSourceFeedback=Number(issues.find(issue=>issue.category==='data_sources')?.feedback || 0);
  const providerSignals=providerRateLimit+providerErrors+dataSourceFeedback;
  const systematicMissingCategories=Object.values(coverage.missing || {})
    .filter(item=>Number(item.samples || 0)>=10 && Number(item.missingPct || 0)>=70).length;
  const providerEvidence=entrySize>=5 && (
    providerSignals>=5
    || (coverage.samples>=10 && systematicMissingCategories>=2 && dataSourceFeedback>=2)
  ) ? 'review_provider_options' : 'insufficient_evidence';
  const adminIds=new Set((cfg.adminTelegramIds || []).map(Number));
  const betaIds=[...new Set((cfg.betaTelegramIds || []).map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))];
  const betaAdminOverlap=betaIds.filter(id=>adminIds.has(id)).length;
  const assignedBetaUsers=betaIds.filter(id=>!adminIds.has(id)).length;
  const persistedQuota=latestConfirmedProviderQuota(allOpsRows,now);
  const providerNow=providerSnapshot();
  const providerNowFresh=Boolean(providerNow.updatedAt && now-Date.parse(providerNow.updatedAt)<=10*60_000);
  const providerNowComplete=providerNowFresh
    && String(providerNow.plan || 'UNKNOWN')!=='UNKNOWN'
    && [providerNow.dailyLimit,providerNow.dailyRemaining,providerNow.minuteLimit,providerNow.minuteRemaining]
      .every(value=>Number.isFinite(Number(value)));
  const providerQuota=providerNowComplete ? {
    confirmed:true,
    source:'provider_runtime',
    confirmedAt:providerNow.updatedAt,
    plan:String(providerNow.plan || ''),
    dailyLimit:Number(providerNow.dailyLimit),
    dailyRemaining:Number(providerNow.dailyRemaining),
    minuteLimit:Number(providerNow.minuteLimit),
    minuteRemaining:Number(providerNow.minuteRemaining),
  } : persistedQuota;
  const launchBlockers=[];
  if (assignedBetaUsers<2) launchBlockers.push('beta_accounts_not_assigned');
  if (betaAdminOverlap>0) launchBlockers.push('beta_admin_overlap');
  if (!cfg.betaAccessEnabled) launchBlockers.push('strict_beta_access_disabled');
  if (!telegramWebhookProbe?.ready) launchBlockers.push('telegram_webhook_unconfirmed');
  if (!providerQuota.confirmed) launchBlockers.push('provider_quota_unconfirmed');

  const expansionDecision=betaExpansionDecision({
    launchBlockers,
    metrics,
    journey,
    timings,
    coverage,
    issues,
    opsSampleLimited:opsRows.length>=1000,
    providerEvidence,
  });
  const controlledExpansion=controlledBetaExpansionDecision({
    expansionDecision,
    assignedBetaUsers,
    journey,
    metrics,
    timings,
    coverage,
    issues,
    errorRows,
    clientErrorRows,
    providerQuota,
    productionMonitor,
    supabaseOk,
    telegramConfirmed:Boolean(telegramWebhookProbe?.ready),
  });

  return json({
    available:true,
    generatedAt:new Date().toISOString(),
    periodDays:days,
    cohort:CLOSED_BETA_COHORT,
    membershipBoundary:'server_allowlist_verified',
    privacy:{
      aggregatedOnly:true,
      telegramIdsStoredInBetaTelemetry:false,
      pseudonymousSubjectOnly:true,
      telegramIdsReturned:false,
      searchQueriesReturned:false,
      errorTextsReturned:false,
      feedbackTextsReturned:false,
    },
    launchReadiness:{
      status:launchBlockers.length ? 'blocked' : 'runtime_prerequisites_confirmed',
      blockers:launchBlockers,
      betaAssignments:{required:2,assigned:assignedBetaUsers,adminOverlap:betaAdminOverlap,idsReturned:false},
      strictBetaAccess:Boolean(cfg.betaAccessEnabled),
      telegramWebhook:{
        confirmed:Boolean(telegramWebhookProbe?.ready),
        pendingUpdates:Number(telegramWebhookProbe?.pendingUpdates || 0),
        reason:String(telegramWebhookProbe?.reason || ''),
      },
      providerQuota,
      note:'LIVE field validation and CI/release evidence remain separate evidence gates and are not inferred from this runtime snapshot.',
    },
    metrics,
    journey,
    expansionDecision,
    controlledExpansion,
    actionErrors:{total:errorRows.length,byCategory:errorKinds,byAction:errorActions,clientErrors:clientErrorRows.length},
    dataCoverage:coverage,
    timings,
    health:{
      state:healthState,
      label:healthState==='healthy' ? 'Ошибок нет' : healthState==='incident' ? 'Есть проблемы' : 'Нужно наблюдение',
      topBreak:{action:topBreak?.[0] || '',count:Number(topBreak?.[1] || 0)},
      providerRateLimit,
      timeout:timeouts,
      clientErrors:clientErrorRows.length,
      supabase:supabaseOk ? 'ok' : String(diagnostics?.supabase?.status || 'problem'),
      telegram:telegramState,
      productionMonitor:productionMonitor.state,
      currentRelease:{version:APP_VERSION,candidate:RC_NAME,channel:RELEASE_CHANNEL},
      activeProblems:activeIssues.length,
      needsMoreEvidence:evidencePending.length,
      blockerCount,
      majorCount,
    },
    issues,
    report:{
      betaUsers:entrySize,
      fullJourneyCompleted:Number(journey.fullCompleted || 0),
      fullJourneyCompletionPct:Number(journey.fullCompletionPct || 0),
      analysisJourneyCompleted:Number(journey.analysisCompleted || 0),
      mainDropoff:topBreak ? {action:topBreak[0],count:Number(topBreak[1] || 0)} : null,
      usedFeatures,
      lowUsageFeatures,
      missingDataSignals:{
        searchEmpty:Number(metrics.searchEmpty?.events || 0),
        providerErrors,
        providerRateLimit,
        lineups:coverage.missing?.lineups || {samples:0,missing:0,missingPct:0},
        injuries:coverage.missing?.injuries || {samples:0,missing:0,missingPct:0},
        statistics:coverage.missing?.statistics || {samples:0,missing:0,missingPct:0},
        xg:coverage.missing?.xg || {samples:0,missing:0,missingPct:0},
        odds:coverage.missing?.odds || {samples:0,missing:0,missingPct:0},
      },
      providerExpansionEvidence:{status:providerEvidence,signals:providerSignals,betaUsers:entrySize,systematicMissingCategories},
      betaExpansionReadiness:{
        status:expansionDecision.status,
        expansionAllowed:expansionDecision.expansionAllowed,
        closedBetaLaunchStageComplete:expansionDecision.closedBetaLaunchStageComplete,
        blockers:blockerCount,
        majors:majorCount,
        needsMoreEvidence:evidencePending.length,
        dataCoverageDecision:expansionDecision.dataCoverageDecision,
        requirements:expansionDecision.requirements,
        hardBlockers:expansionDecision.hardBlockers,
      },
      controlledBetaExpansion:{
        finalDecision:controlledExpansion.finalDecision,
        providerValidationDecision:controlledExpansion.providerValidationDecision,
        nextWave:controlledExpansion.nextWave,
        waves:controlledExpansion.waves,
        providerSignals:controlledExpansion.providerSignals,
      },
    },
    sample:{
      clientEvents:betaClientRows.length,
      opsEvents:opsRows.length,
      identityMode:'hmac_pseudonym',
      opsPersistent:Boolean(opsResult.persistent),
      opsSampleLimited:opsRows.length>=1000,
    },
  });
}

function providerSloEventRow(snapshot = {}, report = {}, cfg = {}) {
  const state = String(report?.overall?.state || 'collecting');
  const severity = state === 'incident' ? 'error' : state === 'watch' ? 'warning' : 'info';
  return {
    created_at: new Date().toISOString(),
    severity,
    source: 'provider',
    event_type: 'slo_window',
    code: 'PROVIDER_SLO_WINDOW',
    message: 'Aggregated football provider SLO window.',
    endpoint: 'cron:production-monitor',
    status: null,
    duration_ms: null,
    metadata: safeOpsMetadata({
      ...currentReleaseIdentity(cfg),
      windowId: snapshot.windowId || `provider-slo:${snapshot.windowStartedAt || ''}`,
      windowStartedAt: snapshot.windowStartedAt,
      windowEndedAt: snapshot.windowEndedAt,
      complete: snapshot.complete !== false,
      series: snapshot.series,
      totals: snapshot.totals,
      sloState: state,
    }),
  };
}

async function persistProviderSloWindowRow(cfg, snapshot = {}) {
  const report=summarizeProviderObservabilityWindows([{metadata:snapshot}],{hours:1,includeCurrent:false});
  const row=providerSloEventRow(snapshot,report,cfg);
  if (hasSupabase(cfg)) {
    const url=new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    const response=await fetchWithTimeout(url,{
      method:'POST',
      headers:supaHeaders(cfg,{Prefer:'return=minimal'}),
      body:JSON.stringify(row),
    },4000,'Supabase provider SLO window');
    if (!response.ok) throw new Error(`Provider SLO persistence HTTP ${response.status}`);
  }
  memory.opsEvents.unshift(row);
  memory.opsEvents=memory.opsEvents.slice(0,MAX_MEMORY_OPS_EVENTS);
  return {ok:true,state:report.overall.state,requests:Number(report.overall.requests || 0)};
}

async function flushProviderSloWindow(cfg) {
  const localSnapshot=rotateProviderObservabilityWindow();
  if (hasSupabase(cfg)) {
    try {
      const distributed=await readProviderSloWindows(cfg,2,{includeOpen:false,nowMs:Date.now()});
      if (distributed.distributed) {
        const latest=distributed.items.at(-1)?.metadata || null;
        if (!latest) return {skipped:true,reason:'no_completed_provider_slo_bucket',distributed:true};
        return {...await persistProviderSloWindowRow(cfg,latest),distributed:true,windowId:latest.windowId || null};
      }
    } catch {
      // Fall through to the local snapshot. SLO persistence must never break provider traffic.
    }
  }

  if (Number(localSnapshot?.totals?.attempts || 0)===0) {
    return {skipped:true,reason:'no_provider_requests',distributed:false};
  }
  try {
    return {...await persistProviderSloWindowRow(cfg,localSnapshot),distributed:false};
  } catch (error) {
    restoreProviderObservabilityWindow(localSnapshot);
    bumpTelemetry('providerSloPersistenceErrors');
    return {ok:false,error:redactOpsString(error?.message || error,160),distributed:false};
  }
}

async function readProviderSloWindows(cfg, hours = 24, { nowMs = Date.now(), includeOpen = true } = {}) {
  const safeHours=Math.max(1,Math.min(168,Number(hours || 24)));
  const safeNow=Number(nowMs || Date.now());
  const since=new Date(safeNow-safeHours*60*60_000).toISOString();
  const fallbackItems=memory.opsEvents.filter(item =>
    item?.source==='provider'
    && item?.code==='PROVIDER_SLO_WINDOW'
    && Date.parse(item?.metadata?.windowEndedAt || item?.created_at || '')>=Date.parse(since)
  ).slice(0,800);
  const fallback=()=>({
    persistent:false,
    migrationReady:false,
    distributed:false,
    items:fallbackItems,
    hours:safeHours,
  });
  if (!hasSupabase(cfg)) return fallback();

  try {
    const raw=await supaRpc(cfg,'read_provider_slo_buckets',{
      p_since:since,
      p_until:new Date(safeNow+15*60_000).toISOString(),
      p_limit:10000,
    },5000);
    const rows=Array.isArray(raw)
      ? raw
      : raw && typeof raw==='object' && raw.bucket_started_at
        ? [raw]
        : [];
    const items=providerSloWindowsFromBuckets(rows,{
      hours:safeHours,
      nowMs:safeNow,
      windowMinutes:15,
      includeOpen,
    });
    return {
      persistent:true,
      migrationReady:true,
      distributed:true,
      items,
      hours:safeHours,
      bucketRows:rows.length,
    };
  } catch {
    // Backward-compatible fallback for the DDL/deploy boundary and local development.
  }

  try {
    const url=new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    url.searchParams.set('select','created_at,severity,source,event_type,code,metadata');
    url.searchParams.set('source','eq.provider');
    url.searchParams.set('code','eq.PROVIDER_SLO_WINDOW');
    url.searchParams.set('created_at',`gte.${since}`);
    url.searchParams.set('order','created_at.asc');
    url.searchParams.set('limit','800');
    const response=await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase provider SLO fallback');
    if (!response.ok) return fallback();
    const items=await response.json().catch(()=>[]);
    return {
      persistent:true,
      migrationReady:false,
      distributed:false,
      items:Array.isArray(items)?items:[],
      hours:safeHours,
    };
  } catch {
    return fallback();
  }
}

async function providerSloReport(cfg, hours = 24) {
  const source=await readProviderSloWindows(cfg,hours,{nowMs:Date.now(),includeOpen:true});
  const incidentSource=source.hours>=168
    ? await readProviderSloWindows(cfg,168,{nowMs:Date.now(),includeOpen:false})
    : await readProviderSloWindows(cfg,168,{nowMs:Date.now(),includeOpen:false});
  const report=summarizeProviderObservabilityWindows(source.items,{
    hours:source.hours,
    includeCurrent:!source.distributed,
  });
  return {
    ...report,
    incident:buildProviderSloIncidentTimeline(incidentSource.items),
    persistent:Boolean(source.persistent),
    distributed:Boolean(source.distributed),
    incidentPersistent:Boolean(incidentSource.persistent),
    incidentDistributed:Boolean(incidentSource.distributed),
    migrationReady:Boolean(source.migrationReady && incidentSource.migrationReady),
  };
}

async function readProviderIncidentAlertEvents(cfg, hours = 168) {
  const safeHours = Math.max(1, Math.min(336, Number(hours || 168)));
  const since = new Date(Date.now() - safeHours * 60 * 60_000).toISOString();
  const fallbackItems = memory.opsEvents.filter(item =>
    item?.source === 'provider_alert'
    && Date.parse(item?.created_at || '') >= Date.parse(since)
  ).slice(0,300);
  const fallback = () => ({ persistent:false, migrationReady:false, items:fallbackItems, hours:safeHours });
  if (!hasSupabase(cfg)) return fallback();

  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    url.searchParams.set('select','created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
    url.searchParams.set('source','eq.provider_alert');
    url.searchParams.set('created_at',`gte.${since}`);
    url.searchParams.set('order','created_at.asc');
    url.searchParams.set('limit','300');
    const response = await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase provider incident alerts');
    if (!response.ok) return fallback();
    const items = await response.json().catch(()=>[]);
    return { persistent:true, migrationReady:true, items:Array.isArray(items)?items:[], hours:safeHours };
  } catch {
    return fallback();
  }
}


async function providerIncidentAlertDestinations(cfg) {
  const admins=Array.isArray(cfg.adminTelegramIds) ? cfg.adminTelegramIds : [];
  const botIdentity=providerIncidentBotIdentity(cfg.botToken);
  const rows=await Promise.all(admins.map(async (chatId,slot)=>({
    slot,
    destinationKey:await providerIncidentDestinationKey(chatId,botIdentity),
  })));
  return rows.filter(row=>row.destinationKey);
}

async function readProviderIncidentAlertDeliveries(cfg, hours = 168) {
  const safeHours = Math.max(1,Math.min(336,Number(hours || 168)));
  if (!hasSupabase(cfg)) {
    return { ok:false, persistent:false, status:'not_configured', items:[], hours:safeHours };
  }
  const since = new Date(Date.now() - safeHours * 60 * 60_000).toISOString();
  try {
    const items = await supaSelectMany(cfg,'provider_incident_alert_deliveries',{
      created_at:`gte.${since}`,
    },{limit:500,order:'created_at.asc'});
    return { ok:true, persistent:true, status:'ok', items:Array.isArray(items) ? items : [], hours:safeHours };
  } catch (error) {
    return {
      ok:false,
      persistent:false,
      status:String(error?.code || 'error'),
      items:[],
      hours:safeHours,
      detail:redactOpsString(error?.message || error,160),
    };
  }
}

async function readProviderIncidentAlertDeliveryContract(cfg) {
  if (!hasSupabase(cfg)) return { ok:false, status:'not_configured', version:'' };
  try {
    const raw = await supaRpc(cfg,'provider_incident_alert_delivery_contract',{},3000);
    const ok = Boolean(raw?.ok);
    return {
      ok,
      status:ok ? 'ok' : 'contract_mismatch',
      version:String(raw?.version || ''),
      table:Boolean(raw?.table),
      claimRpc:Boolean(raw?.claimRpc),
      claimV2Rpc:Boolean(raw?.claimV2Rpc),
      beginRpc:Boolean(raw?.beginRpc),
      finalizeRpc:Boolean(raw?.finalizeRpc),
      uniqueIdentity:Boolean(raw?.uniqueIdentity),
    };
  } catch (error) {
    return {
      ok:false,
      status:String(error?.code || 'error'),
      version:'',
      detail:redactOpsString(error?.message || error,160),
    };
  }
}

async function claimProviderIncidentAlertDelivery(cfg,input = {}) {
  if (!hasSupabase(cfg)) throw new Error('Persistent incident alert ledger is unavailable.');
  const raw = await supaRpc(cfg,'claim_provider_incident_alert_delivery_v2',{
    p_incident_id:String(input.incidentId || ''),
    p_transition:String(input.transition || ''),
    p_alert_key:String(input.alertKey || ''),
    p_destination_key:String(input.destinationKey || ''),
    p_destination_slot:Number(input.destinationSlot || 0),
    p_max_attempts:Math.max(1,Number(input.maxAttempts || 3)),
    p_lease_seconds:Math.max(30,Number(input.leaseSeconds || 120)),
  },4000);
  if (!raw || typeof raw.acquired !== 'boolean') {
    throw new Error('Persistent incident alert claim was not confirmed.');
  }
  return raw;
}

async function beginProviderIncidentAlertDeliverySend(cfg,input = {}) {
  if (!hasSupabase(cfg)) throw new Error('Persistent incident alert ledger is unavailable.');
  const raw=await supaRpc(cfg,'begin_provider_incident_alert_delivery_send',{
    p_alert_key:String(input.alertKey || ''),
    p_destination_key:String(input.destinationKey || ''),
  },4000);
  if (!raw?.ok || String(raw?.status || '').toLowerCase()!=='sending') {
    throw new Error('Persistent incident alert begin-send transition was not confirmed: ' + String(raw?.reason || 'unknown'));
  }
  return raw;
}

async function finalizeProviderIncidentAlertDelivery(cfg,input = {}) {
  if (!hasSupabase(cfg)) throw new Error('Persistent incident alert ledger is unavailable.');
  const raw = await supaRpc(cfg,'finalize_provider_incident_alert_delivery',{
    p_alert_key:String(input.alertKey || ''),
    p_destination_key:String(input.destinationKey || ''),
    p_status:String(input.status || ''),
    p_retry_at:input.retryAt || null,
    p_http_status:Number.isFinite(Number(input.httpStatus)) ? Number(input.httpStatus) : null,
    p_error_code:input.errorCode ? String(input.errorCode).slice(0,80) : null,
    p_error_message:input.errorMessage ? redactOpsString(input.errorMessage,160) : null,
  },4000);
  if (!raw?.ok) {
    throw new Error('Persistent incident alert finalization was not confirmed: ' + String(raw?.reason || 'unknown'));
  }
  return raw;
}

function providerSloSelfTest() {
  const endedAt=new Date();
  const startedAt=new Date(endedAt.getTime()-15*60_000);
  const windowStartedAt=startedAt.toISOString();
  const windowEndedAt=endedAt.toISOString();
  const synthetic=summarizeProviderObservabilityWindows([
    {metadata:{windowId:'provider-slo:selftest',windowStartedAt,windowEndedAt,series:[
      {provider:'api-football',operation:'/fixtures',attempts:12,requests:10,successes:10,failures:0,retries:2,timeouts:0,networkErrors:0,rateLimits:0,httpErrors:0,invalidResponses:0,latencySumMs:1200,latencySamples:12,maxLatencyMs:200},
    ]}},
  ],{hours:24,includeCurrent:false});
  const collecting=summarizeProviderObservabilityWindows([
    {metadata:{windowId:'provider-slo:selftest-collecting',windowStartedAt,windowEndedAt,series:[
      {provider:'api-football',operation:'/fixtures',attempts:2,requests:2,successes:2,failures:0,retries:0,timeouts:0,networkErrors:0,rateLimits:0,httpErrors:0,invalidResponses:0,latencySumMs:100,latencySamples:2,maxLatencyMs:50},
    ]}},
  ],{hours:24,includeCurrent:false});
  return {
    pass:synthetic.overall.state==='watch'
      && synthetic.overall.requests===10
      && synthetic.overall.retries===2
      && collecting.overall.state==='collecting',
    state:synthetic.overall.state,
    collecting:collecting.overall.state,
  };
}

function providerSloIncidentSelfTest() {
  const windows = [
    { created_at:'2026-09-28T10:00:00Z', metadata:{ windowStartedAt:'2026-09-28T09:45:00Z', windowEndedAt:'2026-09-28T10:00:00Z', sloState:'healthy', totals:{requests:12,successRatePct:100} } },
    { created_at:'2026-09-28T10:15:00Z', metadata:{ windowStartedAt:'2026-09-28T10:00:00Z', windowEndedAt:'2026-09-28T10:15:00Z', sloState:'healthy', totals:{requests:11,successRatePct:100} } },
    { created_at:'2026-09-28T10:30:00Z', metadata:{ windowStartedAt:'2026-09-28T10:15:00Z', windowEndedAt:'2026-09-28T10:30:00Z', sloState:'watch', totals:{requests:10,successRatePct:97,retryRatePct:15} } },
    { created_at:'2026-09-28T10:45:00Z', metadata:{ windowStartedAt:'2026-09-28T10:30:00Z', windowEndedAt:'2026-09-28T10:45:00Z', sloState:'watch', totals:{requests:10,successRatePct:96,retryRatePct:18} } },
  ];
  const incident = buildProviderSloIncidentTimeline(windows,{nowMs:Date.parse('2026-09-28T11:00:00Z')});
  const event = providerSloIncidentOpsEvent(incident.transition);
  return {
    pass: incident.state === 'watch'
      && incident.activeIncident?.active === true
      && incident.transition?.kind === 'opened'
      && event?.code === 'PROVIDER_SLO_WATCH',
    state:incident.state,
    transition:incident.transition?.kind || '',
  };
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

async function readDailyDigestOpsEvents(cfg, startIso, endIso, limit = 1000) {
  const startMs=Date.parse(startIso || '');
  const endMs=Date.parse(endIso || '');
  const cap=Math.max(1,Math.min(1000,Number(limit || 1000)));
  const fallbackItems=memory.opsEvents.filter(item => {
    const t=Date.parse(item?.created_at || '');
    return Number.isFinite(t)
      && t>=startMs
      && t<endMs
      && item?.source==='telegram'
      && item?.event_type==='daily_digest';
  }).sort((a,b)=>Date.parse(b?.created_at || '')-Date.parse(a?.created_at || '')).slice(0,cap);
  const fallback=()=>({
    persistent:false,
    migrationReady:false,
    items:fallbackItems,
    truncated:fallbackItems.length>=cap,
  });
  if (!hasSupabase(cfg)) return fallback();
  try {
    const url=new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    url.searchParams.set('select','created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
    url.searchParams.set('source','eq.telegram');
    url.searchParams.set('event_type','eq.daily_digest');
    url.searchParams.set('created_at',`gte.${startIso}`);
    url.searchParams.append('created_at',`lt.${endIso}`);
    url.searchParams.set('order','created_at.desc');
    url.searchParams.set('limit',String(cap));
    const r=await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase daily digest reliability');
    if (!r.ok) return fallback();
    const items=await r.json().catch(()=>[]);
    return {
      persistent:true,
      migrationReady:true,
      items:Array.isArray(items)?items:[],
      truncated:Array.isArray(items) && items.length>=cap,
    };
  } catch {
    return fallback();
  }
}


async function readDailyDigestSloEvents(cfg, startIso, endIso, limit = 100) {
  const startMs=Date.parse(startIso || '');
  const endMs=Date.parse(endIso || '');
  const cap=Math.max(1,Math.min(500,Number(limit || 100)));
  const fallbackItems=memory.opsEvents.filter(item => {
    const t=Date.parse(item?.created_at || '');
    return Number.isFinite(t)
      && t>=startMs
      && t<endMs
      && item?.source==='digest_slo'
      && item?.event_type==='reliability_slo';
  }).sort((a,b)=>Date.parse(b?.created_at || '')-Date.parse(a?.created_at || '')).slice(0,cap);
  const fallback=()=>({persistent:false,items:fallbackItems});
  if (!hasSupabase(cfg)) return fallback();
  try {
    const url=new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    url.searchParams.set('select','created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
    url.searchParams.set('source','eq.digest_slo');
    url.searchParams.set('event_type','eq.reliability_slo');
    url.searchParams.set('created_at',`gte.${startIso}`);
    url.searchParams.append('created_at',`lt.${endIso}`);
    url.searchParams.set('order','created_at.desc');
    url.searchParams.set('limit',String(cap));
    const r=await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase daily digest SLO');
    if (!r.ok) return fallback();
    const items=await r.json().catch(()=>[]);
    return {persistent:true,items:Array.isArray(items)?items:[]};
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
      productActions: Number(clientCounts.PRODUCT_ACTION || 0),
      actionErrors: Number(clientCounts.ACTION_ERROR || 0),
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


function productionMonitorState(input = {}) {
  const supabaseOk = Boolean(input.supabaseOk);
  const schemaOk = Boolean(input.schemaOk);
  const schemaStatus = String(input.schemaStatus || (schemaOk ? 'ok' : 'drift'));
  const releaseState = String(input.releaseState || 'healthy');
  const providerHealth = String(input.providerHealth || 'waiting');
  const providerSloState = String(input.providerSloState || 'collecting');
  const dailyDigestSloState = String(input.dailyDigestSloState || 'collecting');
  const telegramDedupeState = String(input.telegramDedupeState || 'healthy');
  const persistent = input.persistent !== false;
  const supabaseAuthFailures = Number(input.supabaseAuthFailures || 0);

  if (!supabaseOk || ['drift','mixed'].includes(schemaStatus) || supabaseAuthFailures > 0 || releaseState === 'incident' || telegramDedupeState === 'incident') {
    return { state: 'incident', label: 'Production требует немедленной проверки' };
  }
  if (
    schemaStatus === 'unavailable'
    || releaseState === 'watch'
    || telegramDedupeState === 'watch'
    || !persistent
    || ['critical','warning'].includes(providerHealth)
    || ['watch','incident'].includes(providerSloState)
    || dailyDigestSloState === 'watch'
  ) {
    return { state: 'watch', label: 'Production работает, но нужен контроль' };
  }
  return { state: 'healthy', label: 'Production monitor не видит блокирующих сигналов' };
}

function productionMonitorSelfTest() {
  const healthy = productionMonitorState({
    supabaseOk: true, schemaOk: true, releaseState: 'healthy', providerHealth: 'ok', telegramDedupeState:'healthy', persistent: true,
  });
  const drift = productionMonitorState({
    supabaseOk: true, schemaOk: false, schemaStatus:'drift', releaseState: 'healthy', providerHealth:'ok', telegramDedupeState:'healthy', persistent:true,
  });
  const schemaUnavailable = productionMonitorState({
    supabaseOk: true, schemaOk: false, schemaStatus:'unavailable', releaseState:'healthy', providerHealth:'ok', telegramDedupeState:'healthy', persistent:true,
  });
  const watch = productionMonitorState({
    supabaseOk: true, schemaOk: true, releaseState: 'healthy', providerHealth: 'ok', telegramDedupeState:'watch', persistent: true,
  });
  const providerSloWatch = productionMonitorState({
    supabaseOk:true, schemaOk:true, releaseState:'healthy', providerHealth:'ok', providerSloState:'incident', telegramDedupeState:'healthy', persistent:true,
  });
  const digestSloWatch = productionMonitorState({
    supabaseOk:true, schemaOk:true, releaseState:'healthy', providerHealth:'ok', providerSloState:'healthy', dailyDigestSloState:'watch', telegramDedupeState:'healthy', persistent:true,
  });
  const telegramIncident = productionMonitorState({
    supabaseOk: true, schemaOk: true, releaseState: 'healthy', providerHealth: 'ok', telegramDedupeState:'incident', persistent: true,
  });
  const authIncident = productionMonitorState({
    supabaseOk: true, schemaOk: true, supabaseAuthFailures:1, releaseState:'healthy', providerHealth:'ok', telegramDedupeState:'healthy', persistent:true,
  });

  const digestRun=(date,time='07:55:00Z')=>({
    created_at:`${date}T${time}`,
    severity:'info',
    source:'telegram',
    event_type:'daily_digest',
    code:'DAILY_DIGEST_RUN_OK',
    metadata:{date,sent:100,claimed:100,remaining:0,failed:0,completionRate:1},
  });
  const digestHealthyAssessment=assessDailyDigestReliabilitySlo([
    digestRun('2026-09-27','07:50:00Z'),
    digestRun('2026-09-28','07:50:00Z'),
    digestRun('2026-09-29','07:55:00Z'),
  ],{nowMs:Date.parse('2026-09-29T08:15:00Z')});
  const digestBeforeCutoff=assessDailyDigestReliabilitySlo([],{nowMs:Date.parse('2026-09-29T08:14:59Z')});
  const digestMissing=assessDailyDigestReliabilitySlo([],{nowMs:Date.parse('2026-09-29T08:15:00Z')});
  const firstWatch=planDailyDigestReliabilitySloEvent(digestMissing,[]);
  const firstWatchRow={
    created_at:'2026-09-29T08:15:00Z',
    severity:firstWatch.severity,
    code:firstWatch.code,
    metadata:firstWatch.meta,
  };
  const repeatedWatch=planDailyDigestReliabilitySloEvent(
    assessDailyDigestReliabilitySlo([],{nowMs:Date.parse('2026-09-29T08:30:00Z')}),
    [firstWatchRow],
  );
  const lateRunAssessment=assessDailyDigestReliabilitySlo([
    digestRun('2026-09-29','08:20:00Z'),
  ],{nowMs:Date.parse('2026-09-29T08:30:00Z')});
  const recovery=planDailyDigestReliabilitySloEvent(lateRunAssessment,[firstWatchRow]);
  const recoveryRow={
    created_at:'2026-09-29T08:30:00Z',
    severity:recovery.severity,
    code:recovery.code,
    metadata:recovery.meta,
  };
  const postRecovery=planDailyDigestReliabilitySloEvent(lateRunAssessment,[firstWatchRow,recoveryRow]);
  const newDayMissing=assessDailyDigestReliabilitySlo([],{nowMs:Date.parse('2026-09-30T08:15:00Z')});
  const newDayWatch=planDailyDigestReliabilitySloEvent(newDayMissing,[firstWatchRow]);

  const digestSloContract={
    healthy:digestHealthyAssessment.state==='healthy',
    cutoff:digestBeforeCutoff.state==='collecting' && digestBeforeCutoff.reason==='before_delivery_window_completion',
    missingRun:digestMissing.state==='watch' && digestMissing.reason==='missing_run' && firstWatch.action==='record',
    repeatedWatchSuppressed:repeatedWatch.action==='none' && repeatedWatch.reason==='watch_episode_already_recorded',
    recovered:recovery.action==='record' && recovery.code==='DAILY_DIGEST_SLO_RECOVERED' && recovery.meta?.reason==='missing_run_recovered',
    recoveryDeduplicated:postRecovery.action==='none',
    newDayReset:newDayWatch.action==='record' && newDayWatch.code==='DAILY_DIGEST_SLO_MISSING_RUN',
  };

  return {
    pass: healthy.state === 'healthy'
      && drift.state === 'incident'
      && schemaUnavailable.state === 'watch'
      && watch.state === 'watch'
      && providerSloWatch.state === 'watch'
      && digestSloWatch.state === 'watch'
      && telegramIncident.state === 'incident'
      && authIncident.state === 'incident'
      && Object.values(digestSloContract).every(Boolean),
    healthy: healthy.state,
    drift: drift.state,
    schemaUnavailable: schemaUnavailable.state,
    watch: watch.state,
    providerSloWatch:providerSloWatch.state,
    digestSloWatch:digestSloWatch.state,
    digestSloContract,
    telegramIncident: telegramIncident.state,
    authIncident: authIncident.state,
  };
}

async function runProductionMonitor(cfg, scheduledAt = new Date(), options = {}) {
  const now = scheduledAt instanceof Date && Number.isFinite(scheduledAt.getTime()) ? scheduledAt : new Date();
  const providerSloFlush = options.record !== false
    ? await flushProviderSloWindow(cfg)
    : { skipped:true, reason:'read_only_monitor' };
  const currentStart = new Date(now.getTime() - 60 * 60_000);
  const historyStart = new Date(now.getTime() - 6 * 60 * 60_000);

  const [
    supabase,
    schemaDrift,
    source,
    telegramWebhook,
    providerSloSource,
    providerAlertSource,
    providerAlertLedger,
    providerAlertContract,
    providerAlertDestinations,
    digestReliabilitySource,
    digestSloSource,
  ] = await Promise.all([
    probeSupabaseConfirmed(cfg),
    probeSupabaseSchemaDriftConfirmed(cfg),
    readOpsEventsRange(cfg, historyStart.toISOString(), now.toISOString(), 1000),
    readTelegramDedupeHealth(cfg,60),
    readProviderSloWindows(cfg,168),
    readProviderIncidentAlertEvents(cfg,168),
    readProviderIncidentAlertDeliveries(cfg,168),
    readProviderIncidentAlertDeliveryContract(cfg),
    providerIncidentAlertDestinations(cfg),
    readDailyDigestOpsEvents(cfg,new Date(now.getTime()-7*24*3600_000).toISOString(),now.toISOString(),1000),
    readDailyDigestSloEvents(cfg,new Date(now.getTime()-30*24*3600_000).toISOString(),now.toISOString(),100),
  ]);

  const activeReleaseIdentity=currentReleaseIdentity(cfg);
  const releaseMetricItems=source.items.filter(item =>
    item?.source !== 'monitor'
    && item?.source !== 'release_regression'
    && item?.source !== 'release_regression_alert'
  );
  const releaseScope=scopeOpsEventsToDeployment(
    releaseMetricItems,
    activeReleaseIdentity,
    {nowMs:now.getTime(),windowMs:60*60_000},
  );
  const releaseItems=releaseScope.actionable;
  const current = summarizeReleaseWindow(releaseItems, 1);
  const releaseHealth = releaseMonitorHealth(current, source.persistent);
  const releaseRegression=postDeployRegressionReport(
    releaseMetricItems,
    activeReleaseIdentity,
    {nowMs:now.getTime(),windowsMinutes:[15,30,60]},
  );
  const releaseRegressionLifecycle=options.record !== false
    ? planPostDeployRegressionLifecycle(releaseRegression,source.items)
    : {action:'none',reason:'read_only_monitor'};
  const releaseRegressionAlertCandidate=options.record !== false
    ? planPostDeployRegressionAlert(source.items,providerAlertLedger.items,{
        deploySha:activeReleaseIdentity.deploySha,
        plannedTransition:releaseRegressionLifecycle,
        destinations:providerAlertDestinations,
        nowMs:now.getTime(),
      })
    : {action:'none',reason:'read_only_monitor'};
  let releaseRegressionLifecyclePersistence=releaseRegressionLifecycle.action === 'record'
    ? 'pending'
    : 'not_required';
  const supabaseAuthFailures = releaseItems.filter(item =>
    /HTTP 401|PGRST303|invalid.*jwt|invalid.*api.?key/i.test(String(item?.message || ''))
  ).length;
  const provider = providerSnapshot();
  const providerSloWindows = Array.isArray(providerSloSource.items) ? providerSloSource.items : [];
  const providerSloRecentWindows = providerSloWindows.filter(item => {
    const endedAt = Date.parse(item?.metadata?.windowEndedAt || item?.created_at || '');
    return Number.isFinite(endedAt) && endedAt >= historyStart.getTime();
  });
  const providerSlo=summarizeProviderObservabilityWindows(
    providerSloRecentWindows,
    {hours:6,includeCurrent:!providerSloSource.distributed},
  );
  const providerSloIncident = buildProviderSloIncidentTimeline(providerSloWindows, { nowMs:now.getTime() });
  const incidentAlertCandidate = options.record !== false
    ? planProviderIncidentAlert(providerSloIncident, providerAlertLedger.items, {
        nowMs:now.getTime(),
        destinations:providerAlertDestinations,
      })
    : { action:'none', reason:'read_only_monitor' };
  const digestIncident = buildDailyDigestIncidentReport(
    source.items.filter(item => item?.source === 'telegram' && item?.event_type === 'daily_digest'),
    { nowMs:now.getTime() },
  );
  const digestReliabilitySlo=assessDailyDigestReliabilitySlo(
    digestReliabilitySource.items,
    {nowMs:now.getTime(),days:7},
  );
  const digestReliabilitySloEvent=options.record !== false
    ? planDailyDigestReliabilitySloEvent(digestReliabilitySlo,digestSloSource.items)
    : {action:'none',reason:'read_only_monitor'};
  const digestAlertCandidate = options.record !== false
    ? planDailyDigestIncidentAlert(digestIncident, providerAlertLedger.items, {
        destinations:providerAlertDestinations,
      })
    : { action:'none', reason:'read_only_monitor' };
  const securityAssessment=assessSecuritySignals(source.items,{nowMs:now.getTime(),windowMinutes:15});
  const securityIncident=securityIncidentTimeline(securityAssessment,source.items,{nowMs:now.getTime()});
  const securityAlertCandidate=options.record !== false
    ? planProviderIncidentAlert(securityIncident,providerAlertLedger.items,{
        nowMs:now.getTime(),
        destinations:providerAlertDestinations,
      })
    : {action:'none',reason:'read_only_monitor'};
  const incidentAlertPersistenceReady = Boolean(providerAlertLedger.persistent && providerAlertContract.ok);
  const releaseRegressionAlertPlan = releaseRegressionAlertCandidate.action === 'send' && !incidentAlertPersistenceReady
    ? {
        ...releaseRegressionAlertCandidate,
        action:'none',
        reason:'persistent_ledger_unavailable',
        blockedCandidate:true,
      }
    : releaseRegressionAlertCandidate;
  const incidentAlertPlan = incidentAlertCandidate.action === 'send' && !incidentAlertPersistenceReady
    ? {
        ...incidentAlertCandidate,
        action:'none',
        reason:'persistent_ledger_unavailable',
        blockedCandidate:true,
      }
    : incidentAlertCandidate;
  const digestAlertPlan = digestAlertCandidate.action === 'send' && !incidentAlertPersistenceReady
    ? {
        ...digestAlertCandidate,
        action:'none',
        reason:'persistent_ledger_unavailable',
        blockedCandidate:true,
      }
    : digestAlertCandidate;
  const securityAlertPlan = securityAlertCandidate.action === 'send' && !incidentAlertPersistenceReady
    ? {
        ...securityAlertCandidate,
        action:'none',
        reason:'persistent_ledger_unavailable',
        blockedCandidate:true,
      }
    : securityAlertCandidate;
  const health = productionMonitorState({
    supabaseOk: supabase.ok,
    schemaOk: schemaDrift.ok,
    schemaStatus: schemaDrift.failureMode || schemaDrift.status,
    supabaseAuthFailures,
    releaseState: releaseHealth.state,
    providerHealth: provider.health,
    providerSloState: providerSloIncident.state,
    dailyDigestSloState:digestReliabilitySlo.state,
    telegramDedupeState: telegramWebhook.state,
    persistent: source.persistent,
  });

  const monitorScope=scopeOpsEventsToDeployment(
    source.items.filter(item => item?.source === 'monitor' && item?.event_type === 'production_monitor'),
    activeReleaseIdentity,
    {nowMs:now.getTime(),windowMs:6*60*60_000},
  );
  const previousMonitor = [...monitorScope.actionable]
    .sort((a,b)=>Date.parse(b?.created_at || '')-Date.parse(a?.created_at || ''))[0] || null;
  const previousState = String(previousMonitor?.metadata?.state || '');
  const previousAt = Date.parse(previousMonitor?.created_at || '');
  const heartbeatDue = !Number.isFinite(previousAt) || now.getTime() - previousAt >= 6 * 60 * 60_000;
  const stateChanged = previousState && previousState !== health.state;

  const value = {
    available: true,
    version: APP_VERSION,
    releaseCandidate: RC_NAME,
    generatedAt: now.toISOString(),
    cadenceMinutes: 15,
    state: health.state,
    label: health.label,
    supabase: {
      ok: Boolean(supabase.ok),
      status: supabase.status || (supabase.ok ? 'ok' : 'unknown'),
      latencyMs: Number(supabase.latencyMs || 0) || null,
      attempts: Number(supabase.attempts || 1),
      recovered: Boolean(supabase.recovered),
      confirmedFailure: Boolean(supabase.confirmedFailure),
      initialStatus: supabase.initialStatus || null,
      initialLatencyMs: Number(supabase.initialLatencyMs || 0) || null,
    },
    schema: {
      ok: Boolean(schemaDrift.ok),
      status: String(schemaDrift.failureMode || schemaDrift.status || (schemaDrift.ok ? 'ok' : 'unavailable')),
      checked: Number(schemaDrift.checked || 0),
      missing: Array.isArray(schemaDrift.missing) ? schemaDrift.missing : [],
      unavailable: Array.isArray(schemaDrift.unavailable) ? schemaDrift.unavailable : [],
      failed: Array.isArray(schemaDrift.failed) ? schemaDrift.failed : [],
      attempts: Number(schemaDrift.attempts || 1),
      recovered: Boolean(schemaDrift.recovered),
      confirmedFailure: Boolean(schemaDrift.confirmedFailure),
      initialMissing: Array.isArray(schemaDrift.initialMissing) ? schemaDrift.initialMissing : [],
      initialUnavailable: Array.isArray(schemaDrift.initialUnavailable) ? schemaDrift.initialUnavailable : [],
      initialFailureMode: String(schemaDrift.initialFailureMode || ''),
    },
    release: {
      state: releaseHealth.state,
      score: Number(releaseHealth.score || 0),
      errors: Number(current.errorLike || 0),
      warnings: Number(current.warningLike || 0),
      deployment:activeReleaseIdentity,
      attribution:{
        deploymentStartedAt:releaseScope.deploymentStartedAt,
        exactEvents:Number(releaseScope.counts.exact || 0),
        unattributedEvents:Number(releaseScope.counts.unattributed || 0),
        excludedPriorDeploymentEvents:Number(releaseScope.counts.priorDeployment || 0),
        attributionComplete:Boolean(releaseScope.attributionComplete),
      },
      regression:{
        ...releaseRegression,
        lifecycle:{
          nextAction:releaseRegressionLifecycle.action === 'record' ? releaseRegressionLifecycle.code : 'none',
          reason:releaseRegressionLifecycle.reason || '',
        },
        alerting:{
          configured:Boolean(cfg.botToken && (cfg.adminTelegramIds || []).length),
          persistent:incidentAlertPersistenceReady,
          nextAction:releaseRegressionAlertPlan.action === 'send' ? releaseRegressionAlertPlan.kind : 'none',
          reason:releaseRegressionAlertPlan.reason || '',
          incidentId:releaseRegressionAlertPlan.incidentId || null,
        },
      },
    },
    provider: {
      health: provider.health || 'waiting',
      plan: provider.plan || 'UNKNOWN',
      cooldownActive: Boolean(provider.cooldownActive),
      slo: providerSlo.overall,
      incident: providerSloIncident,
      alerting:{
        configured:Boolean(cfg.botToken && (cfg.adminTelegramIds || []).length),
        adminRecipients:(cfg.adminTelegramIds || []).length,
        persistent:incidentAlertPersistenceReady,
        contractOk:Boolean(providerAlertContract.ok),
        ledger:providerIncidentAlertLedgerSummary(providerAlertLedger.items),
        nextAction:incidentAlertPlan.action === 'send' ? incidentAlertPlan.kind : 'none',
        reason:incidentAlertPlan.reason || '',
      },
    },
    telegramWebhook,
    dailyDigest:{
      incident:digestIncident,
      reliabilitySlo:digestReliabilitySlo,
      alerting:{
        configured:Boolean(cfg.botToken && (cfg.adminTelegramIds || []).length),
        persistent:incidentAlertPersistenceReady,
        nextAction:digestAlertPlan.action === 'send' ? digestAlertPlan.kind : 'none',
        reason:digestAlertPlan.reason || '',
      },
    },
    security:{
      assessment:securityAssessment,
      incident:securityIncident,
      alerting:{
        configured:Boolean(cfg.botToken && (cfg.adminTelegramIds || []).length),
        persistent:incidentAlertPersistenceReady,
        nextAction:securityAlertPlan.action === 'send' ? securityAlertPlan.kind : 'none',
        reason:securityAlertPlan.reason || '',
      },
    },
    observability: {
      persistent: Boolean(source.persistent && providerSloSource.persistent),
      providerSloFlush,
      providerSloWindowCount:Number(providerSlo.windowCount || 0),
      providerSloHistoryWindows:Number(providerSloWindows.length || 0),
      providerAlertHistoryEvents:Number(providerAlertSource.items?.length || 0),
      providerAlertLedgerRows:Number(providerAlertLedger.items?.length || 0),
      providerAlertLedgerStatus:String(providerAlertLedger.status || ''),
      providerAlertContractStatus:String(providerAlertContract.status || ''),
      dailyDigestReliabilityPersistent:Boolean(digestReliabilitySource.persistent),
      dailyDigestReliabilityEvents:Number(digestReliabilitySource.items?.length || 0),
      dailyDigestSloPersistent:Boolean(digestSloSource.persistent),
      migrationReady:Boolean(source.migrationReady && providerSloSource.migrationReady && providerAlertLedger.persistent && providerAlertContract.ok),
      supabaseAuthFailuresCurrentRelease:supabaseAuthFailures,
      releaseExactEvents:Number(releaseScope.counts.exact || 0),
      releaseUnattributedEvents:Number(releaseScope.counts.unattributed || 0),
      releaseExcludedPriorDeploymentEvents:Number(releaseScope.counts.priorDeployment || 0),
      releaseAttributionComplete:Boolean(releaseScope.attributionComplete),
      postDeployRegressionState:String(releaseRegression.state || 'unavailable'),
      postDeployRegressionCompletedWindows:Number(releaseRegression.completedWindows || 0),
      postDeployRegressionLifecycleAction:releaseRegressionLifecycle.action === 'record' ? String(releaseRegressionLifecycle.code || '') : 'none',
      postDeployRegressionAlertAction:releaseRegressionAlertPlan.action === 'send' ? String(releaseRegressionAlertPlan.kind || '') : 'none',
    },
    policy: {
      consumesFootballApi: false,
      mutatesUserData: false,
      changesRuntimeControls: false,
      autoRollback: false,
      note: 'Монитор только наблюдает и записывает изменение состояния. Автоматический rollback намеренно не выполняется.',
    },
  };
  memory.productionMonitor = { at: Date.now(), value };

  if (options.record !== false && releaseRegressionLifecycle.action === 'record') {
    const lifecycleWrite = await recordOpsEvent(cfg,releaseRegressionLifecycle).catch(() => null);
    releaseRegressionLifecyclePersistence = String(lifecycleWrite?._persistenceStatus || 'failed');
    value.release.regression.lifecycle.persistence = releaseRegressionLifecyclePersistence;
    value.observability.postDeployRegressionLifecyclePersistence = releaseRegressionLifecyclePersistence;
    if (releaseRegressionLifecyclePersistence === 'failed') {
      console.error('POST_DEPLOY_REGRESSION_LIFECYCLE_PERSISTENCE_FAILED');
    }
  }

  const releaseRegressionLifecycleReady = releaseRegressionLifecycle.action !== 'record'
    || releaseRegressionLifecyclePersistence === 'persistent';

  if (
    options.record !== false
    && releaseRegressionAlertCandidate.action === 'send'
    && !releaseRegressionLifecycleReady
  ) {
    value.release.regression.alerting.nextAction='none';
    value.release.regression.alerting.reason='lifecycle_persistence_unconfirmed';
  }

  if (options.record !== false && releaseRegressionAlertPlan.blockedCandidate) {
    await recordOpsEvent(cfg,{
      severity:'error',
      source:'release_regression_alert',
      eventType:'alert_delivery',
      code:'POST_DEPLOY_REGRESSION_ALERT_PERSISTENCE_FAILED',
      message:'Persistent alert delivery claim is unavailable; post-deploy regression alert was suppressed.',
      endpoint:'cron:production-monitor',
      meta:{
        incidentId:releaseRegressionAlertPlan.incidentId || null,
        alertKind:String(releaseRegressionAlertPlan.kind || ''),
        deliveryKey:String(releaseRegressionAlertPlan.alertKey || releaseRegressionAlertPlan.deliveryKey || ''),
        reason:'persistent_ledger_unavailable',
      },
    }).catch(()=>{});
  }

  if (
    options.record !== false
    && releaseRegressionAlertPlan.action === 'send'
    && releaseRegressionLifecycleReady
  ) {
    let delivery;
    try {
      delivery = await deliverOperationalIncidentAlert({
        plan:releaseRegressionAlertPlan,
        text:formatPostDeployRegressionAlert(releaseRegressionAlertPlan),
        adminTelegramIds:cfg.adminTelegramIds || [],
        claimDelivery:input => claimProviderIncidentAlertDelivery(cfg,input),
        beginDelivery:input => beginProviderIncidentAlertDeliverySend(cfg,input),
        finalizeDelivery:input => finalizeProviderIncidentAlertDelivery(cfg,input),
        sendMessage:(chatId,text) => sendTelegramMessage(chatId,text,cfg),
        nowMs:now.getTime(),
      });
    } catch (error) {
      delivery = {
        ok:false,
        outcomes:(releaseRegressionAlertPlan.targetDeliveries || []).map(target => ({
          slot:Number(target?.slot),
          state:'persistence_failure',
          claimAcquired:false,
          reason:redactOpsString(error?.message || error,160),
        })),
        deliveredSlots:[],
        failedSlots:(releaseRegressionAlertPlan.targetDeliveries || []).map(target => Number(target?.slot)),
        recipientCount:(releaseRegressionAlertPlan.targetDeliveries || []).length,
      };
    }
    const releaseAlertEvents=postDeployRegressionAlertOpsEvents(releaseRegressionAlertPlan,delivery);
    await Promise.allSettled(releaseAlertEvents.map(event => recordOpsEvent(cfg,event)));
  }

  if (options.record !== false && securityIncident.transition) {
    const securityLifecycleEvent=securityIncidentOpsEvent(securityIncident.transition);
    if (securityLifecycleEvent) await recordOpsEvent(cfg,securityLifecycleEvent).catch(()=>{});
  }

  if (options.record !== false && securityAlertPlan.blockedCandidate) {
    await recordOpsEvent(cfg,{
      severity:'error',
      source:'security_alert',
      eventType:'alert_delivery',
      code:'SECURITY_INCIDENT_ALERT_PERSISTENCE_FAILED',
      message:'Persistent alert delivery claim is unavailable; security alert was suppressed.',
      endpoint:'cron:production-monitor',
      meta:{
        incidentId:securityAlertPlan.incidentId || null,
        alertKind:String(securityAlertPlan.kind || ''),
        deliveryKey:String(securityAlertPlan.alertKey || securityAlertPlan.deliveryKey || ''),
        reason:'persistent_ledger_unavailable',
      },
    }).catch(()=>{});
  }

  if (options.record !== false && securityAlertPlan.action === 'send') {
    let securityDeliveryResult;
    try {
      securityDeliveryResult=await deliverOperationalIncidentAlert({
        plan:securityAlertPlan,
        text:formatSecurityIncidentAlert(securityAlertPlan),
        adminTelegramIds:cfg.adminTelegramIds || [],
        claimDelivery:input => claimProviderIncidentAlertDelivery(cfg,input),
        beginDelivery:input => beginProviderIncidentAlertDeliverySend(cfg,input),
        finalizeDelivery:input => finalizeProviderIncidentAlertDelivery(cfg,input),
        sendMessage:(chatId,text) => sendTelegramMessage(chatId,text,cfg),
        nowMs:now.getTime(),
      });
    } catch (error) {
      securityDeliveryResult={
        ok:false,
        outcomes:(securityAlertPlan.targetDeliveries || []).map(target => ({
          slot:Number(target?.slot),
          state:'persistence_failure',
          claimAcquired:false,
          reason:redactOpsString(error?.message || error,160),
        })),
      };
    }
    const sent=(securityDeliveryResult.outcomes || []).filter(item => item?.state === 'sent').length;
    const failed=(securityDeliveryResult.outcomes || []).filter(item => !['sent','duplicate'].includes(item?.state)).length;
    await recordOpsEvent(cfg,{
      severity:failed ? 'warning' : 'info',
      source:'security_alert',
      eventType:'alert_delivery',
      code:failed ? 'SECURITY_INCIDENT_ALERT_PARTIAL' : 'SECURITY_INCIDENT_ALERT_SENT',
      message:failed ? 'Security incident alert delivery had failures.' : 'Security incident alert delivery confirmed.',
      endpoint:'cron:production-monitor',
      transitionKey:'security-alert:' + String(securityAlertPlan.alertKey || securityAlertPlan.deliveryKey || ''),
      meta:{
        incidentId:securityAlertPlan.incidentId || null,
        alertKind:String(securityAlertPlan.kind || ''),
        recipientCount:Number(securityDeliveryResult.recipientCount || 0),
        sent,
        failed,
      },
    }).catch(()=>{});
  }

  if (options.record !== false && providerSloFlush?.ok && providerSloIncident.transition) {
    const incidentEvent = providerSloIncidentOpsEvent(providerSloIncident.transition);
    if (incidentEvent) await recordOpsEvent(cfg, incidentEvent).catch(() => {});
  }

  if (options.record !== false && incidentAlertPlan.blockedCandidate) {
    await recordOpsEvent(cfg,{
      severity:'error',
      source:'provider_alert',
      eventType:'alert_delivery',
      code:'PROVIDER_SLO_ALERT_PERSISTENCE_FAILED',
      message:'Persistent alert delivery claim is unavailable; Telegram delivery was suppressed.',
      endpoint:'cron:production-monitor',
      meta:{
        lifecycleEvent:'alert_persistence_failure',
        incidentId:incidentAlertPlan.incidentId || null,
        alertKind:String(incidentAlertPlan.kind || ''),
        deliveryKey:String(incidentAlertPlan.alertKey || incidentAlertPlan.deliveryKey || ''),
        reason:'persistent_ledger_unavailable',
      },
    }).catch(()=>{});
  }

  if (options.record !== false && incidentAlertPlan.action === 'send') {
    let delivery;
    try {
      delivery = await deliverProviderIncidentAlert({
        plan:incidentAlertPlan,
        adminTelegramIds:cfg.adminTelegramIds || [],
        claimDelivery:input => claimProviderIncidentAlertDelivery(cfg,input),
        beginDelivery:input => beginProviderIncidentAlertDeliverySend(cfg,input),
        finalizeDelivery:input => finalizeProviderIncidentAlertDelivery(cfg,input),
        sendMessage:(chatId,text) => sendTelegramMessage(chatId,text,cfg),
        nowMs:now.getTime(),
      });
    } catch (error) {
      delivery = {
        ok:false,
        outcomes:(incidentAlertPlan.targetDeliveries || []).map(target => ({
          slot:Number(target?.slot),
          state:'persistence_failure',
          claimAcquired:false,
          reason:redactOpsString(error?.message || error,160),
        })),
        deliveredSlots:[],
        failedSlots:(incidentAlertPlan.targetDeliveries || []).map(target => Number(target?.slot)),
        recipientCount:(incidentAlertPlan.targetDeliveries || []).length,
      };
    }

    if (
      incidentAlertPlan.kind === 'escalation'
      && (delivery.outcomes || []).some(item => item?.claimAcquired)
    ) {
      const updateEvent = providerSloIncidentUpdateOpsEvent(providerSloIncident.activeIncident,'severity_changed');
      if (updateEvent) await recordOpsEvent(cfg,updateEvent).catch(()=>{});
    }

    const alertEvents = providerIncidentAlertOpsEvents(incidentAlertPlan,delivery);
    await Promise.allSettled(alertEvents.map(event => recordOpsEvent(cfg,event)));
  }


  if (options.record !== false && digestAlertPlan.blockedCandidate) {
    await recordOpsEvent(cfg,{
      severity:'error',
      source:'digest_alert',
      eventType:'alert_delivery',
      code:'DAILY_DIGEST_INCIDENT_ALERT_PERSISTENCE_FAILED',
      message:'Persistent alert delivery claim is unavailable; daily digest admin alert was suppressed.',
      endpoint:'cron:production-monitor',
      meta:{
        incidentId:digestAlertPlan.incidentId || null,
        alertKind:String(digestAlertPlan.kind || ''),
        deliveryKey:String(digestAlertPlan.alertKey || digestAlertPlan.deliveryKey || ''),
        reason:'persistent_ledger_unavailable',
      },
    }).catch(()=>{});
  }

  if (options.record !== false && digestAlertPlan.action === 'send') {
    let digestDelivery;
    try {
      digestDelivery = await deliverOperationalIncidentAlert({
        plan:digestAlertPlan,
        text:formatDailyDigestIncidentAlert(digestAlertPlan),
        adminTelegramIds:cfg.adminTelegramIds || [],
        claimDelivery:input => claimProviderIncidentAlertDelivery(cfg,input),
        beginDelivery:input => beginProviderIncidentAlertDeliverySend(cfg,input),
        finalizeDelivery:input => finalizeProviderIncidentAlertDelivery(cfg,input),
        sendMessage:(chatId,text) => sendTelegramMessage(chatId,text,cfg),
        nowMs:now.getTime(),
      });
    } catch (error) {
      digestDelivery = {
        ok:false,
        outcomes:(digestAlertPlan.targetDeliveries || []).map(target => ({
          slot:Number(target?.slot),
          state:'persistence_failure',
          claimAcquired:false,
          reason:redactOpsString(error?.message || error,160),
          attempts:0,
        })),
        deliveredSlots:[],
        failedSlots:(digestAlertPlan.targetDeliveries || []).map(target => Number(target?.slot)),
        recipientCount:(digestAlertPlan.targetDeliveries || []).length,
      };
    }

    const firstClaims=(digestDelivery.outcomes || []).filter(item => item?.claimAcquired && Number(item?.attempts || 0) === 1);
    if (firstClaims.length) {
      await recordOpsEvent(cfg,{
        severity:digestAlertPlan.kind === 'recovery' ? 'info' : 'warning',
        source:'telegram',
        eventType:'daily_digest_incident',
        code:digestAlertPlan.kind === 'recovery' ? 'DAILY_DIGEST_INCIDENT_RECOVERED' : 'DAILY_DIGEST_INCIDENT_OPENED',
        message:digestAlertPlan.kind === 'recovery'
          ? 'Daily digest operational incident recovered.'
          : 'Daily digest operational incident opened from backlog/stuck-delivery health thresholds.',
        endpoint:'cron:production-monitor',
        meta:{
          incidentId:digestAlertPlan.incidentId || null,
          date:digestAlertPlan.incident?.date || null,
          alertKind:digestAlertPlan.kind,
          diagnostics:digestAlertPlan.incident?.diagnostics || {},
        },
      }).catch(()=>{});
    }

    const digestAlertEvents=dailyDigestIncidentAlertOpsEvents(digestAlertPlan,digestDelivery);
    await Promise.allSettled(digestAlertEvents.map(event => recordOpsEvent(cfg,event)));
  }

  if (options.record !== false && digestReliabilitySloEvent.action === 'record') {
    await recordOpsEvent(cfg,digestReliabilitySloEvent).catch(()=>{});
  }

  if (options.record !== false && schemaDrift.recovered) {
    await recordOpsEvent(cfg, {
      severity:'warning',
      source:'monitor',
      eventType:'schema_probe',
      code:'SCHEMA_PROBE_RECOVERED',
      message:'Initial Supabase schema probe failed but the confirmation probe succeeded.',
      endpoint:'cron:production-monitor',
      meta:{
        attempts:Number(schemaDrift.attempts || 2),
        initialFailureMode:String(schemaDrift.initialFailureMode || ''),
        finalFailureMode:String(schemaDrift.failureMode || schemaDrift.status || ''),
        initialMissing:Array.isArray(schemaDrift.initialMissing) ? schemaDrift.initialMissing : [],
        initialUnavailable:Array.isArray(schemaDrift.initialUnavailable) ? schemaDrift.initialUnavailable : [],
        finalMissing:Array.isArray(schemaDrift.missing) ? schemaDrift.missing : [],
        finalUnavailable:Array.isArray(schemaDrift.unavailable) ? schemaDrift.unavailable : [],
      },
    }).catch(()=>{});
  }

  if (options.record !== false && supabase.recovered) {
    await recordOpsEvent(cfg, {
      severity:'warning',
      source:'monitor',
      eventType:'supabase_probe',
      code:'SUPABASE_PROBE_RECOVERED',
      message:'Initial Supabase probe failed but the confirmation probe succeeded.',
      endpoint:'cron:production-monitor',
      meta:{
        initialStatus:supabase.initialStatus || 'unknown',
        attempts:Number(supabase.attempts || 2),
        finalLatencyMs:Number(supabase.latencyMs || 0) || null,
      },
    }).catch(()=>{});
  }

  if (options.record !== false && (!previousState || stateChanged || heartbeatDue)) {
    const recovered = previousState && previousState !== 'healthy' && health.state === 'healthy';
    const severity = health.state === 'incident' ? 'critical' : health.state === 'watch' ? 'warning' : 'info';
    const code = recovered
      ? 'PRODUCTION_MONITOR_RECOVERED'
      : health.state === 'incident'
        ? 'PRODUCTION_MONITOR_INCIDENT'
        : health.state === 'watch'
          ? 'PRODUCTION_MONITOR_WATCH'
          : 'PRODUCTION_MONITOR_HEALTHY';
    await recordOpsEvent(cfg, {
      severity,
      source: 'monitor',
      eventType: 'production_monitor',
      code,
      message: recovered ? 'Production monitor returned to healthy state.' : health.label,
      endpoint: 'cron:production-monitor',
      meta: {
        state: health.state,
        previousState: previousState || null,
        supabaseOk: Boolean(supabase.ok),
        supabaseProbeAttempts: Number(supabase.attempts || 1),
        supabaseProbeRecovered: Boolean(supabase.recovered),
        supabaseProbeConfirmedFailure: Boolean(supabase.confirmedFailure),
        schemaOk: Boolean(schemaDrift.ok),
        schemaFailureMode: String(schemaDrift.failureMode || schemaDrift.status || ''),
        schemaProbeAttempts: Number(schemaDrift.attempts || 1),
        schemaProbeRecovered: Boolean(schemaDrift.recovered),
        schemaProbeConfirmedFailure: Boolean(schemaDrift.confirmedFailure),
        schemaInitialMissing: Array.isArray(schemaDrift.initialMissing) ? schemaDrift.initialMissing : [],
        schemaInitialUnavailable: Array.isArray(schemaDrift.initialUnavailable) ? schemaDrift.initialUnavailable : [],
        schemaMissing: Array.isArray(schemaDrift.missing) ? schemaDrift.missing : [],
        schemaUnavailable: Array.isArray(schemaDrift.unavailable) ? schemaDrift.unavailable : [],
        supabaseAuthFailuresCurrentRelease: supabaseAuthFailures,
        releaseState: releaseHealth.state,
        releaseScore: Number(releaseHealth.score || 0),
        releaseExactEvents:Number(releaseScope.counts.exact || 0),
        releaseUnattributedEvents:Number(releaseScope.counts.unattributed || 0),
        releaseExcludedPriorDeploymentEvents:Number(releaseScope.counts.priorDeployment || 0),
        releaseAttributionComplete:Boolean(releaseScope.attributionComplete),
        postDeployRegressionState:String(releaseRegression.state || 'unavailable'),
        postDeployRegressionCompletedWindows:Number(releaseRegression.completedWindows || 0),
        providerHealth: provider.health || 'waiting',
        providerSloState: providerSloIncident.state,
        providerSloActive: Boolean(providerSloIncident.activeIncident),
        dailyDigestSloState:digestReliabilitySlo.state,
        dailyDigestSloCode:digestReliabilitySlo.code,
        telegramDedupeState: telegramWebhook.state,
        telegramStaleClaims: Number(telegramWebhook.staleProcessing || 0),
        telegramFailedClaims: Number(telegramWebhook.failedCurrent || 0),
      },
    }).catch(() => {});
  }

  return value;
}


async function apiPostDeployRegressionResponse(request,cfg,user) {
  if (request.method!=='POST') return json({error:'Метод не поддерживается.'},405);
  if (!hasSupabase(cfg)) return json({error:'Supabase не настроен.'},503);

  let body={};
  try { body=await request.json(); } catch {}
  const targetState=String(body?.state || '');
  const identity=currentReleaseIdentity(cfg);
  const deploySha=String(identity?.deploySha || '').toLowerCase();
  if (!deploySha) return json({error:'Active deployment identity временно недоступен.'},503);
  if (body?.deploySha && String(body.deploySha).toLowerCase()!==deploySha) {
    return json({error:'Deployment уже изменился. Обновите Release Monitor.'},409);
  }

  const now=new Date();
  const since=new Date(now.getTime()-7*24*3600_000);
  const source=await readOpsEventsRange(cfg,since.toISOString(),now.toISOString(),1000);
  if (!source.persistent) return json({error:'Persistent ops history временно недоступна.'},503);
  if (source.truncated) return json({error:'Ops history усечена; переход не сохранён для безопасности.'},503);

  const plan=planPostDeployRegressionResponseTransition(source.items,deploySha,targetState);
  if (plan.action!=='record') {
    if (plan.reason==='already_recorded') return json({ok:true,alreadyRecorded:true,status:plan.status});
    return json({error:'Переход состояния инцидента сейчас недоступен.',reason:plan.reason,status:plan.status},409);
  }

  const written=await recordOpsEvent(cfg,plan).catch(()=>null);
  if (!written || String(written?._persistenceStatus || '')!=='persistent') {
    return json({error:'Не удалось сохранить состояние инцидента.'},503);
  }

  memory.releaseMonitor=null;
  const status=summarizePostDeployRegressionResponse([...source.items,written],deploySha);
  return json({
    ok:true,
    incidentId:status.incidentId,
    state:status.state,
    lifecycleState:status.lifecycleState,
    status,
  });
}

async function apiReleaseMonitor(request, cfg) {
  const url = new URL(request.url);
  const hours = Math.max(1, Math.min(168, Number(url.searchParams.get('hours') || 24)));
  const digestDays = Number(url.searchParams.get('digestDays') || 7) >= 30 ? 30 : 7;
  const force = url.searchParams.get('refresh') === '1';
  const cacheKey = `h${hours}:d${digestDays}`;
  const cached = memory.releaseMonitor?.[cacheKey];
  if (!force && cached?.value && Date.now() - Number(cached.at || 0) < 30000) {
    return json({ ...cached.value, cached: true });
  }

  const end = new Date();
  const currentStart = new Date(end.getTime() - hours * 3600_000);
  const previousStart = new Date(currentStart.getTime() - hours * 3600_000);
  const digestStart = new Date(end.getTime() - digestDays * 24 * 3600_000);
  const [source,digestAlertLedger,digestHistory] = await Promise.all([
    readOpsEventsRange(cfg, previousStart.toISOString(), end.toISOString(), 1000),
    readProviderIncidentAlertDeliveries(cfg,336),
    readDailyDigestOpsEvents(cfg,digestStart.toISOString(),end.toISOString(),1000),
  ]);
  const currentItems = source.items.filter(x => Date.parse(x.created_at || '') >= currentStart.getTime());
  const activeDeploySha=String(currentReleaseIdentity(cfg)?.deploySha || '').toLowerCase();
  const postDeployRegressionResponse=summarizePostDeployRegressionResponse(source.items,activeDeploySha);
  const postDeployRegressionTimeline=source.items
    .filter(x => ['release_regression','release_regression_alert','release_regression_response'].includes(String(x?.source || '')))
    .filter(x => String(x?.metadata?.deploySha || '').toLowerCase()===activeDeploySha)
    .sort((a,b)=>Date.parse(b?.created_at || '')-Date.parse(a?.created_at || ''))
    .slice(0,30)
    .map(x=>({
      createdAt:x.created_at,
      severity:String(x.severity || 'info'),
      source:String(x.source || ''),
      code:String(x.code || x.event_type || ''),
      lifecycleState:String(x?.metadata?.lifecycleState || ''),
      responseState:String(x?.metadata?.responseState || ''),
      message:redactOpsString(x.message || '',180),
    }));
  const postDeployRegressionSlo=buildPostDeployRegressionSloDashboard(source.items,{
    activeDeploySha,
    asOfMs:end.getTime(),
    limit:20,
  });
  const previousItems = source.items.filter(x => {
    const t = Date.parse(x.created_at || '');
    return Number.isFinite(t) && t >= previousStart.getTime() && t < currentStart.getTime();
  });
  const current = summarizeReleaseWindow(currentItems, hours);
  const previous = summarizeReleaseWindow(previousItems, hours);
  const health = releaseMonitorHealth(current, source.persistent);
  const digestEvents=digestHistory.items;
  const dailyDigest={
    ...summarizeDailyDigestOperationalStatus(
      digestEvents,
      digestAlertLedger.items,
      {nowMs:end.getTime()},
    ),
    reliability:summarizeDailyDigestReliability(
      digestEvents,
      {days:digestDays,nowMs:end.getTime()},
    ),
    reliabilitySlo:assessDailyDigestReliabilitySlo(
      digestEvents,
      {days:7,nowMs:end.getTime()},
    ),
    historyPersistent:Boolean(digestHistory.persistent),
    historyTruncated:Boolean(digestHistory.truncated),
  };
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
    digestDays,
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
    postDeployRegression:{
      response:postDeployRegressionResponse,
      slo:postDeployRegressionSlo,
      timeline:postDeployRegressionTimeline,
    },
    dailyDigest,
    runtime: telemetrySnapshot(),
    policy: {
      noFootballApiCalls: true,
      noUserDataMutation: true,
      telemetryPrivacy: 'Телеметрия клиента ограничена разрешёнными полями и не содержит свободный текст чата или пользовательский контент.',
      note: 'Операционный бюджет считает сохранённые ошибки и критические события; это сигнал для выпуска, а не формальный показатель доступности.',
    },
  };
  memory.releaseMonitor ||= {};
  memory.releaseMonitor[cacheKey] = { at: Date.now(), value };
  return json(value);
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


async function probeTableColumns(cfg, table, columns = []) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', columns.join(','));
    url.searchParams.set('limit', '1');
    const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, `Supabase schema probe ${table}`);
    return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
  } catch (error) {
    return { ok: false, status: 'network_error', detail: redactOpsString(error?.message || error, 120) };
  }
}

function summarizeSupabaseSchemaChecks(checks = []) {
  const normalized = (checks || []).map(item => ({
    id: String(item?.id || ''),
    table: String(item?.table || ''),
    columns: Array.isArray(item?.columns) ? item.columns.map(String) : [],
    ok: Boolean(item?.ok),
    status: String(item?.status || (item?.ok ? 'ok' : 'unknown')),
  }));
  const missing = normalized.filter(item => !item.ok).map(item => item.id);
  return {
    ok: missing.length === 0,
    status: missing.length === 0 ? 'ok' : 'drift',
    checked: normalized.length,
    missing,
    checks: normalized,
  };
}

async function readSupabaseSchemaFingerprint(cfg) {
  if (!hasSupabase(cfg)) return { ok:false, status:'not_configured', fingerprint:'', expected:EXPECTED_SCHEMA_FINGERPRINT };
  try {
    const raw=await supaRpc(cfg,'backend_schema_fingerprint',{},4000);
    const fingerprint=String(raw?.fingerprint || '');
    return {
      ok:Boolean(raw?.ok) && fingerprint===EXPECTED_SCHEMA_FINGERPRINT,
      status:fingerprint===EXPECTED_SCHEMA_FINGERPRINT ? 'ok' : 'fingerprint_mismatch',
      fingerprint,
      expected:EXPECTED_SCHEMA_FINGERPRINT,
      parts:Number(raw?.parts || 0),
      checkedAt:raw?.checked_at || null,
    };
  } catch (error) {
    return {ok:false,status:error?.code || 'error',fingerprint:'',expected:EXPECTED_SCHEMA_FINGERPRINT,detail:redactOpsString(error?.message || error,160)};
  }
}

async function readPersonalWriteGuardContract(cfg) {
  if (!hasSupabase(cfg)) return { ok:false, status:'not_configured' };
  try {
    const raw = await supaRpc(cfg, 'personal_write_guard_contract', {}, 3000);
    const ok = Boolean(raw?.ok)
      && Number(raw?.favoritesLimit || 0) === PERSONAL_WRITE_LIMITS.favorites
      && Number(raw?.favoritePlayersLimit || 0) === PERSONAL_WRITE_LIMITS.favoritePlayers
      && Number(raw?.remindersLimit || 0) === PERSONAL_WRITE_LIMITS.reminders;
    return {
      ok,
      status: ok ? 'ok' : 'contract_mismatch',
      version: String(raw?.version || ''),
      favoritesLimit: Number(raw?.favoritesLimit || 0),
      favoritePlayersLimit: Number(raw?.favoritePlayersLimit || 0),
      remindersLimit: Number(raw?.remindersLimit || 0),
    };
  } catch (error) {
    return { ok:false, status:error?.code || 'error', detail:redactOpsString(error?.message || error,160) };
  }
}

function schemaProbeStatusKind(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized || normalized === 'ok') return 'ok';

  const driftStatuses = new Set([
    'fingerprint_mismatch',
    'contract_mismatch',
    'http_400',
    'http_404',
    'pgrst202',
    '42883',
    '42703',
    '42p01',
  ]);
  if (driftStatuses.has(normalized)) return 'drift';

  if (
    normalized === 'not_configured'
    || normalized === 'network_error'
    || normalized === 'error'
    || normalized === 'timeout'
    || normalized === 'aborterror'
    || ['http_401','http_403','http_408','http_425','http_429'].includes(normalized)
    || /^http_5\d\d$/.test(normalized)
    || /timeout|network|temporar|unavailable|fetch|abort/.test(normalized)
  ) return 'unavailable';

  // Unknown probe failures must fail the release gate, but should not be
  // misreported as proven schema loss in production monitoring.
  return 'unavailable';
}

function classifySupabaseSchemaProbeFailures(checks = [], fingerprint = {}, personalWriteGuards = {}) {
  const failures = [];
  for (const item of checks || []) {
    if (!item?.ok) failures.push({ id: String(item?.id || 'schema_check'), status: String(item?.status || 'error') });
  }
  if (!fingerprint?.ok) failures.push({ id: 'schema_fingerprint', status: String(fingerprint?.status || 'error') });
  if (!personalWriteGuards?.ok) failures.push({ id: 'personal_write_guards', status: String(personalWriteGuards?.status || 'error') });

  const drift = [];
  const unavailable = [];
  for (const failure of failures) {
    if (schemaProbeStatusKind(failure.status) === 'drift') drift.push(failure.id);
    else unavailable.push(failure.id);
  }

  const uniqueDrift = [...new Set(drift)];
  const uniqueUnavailable = [...new Set(unavailable)];
  const failed = [...new Set(failures.map(item => item.id))];
  const failureMode = uniqueDrift.length && uniqueUnavailable.length
    ? 'mixed'
    : uniqueDrift.length
      ? 'drift'
      : uniqueUnavailable.length
        ? 'unavailable'
        : 'ok';

  return { failureMode, drift: uniqueDrift, unavailable: uniqueUnavailable, failed };
}

async function probeSupabaseSchemaDrift(cfg) {
  const specs = [
    { id: 'users_acquisition', table: 'users', columns: ['telegram_id','acquisition_source','acquisition_campaign','acquisition_content'] },
    { id: 'analysis_history_ai', table: 'analysis_history', columns: ['telegram_id','fixture_id','ai_signal_code','analysis_version'] },
    { id: 'favorite_players', table: 'favorite_players', columns: ['telegram_id','player_id','player_name','team_id','created_at'] },
    { id: 'smart_notification_preferences', table: 'user_preferences', columns: ['telegram_id','notification_preferences','updated_at'] },
    { id: 'smart_notification_deliveries', table: 'smart_notification_deliveries', columns: ['telegram_id','fixture_id','event_type','category','dedupe_key','status','attempts','claimed_at','sent_at','retry_at'] },
    { id: 'user_entitlements', table: 'user_entitlements', columns: ['id','telegram_id','entitlement_type','fixture_id','starts_at','expires_at','usage_limit','usage_count','payment_charge_id','status'] },
    { id: 'calibration_transitions', table: 'model_calibration_transitions', columns: ['id','action','resulting_revision','created_at'] },
    { id: 'digest_subscriptions', table: 'bot_digest_subscriptions', columns: ['telegram_id','enabled','hour_utc','delivery_claim_date','delivery_locked_until'] },
    { id: 'referee_history', table: 'referee_match_history', columns: ['fixture_id','referee_key','yellow_cards'] },
    { id: 'growth_events', table: 'growth_events', columns: ['id','event_name','metadata','created_at'] },
    { id: 'telegram_update_claims', table: 'telegram_update_claims', columns: ['update_key','status','locked_until','expires_at','duplicate_count','last_duplicate_at'] },
    { id: 'provider_rate_windows', table: 'provider_rate_windows', columns: ['bucket_key','window_started_at','request_count','updated_at'] },
    { id: 'scheduled_job_leases', table: 'scheduled_job_leases', columns: ['job_key','group_key','status','lease_token','scheduled_at','claimed_at','locked_until','completed_at','expires_at'] },
    { id: 'cache_provenance', table: 'analysis_cache', columns: ['cache_key','provider','source_updated_at','freshness_status','updated_at'] },
    { id: 'odds_provenance', table: 'odds_snapshots', columns: ['fixture_id','provider','bookmaker_count','source_updated_at'] },
    { id: 'model_provenance', table: 'model_predictions', columns: ['fixture_id','data_provenance','model_inputs_version'] },
    { id: 'ai_timeline_snapshots', table: 'analysis_timeline_snapshots', columns: ['snapshot_key','fixture_id','captured_at','home_prob','draw_prob','away_prob','causal_relation','provenance'] },
    { id:'provider_incident_alert_delivery', table:'provider_incident_alert_deliveries', columns:['incident_id','transition','alert_key','destination_key','status','attempts','retry_at','unknown_at'] },
  ];
  const [tableChecks,fingerprint,personalWriteGuards,providerIncidentAlertDeliveryContract] = await Promise.all([
    Promise.all(specs.map(async spec => ({ ...spec, ...(await probeTableColumns(cfg, spec.table, spec.columns)) }))),
    readSupabaseSchemaFingerprint(cfg),
    readPersonalWriteGuardContract(cfg),
    readProviderIncidentAlertDeliveryContract(cfg),
  ]);
  const checks=[
    ...tableChecks,
    {
      id:'provider_incident_alert_delivery_contract',
      table:'rpc',
      columns:[],
      ok:Boolean(providerIncidentAlertDeliveryContract.ok),
      status:String(providerIncidentAlertDeliveryContract.status || 'error'),
    },
  ];
  const summary=summarizeSupabaseSchemaChecks(checks);
  // Preserve the historical fail-closed dependency list for release-contract
  // regression tests while exposing a more precise drift/unavailable split.
  const missing=[...(summary.missing || [])];
  if (!fingerprint.ok) missing.push('schema_fingerprint');
  if (!personalWriteGuards.ok) missing.push('personal_write_guards');
  const classification=classifySupabaseSchemaProbeFailures(checks,fingerprint,personalWriteGuards);
  const ok = Boolean(summary.ok && fingerprint.ok && personalWriteGuards.ok);
  return {
    ...summary,
    ok,
    status:ok ? 'ok' : classification.failureMode,
    failureMode:ok ? 'ok' : classification.failureMode,
    missing:classification.drift,
    unavailable:classification.unavailable,
    failed:[...new Set(missing)],
    fingerprint,
    personalWriteGuards,
    providerIncidentAlertDeliveryContract,
  };
}


function combineSupabaseSchemaProbeAttempts(first = {}, second = null) {
  const firstOk = Boolean(first?.ok);
  const initialMissing = Array.isArray(first?.missing) ? first.missing.map(String) : [];
  const initialUnavailable = Array.isArray(first?.unavailable) ? first.unavailable.map(String) : [];
  const initialFailureMode = String(first?.failureMode || first?.status || (firstOk ? 'ok' : 'unavailable'));
  if (firstOk) {
    return {
      ...first,
      attempts: 1,
      recovered: false,
      confirmedFailure: false,
      initialMissing,
      initialUnavailable,
      initialFailureMode,
    };
  }

  if (second && second.ok) {
    return {
      ...second,
      attempts: 2,
      recovered: true,
      confirmedFailure: false,
      initialMissing,
      initialUnavailable,
      initialFailureMode,
    };
  }

  const final = second || first;
  return {
    ...final,
    attempts: second ? 2 : 1,
    recovered: false,
    confirmedFailure: true,
    initialMissing,
    initialUnavailable,
    initialFailureMode,
  };
}

async function probeSupabaseSchemaDriftConfirmed(cfg, options = {}) {
  const first = await probeSupabaseSchemaDrift(cfg);
  if (first.ok || !hasSupabase(cfg)) return combineSupabaseSchemaProbeAttempts(first);

  const retryDelayMs = Math.max(0, Math.min(1500, Number(options.retryDelayMs ?? 250)));
  if (retryDelayMs) await sleepMs(retryDelayMs);

  const second = await probeSupabaseSchemaDrift(cfg);
  const combined = combineSupabaseSchemaProbeAttempts(first, second);
  if (combined.recovered) bumpTelemetry('supabaseSchemaProbeRecoveries');
  if (combined.confirmedFailure) bumpTelemetry('supabaseSchemaProbeConfirmedFailures');
  return combined;
}

function supabaseSchemaProbeConfirmationSelfTest() {
  const direct = combineSupabaseSchemaProbeAttempts({
    ok: true, status: 'ok', checked: 7, missing: [],
  });
  const recovered = combineSupabaseSchemaProbeAttempts(
    { ok: false, status: 'drift', checked: 7, missing: ['growth_events'] },
    { ok: true, status: 'ok', checked: 7, missing: [] }
  );
  const confirmed = combineSupabaseSchemaProbeAttempts(
    { ok: false, status: 'drift', failureMode: 'drift', checked: 7, missing: ['growth_events'], unavailable: [] },
    { ok: false, status: 'drift', failureMode: 'drift', checked: 7, missing: ['growth_events'], unavailable: [] }
  );
  const unavailable = combineSupabaseSchemaProbeAttempts(
    { ok: false, status: 'unavailable', failureMode: 'unavailable', checked: 7, missing: [], unavailable: ['growth_events'] },
    { ok: false, status: 'unavailable', failureMode: 'unavailable', checked: 7, missing: [], unavailable: ['growth_events'] }
  );
  return {
    pass: direct.ok && direct.attempts === 1
      && recovered.ok && recovered.attempts === 2 && recovered.recovered && !recovered.confirmedFailure
      && !confirmed.ok && confirmed.attempts === 2 && confirmed.confirmedFailure && confirmed.failureMode === 'drift'
      && !unavailable.ok && unavailable.confirmedFailure && unavailable.failureMode === 'unavailable',
    direct: direct.ok,
    recovered: recovered.recovered,
    confirmedFailure: confirmed.confirmedFailure,
    unavailableFailure: unavailable.failureMode,
  };
}

function supabaseSchemaDriftSelfTest() {
  const healthy = summarizeSupabaseSchemaChecks([
    { id: 'users_acquisition', table: 'users', columns: ['acquisition_source'], ok: true, status: 'ok' },
    { id: 'growth_events', table: 'growth_events', columns: ['event_name'], ok: true, status: 'ok' },
    { id: 'telegram_update_claims', table: 'telegram_update_claims', columns: ['status'], ok: true, status: 'ok' },
  ]);
  const drift = summarizeSupabaseSchemaChecks([
    { id: 'users_acquisition', table: 'users', columns: ['acquisition_source'], ok: true, status: 'ok' },
    { id: 'growth_events', table: 'growth_events', columns: ['event_name'], ok: true, status: 'ok' },
    { id: 'telegram_update_claims', table: 'telegram_update_claims', columns: ['status'], ok: false, status: 'http_400' },
  ]);
  return {
    pass: healthy.ok && !drift.ok && drift.status === 'drift' && drift.missing.length === 1 && drift.missing[0] === 'telegram_update_claims',
    healthy: healthy.ok,
    missing: drift.missing,
  };
}

function releaseCheck(id, label, state, detail, blocking = false) {
  return { id, label, state, detail, blocking: Boolean(blocking) };
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
  const finalitySelfTest = settlementFinalitySelfTest();
  const adjudicationSelfTest = settlementDriftAdjudicationSelfTest();
  const trustedGateSelfTest = trustedMetricsGateSelfTest();

  const safety = productionSafetySnapshot();
  const providerBudget = providerBudgetProfile();
  const paidProvider = providerTransitionProfile().paid;
  const lastE2E = await loadLastProviderE2E(cfg);

  const checks = [
    productionCheck('settlement_run_ledger_selftest', 'Самопроверка журнала запусков', runLedgerSelfTest.pass ? 'pass' : 'fail',
      runLedgerSelfTest.pass
        ? `fresh=${runLedgerSelfTest.fresh}; retry=${runLedgerSelfTest.retry}; exhausted=${runLedgerSelfTest.exhausted}; differentBatch=${runLedgerSelfTest.differentBatch}.`
        : 'Самопроверка журнала запусков фиксации результатов не прошла.', true),
    productionCheck('settlement_finality_selftest', 'Самопроверка подтверждения результата', finalitySelfTest.pass ? 'pass' : 'fail',
      finalitySelfTest.pass
        ? `verified=${finalitySelfTest.verified}; scoreDrift=${finalitySelfTest.scoreDrift}; statusDrift=${finalitySelfTest.statusDrift}; wait=${finalitySelfTest.wait}.`
        : 'Самопроверка окончательности результата не прошла.', true),
    productionCheck('settlement_adjudication_selftest', 'Самопроверка разбора расхождений', adjudicationSelfTest.pass ? 'pass' : 'fail',
      adjudicationSelfTest.pass
        ? `keep=${adjudicationSelfTest.keep}; accept=${adjudicationSelfTest.accept}; void=${adjudicationSelfTest.void}; unsafeBlocked=${adjudicationSelfTest.unsafeAcceptBlocked}.`
        : 'Самопроверка ручного разбора результатов не прошла.', true),
    productionCheck('trusted_metrics_gate_selftest', 'Самопроверка доверенных метрик', trustedGateSelfTest.pass ? 'pass' : 'fail',
      trustedGateSelfTest.pass
        ? `confirmed=${trustedGateSelfTest.confirmed}; adjudicated=${trustedGateSelfTest.adjudicated}; verifiedBlocked=${trustedGateSelfTest.verifiedBlocked}; unverifiedBlocked=${trustedGateSelfTest.unverifiedBlocked}; driftBlocked=${trustedGateSelfTest.driftBlocked}; voidBlocked=${trustedGateSelfTest.voidBlocked}.`
        : 'Самопроверка допуска доверенных метрик не прошла.', true),
    productionCheck('supabase', 'Supabase отвечает', diagnostics.supabase?.ok ? 'pass' : 'fail',
      diagnostics.supabase?.ok
        ? `${Number(diagnostics.supabase?.latencyMs || 0)} мс · attempts=${Number(diagnostics.supabase?.attempts || 1)}${diagnostics.supabase?.recovered ? ' · transient recovered' : ''}.`
        : `${diagnostics.supabase?.status || 'offline'} · attempts=${Number(diagnostics.supabase?.attempts || 1)}.`, true),
    productionCheck('supabase_probe_confirmation', 'Supabase Probe Confirmation Guard',
      supabaseProbeConfirmationSelfTest().pass ? 'pass' : 'fail',
      'Первичный сбой становится блокирующим только после подтверждающего запроса; повтор выполняется только при ошибке.', true),
    productionCheck('supabase_schema_probe_confirmation', 'Schema Probe Confirmation Guard',
      supabaseSchemaProbeConfirmationSelfTest().pass ? 'pass' : 'fail',
      'Schema drift становится блокирующим только после второго неуспешного probe; transient recovery сохраняется как warning.', true),
    productionCheck('singleflight', 'Объединение одинаковых серверных запросов', singleflightTest.pass ? 'pass' : 'fail',
      singleflightTest.pass ? `${singleflightTest.callers} параллельных вызовов → ${singleflightTest.executions} выполнение.` : 'Объединение параллельных запросов не прошло самопроверку.', true),
    productionCheck('distributed_analysis_lock', 'Cross-instance защита AI', distributedAnalysisLockDrill().pass ? 'pass' : 'fail',
      `TTL ${distributedAnalysisLockPolicy().ttlSeconds} сек. · ожидание до ${Math.round(distributedAnalysisLockPolicy().maxWaitMs/1000)} сек. · fail-open при недоступности lock storage.`, true),
    productionCheck('burst_guard', 'Burst Guard', ROUTE_BURST_POLICIES.length >= 6 ? 'pass' : 'fail',
      `${ROUTE_BURST_POLICIES.length} политик для дорогих маршрутов; блокировок в экземпляре: ${Number(memory.telemetry?.burstBlocks || 0)}.`, true),
    productionCheck('telegram_dedupe_observability', 'Persistent Telegram dedupe',
      !diagnostics.telegramWebhook?.available ? 'fail' : diagnostics.telegramWebhook?.state === 'incident' ? 'fail' : diagnostics.telegramWebhook?.state === 'watch' ? 'warn' : 'pass',
      diagnostics.telegramWebhook?.available
        ? `claims=${Number(diagnostics.telegramWebhook.claimsRecent || 0)} · duplicates=${Number(diagnostics.telegramWebhook.duplicateAttemptsRetained || 0)} · stale=${Number(diagnostics.telegramWebhook.staleProcessing || 0)} · failed=${Number(diagnostics.telegramWebhook.failedCurrent || 0)}.`
        : 'Health RPC persistent Telegram dedupe недоступен; примените supabase_migration_v6_17.sql.',
      true),
    productionCheck('upstream_timeouts', 'Тайм-ауты внешних сервисов', 'pass',
      'Supabase 7 сек., API-Football 10 сек.; зависшие внешние запросы не удерживают серверный обработчик бесконечно.', true),
    productionCheck('user_sync', 'Telegram user sync cache', 'pass',
      `Повторная синхронизация пользователей ограничена одним запуском в 10 минут; пропущено записей: ${Number(memory.telemetry?.userSyncSkips || 0)}.`, false),
    productionCheck('memory_bounds', 'Bounded L1 memory', memory.cache.size <= 600 ? 'pass' : 'warn',
      `${memory.cache.size} cache entries; soft target 500, prune threshold 600.`, false),
    productionCheck('quota_guard', 'Quota Orchestrator', providerBudget.mode === 'emergency' ? 'warn' : 'pass',
      `${providerBudget.label}; daily reserve ${Number(providerBudget.daily?.reserve || 0)}.`, false),
    productionCheck('expanded_e2e', 'Сквозная проверка расширенных данных', !paidProvider ? 'warn' : lastE2E?.status?.ready ? 'pass' : 'warn',
      !paidProvider
        ? 'Бесплатный тариф: полная сквозная проверка отложена до увеличения квоты.'
        : lastE2E?.status?.ready
          ? `${lastE2E.status.label} · матч ${lastE2E.fixtureId}.`
          : 'Расширенный тариф обнаружен, но проверка релиза ещё не подтверждена.', false),
    productionCheck('monetization', 'Монетизация на паузе', cfg.monetizationEnabled ? 'fail' : 'pass',
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
    label: blockers.length ? 'Проверка рабочей среды заблокирована' : warnings.length ? 'Рабочая среда готова с ожидаемыми ограничениями' : 'Проверка производственной безопасности пройдена',
    score: Math.round(passed / checks.length * 100),
    checks,
    blockers: blockers.map(x => x.id),
    warnings: warnings.map(x => x.id),
    safety,
    diagnostics: {
      supabase: diagnostics.supabase,
      provider: diagnostics.provider,
      runtime: diagnostics.runtime,
      telegramWebhook: diagnostics.telegramWebhook,
    },
    policy: {
      payments: 'paused',
      externalLoadGenerator: false,
      note: 'Самопроверка не создаёт искусственный внешний трафик и не расходует API-Football. Реальная нагрузочная проверка выполняется отдельно на тестовой или рабочей среде.',
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


const NEWS_BLOCKED_HOST_RE = /(?:facebook|instagram|tiktok|twitter|x\.com|youtube|youtu\.be|pinterest|betting|bet365|tips?ster|prediction)/i;
const NEWS_MAJOR_SOURCE_RE = /(?:reuters|apnews|bbc\.|espn|skysports|theathletic|goal\.|marca\.|as\.com|lequipe|kicker|gazzetta)/i;
const NEWS_OFFICIAL_SOURCE_RE = /(?:uefa\.|fifa\.|premierleague\.com|laliga\.com|bundesliga\.com|legaseriea\.it|ligue1\.com)/i;

function externalNewsUrl(value = '') {
  try {
    const u=new URL(String(value || ''));
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch { return ''; }
}

function newsSourceDomain(value = '') {
  try { return new URL(String(value || '')).hostname.replace(/^www\./,''); }
  catch { return ''; }
}

function newsSourceTrust(url = '') {
  const value=String(url || '');
  if (NEWS_OFFICIAL_SOURCE_RE.test(value)) return {tier:'official',score:95,label:'Официальный источник'};
  if (NEWS_MAJOR_SOURCE_RE.test(value)) return {tier:'major',score:88,label:'Крупный источник'};
  return {tier:'web',score:58,label:'Веб-источник'};
}

function applyNewsTrustGate(item = {}) {
  const trust=newsSourceTrust(item.url);
  const originalImpact=String(item?.category?.impact || 'low');
  const needsConfirmation=originalImpact==='high' && !['official','major'].includes(trust.tier);
  return {
    ...item,
    trust,
    verification:needsConfirmation ? 'needs_confirmation' : 'source_backed',
    category:needsConfirmation ? {...item.category,impact:'medium'} : item.category,
  };
}

function footballNewsCategory(article = {}) {
  const hay=searchText(`${article.title || ''} ${article.content || ''}`);
  const groups=[
    {code:'injury',icon:'🚑',label:'Травмы',impact:'high',re:/injur|injured|fitness|ruled out|doubt|surgery|hamstring|ankle|knee|травм|поврежден|повреждён|пропустит|под вопросом/},
    {code:'suspension',icon:'🟥',label:'Дисквалификации',impact:'high',re:/suspend|suspension|ban\b|red card|дисквалиф|отстранен|отстранён/},
    {code:'coach',icon:'🧑‍💼',label:'Тренер',impact:'high',re:/manager|head coach|coach|sacked|dismissed|appointed|тренер|уволен|увольнен|увольнён|назначен/},
    {code:'lineup',icon:'👥',label:'Состав',impact:'medium',re:/lineup|starting xi|team news|returns to squad|available|состав|стартов|вернулся в состав|готов сыграть/},
    {code:'transfer',icon:'🔄',label:'Трансферы',impact:'medium',re:/transfer|signing|signs|signed|joins|contract|loan|трансфер|подписал|аренд/},
    {code:'referee',icon:'🧑‍⚖️',label:'Судья',impact:'medium',re:/referee|officials|арбитр|судья/},
    {code:'weather',icon:'🌦️',label:'Условия',impact:'medium',re:/weather|storm|snow|rain|heat|pitch|погод|дожд|снег|жар|поле/},
    {code:'club',icon:'⚽',label:'Клуб',impact:'low',re:/club|president|owner|board|клуб|президент|владелец/},
  ];
  return groups.find(x=>x.re.test(hay)) || {code:'general',icon:'📰',label:'Футбол',impact:'low'};
}

function footballNewsImpactText(category = {}, hasUpcomingMatch = false) {
  if (!hasUpcomingMatch) {
    if (category.impact === 'high') return 'Событие может заметно изменить спортивный контекст команды.';
    if (category.impact === 'medium') return 'Событие стоит учитывать в следующем матче команды.';
    return 'Контекстная новость: следим, но не меняем AI-сценарий автоматически.';
  }
  if (category.code === 'injury' || category.code === 'suspension') return 'Может изменить состав и баланс сил. Перед матчем стоит обновить AI-разбор.';
  if (category.code === 'coach') return 'Смена тренерского контекста может менять стиль и неопределённость. AI-разбор стоит перепроверить.';
  if (category.code === 'lineup') return 'Может уточнить стартовый состав. Это один из ключевых сигналов перед матчем.';
  if (category.code === 'referee') return 'Назначение судьи может влиять на карточки, фолы и темп — проверяем в контексте матча.';
  if (category.code === 'weather') return 'Условия могут влиять на темп и качество игры. Это вспомогательный фактор, не самостоятельный прогноз.';
  return 'Проверяем, меняет ли новость входные данные AI-разбора ближайшего матча.';
}


function newsTeamToken(team = {}) {
  return String(team?.canonical || '').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,32);
}

function newsTeamByToken(token = '') {
  const clean=String(token || '').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,32);
  if (!clean) return null;
  return TOP_TEAM_SEARCH_CATALOG.find(team=>newsTeamToken(team)===clean) || null;
}

function newsPublishedDayToken(item = {}) {
  const ms=newsPublishedMs(item);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0,10).replace(/-/g,'');
}

function newsPublishedAtFromDayToken(token = '') {
  const value=String(token || '');
  if (!/^\d{8}$/.test(value)) return '';
  const iso=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T12:00:00Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : '';
}

function newsTeamHint(item = {}) {
  const hay=` ${searchText(`${item?.title || ''} ${item?.content || ''}`)} `;
  if (!hay.trim()) return null;
  let best=null;
  for (const team of TOP_TEAM_SEARCH_CATALOG) {
    const terms=[team.canonical,...(team.aliases || [])]
      .map(searchText)
      .filter(term=>term && (term.length>=4 || ['psg','bvb','psv','ajax','juve','lafc','rma','fcb'].includes(term)));
    for (const term of terms) {
      if (!hay.includes(` ${term} `)) continue;
      const score=(term.includes(' ')?120:60)+Math.min(80,term.length*4);
      if (!best || score>best.score) best={canonical:team.canonical,country:team.country,token:newsTeamToken(team),score};
    }
  }
  return best;
}

function newsPublishedMs(item = {}) {
  const value=Date.parse(String(item?.publishedAt || item?.published_date || ''));
  return Number.isFinite(value) ? value : null;
}

function newsFixtureRelevance(item = {}, fixture = {}) {
  const match=normalizeBotFixtureCard(fixture);
  const fixtureMs=Date.parse(match.date || '');
  if (!match.fixtureId || !Number.isFinite(fixtureMs)) return {score:-Infinity,fixture:match,timing:'invalid',hoursFromNews:null};
  const publishedMs=newsPublishedMs(item);
  const now=Date.now();
  const baseMs=publishedMs ?? now;
  const hours=(fixtureMs-baseMs)/3600000;
  let score=0;
  let timing='next_match';

  if (match.live) {
    score=520;
    timing='live';
  } else if (!match.finished && hours>=-3) {
    if (hours<=24) { score=460-Math.max(0,hours)*2; timing='pre_match'; }
    else if (hours<=72) { score=390-(hours-24); timing='near_match'; }
    else if (hours<=24*14) { score=310-(hours/24)*5; timing='next_match'; }
    else { score=190-Math.min(120,hours/24); timing='future'; }
  } else if (!match.finished && publishedMs===null) {
    const hoursFromNow=(fixtureMs-now)/3600000;
    score=hoursFromNow>=-3 ? 260-Math.min(180,Math.max(0,hoursFromNow)/2) : 20;
    timing='next_match';
  } else {
    const ageHours=Math.abs(hours);
    score=Math.max(5,80-Math.min(75,ageHours/3));
    timing='past_match';
  }

  const category=String(item?.category?.code || '');
  if (['lineup','injury','suspension','referee','weather'].includes(category) && !match.finished) score+=35;
  if (category==='coach' && !match.finished) score+=20;
  return {score,fixture:match,timing,hoursFromNews:Number.isFinite(hours)?hours:null};
}

function newsRelevantFixture(item = {}, fixtures = []) {
  const ranked=(fixtures || [])
    .map(fixture=>newsFixtureRelevance(item,fixture))
    .filter(x=>Number.isFinite(x.score) && x.fixture?.fixtureId)
    .sort((a,b)=>b.score-a.score || Date.parse(a.fixture.date||0)-Date.parse(b.fixture.date||0));
  const best=ranked[0] || null;
  if (!best) return null;
  if (best.timing==='past_match' && ranked.some(x=>x.timing!=='past_match')) return ranked.find(x=>x.timing!=='past_match') || best;
  return best;
}

function newsFixtureTimingLabel(link = {}) {
  if (!link?.fixture?.fixtureId) return '';
  if (link.timing==='live') return 'LIVE';
  const hours=Number(link.hoursFromNews);
  if (!Number.isFinite(hours)) return 'ближайший матч';
  if (hours>=0 && hours<2) return 'в течение 2 часов после новости';
  if (hours>=0 && hours<24) return `через ${Math.max(1,Math.round(hours))} ч после новости`;
  if (hours>=24) return `через ${Math.max(1,Math.round(hours/24))} дн. после новости`;
  return 'матч рядом по времени с новостью';
}

function newsFixtureChangeGuide(item = {}, link = null) {
  const category=String(item?.category?.code || '');
  if (!link?.fixture?.fixtureId) return '';
  if (category==='injury' || category==='suspension') return 'состав · глубина скамейки · баланс сил · рынок';
  if (category==='lineup') return 'стартовый состав · роли игроков · вероятности · рынок';
  if (category==='referee') return 'карточки · фолы · пенальти · темп';
  if (category==='weather') return 'темп · качество поля · интенсивность · тоталы';
  if (category==='coach') return 'схема · стиль · неопределённость · форма';
  if (category==='transfer') return 'доступность игрока · ротация · глубина состава';
  return 'состав · форма · рынок · AI-оценка';
}

function smartNewsMatchLinkDrill() {
  const item={publishedAt:'2026-09-20T12:00:00Z',category:{code:'injury'}};
  const fixtures=[
    {fixtureId:1,date:'2026-09-19T18:00:00Z',status:'FT',finished:true,homeName:'A',awayName:'B'},
    {fixtureId:2,date:'2026-09-21T18:00:00Z',status:'NS',homeName:'A',awayName:'C'},
    {fixtureId:3,date:'2026-09-28T18:00:00Z',status:'NS',homeName:'A',awayName:'D'},
  ];
  const best=newsRelevantFixture(item,fixtures);
  const label=newsFixtureTimingLabel(best);
  const guide=newsFixtureChangeGuide(item,best);
  const dayToken=newsPublishedDayToken(item);
  return {
    pass:best?.fixture?.fixtureId===2
      && best?.timing==='near_match'
      && label.includes('дн.')
      && guide.includes('состав')
      && dayToken==='20260920'
      && newsPublishedAtFromDayToken(dayToken)==='2026-09-20T12:00:00Z'
      && newsFixtureRelevance(item,fixtures[0]).score<newsFixtureRelevance(item,fixtures[1]).score,
    cases:7,
  };
}

function newsConversionHook(item = {}, { fixtureId=0, teamName='', fixtureLink=null } = {}) {
  const category=item?.category || {};
  const team=String(teamName || newsTeamHint(item)?.canonical || '').trim();
  if (fixtureId || fixtureLink?.fixture?.fixtureId) {
    const guide=newsFixtureChangeGuide(item,fixtureLink);
    if (guide) return `Перепроверить: ${guide}.`;
    if (category.code==='injury' || category.code==='suspension' || category.code==='lineup') return 'Проверить, меняет ли это состав, рынок и AI-оценку ближайшего матча.';
    if (category.code==='referee') return 'Проверить судью, карточки и темп в AI-контексте ближайшего матча.';
    if (category.code==='coach') return 'Проверить, изменился ли игровой контекст и уровень неопределённости перед матчем.';
    return 'Сверить новость с данными ближайшего матча и получить короткую AI-оценку.';
  }
  if (team) return `Найти ближайший матч ${team} и проверить, влияет ли новость на AI-разбор.`;
  return 'Сначала сверяем источник; без привязки к конкретному матчу AI-оценку не меняем.';
}

function newsConversionKeyboard(items = [], extraRows = [], { fixtureId=0, fixtures=[] } = {}) {
  const rows=[];
  for (const [index,item] of (items || []).slice(0,4).entries()) {
    const row=[{text:`↗ Источник ${index+1}`,url:item.url}];
    const smartLink=(fixtures || []).length ? newsRelevantFixture(item,fixtures) : null;
    const linkedFixtureId=Number(smartLink?.fixture?.fixtureId || fixtureId || 0);
    if (linkedFixtureId>0) {
      const dayToken=newsPublishedDayToken(item);
      row.push({text:'🧠 Проверить с AI',callback_data:`news:ai_match:${linkedFixtureId}${dayToken ? `:${dayToken}` : ''}`});
    } else {
      const hint=newsTeamHint(item);
      if (hint?.token) {
        const dayToken=newsPublishedDayToken(item);
        row.push({text:`🧠 ${String(hint.canonical).slice(0,18)}`,callback_data:`news:ai_team:${hint.token}${dayToken ? `:${dayToken}` : ''}`});
      }
    }
    rows.push(row);
  }
  return {inline_keyboard:[...rows,...extraRows]};
}

function newsConversionDrill() {
  const arsenal=newsTeamHint({title:'Arsenal injury update before Champions League match',content:''});
  const barca=newsTeamHint({title:'Барселона объявила состав на матч',content:''});
  const keyboard=newsConversionKeyboard([{title:'Arsenal team news',url:'https://example.com/a',content:'',category:{code:'lineup'}}],[],{});
  const callback=keyboard.inline_keyboard?.[0]?.[1]?.callback_data || '';
  const direct=newsConversionKeyboard([{title:'Club update',url:'https://example.com/b',content:'',category:{code:'club'}}],[],{fixtureId:998877});
  return {
    pass:arsenal?.canonical==='Arsenal'
      && barca?.canonical==='Barcelona'
      && callback==='news:ai_team:arsenal'
      && direct.inline_keyboard?.[0]?.[1]?.callback_data==='news:ai_match:998877'
      && newsTeamByToken('arsenal')?.canonical==='Arsenal',
    cases:5,
  };
}

function normalizeFootballNewsResult(row = {}) {
  const url=externalNewsUrl(row.url);
  const title=String(row.title || '').trim().slice(0,220);
  const content=String(row.content || '').replace(/\s+/g,' ').trim().slice(0,700);
  if (!url || !title || NEWS_BLOCKED_HOST_RE.test(url)) return null;
  const category=footballNewsCategory({title,content});
  return {
    title,url,content,
    source:newsSourceDomain(url),
    publishedAt:String(row.published_date || row.publishedAt || ''),
    category,
    sourceTier:newsSourceTrust(url).tier,
  };
}

function dedupeFootballNews(rows = [], limit = 6) {
  const seenUrl=new Set(), seenTitle=new Set();
  const out=[];
  for (const row of rows || []) {
    const item=normalizeFootballNewsResult(row);
    if (!item) continue;
    const tk=searchText(item.title).replace(/[^a-zа-я0-9 ]/gi,'').slice(0,90);
    if (seenUrl.has(item.url) || (tk && seenTitle.has(tk))) continue;
    seenUrl.add(item.url); if (tk) seenTitle.add(tk);
    out.push(applyNewsTrustGate(item));
  }
  const tierScore=x=>x.sourceTier==='official'?3:x.sourceTier==='major'?2:1;
  const impactScore=x=>x.category?.impact==='high'?3:x.category?.impact==='medium'?2:1;
  return out.sort((a,b)=>tierScore(b)-tierScore(a) || impactScore(b)-impactScore(a)).slice(0,limit);
}

async function tavilyNewsSearch(query, cfg, { days = 3, maxResults = 7 } = {}) {
  if (!cfg.tavilyKey) return { results:[], available:false, reason:'tavily_missing' };
  try {
    const r=await fetchWithTimeout('https://api.tavily.com/search',{
      method:'POST',
      headers:{Authorization:`Bearer ${cfg.tavilyKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        query:String(query || '').slice(0,500),
        topic:'news',
        search_depth:'basic',
        max_results:Math.max(1,Math.min(10,Number(maxResults || 7))),
        days:Math.max(1,Math.min(14,Number(days || 3))),
        include_answer:false,
      }),
    }, 8000, 'Tavily news');
    if (!r.ok) return {results:[],available:false,reason:`http_${r.status}`};
    const body=await r.json();
    return {results:dedupeFootballNews(body.results || [],maxResults),available:true,reason:''};
  } catch (error) {
    return {results:[],available:false,reason:'network'};
  }
}

async function currentGeneralFootballNews(cfg, force = false) {
  const bucket=Math.floor(Date.now()/(30*60*1000));
  const key=`bot:news:general:${force ? bucket : 'current'}:v1`;
  if (!force) {
    const cached=await getCache('bot:news:general:current:v1',cfg).catch(()=>null);
    if (cached?.items) return {...cached,cached:true};
  }
  const search=await tavilyNewsSearch(
    'soccer football latest news injuries suspensions lineups coaches Champions League Premier League La Liga Serie A Bundesliga Ligue 1',
    cfg,{days:2,maxResults:7}
  );
  const payload={items:search.results || [],available:search.available,reason:search.reason,generatedAt:new Date().toISOString()};
  await setCache('bot:news:general:current:v1',0,payload,cfg,30).catch(()=>null);
  if (force) await setCache(key,0,payload,cfg,30).catch(()=>null);
  return {...payload,cached:false};
}

async function favoriteTeamFootballNews(team = {}, cfg, force = false) {
  const id=Number(team.team_id || team.id || 0);
  const name=String(team.team_name || team.name || '').trim();
  if (!id || !name) return {items:[],available:false,reason:'team_missing'};
  const key=`bot:news:team:${id}:v1`;
  if (!force) {
    const cached=await getCache(key,cfg).catch(()=>null);
    if (cached?.items) return {...cached,cached:true};
  }
  const search=await tavilyNewsSearch(`${name} football latest injuries suspension lineup coach team news`,cfg,{days:5,maxResults:6});
  const payload={teamId:id,teamName:name,items:search.results || [],available:search.available,reason:search.reason,generatedAt:new Date().toISOString()};
  await setCache(key,id,payload,cfg,30).catch(()=>null);
  return {...payload,cached:false};
}

function newsImpactBadge(impact = 'low') {
  if (impact === 'high') return '🔴 возможное сильное влияние';
  if (impact === 'medium') return '🟡 возможное влияние';
  return '⚪ контекст';
}

function newsFeedText(items = [], { title='MatchRadar AI · Новости', teamName='', fixture=null, fixtures=[] } = {}) {
  if (!items.length) return `📰 <b>${telegramHtmlEscape(title)}</b>\n\nСвежих новостей по этому запросу сейчас не найдено или источник новостей временно недоступен.`;
  const rows=items.slice(0,4).map((item,index)=>{
    const smartLink=(fixtures || []).length ? newsRelevantFixture(item,fixtures) : null;
    const linkedFixture=smartLink?.fixture || fixture || null;
    const why=footballNewsImpactText(item.category,Boolean(linkedFixture?.fixtureId));
    const hint=newsTeamHint(item);
    const hook=newsConversionHook(item,{fixtureId:Number(linkedFixture?.fixtureId || 0),teamName:teamName || hint?.canonical || '',fixtureLink:smartLink});
    const timing=smartLink ? newsFixtureTimingLabel(smartLink) : '';
    return [
      `${index+1}. ${item.category.icon} <b>${telegramHtmlEscape(item.title)}</b>`,
      `${telegramHtmlEscape(item.category.label)} · ${newsImpactBadge(item.category.impact)}`,
      `Почему важно: ${telegramHtmlEscape(why)}`,
      ...(linkedFixture?.fixtureId ? [`🎯 Матч: ${telegramHtmlEscape(linkedFixture.homeName || '')} — ${telegramHtmlEscape(linkedFixture.awayName || '')}${timing ? ` · ${telegramHtmlEscape(timing)}` : ''}`] : []),
      `🧠 Что проверить: ${telegramHtmlEscape(hook)}`,
      `Источник: ${telegramHtmlEscape(item.source || 'веб-источник')} · ${telegramHtmlEscape(item.trust?.label || 'Веб-источник')}`,
      ...(item.verification==='needs_confirmation' ? ['Проверка: требуется подтверждение ещё одним надёжным источником.'] : []),
    ].join('\n');
  });
  const intro=teamName ? `Новости по <b>${telegramHtmlEscape(teamName)}</b>` : '<b>Главное в футболе</b>';
  return [`📰 <b>${telegramHtmlEscape(title)}</b>`,intro,'',...rows.map(x=>x+'\n'),'MatchRadar AI не меняет прогноз только из-за заголовка: новость учитывается в анализе лишь вместе с подтверждёнными футбольными данными.'].join('\n');
}

async function sendGeneralFootballNews(request,cfg,userId,chatId,{force=false}={}) {
  void recordGrowthEvent(cfg,{userId,eventName:'news_open',channel:'telegram',metadata:{refresh:Boolean(force)}});
  const news=await currentGeneralFootballNews(cfg,force);
  const favorites=await getFavorites(userId,cfg).catch(()=>[]);
  const extra=[];
  if (favorites.length) {
    const teamButtons=favorites.slice(0,4).map(x=>({text:`⭐ ${String(x.team_name || 'Команда').slice(0,18)}`,callback_data:`news:team:${Number(x.team_id)}`}));
    for (let i=0;i<teamButtons.length;i+=2) extra.push(teamButtons.slice(i,i+2));
  }
  extra.push([{text:'🔄 Обновить новости',callback_data:'news:refresh'}]);
  await telegramApi('sendMessage',cfg,{
    chat_id:chatId,parse_mode:'HTML',
    text:newsFeedText(news.items,{title:'MatchRadar AI · Новости'}),
    reply_markup:newsConversionKeyboard(news.items,extra),
    disable_web_page_preview:true,
  });
}

async function sendFavoriteTeamNews(request,cfg,userId,chatId,teamId,{force=false}={}) {
  const favorites=await getFavorites(userId,cfg);
  const team=favorites.find(x=>Number(x.team_id)===Number(teamId));
  if (!team) {
    await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Эта команда не найдена в вашем избранном.'});
    return;
  }
  const [news,matches]=await Promise.all([
    favoriteTeamFootballNews(team,cfg,force),
    botTeamIdMatches(teamId,cfg).catch(()=>[]),
  ]);
  const fixture=newsRelevantFixture(news.items?.[0] || {},matches || [])?.fixture
    || (matches || []).find(x=>x.live || (!x.finished && Date.parse(x.date || 0)>=Date.now()-2*60*60*1000))
    || null;
  const extra=[];
  if (fixture?.fixtureId) extra.push([{text:'⚽ Проверить ближайший матч',callback_data:`news:match:${Number(fixture.fixtureId)}`}]);
  extra.push([{text:'🔄 Обновить',callback_data:`news:team_refresh:${Number(teamId)}`},{text:'📰 Все новости',callback_data:'news:general'}]);
  await telegramApi('sendMessage',cfg,{
    chat_id:chatId,parse_mode:'HTML',
    text:newsFeedText(news.items,{title:'MatchRadar AI · Новости',teamName:team.team_name || '',fixture,fixtures:matches || []}),
    reply_markup:newsConversionKeyboard(news.items,extra,{fixtureId:Number(fixture?.fixtureId || 0),fixtures:matches || []}),
    disable_web_page_preview:true,
  });
}

async function currentMorningFootballNews(cfg) {
  const date=todayUtc();
  const key=`bot:news:morning:${date}:v1`;
  const cached=await getCache(key,cfg).catch(()=>null);
  if (cached?.items) return cached;
  const news=await currentGeneralFootballNews(cfg,false);
  const payload={date,items:(news.items || []).slice(0,2),generatedAt:new Date().toISOString()};
  await setCache(key,0,payload,cfg,360).catch(()=>null);
  return payload;
}

function morningNewsText(items = []) {
  if (!items.length) return '';
  return ['📰 <b>Главное за утро</b>','',...items.slice(0,2).map((item,i)=>`${i+1}. ${item.category.icon} <b>${telegramHtmlEscape(item.title)}</b>\n${telegramHtmlEscape(item.category.label)} · ${newsImpactBadge(item.category.impact)}\nИсточник: ${telegramHtmlEscape(item.source || 'веб-источник')} · ${telegramHtmlEscape(item.trust?.label || 'Веб-источник')}`),'','Откройте источник или нажмите «Новости», чтобы увидеть объяснение MatchRadar AI.'].join('\n');
}

async function tavilySearch(query, cfg) {
  if (!cfg.tavilyKey) return { answer: '', results: [] };
  try {
    const r = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.tavilyKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `${query}. Дай только проверяемые факты. Итоговую краткую сводку сформулируй на русском языке.`,
        topic: 'general',
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    }, 8000, 'Tavily search');
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
  const num = Number(String(value ?? '').replaceAll('%', '').replace(',', '.'));
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
  return { odds, probabilities: normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away), bookmakers: samples.length, sources: samples.length, provider: 'api-football' };
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
  return { odds, probabilities: normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away), sources: candidates.length, provider: 'api-football', updatedAt: candidates.find(x => x.update)?.update || '' };
}


function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replaceAll('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

let liveMatchIntelligenceRuntime = null;
function getLiveMatchIntelligenceRuntime() {
  if (!liveMatchIntelligenceRuntime) {
    liveMatchIntelligenceRuntime = createLiveMatchIntelligenceRuntime({
      numericValue,
    });
  }
  return liveMatchIntelligenceRuntime;
}

const formatPlayerLeaders = (...args) => getLiveMatchIntelligenceRuntime().formatPlayerLeaders(...args);
const livePressure = (...args) => getLiveMatchIntelligenceRuntime().livePressure(...args);
const smartStat = (...args) => getLiveMatchIntelligenceRuntime().smartStat(...args);
const smartSideName = (...args) => getLiveMatchIntelligenceRuntime().smartSideName(...args);
const smartInsight = (...args) => getLiveMatchIntelligenceRuntime().smartInsight(...args);
const recentEventSummary = (...args) => getLiveMatchIntelligenceRuntime().recentEventSummary(...args);
const sideFromPrematchSignal = (...args) => getLiveMatchIntelligenceRuntime().sideFromPrematchSignal(...args);
const livePerformanceSide = (...args) => getLiveMatchIntelligenceRuntime().livePerformanceSide(...args);
const liveMarketShift = (...args) => getLiveMatchIntelligenceRuntime().liveMarketShift(...args);
const buildLiveAiCoach = (...args) => getLiveMatchIntelligenceRuntime().buildLiveAiCoach(...args);
const buildSmartMatchInsights = (...args) => getLiveMatchIntelligenceRuntime().buildSmartMatchInsights(...args);

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
    provider: String(market.provider || 'api-football').slice(0, 80),
    bookmaker_count: Number(market.sources || market.bookmakers || 0),
    source_updated_at: Number.isFinite(Date.parse(String(market.updatedAt || ''))) ? String(market.updatedAt) : now.toISOString(),
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
  const history = sanitizeOddsSnapshotsForMovement(snapshots);
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

let modelIntelligenceRuntime = null;
function getModelIntelligenceRuntime() {
  if (!modelIntelligenceRuntime) {
    modelIntelligenceRuntime = createModelIntelligenceRuntime({
      apiFootball,
      getCache,
      isFinishedStatus,
      normalizeThree,
      parsePercent,
      round1,
      setCache,
      todayUtc,
    });
  }
  return modelIntelligenceRuntime;
}

const extractPrediction = (...args) => getModelIntelligenceRuntime().extractPrediction(...args);
const clamp = (...args) => getModelIntelligenceRuntime().clamp(...args);
const ymd = (...args) => getModelIntelligenceRuntime().ymd(...args);
const teamResult = (...args) => getModelIntelligenceRuntime().teamResult(...args);
const summarizeFormRows = (...args) => getModelIntelligenceRuntime().summarizeFormRows(...args);
const getRecentTeamForm = (...args) => getModelIntelligenceRuntime().getRecentTeamForm(...args);
const formProbabilities = (...args) => getModelIntelligenceRuntime().formProbabilities(...args);
const h2hProbabilities = (...args) => getModelIntelligenceRuntime().h2hProbabilities(...args);
const blendProbabilitySignals = (...args) => getModelIntelligenceRuntime().blendProbabilitySignals(...args);
const absenceAdjustmentUnits = (...args) => getModelIntelligenceRuntime().absenceAdjustmentUnits(...args);
const applyAbsenceAdjustment = (...args) => getModelIntelligenceRuntime().applyAbsenceAdjustment(...args);
const poissonGoalModel = (...args) => getModelIntelligenceRuntime().poissonGoalModel(...args);
const outcomeName = (...args) => getModelIntelligenceRuntime().outcomeName(...args);
const signalDisagreement = (...args) => getModelIntelligenceRuntime().signalDisagreement(...args);
const signalCanonicalCoverage = (...args) => getModelIntelligenceRuntime().signalCanonicalCoverage(...args);
const signalLeaderAgreement = (...args) => getModelIntelligenceRuntime().signalLeaderAgreement(...args);
const probabilityLeaderMargin = (...args) => getModelIntelligenceRuntime().probabilityLeaderMargin(...args);
const confidenceModel = (...args) => getModelIntelligenceRuntime().confidenceModel(...args);
const buildAnalysisNotes = (...args) => getModelIntelligenceRuntime().buildAnalysisNotes(...args);
const probabilityRanking = (...args) => getModelIntelligenceRuntime().probabilityRanking(...args);
const preMatchDriver = (...args) => getModelIntelligenceRuntime().preMatchDriver(...args);
const signalDisplayName = (...args) => getModelIntelligenceRuntime().signalDisplayName(...args);
const signalIcon = (...args) => getModelIntelligenceRuntime().signalIcon(...args);
const buildPreMatchIntelligence = (...args) => getModelIntelligenceRuntime().buildPreMatchIntelligence(...args);

let matchFormattingRuntime = null;
function getMatchFormattingRuntime() {
  if (!matchFormattingRuntime) {
    matchFormattingRuntime = createMatchFormattingRuntime({
      assessLineupQuality,
      normalizeFixtureAbsences,
    });
  }
  return matchFormattingRuntime;
}

const formatAbsences = (...args) => getMatchFormattingRuntime().formatAbsences(...args);
const normalizeLineupPlayer = (...args) => getMatchFormattingRuntime().normalizeLineupPlayer(...args);
const formatLineups = (...args) => getMatchFormattingRuntime().formatLineups(...args);
const formatH2H = (...args) => getMatchFormattingRuntime().formatH2H(...args);
const LIVE_STATUSES = new Proxy(new Set(), {
  get(_target, prop) {
    const value = getMatchFormattingRuntime().LIVE_STATUSES[prop];
    return typeof value === 'function' ? value.bind(getMatchFormattingRuntime().LIVE_STATUSES) : value;
  }
});
const FINISHED_STATUSES = new Proxy(new Set(), {
  get(_target, prop) {
    const value = getMatchFormattingRuntime().FINISHED_STATUSES[prop];
    return typeof value === 'function' ? value.bind(getMatchFormattingRuntime().FINISHED_STATUSES) : value;
  }
});
const isLiveStatus = (...args) => getMatchFormattingRuntime().isLiveStatus(...args);
const isFinishedStatus = (...args) => getMatchFormattingRuntime().isFinishedStatus(...args);
const statusLabel = (...args) => getMatchFormattingRuntime().statusLabel(...args);
const normalizeStatValue = (...args) => getMatchFormattingRuntime().normalizeStatValue(...args);
const STAT_KEYS = getMatchFormattingRuntime().STAT_KEYS;
const formatLiveStatistics = (...args) => getMatchFormattingRuntime().formatLiveStatistics(...args);
const translateEvent = (...args) => getMatchFormattingRuntime().translateEvent(...args);
const formatLiveEvents = (...args) => getMatchFormattingRuntime().formatLiveEvents(...args);
const scoreSnapshot = (...args) => getMatchFormattingRuntime().scoreSnapshot(...args);
const embeddedLiveData = (...args) => getMatchFormattingRuntime().embeddedLiveData(...args);

const {
  COMPETITIONS,
  BIG_TEAM_RE,
  YOUTH_RESERVE_RE,
  WOMEN_RE,
  FRIENDLY_RE,
  CUP_RE,
  LOWER_RE,
  COUNTRY_RU,
  normalizeCountryName,
  isYouthReserveMatch,
  detectCompetitionCategory,
  leagueGroup,
  normalizeCompetition,
  isTopLeague,
  normalizeRoundLabel,
  matchInterestScore,
  catalogRank,
  matchStatusRank,
  KNOWN_FIXTURE_STATUSES,
  INTEGRITY_SEVERITY_WEIGHT,
  finiteNonNegative,
  fixtureScorePair,
  previousMatchMap,
  validateFixtureIntegrity,
  integritySignature,
  runMatchIntegrityGuard,
  persistIntegrityRun,
  readIntegrityDiagnostics,
  apiDataIntegrity,
} = createCompetitionIntegrityRuntime({
  APP_VERSION,
  bumpTelemetry,
  hasSupabase,
  isFinishedStatus,
  isLiveStatus,
  json,
  memory,
  recordOpsEvent,
  safeOpsMetadata,
  supaSelectMany,
  supaUpsert,
});

async function apiMe(request, cfg, user) {
  const [quota, record, favorites, favoritePlayers, reminders, preferences] = await Promise.all([
    getQuota(user.id, cfg),
    getUserRecord(user.id, cfg),
    getFavorites(user.id, cfg),
    getFavoritePlayers(user.id, cfg),
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
    stats: { favorites: favorites.length, favoritePlayers: favoritePlayers.length, reminders: reminders.length },
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
      aiSignalCode: x.ai_signal_code || '',
      aiSignalLabel: x.ai_signal_label || '',
      aiConfidence: Number.isFinite(Number(x.ai_confidence)) ? Number(x.ai_confidence) : null,
      aiRisk: x.ai_risk || '',
      aiOutcome: x.ai_outcome || '',
      aiTotal: x.ai_total || '',
      aiBtts: x.ai_btts || '',
      analysisVersion: x.analysis_version || '',
      viewedAt: x.viewed_at || '',
    })),
  });
}

async function apiHistoryAnalysis(request, cfg, user) {
  const fixtureId = Number(new URL(request.url).searchParams.get('fixtureId'));
  if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) return json({ error: 'Номер матча обязателен.' }, 400);

  const history = await getHistory(user.id, cfg);
  if (!history.some(row => Number(row.fixture_id) === fixtureId)) {
    return json({ error: 'Этот матч отсутствует в вашей истории анализов.', code: 'HISTORY_ANALYSIS_NOT_FOUND' }, 404);
  }

  const cacheKey = `fixture:${fixtureId}:v15-availability-quality-rc144`;
  const fresh = await getCache(cacheKey, cfg);
  const payload = fresh || await getStaleCache(cacheKey, cfg);
  if (!payload) {
    return json({
      error: 'Сохранённый полный анализ уже недоступен. Откройте центр матча или выполните новый анализ вручную.',
      code: 'HISTORY_ANALYSIS_UNAVAILABLE',
    }, 404);
  }

  return json(analysisResponsePayload(payload,{cached:true,stale:!fresh,historyReadOnly:true,recheck:{requested:false,performed:false,free:false,reasonCode:analysisFreshness(payload).reasonCode},quota:await getQuota(user.id,cfg)}));
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
    if (!teamId) return json({ error: 'Номер команды обязателен.' }, 400);
    await removeFavorite(user.id, teamId, cfg);
    return json({ ok: true });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}


function publicFavoritePlayer(row = {}) {
  return {
    playerId: Number(row.player_id),
    playerName: String(row.player_name || ''),
    teamId: Number(row.team_id),
    createdAt: row.created_at || null,
  };
}

async function resolveFavoritePlayerIdentity(input = {}, cfg) {
  const playerId = Number(input?.playerId || 0);
  const teamId = Number(input?.teamId || 0);
  const fixtureId = Number(input?.fixtureId || 0);

  if (![playerId, teamId, fixtureId].every(id => Number.isSafeInteger(id) && id > 0)) {
    return {
      ok: false,
      status: 400,
      code: 'FAVORITE_PLAYER_INVALID',
      error: 'Некорректный игрок, команда или матч.',
    };
  }

  const cacheKey = `match-center:${fixtureId}:v16-availability-quality-rc144`;
  const center = await getCache(cacheKey, cfg) || await getStaleCache(cacheKey, cfg);
  if (!center) {
    return {
      ok: false,
      status: 409,
      code: 'FAVORITE_PLAYER_CONTEXT_EXPIRED',
      error: 'Контекст матча устарел. Откройте матч заново и повторите.',
    };
  }

  const match = center?.match || {};
  const side = ['home', 'away'].find(key => Number(match?.[key]?.id || 0) === teamId);
  if (!side) {
    return {
      ok: false,
      status: 422,
      code: 'FAVORITE_PLAYER_TEAM_MISMATCH',
      error: 'Игрок не относится к выбранной команде этого матча.',
    };
  }

  const player = (center?.playerLeaders?.[side] || [])
    .find(item => Number(item?.id || 0) === playerId);
  const playerName = String(player?.name || '').trim();
  if (!player || !playerName) {
    return {
      ok: false,
      status: 422,
      code: 'FAVORITE_PLAYER_NOT_FOUND',
      error: 'Игрок не найден в подтверждённых данных этого матча.',
    };
  }

  return {
    ok: true,
    player: { id: playerId, name: playerName, teamId },
  };
}

async function apiFavoritePlayers(request, cfg, user) {
  const notificationContract = publicPlayerFollowNotificationContract();

  if (request.method === 'GET') {
    const rows = await getFavoritePlayers(user.id, cfg);
    return json({
      items: rows.map(publicFavoritePlayer),
      notificationContract,
    });
  }

  if (request.method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Некорректное тело запроса.', code: 'FAVORITE_PLAYER_INVALID_JSON' }, 400);
    }

    const resolved = await resolveFavoritePlayerIdentity(body, cfg);
    if (!resolved.ok) return json({ error: resolved.error, code: resolved.code }, resolved.status);

    const row = await addFavoritePlayer(user.id, resolved.player, cfg);
    return json({
      ok: true,
      item: publicFavoritePlayer(row),
      notificationContract,
    });
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const playerId = Number(url.searchParams.get('playerId'));
    if (!Number.isSafeInteger(playerId) || playerId <= 0) {
      return json({ error: 'Номер игрока обязателен.', code: 'FAVORITE_PLAYER_INVALID' }, 400);
    }
    await removeFavoritePlayer(user.id, playerId, cfg);
    return json({ ok: true, notificationContract });
  }

  return json({ error: 'Метод не поддерживается.' }, 405);
}

async function apiDigestSettings(request, cfg, user) {
  const telegramId=Number(user?.id || 0);
  if (!telegramId) return json({error:'Сессия Telegram не подтверждена.',code:'DIGEST_AUTH_REQUIRED'},401);

  if (request.method === 'GET') {
    const [row,quota,favorites]=await Promise.all([
      getBotDigestSubscription(telegramId,cfg),
      getQuota(telegramId,cfg),
      getFavorites(telegramId,cfg),
    ]);
    return json({settings:publicDigestSettings(row,quota?.plan,favorites)});
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    let body={};
    try { body=await request.json(); } catch {
      return json({error:'Некорректное тело запроса.',code:'DIGEST_INVALID_JSON'},400);
    }
    if (typeof body?.enabled !== 'boolean') {
      return json({error:'Поле enabled должно быть true или false.',code:'DIGEST_INVALID_ENABLED'},400);
    }
    const appUrl=publicSiteUrl(request,'/');
    const row=await setBotDigestSubscription(telegramId,telegramId,body.enabled,cfg,appUrl);
    const [quota,favorites]=await Promise.all([
      getQuota(telegramId,cfg),
      getFavorites(telegramId,cfg),
    ]);
    void recordOpsEvent(cfg,{
      severity:'info',
      source:'telegram',
      eventType:'digest_subscription',
      code:body.enabled?'DIGEST_SUBSCRIPTION_ENABLED':'DIGEST_SUBSCRIPTION_DISABLED',
      message:body.enabled?'Mini App digest subscription enabled.':'Mini App digest subscription disabled.',
      endpoint:'/api/digest-settings',
      meta:{channel:'miniapp',enabled:Boolean(body.enabled),plan:String(quota?.plan || 'FREE')},
    }).catch(()=>null);
    return json({ok:true,settings:publicDigestSettings(row,quota?.plan,favorites)});
  }

  return json({error:'Метод не поддерживается.'},405);
}

function publicReminder(row = {}) {
  return {
    fixtureId: Number(row.fixture_id),
    homeName: row.home_name || '',
    awayName: row.away_name || '',
    leagueName: row.league_name || '',
    fixtureDate: row.fixture_date || '',
    notifiedAt: row.notified_at || null,
    remindBeforeMinutes: Number(row.remind_before_minutes || 30),
    kickoffNotify: row.kickoff_notify !== false,
    kickoffNotifiedAt: row.kickoff_notified_at || null,
    deliveryStatus: reminderDeliveryStatus(row),
    deliveryAttempts: Number(row.prematch_attempts || 0) + Number(row.kickoff_attempts || 0),
    deliveryLastAttemptAt: row.delivery_last_attempt_at || null,
  };
}

async function apiReminders(request, cfg, user) {
  if (request.method === 'GET') {
    const rows = await getReminders(user.id, cfg);
    return json({ items: rows.map(publicReminder) });
  }
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const row = await addReminder(user.id, body, cfg);
    return json({ ok: true, item: publicReminder(row) });
  }
  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const fixtureId = Number(url.searchParams.get('fixtureId'));
    if (!fixtureId) return json({ error: 'Номер матча обязателен.' }, 400);
    await removeReminder(user.id, fixtureId, cfg);
    return json({ ok: true });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}

async function apiPreferences(request, cfg, user) {
  if (request.method === 'GET') {
    const [preferences, quota] = await Promise.all([
      getPreferences(user.id, cfg),
      getQuota(user.id, cfg),
    ]);
    return json({
      preferences,
      notificationCapabilities: publicSmartNotificationCapabilities(quota?.plan),
    });
  }
  if (request.method === 'PUT' || request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const preferences = await savePreferences(user.id, body, cfg);
    const quota = await getQuota(user.id, cfg);
    return json({
      ok: true,
      preferences,
      notificationCapabilities: publicSmartNotificationCapabilities(quota?.plan),
    });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}


let searchDiscoveryRuntime = null;
function getSearchDiscoveryRuntime() {
  if (!searchDiscoveryRuntime) {
    searchDiscoveryRuntime = createSearchDiscoveryRuntime({
      apiFootball,
      freeQuotaHealthy,
      getCache,
      getStaleCache,
      isFootballRateLimitError,
      isYouthReserveMatch,
      json,
      loadProviderTeamDiscoveryFixtures,
      normalizeCountryName,
      normalizeTeamHubMatch,
      publicDataCapabilities,
      setCache,
    });
  }
  return searchDiscoveryRuntime;
}

const SEARCH_COMPETITION_ALIASES = (...args) => getSearchDiscoveryRuntime().SEARCH_COMPETITION_ALIASES(...args);
const TOP_TEAM_SEARCH_CATALOG = (...args) => getSearchDiscoveryRuntime().TOP_TEAM_SEARCH_CATALOG(...args);
const topTeamSearchCandidates = (...args) => getSearchDiscoveryRuntime().topTeamSearchCandidates(...args);
const topTeamSearchPlan = (...args) => getSearchDiscoveryRuntime().topTeamSearchPlan(...args);
const knownTopTeamFallbacks = (...args) => getSearchDiscoveryRuntime().knownTopTeamFallbacks(...args);
const searchText = (...args) => getSearchDiscoveryRuntime().searchText(...args);
const SEARCH_QUALITY_DRILL_CASES = (...args) => getSearchDiscoveryRuntime().SEARCH_QUALITY_DRILL_CASES(...args);
const searchQualityDrill = (...args) => getSearchDiscoveryRuntime().searchQualityDrill(...args);
const competitionCountryByGroup = (...args) => getSearchDiscoveryRuntime().competitionCountryByGroup(...args);
const searchKnownCompetitions = (...args) => getSearchDiscoveryRuntime().searchKnownCompetitions(...args);
const normalizeSearchTeam = (...args) => getSearchDiscoveryRuntime().normalizeSearchTeam(...args);
const loadSearchCompetitionMatches = (...args) => getSearchDiscoveryRuntime().loadSearchCompetitionMatches(...args);
const preferCompetitionSearch = (...args) => getSearchDiscoveryRuntime().preferCompetitionSearch(...args);
const mergeSearchWarnings = (...args) => getSearchDiscoveryRuntime().mergeSearchWarnings(...args);
const TEAM_DISCOVERY_PAST_DAYS = (...args) => getSearchDiscoveryRuntime().TEAM_DISCOVERY_PAST_DAYS(...args);
const TEAM_DISCOVERY_FUTURE_DAYS = (...args) => getSearchDiscoveryRuntime().TEAM_DISCOVERY_FUTURE_DAYS(...args);
const teamDiscoveryWindow = (...args) => getSearchDiscoveryRuntime().teamDiscoveryWindow(...args);
const matchSelectionProfile = (...args) => getSearchDiscoveryRuntime().matchSelectionProfile(...args);
const compareMatchSelection = (...args) => getSearchDiscoveryRuntime().compareMatchSelection(...args);
const rankTeamDiscoveryMatches = (...args) => getSearchDiscoveryRuntime().rankTeamDiscoveryMatches(...args);
const MATCH_SELECTION_DRILL_NOW = (...args) => getSearchDiscoveryRuntime().MATCH_SELECTION_DRILL_NOW(...args);
const matchSelectionDrill = (...args) => getSearchDiscoveryRuntime().matchSelectionDrill(...args);
const splitTeamDiscoveryMatches = (...args) => getSearchDiscoveryRuntime().splitTeamDiscoveryMatches(...args);
const teamSearchFixturePayload = (...args) => getSearchDiscoveryRuntime().teamSearchFixturePayload(...args);
const loadSearchTeamMatches = (...args) => getSearchDiscoveryRuntime().loadSearchTeamMatches(...args);
const apiSearch = (...args) => getSearchDiscoveryRuntime().apiSearch(...args);

let providerFixtureRuntime = null;
function getProviderFixtureRuntime() {
  if (!providerFixtureRuntime) {
    providerFixtureRuntime = createProviderFixtureRuntime({
      apiFootball,
      bumpTelemetry,
      catalogRank,
      getCache,
      getStaleCache,
      isFinishedStatus,
      isFootballRateLimitError,
      isLiveStatus,
      isTopLeague,
      json,
      liveRefreshSeconds,
      markCachedSourceMeta,
      matchInterestScore,
      matchStatusRank,
      normalizeCompetition,
      normalizeRoundLabel,
      persistIntegrityRun,
      providerBudgetProfile,
      publicDataCapabilities,
      runMatchIntegrityGuard,
      scoreSnapshot,
      setCache,
      settlePredictionsFromFixtures,
      sourceMeta,
      statusLabel,
      todayUtc,
    });
  }
  return providerFixtureRuntime;
}

const providerFixtureDateCacheKey = (...args) => getProviderFixtureRuntime().providerFixtureDateCacheKey(...args);
const loadProviderFixturesForDate = (...args) => getProviderFixtureRuntime().loadProviderFixturesForDate(...args);
const providerTeamDiscoveryCacheKey = (...args) => getProviderFixtureRuntime().providerTeamDiscoveryCacheKey(...args);
const loadProviderTeamDiscoveryFixtures = (...args) => getProviderFixtureRuntime().loadProviderTeamDiscoveryFixtures(...args);
const providerFixtureDirectCacheKey = (...args) => getProviderFixtureRuntime().providerFixtureDirectCacheKey(...args);
const cachedProviderFixture = (...args) => getProviderFixtureRuntime().cachedProviderFixture(...args);
const loadProviderFixture = (...args) => getProviderFixtureRuntime().loadProviderFixture(...args);
const utcDateShift = (...args) => getProviderFixtureRuntime().utcDateShift(...args);
const providerFeedDateTtl = (...args) => getProviderFixtureRuntime().providerFeedDateTtl(...args);
const apiMatches = (...args) => getProviderFixtureRuntime().apiMatches(...args);

let teamTournamentRuntime = null;
function getTeamTournamentRuntime() {
  if (!teamTournamentRuntime) {
    teamTournamentRuntime = createTeamTournamentRuntime({
      apiFootball,
      compactProviderError,
      createProviderRequestBoundary,
      footballDataScorersUrl,
      footballDataStandingsUrl,
      freeQuotaHealthy,
      getCache,
      getCacheEntry,
      getStaleCache,
      hasSupabase,
      isFinishedStatus,
      isFootballRateLimitError,
      isLiveStatus,
      json,
      loadProviderTeamDiscoveryFixtures,
      markCachedSourceMeta,
      normalizeCompetition,
      normalizeCountryName,
      normalizeFootballDataStandings,
      normalizeFootballDataTeamScorers,
      normalizeOpenLigaMatchEvents,
      normalizeOpenLigaStandings,
      normalizeRoundLabel,
      normalizeTheOddsApiMarket,
      openLigaCompetition,
      openLigaMatchDataUrls,
      openLigaTableUrls,
      providerFeaturePolicy,
      publicDataCapabilities,
      recordOpsEvent,
      resolveProviderChain,
      scoreSnapshot,
      secondaryProviderJson,
      setCache,
      sourceMeta,
      splitTeamDiscoveryMatches,
      statusLabel,
      summarizeFormRows,
      supaRpc,
      teamDiscoveryWindow,
      teamResult,
      theOddsApiUrl,
    });
  }
  return teamTournamentRuntime;
}

const normalizeStandingRow = (...args) => getTeamTournamentRuntime().normalizeStandingRow(...args);
const normalizeApiFootballStandings = (...args) => getTeamTournamentRuntime().normalizeApiFootballStandings(...args);
const claimSecondaryProviderBudget = (...args) => getTeamTournamentRuntime().claimSecondaryProviderBudget(...args);
const openLigaStandingsProvider = (...args) => getTeamTournamentRuntime().openLigaStandingsProvider(...args);
const openLigaEventFeatureMeta = (...args) => getTeamTournamentRuntime().openLigaEventFeatureMeta(...args);
const secondaryOpenLigaEvents = (...args) => getTeamTournamentRuntime().secondaryOpenLigaEvents(...args);
const footballDataStandingsProvider = (...args) => getTeamTournamentRuntime().footballDataStandingsProvider(...args);
const oddsFallbackMeta = (...args) => getTeamTournamentRuntime().oddsFallbackMeta(...args);
const usableOddsFeatureMeta = (...args) => getTeamTournamentRuntime().usableOddsFeatureMeta(...args);
const secondaryOddsMarket = (...args) => getTeamTournamentRuntime().secondaryOddsMarket(...args);
const resolveTournamentStandings = (...args) => getTeamTournamentRuntime().resolveTournamentStandings(...args);
const apiTournament = (...args) => getTeamTournamentRuntime().apiTournament(...args);
const normalizeTeamHubMatch = (...args) => getTeamTournamentRuntime().normalizeTeamHubMatch(...args);
const choosePrimaryTeamCompetition = (...args) => getTeamTournamentRuntime().choosePrimaryTeamCompetition(...args);
const cachedTeamStanding = (...args) => getTeamTournamentRuntime().cachedTeamStanding(...args);
const apiTeam = (...args) => getTeamTournamentRuntime().apiTeam(...args);
const teamStatsNum = (...args) => getTeamTournamentRuntime().teamStatsNum(...args);
const teamStatsAvg = (...args) => getTeamTournamentRuntime().teamStatsAvg(...args);
const teamStatsRate = (...args) => getTeamTournamentRuntime().teamStatsRate(...args);
const normalizeTeamSeasonStatistics = (...args) => getTeamTournamentRuntime().normalizeTeamSeasonStatistics(...args);
const playerStatNumber = (...args) => getTeamTournamentRuntime().playerStatNumber(...args);
const playerStatNullable = (...args) => getTeamTournamentRuntime().playerStatNullable(...args);
const normalizeApiFootballTeamPlayers = (...args) => getTeamTournamentRuntime().normalizeApiFootballTeamPlayers(...args);
const apiFootballTeamSeasonPlayers = (...args) => getTeamTournamentRuntime().apiFootballTeamSeasonPlayers(...args);
const footballDataTeamScorersProvider = (...args) => getTeamTournamentRuntime().footballDataTeamScorersProvider(...args);
const resolveTeamSeasonPlayers = (...args) => getTeamTournamentRuntime().resolveTeamSeasonPlayers(...args);

let teamIntelligenceRuntime = null;
function getTeamIntelligenceRuntime() {
  if (!teamIntelligenceRuntime) {
    teamIntelligenceRuntime = createTeamIntelligenceRuntime({
      annotateEventReliability,
      annotateLineupReliability,
      apiFootball,
      applyFeatureFreshness,
      assessMatchEventQuality,
      assessMatchLineups,
      compactProviderError,
      formatLiveEvents,
      freeQuotaHealthy,
      getCache,
      getStaleCache,
      json,
      normalizeTeamSeasonStatistics,
      providerFeatureFetch,
      publicDataCapabilities,
      resolveTeamSeasonPlayers,
      runtimeControlsSnapshot,
      setCache,
      sourceMeta,
    });
  }
  return teamIntelligenceRuntime;
}

const apiTeamIntelligence = (...args) => getTeamIntelligenceRuntime().apiTeamIntelligence(...args);
const normalizeSquadPosition = (...args) => getTeamIntelligenceRuntime().normalizeSquadPosition(...args);
const normalizeTeamSquad = (...args) => getTeamIntelligenceRuntime().normalizeTeamSquad(...args);
const apiTeamSquad = (...args) => getTeamIntelligenceRuntime().apiTeamSquad(...args);
const normalizeLineupNotificationRow = (...args) => getTeamIntelligenceRuntime().normalizeLineupNotificationRow(...args);
const loadLineupNotificationSnapshot = (...args) => getTeamIntelligenceRuntime().loadLineupNotificationSnapshot(...args);
const loadSmartNotificationEventSnapshot = (...args) => getTeamIntelligenceRuntime().loadSmartNotificationEventSnapshot(...args);

let refereeIntelligenceRuntime = null;
function getRefereeIntelligenceRuntime() {
  if (!refereeIntelligenceRuntime) {
    refereeIntelligenceRuntime = createRefereeIntelligenceRuntime({
      hasSupabase,
      memory,
      numericValue,
      supaSelectMany,
      supaUpsert,
    });
  }
  return refereeIntelligenceRuntime;
}

const refereeProfile = (...args) => getRefereeIntelligenceRuntime().refereeProfile(...args);
const refereeHistoryKey = (...args) => getRefereeIntelligenceRuntime().refereeHistoryKey(...args);
const refereeCardSummary = (...args) => getRefereeIntelligenceRuntime().refereeCardSummary(...args);
const saveRefereeMatchHistory = (...args) => getRefereeIntelligenceRuntime().saveRefereeMatchHistory(...args);
const loadRefereeHistoryProfile = (...args) => getRefereeIntelligenceRuntime().loadRefereeHistoryProfile(...args);

let analysisQualityRuntime = null;
function getAnalysisQualityRuntime() {
  if (!analysisQualityRuntime) {
    analysisQualityRuntime = createAnalysisQualityRuntime({
      absenceAdjustmentUnits,
      assessMatchLineups,
      probabilityLeaderMargin,
    });
  }
  return analysisQualityRuntime;
}

const buildLineupImpact = (...args) => getAnalysisQualityRuntime().buildLineupImpact(...args);
const marketMovementNote = (...args) => getAnalysisQualityRuntime().marketMovementNote(...args);
const analysisQualityGate = (...args) => getAnalysisQualityRuntime().analysisQualityGate(...args);
const analysisQualityGateSelfTest = (...args) => getAnalysisQualityRuntime().analysisQualityGateSelfTest(...args);

let analysisLifecycleRuntime = null;
function getAnalysisLifecycleRuntime() {
  if (!analysisLifecycleRuntime) {
    analysisLifecycleRuntime = createAnalysisLifecycleRuntime({
      hasSupabase,
      isFinishedStatus,
      isLiveStatus,
      memory,
      supaSelectOne,
    });
  }
  return analysisLifecycleRuntime;
}

const analysisFreshness = (...args) => getAnalysisLifecycleRuntime().analysisFreshness(...args);
const analysisKickoffHandoff = (...args) => getAnalysisLifecycleRuntime().analysisKickoffHandoff(...args);
const analysisKickoffHandoffDrill = (...args) => getAnalysisLifecycleRuntime().analysisKickoffHandoffDrill(...args);
const userHasAnalyzedFixture = (...args) => getAnalysisLifecycleRuntime().userHasAnalyzedFixture(...args);
const analysisFreshnessDrill = (...args) => getAnalysisLifecycleRuntime().analysisFreshnessDrill(...args);
const analysisDeltaProbabilityLabel = (...args) => getAnalysisLifecycleRuntime().analysisDeltaProbabilityLabel(...args);
const analysisRecheckDelta = (...args) => getAnalysisLifecycleRuntime().analysisRecheckDelta(...args);
const newsImpactDeltaStatus = (...args) => getAnalysisLifecycleRuntime().newsImpactDeltaStatus(...args);
const newsImpactDeltaDrill = (...args) => getAnalysisLifecycleRuntime().newsImpactDeltaDrill(...args);
const analysisDeltaDrill = (...args) => getAnalysisLifecycleRuntime().analysisDeltaDrill(...args);
const analysisResponsePayload = (...args) => getAnalysisLifecycleRuntime().analysisResponsePayload(...args);

let matchCenterRuntime = null;
function getMatchCenterRuntime() {
  if (!matchCenterRuntime) {
    matchCenterRuntime = createMatchCenterRuntime({
      annotateAvailabilityReliability,
      annotateEventReliability,
      annotateLineupReliability,
      annotateOddsReliability,
      annotateStatisticsReliability,
      applyFeatureFreshness,
      applyFeatureFreshnessMap,
      assessExpectedGoalsQuality,
      assessFixtureAvailabilityQuality,
      assessMatchEventQuality,
      assessMatchLineups,
      assessMatchStatisticsQuality,
      assessOddsMarketQuality,
      buildAiTimeline,
      buildLiveAiCoach,
      buildOddsMovement,
      buildPostMatchReview,
      buildSmartMatchInsights,
      embeddedLiveData,
      eventsForTrustedAnalytics,
      extractLiveMarket,
      formatAbsences,
      formatLineups,
      formatLiveEvents,
      formatLiveStatistics,
      formatPlayerLeaders,
      getCache,
      getOddsSnapshots,
      getStaleCache,
      isFinishedStatus,
      isFootballRateLimitError,
      isLiveStatus,
      isYouthReserveMatch,
      json,
      livePressure,
      loadFixtureAiTimeline,
      loadModelPredictionForFixture,
      loadProviderFixture,
      oddsMarketForTrustedAnalytics,
      providerBudgetProfile,
      providerDataState,
      providerFeatureFetch,
      providerFeaturePolicy,
      providerPublicBudgetMode,
      publicDataCapabilities,
      recordOpsEvent,
      runtimeControlsSnapshot,
      sanitizeAvailabilityRows,
      sanitizeEventsForDisplay,
      sanitizeExpectedGoalsForDisplay,
      sanitizeStatisticsForDisplay,
      saveOddsSnapshot,
      saveRefereeMatchHistory,
      scoreSnapshot,
      secondaryOddsMarket,
      secondaryOpenLigaEvents,
      setCache,
      settlePredictionsFromFixtures,
      statisticsForTrustedAnalytics,
      statisticsForTrustedExpectedGoals,
      statusLabel,
      usableOddsFeatureMeta,
      validateFixtureIntegrity,
    });
  }
  return matchCenterRuntime;
}

const apiMatchCenter = async (request, cfg) => getMatchCenterRuntime().apiMatchCenter(request, cfg);



let analysisContextRuntime = null;
function getAnalysisContextRuntime() {
  if (!analysisContextRuntime) {
    analysisContextRuntime = createAnalysisContextRuntime({
      analysisQualityGate,
      freeQuotaHealthy,
      getCache,
      getStaleCache,
      marketMovementNote,
      refereeProfile,
      resolveTeamSeasonPlayers,
      setCache,
    });
  }
  return analysisContextRuntime;
}

const cachedTeamIntelligenceForAnalysis = (...args) => getAnalysisContextRuntime().cachedTeamIntelligenceForAnalysis(...args);
const hydratePlayerRolesForAnalysis = (...args) => getAnalysisContextRuntime().hydratePlayerRolesForAnalysis(...args);
const comparisonNumber = (...args) => getAnalysisContextRuntime().comparisonNumber(...args);
const comparisonMetric = (...args) => getAnalysisContextRuntime().comparisonMetric(...args);
const buildMatchComparison = (...args) => getAnalysisContextRuntime().buildMatchComparison(...args);
const buildAiInstructor = (...args) => getAnalysisContextRuntime().buildAiInstructor(...args);

let analysisRuntime = null;
function getAnalysisRuntime() {
  if (!analysisRuntime) {
    analysisRuntime = createAnalysisRuntime({
      CALIBRATION_PROFILE_VERSION,
      MODEL_BASE_WEIGHTS,
      analysisFreshness,
      analysisProviderFetch,
      analysisRecheckDelta,
      analysisResponsePayload,
      annotateAvailabilityReliability,
      annotateLineupReliability,
      annotateOddsReliability,
      applyAbsenceAdjustment,
      applyFeatureFreshnessMap,
      assessFixtureAvailabilityQuality,
      assessMatchLineups,
      assessOddsMarketQuality,
      baselineCalibrationProfile,
      blendProbabilitySignals,
      buildAiInstructor,
      buildAnalysisNotes,
      buildLineupImpact,
      buildMatchComparison,
      buildOddsMovement,
      buildPreMatchIntelligence,
      bumpTelemetry,
      cachedTeamIntelligenceForAnalysis,
      cachedTeamStanding,
      captureAnalysisTimelineSnapshot,
      captureModelPrediction,
      claimDistributedAnalysisLock,
      cleanNewsImpactActionCode,
      cleanNewsImpactDecisionCode,
      cleanNewsImpactRecoveryCode,
      confidenceModel,
      enrichFixtureAbsencesWithSeasonRole,
      extractMarket,
      extractPrediction,
      finalizeAnalysisUsageReservation,
      formProbabilities,
      formatAbsences,
      formatH2H,
      formatLineups,
      freeQuotaHealthy,
      getCache,
      getCalibrationProfile,
      getOddsSnapshots,
      getQuota,
      getRecentTeamForm,
      getStaleCache,
      h2hProbabilities,
      hasSupabase,
      hydratePlayerRolesForAnalysis,
      isFinishedStatus,
      isFootballRateLimitError,
      isLiveStatus,
      isYouthReserveMatch,
      json,
      loadProviderFixture,
      loadRefereeHistoryProfile,
      memory,
      newsImpactDeltaStatus,
      newsImpactFailureCode,
      oddsMarketForTrustedAnalytics,
      outcomeName,
      poissonGoalModel,
      providerDataReliabilitySummary,
      publicDataCapabilities,
      recordGrowthEvent,
      recordHistory,
      recordNewsImpactFailure,
      recordNewsImpactOutcome,
      recordNewsImpactRecoveryAttempt,
      recordOpsEvent,
      redactOpsString,
      refereeProfile,
      refundAnalysisQuota,
      refundEntitlementUsage,
      releaseDistributedAnalysisLock,
      reserveAnalysisQuota,
      reserveEntitlementUsage,
      resolveUserEntitlements,
      sanitizeAvailabilityRows,
      saveOddsSnapshot,
      secondaryOddsMarket,
      selectNewsImpactRecoveryStrategy,
      setCache,
      settlePredictionsFromFixtures,
      tavilySearch,
      temperatureScaleProbabilities,
      usableOddsFeatureMeta,
      userHasAnalyzedFixture,
      validateFixtureIntegrity,
      waitForSharedAnalysis,
    });
  }
  return analysisRuntime;
}

const apiAnalyze = async (request, cfg, user) => getAnalysisRuntime().apiAnalyze(request, cfg, user);

const releaseFieldEvidenceRuntime=createReleaseFieldEvidenceRuntime({
  hasSupabase,
  appVersion:APP_VERSION,
  fetchWithTimeout,
  supaHeaders,
  supaSelectMany,
  recordOpsEvent,
  loadSharedProviderState,
  apiFootball,
  isFootballRateLimitError,
  providerSnapshot,
});

const { scheduleReleaseFieldEvidence }=releaseFieldEvidenceRuntime;

const publicStatusRuntime=createPublicStatusRuntime({
  loadRuntimeControls,
  publicRuntimeControls,
  providerCooldownUntil:()=>Number(memory.provider?.cooldownUntil || 0),
  currentReleaseIdentity,
  readCompositeReadiness,
  scheduleReleaseFieldEvidence,
  version:APP_VERSION,
  releaseCandidate:RC_NAME,
  expectedSchemaContractVersion:EXPECTED_SCHEMA_CONTRACT_VERSION,
  expectedSchemaFingerprint:EXPECTED_SCHEMA_FINGERPRINT,
});

const publicHealthRuntime=createPublicHealthRuntime({
  computeReadiness:publicStatusRuntime.computeReadinessSnapshot,
  version:APP_VERSION,
  releaseCandidate:RC_NAME,
});

const publicStatusRouter=createPublicStatusRouter({
  publicStatusRuntime,
  publicHealthRuntime,
  appManifest,
  loadRuntimeControls,
  publicRuntimeControls,
  runtimeControlsCacheMs:RUNTIME_CONTROLS_CACHE_MS,
  json,
});

const processTelegramUpdate = createTelegramUpdateProcessor({
  loadRuntimeControls,
  telegramLockdownDecision,
  telegramApi,
  json,
  parseInvoicePayload,
  billingPlanConfig,
  parsePassInvoicePayload,
  passProductConfig,
  setBotDigestSubscription,
  telegramWebAppUrl,
  recordGrowthEvent,
  footballBotKeyboard,
  sendBotDayMatches,
  cleanNewsImpactDecisionCode,
  cleanNewsImpactActionCode,
  cleanNewsImpactRecoveryCode,
  recordNewsImpactRecoveryAttempt,
  sendGeneralFootballNews,
  recordNewsImpactOutcome,
  sendNewsImpactRecoveryMessage,
  sendBotFixtureShareCard,
  sendBotFixtureSection,
  newsPublishedAtFromDayToken,
  newsTeamByToken,
  botRemoteTeamMatches,
  newsRelevantFixture,
  newsTeamToken,
  sendBotFootballSearch,
  sendFavoriteTeamNews,
  toggleBotFavorite,
  loadBotFixtureCard,
  getFavorites,
  footballMatchActionKeyboard,
  setCache,
  postMatchReturnDisabledKey,
  memory,
  hasSupabase,
  supaDelete,
  applySuccessfulPayment,
  applyRefundedPayment,
  updateUserSubscription,
  telegramStartPayload,
  upsertUser,
  parseLaunchStartParam,
  ensureLaunchAttribution,
  applyReferralAttribution,
  configureFootballBot,
  sendBotFixtureMenu,
  sendFootballBotHome,
  footballBotMoreKeyboard,
  sendFootballBotHelp,
  sendBotFavoriteTeams,
  sendBotFavoriteTeamMatches,
  sendDailyPicks,
  sendLastAiVerdict,
  sendBotAiTrackRecord,
  sendDigestControls,
});

const TELEGRAM_WEBHOOK_DEPS = Object.freeze({
  claimTelegramUpdate,
  claimTelegramUpdatePersistent,
  completeTelegramUpdate,
  completeTelegramUpdatePersistent,
  constantTimeEqual,
  enforceTelegramBurst,
  json,
  processTelegramUpdate,
  releaseTelegramUpdate,
  releaseTelegramUpdatePersistent,
  telegramApi,
});
const handleTelegramWebhook = createTelegramWebhookHandler(TELEGRAM_WEBHOOK_DEPS);

const {
  buildModelRemediationReport,
  buildPredictionIntegrity,
  captureModelPrediction,
  modelIntegritySelfTest,
  modelQualityEligibleRow,
  modelRemediationSelfTest,
  noteSettlementWatchdogOutcome,
  probeSettlementAdjudicationSchema,
  probeSettlementFinalitySchema,
  probeSettlementReliabilitySchema,
  probeSettlementRunLedgerSchema,
  probeSettlementTrustSchema,
  probeSettlementWatchdogSchema,
  recordRemediationAction,
  resetSettlementCircuit,
  resolveSettlementDrift,
  runSettlementFinalityVerification,
  runSettlementWatchdog,
  settleBacktestDaily,
  settlePredictionsFromFixtures,
  settlementDriftAdjudicationSelfTest,
  settlementDriftBeforeSnapshot,
  settlementDriftProviderSnapshot,
  settlementFinalitySelfTest,
  settlementRunLedgerSelfTest,
  settlementWatchdogSelfTest,
  trustedMetricsGateSelfTest,
  verifiedBrierScore,
  verifiedSettledRows,
} = createSettlementRuntime({
  APP_VERSION,
  DEFAULT_RUNTIME_CONTROLS,
  SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD,
  SETTLEMENT_CIRCUIT_OPEN_HOURS,
  SETTLEMENT_DRIFT_ACTIONS,
  SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS,
  SETTLEMENT_FINALITY_DELAY_HOURS,
  SETTLEMENT_FINALITY_DRIFT_STATUSES,
  SETTLEMENT_FINALITY_LOOKBACK_DAYS,
  SETTLEMENT_FINALITY_MAX_DATES,
  SETTLEMENT_FINALITY_MAX_FIXTURES,
  SETTLEMENT_RUN_MAX_ATTEMPTS,
  SETTLEMENT_RUN_STALE_MINUTES,
  SUPABASE_SCHEMA_GUIDANCE,
  actualOutcomeFromGoals,
  brierFromProbabilities,
  buildSettlementDriftResolution,
  bytesToHex,
  enc,
  fetchWithTimeout,
  fixtureIdentity,
  fixtureStatusShort,
  freeQuotaHealthy,
  getCache,
  hasSupabase,
  isFinishedStatus,
  loadProviderFixturesForDate,
  loadRuntimeControls,
  memory,
  parseJsonObject,
  predictionOutcomeKey,
  probeOptionalTable,
  providerSnapshot,
  recordOpsEvent,
  redactOpsString,
  regulationScore,
  scoreBrier,
  setCache,
  signalProbabilitySnapshot,
  stalePredictionCandidates,
  supaHeaders,
  supaInsertIgnore,
  supaPatch,
  supaSelectMany,
  supaSelectOne,
  supaSelectPaged,
  supaUpsert,
  todayUtc,
});

const {
  apiCalibrationControl,
  apiDiagnostics,
  apiModelQuality,
  apiModelRemediation,
  apiProductionMonitor,
  apiProviderBudget,
  apiProviderCoverageAudit,
  apiProviderE2EValidation,
  apiProviderProbe,
  apiRcRegression,
  apiReleaseReadiness,
  apiReminderHealth,
} = createAdminOperationalApi({
  API_CONTRACT_VERSION,
  APP_VERSION,
  DEVELOPMENT_TELEGRAM_ID,
  MIN_CLIENT_VERSION,
  PROVIDER_FEATURE_TTLS,
  RC_NAME,
  RELEASE_CHANNEL,
  SUPABASE_SCHEMA_GUIDANCE,
  analysisQualityGateSelfTest,
  apiFavoritePlayers,
  apiFavorites,
  apiFootball,
  apiHistory,
  apiMatchCenter,
  apiMe,
  apiPreferences,
  apiProductionReadiness,
  apiReminders,
  appManifest,
  average,
  averageMetric,
  baselineCalibrationProfile,
  brierFromProbabilities,
  buildModelDashboard,
  buildModelRemediationReport,
  buildPredictionIntegrity,
  calibrationPromotionSelfTest,
  collectDiagnostics,
  fixtureIdentity,
  fixtureStatusShort,
  freeQuotaHealthy,
  getCache,
  getCalibrationProfile,
  hasSupabase,
  isAdminUser,
  isCalibrationRevisionConflict,
  isFinishedStatus,
  isFootballRateLimitError,
  json,
  loadCalibrationLifecycleState,
  loadLastProviderE2E,
  loadProviderFixturesForDate,
  loadRuntimeControls,
  logLossFromProbabilities,
  memory,
  modelIntegritySelfTest,
  modelRemediationSelfTest,
  modelVersionName,
  noteSettlementWatchdogOutcome,
  notifyCalibrationAdmins,
  pct,
  predictionOutcomeLabel,
  probeCalibrationLifecycleSchema,
  probeCalibrationPromotionSchema,
  probeOptionalTable,
  probeReminderReliabilitySchema,
  probeRuntimeHistorySchema,
  probeSettlementAdjudicationSchema,
  probeSettlementFinalitySchema,
  probeSettlementReliabilitySchema,
  probeSettlementRunLedgerSchema,
  probeSettlementTrustSchema,
  probeSettlementWatchdogSchema,
  probeSupabaseSchemaDriftConfirmed,
  productionSafetySnapshot,
  providerAuditCall,
  providerAuditEndpointPlan,
  providerAuditScore,
  providerBudgetProfile,
  providerDataReliabilitySelfTest,
  providerEndpointLabel,
  providerFeatureFetch,
  providerSnapshot,
  providerTransitionProfile,
  providerValidationStatus,
  providerValidationStep,
  publicCalibrationControlState,
  qualityBucket,
  rcCheck,
  rcReadRoute,
  readBackendSecurityContract,
  recordOpsEvent,
  recordRemediationAction,
  redactOpsString,
  releaseCheck,
  reminderDeliveryStatus,
  resetSettlementCircuit,
  resolveSettlementDrift,
  responseJsonSafe,
  rowFinalProbabilities,
  rowRawProbabilities,
  runProductionMonitor,
  saveCalibrationLifecycleState,
  saveProviderE2E,
  sendTelegramMessage,
  setCache,
  settlePredictionsFromFixtures,
  settlementDriftAdjudicationSelfTest,
  settlementFinalitySelfTest,
  settlementRunLedgerSelfTest,
  settlementWatchdogSelfTest,
  signalCalibrationStats,
  supaSelectMany,
  supabaseProbeConfirmationSelfTest,
  supabaseSchemaDriftSelfTest,
  supabaseSchemaProbeConfirmationSelfTest,
  telegramDedupeObservabilitySelfTest,
  telegramMiniAppE2EDrill,
  telegramPersistentDedupeSelfTest,
  topProbabilityValue,
  trustedMetricsGateSelfTest,
  verifiedBrierScore,
  verifiedSettledRows,
  weightedTopCalibrationError,
});

const API_ROUTE_DEPS = Object.freeze({
  adminForbidden,
  apiAiTrackRecord,
  apiAnalyze,
  apiBetaDashboard,
  apiBetaFeedback,
  apiChannelPublisherTest,
  apiPhase5Dashboard,
  apiBillingInvoice,
  apiBillingRefund,
  apiBillingRefundLookup,
  apiBillingPlans,
  apiBillingSubscription,
  apiBillingSync,
  apiCalibrationControl,
  apiClientTelemetry,
  apiDataIntegrity,
  apiDiagnostics,
  apiDigestSettings,
  apiEntitlements,
  apiFavoritePlayers,
  apiFavorites,
  apiFixtureShareLink,
  apiHistory,
  apiHistoryAnalysis,
  apiLaunchFunnel,
  apiMatchCenter,
  apiMatches,
  apiMe,
  apiMediaPublisherLink,
  apiModelQuality,
  apiModelRemediation,
  apiNewsImpactRecoveryIncidentAck,
  apiPostDeployRegressionResponse,
  apiPreferences,
  apiProductionMonitor,
  apiProductionReadiness,
  apiProviderBudget,
  apiProviderCoverageAudit,
  apiProviderE2EValidation,
  apiProviderProbe,
  apiRcRegression,
  apiReleaseMonitor,
  apiReleaseReadiness,
  apiReminderHealth,
  apiReminders,
  apiRuntimeControls,
  apiRuntimeRollback,
  apiSearch,
  apiTeam,
  apiTeamIntelligence,
  apiTeamSquad,
  apiTournament,
  isAdminUser,
  json,
  loadLastProviderE2E,
  memory,
  providerBudgetProfile,
  providerSnapshot,
  providerSloReport,
  providerTransitionProfile,
  publicDataCapabilities,
});

const { handleScheduled } = createScheduledJobsRuntime({
  settleBacktestDaily,
  processDueReminders,
  processLineupNotifications,
  processImportantChangeNotifications,
  processSmartNotifications,
  processPostMatchReturns,
  runProductionMonitor,
  processDailyDigests,
  cleanupOpsEvents,
  cleanupRateWindows,
  cleanupScheduledJobLeases,
  cleanupGrowthEvents,
  cleanupIntegrityData,
  runSettlementWatchdog,
  runSettlementFinalityVerification,
  recordOpsEvent,
  claimScheduledJob,
  completeScheduledJob,
  releaseScheduledJob,
});

export default {
  async fetch(request, env, ctx) {
    const cfg = config(env);
    if (ctx?.waitUntil) cfg.waitUntil = promise => ctx.waitUntil(Promise.resolve(promise));
    const url = new URL(request.url);

    const edgeGuard = await cloudflareEdgeGuard(request, env);
    if (edgeGuard.blocked) {
      if (edgeGuard.kind === 'scanner') bumpTelemetry('edgeScannerBlocks');
      else bumpTelemetry('edgeRateLimitBlocks');
      const minuteBucket = new Date().toISOString().slice(0, 16);
      await recordOpsEvent(cfg, {
        severity: 'warning',
        source: 'security',
        eventType: edgeGuard.kind === 'scanner' ? 'edge_scanner_block' : 'edge_rate_limit',
        code: edgeGuard.code,
        message: edgeGuard.kind === 'scanner'
          ? 'Obvious scanner traffic was rejected at the earliest Worker boundary.'
          : 'Cloudflare edge rate limiter rejected an abusive request burst.',
        endpoint: url.pathname,
        status: edgeGuard.status,
        transitionKey: `edge-security:${edgeGuard.policy || edgeGuard.kind}:${url.pathname}:${minuteBucket}`,
        meta: {
          policy: edgeGuard.policy || '',
          kind: edgeGuard.kind || '',
          retryAfter: Number(edgeGuard.retryAfter || 0) || null,
          minuteBucket,
        },
      }).catch(() => {});
      return json({
        error: edgeGuard.kind === 'scanner' ? 'Not found.' : 'Слишком много запросов. Повторите позже.',
        code: edgeGuard.code,
        retryAfter: Number(edgeGuard.retryAfter || 0) || undefined,
      }, edgeGuard.status, edgeGuard.retryAfter ? { 'retry-after': String(edgeGuard.retryAfter) } : {});
    }
    if (edgeGuard.degraded) {
      bumpTelemetry('edgeRateLimitFallbacks');
      const now = Date.now();
      if (now - Number(memory.edgeRateLimitWarningAt || 0) >= 60_000) {
        memory.edgeRateLimitWarningAt = now;
        await recordOpsEvent(cfg, {
          severity: 'warning',
          source: 'security',
          eventType: 'edge_rate_limit',
          code: 'EDGE_RATE_LIMIT_DEGRADED',
          message: 'Cloudflare rate-limit binding was unavailable; existing Worker guards remain active.',
          endpoint: url.pathname,
          meta: { policy: edgeGuard.policy || '', configured: Boolean(edgeGuard.configured) },
        }).catch(() => {});
      }
    }

    const securityShape=await preAuthRequestShapeDecision(request,{
      api:url.pathname.startsWith('/api/'),
      webhook:url.pathname==='/telegram/webhook',
    });
    if (!securityShape.allowed) {
      if (securityShape.code==='REQUEST_TOO_LARGE' || securityShape.code==='TELEGRAM_INIT_DATA_TOO_LARGE') bumpTelemetry('securityOversizeBlocks');
      else if (String(securityShape.code || '').includes('CROSS_')) bumpTelemetry('securityCrossOriginBlocks');
      else bumpTelemetry('securityShapeBlocks');
      const minuteBucket=new Date().toISOString().slice(0,16);
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'security',
        eventType:'request_guard',
        code:String(securityShape.code || 'REQUEST_REJECTED'),
        message:'Public request blocked by the pre-auth security gate.',
        endpoint:url.pathname,
        status:Number(securityShape.status || 400),
        transitionKey:'security-request-guard:' + String(securityShape.code || 'REQUEST_REJECTED') + ':' + minuteBucket,
        meta:{
          method:String(request.method || 'GET').toUpperCase(),
          minuteBucket,
        },
      }).catch(()=>{});
      return json({
        error:securityShape.error || 'Запрос отклонён.',
        code:securityShape.code || 'REQUEST_REJECTED',
      },securityShape.status || 400);
    }

    const publicStatusResponse=await publicStatusRouter.handle(request,url,cfg);
    if (publicStatusResponse) return publicStatusResponse;

    if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
      try {
        return await handleTelegramWebhook(request, cfg);
      } catch (error) {
        const retry = Boolean(error?.telegramWebhookRetry);
        const disposition = error?.telegramWebhookDisposition || {};
        const status = retry ? 503 : 200;
        console.error('telegram webhook', redactOpsString(error?.message || error, 240));
        bumpTelemetry('routeErrors');
        await recordOpsEvent(cfg, {
          severity: 'error',
          source: 'telegram',
          eventType: 'webhook',
          code: retry ? 'TELEGRAM_WEBHOOK_RETRY' : 'TELEGRAM_WEBHOOK_SUPPRESSED_RETRY',
          message: error?.message || error,
          endpoint: '/telegram/webhook',
          status,
          meta: {
            errorCode: String(error?.code || ''),
            retry,
            successfulEffects: Number(disposition?.successfulEffects || 0),
            unsafeMutations: Number(disposition?.unsafeMutations || 0),
            lastEffect: String(disposition?.lastEffect || ''),
            lastMutation: String(disposition?.lastMutation || ''),
          },
        });
        return json(
          retry ? { ok: false, retry: true } : { ok: false },
          status,
          retry && Number(disposition?.retryAfter || 0) > 0
            ? { 'retry-after': String(Math.max(1, Number(disposition.retryAfter))) }
            : {},
        );
      }
    }

    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    const distributedPreAuthResponse=await enforceDistributedPreAuthRateLimit({
      request,
      cfg,
      adminSensitive:isAdminSensitivePath(url.pathname),
      fingerprintSecret:cfg.botToken,
      hasSupabase,
      supaRpc,
      bumpTelemetry,
      recordOpsEvent,
      json,
    });
    if (distributedPreAuthResponse) return distributedPreAuthResponse;

    try {
      const user = await getRequestUser(request, cfg);
      if (!user) {
        const abuseGuard=createPreAuthAbuseGuard({
          memory,
          fingerprintSecret:cfg.botToken,
          bumpTelemetry,
          recordOpsEvent:event=>recordOpsEvent(cfg,event),
        });
        const abuse=await abuseGuard.registerInvalidAuthFailure(request,{
          adminSensitive:isAdminSensitivePath(url.pathname),
        });
        if (abuse.blocked) {
          return json({
            error:'Слишком много неуспешных попыток авторизации. Повторите позже.',
            code:'INVALID_AUTH_BURST',
            retryAfter:abuse.retryAfter,
          },429,{'retry-after':String(abuse.retryAfter)});
        }
      }
      if (!user) return json({ error: 'Откройте мини-приложение внутри Telegram.' }, 401);

      const betaAccess = closedBetaAccessDecision(user, cfg);
      if (!betaAccess.allowed) {
        await recordOpsEvent(cfg,{
          severity:'warning',
          source:'access',
          eventType:'closed_beta_access',
          code:'CLOSED_BETA_ACCESS_DENIED',
          message:'Authenticated Telegram user was blocked before normal-user API routing.',
          endpoint:url.pathname,
          status:403,
          meta:{
            betaAccessConfigured:String(cfg.betaAccessConfigured || 'missing'),
            strictEffective:Boolean(cfg.betaAccessEnabled),
            betaParticipant:false,
            betaAllowlistCount:Number(cfg.betaTelegramIds?.length || 0),
            providerRequests:0,
          },
        }).catch(()=>null);
        return json({ error: 'Доступ к закрытой beta пока не выдан.', code: 'CLOSED_BETA_ACCESS_REQUIRED' }, 403);
      }

      cfg.phase5Validation = await phase5ValidationContext(request,user,cfg,url);
      cfg.phase5ProviderUsage = {networkRequests:0,cacheHits:0,staleCacheHits:0,quotaBlocks:0,sharedCooldowns:0};

      const runtimeState = await loadRuntimeControls(cfg);
      const runtimeResponse = runtimeGuard(request, user, cfg, runtimeState.value);
      if (runtimeResponse) return runtimeResponse;

      const burstResponse = enforceRouteBurst(request, user);
      if (burstResponse) return burstResponse;

      const distributedBurstResponse = await enforceDistributedAccountRateLimit({
        request,
        user,
        cfg,
        hasSupabase,
        supaRpc,
        bumpTelemetry,
        recordOpsEvent,
        json,
        memory,
      });
      if (distributedBurstResponse) return distributedBurstResponse;

      try {
        return await dispatchApiRoute(request, url, cfg, user, API_ROUTE_DEPS);
      } finally {
        await recordPhase5ProviderRequestSummary(cfg).catch(()=>null);
      }
    } catch (error) {
      console.error('api route', redactOpsString(error?.message || error, 240));
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
        ...(error?.newsImpactRecovery ? {newsImpactRecovery:error.newsImpactRecovery} : {}),
        provider: publicDataCapabilities(),
      }, publicError.status, publicError.body.retryAfter ? { 'retry-after': String(publicError.body.retryAfter) } : {});
    }
  },

  async scheduled(controller, env, ctx) {
    const cfg = config(env);
    if (ctx?.waitUntil) cfg.waitUntil = promise => ctx.waitUntil(Promise.resolve(promise));
    const runtimeState = await loadRuntimeControls(cfg, { force: true });
    if (isSecurityLockdownControls(runtimeState.value)) {
      const hourBucket = new Date(Number(controller?.scheduledTime || Date.now())).toISOString().slice(0, 13);
      await recordOpsEvent(cfg, {
        severity: 'warning',
        source: 'release',
        eventType: 'security_lockdown_cron',
        code: 'SECURITY_LOCKDOWN_SCHEDULED_TASKS_PAUSED',
        message: 'Плановые фоновые задачи пропущены из-за активного Security Lockdown.',
        transitionKey: `security-lockdown:cron:${hourBucket}`,
        meta: {
          hourBucket,
          controlPlaneFailClosed: Boolean(runtimeState.value?.controlPlaneFailClosed),
          runtimeSource: String(runtimeState.source || ''),
        },
      }).catch(() => {});
      return undefined;
    }

    const scheduledAt = new Date(Number(controller?.scheduledTime || Date.now()));
    if (Number.isFinite(scheduledAt.getTime()) && scheduledAt.getUTCMinutes() % 15 === 0) {
      const reconciliation = reconcileAnalysisUsageReservations(cfg);
      if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(reconciliation);
      else await reconciliation;
    }

    return handleScheduled(controller, cfg, ctx);
  },
};
