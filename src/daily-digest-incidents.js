const ALERTABLE_CODES = new Set([
  'DAILY_DIGEST_BACKLOG_LATE',
  'DAILY_DIGEST_SEALED_CLAIMS',
]);

const HEALTHY_CODES = new Set([
  'DAILY_DIGEST_RUN_OK',
  'DAILY_DIGEST_RUN_EMPTY',
  'DAILY_DIGEST_CLAIMS_RECOVERED',
]);

function iso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function normalizeEvent(row = {}) {
  return {
    at: iso(row.created_at || row.createdAt || row.at),
    code: String(row.code || ''),
    severity: String(row.severity || ''),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

function dateForEvent(event = {}) {
  return String(event.metadata?.date || event.at || '').slice(0,10);
}

function incidentId(date = '') {
  return 'digest-' + String(date || 'unknown');
}

export function buildDailyDigestIncidentReport(rows = [], { nowMs = Date.now() } = {}) {
  const events = (rows || [])
    .map(normalizeEvent)
    .filter(event => event.at && (ALERTABLE_CODES.has(event.code) || HEALTHY_CODES.has(event.code)))
    .sort((a,b) => Date.parse(a.at) - Date.parse(b.at));

  const byDate = new Map();
  for (const event of events) {
    const date = dateForEvent(event);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date,[]);
    byDate.get(date).push(event);
  }

  const history = [];
  for (const [date, list] of byDate.entries()) {
    const firstAlert = list.find(event => ALERTABLE_CODES.has(event.code));
    if (!firstAlert) continue;
    const last = list.at(-1);
    const recovered = HEALTHY_CODES.has(last?.code) && Date.parse(last.at) > Date.parse(firstAlert.at);
    const latestAlert = [...list].reverse().find(event => ALERTABLE_CODES.has(event.code)) || firstAlert;
    const meta = latestAlert.metadata || {};
    const startedAt = firstAlert.at;
    const recoveredAt = recovered ? last.at : null;
    const endMs = recoveredAt ? Date.parse(recoveredAt) : Number(nowMs);
    const startMs = Date.parse(startedAt);
    history.push({
      incidentId:incidentId(date),
      date,
      active:!recovered,
      state:recovered ? 'recovered' : 'incident',
      highestState:'incident',
      severity:'warning',
      startedAt,
      latestAt:last?.at || latestAlert.at,
      recoveredAt,
      durationMinutes:Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, Math.round(((endMs-startMs)/60000)*10)/10)
        : null,
      fingerprint:'daily_digest|' + date,
      diagnostics:{
        code:latestAlert.code,
        remaining:Number(meta.remaining ?? meta.backlog ?? 0),
        sealedClaims:Number(meta.sealedClaims || 0),
        failed:Number(meta.failed || 0),
        completionRate:Number(meta.completionRate ?? 1),
        oldestActiveClaimAgeMs:Number(meta.oldestActiveClaimAgeMs || 0),
      },
    });
  }

  history.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  const activeIncident = history.find(item => item.active) || null;
  return {
    state:activeIncident ? 'incident' : history.length ? 'healthy' : 'collecting',
    activeIncident,
    history,
  };
}

function destinationRows(destinations = []) {
  return (destinations || []).map((item,index) => ({
    slot:Number.isInteger(Number(item?.slot)) ? Number(item.slot) : index,
    destinationKey:String(item?.destinationKey || item?.destination_key || ''),
  })).filter(item => item.slot >= 0 && item.destinationKey);
}

function ledgerRowsFor(rows = [], incidentId = '') {
  return (rows || []).filter(row => String(row?.incident_id || row?.incidentId || '') === incidentId);
}

function sentFor(rows = [], alertKey = '', destinationKey = '') {
  return rows.some(row =>
    String(row?.alert_key || row?.alertKey || '') === alertKey
    && String(row?.destination_key || row?.destinationKey || '') === destinationKey
    && String(row?.status || '') === 'sent'
  );
}

export function planDailyDigestIncidentAlert(report = {}, ledgerRows = [], { destinations = [] } = {}) {
  const targets = destinationRows(destinations);
  if (!targets.length) return { action:'none', reason:'no_admin_recipients' };

  const active = report?.activeIncident;
  if (active?.active) {
    const alertKey = active.incidentId + ':incident';
    const rows = ledgerRowsFor(ledgerRows,active.incidentId);
    const pending = targets.filter(target => !sentFor(rows,alertKey,target.destinationKey));
    if (!pending.length) return { action:'none', reason:'incident_alert_deduplicated' };
    return {
      action:'send',
      kind:'incident',
      incidentId:active.incidentId,
      incident:active,
      alertKey,
      deliveryKey:alertKey,
      severity:'warning',
      targetDeliveries:pending,
      targetSlots:pending.map(x=>x.slot),
    };
  }

  const recovered = Array.isArray(report?.history)
    ? report.history.find(item => !item.active && item.incidentId)
    : null;
  if (!recovered) return { action:'none', reason:'no_incident' };
  const rows = ledgerRowsFor(ledgerRows,recovered.incidentId);
  const openKey = recovered.incidentId + ':incident';
  const hadOpenAttempt = rows.some(row => String(row?.alert_key || row?.alertKey || '') === openKey);
  if (!hadOpenAttempt) return { action:'none', reason:'recovery_without_prior_incident_alert' };
  const alertKey = recovered.incidentId + ':recovery';
  const pending = targets.filter(target => !sentFor(rows,alertKey,target.destinationKey));
  if (!pending.length) return { action:'none', reason:'recovery_alert_deduplicated' };
  return {
    action:'send',
    kind:'recovery',
    incidentId:recovered.incidentId,
    incident:recovered,
    alertKey,
    deliveryKey:alertKey,
    severity:'info',
    targetDeliveries:pending,
    targetSlots:pending.map(x=>x.slot),
  };
}

export function formatDailyDigestIncidentAlert(plan = {}) {
  const incident = plan.incident || {};
  const d = incident.diagnostics || {};
  if (plan.kind === 'recovery') {
    return [
      '✅ Daily Digest recovered',
      '',
      'Дата: ' + String(incident.date || '—'),
      'Incident ID: ' + String(incident.incidentId || '—'),
      'Восстановление: ' + (iso(incident.recoveredAt) || '—'),
      'Длительность: ' + (Number.isFinite(Number(incident.durationMinutes)) ? Number(incident.durationMinutes).toFixed(1) + ' мин' : '—'),
      'Backlog очищен, sealed/stuck состояние больше не активно.',
    ].join('\n');
  }

  return [
    '⚠️ Daily Digest operational incident',
    '',
    'Дата: ' + String(incident.date || '—'),
    'Причина: ' + String(d.code || 'digest health threshold'),
    'Осталось получателей: ' + String(Number(d.remaining || 0)),
    'Sealed claims: ' + String(Number(d.sealedClaims || 0)),
    'Failed: ' + String(Number(d.failed || 0)),
    'Completion rate: ' + (Number.isFinite(Number(d.completionRate)) ? (Number(d.completionRate)*100).toFixed(1) + '%' : '—'),
    'Oldest claim age: ' + Math.round(Number(d.oldestActiveClaimAgeMs || 0)/1000) + ' сек',
    'Incident ID: ' + String(incident.incidentId || '—'),
    '',
    'Проверь ops_events daily_digest и persistent claims. Автоматический rollback или отключение функций не выполняется.',
  ].join('\n');
}

export function dailyDigestIncidentAlertOpsEvents(plan = {}, delivery = {}) {
  const outcomes = Array.isArray(delivery?.outcomes) ? delivery.outcomes : [];
  const groups = new Map();
  for (const item of outcomes) {
    const state=String(item?.state || 'unknown');
    if (!groups.has(state)) groups.set(state,[]);
    groups.get(state).push(item);
  }
  const out=[];
  for (const [state,items] of groups.entries()) {
    const spec={
      sent:['info',plan.kind==='recovery'?'DAILY_DIGEST_RECOVERY_ALERT_SENT':'DAILY_DIGEST_INCIDENT_ALERT_SENT'],
      duplicate:['info','DAILY_DIGEST_INCIDENT_ALERT_DUPLICATE_SUPPRESSED'],
      retry_pending:['warning','DAILY_DIGEST_INCIDENT_ALERT_RETRY_PENDING'],
      terminal_failed:['warning','DAILY_DIGEST_INCIDENT_ALERT_TERMINAL_FAILED'],
      unknown:['warning','DAILY_DIGEST_INCIDENT_ALERT_UNKNOWN'],
      persistence_failure:['error','DAILY_DIGEST_INCIDENT_ALERT_PERSISTENCE_FAILED'],
    }[state] || ['warning','DAILY_DIGEST_INCIDENT_ALERT_STATE'];
    out.push({
      severity:spec[0],
      source:'digest_alert',
      eventType:'alert_delivery',
      code:spec[1],
      message:'Daily digest operational alert delivery state: ' + state + '.',
      endpoint:'cron:production-monitor',
      meta:{
        incidentId:plan.incidentId || null,
        alertKind:String(plan.kind || ''),
        deliveryKey:String(plan.alertKey || ''),
        recipientSlots:items.map(x=>Number(x.slot)).filter(Number.isInteger),
        recipientCount:items.length,
      },
    });
  }
  return out;
}


function digestLedgerSummary(rows = [], incidentId = '') {
  const relevant=ledgerRowsFor(rows,incidentId);
  const states={sending:0,sent:0,retry_pending:0,terminal_failed:0,unknown:0};
  for (const row of relevant) {
    const status=String(row?.status || '').trim();
    if (Object.prototype.hasOwnProperty.call(states,status)) states[status]+=1;
  }
  return {
    rows:relevant.length,
    states,
    operationalAttention:states.retry_pending+states.terminal_failed+states.unknown,
    lastUpdatedAt:relevant.map(row=>iso(row?.updated_at || row?.created_at)).filter(Boolean).sort().at(-1) || null,
  };
}

export function summarizeDailyDigestOperationalStatus(rows = [], ledgerRows = [], { nowMs = Date.now() } = {}) {
  const events=(rows || [])
    .map(normalizeEvent)
    .filter(event=>event.at)
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const latest=events.at(-1) || null;
  const latestMeta=latest?.metadata || {};
  const report=buildDailyDigestIncidentReport(rows,{nowMs});
  const latestHistory=report.history?.[0] || null;
  const incident=report.activeIncident || latestHistory || null;
  const ledger=digestLedgerSummary(ledgerRows,incident?.incidentId || '');

  const completionRateRaw=Number(latestMeta.completionRate);
  const completionRate=Number.isFinite(completionRateRaw)
    ? Math.max(0,Math.min(1,completionRateRaw))
    : null;
  const remaining=Math.max(0,Number(latestMeta.remaining ?? latestMeta.backlog ?? 0));
  const sealedClaims=Math.max(0,Number(latestMeta.sealedClaims || 0));
  const failed=Math.max(0,Number(latestMeta.failed || 0));
  const rateLimited=Math.max(0,Number(latestMeta.rateLimited || 0));
  const truncated=Boolean(latestMeta.truncated);
  const oldestActiveClaimAgeMs=Math.max(0,Number(latestMeta.oldestActiveClaimAgeMs || 0));

  let state='collecting';
  if (report.activeIncident) state='incident';
  else if (latest && ['warning','error','critical'].includes(latest.severity)) state='watch';
  else if (latest) state='healthy';

  return {
    available:Boolean(latest),
    state,
    label:state==='incident'
      ? 'Есть активный инцидент Daily Digest'
      : state==='watch'
        ? 'Daily Digest требует контроля'
        : state==='healthy'
          ? 'Daily Digest работает штатно'
          : 'Нет данных о Daily Digest',
    generatedAt:new Date(Number(nowMs)).toISOString(),
    latestRun:latest ? {
      at:latest.at,
      code:latest.code,
      severity:latest.severity || 'info',
      date:dateForEvent(latest),
      scanned:Number(latestMeta.scanned || 0),
      eligible:Number(latestMeta.eligible || 0),
      claimed:Number(latestMeta.claimed || 0),
      sent:Number(latestMeta.sent || 0),
      duplicate:Number(latestMeta.duplicate || 0),
      failed,
      rateLimited,
      deferred:Math.max(0,Number(latestMeta.deferred || 0)),
      remaining,
      backlog:Math.max(0,Number(latestMeta.backlog ?? remaining)),
      sealedClaims,
      expiredClaims:Math.max(0,Number(latestMeta.expiredClaims || 0)),
      recoveredClaims:Math.max(0,Number(latestMeta.recoveredClaims || 0)),
      completionRate,
      oldestActiveClaimAgeMs,
      truncated,
      durationMs:Math.max(0,Number((latestMeta.duration ?? latestMeta.durationMs) || 0)),
    } : null,
    incident:{
      state:report.state,
      active:Boolean(report.activeIncident),
      incidentId:report.activeIncident?.incidentId || null,
      startedAt:report.activeIncident?.startedAt || null,
      recoveredAt:latestHistory?.recoveredAt || null,
      lastRecoveryAt:report.history.find(item=>item.recoveredAt)?.recoveredAt || null,
      historyCount:Number(report.history?.length || 0),
      diagnostics:report.activeIncident?.diagnostics || latestHistory?.diagnostics || null,
    },
    alertDelivery:ledger,
    policy:{
      automaticRollback:false,
      automaticFeatureDisable:false,
      source:'ops_events_and_persistent_alert_ledger',
    },
  };
}


export function summarizeDailyDigestReliability(rows = [], { days = 7, nowMs = Date.now() } = {}) {
  const windowDays=Math.max(1,Math.min(30,Number(days || 7)));
  const endMs=Number(nowMs);
  const startMs=endMs-windowDays*24*3600_000;
  const events=(rows || [])
    .map(normalizeEvent)
    .filter(event => {
      const atMs=Date.parse(event.at || '');
      return Number.isFinite(atMs)
        && atMs>=startMs
        && atMs<=endMs
        && event.code.startsWith('DAILY_DIGEST_');
    })
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));

  const grouped=new Map();
  for (const event of events) {
    const date=dateForEvent(event);
    if (!date) continue;
    if (!grouped.has(date)) grouped.set(date,[]);
    grouped.get(date).push(event);
  }

  let totalSent=0;
  let totalClaimed=0;
  let totalFailed=0;
  let totalRateLimited=0;
  let backlogOccurrences=0;
  let backlogDays=0;
  let sealedClaimDays=0;
  let degradedDays=0;
  let truncatedDays=0;
  let maxBacklog=0;
  const daily=[];

  for (const [date,list] of [...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
    let sent=0;
    let claimed=0;
    let failed=0;
    let rateLimited=0;
    let backlogRuns=0;
    let dayMaxBacklog=0;
    let sealed=false;
    let degraded=false;
    let truncated=false;

    for (const event of list) {
      const meta=event.metadata || {};
      sent+=Math.max(0,Number(meta.sent || 0));
      claimed+=Math.max(0,Number(meta.claimed || 0));
      failed+=Math.max(0,Number(meta.failed || 0));
      rateLimited+=Math.max(0,Number(meta.rateLimited || 0));
      const backlog=Math.max(0,Number(meta.remaining ?? meta.backlog ?? 0));
      if (backlog>0) backlogRuns+=1;
      dayMaxBacklog=Math.max(dayMaxBacklog,backlog);
      sealed ||= event.code==='DAILY_DIGEST_SEALED_CLAIMS' || Number(meta.sealedClaims || 0)>0;
      degraded ||= event.code==='DAILY_DIGEST_RUN_DEGRADED';
      truncated ||= event.code==='DAILY_DIGEST_RUN_TRUNCATED' || Boolean(meta.truncated);
    }

    const final=list.at(-1);
    const finalMeta=final?.metadata || {};
    const finalRemaining=Math.max(0,Number(finalMeta.remaining ?? finalMeta.backlog ?? 0));
    const completionRate=claimed>0 ? Number((sent/claimed).toFixed(4))
      : Number.isFinite(Number(finalMeta.completionRate)) ? Number(finalMeta.completionRate)
        : finalRemaining===0 && failed===0 ? 1 : null;

    totalSent+=sent;
    totalClaimed+=claimed;
    totalFailed+=failed;
    totalRateLimited+=rateLimited;
    backlogOccurrences+=backlogRuns;
    if (backlogRuns>0) backlogDays+=1;
    if (sealed) sealedClaimDays+=1;
    if (degraded) degradedDays+=1;
    if (truncated) truncatedDays+=1;
    maxBacklog=Math.max(maxBacklog,dayMaxBacklog);

    daily.push({
      date,
      runs:list.length,
      sent,
      claimed,
      failed,
      rateLimited,
      completionRate,
      backlogOccurrences:backlogRuns,
      maxBacklog:dayMaxBacklog,
      finalRemaining,
      sealedClaims:sealed,
      degraded,
      truncated,
      finalCode:String(final?.code || ''),
      lastAt:final?.at || null,
    });
  }

  const incidentReport=buildDailyDigestIncidentReport(events,{nowMs:endMs});
  const periodIncidentDates=incidentReport.history.filter(item => {
    const t=Date.parse(String(item.startedAt || ''));
    return Number.isFinite(t) && t>=startMs && t<=endMs;
  });
  const recovered=periodIncidentDates.filter(item=>item.recoveredAt && Number.isFinite(Number(item.durationMinutes)));
  const averageRecoveryMinutes=recovered.length
    ? Number((recovered.reduce((sum,item)=>sum+Number(item.durationMinutes || 0),0)/recovered.length).toFixed(1))
    : null;

  return {
    available:events.length>0,
    days:windowDays,
    windowStartedAt:new Date(startMs).toISOString(),
    windowEndedAt:new Date(endMs).toISOString(),
    sampleDays:daily.length,
    expectedDays:windowDays,
    coverageRate:Number((daily.length/windowDays).toFixed(4)),
    runs:events.length,
    totals:{
      sent:totalSent,
      claimed:totalClaimed,
      failed:totalFailed,
      rateLimited:totalRateLimited,
    },
    completionRate:totalClaimed>0 ? Number((totalSent/totalClaimed).toFixed(4)) : null,
    backlog:{
      occurrences:backlogOccurrences,
      days:backlogDays,
      maxRecipients:maxBacklog,
    },
    sealedClaimDays,
    degradedDays,
    truncatedDays,
    rateLimitDays:daily.filter(item=>item.rateLimited>0).length,
    incidents:{
      count:periodIncidentDates.length,
      recovered:recovered.length,
      active:periodIncidentDates.filter(item=>item.active).length,
      averageRecoveryMinutes,
      maxRecoveryMinutes:recovered.length ? Math.max(...recovered.map(item=>Number(item.durationMinutes || 0))) : null,
    },
    daily,
    policy:{
      aggregateOnly:true,
      userIdentifiers:false,
    },
  };
}


export const DAILY_DIGEST_RELIABILITY_SLO = Object.freeze({
  missingRunHourUtc:8,
  missingRunMinuteUtc:15,
  minSampleDays:3,
  minClaimedDeliveries:100,
  completionRateWatch:0.98,
  backlogDaysWatch:2,
  rateLimitDaysWatch:2,
  incidentDaysWatch:2,
  degradedDaysWatch:2,
});

function utcDate(ms) {
  return new Date(Number(ms)).toISOString().slice(0,10);
}

function afterMissingRunGrace(nowMs, policy = DAILY_DIGEST_RELIABILITY_SLO) {
  const now=new Date(Number(nowMs));
  if (!Number.isFinite(now.getTime())) return false;
  const minuteOfDay=now.getUTCHours()*60+now.getUTCMinutes();
  return minuteOfDay >= Number(policy.missingRunHourUtc)*60+Number(policy.missingRunMinuteUtc);
}

export function assessDailyDigestReliabilitySlo(rows = [], {
  nowMs = Date.now(),
  days = 7,
  policy = DAILY_DIGEST_RELIABILITY_SLO,
} = {}) {
  const now=Number(nowMs);
  const date=utcDate(now);
  const normalized=(rows || []).map(normalizeEvent).filter(event=>event.at);
  const todayEvents=normalized.filter(event=>dateForEvent(event)===date && event.code.startsWith('DAILY_DIGEST_'));
  const latestSuccessfulDigestRun=[...normalized]
    .filter(event=>event.code==='DAILY_DIGEST_RUN_OK' || event.code==='DAILY_DIGEST_RUN_EMPTY')
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))
    .at(-1)?.at || null;
  const diagnostics={
    window:{startUtc:'07:00',endUtc:'07:55',cutoffUtc:'08:15',timezone:'UTC'},
    expectedState:'daily_digest_run_observed_by_cutoff',
    lastSuccessfulDigestRun:latestSuccessfulDigestRun,
    evaluatedAt:new Date(now).toISOString(),
    todayRunObserved:todayEvents.length>0,
  };

  if (afterMissingRunGrace(now,policy) && todayEvents.length===0) {
    return {
      state:'watch',
      severity:'warning',
      code:'DAILY_DIGEST_SLO_MISSING_RUN',
      reason:'missing_run',
      date,
      message:`Daily Digest has no operational run event for ${date} after the 08:15 UTC grace point.`,
      reliability:summarizeDailyDigestReliability(rows,{days,nowMs:now}),
      policy,
      diagnostics,
    };
  }

  const reliability=summarizeDailyDigestReliability(rows,{days,nowMs:now});
  if (!afterMissingRunGrace(now,policy) && todayEvents.length===0) {
    return {
      state:'collecting',
      severity:'info',
      code:'DAILY_DIGEST_SLO_COLLECTING',
      reason:'before_delivery_window_completion',
      date,
      message:'Daily Digest reliability SLO is collecting data before the missing-run grace point.',
      reliability,
      policy,
      diagnostics,
    };
  }

  const enoughSample=Number(reliability.sampleDays || 0)>=Number(policy.minSampleDays || 0)
    && Number(reliability.totals?.claimed || 0)>=Number(policy.minClaimedDeliveries || 0);
  if (!enoughSample) {
    return {
      state:'collecting',
      severity:'info',
      code:'DAILY_DIGEST_SLO_COLLECTING',
      reason:'insufficient_sample',
      date,
      message:'Daily Digest reliability SLO needs more historical delivery volume before trend thresholds are enforced.',
      reliability,
      policy,
      diagnostics,
    };
  }

  const checks=[
    {
      hit:Number(reliability.completionRate ?? 1)<Number(policy.completionRateWatch),
      code:'DAILY_DIGEST_SLO_COMPLETION',
      reason:'completion_rate',
      message:`Daily Digest 7-day completion rate is ${(Number(reliability.completionRate || 0)*100).toFixed(2)}%, below the ${(Number(policy.completionRateWatch)*100).toFixed(2)}% watch threshold.`,
    },
    {
      hit:Number(reliability.backlog?.days || 0)>=Number(policy.backlogDaysWatch),
      code:'DAILY_DIGEST_SLO_BACKLOG_REPEATED',
      reason:'backlog_days',
      message:`Daily Digest backlog occurred on ${Number(reliability.backlog?.days || 0)} day(s) in the reliability window.`,
    },
    {
      hit:Number(reliability.rateLimitDays || 0)>=Number(policy.rateLimitDaysWatch),
      code:'DAILY_DIGEST_SLO_RATE_LIMIT_REPEATED',
      reason:'rate_limit_days',
      message:`Daily Digest hit Telegram rate limits on ${Number(reliability.rateLimitDays || 0)} day(s) in the reliability window.`,
    },
    {
      hit:Number(reliability.incidents?.count || 0)>=Number(policy.incidentDaysWatch),
      code:'DAILY_DIGEST_SLO_INCIDENT_REPEATED',
      reason:'incident_days',
      message:`Daily Digest had ${Number(reliability.incidents?.count || 0)} operational incident day(s) in the reliability window.`,
    },
    {
      hit:Number(reliability.degradedDays || 0)>=Number(policy.degradedDaysWatch),
      code:'DAILY_DIGEST_SLO_DEGRADED_REPEATED',
      reason:'degraded_days',
      message:`Daily Digest was degraded on ${Number(reliability.degradedDays || 0)} day(s) in the reliability window.`,
    },
  ];
  const failed=checks.filter(check=>check.hit);
  if (failed.length) {
    return {
      state:'watch',
      severity:'warning',
      code:failed[0].code,
      reason:failed[0].reason,
      reasons:failed.map(check=>check.reason),
      date,
      message:failed.map(check=>check.message).join(' '),
      reliability,
      policy,
      diagnostics,
    };
  }

  return {
    state:'healthy',
    severity:'info',
    code:'DAILY_DIGEST_SLO_OK',
    reason:'within_thresholds',
    date,
    message:'Daily Digest reliability SLO is within configured watch thresholds.',
    reliability,
    policy,
    diagnostics,
  };
}

export function planDailyDigestReliabilitySloEvent(assessment = {}, priorRows = []) {
  const date=String(assessment?.date || '');
  const rows=(priorRows || [])
    .map(row=>({
      at:iso(row?.created_at || row?.createdAt || row?.at),
      severity:String(row?.severity || ''),
      code:String(row?.code || ''),
      metadata:row?.metadata && typeof row.metadata==='object' ? row.metadata : {},
    }))
    .filter(row=>row.at)
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const latest=rows.at(-1) || null;
  const latestState=String(latest?.metadata?.state || (latest?.severity==='warning' ? 'watch' : ''));
  const latestDate=String(latest?.metadata?.date || latest?.at || '').slice(0,10);
  const latestReason=String(latest?.metadata?.reason || '');
  const dailyMissingRunReset=assessment.state==='watch'
    && assessment.reason==='missing_run'
    && latestState==='watch'
    && latestDate
    && latestDate!==date;

  if (assessment.state==='watch') {
    if (latestState==='watch' && !dailyMissingRunReset) {
      return {action:'none',reason:'watch_episode_already_recorded'};
    }
    return {
      action:'record',
      severity:'warning',
      source:'digest_slo',
      eventType:'reliability_slo',
      code:String(assessment.code || 'DAILY_DIGEST_SLO_WATCH'),
      message:String(assessment.message || 'Daily Digest reliability SLO requires attention.'),
      endpoint:'cron:production-monitor',
      meta:{
        date,
        state:'watch',
        reason:String(assessment.reason || ''),
        reasons:Array.isArray(assessment.reasons)?assessment.reasons:[],
        sampleDays:Number(assessment.reliability?.sampleDays || 0),
        claimed:Number(assessment.reliability?.totals?.claimed || 0),
        completionRate:assessment.reliability?.completionRate ?? null,
        backlogDays:Number(assessment.reliability?.backlog?.days || 0),
        rateLimitDays:Number(assessment.reliability?.rateLimitDays || 0),
        incidentDays:Number(assessment.reliability?.incidents?.count || 0),
        degradedDays:Number(assessment.reliability?.degradedDays || 0),
        window:assessment.diagnostics?.window || null,
        expectedState:String(assessment.diagnostics?.expectedState || ''),
        lastSuccessfulDigestRun:assessment.diagnostics?.lastSuccessfulDigestRun || null,
        evaluatedAt:assessment.diagnostics?.evaluatedAt || null,
      },
    };
  }

  const missingRunRecovered=latestState==='watch'
    && latestReason==='missing_run'
    && assessment.reason!=='missing_run'
    && assessment.diagnostics?.todayRunObserved===true;

  if ((assessment.state==='healthy' && latestState==='watch') || missingRunRecovered) {
    return {
      action:'record',
      severity:'info',
      source:'digest_slo',
      eventType:'reliability_slo',
      code:'DAILY_DIGEST_SLO_RECOVERED',
      message:missingRunRecovered
        ? 'Daily Digest missing-run condition recovered after an operational run was observed.'
        : 'Daily Digest reliability SLO recovered to within configured watch thresholds.',
      endpoint:'cron:production-monitor',
      meta:{
        date,
        state:'healthy',
        reason:missingRunRecovered ? 'missing_run_recovered' : 'within_thresholds',
        recoveredFrom:latest.code,
        watchStartedAt:latest.at,
        sampleDays:Number(assessment.reliability?.sampleDays || 0),
        claimed:Number(assessment.reliability?.totals?.claimed || 0),
        completionRate:assessment.reliability?.completionRate ?? null,
        window:assessment.diagnostics?.window || null,
        expectedState:String(assessment.diagnostics?.expectedState || ''),
        lastSuccessfulDigestRun:assessment.diagnostics?.lastSuccessfulDigestRun || null,
        evaluatedAt:assessment.diagnostics?.evaluatedAt || null,
      },
    };
  }

  return {action:'none',reason:assessment.state==='collecting'?'collecting':'healthy_without_transition'};
}
