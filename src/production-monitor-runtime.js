// Release health and production monitoring extracted from worker.js.
// Observability, persistence and alert-delivery primitives are injected by the composition root.
export function createProductionMonitorRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Production monitor runtime dependencies are required.');
  }
  const {
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
  } = deps;

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
      {
        nowMs:now.getTime(),
        days:7,
        evidenceComplete:Boolean(digestReliabilitySource.persistent && !digestReliabilitySource.truncated),
      },
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

  return {
    releaseTopGroups,
    summarizeReleaseWindow,
    releaseMonitorHealth,
    productionMonitorState,
    productionMonitorSelfTest,
    runProductionMonitor,
  };
}
