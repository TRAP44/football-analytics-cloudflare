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
import { createProviderReadinessWiringRuntime } from './provider-readiness-wiring-runtime.js';
import { createAnalysisRuntime } from './analysis-runtime.js';
import { createDistributedAnalysisLockRuntime } from './distributed-analysis-lock-runtime.js';
import { createMatchCenterRuntime } from './match-center-runtime.js';
import { createTelegramBotUiRuntime } from './telegram-bot-ui-runtime.js';
import { createTelegramBotOrchestrationRuntime } from './telegram-bot-orchestration-runtime.js';
import { createTelegramSearchRuntime } from './telegram-search-runtime.js';
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
import { createTelegramCampaignRuntime } from './telegram-campaign-runtime.js';
import { createGrowthAnalyticsRuntime } from './growth-analytics-runtime.js';
import { createAuthGrowthWiringRuntime } from './auth-growth-wiring-runtime.js';
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
import { postDeployRegressionReport } from './post-deploy-regression.js';
import { planPostDeployRegressionLifecycle } from './post-deploy-regression-lifecycle.js';
import { formatPostDeployRegressionAlert, planPostDeployRegressionAlert, postDeployRegressionAlertOpsEvents } from './post-deploy-regression-alerts.js';
import { planPostDeployRegressionResponseTransition, summarizePostDeployRegressionResponse } from './post-deploy-regression-response.js';
import { buildPostDeployRegressionSloDashboard } from './post-deploy-regression-slo.js';
import { createCompositeReadinessRuntime } from './readiness-contract.js';
import { createDiagnosticsRuntime } from './diagnostics-runtime.js';
import { createAppCapabilitiesRuntime } from './app-capabilities.js';
import { createCommonInfrastructureRuntime } from './common-infrastructure-runtime.js';
import { ROUTE_BURST_POLICIES, createRouteSecurityRuntime } from './route-security-runtime.js';
import { createOperationalOrchestrationRuntime } from './operational-orchestration-runtime.js';
import { createWorkerBootstrapRuntime } from './worker-bootstrap-runtime.js';
import { createSettlementSupportRuntime } from './settlement-support-runtime.js';
import { createPostMatchReturnRuntime } from './post-match-return-runtime.js';
import { createAnalysisUsageCompensationRuntime, durableAnalysisUsageHeaders } from './analysis-usage-compensation.js';
import { createQuotaUsageRuntime } from './quota-usage-runtime.js';
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
import { createServiceWiringRuntime } from './service-wiring-runtime.js';
import { createScheduledLeaseRuntime } from './scheduled-lease.js';
import { DAILY_DIGEST_POLICY, assessDailyDigestRun, planDailyDigestRecipients, runBoundedDailyDigest } from './daily-digest-delivery.js';
import { assessDailyDigestReliabilitySlo, buildDailyDigestIncidentReport, dailyDigestIncidentAlertOpsEvents, formatDailyDigestIncidentAlert, planDailyDigestIncidentAlert, planDailyDigestReliabilitySloEvent, summarizeDailyDigestOperationalStatus, summarizeDailyDigestReliability } from './daily-digest-incidents.js';
import { createProviderObservabilityRuntime } from './provider-observability.js';
import { createTelemetryOpsRuntime } from './telemetry-ops-runtime.js';
import { createMaintenanceRuntime } from './maintenance-runtime.js';
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




let commonInfrastructureRuntime = null;
function getCommonInfrastructureRuntime() {
  if (!commonInfrastructureRuntime) {
    commonInfrastructureRuntime = createCommonInfrastructureRuntime({
      API_CONTRACT_VERSION,
      APP_VERSION,
      BILLING_PLANS,
      MIN_CLIENT_VERSION,
      RC_NAME,
      RELEASE_CHANNEL,
      bumpTelemetry,
      createAppCapabilitiesRuntime,
      isSecurityLockdownControls,
      memory,
      paidQuotaHealthy,
      providerPublicBudgetMode,
      publicRuntimeControls,
      runtimeControlsSnapshot,
      runtimeReleaseIdentity,
      telegramIdList,
    });
  }
  return commonInfrastructureRuntime;
}

function todayUtc(...args) { return getCommonInfrastructureRuntime().todayUtc(...args); }
function boolEnv(...args) { return getCommonInfrastructureRuntime().boolEnv(...args); }
function boolEnvState(...args) { return getCommonInfrastructureRuntime().boolEnvState(...args); }
function intEnv(...args) { return getCommonInfrastructureRuntime().intEnv(...args); }
function config(...args) { return getCommonInfrastructureRuntime().config(...args); }
function currentReleaseIdentity(...args) { return getCommonInfrastructureRuntime().currentReleaseIdentity(...args); }
function getAppCapabilitiesRuntime(...args) { return getCommonInfrastructureRuntime().getAppCapabilitiesRuntime(...args); }
function publicDataCapabilities(...args) { return getCommonInfrastructureRuntime().publicDataCapabilities(...args); }
function appManifest(...args) { return getCommonInfrastructureRuntime().appManifest(...args); }
function sleepMs(...args) { return getCommonInfrastructureRuntime().sleepMs(...args); }
function fetchWithTimeout(...args) { return getCommonInfrastructureRuntime().fetchWithTimeout(...args); }
function withSingleFlight(...args) { return getCommonInfrastructureRuntime().withSingleFlight(...args); }
function pruneMemoryState(...args) { return getCommonInfrastructureRuntime().pruneMemoryState(...args); }





let routeSecurityRuntime = null;
function getRouteSecurityRuntime() {
  if (!routeSecurityRuntime) {
    routeSecurityRuntime = createRouteSecurityRuntime({
      TELEGRAM_BURST_POLICIES,
      accountRatePolicies,
      bumpTelemetry,
      cloudflareEdgePolicies,
      distributedAnalysisLockPolicy,
      distributedPreAuthPolicies,
      hasSupabase: (...args) => hasSupabase(...args),
      json,
      memory,
      privilegedLocalRatePolicy,
      pruneMemoryState,
      redactOpsString,
      supaRpc: (...args) => supaRpc(...args),
    });
  }
  return routeSecurityRuntime;
}

function routeBurstPolicy(...args) { return getRouteSecurityRuntime().routeBurstPolicy(...args); }
function enforceRouteBurst(...args) { return getRouteSecurityRuntime().enforceRouteBurst(...args); }
function productionSafetySnapshot(...args) { return getRouteSecurityRuntime().productionSafetySnapshot(...args); }
function readBackendSecurityContract(...args) { return getRouteSecurityRuntime().readBackendSecurityContract(...args); }

let telemetryOpsRuntime = null;
function getTelemetryOpsRuntime() {
  if (!telemetryOpsRuntime) {
    telemetryOpsRuntime = createTelemetryOpsRuntime({
      MAX_MEMORY_OPS_EVENTS,
      currentReleaseIdentity,
      fetchWithTimeout,
      hasSupabase: (...args) => hasSupabase(...args),
      memory,
      observeProviderRequestLocal: (...args) => observeProviderRequestLocal(...args),
      supaHeaders: (...args) => supaHeaders(...args),
      supaRpc: (...args) => supaRpc(...args),
    });
  }
  return telemetryOpsRuntime;
}

function bumpTelemetry(...args) { return getTelemetryOpsRuntime().bumpTelemetry(...args); }
function redactOpsString(...args) { return getTelemetryOpsRuntime().redactOpsString(...args); }
function observeProviderRequest(...args) { return getTelemetryOpsRuntime().observeProviderRequest(...args); }
function sensitiveOpsMetadataKey(...args) { return getTelemetryOpsRuntime().sensitiveOpsMetadataKey(...args); }
function sanitizeOpsMetadataValue(...args) { return getTelemetryOpsRuntime().sanitizeOpsMetadataValue(...args); }
function safeOpsMetadata(...args) { return getTelemetryOpsRuntime().safeOpsMetadata(...args); }
function recordOpsEvent(...args) { return getTelemetryOpsRuntime().recordOpsEvent(...args); }
function recordOpsEventTask(...args) { return getTelemetryOpsRuntime().recordOpsEventTask(...args); }

const {
  observeProviderRequest: observeProviderRequestLocal,
  rotateWindow: rotateProviderObservabilityWindow,
  restoreWindow: restoreProviderObservabilityWindow,
  summarizeWindows: summarizeProviderObservabilityWindows,
  windowsFromBuckets: providerSloWindowsFromBuckets,
} = createProviderObservabilityRuntime({ memory });



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



const {
  claimScheduledJob,
  completeScheduledJob,
  releaseScheduledJob,
  getPreferences,
  savePreferences,
  recordHistory,
  getHistory,
  activatePassPurchase,
  listUserEntitlements,
  refundEntitlementUsage,
  refundPassByCharge,
  reserveEntitlementUsage,
  resolveUserEntitlements,
  filterSmartNotificationRecipients,
  loadFavoritePlayersForSmartNotifications,
  reminderDeliveryStatus,
  clearStaleReminderClaims,
  claimReminderDelivery,
  markReminderDeliverySending,
  holdReminderDeliveryUnknown,
  finishReminderDelivery,
  releaseReminderClaim,
  deliverClaimedReminder,
  processDueReminders,
  processLineupNotifications,
  processImportantChangeNotifications,
  getFavorites,
  addFavorite,
  removeFavorite,
  getFavoritePlayers,
  addFavoritePlayer,
  removeFavoritePlayer,
  deliverSmartNotification,
  processSmartNotifications,
  getReminders,
  addReminder,
  removeReminder,
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
} = createServiceWiringRuntime({
  SMART_NOTIFICATION_POLICY,
  bumpTelemetry: (...args) => bumpTelemetry(...args),
  bytesToHex,
  createEntitlementService,
  createFavoritePlayersService,
  createImportantChangeNotificationService,
  createLineupNotificationService,
  createReminderDeliveryService,
  createReminderDeliveryStore,
  createScheduledLeaseRuntime,
  createSmartNotificationAudience,
  createSmartNotificationDeliveryService,
  createSmartNotificationService,
  createTelegramDedupeRuntime,
  createUserFavoritesService,
  createUserHistoryService,
  createUserPreferencesService,
  createUserRemindersService,
  enc,
  fetchWithTimeout: (...args) => fetchWithTimeout(...args),
  getAnalysisTimelineSnapshots: (...args) => getAnalysisTimelineSnapshots(...args),
  getOddsSnapshots: (...args) => getOddsSnapshots(...args),
  getUserRecord: (...args) => getUserRecord(...args),
  hasSupabase: (...args) => hasSupabase(...args),
  hmacSha256,
  loadLineupNotificationSnapshot: (...args) => loadLineupNotificationSnapshot(...args),
  loadRuntimeControls: (...args) => loadRuntimeControls(...args),
  loadSmartNotificationEventSnapshot: (...args) => loadSmartNotificationEventSnapshot(...args),
  markTelegramWebhookMutation: (...args) => markTelegramWebhookMutation(...args),
  memory,
  pruneMemoryState: (...args) => pruneMemoryState(...args),
  recordOpsEvent: (...args) => recordOpsEvent(...args),
  redactOpsString: (...args) => redactOpsString(...args),
  sendTelegramMessage: (...args) => sendTelegramMessage(...args),
  supaHeaders: (...args) => supaHeaders(...args),
  supaRpc: (...args) => supaRpc(...args),
  supaSelectMany: (...args) => supaSelectMany(...args),
  supaSelectOne: (...args) => supaSelectOne(...args),
  supaSelectPaged: (...args) => supaSelectPaged(...args),
  supaUpsert: (...args) => supaUpsert(...args),
});

let maintenanceRuntime = null;
function getMaintenanceRuntime() {
  if (!maintenanceRuntime) {
    maintenanceRuntime = createMaintenanceRuntime({
      hasSupabase,
      memory,
      redactOpsString,
      supaDelete,
    });
  }
  return maintenanceRuntime;
}

function cleanupRateWindows(...args) { return getMaintenanceRuntime().cleanupRateWindows(...args); }
function cleanupScheduledJobLeases(...args) { return getMaintenanceRuntime().cleanupScheduledJobLeases(...args); }
function cleanupOpsEvents(...args) { return getMaintenanceRuntime().cleanupOpsEvents(...args); }
function cleanupIntegrityData(...args) { return getMaintenanceRuntime().cleanupIntegrityData(...args); }
function telemetrySnapshot(...args) { return getMaintenanceRuntime().telemetrySnapshot(...args); }

const {
  getRequestUser,
  upsertUser,
  getUserRecord,
  cleanLaunchPart,
  parseLaunchStartParam,
  ensureLaunchAttribution,
  recordGrowthEvent,
  ensureReferralCode,
  applyReferralAttribution,
  recordReferredPayment,
  cleanupGrowthEvents,
} = createAuthGrowthWiringRuntime({
  DEVELOPMENT_TELEGRAM_ID,
  bumpTelemetry,
  createGrowthReferralRuntime,
  createUserAuthRuntime,
  hasSupabase,
  memory,
  normalizeReferralCode,
  opaqueReferralCode,
  pruneMemoryState,
  recordOpsEvent,
  redactOpsString,
  referralAttributionDecision,
  safeOpsMetadata,
  splitLaunchReferralParts,
  supaDelete,
  supaPatch,
  supaSelectOne,
  supaUpsert,
  validateTelegramInitData,
  withSingleFlight,
});

let telegramCampaignRuntime = null;
function getTelegramCampaignRuntime() {
  if (!telegramCampaignRuntime) {
    telegramCampaignRuntime = createTelegramCampaignRuntime({
      cleanLaunchPart,
    });
  }
  return telegramCampaignRuntime;
}

function telegramStartPayload(...args) { return getTelegramCampaignRuntime().telegramStartPayload(...args); }
function buildMediaCampaignPerformance(...args) { return getTelegramCampaignRuntime().buildMediaCampaignPerformance(...args); }
function mediaCampaignControlDrill(...args) { return getTelegramCampaignRuntime().mediaCampaignControlDrill(...args); }

let growthAnalyticsRuntime = null;
function getGrowthAnalyticsRuntime() {
  if (!growthAnalyticsRuntime) {
    growthAnalyticsRuntime = createGrowthAnalyticsRuntime({
      NEWS_IMPACT_ACTION_WINDOW_MINUTES,
      NEWS_IMPACT_FAILURE_CODES,
      NEWS_IMPACT_FUNNEL_MIN_USERS,
      NEWS_IMPACT_FUNNEL_STABLE_USERS,
      NEWS_IMPACT_OUTCOME_WINDOW_MINUTES,
      NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS,
      NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS,
      NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS,
      NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
      NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT,
      NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
      NEWS_IMPACT_RECOVERY_INCIDENT_CODES,
      NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
      NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES,
      NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS,
      NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS,
      NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS,
      NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS,
      NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS,
      NEWS_IMPACT_RECOVERY_WINDOW_MINUTES,
      buildMediaCampaignPerformance: (...args) => buildMediaCampaignPerformance(...args),
      buildNewsImpactActionFunnel: (...args) => buildNewsImpactActionFunnel(...args),
      buildNewsImpactActionOutcomeQuality: (...args) => buildNewsImpactActionOutcomeQuality(...args),
      buildNewsImpactActionTrend: (...args) => buildNewsImpactActionTrend(...args),
      buildNewsImpactFailureDiagnostics: (...args) => buildNewsImpactFailureDiagnostics(...args),
      buildNewsImpactRecoveryAdminAlerts: (...args) => buildNewsImpactRecoveryAdminAlerts(...args),
      buildNewsImpactRecoveryDriftMatrix: (...args) => buildNewsImpactRecoveryDriftMatrix(...args),
      buildNewsImpactRecoveryEffectiveness: (...args) => buildNewsImpactRecoveryEffectiveness(...args),
      buildNewsImpactRecoveryIncidentCenter: (...args) => buildNewsImpactRecoveryIncidentCenter(...args),
      buildNewsImpactRecoveryIncidentSloBreachFeed: (...args) => buildNewsImpactRecoveryIncidentSloBreachFeed(...args),
      buildNewsImpactRecoveryIncidentSloBreachImpactRanking: (...args) => buildNewsImpactRecoveryIncidentSloBreachImpactRanking(...args),
      buildNewsImpactRecoveryIncidentSloBreachImpactTrend: (...args) => buildNewsImpactRecoveryIncidentSloBreachImpactTrend(...args),
      buildNewsImpactRecoveryIncidentSloBreachTriage: (...args) => buildNewsImpactRecoveryIncidentSloBreachTriage(...args),
      buildNewsImpactRecoveryIncidentSloBreachTriageTrend: (...args) => buildNewsImpactRecoveryIncidentSloBreachTriageTrend(...args),
      buildNewsImpactRecoveryIncidentSloBreachWatchlist: (...args) => buildNewsImpactRecoveryIncidentSloBreachWatchlist(...args),
      buildNewsImpactRecoveryIncidentSloDashboard: (...args) => buildNewsImpactRecoveryIncidentSloDashboard(...args),
      buildNewsImpactRecoveryIncidentSloImpactConcentration: (...args) => buildNewsImpactRecoveryIncidentSloImpactConcentration(...args),
      buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend: (...args) => buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(...args),
      buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary: (...args) => buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(...args),
      buildNewsImpactRecoveryIncidentSloImpactFocusQueue: (...args) => buildNewsImpactRecoveryIncidentSloImpactFocusQueue(...args),
      buildNewsImpactRecoveryStrategyMatrix: (...args) => buildNewsImpactRecoveryStrategyMatrix(...args),
      cleanLaunchPart: (...args) => cleanLaunchPart(...args),
      cleanNewsImpactActionCode: (...args) => cleanNewsImpactActionCode(...args),
      hasSupabase: (...args) => hasSupabase(...args),
      json: (...args) => json(...args),
      loadNewsImpactRecoveryStrategyEvidence: (...args) => loadNewsImpactRecoveryStrategyEvidence(...args),
      memory,
      newsImpactActionFunnelBottleneck: (...args) => newsImpactActionFunnelBottleneck(...args),
      newsImpactOutcomeBottleneck: (...args) => newsImpactOutcomeBottleneck(...args),
      newsImpactRecoveryBest: (...args) => newsImpactRecoveryBest(...args),
      recordGrowthEvent: (...args) => recordGrowthEvent(...args),
      redactOpsString: (...args) => redactOpsString(...args),
      summarizeNewsImpactRecoveryAlerts: (...args) => summarizeNewsImpactRecoveryAlerts(...args),
      summarizeNewsImpactRecoveryIncidents: (...args) => summarizeNewsImpactRecoveryIncidents(...args),
      summarizeNewsImpactRecoveryTransitions: (...args) => summarizeNewsImpactRecoveryTransitions(...args),
      supaSelectPaged: (...args) => supaSelectPaged(...args)
    });
  }
  return growthAnalyticsRuntime;
}

function apiNewsImpactRecoveryIncidentAck(...args) { return getGrowthAnalyticsRuntime().apiNewsImpactRecoveryIncidentAck(...args); }
function apiLaunchFunnel(...args) { return getGrowthAnalyticsRuntime().apiLaunchFunnel(...args); }

let quotaUsageRuntime = null;
function getQuotaUsageRuntime() {
  if (!quotaUsageRuntime) {
    quotaUsageRuntime = createQuotaUsageRuntime({
      bumpTelemetry,
      durableAnalysisUsageHeaders,
      getUserRecord,
      hasSupabase,
      memory,
      recordOpsEvent,
      redactOpsString,
      supaRpc,
      supaSelectOne,
      todayUtc
    });
  }
  return quotaUsageRuntime;
}

function getUsage(...args) { return getQuotaUsageRuntime().getUsage(...args); }
function reserveAnalysisQuota(...args) { return getQuotaUsageRuntime().reserveAnalysisQuota(...args); }
function refundAnalysisQuota(...args) { return getQuotaUsageRuntime().refundAnalysisQuota(...args); }
function getQuota(...args) { return getQuotaUsageRuntime().getQuota(...args); }

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

let telegramBotOrchestrationRuntime = null;
function getTelegramBotOrchestrationRuntime() {
  if (!telegramBotOrchestrationRuntime) {
    telegramBotOrchestrationRuntime = createTelegramBotOrchestrationRuntime({
      addFavorite: (...args) => addFavorite(...args),
      analysisFreshness: (...args) => analysisFreshness(...args),
      analysisKickoffHandoff: (...args) => analysisKickoffHandoff(...args),
      apiMatchCenter: (...args) => apiMatchCenter(...args),
      botAiVerdictText: (...args) => botAiVerdictText(...args),
      botAnalyzeFixture: (...args) => botAnalyzeFixture(...args),
      footballBotKeyboard: (...args) => footballBotKeyboard(...args),
      footballMatchActionKeyboard: (...args) => footballMatchActionKeyboard(...args),
      getFavorites: (...args) => getFavorites(...args),
      loadBotTeamCard: (...args) => loadBotTeamCard(...args),
      markTelegramWebhookMutation: (...args) => markTelegramWebhookMutation(...args),
      marketMovementNote: (...args) => marketMovementNote(...args),
      newsImpactDecisionCard: (...args) => newsImpactDecisionCard(...args),
      normalizeBotFixtureCard: (...args) => normalizeBotFixtureCard(...args),
      publicSiteUrl: (...args) => publicSiteUrl(...args),
      recordGrowthEvent: (...args) => recordGrowthEvent(...args),
      rememberBotFixtureCards: (...args) => rememberBotFixtureCards(...args),
      removeFavorite: (...args) => removeFavorite(...args),
      telegramApi: (...args) => telegramApi(...args),
      telegramFullAnalysisUrl: (...args) => telegramFullAnalysisUrl(...args),
      telegramHtmlEscape: (...args) => telegramHtmlEscape(...args),
      telegramWebAppUrl: (...args) => telegramWebAppUrl(...args)
    });
  }
  return telegramBotOrchestrationRuntime;
}

function botAiHandoffText(...args) { return getTelegramBotOrchestrationRuntime().botAiHandoffText(...args); }
function botRefereeText(...args) { return getTelegramBotOrchestrationRuntime().botRefereeText(...args); }
function botSquadsText(...args) { return getTelegramBotOrchestrationRuntime().botSquadsText(...args); }
function botMarketRiskText(...args) { return getTelegramBotOrchestrationRuntime().botMarketRiskText(...args); }
function botMatchCenterFixture(...args) { return getTelegramBotOrchestrationRuntime().botMatchCenterFixture(...args); }
function botPostMatchReviewText(...args) { return getTelegramBotOrchestrationRuntime().botPostMatchReviewText(...args); }
function sendBotFixtureSection(...args) { return getTelegramBotOrchestrationRuntime().sendBotFixtureSection(...args); }
function toggleBotFavorite(...args) { return getTelegramBotOrchestrationRuntime().toggleBotFavorite(...args); }
function configureFootballBot(...args) { return getTelegramBotOrchestrationRuntime().configureFootballBot(...args); }
function sendFootballBotHome(...args) { return getTelegramBotOrchestrationRuntime().sendFootballBotHome(...args); }
function sendFootballBotHelp(...args) { return getTelegramBotOrchestrationRuntime().sendFootballBotHelp(...args); }

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

let telegramSearchRuntime = null;
function getTelegramSearchRuntime() {
  if (!telegramSearchRuntime) {
    telegramSearchRuntime = createTelegramSearchRuntime({
      apiFootball: (...args) => apiFootball(...args),
      digestTime: (...args) => digestTime(...args),
      footballMatchActionKeyboard: (...args) => footballMatchActionKeyboard(...args),
      footballSearchHandoffKeyboard: (...args) => footballSearchHandoffKeyboard(...args),
      freeQuotaHealthy: (...args) => freeQuotaHealthy(...args),
      getCache: (...args) => getCache(...args),
      getFavorites: (...args) => getFavorites(...args),
      getHistory: (...args) => getHistory(...args),
      loadPublicAiTrackRecord: (...args) => loadPublicAiTrackRecord(...args),
      loadSearchTeamMatches: (...args) => loadSearchTeamMatches(...args),
      normalizeSearchTeam: (...args) => normalizeSearchTeam(...args),
      rankTeamDiscoveryMatches: (...args) => rankTeamDiscoveryMatches(...args),
      recordGrowthEvent: (...args) => recordGrowthEvent(...args),
      rememberBotFixtureCards: (...args) => rememberBotFixtureCards(...args),
      searchText: (...args) => searchText(...args),
      setCache: (...args) => setCache(...args),
      telegramApi: (...args) => telegramApi(...args),
      telegramWebAppUrl: (...args) => telegramWebAppUrl(...args),
      todayUtc: (...args) => todayUtc(...args),
      topTeamSearchPlan: (...args) => topTeamSearchPlan(...args)
    });
  }
  return telegramSearchRuntime;
}

function telegramHtmlEscape(...args) { return getTelegramSearchRuntime().telegramHtmlEscape(...args); }
function botSearchParts(...args) { return getTelegramSearchRuntime().botSearchParts(...args); }
function botIntentLead(...args) { return getTelegramSearchRuntime().botIntentLead(...args); }
function botMatchScore(...args) { return getTelegramSearchRuntime().botMatchScore(...args); }
function botMatchButtonText(...args) { return getTelegramSearchRuntime().botMatchButtonText(...args); }
function botMatchLine(...args) { return getTelegramSearchRuntime().botMatchLine(...args); }
function botCachedDayMatches(...args) { return getTelegramSearchRuntime().botCachedDayMatches(...args); }
function botRemoteTeamMatches(...args) { return getTelegramSearchRuntime().botRemoteTeamMatches(...args); }
function sendBotFootballSearch(...args) { return getTelegramSearchRuntime().sendBotFootballSearch(...args); }
function lastAiVerdictText(...args) { return getTelegramSearchRuntime().lastAiVerdictText(...args); }
function botAiTrackRecordText(...args) { return getTelegramSearchRuntime().botAiTrackRecordText(...args); }
function sendBotAiTrackRecord(...args) { return getTelegramSearchRuntime().sendBotAiTrackRecord(...args); }
function sendLastAiVerdict(...args) { return getTelegramSearchRuntime().sendLastAiVerdict(...args); }

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
  settlementDriftBeforeSnapshot: (...args) => settlementDriftBeforeSnapshot(...args),
  settlementDriftProviderSnapshot: (...args) => settlementDriftProviderSnapshot(...args),
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

const {
  sendTelegramMessage,
  probeReminderReliabilitySchema,
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
  probeSupabase,
  combineSupabaseProbeAttempts,
  probeSupabaseConfirmed,
  probeSupabaseReadiness,
  probeSupabaseReadinessConfirmed,
  supabaseProbeConfirmationSelfTest,
  readCompositeReadiness,
  readRecentOpsEvents,
  collectDiagnostics,
} = createProviderReadinessWiringRuntime({
  APP_VERSION,
  COMPATIBLE_SCHEMA_FINGERPRINTS,
  EXPECTED_SCHEMA_CONTRACT_VERSION,
  EXPECTED_SCHEMA_FINGERPRINT,
  SUPABASE_SCHEMA_GUIDANCE,
  bumpTelemetry,
  clamp,
  fetchWithTimeout,
  getCache,
  getCacheEntry,
  hasSupabase,
  isFinishedStatus,
  isLiveStatus,
  memory,
  observeProviderRequest,
  phase5ProviderUsage: (...args) => phase5ProviderUsage(...args),
  providerSloReport: (...args) => providerSloReport(...args),
  readIntegrityDiagnostics: (...args) => readIntegrityDiagnostics(...args),
  readTelegramDedupeHealth: (...args) => readTelegramDedupeHealth(...args),
  recordOpsEvent,
  redactOpsString,
  runtimeControlsSnapshot,
  setCache,
  sleepMs,
  supaHeaders,
  supaRpc,
  telemetrySnapshot,
  withSingleFlight,
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

const {
  API_ROUTE_DEPS,
  captureModelPrediction,
  handleScheduled,
  handleTelegramWebhook,
  publicStatusRouter,
  settlePredictionsFromFixtures,
  settlementDriftAdjudicationSelfTest,
  settlementDriftBeforeSnapshot,
  settlementDriftProviderSnapshot,
  settlementFinalitySelfTest,
  settlementRunLedgerSelfTest,
  trustedMetricsGateSelfTest,
  verifiedBrierScore,
  verifiedSettledRows,
} = createOperationalOrchestrationRuntime({
  API_CONTRACT_VERSION,
  APP_VERSION,
  DEFAULT_RUNTIME_CONTROLS,
  DEVELOPMENT_TELEGRAM_ID,
  EXPECTED_SCHEMA_CONTRACT_VERSION,
  EXPECTED_SCHEMA_FINGERPRINT,
  MIN_CLIENT_VERSION,
  PROVIDER_FEATURE_TTLS,
  RC_NAME,
  RELEASE_CHANNEL,
  RUNTIME_CONTROLS_CACHE_MS,
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
  adminForbidden,
  analysisQualityGateSelfTest,
  apiAiTrackRecord,
  apiAnalyze,
  apiBetaDashboard,
  apiBetaFeedback,
  apiBillingInvoice,
  apiBillingPlans,
  apiBillingRefund,
  apiBillingRefundLookup,
  apiBillingSubscription,
  apiBillingSync,
  apiChannelPublisherTest,
  apiClientTelemetry,
  apiDataIntegrity,
  apiDigestSettings,
  apiEntitlements,
  apiFavoritePlayers,
  apiFavorites,
  apiFixtureShareLink,
  apiFootball,
  apiHistory,
  apiHistoryAnalysis,
  apiLaunchFunnel,
  apiMatchCenter,
  apiMatches,
  apiMe,
  apiMediaPublisherLink,
  apiNewsImpactRecoveryIncidentAck,
  apiPhase5Dashboard,
  apiPostDeployRegressionResponse,
  apiPreferences,
  apiProductionReadiness,
  apiReleaseMonitor,
  apiReminders,
  apiRuntimeControls,
  apiRuntimeRollback,
  apiSearch,
  apiTeam,
  apiTeamIntelligence,
  apiTeamSquad,
  apiTournament,
  appManifest,
  applyReferralAttribution,
  applyRefundedPayment,
  applySuccessfulPayment,
  average,
  averageMetric,
  baselineCalibrationProfile,
  billingPlanConfig,
  botRemoteTeamMatches,
  brierFromProbabilities,
  buildModelDashboard,
  buildSettlementDriftResolution,
  bytesToHex,
  calibrationPromotionSelfTest,
  claimScheduledJob,
  claimTelegramUpdate,
  claimTelegramUpdatePersistent,
  cleanNewsImpactActionCode,
  cleanNewsImpactDecisionCode,
  cleanNewsImpactRecoveryCode,
  cleanupGrowthEvents,
  cleanupIntegrityData,
  cleanupOpsEvents,
  cleanupRateWindows,
  cleanupScheduledJobLeases,
  collectDiagnostics,
  completeScheduledJob,
  completeTelegramUpdate,
  completeTelegramUpdatePersistent,
  configureFootballBot,
  constantTimeEqual,
  currentReleaseIdentity,
  enc,
  enforceTelegramBurst,
  ensureLaunchAttribution,
  fetchWithTimeout,
  fixtureIdentity,
  fixtureStatusShort,
  footballBotKeyboard,
  footballBotMoreKeyboard,
  footballMatchActionKeyboard,
  freeQuotaHealthy,
  getCache,
  getCalibrationProfile,
  getFavorites,
  hasSupabase,
  isAdminUser,
  isCalibrationRevisionConflict,
  isFinishedStatus,
  isFootballRateLimitError,
  json,
  loadBotFixtureCard,
  loadCalibrationLifecycleState,
  loadLastProviderE2E,
  loadProviderFixturesForDate,
  loadRuntimeControls,
  loadSharedProviderState,
  logLossFromProbabilities,
  memory,
  modelVersionName,
  newsPublishedAtFromDayToken,
  newsRelevantFixture,
  newsTeamByToken,
  newsTeamToken,
  notifyCalibrationAdmins,
  parseInvoicePayload,
  parseJsonObject,
  parseLaunchStartParam,
  parsePassInvoicePayload,
  passProductConfig,
  pct,
  postMatchReturnDisabledKey,
  predictionOutcomeKey,
  predictionOutcomeLabel,
  probeCalibrationLifecycleSchema,
  probeCalibrationPromotionSchema,
  probeOptionalTable,
  probeReminderReliabilitySchema,
  probeRuntimeHistorySchema,
  probeSupabaseReadinessConfirmed,
  probeSupabaseSchemaDriftConfirmed,
  processDailyDigests,
  processDueReminders,
  processImportantChangeNotifications,
  processLineupNotifications,
  processPostMatchReturns,
  processSmartNotifications,
  productionSafetySnapshot,
  providerAuditCall,
  providerAuditEndpointPlan,
  providerAuditScore,
  providerBudgetProfile,
  providerDataReliabilitySelfTest,
  providerEndpointLabel,
  providerFeatureFetch,
  providerSloReport,
  providerSnapshot,
  providerTransitionProfile,
  providerValidationStatus,
  providerValidationStep,
  publicCalibrationControlState,
  publicDataCapabilities,
  publicRuntimeControls,
  qualityBucket,
  rcCheck,
  rcReadRoute,
  readBackendSecurityContract,
  readCompositeReadiness,
  recordGrowthEvent,
  recordNewsImpactOutcome,
  recordNewsImpactRecoveryAttempt,
  recordOpsEvent,
  redactOpsString,
  regulationScore,
  releaseCheck,
  releaseScheduledJob,
  releaseTelegramUpdate,
  releaseTelegramUpdatePersistent,
  reminderDeliveryStatus,
  responseJsonSafe,
  rowFinalProbabilities,
  rowRawProbabilities,
  runProductionMonitor,
  saveCalibrationLifecycleState,
  saveProviderE2E,
  scoreBrier,
  sendBotAiTrackRecord,
  sendBotDayMatches,
  sendBotFavoriteTeamMatches,
  sendBotFavoriteTeams,
  sendBotFixtureMenu,
  sendBotFixtureSection,
  sendBotFixtureShareCard,
  sendBotFootballSearch,
  sendDailyPicks,
  sendDigestControls,
  sendFavoriteTeamNews,
  sendFootballBotHelp,
  sendFootballBotHome,
  sendGeneralFootballNews,
  sendLastAiVerdict,
  sendNewsImpactRecoveryMessage,
  sendTelegramMessage,
  setBotDigestSubscription,
  setCache,
  signalCalibrationStats,
  signalProbabilitySnapshot,
  stalePredictionCandidates,
  supaDelete,
  supaHeaders,
  supaInsertIgnore,
  supaPatch,
  supaSelectMany,
  supaSelectOne,
  supaSelectPaged,
  supaUpsert,
  supabaseProbeConfirmationSelfTest,
  supabaseSchemaDriftSelfTest,
  supabaseSchemaProbeConfirmationSelfTest,
  telegramApi,
  telegramDedupeObservabilitySelfTest,
  telegramLockdownDecision,
  telegramMiniAppE2EDrill,
  telegramPersistentDedupeSelfTest,
  telegramStartPayload,
  telegramWebAppUrl,
  todayUtc,
  toggleBotFavorite,
  topProbabilityValue,
  updateUserSubscription,
  upsertUser,
  weightedTopCalibrationError,
});

export default createWorkerBootstrapRuntime({
  API_ROUTE_DEPS,
  bumpTelemetry,
  closedBetaAccessDecision,
  cloudflareEdgeGuard,
  config,
  createPreAuthAbuseGuard,
  dispatchApiRoute,
  enforceDistributedAccountRateLimit,
  enforceDistributedPreAuthRateLimit,
  enforceRouteBurst,
  getRequestUser,
  handleScheduled,
  handleTelegramWebhook,
  hasSupabase,
  isAdminSensitivePath,
  isFootballRateLimitError,
  isSecurityLockdownControls,
  json,
  loadRuntimeControls,
  memory,
  phase5ValidationContext,
  preAuthRequestShapeDecision,
  publicDataCapabilities,
  publicRouteError,
  publicStatusRouter,
  reconcileAnalysisUsageReservations,
  recordOpsEvent,
  recordPhase5ProviderRequestSummary,
  redactOpsString,
  runtimeGuard,
  supaRpc,
});
