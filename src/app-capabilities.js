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

  function plainObject(value) {
    return value && typeof value==='object' && !Array.isArray(value) ? value : null;
  }

  function failClosedRuntimeControls() {
    return {
      maintenanceMode:true,
      liveEnabled:false,
      expandedDataEnabled:false,
      message:'Публичные настройки функций временно недоступны.',
    };
  }

  function normalizedPublicRuntimeControls(runtime) {
    try {
      return plainObject(publicRuntimeControls(runtime)) || {};
    } catch {
      return {};
    }
  }

  function securityLockdown(runtime) {
    try {
      return isSecurityLockdownControls(runtime) === true;
    } catch {
      return true;
    }
  }

  function normalizedDeployment(cfg) {
    try {
      return plainObject(currentReleaseIdentity(cfg)) || {};
    } catch {
      return {};
    }
  }

  function normalizedServerTime() {
    try {
      const value=now();
      const date=value instanceof Date ? value : new Date(value);
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    } catch {
      return null;
    }
  }

  function normalizedRuntimeControls() {
    try {
      return plainObject(runtimeControlsSnapshot()) || failClosedRuntimeControls();
    } catch {
      return failClosedRuntimeControls();
    }
  }

  function normalizedPublicBudget() {
    let budget={};
    try {
      budget=plainObject(providerPublicBudgetMode()) || {};
    } catch {}
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
    let healthy=false;
    try {
      healthy=paidQuotaHealthy() === true;
    } catch {}
    const publicBudget=normalizedPublicBudget();
    const runtime=normalizedRuntimeControls();
    const locked=securityLockdown(runtime);
    const expandedAllowed=runtimeFeatureEnabled(runtime.expandedDataEnabled);
    const liveAllowed=runtimeFeatureEnabled(runtime.liveEnabled) && !locked;
    const canEnrich=Boolean(
      paid
      && healthy
      && expandedAllowed
      && !locked
      && !['conserve','emergency'].includes(publicBudget.mode)
    );

    return {
      visibility:'public',
      mode:paid ? 'expanded' : 'standard',
      label:locked
        ? 'Security Lockdown'
        : runtime.maintenanceMode
          ? 'Техническое обслуживание'
          : publicBudget.label,
      refreshSeconds:liveAllowed ? publicBudget.liveRefreshSeconds : 0,
      runtime:normalizedPublicRuntimeControls(runtime),
      features:{
        events:true,
        matchStatistics:true,
        liveRefresh:liveAllowed,
        lineupsFallback:Boolean(paid && healthy && expandedAllowed && !locked),
        playerStats:canEnrich,
        injuries:canEnrich,
        liveOdds:Boolean(canEnrich && liveAllowed),
        oddsMovement:Boolean(canEnrich && liveAllowed),
      },
      note:locked
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
      deployment:normalizedDeployment(cfg),
      maintenance:normalizedRuntimeControls().maintenanceMode === true,
      monetization:cfg?.monetizationEnabled === true ? 'enabled' : 'paused',
      runtime:normalizedPublicRuntimeControls(normalizedRuntimeControls()),
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
        focusedMatchHome:true,
        contextualLeagueFilter:true,
        telegramMiniAppE2E:true,
        telegramWebhookPersistentDedupe:true,
        telegramWebhookDedupeObservability:true,
        supabaseProbeConfirmation:true,
        supabaseSchemaProbeConfirmation:true,
        cachedFullAnalysisHandoff:true,
        aiLiveCoach:true,
        prematchLiveComparison:true,
        liveScenarioGuard:true,
        aiFreshnessGuard:true,
        preKickoffRecheck:true,
        preKickoffChangeDetection:true,
        analysisDeltaSummary:true,
        smartNotifications:true,
        smartNotificationEntitlements:true,
        calibrationChampionChallenger:true,
        calibrationAutomaticRollback:true,
      },
      serverTime:normalizedServerTime(),
    };
  }

  return Object.freeze({
    publicDataCapabilities,
    appManifest,
  });
}
