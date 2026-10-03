const SECURITY_WINDOW_MINUTES = 15;

const SECURITY_CODES = new Set([
  'INVALID_AUTH_BURST_BLOCKED',
  'CROSS_ORIGIN_MUTATION_BLOCKED',
  'CROSS_SITE_MUTATION_BLOCKED',
  'REQUEST_TOO_LARGE',
  'TELEGRAM_INIT_DATA_TOO_LARGE',
  'API_METHOD_NOT_ALLOWED',
  'UNSUPPORTED_MEDIA_TYPE',
  'WEBHOOK_METHOD_NOT_ALLOWED',
]);

const BILLING_SECURITY_CODES = new Set([
  'BILLING_REFUNDED_CHARGE_REPLAY_BLOCKED',
]);

const BILLING_SECURITY_CATEGORIES = new Set([
  'security',
  'abuse',
  'fraud',
  'replay',
  'replay_attack',
]);

function metadata(item = {}) {
  return item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
}

function compactCategory(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function eventTime(item = {}) {
  const meta=metadata(item);
  const candidate=item?.last_occurred_at || meta?.lastOccurredAt || meta?.last_occurred_at || item?.created_at || '';
  const ms=Date.parse(String(candidate));
  return Number.isFinite(ms) ? ms : 0;
}

function eventOccurrences(item = {}) {
  const meta=metadata(item);
  const value=Number(
    item?.occurrence_count
      ?? item?.occurrenceCount
      ?? meta?.occurrenceCount
      ?? meta?.occurrence_count
      ?? 1
  );
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.max(1,Math.min(1_000_000,Math.floor(value)));
}

function explicitBillingSecuritySignal(item = {}) {
  const code=String(item?.code || '').trim().toUpperCase();
  if (BILLING_SECURITY_CODES.has(code)) return true;
  if (/^BILLING_(?:SECURITY|ABUSE|FRAUD)_/.test(code)) return true;
  if (/^BILLING_.*_REPLAY_(?:BLOCKED|DETECTED)$/.test(code)) return true;
  const meta=metadata(item);
  const category=compactCategory(meta?.securityCategory || meta?.security_category || meta?.category || '');
  return BILLING_SECURITY_CATEGORIES.has(category);
}

export function isSecuritySignal(item = {}) {
  const source=String(item?.source || '');
  const code=String(item?.code || '');
  if (source === 'security') return true;
  if (SECURITY_CODES.has(code)) return true;
  if (source === 'telegram' && /WEBHOOK_(?:AUTH|SECRET|DEDUPE).*FAILED|TELEGRAM_WEBHOOK_(?:REJECTED|INVALID)/i.test(code)) return true;
  if (source === 'billing' && explicitBillingSecuritySignal(item)) return true;
  return false;
}

export function assessSecuritySignals(items = [], {
  nowMs=Date.now(),
  windowMinutes=SECURITY_WINDOW_MINUTES,
} = {}) {
  const windowMs=Math.max(1,Number(windowMinutes || SECURITY_WINDOW_MINUTES))*60_000;
  const startMs=Number(nowMs)-windowMs;
  const recent=(items || []).filter(item => {
    const t=eventTime(item);
    return t>=startMs && t<=Number(nowMs) && isSecuritySignal(item);
  });

  const counts={
    total:0,
    invalidAuthBursts:0,
    adminInvalidAuthBursts:0,
    crossSiteBlocks:0,
    oversizedBlocks:0,
    methodBlocks:0,
    webhookAnomalies:0,
    billingAnomalies:0,
    criticalSignals:0,
  };
  const codes={};

  for (const item of recent) {
    const occurrences=eventOccurrences(item);
    const code=String(item?.code || 'UNKNOWN');
    counts.total+=occurrences;
    codes[code]=(codes[code] || 0)+occurrences;
    if (String(item?.severity || '') === 'critical') counts.criticalSignals+=occurrences;
    if (code === 'INVALID_AUTH_BURST_BLOCKED') {
      counts.invalidAuthBursts+=occurrences;
      if (String(metadata(item)?.scope || '') === 'admin') counts.adminInvalidAuthBursts+=occurrences;
    }
    if (['CROSS_ORIGIN_MUTATION_BLOCKED','CROSS_SITE_MUTATION_BLOCKED'].includes(code)) counts.crossSiteBlocks+=occurrences;
    if (['REQUEST_TOO_LARGE','TELEGRAM_INIT_DATA_TOO_LARGE'].includes(code)) counts.oversizedBlocks+=occurrences;
    if (['API_METHOD_NOT_ALLOWED','UNSUPPORTED_MEDIA_TYPE','WEBHOOK_METHOD_NOT_ALLOWED'].includes(code)) counts.methodBlocks+=occurrences;
    if (String(item?.source || '') === 'telegram' && /WEBHOOK/i.test(code)) counts.webhookAnomalies+=occurrences;
    if (String(item?.source || '') === 'billing') counts.billingAnomalies+=occurrences;
  }

  const incident = counts.adminInvalidAuthBursts>=1
    || counts.invalidAuthBursts>=2
    || counts.crossSiteBlocks>=3
    || counts.oversizedBlocks>=3
    || counts.webhookAnomalies>=2
    || counts.billingAnomalies>=2
    || counts.total>=6;
  const watch = !incident && counts.total>0;
  const state=incident ? 'incident' : watch ? 'watch' : 'healthy';
  const severity=incident
    ? (counts.criticalSignals>0 || counts.adminInvalidAuthBursts || counts.billingAnomalies>=2 ? 'critical' : 'error')
    : watch ? 'warning' : 'info';

  const primary=Object.entries(codes).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
  return {
    state,
    severity,
    windowMinutes:Number(windowMinutes || SECURITY_WINDOW_MINUTES),
    startedAt:recent.length ? new Date(Math.min(...recent.map(eventTime))).toISOString() : null,
    lastSignalAt:recent.length ? new Date(Math.max(...recent.map(eventTime))).toISOString() : null,
    counts,
    codes,
    primaryCode:primary,
    recordCount:recent.length,
    signalCount:counts.total,
  };
}

function latestLifecycle(items = []) {
  return (items || [])
    .filter(item => String(item?.source || '') === 'security_monitor'
      && String(item?.event_type || '') === 'security_incident'
      && ['SECURITY_INCIDENT_OPENED','SECURITY_INCIDENT_RECOVERED'].includes(String(item?.code || '')))
    .sort((a,b)=>eventTime(b)-eventTime(a))[0] || null;
}

function incidentIdFromEvent(item = {}) {
  return String(metadata(item)?.incidentId || '').slice(0,120);
}

const SECURITY_INCIDENT_SEVERITY_RANK = Object.freeze({
  warning:1,
  error:2,
  critical:3,
});

function normalizeSecurityIncidentSeverity(value, fallback='error') {
  const severity=String(value || '').trim().toLowerCase();
  if (severity === 'warning' || severity === 'error' || severity === 'critical') return severity;
  if (severity === 'incident') return 'error';
  return fallback;
}

function maxSecurityIncidentSeverity(current, previous) {
  const a=normalizeSecurityIncidentSeverity(current);
  const b=normalizeSecurityIncidentSeverity(previous);
  return SECURITY_INCIDENT_SEVERITY_RANK[a] >= SECURITY_INCIDENT_SEVERITY_RANK[b] ? a : b;
}

function persistedIncidentSeverity(item = {}) {
  return normalizeSecurityIncidentSeverity(metadata(item)?.severity, 'error');
}

export function securityIncidentTimeline(assessment = {}, historyItems = [], { nowMs=Date.now() } = {}) {
  const latest=latestLifecycle(historyItems);
  const latestCode=String(latest?.code || '');
  const active=latestCode==='SECURITY_INCIDENT_OPENED';
  const existingIncidentId=active ? incidentIdFromEvent(latest) : '';
  const openingId='security-' + new Date(Number(nowMs)).toISOString().replace(/[-:]/g,'').slice(0,13);

  if (assessment.state==='incident') {
    const incidentId=existingIncidentId || openingId;
    const assessmentSeverity=normalizeSecurityIncidentSeverity(assessment.severity, 'error');
    const priorSeverity=active ? persistedIncidentSeverity(latest) : assessmentSeverity;
    const severity=active ? maxSecurityIncidentSeverity(assessmentSeverity, priorSeverity) : assessmentSeverity;
    const incident={
      incidentId,
      active:true,
      state:'incident',
      highestState:'incident',
      severity,
      startedAt:active ? (metadata(latest)?.startedAt || latest?.created_at || assessment.startedAt) : assessment.startedAt,
      durationMinutes:Math.max(0,Math.round((Number(nowMs)-Date.parse(active ? (metadata(latest)?.startedAt || latest?.created_at || assessment.startedAt || '') : (assessment.startedAt || '')))/60_000)),
      fingerprint:'security|' + String(assessment.primaryCode || 'mixed'),
      diagnostics:{
        reason:'Подтверждён всплеск security-сигналов.',
        primaryCode:assessment.primaryCode || '',
        signalCount:Number(assessment.signalCount || 0),
        recordCount:Number(assessment.recordCount || 0),
        counts:assessment.counts || {},
        riskLevel:severity,
        windowMinutes:Number(assessment.windowMinutes || SECURITY_WINDOW_MINUTES),
      },
    };
    return {
      state:'incident',
      activeIncident:incident,
      history:[],
      transition:active ? null : {kind:'opened',incident},
    };
  }

  if (active && assessment.state==='watch') {
    const severity=persistedIncidentSeverity(latest);
    const incident={
      incidentId:existingIncidentId,
      active:true,
      state:'incident',
      highestState:'incident',
      severity,
      startedAt:metadata(latest)?.startedAt || latest?.created_at || null,
      durationMinutes:Math.max(0,Math.round((Number(nowMs)-Date.parse(metadata(latest)?.startedAt || latest?.created_at || ''))/60_000)),
      fingerprint:'security|' + String(assessment.primaryCode || 'mixed'),
      diagnostics:{
        reason:'Security incident остаётся открытым до чистого окна без подозрительных сигналов.',
        primaryCode:assessment.primaryCode || '',
        signalCount:Number(assessment.signalCount || 0),
        recordCount:Number(assessment.recordCount || 0),
        counts:assessment.counts || {},
        riskLevel:severity,
        windowMinutes:Number(assessment.windowMinutes || SECURITY_WINDOW_MINUTES),
      },
    };
    return {state:'watch',activeIncident:incident,history:[],transition:null};
  }

  if (active) {
    const severity=persistedIncidentSeverity(latest);
    const incident={
      incidentId:existingIncidentId,
      active:false,
      state:'recovered',
      highestState:'incident',
      severity,
      startedAt:metadata(latest)?.startedAt || latest?.created_at || null,
      recoveredAt:new Date(Number(nowMs)).toISOString(),
      durationMinutes:Math.max(0,Math.round((Number(nowMs)-Date.parse(metadata(latest)?.startedAt || latest?.created_at || ''))/60_000)),
      fingerprint:'security|recovered',
      diagnostics:{reason:'Security-сигналы вернулись ниже incident-порога.',riskLevel:severity},
    };
    return {
      state:assessment.state || 'healthy',
      activeIncident:null,
      history:[incident],
      transition:{kind:'recovered',incident},
    };
  }

  return {
    state:assessment.state || 'healthy',
    activeIncident:null,
    history:[],
    transition:null,
  };
}

export function securityIncidentOpsEvent(transition = {}) {
  const incident=transition?.incident;
  if (!incident?.incidentId) return null;
  if (transition.kind==='opened') {
    return {
      severity:normalizeSecurityIncidentSeverity(incident.severity, 'error'),
      source:'security_monitor',
      eventType:'security_incident',
      code:'SECURITY_INCIDENT_OPENED',
      message:'Security monitoring detected a sustained suspicious traffic spike.',
      endpoint:'cron:production-monitor',
      transitionKey:'security-incident-open:' + incident.incidentId,
      meta:{
        incidentId:incident.incidentId,
        severity:incident.severity,
        startedAt:incident.startedAt,
        diagnostics:incident.diagnostics || {},
      },
    };
  }
  if (transition.kind==='recovered') {
    return {
      severity:'info',
      source:'security_monitor',
      eventType:'security_incident',
      code:'SECURITY_INCIDENT_RECOVERED',
      message:'Security monitoring returned below the incident threshold.',
      endpoint:'cron:production-monitor',
      transitionKey:'security-incident-recovered:' + incident.incidentId,
      meta:{
        incidentId:incident.incidentId,
        severity:incident.severity,
        recoveredAt:incident.recoveredAt,
      },
    };
  }
  return null;
}

export function formatSecurityIncidentAlert(plan = {}) {
  const incident=plan?.incident || {};
  const diagnostics=incident?.diagnostics || {};
  if (plan.kind==='recovery') {
    return [
      '✅ MatchRadar security recovered',
      '',
      'Incident ID: ' + String(incident.incidentId || '—'),
      'Состояние: ниже incident-порога',
      'Восстановление: ' + String(incident.recoveredAt || '—'),
    ].join('\n');
  }
  const counts=diagnostics.counts || {};
  return [
    incident.severity==='critical' ? '🚨 MatchRadar SECURITY incident' : '⚠️ MatchRadar security incident',
    '',
    'Incident ID: ' + String(incident.incidentId || '—'),
    'Причина: ' + String(diagnostics.reason || 'Подозрительный всплеск запросов.'),
    'Главный сигнал: ' + String(diagnostics.primaryCode || 'mixed'),
    'Security-сигналов: ' + String(Number(diagnostics.signalCount || 0)),
    'Invalid auth bursts: ' + String(Number(counts.invalidAuthBursts || 0)),
    'Cross-site blocks: ' + String(Number(counts.crossSiteBlocks || 0)),
    'Oversized blocks: ' + String(Number(counts.oversizedBlocks || 0)),
    'Webhook anomalies: ' + String(Number(counts.webhookAnomalies || 0)),
    'Billing anomalies: ' + String(Number(counts.billingAnomalies || 0)),
    'Окно: ' + String(Number(diagnostics.windowMinutes || SECURITY_WINDOW_MINUTES)) + ' мин',
  ].join('\n');
}
