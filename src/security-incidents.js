const SECURITY_WINDOW_MINUTES = 15;
const MAX_SECURITY_WINDOW_MINUTES = 24 * 60;
const MAX_EVENT_OCCURRENCES = 1_000_000;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;
const MAX_TIMESTAMP_MS = 8.64e15;

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

const SECURITY_INCIDENT_SEVERITY_RANK = Object.freeze({
  warning:1,
  error:2,
  critical:3,
});

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function boundedWindowMinutes(value) {
  const minutes=integerCandidate(value);
  return minutes !== null && minutes >= 1 && minutes <= MAX_SECURITY_WINDOW_MINUTES
    ? minutes
    : SECURITY_WINDOW_MINUTES;
}

function clockValue(value=Date.now()) {
  const number=typeof value === 'number' && Number.isFinite(value) ? value : null;
  return number !== null && number >= 0 && number <= MAX_TIMESTAMP_MS
    ? number
    : Date.now();
}

function cleanText(value,fallback='',maxLength=240) {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,maxLength);
}

function cleanCode(value,fallback='UNKNOWN') {
  const code=cleanText(value,'',100).toUpperCase();
  return /^[A-Z0-9][A-Z0-9_.:-]{0,99}$/.test(code) ? code : fallback;
}

function cleanSource(value) {
  const source=cleanText(value,'',60).toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,59}$/.test(source) ? source : '';
}

function metadata(item = {}) {
  const source=plainObject(item);
  return plainObject(source?.metadata) || {};
}

function compactCategory(value = '') {
  const raw=cleanText(value,'',80).toLowerCase();
  return raw ? raw.replace(/[\s-]+/g, '_') : '';
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms=Date.parse(value.trim());
  return Number.isFinite(ms) && ms >= 0 && ms <= MAX_TIMESTAMP_MS ? ms : null;
}

function eventTime(item = {}) {
  const source=plainObject(item);
  if (!source) return null;
  const meta=metadata(source);
  for (const candidate of [
    source.last_occurred_at,
    meta.lastOccurredAt,
    meta.last_occurred_at,
    source.created_at,
  ]) {
    const timestamp=parseTimestamp(candidate);
    if (timestamp !== null) return timestamp;
  }
  return null;
}

function eventOccurrences(item = {}) {
  const source=plainObject(item);
  if (!source) return 1;
  const meta=metadata(source);
  const raw=source.occurrence_count
    ?? source.occurrenceCount
    ?? meta.occurrenceCount
    ?? meta.occurrence_count
    ?? 1;
  const value=integerCandidate(raw);
  if (value === null || value < 1) return 1;
  return Math.min(MAX_EVENT_OCCURRENCES,value);
}

function safeAdd(current,increment) {
  if (!Number.isSafeInteger(current) || current < 0) return 0;
  if (!Number.isSafeInteger(increment) || increment < 0) return current;
  return Math.min(MAX_COUNTER,current+increment);
}

function explicitBillingSecuritySignal(item = {}) {
  const source=plainObject(item);
  if (!source) return false;
  const code=cleanCode(source.code,'');
  if (BILLING_SECURITY_CODES.has(code)) return true;
  if (/^BILLING_(?:SECURITY|ABUSE|FRAUD)_/.test(code)) return true;
  if (/^BILLING_.*_REPLAY_(?:BLOCKED|DETECTED)$/.test(code)) return true;
  const meta=metadata(source);
  const category=compactCategory(
    meta.securityCategory ?? meta.security_category ?? meta.category ?? '',
  );
  return BILLING_SECURITY_CATEGORIES.has(category);
}

export function isSecuritySignal(item = {}) {
  const sourceItem=plainObject(item);
  if (!sourceItem) return false;
  const source=cleanSource(sourceItem.source);
  const code=cleanCode(sourceItem.code,'');
  if (source === 'security') return true;
  if (SECURITY_CODES.has(code)) return true;
  if (
    source === 'telegram'
    && /WEBHOOK_(?:AUTH|SECRET|DEDUPE).*FAILED|TELEGRAM_WEBHOOK_(?:REJECTED|INVALID)/i.test(code)
  ) return true;
  if (source === 'billing' && explicitBillingSecuritySignal(sourceItem)) return true;
  return false;
}

export function assessSecuritySignals(items = [], {
  nowMs=Date.now(),
  windowMinutes=SECURITY_WINDOW_MINUTES,
} = {}) {
  const current=clockValue(nowMs);
  const safeWindowMinutes=boundedWindowMinutes(windowMinutes);
  const windowMs=safeWindowMinutes*60_000;
  const startMs=Math.max(0,current-windowMs);
  const recent=(Array.isArray(items) ? items : []).filter(item => {
    const t=eventTime(item);
    return t !== null && t>=startMs && t<=current && isSecuritySignal(item);
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
    const code=cleanCode(item?.code);
    const source=cleanSource(item?.source);
    const severity=cleanText(item?.severity,'',20).toLowerCase();
    counts.total=safeAdd(counts.total,occurrences);
    codes[code]=safeAdd(Object.hasOwn(codes,code) ? codes[code] : 0,occurrences);
    if (severity === 'critical') counts.criticalSignals=safeAdd(counts.criticalSignals,occurrences);
    if (code === 'INVALID_AUTH_BURST_BLOCKED') {
      counts.invalidAuthBursts=safeAdd(counts.invalidAuthBursts,occurrences);
      if (cleanText(metadata(item).scope,'',20).toLowerCase() === 'admin') {
        counts.adminInvalidAuthBursts=safeAdd(counts.adminInvalidAuthBursts,occurrences);
      }
    }
    if (['CROSS_ORIGIN_MUTATION_BLOCKED','CROSS_SITE_MUTATION_BLOCKED'].includes(code)) {
      counts.crossSiteBlocks=safeAdd(counts.crossSiteBlocks,occurrences);
    }
    if (['REQUEST_TOO_LARGE','TELEGRAM_INIT_DATA_TOO_LARGE'].includes(code)) {
      counts.oversizedBlocks=safeAdd(counts.oversizedBlocks,occurrences);
    }
    if (['API_METHOD_NOT_ALLOWED','UNSUPPORTED_MEDIA_TYPE','WEBHOOK_METHOD_NOT_ALLOWED'].includes(code)) {
      counts.methodBlocks=safeAdd(counts.methodBlocks,occurrences);
    }
    if (source === 'telegram' && /WEBHOOK/i.test(code)) {
      counts.webhookAnomalies=safeAdd(counts.webhookAnomalies,occurrences);
    }
    if (source === 'billing') {
      counts.billingAnomalies=safeAdd(counts.billingAnomalies,occurrences);
    }
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
    ? (counts.criticalSignals>0 || counts.adminInvalidAuthBursts>0 || counts.billingAnomalies>=2 ? 'critical' : 'error')
    : watch ? 'warning' : 'info';

  const primary=Object.entries(codes)
    .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
  const times=recent.map(eventTime).filter(value=>value !== null);
  return {
    state,
    severity,
    windowMinutes:safeWindowMinutes,
    startedAt:times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastSignalAt:times.length ? new Date(Math.max(...times)).toISOString() : null,
    counts,
    codes,
    primaryCode:primary,
    recordCount:recent.length,
    signalCount:counts.total,
  };
}

function latestLifecycle(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(item => {
      const source=plainObject(item);
      return source
        && cleanSource(source.source) === 'security_monitor'
        && cleanText(source.event_type,'',80).toLowerCase() === 'security_incident'
        && ['SECURITY_INCIDENT_OPENED','SECURITY_INCIDENT_RECOVERED'].includes(cleanCode(source.code,''));
    })
    .map((item,index)=>({item,time:eventTime(item),index}))
    .filter(entry=>entry.time !== null)
    .sort((a,b)=>b.time-a.time || b.index-a.index)[0]?.item || null;
}

function incidentIdFromEvent(item = {}) {
  const id=cleanText(metadata(item).incidentId,'',120);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) ? id : '';
}

function normalizeSecurityIncidentSeverity(value, fallback='error') {
  const severity=cleanText(value,'',20).toLowerCase();
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
  return normalizeSecurityIncidentSeverity(metadata(item).severity, 'error');
}

function normalizedAssessment(value) {
  const source=plainObject(value) || {};
  const state=['incident','watch','healthy'].includes(source.state) ? source.state : 'healthy';
  const severity=normalizeSecurityIncidentSeverity(
    source.severity,
    state === 'watch' ? 'warning' : state === 'healthy' ? 'warning' : 'error',
  );
  const counts=plainObject(source.counts) || {};
  return {
    state,
    severity,
    startedAt:parseTimestamp(source.startedAt) !== null
      ? new Date(parseTimestamp(source.startedAt)).toISOString()
      : null,
    primaryCode:cleanCode(source.primaryCode,''),
    signalCount:nonNegativeCount(source.signalCount),
    recordCount:nonNegativeCount(source.recordCount),
    counts,
    windowMinutes:boundedWindowMinutes(source.windowMinutes),
  };
}

function nonNegativeCount(value) {
  const count=integerCandidate(value);
  return count !== null && count >= 0 ? Math.min(MAX_COUNTER,count) : 0;
}

function durationMinutes(nowMs,startedAt) {
  const started=parseTimestamp(startedAt);
  if (started === null || started > nowMs) return 0;
  return Math.max(0,Math.round((nowMs-started)/60_000));
}

function persistedStartedAt(item,assessmentStartedAt) {
  const meta=metadata(item);
  for (const value of [meta.startedAt,item?.created_at,assessmentStartedAt]) {
    const timestamp=parseTimestamp(value);
    if (timestamp !== null) return new Date(timestamp).toISOString();
  }
  return null;
}

export function securityIncidentTimeline(assessment = {}, historyItems = [], { nowMs=Date.now() } = {}) {
  const current=clockValue(nowMs);
  const normalized=normalizedAssessment(assessment);
  const latest=latestLifecycle(historyItems);
  const latestCode=cleanCode(latest?.code,'');
  const active=latestCode === 'SECURITY_INCIDENT_OPENED';
  const existingIncidentId=active ? incidentIdFromEvent(latest) : '';
  const openingId='security-' + new Date(current).toISOString().replace(/[-:]/g,'').slice(0,13);

  if (normalized.state === 'incident') {
    const incidentId=existingIncidentId || openingId;
    const assessmentSeverity=normalizeSecurityIncidentSeverity(normalized.severity,'error');
    const priorSeverity=active ? persistedIncidentSeverity(latest) : assessmentSeverity;
    const severity=active ? maxSecurityIncidentSeverity(assessmentSeverity,priorSeverity) : assessmentSeverity;
    const startedAt=active
      ? persistedStartedAt(latest,normalized.startedAt)
      : normalized.startedAt;
    const incident={
      incidentId,
      active:true,
      state:'incident',
      highestState:'incident',
      severity,
      startedAt,
      durationMinutes:durationMinutes(current,startedAt),
      fingerprint:'security|' + (normalized.primaryCode || 'mixed'),
      diagnostics:{
        reason:'Подтверждён всплеск security-сигналов.',
        primaryCode:normalized.primaryCode,
        signalCount:normalized.signalCount,
        recordCount:normalized.recordCount,
        counts:normalized.counts,
        riskLevel:severity,
        windowMinutes:normalized.windowMinutes,
      },
    };
    return {
      state:'incident',
      activeIncident:incident,
      history:[],
      transition:active ? null : {kind:'opened',incident},
    };
  }

  if (active && normalized.state === 'watch') {
    const severity=persistedIncidentSeverity(latest);
    const startedAt=persistedStartedAt(latest,normalized.startedAt);
    const incident={
      incidentId:existingIncidentId || openingId,
      active:true,
      state:'incident',
      highestState:'incident',
      severity,
      startedAt,
      durationMinutes:durationMinutes(current,startedAt),
      fingerprint:'security|' + (normalized.primaryCode || 'mixed'),
      diagnostics:{
        reason:'Security incident остаётся открытым до чистого окна без подозрительных сигналов.',
        primaryCode:normalized.primaryCode,
        signalCount:normalized.signalCount,
        recordCount:normalized.recordCount,
        counts:normalized.counts,
        riskLevel:severity,
        windowMinutes:normalized.windowMinutes,
      },
    };
    return {state:'watch',activeIncident:incident,history:[],transition:null};
  }

  if (active) {
    const severity=persistedIncidentSeverity(latest);
    const startedAt=persistedStartedAt(latest,normalized.startedAt);
    const incident={
      incidentId:existingIncidentId || openingId,
      active:false,
      state:'recovered',
      highestState:'incident',
      severity,
      startedAt,
      recoveredAt:new Date(current).toISOString(),
      durationMinutes:durationMinutes(current,startedAt),
      fingerprint:'security|recovered',
      diagnostics:{reason:'Security-сигналы вернулись ниже incident-порога.',riskLevel:severity},
    };
    return {
      state:normalized.state,
      activeIncident:null,
      history:[incident],
      transition:{kind:'recovered',incident},
    };
  }

  return {
    state:normalized.state,
    activeIncident:null,
    history:[],
    transition:null,
  };
}

export function securityIncidentOpsEvent(transition = {}) {
  const source=plainObject(transition);
  const incident=plainObject(source?.incident);
  const incidentId=incidentIdFromEvent({metadata:{incidentId:incident?.incidentId}});
  if (!incident || !incidentId) return null;
  if (source.kind === 'opened') {
    const severity=normalizeSecurityIncidentSeverity(incident.severity,'error');
    return {
      severity,
      source:'security_monitor',
      eventType:'security_incident',
      code:'SECURITY_INCIDENT_OPENED',
      message:'Security monitoring detected a sustained suspicious traffic spike.',
      endpoint:'cron:production-monitor',
      transitionKey:'security-incident-open:' + incidentId,
      meta:{
        incidentId,
        severity,
        startedAt:parseTimestamp(incident.startedAt) !== null
          ? new Date(parseTimestamp(incident.startedAt)).toISOString()
          : null,
        diagnostics:plainObject(incident.diagnostics) || {},
      },
    };
  }
  if (source.kind === 'recovered') {
    return {
      severity:'info',
      source:'security_monitor',
      eventType:'security_incident',
      code:'SECURITY_INCIDENT_RECOVERED',
      message:'Security monitoring returned below the incident threshold.',
      endpoint:'cron:production-monitor',
      transitionKey:'security-incident-recovered:' + incidentId,
      meta:{
        incidentId,
        severity:normalizeSecurityIncidentSeverity(incident.severity,'error'),
        recoveredAt:parseTimestamp(incident.recoveredAt) !== null
          ? new Date(parseTimestamp(incident.recoveredAt)).toISOString()
          : null,
      },
    };
  }
  return null;
}

function alertCount(value) {
  return String(nonNegativeCount(value));
}

export function formatSecurityIncidentAlert(plan = {}) {
  const source=plainObject(plan) || {};
  const incident=plainObject(source.incident) || {};
  const diagnostics=plainObject(incident.diagnostics) || {};
  const incidentId=incidentIdFromEvent({metadata:{incidentId:incident.incidentId}}) || '—';

  if (source.kind === 'recovery') {
    const recoveredAt=parseTimestamp(incident.recoveredAt) !== null
      ? new Date(parseTimestamp(incident.recoveredAt)).toISOString()
      : '—';
    return [
      '✅ MatchRadar security recovered',
      '',
      'Incident ID: ' + incidentId,
      'Состояние: ниже incident-порога',
      'Восстановление: ' + recoveredAt,
    ].join('\n');
  }

  const counts=plainObject(diagnostics.counts) || {};
  const severity=normalizeSecurityIncidentSeverity(incident.severity,'error');
  return [
    severity === 'critical' ? '🚨 MatchRadar SECURITY incident' : '⚠️ MatchRadar security incident',
    '',
    'Incident ID: ' + incidentId,
    'Причина: ' + cleanText(diagnostics.reason,'Подозрительный всплеск запросов.',240),
    'Главный сигнал: ' + cleanCode(diagnostics.primaryCode,'mixed'),
    'Security-сигналов: ' + alertCount(diagnostics.signalCount),
    'Invalid auth bursts: ' + alertCount(counts.invalidAuthBursts),
    'Cross-site blocks: ' + alertCount(counts.crossSiteBlocks),
    'Oversized blocks: ' + alertCount(counts.oversizedBlocks),
    'Webhook anomalies: ' + alertCount(counts.webhookAnomalies),
    'Billing anomalies: ' + alertCount(counts.billingAnomalies),
    'Окно: ' + boundedWindowMinutes(diagnostics.windowMinutes) + ' мин',
  ].join('\n');
}
