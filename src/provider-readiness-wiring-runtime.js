import { createApiFootballGateway } from './api-football-gateway.js';
import { createCompositeReadinessRuntime } from './readiness-contract.js';
import { createDiagnosticsRuntime } from './diagnostics-runtime.js';
import { createProviderBudgetRuntime } from './provider-budget-runtime.js';
import { createProviderDataRuntime } from './provider-data-runtime.js';
import { createReminderDeliveryRuntime } from './reminder-delivery-runtime.js';
import { createSupabaseReadinessRuntime } from './supabase-readiness-runtime.js';

export function createProviderReadinessWiringRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Provider readiness wiring dependencies are required.');
  }

  const {
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
    phase5ProviderUsage,
    providerSloReport,
    readIntegrityDiagnostics,
    readTelegramDedupeHealth,
    recordOpsEvent,
    redactOpsString,
    runtimeControlsSnapshot,
    setCache,
    sleepMs,
    supaHeaders,
    supaRpc,
    telemetrySnapshot,
    withSingleFlight,
  } = deps;

  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }

  const requiredFunctions = {
    bumpTelemetry,
    clamp,
    fetchWithTimeout,
    getCache,
    getCacheEntry,
    hasSupabase,
    isFinishedStatus,
    isLiveStatus,
    observeProviderRequest,
    phase5ProviderUsage,
    providerSloReport,
    readIntegrityDiagnostics,
    readTelegramDedupeHealth,
    recordOpsEvent,
    redactOpsString,
    runtimeControlsSnapshot,
    setCache,
    sleepMs,
    supaHeaders,
    supaRpc,
    telemetrySnapshot,
    withSingleFlight,
  };
  for (const [name, fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

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

  let gatewayRuntime = null;
  const freeQuotaHealthyProxy = (...args) => {
    const fn = gatewayRuntime?.freeQuotaHealthy;
    return typeof fn === 'function' ? fn(...args) : false;
  };
  const providerBudgetRuntime = createProviderBudgetRuntime({
    clamp,
    freeQuotaHealthy: freeQuotaHealthyProxy,
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

  gatewayRuntime = createApiFootballGateway({
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
  } = gatewayRuntime;

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

  const supabaseReadinessRuntime = createSupabaseReadinessRuntime({
    bumpTelemetry,
    fetchWithTimeout,
    hasSupabase,
    redactOpsString,
    sleepMs,
    supaHeaders,
  });

  const {
    probeSupabase,
    combineSupabaseProbeAttempts,
    probeSupabaseConfirmed,
    probeSupabaseReadiness,
    probeSupabaseReadinessConfirmed,
    supabaseProbeConfirmationSelfTest,
  } = supabaseReadinessRuntime;

  const { readCompositeReadiness } = createCompositeReadinessRuntime({
    hasSupabase,
    supaRpc,
    probeConnectivity: cfg => probeSupabaseReadinessConfirmed(cfg),
    expectedFingerprint: EXPECTED_SCHEMA_FINGERPRINT,
    expectedFingerprints: COMPATIBLE_SCHEMA_FINGERPRINTS,
    expectedContractVersion: EXPECTED_SCHEMA_CONTRACT_VERSION,
    readinessRpc: 'backend_readiness_contract_v2',
  });

  const {
    readRecentOpsEvents,
    collectDiagnostics,
  } = createDiagnosticsRuntime({
    memory,
    appVersion: APP_VERSION,
    supabaseSchemaGuidance: SUPABASE_SCHEMA_GUIDANCE,
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

  return Object.freeze({
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
  });
}
