export const PROVIDER_INCIDENT_ALERT_POLICY = Object.freeze({
  retryCooldownMinutes:30,
  reminderAfterMinutes:360,
  reminderLimit:2,
  maxDeferredAttempts:3,
  claimLeaseSeconds:120,
});

function numericCandidate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isFinite(number) ? number : null;
}

function integerCandidate(value) {
  const number=numericCandidate(value);
  return Number.isSafeInteger(number) ? number : null;
}

function nonNegativeInteger(value, fallback = 0) {
  const number=integerCandidate(value);
  return number !== null && number >= 0 ? number : fallback;
}

function positiveInteger(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const number=integerCandidate(value);
  return number !== null && number > 0 && number <= max ? number : fallback;
}

function boundedPositiveInteger(value, fallback, max) {
  const number=integerCandidate(value);
  if (number === null || number <= 0) return fallback;
  return Math.min(max,number);
}

function finite(value, fallback = 0) {
  const number=numericCandidate(value);
  return number === null ? fallback : number;
}

function timestampCandidate(value, fallback = Date.now()) {
  const number=numericCandidate(value);
  return number !== null && number >= 0 && number <= 8.64e15 ? number : fallback;
}

function asIso(value) {
  let ms=null;
  if (typeof value === 'number') ms=Number.isFinite(value) ? value : null;
  else if (value instanceof Date) ms=value.getTime();
  else if (typeof value === 'string' && value.trim()) ms=Date.parse(value.trim());
  if (!Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toISOString();
  } catch {
    return '';
  }
}

function ledgerStatus(row = {}) {
  return String(row?.status || '').trim().toLowerCase();
}

function normalizeDestinations(destinations = [], adminCount = 0) {
  if (Array.isArray(destinations) && destinations.length) {
    const normalized=[];
    const seenSlots=new Set();
    const seenKeys=new Set();
    for (const [index,item] of destinations.entries()) {
      const rawSlot=item?.slot;
      const slot=rawSlot === undefined || rawSlot === null || rawSlot === ''
        ? index
        : nonNegativeInteger(rawSlot,-1);
      const rawKey=item?.destinationKey ?? item?.destination_key;
      const destinationKey=typeof rawKey === 'string' ? rawKey.trim() : '';
      if (
        slot < 0
        || !destinationKey
        || destinationKey.length > 160
        || seenSlots.has(slot)
        || seenKeys.has(destinationKey)
      ) continue;
      seenSlots.add(slot);
      seenKeys.add(destinationKey);
      normalized.push({slot,destinationKey});
    }
    return normalized;
  }
  const count=Math.min(100,nonNegativeInteger(adminCount));
  return Array.from({ length:count }, (_, slot) => ({
    slot,
    destinationKey:'slot:' + slot,
  }));
}

export function providerIncidentBotIdentity(botToken = '') {
  const match=/^(\d{5,}):/.exec(String(botToken || '').trim());
  return match ? `telegram-bot:${match[1]}` : 'telegram-bot:primary';
}

export async function providerIncidentDestinationKey(chatId, botIdentity = 'telegram-bot:primary') {
  const id = positiveInteger(chatId);
  if (!id) return '';
  const identity=typeof botIdentity === 'string' && botIdentity.trim()
    ? botIdentity.trim().slice(0,120)
    : 'telegram-bot:primary';
  const input = new TextEncoder().encode(identity + '|' + id);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest).map(value => value.toString(16).padStart(2,'0')).join('').slice(0,40);
}

function relevantLedgerRows(rows = [], incidentId = '') {
  const id=typeof incidentId === 'string' ? incidentId.trim() : '';
  return (Array.isArray(rows) ? rows : [])
    .filter(row => String(row?.incident_id || row?.incidentId || '') === id);
}

function ledgerRowTime(row = {}) {
  const value=row?.updated_at ?? row?.updatedAt ?? row?.created_at ?? row?.createdAt;
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp) ? timestamp : null;
}

function deliveryState(rows = [], alertKey = '', destinations = [], nowMs = Date.now()) {
  const sourceRows=Array.isArray(rows) ? rows : [];
  const targetList=Array.isArray(destinations) ? destinations : [];
  const matching = sourceRows.filter(row => String(row?.alert_key || row?.alertKey || '') === String(alertKey || ''));
  const byDestination = new Map();
  for (const row of matching) {
    const key = String(row?.destination_key || row?.destinationKey || '').trim();
    if (!key) continue;
    const existing=byDestination.get(key);
    const rowTime=ledgerRowTime(row);
    const existingTime=ledgerRowTime(existing);
    if (
      !existing
      || (rowTime !== null && (existingTime === null || rowTime >= existingTime))
      || (rowTime === null && existingTime === null)
    ) byDestination.set(key,row);
  }

  const deliveredSlots = [];
  const pending = [];
  const blocked = [];
  const terminal = [];
  const unknown = [];
  const sending = [];
  let maxAttempts = 0;
  const effectiveNow=timestampCandidate(nowMs);

  for (const destination of targetList) {
    let row=byDestination.get(destination.destinationKey) || null;
    if (!row) {
      const legacyCandidates=matching
        .filter(candidate =>
          String(candidate?.destination_identity_version || candidate?.destinationIdentityVersion || 'legacy')==='legacy'
          && nonNegativeInteger(candidate?.destination_slot ?? candidate?.destinationSlot,-1)===destination.slot
        )
        .sort((a,b)=>(ledgerRowTime(b) ?? -1)-(ledgerRowTime(a) ?? -1));
      row=legacyCandidates.find(candidate=>ledgerStatus(candidate)==='sent')
        || legacyCandidates[0]
        || null;
    }
    if (!row) {
      pending.push(destination);
      continue;
    }

    const rowDestinationKey=String(row?.destination_key || row?.destinationKey || '').trim();
    const pendingDestination=rowDestinationKey && rowDestinationKey!==destination.destinationKey
      ? {...destination,destinationKey:rowDestinationKey,identityVersion:'legacy'}
      : destination;
    const status = ledgerStatus(row);
    const attemptsCandidate=integerCandidate(row?.attempts);
    if (attemptsCandidate === null || attemptsCandidate < 0) {
      unknown.push(destination.slot);
      continue;
    }
    const attempts=attemptsCandidate;
    maxAttempts = Math.max(maxAttempts, attempts);

    if (status === 'sent') {
      deliveredSlots.push(destination.slot);
      continue;
    }
    if (status === 'retry_pending') {
      const rawRetryAt=row?.retry_at ?? row?.retryAt;
      const retryAt=typeof rawRetryAt==='string' && rawRetryAt.trim()
        ? Date.parse(rawRetryAt.trim()) : NaN;
      // Missing or malformed retry dates must never authorize an early resend.
      if (attempts < PROVIDER_INCIDENT_ALERT_POLICY.maxDeferredAttempts && Number.isFinite(retryAt) && retryAt <= effectiveNow) {
        pending.push(pendingDestination);
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
    if (status === 'claimed' || status === 'sending') {
      if (attempts >= PROVIDER_INCIDENT_ALERT_POLICY.maxDeferredAttempts) {
        terminal.push(destination.slot);
        continue;
      }
      const lockedUntil=Date.parse(String(row?.locked_until || row?.lockedUntil || ''));
      if (!Number.isFinite(lockedUntil) || lockedUntil<=effectiveNow) pending.push(pendingDestination);
      else sending.push(destination.slot);
      continue;
    }
    blocked.push(destination.slot);
  }

  const completed = targetList.length > 0 && deliveredSlots.length === targetList.length;
  const exhausted = targetList.length > 0
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
    nextAttempt:Math.min(PROVIDER_INCIDENT_ALERT_POLICY.maxDeferredAttempts,maxAttempts + 1),
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

  const active = report?.activeIncident && typeof report.activeIncident === 'object'
    ? report.activeIncident
    : null;
  if (active?.active === true) {
    if (typeof active.incidentId !== 'string' || !active.incidentId.trim() || active.incidentId.trim().length > 200) {
      return { action:'none', reason:'incident_identity_unavailable' };
    }
    const incident={...active,incidentId:active.incidentId.trim()};
    if (incident.state !== 'incident' && incident.highestState !== 'incident') {
      return { action:'none', reason:'watch_not_alertable' };
    }
    const rows = relevantLedgerRows(ledgerRows, incident.incidentId);
    const openKey = incident.incidentId + ':incident';
    const openState = deliveryState(rows, openKey, normalizedDestinations, nowMs);
    if (!openState.completed) {
      return planForKey({ rows, incident, kind:'incident', alertKey:openKey, destinations:normalizedDestinations, nowMs });
    }

    if (incident.severity === 'critical') {
      const escalationKey = incident.incidentId + ':escalation:critical';
      const escalation = planForKey({
        rows,
        incident,
        kind:'escalation',
        alertKey:escalationKey,
        destinations:normalizedDestinations,
        nowMs,
      });
      if (escalation.action === 'send' || !['already_delivered','delivery_exhausted'].includes(escalation.reason)) return escalation;
    }

    const duration = Math.max(0,finite(incident.durationMinutes));
    for (let index = 1; index <= PROVIDER_INCIDENT_ALERT_POLICY.reminderLimit; index += 1) {
      if (duration < PROVIDER_INCIDENT_ALERT_POLICY.reminderAfterMinutes * index) break;
      const reminderKey = incident.incidentId + ':reminder:' + index;
      const reminder = planForKey({
        rows,
        incident,
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
    ? report.history.find(item =>
        item?.active === false
        && item?.highestState === 'incident'
        && typeof item?.incidentId === 'string'
        && item.incidentId.trim()
        && item.incidentId.length <= 200
      )
    : null;
  if (!recovered) return { action:'none', reason:'no_incident' };

  const recoveredIncident={...recovered,incidentId:recovered.incidentId.trim()};
  const rows = relevantLedgerRows(ledgerRows, recoveredIncident.incidentId);
  const hadIncidentAttempt = rows.some(row => ['incident','escalation','reminder'].includes(String(row?.transition || row?.alert_kind || row?.alertKind || '')));
  if (!hadIncidentAttempt) return { action:'none', reason:'recovery_without_prior_incident_alert' };

  const recoveryKey = recoveredIncident.incidentId + ':recovery';
  return planForKey({
    rows,
    incident:recoveredIncident,
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
  const statusCandidate=integerCandidate(result?.status);
  const status=statusCandidate !== null && statusCandidate >= 0 && statusCandidate <= 599 ? statusCandidate : 0;
  const outcome = typeof result?.outcome === 'string' ? result.outcome.trim().toLowerCase() : '';
  const successStatus = result?.status == null || (status >= 200 && status < 300);
  if (result?.ok === true && successStatus && (!outcome || outcome === 'sent')) {
    return { state:'sent', retryAt:null, retryable:false, reason:'' };
  }
  const errorCodeValue=result?.errorCode ?? result?.code;
  const errorCode = typeof errorCodeValue === 'string' ? errorCodeValue.trim().slice(0,80) : '';
  const description = typeof result?.description === 'string' && result.description.trim()
    ? result.description.trim().slice(0,160)
    : 'telegram_delivery_failed';
  const effectiveNow=timestampCandidate(nowMs);

  if (outcome === 'unknown' || (status === 0 && outcome !== 'not_started' && errorCode !== 'TELEGRAM_CONFIG')) {
    return { state:'unknown', retryAt:null, retryable:false, reason:description };
  }

  if (status === 429) {
    const retryAfter = boundedPositiveInteger(result?.retryAfter,1,604800);
    return {
      state:'retry_pending',
      retryAt:new Date(effectiveNow + retryAfter * 1000).toISOString(),
      retryable:true,
      reason:description,
    };
  }

  if (status === 408 || status === 425 || status >= 500) {
    return {
      state:'retry_pending',
      retryAt:new Date(effectiveNow + PROVIDER_INCIDENT_ALERT_POLICY.retryCooldownMinutes * 60_000).toISOString(),
      retryable:true,
      reason:description,
    };
  }

  return { state:'terminal_failed', retryAt:null, retryable:false, reason:description };
}

async function processTarget({ plan, target, adminTelegramIds, claimDelivery, beginDelivery, finalizeDelivery, sendMessage, nowMs, text }) {
  const slot = nonNegativeInteger(target?.slot,-1);
  const destinationKey = typeof target?.destinationKey === 'string' ? target.destinationKey.trim() : '';
  const chatIdRaw = Array.isArray(adminTelegramIds) && slot >= 0 ? adminTelegramIds[slot] : null;
  const chatId = positiveInteger(chatIdRaw);
  if (slot < 0 || !chatId || !destinationKey || destinationKey.length > 160) {
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

  if (typeof claim?.acquired !== 'boolean') {
    return {
      slot,
      state:'persistence_failure',
      claimAcquired:false,
      reason:'claim_result_unconfirmed',
      attempts:nonNegativeInteger(claim?.attempts),
    };
  }

  if (!claim.acquired) {
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
      attempts:nonNegativeInteger(claim?.attempts),
    };
  }

  const claimStatus=String(claim?.status || '').toLowerCase();
  if (claimStatus==='claimed') {
    if (typeof beginDelivery!=='function') {
      return {
        slot,
        state:'persistence_failure',
        claimAcquired:true,
        reason:'begin_delivery_unavailable',
        attempts:Math.max(1,positiveInteger(claim?.attempts,1)),
      };
    }
    let begun;
    try {
      begun=await beginDelivery({
        alertKey:plan.alertKey || plan.deliveryKey,
        destinationKey,
      });
    } catch (error) {
      return {
        slot,
        state:'persistence_failure',
        claimAcquired:true,
        reason:String(error?.message || 'begin_delivery_failed').slice(0,160),
        attempts:Math.max(1,positiveInteger(claim?.attempts,1)),
      };
    }
    if (!begun?.ok || String(begun?.status || '').toLowerCase()!=='sending') {
      return {
        slot,
        state:'persistence_failure',
        claimAcquired:true,
        reason:String(begun?.reason || 'begin_delivery_unconfirmed').slice(0,160),
        attempts:Math.max(1,positiveInteger(claim?.attempts,1)),
      };
    }
  } else if (claimStatus!=='sending') {
    return {
      slot,
      state:'persistence_failure',
      claimAcquired:true,
      reason:'unexpected_claim_state',
      attempts:Math.max(1,positiveInteger(claim?.attempts,1)),
    };
  }

  let result;
  try {
    result = await sendMessage(chatId, text);
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
    httpStatus:(()=>{
      const status=integerCandidate(result?.status);
      return status !== null && status >= 100 && status <= 599 ? status : null;
    })(),
    errorCode:(()=>{
      const value=result?.errorCode ?? result?.code;
      return typeof value === 'string' && value.trim() ? value.trim().slice(0,80) : null;
    })(),
    errorMessage:classified.reason || null,
  };

  try {
    const finalized=await finalizeDelivery(finalPayload);
    if (!finalized || finalized.ok !== true) {
      throw new Error(String(finalized?.reason || 'alert_finalize_unconfirmed'));
    }
  } catch (error) {
    return {
      slot,
      state:'persistence_failure',
      deliveryState:classified.state,
      claimAcquired:true,
      reason:String(error?.message || 'alert_finalize_failed').slice(0,160),
      retryAt:classified.retryAt,
      attempts:Math.max(1,positiveInteger(claim?.attempts,1)),
    };
  }

  return {
    slot,
    state:classified.state,
    claimAcquired:true,
    reason:classified.reason,
    retryAt:classified.retryAt,
    httpStatus:(()=>{
      const status=integerCandidate(result?.status);
      return status !== null && status >= 0 && status <= 599 ? status : 0;
    })(),
    attempts:Math.max(1,positiveInteger(claim?.attempts,1)),
  };
}

export async function deliverOperationalIncidentAlert({
  plan,
  text = '',
  adminTelegramIds = [],
  claimDelivery,
  beginDelivery,
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
      outcomes:(Array.isArray(plan.targetDeliveries) ? plan.targetDeliveries : []).map(target => ({
        slot:nonNegativeInteger(target?.slot,-1),
        state:'persistence_failure',
        claimAcquired:false,
        reason:'persistent_delivery_ledger_unavailable',
      })),
      deliveredSlots:[],
      failedSlots:(Array.isArray(plan.targetDeliveries) ? plan.targetDeliveries : []).map(target => nonNegativeInteger(target?.slot,-1)),
      recipientCount:(Array.isArray(plan.targetDeliveries) ? plan.targetDeliveries : []).length,
    };
  }

  const targets = Array.isArray(plan.targetDeliveries) ? plan.targetDeliveries : [];
  const settled = await Promise.allSettled(targets.map(target => processTarget({
    plan,
    target,
    adminTelegramIds,
    claimDelivery,
    beginDelivery,
    finalizeDelivery,
    sendMessage,
    nowMs,
    text:String(text || ''),
  })));

  const outcomes = settled.map((item,index) => item.status === 'fulfilled'
    ? item.value
    : {
        slot:nonNegativeInteger(targets[index]?.slot,-1),
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

export async function deliverProviderIncidentAlert(options = {}) {
  return deliverOperationalIncidentAlert({
    ...options,
    text:formatProviderIncidentAlert(options?.plan || {}),
  });
}

function opsEventForState(plan = {}, state = '', items = []) {
  const incident = plan.incident || {};
  const slots = items.map(item => nonNegativeInteger(item?.slot,-1)).filter(slot => slot >= 0);
  const attempts = items
    .map(item => nonNegativeInteger(item?.attempts,-1))
    .filter(attempt => attempt >= 0);
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
  const source=Array.isArray(rows) ? rows : [];
  const counts = { claimed:0, sending:0, sent:0, retry_pending:0, terminal_failed:0, unknown:0 };
  for (const row of source) {
    const status = ledgerStatus(row);
    if (Object.prototype.hasOwnProperty.call(counts,status)) counts[status] += 1;
  }
  return {
    rows:source.length,
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
