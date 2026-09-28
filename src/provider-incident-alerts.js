export const PROVIDER_INCIDENT_ALERT_POLICY = Object.freeze({
  retryCooldownMinutes:30,
  reminderAfterMinutes:360,
  reminderLimit:2,
  maxDeferredAttempts:3,
  immediateRetryAttempts:2,
});

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asIso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function eventMeta(row = {}) {
  if (row?.metadata && typeof row.metadata === 'object') return row.metadata;
  if (row?.meta && typeof row.meta === 'object') return row.meta;
  return {};
}

function relevantEvents(rows = [], incidentId = '') {
  return (rows || [])
    .filter(row => row?.source === 'provider_alert' && String(eventMeta(row).incidentId || '') === String(incidentId || ''))
    .sort((a,b) => Date.parse(a?.created_at || 0) - Date.parse(b?.created_at || 0));
}

function deliveryState(rows = [], deliveryKey = '', adminCount = 0, nowMs = Date.now()) {
  const events = (rows || []).filter(row => String(eventMeta(row).deliveryKey || '') === deliveryKey);
  const delivered = new Set();
  const failureCount = new Map();
  let lastAt = 0;

  for (const row of events) {
    const meta = eventMeta(row);
    for (const slot of Array.isArray(meta.deliveredSlots) ? meta.deliveredSlots : []) {
      if (Number.isInteger(Number(slot))) delivered.add(Number(slot));
    }
    for (const slot of Array.isArray(meta.failedSlots) ? meta.failedSlots : []) {
      const n = Number(slot);
      if (Number.isInteger(n)) failureCount.set(n, finite(failureCount.get(n)) + 1);
    }
    const at = Date.parse(row?.created_at || '');
    if (Number.isFinite(at)) lastAt = Math.max(lastAt, at);
  }

  const pending = [];
  for (let slot = 0; slot < adminCount; slot += 1) {
    if (delivered.has(slot)) continue;
    if (finite(failureCount.get(slot)) >= PROVIDER_INCIDENT_ALERT_POLICY.maxDeferredAttempts) continue;
    pending.push(slot);
  }
  const retryCooldownMs = PROVIDER_INCIDENT_ALERT_POLICY.retryCooldownMinutes * 60_000;
  return {
    events,
    deliveredSlots:[...delivered].sort((a,b) => a-b),
    pendingSlots:pending,
    lastAt,
    cooldownActive:Boolean(events.length && lastAt && Number(nowMs) - lastAt < retryCooldownMs),
    completed:adminCount > 0 && delivered.size >= adminCount,
    exhausted:adminCount > 0 && delivered.size < adminCount && pending.length === 0,
    nextAttempt:Number(events.length || 0) + 1,
  };
}

function planForKey({ rows, incident, kind, deliveryKey, adminCount, nowMs, reminderIndex = null }) {
  const state = deliveryState(rows, deliveryKey, adminCount, nowMs);
  if (state.completed) return { action:'none', reason:'already_delivered' };
  if (state.exhausted) return { action:'none', reason:'delivery_exhausted' };
  if (state.cooldownActive) return { action:'none', reason:'delivery_cooldown' };
  if (!state.pendingSlots.length) return { action:'none', reason:'no_pending_recipients' };

  return {
    action:'send',
    kind,
    deliveryKey,
    incidentId:incident.incidentId,
    incident,
    severity:incident.severity || (kind === 'recovery' ? 'info' : 'incident'),
    targetSlots:state.pendingSlots,
    attempt:state.nextAttempt,
    reminderIndex,
  };
}

export function planProviderIncidentAlert(report = {}, priorRows = [], { nowMs = Date.now(), adminCount = 0 } = {}) {
  if (adminCount <= 0) return { action:'none', reason:'no_admin_recipients' };

  const active = report?.activeIncident || null;
  if (active?.active) {
    if (active.state !== 'incident' && active.highestState !== 'incident') {
      return { action:'none', reason:'watch_not_alertable' };
    }
    const rows = relevantEvents(priorRows, active.incidentId);
    const openKey = active.incidentId + ':incident';
    const openState = deliveryState(rows, openKey, adminCount, nowMs);
    if (!openState.completed) {
      return planForKey({ rows, incident:active, kind:'incident', deliveryKey:openKey, adminCount, nowMs });
    }

    if (active.severity === 'critical') {
      const escalationKey = active.incidentId + ':escalation:critical';
      const escalation = planForKey({
        rows,
        incident:active,
        kind:'escalation',
        deliveryKey:escalationKey,
        adminCount,
        nowMs,
      });
      if (escalation.action === 'send') return escalation;
    }

    const duration = finite(active.durationMinutes);
    for (let index = 1; index <= PROVIDER_INCIDENT_ALERT_POLICY.reminderLimit; index += 1) {
      if (duration < PROVIDER_INCIDENT_ALERT_POLICY.reminderAfterMinutes * index) break;
      const reminderKey = active.incidentId + ':reminder:' + index;
      const reminder = planForKey({
        rows,
        incident:active,
        kind:'reminder',
        deliveryKey:reminderKey,
        adminCount,
        nowMs,
        reminderIndex:index,
      });
      if (reminder.action === 'send') return reminder;
    }
    return { action:'none', reason:'incident_alert_deduplicated' };
  }

  const recovered = Array.isArray(report?.history)
    ? report.history.find(item => !item?.active && item?.highestState === 'incident' && item?.incidentId)
    : null;
  if (!recovered) return { action:'none', reason:'no_incident' };

  const rows = relevantEvents(priorRows, recovered.incidentId);
  const hadIncidentAttempt = rows.some(row => ['incident','escalation','reminder'].includes(String(eventMeta(row).alertKind || '')));
  if (!hadIncidentAttempt) return { action:'none', reason:'recovery_without_prior_incident_alert' };

  const recoveryKey = recovered.incidentId + ':recovery';
  return planForKey({
    rows,
    incident:recovered,
    kind:'recovery',
    deliveryKey:recoveryKey,
    adminCount,
    nowMs,
  });
}

function formatPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) + '%' : '—';
}

function formatLatency(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) + ' ms' : '—';
}

function providerLabel(incident = {}) {
  return incident.diagnostics?.primaryProvider || 'all';
}

function operationLabel(incident = {}) {
  return incident.diagnostics?.primaryOperation || 'all';
}

export function formatProviderIncidentAlert(plan = {}) {
  const incident = plan.incident || {};
  const diagnostics = incident.diagnostics || {};
  if (plan.kind === 'recovery') {
    return [
      '✅ Provider recovered',
      '',
      'Provider: ' + providerLabel(incident),
      'Incident ID: ' + String(incident.incidentId || '—'),
      'Длительность: ' + (Number.isFinite(Number(incident.durationMinutes)) ? Number(incident.durationMinutes).toFixed(1) + ' мин' : '—'),
      'Время восстановления: ' + (asIso(incident.recoveredAt) || '—'),
      'Итоговое состояние: healthy',
    ].join('\n');
  }

  const header = plan.kind === 'escalation'
    ? '🚨 Provider incident · severity changed'
    : plan.kind === 'reminder'
      ? '⏱ Provider incident · reminder'
      : '🚨 Provider incident';
  const lines = [
    header,
    '',
    'Provider: ' + providerLabel(incident),
    'Состояние: incident',
    'Severity: ' + String(incident.severity || 'incident'),
    'Причина: ' + String(diagnostics.reason || 'Provider SLO нарушен.'),
    'Error rate: ' + formatPct(diagnostics.errorRatePct),
    'Latency: ' + formatLatency(diagnostics.avgAttemptLatencyMs),
    'Sample size: ' + String(finite(diagnostics.sampleSize)),
    'Начало: ' + (asIso(incident.startedAt) || '—'),
    'Incident ID: ' + String(incident.incidentId || '—'),
  ];
  if (operationLabel(incident) !== 'all') lines.push('Affected operation: ' + operationLabel(incident));
  if (diagnostics.timeoutRatePct !== null && diagnostics.timeoutRatePct !== undefined) lines.push('Timeout rate: ' + formatPct(diagnostics.timeoutRatePct));
  if (diagnostics.rateLimitRatePct !== null && diagnostics.rateLimitRatePct !== undefined) lines.push('Rate-limit rate: ' + formatPct(diagnostics.rateLimitRatePct));
  return lines.join('\n');
}

function retryableTelegramResult(result = {}) {
  const status = Number(result?.status || 0);
  return !result?.ok && (status === 0 || status === 429 || status >= 500);
}

export async function deliverProviderIncidentAlert({
  plan,
  adminTelegramIds = [],
  sendMessage,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!plan || plan.action !== 'send') return { ok:true, skipped:true, deliveredSlots:[], failedSlots:[] };
  if (typeof sendMessage !== 'function') throw new Error('sendMessage is required');

  const text = formatProviderIncidentAlert(plan);
  const deliveredSlots = [];
  const failedSlots = [];
  const failures = [];

  for (const slot of plan.targetSlots || []) {
    const chatId = adminTelegramIds[slot];
    if (!Number.isSafeInteger(Number(chatId)) || Number(chatId) <= 0) {
      failedSlots.push(slot);
      failures.push({ slot, status:0, retryable:false, reason:'invalid_admin_slot' });
      continue;
    }

    let result = null;
    for (let attempt = 1; attempt <= PROVIDER_INCIDENT_ALERT_POLICY.immediateRetryAttempts; attempt += 1) {
      try {
        result = await sendMessage(Number(chatId), text);
      } catch (error) {
        result = { ok:false, status:0, description:String(error?.message || 'Telegram delivery failed') };
      }
      if (result?.ok) break;
      if (!retryableTelegramResult(result) || attempt >= PROVIDER_INCIDENT_ALERT_POLICY.immediateRetryAttempts) break;
      if (Number(result?.status || 0) === 429 && Number(result?.retryAfter || 0) > 2) break;
      // The immediate retry budget allows two seconds; never shorten an
      // accepted Telegram retry_after below that server-requested delay.
      const delayMs = Number(result?.retryAfter || 0) > 0
        ? Math.min(2000, Math.max(250, Number(result.retryAfter) * 1000))
        : 300;
      await sleep(delayMs);
    }

    if (result?.ok) {
      deliveredSlots.push(slot);
    } else {
      failedSlots.push(slot);
      failures.push({
        slot,
        status:Number(result?.status || 0),
        retryable:retryableTelegramResult(result),
        reason:String(result?.description || 'telegram_delivery_failed').slice(0,160),
      });
    }
  }

  return {
    ok:failedSlots.length === 0,
    deliveredSlots,
    failedSlots,
    failures,
    recipientCount:(plan.targetSlots || []).length,
  };
}

export function providerIncidentAlertOpsEvent(plan = {}, delivery = {}) {
  const incident = plan.incident || {};
  const failed = Array.isArray(delivery.failedSlots) ? delivery.failedSlots : [];
  const delivered = Array.isArray(delivery.deliveredSlots) ? delivery.deliveredSlots : [];
  const ok = Boolean(delivery.ok) && failed.length === 0;
  return {
    severity:ok ? 'info' : 'warning',
    source:'provider_alert',
    eventType:'alert_delivery',
    code:ok ? 'PROVIDER_SLO_ALERT_SENT' : 'PROVIDER_SLO_ALERT_FAILED',
    message:ok
      ? 'Provider SLO operational alert delivered to configured administrators.'
      : 'Provider SLO operational alert delivery failed for one or more configured administrators.',
    endpoint:'cron:production-monitor',
    meta:{
      lifecycleEvent:ok ? 'alert_sent' : 'alert_failed',
      incidentId:incident.incidentId || null,
      alertKind:String(plan.kind || ''),
      deliveryKey:String(plan.deliveryKey || ''),
      fingerprint:String(incident.fingerprint || ''),
      severity:String(incident.severity || plan.severity || ''),
      provider:providerLabel(incident),
      operation:operationLabel(incident),
      attempt:Number(plan.attempt || 1),
      recipientCount:Number(delivery.recipientCount || 0),
      deliveredSlots:delivered,
      failedSlots:failed,
      retryableFailures:(delivery.failures || []).filter(item => item?.retryable).length,
    },
  };
}

export function providerIncidentAlertSelfTest() {
  const incident = {
    incidentId:'pslo-api-football-test',
    active:true,
    state:'incident',
    highestState:'incident',
    severity:'incident',
    startedAt:'2026-09-28T10:00:00.000Z',
    durationMinutes:30,
    fingerprint:'api-football|/fixtures|provider_slo|pslo-api-football-test',
    diagnostics:{
      primaryProvider:'api-football',
      primaryOperation:'/fixtures',
      sampleSize:20,
      errorRatePct:20,
      timeoutRatePct:10,
      rateLimitRatePct:0,
      avgAttemptLatencyMs:3200,
      reason:'timeout rate 10.0%',
    },
  };
  const report = { activeIncident:incident, history:[incident] };
  const first = planProviderIncidentAlert(report, [], { nowMs:Date.parse('2026-09-28T10:30:00Z'), adminCount:1 });
  const sent = [{
    created_at:'2026-09-28T10:30:00Z',
    source:'provider_alert',
    code:'PROVIDER_SLO_ALERT_SENT',
    metadata:{ incidentId:incident.incidentId, alertKind:'incident', deliveryKey:incident.incidentId + ':incident', deliveredSlots:[0], failedSlots:[] },
  }];
  const duplicate = planProviderIncidentAlert(report, sent, { nowMs:Date.parse('2026-09-28T10:45:00Z'), adminCount:1 });
  const recovered = { ...incident, active:false, state:'recovered', recoveredAt:'2026-09-28T11:00:00Z', durationMinutes:60 };
  const recovery = planProviderIncidentAlert({ activeIncident:null, history:[recovered] }, sent, { nowMs:Date.parse('2026-09-28T11:00:00Z'), adminCount:1 });
  return {
    pass:first.action === 'send'
      && first.kind === 'incident'
      && duplicate.action === 'none'
      && recovery.action === 'send'
      && recovery.kind === 'recovery',
    first:first.kind || '',
    duplicate:duplicate.reason || '',
    recovery:recovery.kind || '',
  };
}
