import { pathToFileURL } from 'node:url';

const REQUIRED_HEALTH_FLAGS = [
  'adminSecurity',
  'adminDevModeIsolation',
  'backendSecurityContract',
  'supabaseSchemaDriftGuard',
  'supabaseSchemaDriftSelfTest',
  'productionMonitor',
  'productionMonitorSelfTest',
  'rollbackVerification',
  'providerDataReliability',
  'providerDataReliabilitySelfTest',
  'providerSloObservability',
  'providerSloSelfTest',
  'multiProviderDataService',
  'openLigaDbStandingsFallback',
  'openLigaDbEventFallback',
  'teamPlayerSeasonStats',
  'structuredAvailability',
  'playerRoleAvailability',
  'playerRoleHydration',
  'lineupQualityGuard',
  'lineupSemanticReliability',
  'freshnessAwareDataTrust',
  'xgSemanticQualityGuard',
  'eventSemanticQualityGuard',
  'statisticsSemanticQualityGuard',
  'oddsSemanticQualityGuard',
  'availabilitySemanticQualityGuard',
  'sourceProvenance',
  'aiAnalysisQualityGate',
  'aiAnalysisQualityGateSelfTest',
  'telegramMiniAppE2E',
  'telegramMiniAppE2ESelfTest',
  'telegramWebhookPersistentDedupe',
  'telegramWebhookPersistentDedupeSelfTest',
  'telegramWebhookDedupeObservability',
  'telegramWebhookDedupeObservabilitySelfTest',
  'supabaseProbeConfirmation',
  'supabaseProbeConfirmationSelfTest',
  'supabaseSchemaProbeConfirmation',
  'supabaseSchemaProbeConfirmationSelfTest',
  'cloudflareDeploymentGate',
  'browserSecurityPolicy',
  'failClosedDeployment',
  'interactionSafety',
  'actionDeduplication',
  'staleResponseGuard',
  'profileFailSoft',
  'entityNavigationSafety',
  'personalDataStateSafety',
  'asyncEntityGuard',
  'personalDataWriteConsistency',
  'reminderWriteConfirmation',
  'readWriteRaceGuard',
  'analysisHistoryTransition',
  'historyStaleGuard',
  'immediateAnalysisHandoff',
  'russianUiLocalization',
  'adminRussianLocalization',
  'prematchRussianLocalization',
  'dynamicRussianLocalization',
  'adminTextHumanization',
  'matchCenterRussianLocalization',
  'mediaLaunchHardening',
  'telegramWebhookDedupe',
  'telegramWebhookBurstGuard',
  'newsSourceTrustGate',
  'publicLegalPages',
  'publicStatusPage',
  'mediaLaunchPackage',
  'mediaDeepLinkAttribution',
  'firstPartyGrowthAnalytics',
  'launchFunnelAnalytics',
  'launchPrivacyGuard',
  'launchSimulation',
  'conversionUx',
  'highIntentSearchFallback',
  'newsReturnLoop',
  'realLaunchDrill',
  'searchNormalization',
  'searchOutcomeAnalytics',
  'searchRetryUx',
  'searchQualitySelfTest',
  'zeroResultRecovery',
  'teamFixtureDiscovery',
  'sharedFixtureDiscoveryCache',
  'extendedTeamCalendar',
  'recentMatchFallback',
  'matchSelectionIntelligence',
  'primaryMatchRecommendation',
  'officialMatchPriority',
  'selectionReasonUx',
  'matchSelectionSelfTest',
  'oneTapAiHandoff',
  'telegramAutoQuickBrief',
  'cachedFullAnalysisHandoff',
  'directFixtureDeepLink',
  'handoffFunnelTracking',
  'oneTapHandoffSelfTest',
  'aiFreshnessGuard',
  'preKickoffRecheck',
  'userScopedFreeRecheck',
  'lineupFreshnessWindow',
  'adaptiveAnalysisTtl',
  'analysisFreshnessSelfTest',
  'preKickoffChangeDetection',
  'analysisDeltaSummary',
  'recheckMateriality',
  'telegramRecheckDelta',
  'analysisDeltaSelfTest',
  'kickoffHandoffGuard',
  'prematchAdviceFreeze',
  'liveContextHandoff',
  'finishedAnalysisArchive',
  'kickoffHandoffSelfTest',
  'postMatchAiReview',
  'immutablePrematchComparison',
  'calibrationFeedbackReview',
  'telegramPostMatchReview',
  'postMatchReviewSelfTest',
  'postMatchReturnLoop',
  'analyzedMatchReturn',
  'postMatchReturnDedupe',
  'postMatchReturnOptOut',
  'postMatchReturnQuotaGuard',
  'postMatchReturnSelfTest',
  'publicAiTrackRecord',
  'verifiedTrackRecordOnly',
  'smallSampleTrustGuard',
  'noWinRateTrustUx',
  'telegramAiTrackRecord',
  'aiTrackRecordSelfTest',
  'mediaFixtureDeepLinks',
  'shareableMatchCards',
  'shareAttribution',
  'deepLinkAutoAnalysis',
  'telegramNativeShare',
  'fixtureDeepLinkSelfTest',
  'distributedAnalysisLock',
  'viralFixtureCollapse',
  'crossInstanceAnalysisDedupe',
  'analysisLockFailClosed',
  'sharedAnalysisWaitFallback',
  'distributedAnalysisLockSelfTest',
  'mediaPublisherKit',
  'campaignTaggedFixtureLinks',
  'mediaCopyGenerator',
  'adminPublisherOnly',
  'mediaPublisherSelfTest',
  'mediaCampaignControlRoom',
  'contentLevelMediaAttribution',
  'mediaCampaignConversion',
  'publisherOutcomeTracking',
  'mediaCampaignControlSelfTest',
  'telegramNewsConversionEngine',
  'newsPerItemAiCta',
  'newsTeamIntentResolution',
  'newsConversionTracking',
  'newsConversionSelfTest',
  'smartNewsFixtureLinking',
  'newsTimeRelevanceGuard',
  'perNewsFixtureCta',
  'newsImpactDeltaGuide',
  'smartNewsLinkSelfTest',
  'newsImpactDelta',
  'preNewsSnapshotGuard',
  'explicitNewsRecheck',
  'newsImpactMateriality',
  'newsImpactDeltaSelfTest',
  'newsImpactDecisionCard',
  'newsImpactActionRouting',
  'newsImpactCausalityGuardUx',
  'newsImpactDecisionAnalytics',
  'newsImpactDecisionSelfTest',
  'newsImpactActionSelfTest',
  'newsImpactActionFunnelSelfTest',
  'newsImpactFunnelConfidenceSelfTest',
  'newsImpactActionTrendSelfTest',
  'newsImpactTemporalAttributionSelfTest',
  'newsImpactOutcomeQualitySelfTest',
  'newsImpactFailureDiagnosticsSelfTest',
  'newsImpactRecoveryEffectivenessSelfTest',
  'newsImpactRecoveryStrategySelfTest',
  'newsImpactRecoveryStrategyParity',
  'newsImpactRecoveryStabilityGuard',
  'newsImpactRecoveryStabilitySelfTest',
  'newsImpactRecoveryDriftGuard',
  'newsImpactRecoveryDriftAudit',
  'newsImpactRecoveryDriftSelfTest',
  'newsImpactRecoveryTransitionHistory',
  'newsImpactRecoveryAdminAlerts',
  'newsImpactRecoveryTransitionPrivacyGuard',
  'newsImpactRecoveryTransitionSelfTest',
  'newsImpactRecoveryIncidentCenter',
  'newsImpactRecoveryIncidentLifecycle',
  'newsImpactRecoveryIncidentPrivacyGuard',
  'newsImpactRecoveryIncidentSelfTest',
  'newsImpactRecoveryIncidentAcknowledgement',
  'newsImpactRecoveryIncidentRunbook',
  'newsImpactRecoveryIncidentAlertSuppression',
  'newsImpactRecoveryIncidentAckPrivacyGuard',
  'newsImpactRecoveryIncidentAckSelfTest',
  'newsImpactRecoveryIncidentSlo',
  'newsImpactRecoveryIncidentEscalation',
  'newsImpactRecoveryIncidentLatencyMetrics',
  'newsImpactRecoveryIncidentSloSelfTest',
  'newsImpactRecoveryIncidentSloDashboard',
  'newsImpactRecoveryIncidentWeeklyTrend',
  'newsImpactRecoveryIncidentRecurrence',
  'newsImpactRecoveryIncidentSloDashboardSelfTest',
  'newsImpactRecoveryIncidentSloBreachFeed',
  'newsImpactRecoveryIncidentBreachDrilldown',
  'newsImpactRecoveryIncidentBreachPrivacyGuard',
  'newsImpactRecoveryIncidentSloBreachFeedSelfTest',
  'newsImpactRecoveryIncidentSloBreachWatchlist',
  'newsImpactRecoveryIncidentBreachAging',
  'newsImpactRecoveryIncidentSloBreachWatchlistSelfTest',
  'newsImpactRecoveryIncidentSloBreachTriage',
  'newsImpactRecoveryIncidentBreachStageBuckets',
  'newsImpactRecoveryIncidentSloBreachTriageSelfTest',
  'newsImpactRecoveryIncidentSloBreachTriageTrend',
  'newsImpactRecoveryIncidentTriageRecurrence',
  'newsImpactRecoveryIncidentSloBreachTriageTrendSelfTest',
  'newsImpactRecoveryIncidentSloBreachImpactRanking',
  'newsImpactRecoveryIncidentOverdueContribution',
  'newsImpactRecoveryIncidentSloBreachImpactRankingSelfTest',
  'newsImpactRecoveryIncidentSloBreachImpactTrend',
  'newsImpactRecoveryIncidentWeeklyOverdueBurden',
  'newsImpactRecoveryIncidentSloBreachImpactTrendSelfTest',
  'newsImpactRecoveryIncidentSloImpactConcentration',
  'newsImpactRecoveryIncidentTopContributionShares',
  'newsImpactRecoveryIncidentSloImpactConcentrationSelfTest',
  'newsImpactRecoveryIncidentSloImpactConcentrationTrend',
  'newsImpactRecoveryIncidentWeeklyConcentrationShares',
  'newsImpactRecoveryIncidentSloImpactConcentrationTrendSelfTest',
  'newsImpactRecoveryIncidentSloImpactExecutiveSummary',
  'newsImpactRecoveryIncidentSloImpactUnifiedView',
  'newsImpactRecoveryIncidentSloImpactExecutiveSummarySelfTest',
  'newsImpactRecoveryIncidentSloImpactFocusQueue',
  'newsImpactRecoveryIncidentSloImpactFocusOrdering',
  'newsImpactRecoveryIncidentSloImpactFocusQueueSelfTest',
];

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function deploymentBaseUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('Deployment URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Deployment URL must not contain credentials.');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

async function request(fetchImpl, baseUrl, path, timeoutMs = 8000, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(new URL(path, baseUrl), {
      method: init.method || 'GET',
      redirect: 'follow',
      headers: { accept: 'application/json, text/html;q=0.9', ...(init.headers || {}) },
      ...(init.body !== undefined ? { body:init.body } : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonBody(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

export async function runDeploymentSmoke(rawBaseUrl, expectedVersion, options = {}) {
  const baseUrl = deploymentBaseUrl(rawBaseUrl);
  const fetchImpl = options.fetchImpl || fetch;
  const retries = Math.max(1, Number(options.retries || 10));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 6000));
  const rcNumber = /-rc(\d+)$/i.exec(String(expectedVersion || ''))?.[1];
  if (!rcNumber) throw new Error('Expected version must end with -rc<number>.');
  const expectedReleaseCandidate = `RC${rcNumber}`;
  let readiness = null;
  let health = null;
  let lastHealthError = '';

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await request(fetchImpl, baseUrl, '/health/ready');
      const body = await jsonBody(response, 'Readiness endpoint');
      if (!response.ok) throw new Error(`Readiness endpoint returned HTTP ${response.status}.`);
      if (body?.version !== expectedVersion) {
        throw new Error(`Expected ${expectedVersion}, received ${body?.version || 'unknown'}.`);
      }
      if (body?.ok !== true || body?.status !== 'ready') throw new Error('Readiness contract is not ready.');
      if (body?.checks?.supabase?.ok !== true) throw new Error('Readiness Supabase probe failed.');
      if (body?.checks?.schema?.ok !== true) throw new Error('Readiness schema fingerprint failed.');
      if (body?.checks?.backendSecurity?.ok !== true) throw new Error('Readiness backend security contract failed.');
      if (body?.checks?.telegramConfigured !== true) throw new Error('Readiness Telegram configuration failed.');
      if (Number(body?.checks?.recentSupabaseAuthFailures || 0) !== 0) throw new Error('Readiness detected recent Supabase authentication failures.');
      readiness = body;
      break;
    } catch (error) {
      lastHealthError = error?.message || String(error);
      if (attempt < retries) await delay(retryDelayMs);
    }
  }

  if (!readiness) throw new Error(`Deployment did not become ready: ${lastHealthError}`);
  if (readiness.releaseCandidate !== expectedReleaseCandidate) throw new Error(`Expected ${expectedReleaseCandidate}, received ${readiness.releaseCandidate || 'unknown'}.`);

  const healthResponse = await request(fetchImpl, baseUrl, '/health');
  health = await jsonBody(healthResponse, 'Health endpoint');
  if (!healthResponse.ok || health?.ok !== true) throw new Error('Health endpoint is not healthy.');
  if (health.releaseCandidate !== expectedReleaseCandidate) throw new Error(`Expected ${expectedReleaseCandidate}, received ${health.releaseCandidate || 'unknown'}.`);
  if (health.devMode !== false) throw new Error('Production deployment exposes DEV_MODE=true.');
  if (health.database !== 'supabase') throw new Error('Production deployment must use Supabase persistence.');
  if (health.monetization !== 'paused') throw new Error('Production deployment must keep MONETIZATION_ENABLED=false before beta.');
  if (health?.readiness?.ok !== true) throw new Error('Legacy health endpoint must embed a passing readiness snapshot.');
  for (const flag of REQUIRED_HEALTH_FLAGS) {
    if (health[flag] !== 'enabled') throw new Error(`Health flag ${flag} is not enabled.`);
  }

  const manifestResponse = await request(fetchImpl, baseUrl, '/api/app-manifest');
  const manifest = await jsonBody(manifestResponse, 'App manifest');
  if (!manifestResponse.ok || manifest?.version !== expectedVersion || manifest?.releaseCandidate !== expectedReleaseCandidate) {
    throw new Error(`Public app manifest does not match the deployed ${expectedReleaseCandidate} release.`);
  }

  const rootResponse = await request(fetchImpl, baseUrl, '/');
  const rootContentType = String(rootResponse.headers.get('content-type') || '').toLowerCase();
  if (!rootResponse.ok || !rootContentType.includes('text/html')) {
    throw new Error(`Static application shell failed: HTTP ${rootResponse.status}.`);
  }
  const contentSecurityPolicy = String(rootResponse.headers.get('content-security-policy') || '');
  if (!contentSecurityPolicy.includes("script-src 'self' https://telegram.org") || !contentSecurityPolicy.includes("object-src 'none'")) {
    throw new Error('Static application shell is missing the required Content-Security-Policy.');
  }
  if (String(rootResponse.headers.get('x-content-type-options') || '').toLowerCase() !== 'nosniff') {
    throw new Error('Static application shell is missing X-Content-Type-Options: nosniff.');
  }

  for (const path of ['/api/me', '/api/release-readiness', '/api/calibration-control', '/api/launch-funnel', '/api/admin/channel-publisher/test']) {
    const response = await request(fetchImpl, baseUrl, path);
    if (response.status !== 401) throw new Error(`${path} must reject missing Telegram auth with HTTP 401.`);
  }

  const hiddenProbe = await request(fetchImpl, baseUrl, '/health/supabase');
  if (hiddenProbe.status !== 404) throw new Error('/health/supabase must remain unavailable publicly.');

  const publicStatusResponse = await request(fetchImpl, baseUrl, '/api/public-status');
  const publicStatus = await jsonBody(publicStatusResponse, 'Public status endpoint');
  if (!publicStatusResponse.ok || publicStatus?.version !== expectedVersion || publicStatus?.releaseCandidate !== expectedReleaseCandidate) {
    throw new Error('Public status endpoint does not match the deployed release.');
  }
  const requiredServices = ['telegram','miniApp','aiAnalysis','search','live'];
  for (const service of requiredServices) {
    if (publicStatus?.services?.[service] !== 'operational') {
      throw new Error(`Public status service ${service} must be operational before beta.`);
    }
  }

  for (const path of ['/privacy.html','/terms.html','/status.html']) {
    const response=await request(fetchImpl,baseUrl,path);
    const type=String(response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok || !type.includes('text/html')) throw new Error(`${path} must be a public HTML page.`);
    const csp=String(response.headers.get('content-security-policy') || '');
    if (!csp.includes("object-src 'none'")) throw new Error(`${path} is missing the static security policy.`);
  }

  const webhookProbe=await request(fetchImpl,baseUrl,'/telegram/webhook',8000,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  if (webhookProbe.status !== 403) throw new Error(`Telegram webhook must reject a request without its secret with HTTP 403, received ${webhookProbe.status}.`);

  return {
    ok: true,
    origin: baseUrl.origin,
    version: health.version,
    releaseCandidate: health.releaseCandidate,
    checks: 25,
  };
}

async function main() {
  const [, , baseUrl, expectedVersion] = process.argv;
  if (!baseUrl || !expectedVersion) {
    throw new Error('Usage: node scripts/post-deploy-smoke.js <deployment-url> <expected-version>');
  }
  const result = await runDeploymentSmoke(baseUrl, expectedVersion);
  console.log(`Post-deploy smoke passed: ${result.version} at ${result.origin} (${result.checks} checks).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
