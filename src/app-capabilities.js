export function createAppCapabilitiesRuntime({
  memory,
  appVersion,
  minClientVersion,
  apiContractVersion,
  releaseChannel,
  releaseCandidate,
  paidQuotaHealthy,
  providerPublicBudgetMode,
  runtimeControlsSnapshot,
  isSecurityLockdownControls,
  publicRuntimeControls,
  currentReleaseIdentity,
  now=()=>new Date(),
} = {}) {
  if (!memory || typeof memory!=='object') throw new TypeError('memory is required');
  for (const [name,fn] of Object.entries({
    paidQuotaHealthy,
    providerPublicBudgetMode,
    runtimeControlsSnapshot,
    isSecurityLockdownControls,
    publicRuntimeControls,
    currentReleaseIdentity,
  })) {
    if (typeof fn!=='function') throw new TypeError(`${name} is required`);
  }

  function runtimeFeatureEnabled(value) {
    return value === undefined ? true : value === true;
  }

  function normalizedRuntimeControls() {
    const value=runtimeControlsSnapshot();
    return value && typeof value==='object' && !Array.isArray(value) ? value : {};
  }

  function normalizedPublicBudget() {
    const value=providerPublicBudgetMode();
    const budget=value && typeof value==='object' && !Array.isArray(value) ? value : {};
    const refresh=Number(budget.liveRefreshSeconds);
    return {
      ...budget,
      mode:String(budget.mode || 'emergency'),
      label:String(budget.label || 'Защитный режим'),
      liveRefreshSeconds:Number.isFinite(refresh)
        ? Math.max(0,Math.min(3600,Math.floor(refresh)))
        : 0,
    };
  }

  function publicDataCapabilities() {
    const paid=['PRO','ULTRA','MEGA'].includes(String(memory.provider?.plan || '').toUpperCase());
    const healthy=paidQuotaHealthy() === true;
    const publicBudget=normalizedPublicBudget();
    const runtime=normalizedRuntimeControls();
    const expandedAllowed=runtimeFeatureEnabled(runtime.expandedDataEnabled);
    const liveAllowed=runtimeFeatureEnabled(runtime.liveEnabled);
    const canEnrich=Boolean(
      paid
      && healthy
      && expandedAllowed
      && !['conserve','emergency'].includes(publicBudget.mode)
    );

    return {
      visibility:'public',
      mode:paid ? 'expanded' : 'standard',
      label:isSecurityLockdownControls(runtime)
        ? 'Security Lockdown'
        : runtime.maintenanceMode
          ? 'Техническое обслуживание'
          : publicBudget.label,
      refreshSeconds:liveAllowed ? publicBudget.liveRefreshSeconds : 0,
      runtime:publicRuntimeControls(runtime),
      features:{
        events:true,
        matchStatistics:true,
        liveRefresh:liveAllowed,
        lineupsFallback:Boolean(paid && healthy && expandedAllowed),
        playerStats:canEnrich,
        injuries:canEnrich,
        liveOdds:Boolean(canEnrich && liveAllowed),
        oddsMovement:Boolean(canEnrich && liveAllowed),
      },
      note:isSecurityLockdownControls(runtime)
        ? (runtime.message || 'Аварийный режим безопасности: изменения и внешние запросы временно остановлены.')
        : runtime.maintenanceMode
          ? (runtime.message || 'Часть футбольных функций временно приостановлена.')
          : !expandedAllowed
            ? 'Расширенные данные источника временно отключены администратором.'
            : paid
              ? (
                canEnrich
                  ? 'Расширенный режим активен. Сохранение данных по функциям снижает количество повторных запросов.'
                  : 'Расширенный тариф активен, но сейчас включён защитный режим квоты.'
              )
              : 'Сейчас приложение экономит запросы. После увеличения квоты расширенные данные включатся автоматически.',
    };
  }

  function appManifest(cfg) {
    return {
      ok:true,
      app:'football-manager',
      version:String(appVersion || ''),
      recommendedClientVersion:String(appVersion || ''),
      minClientVersion:String(minClientVersion || ''),
      apiContract:Number(apiContractVersion || 0),
      releaseChannel:String(releaseChannel || ''),
      releaseCandidate:String(releaseCandidate || ''),
      deployment:currentReleaseIdentity(cfg),
      maintenance:normalizedRuntimeControls().maintenanceMode === true,
      monetization:cfg?.monetizationEnabled === true ? 'enabled' : 'paused',
      runtime:publicRuntimeControls(normalizedRuntimeControls()),
      compatibility:{
        hardBlockBelowMinClient:true,
        contractRequired:Number(apiContractVersion || 0),
        softReloadOnVersionDifference:true,
      },
      features:{
        startupSafety:true,
        rollbackSafety:true,
        failureRecovery:true,
        productionLoadSafety:true,
        regressionQA:true,
        releaseMonitor:true,
        productionMonitor:true,
        rollbackVerification:true,
        providerDataReliability:true,
        aiAnalysisQualityGate:true,
        clientTelemetry:true,
        notificationReliability:true,
        reminderDeliveryClaims:true,
        runtimeControls:true,
        emergencyKillSwitches:true,
        cloudflareEdgeRateLimits:true,
        emergencySecurityLockdown:true,
        runtimeRollback:true,
        runtimeHistory:true,
        predictionIntegrity:true,
        modelVersionCohorts:true,
        calibrationDiagnostics:true,
        predictionRemediation:true,
        settlementRecovery:true,
        settlementWatchdog:true,
        automaticSettlementRecovery:true,
        settlementCircuitBreaker:true,
        settlementReliability:true,
        settlementRunLedger:true,
        interruptedRunRecovery:true,
        settlementFinalityVerification:true,
        settlementDriftGuard:true,
        settlementDriftReview:true,
        settlementAdjudication:true,
        trustedMetricsGate:true,
        twoPassSettlementFinality:true,
        calibrationPromotionGate:true,
        adaptiveWeightsHoldout:true,
        unifiedSearch:true,
        searchMatchHistory:true,
        searchLeagueFixtures:true,
        searchQualityDrill:true,
        searchOutcomeAnalytics:true,
        zeroResultRecovery:true,
        teamFixtureDiscovery:true,
        matchSelectionIntelligence:true,
        primaryMatchRecommendation:true,
        oneTapAiHandoff:true,
        telegramMiniAppE2E:true,
        telegramWebhookPersistentDedupe:true,
        telegramWebhookDedupeObservability:true,
        supabaseProbeConfirmation:true,
        supabaseSchemaProbeConfirmation:true,
        cachedFullAnalysisHandoff:true,
        aiFreshnessGuard:true,
        preKickoffRecheck:true,
        preKickoffChangeDetection:true,
        analysisDeltaSummary:true,
        smartNotifications:true,
        smartNotificationEntitlements:true,
        calibrationChampionChallenger:true,
        calibrationAutomaticRollback:true,
      },
      serverTime:now().toISOString(),
    };
  }

  return Object.freeze({
    publicDataCapabilities,
    appManifest,
  });
}
