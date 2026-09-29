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
    at: iso(row.created_at || row.createdAt),
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
