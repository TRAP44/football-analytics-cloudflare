export const PROVIDER_INCIDENT_ALERT_POLICY = Object.freeze({
  retryCooldownMinutes:30,
  reminderAfterMinutes:360,
  reminderLimit:2,
  maxDeferredAttempts:3,
  claimLeaseSeconds:120,
});

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asIso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function ledgerStatus(row = {}) {
  return String(row?.status || '').trim().toLowerCase();
}

function normalizeDestinations(destinations = [], adminCount = 0) {
  if (Array.isArray(destinations) && destinations.length) {
    return destinations
      .map((item, index) => ({
        slot:Number.isInteger(Number(item?.slot)) ? Number(item.slot) : index,
        destinationKey:String(item?.destinationKey || item?.destination_key || '').trim(),
      }))
      .filter(item => item.slot >= 0 && item.destinationKey);
  }
  return Array.from({ length:Math.max(0, Number(adminCount || 0)) }, (_, slot) => ({
    slot,
    destinationKey:'slot:' + slot,
  }));
}

export async function providerIncidentDestinationKey(chatId, botIdentity = 'primary') {
  const id = Number(chatId);
  if (!Number.isSafeInteger(id) || id <= 0) return '';
  const input = new TextEncoder().encode(String(botIdentity || 'primary') + '|' + id);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest).map(value => value.toString(16).padStart(2,'0')).join('').slice(0,40);
}

function relevantLedgerRows(rows = [], incidentId = '') {
  return (rows || []).filter(row => String(row?.incident_id || row?.incidentId || '') === String(incidentId || ''));
}

function deliveryState(rows = [], alertKey = '', destinations = [], nowMs = Date.now()) {
  const matching = (rows || []).filter(row => String(row?.alert_key || row?.alertKey || '') === String(alertKey || ''));
  const byDestination = new Map();
  for (const row of matching) {
    const key = String(row?.destination_key || row?.destinationKey || '');
    if (key) byDestination.set(key,row);
  }

  const deliveredSlots = [];
  const pending = [];
  const blocked = [];
  const terminal = [];
  const unknown = [];
  const sending = [];
  let maxAttempts = 0;

  for (const destination of destinations) {
    const row = byDestination.get(destination.destinationKey) || null;
    if (!row) {
      pending.push(destination);
      continue;
    }
    const status = ledgerStatus(row);
    const attempts = Math.max(0, finite(row?.attempts));
    maxAttempts = Math.max(maxAttempts, attempts);
    if (status === 'sent') {
      deliveredSlots.push(destination.slot);
      continue;
    }
    if (status === 'retry_pending') {
      const retryAt = Date.parse(String(row?.retry_at || row?.retryAt || ''));
      if (attempts < PROVIDER_INCIDENT_ALERT_POLICY.maxDeferredAttempts && (!Number.isFinite(retryAt) || retryAt <= nowMs)) {
        pending.push(destination);
      } else if (attempts >= PROVIDER_INCIDENT_ALERT_POLICY.maxDeferredAttempts) {
        terminal.push(destination.slot);
      } else {
        blocked.push(destination.slot);
      }
      continue;
    }
    if (status === 'terminal_failed') {
      terminal.push(destination.slot);
      continue;
    }
    if (status === 'unknown') {
      unknown.push(destination.slot);
      continue;
    }
    if (status === 'sending' || status === 'claimed') {
      sending.push(destination.slot);
      continue;
    }
    blocked.push(destination.slot);
  }

  const completed = destinations.length > 0 && deliveredSlots.length === destinations.length;
  const exhausted = destinations.length > 0
    && !completed
    && pending.length === 0
    && blocked.length === 0
    && sending.length === 0;
  return {
    rows:matching,
    deliveredSlots:deliveredSlots.sort((a,b) => a-b),
    pending,
    blockedSlots:blocked,
    terminalSlots:terminal,
    unknownSlots:unknown,
    sendingSlots:sending,
    completed,
    exhausted,
    waiting:Boolean(blocked.length || sending.length),
    nextAttempt:maxAttempts + 1,
  };
}

function planForKey({ rows, incident, kind, alertKey, destinations, nowMs, reminderIndex = null }) {
  const state = deliveryState(rows, alertKey, destinations, nowMs);
  if (state.completed) return { action:'none', reason:'already_delivered' };
  if (state.waiting) return { action:'none', reason:'delivery_waiting' };
  if (state.exhausted) return { action:'none', reason:'delivery_exhausted' };
  if (!state.pending.length) return { action:'none', reason:'no_pending_recipients' };

  return {
    action:'send',
    kind,
    alertKey,
    deliveryKey:alertKey,
    incidentId:incident.incidentId,
    incident,
    severity:incident.severity || (kind === 'recovery' ? 'info' : 'incident'),
    targetDeliveries:state.pending,
    targetSlots:state.pending.map(item => item.slot),
    attempt:state.nextAttempt,
    reminderIndex,
  };
}

export function planProviderIncidentAlert(report = {}, ledgerRows = [], { nowMs = Date.now(), adminCount = 0, destinations = [] } = {}) {
  const normalizedDestinations = normalizeDestinations(destinations, adminCount);
  if (!normalizedDestinations.length) return { action:'none', reason:'no_admin_recipients' };

  const active = report?.activeIncident || null;
  if (active?.active) {
    if (active.state !== 'incident' && active.highestState !== 'incident') {
      return { action:'none', reason:'watch_not_alertable' };
    }
    const rows = relevantLedgerRows(ledgerRows, active.incidentId);
    const openKey = active.incidentId + ':incident';
    const openState = deliveryState(rows, openKey, normalizedDestinations, nowMs);
    if (!openState.completed) {
      return planForKey({ rows, incident:active, kind:'incident', alertKey:openKey, destinations:normalizedDestinations, nowMs });
    }

    if (active.severity === 'critical') {
      const escalationKey = active.incidentId + ':escalation:critical';
      const escalation = planForKey({
        rows,
        incident:active,
        kind:'escalation',
        alertKey:escalationKey,
        destinations:normalizedDestinations,
        nowMs,
      });
      if (escalation.action === 'send' || !['already_delivered','delivery_exhausted'].includes(escalation.reason)) return escalation;
    }

    const duration = finite(active.durationMinutes);
    for (let index = 1; index <= PROVIDER_INCIDENT_ALERT_POLICY.reminderLimit; index += 1) {
      if (duration < PROVIDER_INCIDENT_ALERT_POLICY.reminderAfterMinutes * index) break;
      const reminderKey = active.incidentId + ':reminder:' + index;
      const reminder = planForKey({
        rows,
        incident:active,
        kind:'reminder',
        alertKey:reminderKey,
        destinations:normalizedDestinations,
        nowMs,
        reminderIndex:index,
      });
      if (reminder.action === 'send' || !['already_delivered','delivery_exhausted'].includes(reminder.reason)) return reminder;
    }
    return { action:'none', reason:'incident_alert_deduplicated' };
  }

  const recovered = Array.isArray(report?.history)
    ? report.history.find(item => !item?.active && item?.highestState === 'incident' && item?.incidentId)
    : null;
  if (!recovered) return { action:'none', reason:'no_incident' };

  const rows = relevantLedgerRows(ledgerRows, recovered.incidentId);
  const hadIncidentAttempt = rows.some(row => ['incident','escalation','reminder'].includes(String(row?.transition || row?.alert_kind || row?.alertKind || '')));
  if (!hadIncidentAttempt) return { action:'none', reason:'recovery_without_prior_incident_alert' };

  const recoveryKey = recovered.incidentId + ':recovery';
  return planForKey({
    rows,
    incident:recovered,
    kind:'recovery',
    alertKey:recoveryKey,
    destinations:normalizedDestinations,
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

export function classifyProviderIncidentTelegramResult(result = {}, nowMs = Date.now()) {
  if (result?.ok) return { state:'sent', retryAt:null, retryable:false, reason:'' };
  const status = Number(result?.status || 0);
  const outcome = String(result?.outcome || '').toLowerCase();
  const errorCode = String(result?.errorCode || result?.code || '');
  const description = String(result?.description || 'telegram_delivery_failed').slice(0,160);

  if (outcome === 'unknown' || (status === 0 && outcome !== 'not_started' && errorCode !== 'TELEGRAM_CONFIG')) {
    return { state:'unknown', retryAt:null, retryable:false, reason:description };
  }

  if (status === 429) {
    const retryAfter = Math.max(1, finite(result?.retryAfter, 1));
    return {
      state:'retry_pending',
      retryAt:new Date(Number(nowMs) + retryAfter * 1000).toISOString(),
      retryable:true,
      reason:description,
    };
  }

  if (status === 408 || status === 425 || status >= 500) {
    return {
      state:'retry_pending',
      retryAt:new Date(Number(nowMs) + PROVIDER_INCIDENT_ALERT_POLICY.retryCooldownMinutes * 60_000).toISOString(),
      retryable:true,
      reason:description,
    };
  }

  return { state:'terminal_failed', retryAt:null, retryable:false, reason:description };
}

async function processTarget({ plan, target, adminTelegramIds, claimDelivery, finalizeDelivery, sendMessage, nowMs, text }) {
  const slot = Number(target?.slot);
  const destinationKey = String(target?.destinationKey || '');
  const chatId = adminTelegramIds[slot];
  if (!Number.isSafeInteger(Number(chatId)) || Number(chatId) <= 0 || !destinationKey) {
    return { slot, state:'terminal_failed', claimAcquired:false, reason:'invalid_admin_slot', attempts:0 };
  }

  let claim;
  try {
    claim = await claimDelivery({
      incidentId:plan.incidentId,
      transition:plan.kind,
      alertKey:plan.alertKey || plan.deliveryKey,
      destinationKey,
      destinationSlot:slot,
      maxAttempts:PROVIDER_INCIDENT_ALERT_POLICY.maxDeferredAttempts,
      leaseSeconds:PROVIDER_INCIDENT_ALERT_POLICY.claimLeaseSeconds,
    });
  } catch (error) {
    return {
      slot,
      state:'persistence_failure',
      claimAcquired:false,
      reason:String(error?.message || 'alert_claim_failed').slice(0,160),
      attempts:0,
    };
  }

  if (!claim?.acquired) {
    const claimStatus = String(claim?.status || '').toLowerCase();
    const state = ['invalid','missing'].includes(claimStatus)
      ? 'persistence_failure'
      : claimStatus === 'unknown'
        ? 'unknown'
        : 'duplicate';
    return {
      slot,
      state,
      ledgerState:claimStatus || 'suppressed',
      retryAt:claim?.retryAt || claim?.retry_at || null,
      claimAcquired:false,
      reason:String(claim?.reason || 'claim_not_acquired'),
      attempts:Math.max(0, finite(claim?.attempts)),
    };
  }

  let result;
  try {
    result = await sendMessage(Number(chatId), text);
  } catch (error) {
    result = {
      ok:false,
      status:0,
      outcome:'unknown',
      description:String(error?.message || 'Telegram delivery outcome unknown').slice(0,160),
    };
  }
  const classified = classifyProviderIncidentTelegramResult(result, nowMs);
  const finalPayload = {
    incidentId:plan.incidentId,
    transition:plan.kind,
    alertKey:plan.alertKey || plan.deliveryKey,
    destinationKey,
    status:classified.state,
    retryAt:classified.retryAt,
    httpStatus:Number(result?.status || 0) || null,
    errorCode:String(result?.errorCode || result?.code || '').slice(0,80) || null,
    errorMessage:classified.reason || null,
  };

  try {
    await finalizeDelivery(finalPayload);
  } catch (error) {
    return {
      slot,
      state:'persistence_failure',
      deliveryState:classified.state,
      claimAcquired:true,
      reason:String(error?.message || 'alert_finalize_failed').slice(0,160),
      retryAt:classified.retryAt,
      attempts:Math.max(1, finite(claim?.attempts,1)),
    };
  }

  return {
    slot,
    state:classified.state,
    claimAcquired:true,
    reason:classified.reason,
    retryAt:classified.retryAt,
    httpStatus:Number(result?.status || 0),
    attempts:Math.max(1, finite(claim?.attempts,1)),
  };
}

export async function deliverProviderIncidentAlert({
  plan,
  adminTelegramIds = [],
  claimDelivery,
  finalizeDelivery,
  sendMessage,
  nowMs = Date.now(),
} = {}) {
  if (!plan || plan.action !== 'send') return { ok:true, skipped:true, outcomes:[], deliveredSlots:[], failedSlots:[] };
  if (typeof sendMessage !== 'function') throw new Error('sendMessage is required');
  if (typeof claimDelivery !== 'function' || typeof finalizeDelivery !== 'function') {
    return {
      ok:false,
      failClosed:true,
      outcomes:(plan.targetDeliveries || []).map(target => ({
        slot:Number(target?.slot),
        state:'persistence_failure',
        claimAcquired:false,
        reason:'persistent_delivery_ledger_unavailable',
      })),
      deliveredSlots:[],
      failedSlots:(plan.targetDeliveries || []).map(target => Number(target?.slot)),
      recipientCount:(plan.targetDeliveries || []).length,
    };
  }

  const text = formatProviderIncidentAlert(plan);
  const targets = Array.isArray(plan.targetDeliveries) ? plan.targetDeliveries : [];
  const settled = await Promise.allSettled(targets.map(target => processTarget({
    plan,
    target,
    adminTelegramIds,
    claimDelivery,
    finalizeDelivery,
    sendMessage,
    nowMs,
    text,
  })));

  const outcomes = settled.map((item,index) => item.status === 'fulfilled'
    ? item.value
    : {
        slot:Number(targets[index]?.slot),
        state:'persistence_failure',
        claimAcquired:false,
        reason:String(item.reason?.message || item.reason || 'delivery_task_rejected').slice(0,160),
      });
  const deliveredSlots = outcomes.filter(item => item.state === 'sent').map(item => item.slot);
  const failedSlots = outcomes.filter(item => !['sent','duplicate'].includes(item.state)).map(item => item.slot);
  return {
    ok:outcomes.every(item => ['sent','duplicate'].includes(item.state)),
    outcomes,
    deliveredSlots,
    failedSlots,
    recipientCount:targets.length,
  };
}

function opsEventForState(plan = {}, state = '', items = []) {
  const incident = plan.incident || {};
  const slots = items.map(item => Number(item.slot)).filter(Number.isInteger);
  const attempts = items.map(item => Number(item.attempts || 0)).filter(Number.isFinite);
  const retryAt = items.map(item => item.retryAt).filter(Boolean).sort()[0] || null;
  const spec = {
    claim_acquired:['info','PROVIDER_SLO_ALERT_CLAIM_ACQUIRED','alert_claim_acquired','Persistent alert delivery claim acquired.'],
    duplicate:['info','PROVIDER_SLO_ALERT_DUPLICATE_SUPPRESSED','alert_duplicate_suppressed','Duplicate provider incident alert delivery suppressed by persistent ledger.'],
    sent:['info',plan.kind === 'recovery' ? 'PROVIDER_SLO_RECOVERY_ALERT_SENT' : 'PROVIDER_SLO_ALERT_SENT','alert_sent','Provider SLO operational alert delivery confirmed by Telegram.'],
    retry_pending:['warning','PROVIDER_SLO_ALERT_RETRY_PENDING','alert_retry_pending','Telegram confirmed a temporary delivery failure; controlled retry is pending.'],
    terminal_failed:['warning','PROVIDER_SLO_ALERT_TERMINAL_FAILED','alert_terminal_failed','Telegram confirmed a non-retryable provider incident alert failure.'],
    unknown:['warning','PROVIDER_SLO_ALERT_UNKNOWN','alert_unknown','Provider incident alert delivery outcome is ambiguous; automatic retry is suppressed.'],
    persistence_failure:['error','PROVIDER_SLO_ALERT_PERSISTENCE_FAILED','alert_persistence_failure','Persistent alert delivery state could not be confirmed; delivery failed closed.'],
  }[state] || ['warning','PROVIDER_SLO_ALERT_STATE','alert_state','Provider incident alert delivery state changed.'];
  return {
    severity:spec[0],
    source:'provider_alert',
    eventType:'alert_delivery',
    code:spec[1],
    message:spec[3],
    endpoint:'cron:production-monitor',
    meta:{
      lifecycleEvent:spec[2],
      incidentId:incident.incidentId || plan.incidentId || null,
      alertKind:String(plan.kind || ''),
      deliveryKey:String(plan.alertKey || plan.deliveryKey || ''),
      fingerprint:String(incident.fingerprint || ''),
      severity:String(incident.severity || plan.severity || ''),
      provider:providerLabel(incident),
      operation:operationLabel(incident),
      recipientSlots:slots,
      recipientCount:slots.length,
      attempts:attempts.length ? Math.max(...attempts) : 0,
      retryAt,
    },
  };
}

export function providerIncidentAlertOpsEvents(plan = {}, delivery = {}) {
  const outcomes = Array.isArray(delivery?.outcomes) ? delivery.outcomes : [];
  const events = [];
  const claimed = outcomes.filter(item => item?.claimAcquired);
  if (claimed.length) events.push(opsEventForState(plan,'claim_acquired',claimed));
  for (const state of ['duplicate','sent','retry_pending','terminal_failed','unknown','persistence_failure']) {
    const items = outcomes.filter(item => item?.state === state);
    if (items.length) events.push(opsEventForState(plan,state,items));
  }
  return events;
}

export function providerIncidentAlertOpsEvent(plan = {}, delivery = {}) {
  const events = providerIncidentAlertOpsEvents(plan,delivery);
  return events.find(event => /_SENT$/.test(event.code))
    || events.find(event => event.severity === 'error')
    || events.find(event => event.severity === 'warning')
    || events[0]
    || opsEventForState(plan,'duplicate',[]);
}

export function providerIncidentAlertLedgerSummary(rows = []) {
  const counts = { sending:0, sent:0, retry_pending:0, terminal_failed:0, unknown:0 };
  for (const row of rows || []) {
    const status = ledgerStatus(row);
    if (Object.prototype.hasOwnProperty.call(counts,status)) counts[status] += 1;
  }
  return {
    rows:Number((rows || []).length),
    states:counts,
    operationalAttention:Number(counts.retry_pending + counts.terminal_failed + counts.unknown),
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
    diagnostics:{primaryProvider:'api-football',primaryOperation:'/fixtures'},
  };
  const destinations=[{slot:0,destinationKey:'dest-a'}];
  const first = planProviderIncidentAlert({ activeIncident:incident, history:[incident] }, [], { destinations });
  const sent = [{
    incident_id:incident.incidentId,
    transition:'incident',
    alert_key:incident.incidentId + ':incident',
    destination_key:'dest-a',
    status:'sent',
    attempts:1,
  }];
  const duplicate = planProviderIncidentAlert({ activeIncident:incident, history:[incident] }, sent, { destinations });
  const recovered = { ...incident, active:false, state:'recovered', recoveredAt:'2026-09-28T11:00:00.000Z', durationMinutes:60 };
  const recovery = planProviderIncidentAlert({ activeIncident:null, history:[recovered] }, sent, { destinations });
  const unknown = classifyProviderIncidentTelegramResult({ok:false,status:0,outcome:'unknown'},Date.parse('2026-09-28T11:00:00Z'));
  return {
    pass:first.action === 'send'
      && first.kind === 'incident'
      && duplicate.action === 'none'
      && recovery.action === 'send'
      && recovery.kind === 'recovery'
      && unknown.state === 'unknown',
    first:first.kind || '',
    duplicate:duplicate.reason || '',
    recovery:recovery.kind || '',
    ambiguous:unknown.state,
  };
}
