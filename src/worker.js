import { createTelegramWebhookHandler } from './telegram-transport.js';
import { createReminderDeliveryRuntime } from './reminder-delivery-runtime.js';
import { createTelegramDigestRuntime } from './telegram-digest-runtime.js';
import { createMarketParsingRuntime } from './market-parsing-runtime.js';
import { createReleaseMonitorApiRuntime } from './release-monitor-api-runtime.js';
import { createProviderBudgetRuntime } from './provider-budget-runtime.js';
import { createReleaseReadinessRuntime } from './release-readiness-runtime.js';
import { createSupabaseReadinessRuntime } from './supabase-readiness-runtime.js';
import { createOddsSnapshotRuntime } from './odds-snapshot-runtime.js';
import { createUserDataApiRuntime } from './user-data-api-runtime.js';
import { createBillingRuntime } from './billing-runtime.js';
import { createBillingApiRuntime } from './billing-api-runtime.js';
import { createClientTelemetryRuntime } from './client-telemetry-runtime.js';
import { createBetaPhase5Runtime } from './beta-phase5-runtime.js';
import { createProviderSloRuntime } from './provider-slo-runtime.js';
import { createProductionMonitorRuntime } from './production-monitor-runtime.js';
import { createSupabaseSchemaRuntime } from './supabase-schema-runtime.js';
import { createFootballNewsRuntime } from './football-news-runtime.js';
import { createNewsImpactRecoveryRuntime } from './news-impact-recovery-runtime.js';
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
import { createPredictionMathRuntime } from './prediction-math-runtime.js';
import { createCalibrationRuntime } from './calibration-runtime.js';
import { createModelEvaluationRuntime } from './model-evaluation-runtime.js';
import { createProviderFixtureRuntime } from './provider-fixture-runtime.js';
import { createProviderDataRuntime } from './provider-data-runtime.js';
import { createAnalysisRuntime } from './analysis-runtime.js';
import { createDistributedAnalysisLockRuntime } from './distributed-analysis-lock-runtime.js';
import { createMatchCenterRuntime } from './match-center-runtime.js';
import { createTelegramUpdateProcessor } from './telegram-update-orchestration.js';
import { createTelegramBotUiRuntime } from './telegram-bot-ui-runtime.js';
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
import { createPublisherRuntime } from './publisher-runtime.js';
import { createChannelPublishIdempotencyRuntime } from './channel-publish-idempotency-runtime.js';
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
import { createSettlementSupportRuntime } from './settlement-support-runtime.js';
import { createPostMatchReturnRuntime } from './post-match-return-runtime.js';
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
import { createAiTimelineRuntime } from './ai-timeline-runtime.js';
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

let billingRuntime = null;
function getBillingRuntime() {
  if (!billingRuntime) {
    billingRuntime = createBillingRuntime({
      BILLING_PLANS,
      STAR_SYNC_MAX_PAGES,
      STAR_SYNC_PAGE_SIZE,
      SUBSCRIPTION_PERIOD_SECONDS,
      activatePassPurchase,
      bytesToHex,
      constantTimeEqual,
      fetchWithTimeout,
      getQuota,
      getUserRecord,
      hasSupabase,
      hmacSha256,
      listUserEntitlements,
      markTelegramWebhookEffect,
      markTelegramWebhookMutation,
      memory,
      parsePassInvoicePayload,
      passProductConfig,
      recordOpsEvent,
      recordReferredPayment,
      refundPassByCharge,
      supaPatch,
      supaSelectOne,
      supaUpsert
    });
  }
  return billingRuntime;
}

function billingPlanConfig(...args) { return getBillingRuntime().billingPlanConfig(...args); }
function invoiceSignature(...args) { return getBillingRuntime().invoiceSignature(...args); }
function makeInvoicePayload(...args) { return getBillingRuntime().makeInvoicePayload(...args); }
function parseInvoicePayload(...args) { return getBillingRuntime().parseInvoicePayload(...args); }
function telegramApi(...args) { return getBillingRuntime().telegramApi(...args); }
function updateUserSubscription(...args) { return getBillingRuntime().updateUserSubscription(...args); }
function saveBillingPayment(...args) { return getBillingRuntime().saveBillingPayment(...args); }
function findRefundableBillingCharge(...args) { return getBillingRuntime().findRefundableBillingCharge(...args); }
function applyRefundedPayment(...args) { return getBillingRuntime().applyRefundedPayment(...args); }
function applySuccessfulPayment(...args) { return getBillingRuntime().applySuccessfulPayment(...args); }
function billingWebhookStatus(...args) { return getBillingRuntime().billingWebhookStatus(...args); }
function loadStarTransactionsForSync(...args) { return getBillingRuntime().loadStarTransactionsForSync(...args); }
function syncBillingFromStars(...args) { return getBillingRuntime().syncBillingFromStars(...args); }

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


let publisherRuntime = null;
function getPublisherRuntime() {
  if (!publisherRuntime) {
    publisherRuntime = createPublisherRuntime({
      adminForbidden,
      botFixtureDateTime,
      campaignStartParam,
      channelPublisherState,
      claimChannelPublishIdempotency,
      cleanLaunchPart,
      completeChannelPublishIdempotency,
      ensureReferralCode,
      fixtureShareStartParam,
      fixtureTelegramDeepLink,
      getCache,
      isAdminUser,
      json,
      loadBotFixtureCard,
      normalizeBotFixtureCard,
      parseLaunchStartParam,
      publishChannelMessage,
      readJson,
      recordGrowthEvent,
      recordOpsEvent,
      redactOpsString,
      releaseChannelPublishIdempotency,
      telegramApi,
      telegramCampaignDeepLink,
      telegramFullAnalysisUrl,
      telegramHtmlEscape,
      telegramShareComposerUrl
    });
  }
  return publisherRuntime;
}

function apiFixtureShareLink(...args) { return getPublisherRuntime().apiFixtureShareLink(...args); }
function fixtureShareCardText(...args) { return getPublisherRuntime().fixtureShareCardText(...args); }
function sendBotFixtureShareCard(...args) { return getPublisherRuntime().sendBotFixtureShareCard(...args); }
function apiChannelPublisherTest(...args) { return getPublisherRuntime().apiChannelPublisherTest(...args); }
function fixtureDeepLinkDrill(...args) { return getPublisherRuntime().fixtureDeepLinkDrill(...args); }
function mediaPublisherCopy(...args) { return getPublisherRuntime().mediaPublisherCopy(...args); }
function campaignPublisherCopy(...args) { return getPublisherRuntime().campaignPublisherCopy(...args); }
function apiMediaPublisherLink(...args) { return getPublisherRuntime().apiMediaPublisherLink(...args); }
function mediaPublisherDrill(...args) { return getPublisherRuntime().mediaPublisherDrill(...args); }

let telegramBotUiRuntime = null;
function getTelegramBotUiRuntime() {
  if (!telegramBotUiRuntime) {
    telegramBotUiRuntime = createTelegramBotUiRuntime({
      apiAnalyze,
      botAiHandoffText,
      freeQuotaHealthy,
      getCache,
      getFavorites,
      isFinishedStatus,
      isLiveStatus,
      loadProviderFixture,
      markTelegramWebhookMutation,
      newsImpactDecisionCard,
      newsImpactDecisionKeyboard,
      recordGrowthEvent,
      setCache,
      statusLabel,
      telegramApi,
      telegramFullAnalysisUrl,
      telegramHtmlEscape,
      telegramWebAppUrl
    });
  }
  return telegramBotUiRuntime;
}

function publicSiteUrl(...args) { return getTelegramBotUiRuntime().publicSiteUrl(...args); }
function footballBotKeyboard(...args) { return getTelegramBotUiRuntime().footballBotKeyboard(...args); }
function footballBotMoreKeyboard(...args) { return getTelegramBotUiRuntime().footballBotMoreKeyboard(...args); }
function favoriteTeamIdSet(...args) { return getTelegramBotUiRuntime().favoriteTeamIdSet(...args); }
function favoriteMatchTeamRow(...args) { return getTelegramBotUiRuntime().favoriteMatchTeamRow(...args); }
function footballMatchActionKeyboard(...args) { return getTelegramBotUiRuntime().footballMatchActionKeyboard(...args); }
function footballQuickAiHandoffKeyboard(...args) { return getTelegramBotUiRuntime().footballQuickAiHandoffKeyboard(...args); }
function footballSearchHandoffKeyboard(...args) { return getTelegramBotUiRuntime().footballSearchHandoffKeyboard(...args); }
function normalizeBotFixtureCard(...args) { return getTelegramBotUiRuntime().normalizeBotFixtureCard(...args); }
function rememberBotFixtureCards(...args) { return getTelegramBotUiRuntime().rememberBotFixtureCards(...args); }
function loadBotTeamCard(...args) { return getTelegramBotUiRuntime().loadBotTeamCard(...args); }
function loadBotFixtureCard(...args) { return getTelegramBotUiRuntime().loadBotFixtureCard(...args); }
function botFixtureDateTime(...args) { return getTelegramBotUiRuntime().botFixtureDateTime(...args); }
function botFixtureCardText(...args) { return getTelegramBotUiRuntime().botFixtureCardText(...args); }
function botAnalyzeFixtureDefault(...args) { return getTelegramBotUiRuntime().botAnalyzeFixtureDefault(...args); }
function sendBotFixtureMenu(...args) { return getTelegramBotUiRuntime().sendBotFixtureMenu(...args); }
function botAnalyzeFixture(...args) { return getTelegramBotUiRuntime().botAnalyzeFixture(...args); }
function botAiVerdictText(...args) { return getTelegramBotUiRuntime().botAiVerdictText(...args); }

let newsImpactRecoveryRuntime = null;
function getNewsImpactRecoveryRuntime() {
  if (!newsImpactRecoveryRuntime) {
    newsImpactRecoveryRuntime = createNewsImpactRecoveryRuntime({
      NEWS_IMPACT_ACTION_CODES,
      NEWS_IMPACT_ACTION_LABELS,
      NEWS_IMPACT_ACTION_WINDOW_MINUTES,
      NEWS_IMPACT_DECISION_CODES,
      NEWS_IMPACT_FAILURE_CODES,
      NEWS_IMPACT_FAILURE_LABELS,
      NEWS_IMPACT_FUNNEL_DECISIONS,
      NEWS_IMPACT_FUNNEL_MIN_USERS,
      NEWS_IMPACT_FUNNEL_STABLE_USERS,
      NEWS_IMPACT_OUTCOME_CODES,
      NEWS_IMPACT_OUTCOME_WINDOW_MINUTES,
      NEWS_IMPACT_RECOVERY_CODES,
      NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS,
      NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS,
      NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS,
      NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
      NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT,
      NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
      NEWS_IMPACT_RECOVERY_INCIDENT_CODES,
      NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
      NEWS_IMPACT_RECOVERY_LABELS,
      NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES,
      NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS,
      NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS,
      NEWS_IMPACT_RECOVERY_STRATEGY_CACHE_MS,
      NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES,
      NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS,
      NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS,
      NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS,
      NEWS_IMPACT_RECOVERY_WINDOW_MINUTES,
      favoriteMatchTeamRow,
      footballBotKeyboard,
      hasSupabase,
      isFootballRateLimitError,
      memory,
      recordGrowthEvent,
      supaSelectPaged,
      telegramAnalysisHandoffParams,
      telegramApi,
      telegramWebAppUrl
    });
  }
  return newsImpactRecoveryRuntime;
}

function newsImpactDecisionCard(...args) { return getNewsImpactRecoveryRuntime().newsImpactDecisionCard(...args); }
function cleanNewsImpactDecisionCode(...args) { return getNewsImpactRecoveryRuntime().cleanNewsImpactDecisionCode(...args); }
function cleanNewsImpactActionCode(...args) { return getNewsImpactRecoveryRuntime().cleanNewsImpactActionCode(...args); }
function newsImpactActionCallback(...args) { return getNewsImpactRecoveryRuntime().newsImpactActionCallback(...args); }
function newsImpactTrackedAnalysisUrl(...args) { return getNewsImpactRecoveryRuntime().newsImpactTrackedAnalysisUrl(...args); }
function cleanNewsImpactRecoveryCode(...args) { return getNewsImpactRecoveryRuntime().cleanNewsImpactRecoveryCode(...args); }
function newsImpactRecoveryCallback(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryCallback(...args); }
function newsImpactRecoveryAnalysisUrl(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryAnalysisUrl(...args); }
function newsImpactActionDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactActionDrill(...args); }
function newsImpactRowDecision(...args) { return getNewsImpactRecoveryRuntime().newsImpactRowDecision(...args); }
function newsImpactRowAction(...args) { return getNewsImpactRecoveryRuntime().newsImpactRowAction(...args); }
function newsImpactConversionConfidence(...args) { return getNewsImpactRecoveryRuntime().newsImpactConversionConfidence(...args); }
function newsImpactEventTime(...args) { return getNewsImpactRecoveryRuntime().newsImpactEventTime(...args); }
function buildNewsImpactActionFunnel(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactActionFunnel(...args); }
function newsImpactActionFunnelBottleneck(...args) { return getNewsImpactRecoveryRuntime().newsImpactActionFunnelBottleneck(...args); }
function newsImpactActionFunnelDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactActionFunnelDrill(...args); }
function newsImpactTemporalAttributionDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactTemporalAttributionDrill(...args); }
function newsImpactOutcomeCode(...args) { return getNewsImpactRecoveryRuntime().newsImpactOutcomeCode(...args); }
function recordNewsImpactOutcome(...args) { return getNewsImpactRecoveryRuntime().recordNewsImpactOutcome(...args); }
function newsImpactJourneyKey(...args) { return getNewsImpactRecoveryRuntime().newsImpactJourneyKey(...args); }
function buildNewsImpactActionOutcomeQuality(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactActionOutcomeQuality(...args); }
function newsImpactOutcomeBottleneck(...args) { return getNewsImpactRecoveryRuntime().newsImpactOutcomeBottleneck(...args); }
function newsImpactOutcomeQualityDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactOutcomeQualityDrill(...args); }
function newsImpactFailureCode(...args) { return getNewsImpactRecoveryRuntime().newsImpactFailureCode(...args); }
function newsImpactRecoveryForFailure(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryForFailure(...args); }
function recordNewsImpactFailure(...args) { return getNewsImpactRecoveryRuntime().recordNewsImpactFailure(...args); }
function buildNewsImpactFailureDiagnostics(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactFailureDiagnostics(...args); }
function newsImpactFailureDiagnosticsDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactFailureDiagnosticsDrill(...args); }
function recordNewsImpactRecoveryAttempt(...args) { return getNewsImpactRecoveryRuntime().recordNewsImpactRecoveryAttempt(...args); }
function newsImpactRecoveryJourneyKey(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryJourneyKey(...args); }
function buildNewsImpactRecoveryEffectiveness(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryEffectiveness(...args); }
function newsImpactRecoveryBest(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryBest(...args); }
function newsImpactRecoveryEffectivenessDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryEffectivenessDrill(...args); }
function newsImpactRecoveryPresentation(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryPresentation(...args); }
function buildNewsImpactRecoveryStrategyEvidence(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryStrategyEvidence(...args); }
function newsImpactRecoveryStrategyDecision(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryStrategyDecision(...args); }
function buildNewsImpactRecoveryStrategyMatrix(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryStrategyMatrix(...args); }
function newsImpactRecoveryDriftDecision(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryDriftDecision(...args); }
function buildNewsImpactRecoveryDriftMatrix(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryDriftMatrix(...args); }
function buildNewsImpactRecoveryTransitionHistory(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryTransitionHistory(...args); }
function summarizeNewsImpactRecoveryTransitions(...args) { return getNewsImpactRecoveryRuntime().summarizeNewsImpactRecoveryTransitions(...args); }
function buildNewsImpactRecoveryAdminAlerts(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryAdminAlerts(...args); }
function summarizeNewsImpactRecoveryAlerts(...args) { return getNewsImpactRecoveryRuntime().summarizeNewsImpactRecoveryAlerts(...args); }
function buildNewsImpactRecoveryIncidentEvents(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentEvents(...args); }
function newsImpactRecoveryIncidentKey(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentKey(...args); }
function newsImpactRecoveryIncidentRunbook(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentRunbook(...args); }
function buildNewsImpactRecoveryIncidentAcknowledgements(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentAcknowledgements(...args); }
function buildNewsImpactRecoveryIncidentAcknowledgementHistory(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentAcknowledgementHistory(...args); }
function buildNewsImpactRecoveryIncidentEpisodeHistory(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentEpisodeHistory(...args); }
function newsImpactRecoveryEpisodeSloState(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryEpisodeSloState(...args); }
function newsImpactRecoverySloPct(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoverySloPct(...args); }
function buildNewsImpactRecoveryIncidentSloDashboard(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloDashboard(...args); }
function buildNewsImpactRecoveryIncidentSloBreachFeed(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloBreachFeed(...args); }
function buildNewsImpactRecoveryIncidentSloBreachWatchlist(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloBreachWatchlist(...args); }
function buildNewsImpactRecoveryIncidentSloBreachTriage(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloBreachTriage(...args); }
function newsImpactRecoveryIncidentTriageStageAt(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentTriageStageAt(...args); }
function buildNewsImpactRecoveryIncidentSloBreachTriageTrend(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloBreachTriageTrend(...args); }
function newsImpactRecoveryIncidentSloBurden(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloBurden(...args); }
function buildNewsImpactRecoveryIncidentSloBreachImpactRanking(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloBreachImpactRanking(...args); }
function newsImpactRecoveryIncidentOverdueWithinWindow(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentOverdueWithinWindow(...args); }
function buildNewsImpactRecoveryIncidentSloBreachImpactTrend(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloBreachImpactTrend(...args); }
function buildNewsImpactRecoveryIncidentSloImpactConcentration(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloImpactConcentration(...args); }
function buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(...args); }
function buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(...args); }
function buildNewsImpactRecoveryIncidentSloImpactFocusQueue(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloImpactFocusQueue(...args); }
function buildNewsImpactRecoveryIncidentCenter(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentCenter(...args); }
function summarizeNewsImpactRecoveryIncidents(...args) { return getNewsImpactRecoveryRuntime().summarizeNewsImpactRecoveryIncidents(...args); }
function loadNewsImpactRecoveryStrategyEvidence(...args) { return getNewsImpactRecoveryRuntime().loadNewsImpactRecoveryStrategyEvidence(...args); }
function selectNewsImpactRecoveryStrategy(...args) { return getNewsImpactRecoveryRuntime().selectNewsImpactRecoveryStrategy(...args); }
function newsImpactRecoveryStrategyDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryStrategyDrill(...args); }
function newsImpactRecoveryStabilityDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryStabilityDrill(...args); }
function newsImpactRecoveryDriftDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryDriftDrill(...args); }
function newsImpactRecoveryTransitionDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryTransitionDrill(...args); }
function newsImpactRecoveryIncidentDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentDrill(...args); }
function newsImpactRecoveryIncidentSloDashboardDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloDashboardDrill(...args); }
function newsImpactRecoveryIncidentSloBreachFeedDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloBreachFeedDrill(...args); }
function newsImpactRecoveryIncidentSloBreachWatchlistDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloBreachWatchlistDrill(...args); }
function newsImpactRecoveryIncidentSloBreachTriageDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloBreachTriageDrill(...args); }
function newsImpactRecoveryIncidentSloBreachTriageTrendDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloBreachTriageTrendDrill(...args); }
function newsImpactRecoveryIncidentSloBreachImpactRankingDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloBreachImpactRankingDrill(...args); }
function newsImpactRecoveryIncidentSloBreachImpactTrendDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloBreachImpactTrendDrill(...args); }
function newsImpactRecoveryIncidentSloImpactConcentrationDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloImpactConcentrationDrill(...args); }
function newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill(...args); }
function newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill(...args); }
function newsImpactRecoveryIncidentSloImpactFocusQueueDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloImpactFocusQueueDrill(...args); }
function newsImpactRecoveryIncidentSloDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloDrill(...args); }
function newsImpactRecoveryIncidentAckDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentAckDrill(...args); }
function newsImpactRecoveryKeyboard(...args) { return getNewsImpactRecoveryRuntime().newsImpactRecoveryKeyboard(...args); }
function sendNewsImpactRecoveryMessage(...args) { return getNewsImpactRecoveryRuntime().sendNewsImpactRecoveryMessage(...args); }
function newsImpactFunnelConfidenceDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactFunnelConfidenceDrill(...args); }
function newsImpactTrendSignal(...args) { return getNewsImpactRecoveryRuntime().newsImpactTrendSignal(...args); }
function buildNewsImpactActionTrend(...args) { return getNewsImpactRecoveryRuntime().buildNewsImpactActionTrend(...args); }
function newsImpactActionTrendDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactActionTrendDrill(...args); }
function newsImpactDecisionKeyboard(...args) { return getNewsImpactRecoveryRuntime().newsImpactDecisionKeyboard(...args); }
function newsImpactDecisionDrill(...args) { return getNewsImpactRecoveryRuntime().newsImpactDecisionDrill(...args); }

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

let telegramDigestRuntime = null;
function getTelegramDigestRuntime() {
  if (!telegramDigestRuntime) {
    telegramDigestRuntime = createTelegramDigestRuntime({
      DAILY_DIGEST_POLICY,
      SMART_NOTIFICATION_POLICY,
      apiFootball,
      assessDailyDigestRun,
      botMatchButtonText,
      bumpTelemetry,
      currentMorningFootballNews,
      filterSmartNotificationRecipients,
      footballBotKeyboard,
      freeQuotaHealthy,
      getAnalysisTimelineSnapshots,
      getCache,
      getFavorites,
      getStaleCache,
      hasSupabase,
      isFootballRateLimitError,
      isLiveStatus,
      isYouthReserveMatch,
      loadProviderFixturesForDate,
      markTelegramWebhookMutation,
      matchInterestScore,
      memory,
      morningNewsText,
      newsConversionKeyboard,
      normalizeBotFixtureCard,
      normalizeCompetition,
      planDailyDigestRecipients,
      radarStrongSignalState,
      recordOpsEvent,
      rememberBotFixtureCards,
      runBoundedDailyDigest,
      setCache,
      sleepMs,
      supaPatch,
      supaRpc,
      supaSelectOne,
      supaSelectPaged,
      supaUpsert,
      telegramApi,
      telegramHtmlEscape,
      todayUtc
    });
  }
  return telegramDigestRuntime;
}

function sendDigestControls(...args) { return getTelegramDigestRuntime().sendDigestControls(...args); }
function digestFixtureRows(...args) { return getTelegramDigestRuntime().digestFixtureRows(...args); }
function digestTime(...args) { return getTelegramDigestRuntime().digestTime(...args); }
function dailyDigestText(...args) { return getTelegramDigestRuntime().dailyDigestText(...args); }
function expandedDailyDigestText(...args) { return getTelegramDigestRuntime().expandedDailyDigestText(...args); }
function getBotDigestSubscription(...args) { return getTelegramDigestRuntime().getBotDigestSubscription(...args); }
function setBotDigestSubscription(...args) { return getTelegramDigestRuntime().setBotDigestSubscription(...args); }
function publicDigestSettings(...args) { return getTelegramDigestRuntime().publicDigestSettings(...args); }
function loadBotDigestSubscriptions(...args) { return getTelegramDigestRuntime().loadBotDigestSubscriptions(...args); }
function claimDigestDelivery(...args) { return getTelegramDigestRuntime().claimDigestDelivery(...args); }
function digestDeliverySealUntil(...args) { return getTelegramDigestRuntime().digestDeliverySealUntil(...args); }
function armDigestDelivery(...args) { return getTelegramDigestRuntime().armDigestDelivery(...args); }
function markDigestSent(...args) { return getTelegramDigestRuntime().markDigestSent(...args); }
function releaseDigestDelivery(...args) { return getTelegramDigestRuntime().releaseDigestDelivery(...args); }
function digestRowsFromMatchCache(...args) { return getTelegramDigestRuntime().digestRowsFromMatchCache(...args); }
function currentDailyDigest(...args) { return getTelegramDigestRuntime().currentDailyDigest(...args); }
function loadBotDayMatches(...args) { return getTelegramDigestRuntime().loadBotDayMatches(...args); }
function botDayMatchesText(...args) { return getTelegramDigestRuntime().botDayMatchesText(...args); }
function sendBotDayMatches(...args) { return getTelegramDigestRuntime().sendBotDayMatches(...args); }
function botTeamIdMatches(...args) { return getTelegramDigestRuntime().botTeamIdMatches(...args); }
function sendBotFavoriteTeams(...args) { return getTelegramDigestRuntime().sendBotFavoriteTeams(...args); }
function sendBotFavoriteTeamMatches(...args) { return getTelegramDigestRuntime().sendBotFavoriteTeamMatches(...args); }
function sendDailyPicks(...args) { return getTelegramDigestRuntime().sendDailyPicks(...args); }
function processDailyDigests(...args) { return getTelegramDigestRuntime().processDailyDigests(...args); }

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
let billingApiRuntime = null;
function getBillingApiRuntime() {
  if (!billingApiRuntime) {
    billingApiRuntime = createBillingApiRuntime({
      CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES,
      PASS_TYPES,
      SUBSCRIPTION_PERIOD_SECONDS,
      adminForbidden,
      applyRefundedPayment,
      billingPlanConfig,
      billingWebhookStatus,
      createPassInvoicePayload,
      createSharedCacheRuntime,
      createTelegramLinksRuntime,
      findRefundableBillingCharge,
      getQuota,
      getUserRecord,
      hasSupabase,
      isAdminUser,
      json,
      listUserEntitlements,
      makeInvoicePayload,
      passProductConfig,
      recordOpsEvent,
      resolveUserEntitlements,
      supaSelectMany,
      syncBillingFromStars,
      telegramApi,
      updateUserSubscription
    });
  }
  return billingApiRuntime;
}

function apiBillingPlans(...args) { return getBillingApiRuntime().apiBillingPlans(...args); }
function apiEntitlements(...args) { return getBillingApiRuntime().apiEntitlements(...args); }
function apiBillingInvoice(...args) { return getBillingApiRuntime().apiBillingInvoice(...args); }
function apiBillingSync(...args) { return getBillingApiRuntime().apiBillingSync(...args); }
function apiBillingSubscription(...args) { return getBillingApiRuntime().apiBillingSubscription(...args); }
function listRefundableBillingCharges(...args) { return getBillingApiRuntime().listRefundableBillingCharges(...args); }
function apiBillingRefundLookup(...args) { return getBillingApiRuntime().apiBillingRefundLookup(...args); }
function apiBillingRefund(...args) { return getBillingApiRuntime().apiBillingRefund(...args); }

let channelPublishIdempotencyRuntime = null;
function getChannelPublishIdempotencyRuntime() {
  if (!channelPublishIdempotencyRuntime) {
    channelPublishIdempotencyRuntime = createChannelPublishIdempotencyRuntime({
      APP_VERSION,
      CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES,
      fetchWithTimeout,
      getCacheEntry,
      hasSupabase,
      memory,
      recordOpsEvent,
      setCache,
      supaDelete,
      supaHeaders
    });
  }
  return channelPublishIdempotencyRuntime;
}

function claimChannelPublishIdempotency(...args) { return getChannelPublishIdempotencyRuntime().claimChannelPublishIdempotency(...args); }
function completeChannelPublishIdempotency(...args) { return getChannelPublishIdempotencyRuntime().completeChannelPublishIdempotency(...args); }
function releaseChannelPublishIdempotency(...args) { return getChannelPublishIdempotencyRuntime().releaseChannelPublishIdempotency(...args); }

const DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS = 90;
const DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS = 4;
const DISTRIBUTED_ANALYSIS_WAIT_MS = 1600;

let distributedAnalysisLockRuntime = null;
function getDistributedAnalysisLockRuntime() {
  if (!distributedAnalysisLockRuntime) {
    distributedAnalysisLockRuntime = createDistributedAnalysisLockRuntime({
      APP_VERSION,
      DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS,
      DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS,
      DISTRIBUTED_ANALYSIS_WAIT_MS,
      bumpTelemetry,
      fetchWithTimeout,
      getCache,
      getCacheEntry,
      hasSupabase,
      memory,
      recordOpsEvent,
      sleepMs,
      supaDelete,
      supaHeaders,
      supaSelectOne
    });
  }
  return distributedAnalysisLockRuntime;
}

function distributedAnalysisLockKey(...args) { return getDistributedAnalysisLockRuntime().distributedAnalysisLockKey(...args); }
function distributedAnalysisLockPolicy(...args) { return getDistributedAnalysisLockRuntime().distributedAnalysisLockPolicy(...args); }
function claimDistributedAnalysisLock(...args) { return getDistributedAnalysisLockRuntime().claimDistributedAnalysisLock(...args); }
function releaseDistributedAnalysisLock(...args) { return getDistributedAnalysisLockRuntime().releaseDistributedAnalysisLock(...args); }
function waitForSharedAnalysis(...args) { return getDistributedAnalysisLockRuntime().waitForSharedAnalysis(...args); }
function distributedAnalysisLockDrill(...args) { return getDistributedAnalysisLockRuntime().distributedAnalysisLockDrill(...args); }

let predictionMathRuntime = null;
function getPredictionMathRuntime() {
  if (!predictionMathRuntime) {
    predictionMathRuntime = createPredictionMathRuntime({
      clamp,
      normalizeThree
    });
  }
  return predictionMathRuntime;
}

function predictionOutcomeKey(...args) { return getPredictionMathRuntime().predictionOutcomeKey(...args); }
function predictionOutcomeLabel(...args) { return getPredictionMathRuntime().predictionOutcomeLabel(...args); }
function topProbabilityValue(...args) { return getPredictionMathRuntime().topProbabilityValue(...args); }
function actualOutcomeFromGoals(...args) { return getPredictionMathRuntime().actualOutcomeFromGoals(...args); }
function regulationScore(...args) { return getPredictionMathRuntime().regulationScore(...args); }
function fixtureIdentity(...args) { return getPredictionMathRuntime().fixtureIdentity(...args); }
function fixtureStatusShort(...args) { return getPredictionMathRuntime().fixtureStatusShort(...args); }
function scoreBrier(...args) { return getPredictionMathRuntime().scoreBrier(...args); }
function validThreeProbabilities(...args) { return getPredictionMathRuntime().validThreeProbabilities(...args); }
function rowFinalProbabilities(...args) { return getPredictionMathRuntime().rowFinalProbabilities(...args); }
function rowRawProbabilities(...args) { return getPredictionMathRuntime().rowRawProbabilities(...args); }
function brierFromProbabilities(...args) { return getPredictionMathRuntime().brierFromProbabilities(...args); }
function logLossFromProbabilities(...args) { return getPredictionMathRuntime().logLossFromProbabilities(...args); }
function temperatureScaleProbabilities(...args) { return getPredictionMathRuntime().temperatureScaleProbabilities(...args); }
function parseJsonObject(...args) { return getPredictionMathRuntime().parseJsonObject(...args); }
function signalProbabilitySnapshot(...args) { return getPredictionMathRuntime().signalProbabilitySnapshot(...args); }
function predictedOutcomeForProbabilities(...args) { return getPredictionMathRuntime().predictedOutcomeForProbabilities(...args); }
function averageMetric(...args) { return getPredictionMathRuntime().averageMetric(...args); }

let calibrationRuntime = null;
function getCalibrationRuntime() {
  if (!calibrationRuntime) {
    calibrationRuntime = createCalibrationRuntime({
      APP_VERSION,
      CALIBRATION_AUTO_ROLLBACK,
      CALIBRATION_CACHE_KEY,
      CALIBRATION_CACHE_MINUTES,
      CALIBRATION_PROFILE_VERSION,
      MODEL_BASE_WEIGHTS,
      average,
      averageMetric,
      brierFromProbabilities,
      calibrationProfileFingerprint,
      clamp,
      evaluatePostPromotionRollback,
      evaluatePromotionWindows,
      fetchWithTimeout,
      getCache,
      hasSupabase,
      logLossFromProbabilities,
      memory,
      normalizeThree,
      parseJsonObject,
      pct,
      predictedOutcomeForProbabilities,
      probeOptionalTable,
      recordOpsEvent,
      redactOpsString,
      rowFinalProbabilities,
      rowRawProbabilities,
      safeOpsMetadata,
      sendTelegramMessage,
      setCache,
      splitRollingValidation,
      supaHeaders,
      supaInsertIgnore,
      supaRpc,
      supaSelectMany,
      supaSelectOne,
      temperatureScaleProbabilities,
      validThreeProbabilities,
      verifiedSettledRows
    });
  }
  return calibrationRuntime;
}

function fitTemperatureCalibration(...args) { return getCalibrationRuntime().fitTemperatureCalibration(...args); }
function signalCalibrationStats(...args) { return getCalibrationRuntime().signalCalibrationStats(...args); }
function adaptiveSignalWeights(...args) { return getCalibrationRuntime().adaptiveSignalWeights(...args); }
function rowSignalBlendProbabilities(...args) { return getCalibrationRuntime().rowSignalBlendProbabilities(...args); }
function fitAdaptiveSignalWeightsHoldout(...args) { return getCalibrationRuntime().fitAdaptiveSignalWeightsHoldout(...args); }
function calibrationPromotionSelfTest(...args) { return getCalibrationRuntime().calibrationPromotionSelfTest(...args); }
function probeCalibrationPromotionSchema(...args) { return getCalibrationRuntime().probeCalibrationPromotionSchema(...args); }
function calibrationPromotionFingerprint(...args) { return getCalibrationRuntime().calibrationPromotionFingerprint(...args); }
function calibrationMetricOrNull(...args) { return getCalibrationRuntime().calibrationMetricOrNull(...args); }
function persistCalibrationPromotionValidation(...args) { return getCalibrationRuntime().persistCalibrationPromotionValidation(...args); }
function probeCalibrationLifecycleSchema(...args) { return getCalibrationRuntime().probeCalibrationLifecycleSchema(...args); }
function lifecycleProfileFromRow(...args) { return getCalibrationRuntime().lifecycleProfileFromRow(...args); }
function persistCalibrationLifecycleProfile(...args) { return getCalibrationRuntime().persistCalibrationLifecycleProfile(...args); }
function loadCalibrationLifecycleState(...args) { return getCalibrationRuntime().loadCalibrationLifecycleState(...args); }
function probabilitiesForCalibrationProfile(...args) { return getCalibrationRuntime().probabilitiesForCalibrationProfile(...args); }
function compareCalibrationProfiles(...args) { return getCalibrationRuntime().compareCalibrationProfiles(...args); }
function evaluateActivePostPromotion(...args) { return getCalibrationRuntime().evaluateActivePostPromotion(...args); }
function saveCalibrationLifecycleState(...args) { return getCalibrationRuntime().saveCalibrationLifecycleState(...args); }
function isCalibrationRevisionConflict(...args) { return getCalibrationRuntime().isCalibrationRevisionConflict(...args); }
function notifyCalibrationAdmins(...args) { return getCalibrationRuntime().notifyCalibrationAdmins(...args); }
function resolveCalibrationLifecycle(...args) { return getCalibrationRuntime().resolveCalibrationLifecycle(...args); }
function publicCalibrationControlState(...args) { return getCalibrationRuntime().publicCalibrationControlState(...args); }
function baselineCalibrationProfile(...args) { return getCalibrationRuntime().baselineCalibrationProfile(...args); }
function buildCalibrationProfile(...args) { return getCalibrationRuntime().buildCalibrationProfile(...args); }
function getCalibrationProfile(...args) { return getCalibrationRuntime().getCalibrationProfile(...args); }

let aiTimelineRuntime = null;
function getAiTimelineRuntime() {
  if (!aiTimelineRuntime) {
    aiTimelineRuntime = createAiTimelineRuntime({
      analysisTimelineSnapshotRow,
      buildAiTimeline,
      getOddsSnapshots,
      hasSupabase,
      loadModelPredictionForFixture,
      memory,
      supaInsertIgnore,
      supaSelectMany
    });
  }
  return aiTimelineRuntime;
}

function captureAnalysisTimelineSnapshot(...args) { return getAiTimelineRuntime().captureAnalysisTimelineSnapshot(...args); }
function getAnalysisTimelineSnapshots(...args) { return getAiTimelineRuntime().getAnalysisTimelineSnapshots(...args); }
function loadFixtureAiTimeline(...args) { return getAiTimelineRuntime().loadFixtureAiTimeline(...args); }

let modelEvaluationRuntime = null;
function getModelEvaluationRuntime() {
  if (!modelEvaluationRuntime) {
    modelEvaluationRuntime = createModelEvaluationRuntime({
      MODEL_BASE_WEIGHTS,
      actualOutcomeFromGoals,
      brierFromProbabilities,
      clamp,
      getCache,
      hasSupabase,
      json,
      logLossFromProbabilities,
      memory,
      parseJsonObject,
      predictedOutcomeForProbabilities,
      predictionOutcomeLabel,
      redactOpsString,
      regulationScore,
      setCache,
      signalDisplayName,
      supaSelectMany,
      supaSelectOne,
      topProbabilityValue,
      validThreeProbabilities,
      verifiedBrierScore,
      verifiedSettledRows
    });
  }
  return modelEvaluationRuntime;
}

function loadModelPredictionForFixture(...args) { return getModelEvaluationRuntime().loadModelPredictionForFixture(...args); }
function postMatchOutcomeLabel(...args) { return getModelEvaluationRuntime().postMatchOutcomeLabel(...args); }
function postMatchPredictionProbability(...args) { return getModelEvaluationRuntime().postMatchPredictionProbability(...args); }
function postMatchStatValue(...args) { return getModelEvaluationRuntime().postMatchStatValue(...args); }
function buildPostMatchReview(...args) { return getModelEvaluationRuntime().buildPostMatchReview(...args); }
function postMatchReviewDrill(...args) { return getModelEvaluationRuntime().postMatchReviewDrill(...args); }
function average(...args) { return getModelEvaluationRuntime().average(...args); }
function pct(...args) { return getModelEvaluationRuntime().pct(...args); }
function qualityBucket(...args) { return getModelEvaluationRuntime().qualityBucket(...args); }
function dashboardRound(...args) { return getModelEvaluationRuntime().dashboardRound(...args); }
function dashboardLogLoss(...args) { return getModelEvaluationRuntime().dashboardLogLoss(...args); }
function dashboardCompletenessPercent(...args) { return getModelEvaluationRuntime().dashboardCompletenessPercent(...args); }
function dashboardBucket(...args) { return getModelEvaluationRuntime().dashboardBucket(...args); }
function dashboardWeekKey(...args) { return getModelEvaluationRuntime().dashboardWeekKey(...args); }
function dashboardWeekLabel(...args) { return getModelEvaluationRuntime().dashboardWeekLabel(...args); }
function buildWeeklyDashboard(...args) { return getModelEvaluationRuntime().buildWeeklyDashboard(...args); }
function buildLeagueDashboard(...args) { return getModelEvaluationRuntime().buildLeagueDashboard(...args); }
function buildConfidenceDashboard(...args) { return getModelEvaluationRuntime().buildConfidenceDashboard(...args); }
function buildCompletenessDashboard(...args) { return getModelEvaluationRuntime().buildCompletenessDashboard(...args); }
function buildCalibrationModeDashboard(...args) { return getModelEvaluationRuntime().buildCalibrationModeDashboard(...args); }
function buildSignalDashboard(...args) { return getModelEvaluationRuntime().buildSignalDashboard(...args); }
function buildOutcomeDashboard(...args) { return getModelEvaluationRuntime().buildOutcomeDashboard(...args); }
function buildModelDashboardObservations(...args) { return getModelEvaluationRuntime().buildModelDashboardObservations(...args); }
function modelVersionName(...args) { return getModelEvaluationRuntime().modelVersionName(...args); }
function weightedTopCalibrationError(...args) { return getModelEvaluationRuntime().weightedTopCalibrationError(...args); }
function buildModelVersionCohorts(...args) { return getModelEvaluationRuntime().buildModelVersionCohorts(...args); }
function buildModelDashboard(...args) { return getModelEvaluationRuntime().buildModelDashboard(...args); }
function publicTrackRecordSampleState(...args) { return getModelEvaluationRuntime().publicTrackRecordSampleState(...args); }
function buildPublicAiTrackRecord(...args) { return getModelEvaluationRuntime().buildPublicAiTrackRecord(...args); }
function loadPublicAiTrackRecord(...args) { return getModelEvaluationRuntime().loadPublicAiTrackRecord(...args); }
function apiAiTrackRecord(...args) { return getModelEvaluationRuntime().apiAiTrackRecord(...args); }
function publicAiTrackRecordDrill(...args) { return getModelEvaluationRuntime().publicAiTrackRecordDrill(...args); }

const {
  SETTLEMENT_FINALITY_DELAY_HOURS,
  SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS,
  SETTLEMENT_FINALITY_LOOKBACK_DAYS,
  SETTLEMENT_FINALITY_MAX_FIXTURES,
  SETTLEMENT_FINALITY_MAX_DATES,
  SETTLEMENT_FINALITY_DRIFT_STATUSES,
  SETTLEMENT_DRIFT_ACTIONS,
  SETTLEMENT_RUN_STALE_MINUTES,
  SETTLEMENT_RUN_MAX_ATTEMPTS,
  SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD,
  SETTLEMENT_CIRCUIT_OPEN_HOURS,
  buildSettlementDriftResolution,
  stalePredictionCandidates,
} = createSettlementSupportRuntime({
  actualOutcomeFromGoals,
  isFinishedStatus,
  scoreBrier,
  settlementDriftBeforeSnapshot,
  settlementDriftProviderSnapshot,
});

let postMatchReturnRuntime = null;
function getPostMatchReturnRuntime() {
  if (!postMatchReturnRuntime) {
    postMatchReturnRuntime = createPostMatchReturnRuntime({
      actualOutcomeFromGoals,
      bumpTelemetry,
      fetchWithTimeout,
      fixtureIdentity,
      freeQuotaHealthy,
      getCache,
      getCacheEntry,
      hasSupabase,
      loadProviderFixturesForDate,
      loadRuntimeControls,
      postMatchOutcomeLabel,
      postMatchPredictionProbability,
      recordGrowthEvent,
      recordOpsEvent,
      redactOpsString,
      sendTelegramMessage,
      setCache,
      settlePredictionsFromFixtures,
      supaDelete,
      supaHeaders,
      supaPatch,
      supaSelectMany,
      supaSelectPaged,
      telegramHtmlEscape,
      withSingleFlight
    });
  }
  return postMatchReturnRuntime;
}

function postMatchReturnDisabledKey(...args) { return getPostMatchReturnRuntime().postMatchReturnDisabledKey(...args); }
function postMatchReturnCooldownKey(...args) { return getPostMatchReturnRuntime().postMatchReturnCooldownKey(...args); }
function postMatchReturnDeliveryKey(...args) { return getPostMatchReturnRuntime().postMatchReturnDeliveryKey(...args); }
function postMatchReturnEligibility(...args) { return getPostMatchReturnRuntime().postMatchReturnEligibility(...args); }
function postMatchReturnMessage(...args) { return getPostMatchReturnRuntime().postMatchReturnMessage(...args); }
function postMatchReturnDrill(...args) { return getPostMatchReturnRuntime().postMatchReturnDrill(...args); }
function loadPostMatchReturnCandidates(...args) { return getPostMatchReturnRuntime().loadPostMatchReturnCandidates(...args); }
function loadPostMatchReturnPredictions(...args) { return getPostMatchReturnRuntime().loadPostMatchReturnPredictions(...args); }
function refreshPostMatchSettlement(...args) { return getPostMatchReturnRuntime().refreshPostMatchSettlement(...args); }
function claimPostMatchReturnDelivery(...args) { return getPostMatchReturnRuntime().claimPostMatchReturnDelivery(...args); }
function finishPostMatchReturnClaim(...args) { return getPostMatchReturnRuntime().finishPostMatchReturnClaim(...args); }
function releasePostMatchReturnClaim(...args) { return getPostMatchReturnRuntime().releasePostMatchReturnClaim(...args); }
function processPostMatchReturns(...args) { return getPostMatchReturnRuntime().processPostMatchReturns(...args); }

const reminderDeliveryRuntime = createReminderDeliveryRuntime({
  fetchWithTimeout,
  hasSupabase,
  redactOpsString,
  supaHeaders,
});

const {
  sendTelegramMessage,
  probeReminderReliabilitySchema,
} = reminderDeliveryRuntime;

const providerBudgetRuntime = createProviderBudgetRuntime({
  clamp,
  freeQuotaHealthy: (...args) => freeQuotaHealthy(...args),
  getCache,
  hasSupabase,
  memory,
  phase5ProviderUsage,
  recordOpsEvent,
  runtimeControlsSnapshot,
  setCache,
});

const {
  PROVIDER_PLAN_LIMITS,
  PROVIDER_BUDGET_FLOORS,
  PROVIDER_FEATURE_TTLS,
  inferFootballPlan,
  updateProviderFromHeaders,
  completeProviderQuotaSnapshot,
  loadSharedProviderState,
  persistSharedProviderQuota,
  persistSharedProviderCooldown,
  providerQuotaEvidence,
  quotaUsed,
  quotaUsedPct,
  providerSnapshot,
  liveRefreshSeconds,
  paidQuotaHealthy,
  providerTransitionProfile,
  providerFeatureCounter,
  quotaPercentRemaining,
  providerBudgetProfile,
  providerPublicBudgetMode,
  providerFeaturePolicy,
  featureCacheAgeSeconds,
} = providerBudgetRuntime;

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
  promedFailure) bumpTelemetry('supabaseProbeConfirmedFailures');
  return combined;
}

let supabaseReadinessRuntime = null;
function getSupabaseReadinessRuntime() {
  if (!supabaseReadinessRuntime) {
    supabaseReadinessRuntime = createSupabaseReadinessRuntime({
      bumpTelemetry,
      fetchWithTimeout,
      hasSupabase,
      redactOpsString,
      sleepMs,
      supaHeaders,
    });
  }
  return supabaseReadinessRuntime;
}

const probeSupabase = (...args) => getSupabaseReadinessRuntime().probeSupabase(...args);
const combineSupabaseProbeAttempts = (...args) => getSupabaseReadinessRuntime().combineSupabaseProbeAttempts(...args);
const probeSupabaseConfirmed = (...args) => getSupabaseReadinessRuntime().probeSupabaseConfirmed(...args);
const probeSupabaseReadiness = (...args) => getSupabaseReadinessRuntime().probeSupabaseReadiness(...args);
const probeSupabaseReadinessConfirmed = (...args) => getSupabaseReadinessRuntime().probeSupabaseReadinessConfirmed(...args);
const supabaseProbeConfirmationSelfTest = (...args) => getSupabaseReadinessRuntime().supabaseProbeConfirmationSelfTest(...args);

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

let clientTelemetryRuntime = null;
function getClientTelemetryRuntime() {
  if (!clientTelemetryRuntime) {
    clientTelemetryRuntime = createClientTelemetryRuntime({
      CLIENT_ACTION_ERROR_KINDS,
      CLIENT_ACTION_ERROR_REASONS,
      CLIENT_PRODUCT_ACTIONS,
      CLIENT_TELEMETRY_EVENTS,
      CLIENT_TIMING_OPERATIONS,
      CLOSED_BETA_COHORT,
      bytesToHex,
      enc,
      ensureLaunchAttribution,
      hmacSha256,
      isAdminUser,
      isClosedBetaUser,
      isTelegramValidatedUser,
      json,
      memory,
      pruneMemoryState,
      recordGrowthEvent,
      recordOpsEvent,
      redactOpsString,
    });
  }
  return clientTelemetryRuntime;
}

const closedBetaTelemetrySubject = (...args) => getClientTelemetryRuntime().closedBetaTelemetrySubject(...args);
const phase5ValidationRequestKind = (...args) => getClientTelemetryRuntime().phase5ValidationRequestKind(...args);
const phase5ValidationContext = (...args) => getClientTelemetryRuntime().phase5ValidationContext(...args);
const phase5ProviderUsage = (...args) => getClientTelemetryRuntime().phase5ProviderUsage(...args);
const phase5ProviderCacheUsage = (...args) => getClientTelemetryRuntime().phase5ProviderCacheUsage(...args);
const recordPhase5ProviderRequestSummary = (...args) => getClientTelemetryRuntime().recordPhase5ProviderRequestSummary(...args);
const clientTelemetryMetadata = (...args) => getClientTelemetryRuntime().clientTelemetryMetadata(...args);
const apiClientTelemetry = (...args) => getClientTelemetryRuntime().apiClientTelemetry(...args);

let betaPhase5Runtime = null;
function getBetaPhase5Runtime() {
  if (!betaPhase5Runtime) {
    betaPhase5Runtime = createBetaPhase5Runtime({
      APP_VERSION,
      CLOSED_BETA_COHORT,
      PHASE5_VALIDATION_COHORT,
      RC_NAME,
      RELEASE_CHANNEL,
      billingWebhookStatus,
      collectDiagnostics,
      hasSupabase,
      isClosedBetaUser,
      json,
      providerSnapshot,
      readOpsEventsRange,
      recordOpsEvent,
      redactOpsString,
    });
  }
  return betaPhase5Runtime;
}

const betaPercentileMs = (...args) => getBetaPhase5Runtime().betaPercentileMs(...args);
const betaIssueMeta = (...args) => getBetaPhase5Runtime().betaIssueMeta(...args);
const apiBetaFeedback = (...args) => getBetaPhase5Runtime().apiBetaFeedback(...args);
const betaClientEventRows = (...args) => getBetaPhase5Runtime().betaClientEventRows(...args);
const betaMetricSummary = (...args) => getBetaPhase5Runtime().betaMetricSummary(...args);
const betaTimingSummary = (...args) => getBetaPhase5Runtime().betaTimingSummary(...args);
const betaFeedbackCounts = (...args) => getBetaPhase5Runtime().betaFeedbackCounts(...args);
const betaErrorCountByAction = (...args) => getBetaPhase5Runtime().betaErrorCountByAction(...args);
const betaErrorCountByKind = (...args) => getBetaPhase5Runtime().betaErrorCountByKind(...args);
const betaCoverageSummary = (...args) => getBetaPhase5Runtime().betaCoverageSummary(...args);
const betaExpansionDecision = (...args) => getBetaPhase5Runtime().betaExpansionDecision(...args);
const quotaRemainingPct = (...args) => getBetaPhase5Runtime().quotaRemainingPct(...args);
const betaProductionMonitorSummary = (...args) => getBetaPhase5Runtime().betaProductionMonitorSummary(...args);
const controlledBetaExpansionDecision = (...args) => getBetaPhase5Runtime().controlledBetaExpansionDecision(...args);
const buildBetaIssueGroups = (...args) => getBetaPhase5Runtime().buildBetaIssueGroups(...args);
const betaJourneyEventName = (...args) => getBetaPhase5Runtime().betaJourneyEventName(...args);
const betaJourneySummary = (...args) => getBetaPhase5Runtime().betaJourneySummary(...args);
const latestConfirmedProviderQuota = (...args) => getBetaPhase5Runtime().latestConfirmedProviderQuota(...args);
const phase5MetricSummary = (...args) => getBetaPhase5Runtime().phase5MetricSummary(...args);
const phase5JourneySummary = (...args) => getBetaPhase5Runtime().phase5JourneySummary(...args);
const phase5ProviderSummary = (...args) => getBetaPhase5Runtime().phase5ProviderSummary(...args);
const phase5EvidenceGate = (...args) => getBetaPhase5Runtime().phase5EvidenceGate(...args);
const apiPhase5Dashboard = (...args) => getBetaPhase5Runtime().apiPhase5Dashboard(...args);
const apiBetaDashboard = (...args) => getBetaPhase5Runtime().apiBetaDashboard(...args);

let providerSloRuntime = null;
function getProviderSloRuntime() {
  if (!providerSloRuntime) {
    providerSloRuntime = createProviderSloRuntime({
      MAX_MEMORY_OPS_EVENTS,
      buildProviderSloIncidentTimeline,
      bumpTelemetry,
      currentReleaseIdentity,
      fetchWithTimeout,
      hasSupabase,
      memory,
      providerIncidentBotIdentity,
      providerIncidentDestinationKey,
      providerSloIncidentOpsEvent,
      providerSloWindowsFromBuckets,
      redactOpsString,
      restoreProviderObservabilityWindow,
      rotateProviderObservabilityWindow,
      safeOpsMetadata,
      summarizeProviderObservabilityWindows,
      supaHeaders,
      supaRpc,
      supaSelectMany,
    });
  }
  return providerSloRuntime;
}

const providerSloEventRow = (...args) => getProviderSloRuntime().providerSloEventRow(...args);
const persistProviderSloWindowRow = (...args) => getProviderSloRuntime().persistProviderSloWindowRow(...args);
const flushProviderSloWindow = (...args) => getProviderSloRuntime().flushProviderSloWindow(...args);
const readProviderSloWindows = (...args) => getProviderSloRuntime().readProviderSloWindows(...args);
const providerSloReport = (...args) => getProviderSloRuntime().providerSloReport(...args);
const readProviderIncidentAlertEvents = (...args) => getProviderSloRuntime().readProviderIncidentAlertEvents(...args);
const providerIncidentAlertDestinations = (...args) => getProviderSloRuntime().providerIncidentAlertDestinations(...args);
const readProviderIncidentAlertDeliveries = (...args) => getProviderSloRuntime().readProviderIncidentAlertDeliveries(...args);
const readProviderIncidentAlertDeliveryContract = (...args) => getProviderSloRuntime().readProviderIncidentAlertDeliveryContract(...args);
const claimProviderIncidentAlertDelivery = (...args) => getProviderSloRuntime().claimProviderIncidentAlertDelivery(...args);
const beginProviderIncidentAlertDeliverySend = (...args) => getProviderSloRuntime().beginProviderIncidentAlertDeliverySend(...args);
const finalizeProviderIncidentAlertDelivery = (...args) => getProviderSloRuntime().finalizeProviderIncidentAlertDelivery(...args);
const providerSloSelfTest = (...args) => getProviderSloRuntime().providerSloSelfTest(...args);
const providerSloIncidentSelfTest = (...args) => getProviderSloRuntime().providerSloIncidentSelfTest(...args);


let releaseMonitorApiRuntime = null;
function getReleaseMonitorApiRuntime() {
  if (!releaseMonitorApiRuntime) {
    releaseMonitorApiRuntime = createReleaseMonitorApiRuntime({
      APP_VERSION,
      RC_NAME,
      assessDailyDigestReliabilitySlo,
      buildPostDeployRegressionSloDashboard,
      currentReleaseIdentity,
      fetchWithTimeout,
      hasSupabase,
      json,
      memory,
      planPostDeployRegressionResponseTransition,
      readProviderIncidentAlertDeliveries,
      recordOpsEvent,
      redactOpsString,
      releaseMonitorHealth,
      summarizeDailyDigestOperationalStatus,
      summarizeDailyDigestReliability,
      summarizePostDeployRegressionResponse,
      summarizeReleaseWindow,
      supaHeaders,
      telemetrySnapshot,
    });
  }
  return releaseMonitorApiRuntime;
}

const readOpsEventsRange = (...args) => getReleaseMonitorApiRuntime().readOpsEventsRange(...args);
const readDailyDigestOpsEvents = (...args) => getReleaseMonitorApiRuntime().readDailyDigestOpsEvents(...args);
const readDailyDigestSloEvents = (...args) => getReleaseMonitorApiRuntime().readDailyDigestSloEvents(...args);
const apiPostDeployRegressionResponse = (...args) => getReleaseMonitorApiRuntime().apiPostDeployRegressionResponse(...args);
const apiReleaseMonitor = (...args) => getReleaseMonitorApiRuntime().apiReleaseMonitor(...args);

let productionMonitorRuntime = null;
function getProductionMonitorRuntime() {
  if (!productionMonitorRuntime) {
    productionMonitorRuntime = createProductionMonitorRuntime({
      APP_VERSION,
      RC_NAME,
      assessDailyDigestReliabilitySlo,
      assessSecuritySignals,
      beginProviderIncidentAlertDeliverySend,
      buildDailyDigestIncidentReport,
      buildProviderSloIncidentTimeline,
      claimProviderIncidentAlertDelivery,
      currentReleaseIdentity,
      dailyDigestIncidentAlertOpsEvents,
      deliverOperationalIncidentAlert,
      deliverProviderIncidentAlert,
      finalizeProviderIncidentAlertDelivery,
      flushProviderSloWindow,
      formatDailyDigestIncidentAlert,
      formatPostDeployRegressionAlert,
      formatSecurityIncidentAlert,
      memory,
      planDailyDigestIncidentAlert,
      planDailyDigestReliabilitySloEvent,
      planPostDeployRegressionAlert,
      planPostDeployRegressionLifecycle,
      planProviderIncidentAlert,
      postDeployRegressionAlertOpsEvents,
      postDeployRegressionReport,
      probeSupabaseConfirmed,
      probeSupabaseSchemaDriftConfirmed,
      providerIncidentAlertDestinations,
      providerIncidentAlertLedgerSummary,
      providerIncidentAlertOpsEvents,
      providerSloIncidentOpsEvent,
      providerSloIncidentUpdateOpsEvent,
      providerSnapshot,
      readDailyDigestOpsEvents,
      readDailyDigestSloEvents,
      readOpsEventsRange,
      readProviderIncidentAlertDeliveries,
      readProviderIncidentAlertDeliveryContract,
      readProviderIncidentAlertEvents,
      readProviderSloWindows,
      readTelegramDedupeHealth,
      recordOpsEvent,
      redactOpsString,
      scopeOpsEventsToDeployment,
      securityIncidentOpsEvent,
      securityIncidentTimeline,
      sendTelegramMessage,
      summarizeProviderObservabilityWindows,
    });
  }
  return productionMonitorRuntime;
}

const releaseTopGroups = (...args) => getProductionMonitorRuntime().releaseTopGroups(...args);
const summarizeReleaseWindow = (...args) => getProductionMonitorRuntime().summarizeReleaseWindow(...args);
const releaseMonitorHealth = (...args) => getProductionMonitorRuntime().releaseMonitorHealth(...args);
const productionMonitorState = (...args) => getProductionMonitorRuntime().productionMonitorState(...args);
const productionMonitorSelfTest = (...args) => getProductionMonitorRuntime().productionMonitorSelfTest(...args);
const runProductionMonitor = (...args) => getProductionMonitorRuntime().runProductionMonitor(...args);


let supabaseSchemaRuntime = null;
function getSupabaseSchemaRuntime() {
  if (!supabaseSchemaRuntime) {
    supabaseSchemaRuntime = createSupabaseSchemaRuntime({
      EXPECTED_SCHEMA_FINGERPRINT,
      PERSONAL_WRITE_LIMITS,
      bumpTelemetry,
      fetchWithTimeout,
      hasSupabase,
      readProviderIncidentAlertDeliveryContract,
      redactOpsString,
      sleepMs,
      supaHeaders,
      supaRpc,
    });
  }
  return supabaseSchemaRuntime;
}

const probeOptionalTable = (...args) => getSupabaseSchemaRuntime().probeOptionalTable(...args);
const probeTableColumns = (...args) => getSupabaseSchemaRuntime().probeTableColumns(...args);
const summarizeSupabaseSchemaChecks = (...args) => getSupabaseSchemaRuntime().summarizeSupabaseSchemaChecks(...args);
const readSupabaseSchemaFingerprint = (...args) => getSupabaseSchemaRuntime().readSupabaseSchemaFingerprint(...args);
const readPersonalWriteGuardContract = (...args) => getSupabaseSchemaRuntime().readPersonalWriteGuardContract(...args);
const schemaProbeStatusKind = (...args) => getSupabaseSchemaRuntime().schemaProbeStatusKind(...args);
const classifySupabaseSchemaProbeFailures = (...args) => getSupabaseSchemaRuntime().classifySupabaseSchemaProbeFailures(...args);
const probeSupabaseSchemaDrift = (...args) => getSupabaseSchemaRuntime().probeSupabaseSchemaDrift(...args);
const combineSupabaseSchemaProbeAttempts = (...args) => getSupabaseSchemaRuntime().combineSupabaseSchemaProbeAttempts(...args);
const probeSupabaseSchemaDriftConfirmed = (...args) => getSupabaseSchemaRuntime().probeSupabaseSchemaDriftConfirmed(...args);
const supabaseSchemaProbeConfirmationSelfTest = (...args) => getSupabaseSchemaRuntime().supabaseSchemaProbeConfirmationSelfTest(...args);
const supabaseSchemaDriftSelfTest = (...args) => getSupabaseSchemaRuntime().supabaseSchemaDriftSelfTest(...args);


let releaseReadinessRuntime = null;
function getReleaseReadinessRuntime() {
  if (!releaseReadinessRuntime) {
    releaseReadinessRuntime = createReleaseReadinessRuntime({
      APP_VERSION,
      ROUTE_BURST_POLICIES,
      collectDiagnostics,
      distributedAnalysisLockDrill,
      distributedAnalysisLockPolicy,
      json,
      loadLastProviderE2E,
      memory,
      productionSafetySnapshot,
      providerBudgetProfile,
      providerTransitionProfile,
      redactOpsString,
      responseJsonSafe,
      settlementDriftAdjudicationSelfTest,
      settlementFinalitySelfTest,
      settlementRunLedgerSelfTest,
      sleepMs,
      supabaseProbeConfirmationSelfTest,
      supabaseSchemaProbeConfirmationSelfTest,
      trustedMetricsGateSelfTest,
      withSingleFlight,
    });
  }
  return releaseReadinessRuntime;
}

const releaseCheck = (...args) => getReleaseReadinessRuntime().releaseCheck(...args);
const runSingleFlightSelfTest = (...args) => getReleaseReadinessRuntime().runSingleFlightSelfTest(...args);
const productionCheck = (...args) => getReleaseReadinessRuntime().productionCheck(...args);
const apiProductionReadiness = (...args) => getReleaseReadinessRuntime().apiProductionReadiness(...args);
const rcCheck = (...args) => getReleaseReadinessRuntime().rcCheck(...args);
const rcReadRoute = (...args) => getReleaseReadinessRuntime().rcReadRoute(...args);

const NEWS_BLOCKED_HOST_RE = /(?:facebook|instagram|tiktok|twitter|x\.com|youtube|youtu\.be|pinterest|betting|bet365|tips?ster|prediction)/i;
const NEWS_MAJOR_SOURCE_RE = /(?:reuters|apnews|bbc\.|espn|skysports|theathletic|goal\.|marca\.|as\.com|lequipe|kicker|gazzetta)/i;
const NEWS_OFFICIAL_SOURCE_RE = /(?:uefa\.|fifa\.|premierleague\.com|laliga\.com|bundesliga\.com|legaseriea\.it|ligue1\.com)/i;

let footballNewsRuntime = null;
function getFootballNewsRuntime() {
  if (!footballNewsRuntime) {
    footballNewsRuntime = createFootballNewsRuntime({
      NEWS_BLOCKED_HOST_RE,
      NEWS_MAJOR_SOURCE_RE,
      NEWS_OFFICIAL_SOURCE_RE,
      TOP_TEAM_SEARCH_CATALOG,
      botTeamIdMatches,
      fetchWithTimeout,
      getCache,
      getFavorites,
      normalizeBotFixtureCard,
      recordGrowthEvent,
      searchText,
      setCache,
      telegramApi,
      telegramHtmlEscape,
      todayUtc,
    });
  }
  return footballNewsRuntime;
}

const externalNewsUrl = (...args) => getFootballNewsRuntime().externalNewsUrl(...args);
const newsSourceDomain = (...args) => getFootballNewsRuntime().newsSourceDomain(...args);
const newsSourceTrust = (...args) => getFootballNewsRuntime().newsSourceTrust(...args);
const applyNewsTrustGate = (...args) => getFootballNewsRuntime().applyNewsTrustGate(...args);
const footballNewsCategory = (...args) => getFootballNewsRuntime().footballNewsCategory(...args);
const footballNewsImpactText = (...args) => getFootballNewsRuntime().footballNewsImpactText(...args);
const newsTeamToken = (...args) => getFootballNewsRuntime().newsTeamToken(...args);
const newsTeamByToken = (...args) => getFootballNewsRuntime().newsTeamByToken(...args);
const newsPublishedDayToken = (...args) => getFootballNewsRuntime().newsPublishedDayToken(...args);
const newsPublishedAtFromDayToken = (...args) => getFootballNewsRuntime().newsPublishedAtFromDayToken(...args);
const newsTeamHint = (...args) => getFootballNewsRuntime().newsTeamHint(...args);
const newsPublishedMs = (...args) => getFootballNewsRuntime().newsPublishedMs(...args);
const newsFixtureRelevance = (...args) => getFootballNewsRuntime().newsFixtureRelevance(...args);
const newsRelevantFixture = (...args) => getFootballNewsRuntime().newsRelevantFixture(...args);
const newsFixtureTimingLabel = (...args) => getFootballNewsRuntime().newsFixtureTimingLabel(...args);
const newsFixtureChangeGuide = (...args) => getFootballNewsRuntime().newsFixtureChangeGuide(...args);
const smartNewsMatchLinkDrill = (...args) => getFootballNewsRuntime().smartNewsMatchLinkDrill(...args);
const newsConversionHook = (...args) => getFootballNewsRuntime().newsConversionHook(...args);
const newsConversionKeyboard = (...args) => getFootballNewsRuntime().newsConversionKeyboard(...args);
const newsConversionDrill = (...args) => getFootballNewsRuntime().newsConversionDrill(...args);
const normalizeFootballNewsResult = (...args) => getFootballNewsRuntime().normalizeFootballNewsResult(...args);
const dedupeFootballNews = (...args) => getFootballNewsRuntime().dedupeFootballNews(...args);
const tavilyNewsSearch = (...args) => getFootballNewsRuntime().tavilyNewsSearch(...args);
const currentGeneralFootballNews = (...args) => getFootballNewsRuntime().currentGeneralFootballNews(...args);
const favoriteTeamFootballNews = (...args) => getFootballNewsRuntime().favoriteTeamFootballNews(...args);
const newsImpactBadge = (...args) => getFootballNewsRuntime().newsImpactBadge(...args);
const newsFeedText = (...args) => getFootballNewsRuntime().newsFeedText(...args);
const sendGeneralFootballNews = (...args) => getFootballNewsRuntime().sendGeneralFootballNews(...args);
const sendFavoriteTeamNews = (...args) => getFootballNewsRuntime().sendFavoriteTeamNews(...args);
const currentMorningFootballNews = (...args) => getFootballNewsRuntime().currentMorningFootballNews(...args);
const morningNewsText = (...args) => getFootballNewsRuntime().morningNewsText(...args);
const tavll('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const marketParsingRuntime = createMarketParsingRuntime();

const {
  parsePercent,
  round1,
  normalizeThree,
  extractMarket,
  extractLiveMarket,
  numericValue,
} = marketParsingRuntime;

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
const buildSmartMatchInsights = (...args) home: delta('home'), draw: delta('draw'), away: delta('away') },
  };
}

let oddsSnapshotRuntime = null;
function getOddsSnapshotRuntime() {
  if (!oddsSnapshotRuntime) {
    oddsSnapshotRuntime = createOddsSnapshotRuntime({
      hasSupabase,
      memory,
      normalizeThree,
      sanitizeOddsSnapshotsForMovement,
      supaSelectMany,
      supaUpsert,
    });
  }
  return oddsSnapshotRuntime;
}

const getOddsSnapshots = (...args) => getOddsSnapshotRuntime().getOddsSnapshots(...args);
const saveOddsSnapshot = (...args) => getOddsSnapshotRuntime().saveOddsSnapshot(...args);
const buildOddsMovement = (...args) => getOddsSnapshotRuntime().buildOddsMovement(...args);

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
  r });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}


let userDataApiRuntime = null;
function getUserDataApiRuntime() {
  if (!userDataApiRuntime) {
    userDataApiRuntime = createUserDataApiRuntime({
      addFavorite,
      addFavoritePlayer,
      addReminder,
      analysisFreshness,
      analysisResponsePayload,
      getBotDigestSubscription,
      getCache,
      getFavoritePlayers,
      getFavorites,
      getHistory,
      getPreferences,
      getQuota,
      getReminders,
      getStaleCache,
      getUserRecord,
      isAdminUser,
      json,
      publicDataCapabilities,
      publicDigestSettings,
      publicPlayerFollowNotificationContract,
      publicRuntimeControls,
      publicSiteUrl,
      publicSmartNotificationCapabilities,
      recordOpsEvent,
      reminderDeliveryStatus,
      removeFavorite,
      removeFavoritePlayer,
      removeReminder,
      savePreferences,
      setBotDigestSubscription,
    });
  }
  return userDataApiRuntime;
}

const apiMe = (...args) => getUserDataApiRuntime().apiMe(...args);
const apiHistory = (...args) => getUserDataApiRuntime().apiHistory(...args);
const apiHistoryAnalysis = (...args) => getUserDataApiRuntime().apiHistoryAnalysis(...args);
const apiFavorites = (...args) => getUserDataApiRuntime().apiFavorites(...args);
const publicFavoritePlayer = (...args) => getUserDataApiRuntime().publicFavoritePlayer(...args);
const resolveFavoritePlayerIdentity = (...args) => getUserDataApiRuntime().resolveFavoritePlayerIdentity(...args);
const apiFavoritePlayers = (...args) => getUserDataApiRuntime().apiFavoritePlayers(...args);
const apiDigestSettings = (...args) => getUserDataApiRuntime().apiDigestSettings(...args);
const publicReminder = (...args) => getUserDataApiRuntime().publicReminder(...args);
const apiReminders = (...args) => getUserDataApiRuntime().apiReminders(...args);
const apiPreferences = (...args) => getUserDataApiRuntime().apiPreferences(...args);

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
