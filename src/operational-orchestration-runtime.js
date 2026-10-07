import { createAdminOperationalApi } from './admin-operational-api.js';
import { createPublicHealthRuntime } from './public-health.js';
import { createPublicStatusRouter, createPublicStatusRuntime } from './public-status.js';
import { createReleaseFieldEvidenceRuntime } from './release-field-evidence.js';
import { createScheduledJobsRuntime } from './scheduled-jobs.js';
import { createSettlementRuntime } from './settlement-runtime.js';
import { createTelegramUpdateProcessor } from './telegram-update-orchestration.js';
import { createTelegramWebhookHandler } from './telegram-transport.js';

export function createOperationalOrchestrationRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Operational orchestration dependencies are required.');
  }

  const {
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
    analysisFreshnessDrill,
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
    providerFeatureSourcesSummary,
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
    renewScheduledJob,
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
    weightedTopCalibrationError
  } = deps;

  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }

  function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try {
      Object.getPrototypeOf(value);
      return value;
    } catch {
      return null;
    }
  }

  function safeRead(value,key) {
    if (!value || typeof value !== 'object') return undefined;
    try { return value[key]; } catch { return undefined; }
  }

  for (const [name, fn] of Object.entries({
    claimScheduledJob,
    renewScheduledJob,
    completeScheduledJob,
    releaseScheduledJob,
    loadRuntimeControls,
    publicRuntimeControls,
    currentReleaseIdentity,
    readCompositeReadiness,
    json,
  })) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  function providerCooldownTimestamp() {
    const provider=plainObject(safeRead(memory,'provider'));
    if (!provider) return NaN;

    let hasCooldown=false;
    try {
      hasCooldown=Object.hasOwn(provider,'cooldownUntil');
    } catch {
      return NaN;
    }
    if (!hasCooldown) return 0;

    const raw=safeRead(provider,'cooldownUntil');
    if (raw === null || raw === '') return 0;
    if (raw === undefined) return NaN;

    if (typeof raw === 'number') {
      return Number.isSafeInteger(raw) && raw >= 0 && raw <= 8.64e15
        ? raw
        : NaN;
    }
    if (typeof raw !== 'string' || raw.length > 64) return NaN;

    const text=raw.trim();
    if (!text) return 0;
    if (/^\d+$/.test(text)) {
      const number=Number(text);
      return Number.isSafeInteger(number) && number >= 0 && number <= 8.64e15
        ? number
        : NaN;
    }

    const iso=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
    if (!iso) return NaN;

    const year=Number(iso[1]);
    const month=Number(iso[2]);
    const day=Number(iso[3]);
    const hour=Number(iso[4]);
    const minute=Number(iso[5]);
    const second=Number(iso[6]);
    if (
      month < 1 || month > 12
      || day < 1
      || day > new Date(Date.UTC(year,month,0)).getUTCDate()
      || hour > 23
      || minute > 59
      || second > 59
    ) {
      return NaN;
    }

    if (iso[8] !== 'Z') {
      const offset=/^[+-](\d{2}):(\d{2})$/.exec(iso[8]);
      if (!offset || Number(offset[1]) > 23 || Number(offset[2]) > 59) return NaN;
    }

    const timestamp=Date.parse(text);
    return Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= 8.64e15
      ? timestamp
      : NaN;
  }

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
  
  if (
    !plainObject(releaseFieldEvidenceRuntime)
    || typeof safeRead(releaseFieldEvidenceRuntime,'scheduleReleaseFieldEvidence') !== 'function'
  ) {
    throw new TypeError('Release field evidence runtime is invalid');
  }
  const { scheduleReleaseFieldEvidence }=releaseFieldEvidenceRuntime;
  
  const publicStatusRuntime=createPublicStatusRuntime({
    loadRuntimeControls,
    publicRuntimeControls,
    providerCooldownUntil:providerCooldownTimestamp,
    currentReleaseIdentity,
    readCompositeReadiness,
    scheduleReleaseFieldEvidence,
    version:APP_VERSION,
    releaseCandidate:RC_NAME,
    expectedSchemaContractVersion:EXPECTED_SCHEMA_CONTRACT_VERSION,
    expectedSchemaFingerprint:EXPECTED_SCHEMA_FINGERPRINT,
  });
  if (
    !plainObject(publicStatusRuntime)
    || typeof safeRead(publicStatusRuntime,'serviceStatus') !== 'function'
    || typeof safeRead(publicStatusRuntime,'computeReadinessSnapshot') !== 'function'
  ) {
    throw new TypeError('Public status runtime is invalid');
  }
  
  const publicHealthRuntime=createPublicHealthRuntime({
    computeReadiness:publicStatusRuntime.computeReadinessSnapshot,
    version:APP_VERSION,
    releaseCandidate:RC_NAME,
  });
  if (
    !plainObject(publicHealthRuntime)
    || typeof safeRead(publicHealthRuntime,'liveSnapshot') !== 'function'
    || typeof safeRead(publicHealthRuntime,'readinessSnapshot') !== 'function'
    || typeof safeRead(publicHealthRuntime,'healthSnapshot') !== 'function'
  ) {
    throw new TypeError('Public health runtime is invalid');
  }
  
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
  if (typeof processTelegramUpdate !== 'function') {
    throw new TypeError('Telegram update processor is invalid');
  }
  
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
  const handleTelegramWebhook=createTelegramWebhookHandler(TELEGRAM_WEBHOOK_DEPS);
  if (typeof handleTelegramWebhook !== 'function') {
    throw new TypeError('Telegram webhook handler is invalid');
  }
  
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
    analysisFreshnessDrill,
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
    providerFeatureSourcesSummary,
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
  for (const [name,value] of Object.entries(API_ROUTE_DEPS)) {
    if (name === 'memory') continue;
    if (typeof value !== 'function') {
      throw new TypeError(`API route dependency ${name} is invalid`);
    }
  }
  
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
    renewScheduledJob,
    completeScheduledJob,
    releaseScheduledJob,
  });
  if (typeof handleScheduled !== 'function') {
    throw new TypeError('Scheduled jobs runtime is invalid');
  }

  const exportedRuntime={
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
  };
  for (const [name,value] of Object.entries(exportedRuntime)) {
    if (name === 'API_ROUTE_DEPS' || name === 'publicStatusRouter') continue;
    if (typeof value !== 'function') {
      throw new TypeError(`Operational runtime export ${name} is invalid`);
    }
  }

  return Object.freeze(exportedRuntime);
}
