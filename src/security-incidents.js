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

function eventTime(item = {}) {
  const ms=Date.parse(String(item?.created_at || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function metadata(item = {}) {
  return item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
}

export function isSecuritySignal(item = {}) {
  const source=String(item?.source || '');
  const code=String(item?.code || '');
  if (source === 'security') return true;
  if (SECURITY_CODES.has(code)) return true;
  if (source === 'telegram' && /WEBHOOK_(?:AUTH|SECRET|DEDUPE).*FAILED|TELEGRAM_WEBHOOK_(?:REJECTED|INVALID)/i.test(code)) return true;
  if (source === 'billing' && ['warning','error','critical'].includes(String(item?.severity || ''))) return true;
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
    total:recent.length,
    invalidAuthBursts:0,
    adminInvalidAuthBursts:0,
    crossSiteBlocks:0,
    oversizedBlocks:0,
    methodBlocks:0,
    webhookAnomalies:0,
    billingAnomalies:0,
  };
  const codes={};

  for (const item of recent) {
    const code=String(item?.code || 'UNKNOWN');
    codes[code]=(codes[code] || 0)+1;
    if (code === 'INVALID_AUTH_BURST_BLOCKED') {
      counts.invalidAuthBursts+=1;
      if (String(metadata(item)?.scope || '') === 'admin') counts.adminInvalidAuthBursts+=1;
    }
    if (['CROSS_ORIGIN_MUTATION_BLOCKED','CROSS_SITE_MUTATION_BLOCKED'].includes(code)) counts.crossSiteBlocks+=1;
    if (['REQUEST_TOO_LARGE','TELEGRAM_INIT_DATA_TOO_LARGE'].includes(code)) counts.oversizedBlocks+=1;
    if (['API_METHOD_NOT_ALLOWED','UNSUPPORTED_MEDIA_TYPE','WEBHOOK_METHOD_NOT_ALLOWED'].includes(code)) counts.methodBlocks+=1;
    if (String(item?.source || '') === 'telegram' && /WEBHOOK/i.test(code)) counts.webhookAnomalies+=1;
    if (String(item?.source || '') === 'billing') counts.billingAnomalies+=1;
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
    ? (counts.adminInvalidAuthBursts || counts.billingAnomalies>=2 ? 'critical' : 'incident')
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
    signalCount:recent.length,
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

export function securityIncidentTimeline(assessment = {}, historyItems = [], { nowMs=Date.now() } = {}) {
  const latest=latestLifecycle(historyItems);
  const latestCode=String(latest?.code || '');
  const active=latestCode==='SECURITY_INCIDENT_OPENED';
  const existingIncidentId=active ? incidentIdFromEvent(latest) : '';
  const openingId='security-' + new Date(Number(nowMs)).toISOString().replace(/[-:]/g,'').slice(0,13);

  if (assessment.state==='incident') {
    const incidentId=existingIncidentId || openingId;
    const incident={
      incidentId,
      active:true,
      state:'incident',
      highestState:'incident',
      severity:'incident',
      startedAt:active ? (metadata(latest)?.startedAt || latest?.created_at || assessment.startedAt) : assessment.startedAt,
      durationMinutes:Math.max(0,Math.round((Number(nowMs)-Date.parse(active ? (metadata(latest)?.startedAt || latest?.created_at || assessment.startedAt || '') : (assessment.startedAt || '')))/60_000)),
      fingerprint:'security|' + String(assessment.primaryCode || 'mixed'),
      diagnostics:{
        reason:'Подтверждён всплеск security-сигналов.',
        primaryCode:assessment.primaryCode || '',
        signalCount:Number(assessment.signalCount || 0),
        counts:assessment.counts || {},
        riskLevel:assessment.severity || 'incident',
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
    const incident={
      incidentId:existingIncidentId,
      active:true,
      state:'incident',
      highestState:'incident',
      severity:'incident',
      startedAt:metadata(latest)?.startedAt || latest?.created_at || null,
      durationMinutes:Math.max(0,Math.round((Number(nowMs)-Date.parse(metadata(latest)?.startedAt || latest?.created_at || ''))/60_000)),
      fingerprint:'security|' + String(assessment.primaryCode || 'mixed'),
      diagnostics:{
        reason:'Security incident остаётся открытым до чистого окна без подозрительных сигналов.',
        primaryCode:assessment.primaryCode || '',
        signalCount:Number(assessment.signalCount || 0),
        counts:assessment.counts || {},
        riskLevel:assessment.severity || 'warning',
        windowMinutes:Number(assessment.windowMinutes || SECURITY_WINDOW_MINUTES),
      },
    };
    return {state:'watch',activeIncident:incident,history:[],transition:null};
  }

  if (active) {
    const incident={
      incidentId:existingIncidentId,
      active:false,
      state:'recovered',
      highestState:'incident',
      severity:'incident',
      startedAt:metadata(latest)?.startedAt || latest?.created_at || null,
      recoveredAt:new Date(Number(nowMs)).toISOString(),
      durationMinutes:Math.max(0,Math.round((Number(nowMs)-Date.parse(metadata(latest)?.startedAt || latest?.created_at || ''))/60_000)),
      fingerprint:'security|recovered',
      diagnostics:{reason:'Security-сигналы вернулись ниже incident-порога.'},
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
      severity:incident.severity==='critical' ? 'critical' : 'warning',
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
