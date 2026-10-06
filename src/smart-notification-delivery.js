const CLAIM_STALE_MS = 20 * 60_000;
const MAX_DELIVERY_ATTEMPTS = 3;
const MAX_COOLDOWN_SECONDS = 24 * 60 * 60;
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;
const MAX_MEMORY_LEDGER_ENTRIES = 4096;
const MEMORY_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_TIMESTAMP_MS = 8.64e15;
const MAX_TEXT_LENGTH = 4096;
const CATEGORIES = new Set(['match','teams','players','aiRadar']);
const CLAIM_ALLOW_REASONS = new Set(['created','retry','stale_claim_recovered']);
const CLAIM_BLOCK_REASONS = new Set(['duplicate','retry_wait','cooldown']);
const FINAL_STATUSES = new Set(['sent','retry_pending','unknown','terminal_failed']);
const ACTIVE_MEMORY_STATUSES = new Set(['claimed','sending','retry_pending','unknown']);
const EVENT_TYPE_RE = /^(?:match|team|player|ai|radar|market)\.[a-z0-9][a-z0-9_.-]{0,78}$/;

function required(name,value) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

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

function positiveSafeInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number > 0 ? number : 0;
}

function nonNegativeInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number >= 0 ? number : null;
}

function boundedSeconds(value,fallback,max,{allowZero=false}={}) {
  if (value === undefined || value === null || value === '') return fallback;
  const number=nonNegativeInteger(value);
  if (number === null) return null;
  if (number === 0) return allowZero ? 0 : fallback;
  return Math.min(max,number);
}

function safeClock(now) {
  try {
    const value=now();
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= MAX_TIMESTAMP_MS
      ? value
      : Date.now();
  } catch {
    return Date.now();
  }
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms=Date.parse(value.trim());
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_TIMESTAMP_MS) return null;
  return ms;
}

function canonicalTimestamp(value) {
  const ms=parseTimestamp(value);
  if (ms === null) return '';
  try { return new Date(ms).toISOString(); } catch { return ''; }
}

function cleanToken(value,maxLength,pattern) {
  if (typeof value !== 'string') return '';
  const raw=value.trim();
  if (!raw || raw.length > maxLength || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return '';
  return pattern && !pattern.test(raw) ? '' : raw;
}

function cleanEventType(value) {
  if (typeof value !== 'string') return '';
  const raw=value.trim().toLowerCase();
  return EVENT_TYPE_RE.test(raw) ? raw : '';
}

function cleanCategory(value) {
  return typeof value === 'string' && CATEGORIES.has(value.trim()) ? value.trim() : '';
}

function expectedCategory(eventType) {
  if (eventType.startsWith('player.')) return 'players';
  if (eventType.startsWith('ai.') || eventType.startsWith('radar.') || eventType.startsWith('market.')) {
    return 'aiRadar';
  }
  if (eventType.startsWith('team.')) return 'teams';
  if (eventType.startsWith('match.')) return 'match';
  return '';
}

function cleanDedupeKey(value) {
  return cleanToken(value,240,/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,239}$/);
}

function cleanText(value,maxLength=MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return '';
  const raw=value.trim();
  if (
    !raw
    || raw.length > maxLength
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(raw)
  ) return '';
  return raw;
}

function cleanError(value,fallback='Telegram delivery failed.') {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,240);
}

function telegramCode(value) {
  const number=integerCandidate(value);
  return number !== null && number >= 100 && number <= 599 ? number : null;
}

function normalizeTelegramResult(value) {
  const source=plainObject(value) || {};
  const status=telegramCode(source.status);
  const errorCode=telegramCode(source.errorCode);
  const rawOutcome=typeof source.outcome === 'string' ? source.outcome.trim().toLowerCase() : '';
  const reportedOk=source.ok === true;
  const statusCompatible=status === null || (status >= 200 && status <= 299);
  const errorCompatible=errorCode === null || (errorCode >= 200 && errorCode <= 299);
  const outcomeCompatible=!rawOutcome || rawOutcome === 'sent';
  const ok=reportedOk && statusCompatible && errorCompatible && outcomeCompatible;
  const outcome=ok
    ? 'sent'
    : rawOutcome === 'confirmed_failure'
      ? 'confirmed_failure'
      : 'unknown';
  const retryAfter=boundedSeconds(source.retryAfter,0,MAX_RETRY_AFTER_SECONDS,{allowZero:true}) ?? 0;
  return {
    ok,
    status,
    errorCode,
    outcome,
    retryAfter,
    description:cleanError(
      source.description,
      ok ? '' : outcome === 'unknown'
        ? 'Telegram delivery result is ambiguous.'
        : 'Telegram delivery failed.',
    ),
  };
}

function retryableTelegramFailure(result) {
  return result?.outcome === 'confirmed_failure'
    && (result.status === 429 || result.errorCode === 429
      || (result.status !== null && result.status >= 500)
      || (result.errorCode !== null && result.errorCode >= 500));
}

function memoryKey(userId,dedupeKey) {
  const id=positiveSafeInteger(userId);
  const key=cleanDedupeKey(dedupeKey);
  return id && key ? `${id}:${key}` : '';
}

function supabaseMode(hasSupabase,cfg) {
  try {
    const value=hasSupabase(cfg);
    if (value === true) return 'persistent';
    if (value === false) return 'memory';
    return 'invalid';
  } catch {
    return 'invalid';
  }
}

function normalizeInput({row,eventType,category,text,dedupeKey,cooldownSeconds=0}={}) {
  const source=plainObject(row);
  const userId=positiveSafeInteger(source?.telegram_id);
  const fixtureId=positiveSafeInteger(source?.fixture_id);
  const normalizedEventType=cleanEventType(eventType);
  const normalizedCategory=cleanCategory(category);
  const normalizedText=cleanText(text);
  const normalizedDedupeKey=cleanDedupeKey(dedupeKey);
  const normalizedCooldown=boundedSeconds(
    cooldownSeconds,
    0,
    MAX_COOLDOWN_SECONDS,
    {allowZero:true},
  );
  if (
    !userId
    || !fixtureId
    || !normalizedEventType
    || !normalizedCategory
    || normalizedCategory !== expectedCategory(normalizedEventType)
    || !normalizedText
    || !normalizedDedupeKey
    || !normalizedDedupeKey.startsWith(`v1:${fixtureId}:${normalizedEventType}:`)
    || normalizedCooldown === null
  ) return null;
  return {
    userId,
    fixtureId,
    eventType:normalizedEventType,
    category:normalizedCategory,
    text:normalizedText,
    dedupeKey:normalizedDedupeKey,
    cooldownSeconds:normalizedCooldown,
  };
}

function normalizeClaimResult(value) {
  const source=plainObject(value);
  if (!source || typeof source.allowed !== 'boolean') {
    return {allowed:false,reason:'persistence_error',claimAt:'',attempts:null};
  }
  const reason=typeof source.reason === 'string' ? source.reason.trim() : '';
  const attempts=source.attempts === undefined || source.attempts === null
    ? null
    : positiveSafeInteger(source.attempts);

  if (source.allowed === true) {
    const claimAt=canonicalTimestamp(source.claimAt ?? source.claim_at);
    if (!CLAIM_ALLOW_REASONS.has(reason) || !claimAt || (attempts !== null && !attempts)) {
      return {allowed:false,reason:'persistence_error',claimAt:'',attempts:null};
    }
    return {allowed:true,reason,claimAt,attempts};
  }

  if (!CLAIM_BLOCK_REASONS.has(reason)) {
    return {allowed:false,reason:'persistence_error',claimAt:'',attempts:null};
  }
  return {allowed:false,reason,claimAt:'',attempts:null};
}

function normalizeBeginResult(value) {
  const source=plainObject(value);
  if (!source || typeof source.started !== 'boolean') {
    return {started:false,reason:'persistence_error'};
  }
  const reason=typeof source.reason === 'string' ? source.reason.trim() : '';
  if (source.started === true) {
    return reason === 'sending'
      ? {started:true,reason:'sending'}
      : {started:false,reason:'persistence_error'};
  }
  return ['claim_lost','max_retries'].includes(reason)
    ? {started:false,reason}
    : {started:false,reason:'persistence_error'};
}

function normalizeFinalizeResult(value) {
  const source=plainObject(value);
  return Boolean(
    source
    && source.updated === true
    && source.reason === 'finalized'
  );
}

export function createSmartNotificationDeliveryService({
  memory,
  hasSupabase,
  supaRpc,
  sendTelegramMessage,
  recordOpsEvent,
  now=Date.now,
} = {}) {
  required('hasSupabase',hasSupabase);
  required('supaRpc',supaRpc);
  required('sendTelegramMessage',sendTelegramMessage);
  required('now',now);

  if (memory !== undefined && memory !== null && !plainObject(memory)) {
    throw new TypeError('memory must be a plain object');
  }
  const runtimeMemory=plainObject(memory) || {};
  const ledger=runtimeMemory.smartNotificationDeliveries instanceof Map
    ? runtimeMemory.smartNotificationDeliveries
    : new Map();
  if (!(runtimeMemory.smartNotificationDeliveries instanceof Map)) {
    runtimeMemory.smartNotificationDeliveries=ledger;
  }

  async function observe(cfg,payload={}) {
    if (typeof recordOpsEvent !== 'function') return false;
    const source=plainObject(payload) || {};
    try {
      await recordOpsEvent(cfg,{
        severity:['info','warning','error','critical'].includes(source.severity)
          ? source.severity
          : 'info',
        source:'smart_notifications',
        eventType:'smart_notification_delivery',
        code:cleanToken(source.code,100,/^[A-Z0-9][A-Z0-9_]{0,99}$/) || 'SMART_NOTIFICATION_DELIVERY',
        message:cleanError(source.message,'Smart notification delivery event.'),
        endpoint:'cron:smart-notifications',
        meta:{
          fixtureId:positiveSafeInteger(source.fixtureId) || null,
          notificationType:cleanEventType(source.eventType) || 'unknown',
          category:cleanCategory(source.category) || 'unknown',
          disposition:cleanToken(source.disposition,80,/^[a-z0-9][a-z0-9_-]{0,79}$/) || 'unknown',
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  function pruneMemoryLedger(currentTime) {
    if (ledger.size < MAX_MEMORY_LEDGER_ENTRIES) return true;

    for (const [key,value] of ledger) {
      const source=plainObject(value);
      const updatedAt=parseTimestamp(source?.updatedAt);
      if (
        source
        && !ACTIVE_MEMORY_STATUSES.has(source.status)
        && updatedAt !== null
        && updatedAt <= currentTime-MEMORY_TERMINAL_RETENTION_MS
      ) ledger.delete(key);
    }

    if (ledger.size < MAX_MEMORY_LEDGER_ENTRIES) return true;

    const removable=[...ledger.entries()]
      .filter(([,value])=>plainObject(value) && !ACTIVE_MEMORY_STATUSES.has(value.status))
      .sort((a,b)=>{
        const left=parseTimestamp(a[1].updatedAt) ?? 0;
        const right=parseTimestamp(b[1].updatedAt) ?? 0;
        return left-right;
      });
    for (const [key] of removable) {
      if (ledger.size < MAX_MEMORY_LEDGER_ENTRIES) break;
      ledger.delete(key);
    }
    return ledger.size < MAX_MEMORY_LEDGER_ENTRIES;
  }

  async function claimMemory(input) {
    const currentTime=safeClock(now);
    const key=memoryKey(input.userId,input.dedupeKey);
    if (!key) return {allowed:false,reason:'persistence_error'};

    const existing=ledger.get(key);
    if (existing !== undefined && !plainObject(existing)) {
      return {allowed:false,reason:'persistence_error'};
    }

    if (existing) {
      const status=typeof existing.status === 'string' ? existing.status : '';
      if (!['claimed','sending','sent','retry_pending','unknown','terminal_failed'].includes(status)) {
        return {allowed:false,reason:'persistence_error'};
      }

      if (status === 'retry_pending') {
        const retryAt=parseTimestamp(existing.retryAt);
        if (retryAt === null) return {allowed:false,reason:'persistence_error'};
        if (retryAt > currentTime) return {allowed:false,reason:'retry_wait'};
      } else if (status === 'claimed') {
        const claimedAt=parseTimestamp(existing.claimedAt ?? existing.claimAt);
        if (claimedAt === null) return {allowed:false,reason:'persistence_error'};
        if (claimedAt > currentTime-CLAIM_STALE_MS) return {allowed:false,reason:'duplicate'};
      } else {
        return {allowed:false,reason:'duplicate'};
      }
    }

    if (!existing && input.cooldownSeconds > 0) {
      const cooldownMs=input.cooldownSeconds*1000;
      for (const item of ledger.values()) {
        const source=plainObject(item);
        if (!source) continue;
        if (
          positiveSafeInteger(source.userId) !== input.userId
          || positiveSafeInteger(source.fixtureId) !== input.fixtureId
          || source.eventType !== input.eventType
          || !['claimed','sending','sent','unknown','retry_pending'].includes(source.status)
        ) continue;
        const activityAt=parseTimestamp(source.sentAt ?? source.sendStartedAt ?? source.claimedAt ?? source.createdAt);
        if (activityAt === null) return {allowed:false,reason:'persistence_error'};
        if (activityAt > currentTime-cooldownMs) return {allowed:false,reason:'cooldown'};
      }
    }

    if (!existing && !pruneMemoryLedger(currentTime)) {
      return {allowed:false,reason:'persistence_error'};
    }

    const priorAttempts=existing ? positiveSafeInteger(existing.attempts) : 0;
    if (existing && !priorAttempts) return {allowed:false,reason:'persistence_error'};
    const attempts=priorAttempts+1;
    const claimAt=new Date(currentTime).toISOString();
    ledger.set(key,{
      userId:input.userId,
      fixtureId:input.fixtureId,
      eventType:input.eventType,
      category:input.category,
      dedupeKey:input.dedupeKey,
      status:'claimed',
      attempts,
      claimAt,
      claimedAt:claimAt,
      sentAt:existing?.sentAt || null,
      retryAt:null,
      lastError:'',
      createdAt:existing?.createdAt || claimAt,
      updatedAt:claimAt,
    });
    return {
      allowed:true,
      reason:existing
        ? existing.status === 'retry_pending' ? 'retry' : 'stale_claim_recovered'
        : 'created',
      claimAt,
      attempts,
    };
  }

  async function claim(input,cfg) {
    const mode=supabaseMode(hasSupabase,cfg);
    if (mode === 'memory') return claimMemory(input);
    if (mode !== 'persistent') return {allowed:false,reason:'persistence_error'};

    let raw;
    try {
      raw=await supaRpc(cfg,'claim_smart_notification_delivery',{
        p_telegram_id:input.userId,
        p_fixture_id:input.fixtureId,
        p_event_type:input.eventType,
        p_category:input.category,
        p_dedupe_key:input.dedupeKey,
        p_cooldown_seconds:input.cooldownSeconds,
      },5000);
    } catch {
      return {allowed:false,reason:'persistence_error'};
    }
    return normalizeClaimResult(raw);
  }

  async function beginSendMemory(input) {
    const key=memoryKey(input.userId,input.dedupeKey);
    const current=plainObject(ledger.get(key));
    const claimAt=canonicalTimestamp(input.claimAt);
    if (
      !current
      || current.status !== 'claimed'
      || !claimAt
      || canonicalTimestamp(current.claimAt) !== claimAt
    ) return {started:false,reason:'claim_lost'};

    const attempts=positiveSafeInteger(current.attempts);
    if (!attempts) return {started:false,reason:'persistence_error'};
    if (attempts > MAX_DELIVERY_ATTEMPTS) {
      const timestamp=new Date(safeClock(now)).toISOString();
      ledger.set(key,{
        ...current,
        status:'terminal_failed',
        lastError:'Maximum delivery attempts exceeded.',
        updatedAt:timestamp,
      });
      return {started:false,reason:'max_retries'};
    }

    const timestamp=new Date(safeClock(now)).toISOString();
    ledger.set(key,{
      ...current,
      status:'sending',
      sendStartedAt:timestamp,
      updatedAt:timestamp,
    });
    return {started:true,reason:'sending'};
  }

  async function beginSend(input,cfg) {
    const mode=supabaseMode(hasSupabase,cfg);
    if (mode === 'memory') return beginSendMemory(input);
    if (mode !== 'persistent') return {started:false,reason:'persistence_error'};

    try {
      const raw=await supaRpc(cfg,'begin_smart_notification_delivery_send',{
        p_telegram_id:input.userId,
        p_dedupe_key:input.dedupeKey,
        p_claimed_at:input.claimAt,
        p_max_attempts:MAX_DELIVERY_ATTEMPTS,
      },5000);
      return normalizeBeginResult(raw);
    } catch {
      return {started:false,reason:'persistence_error'};
    }
  }

  async function finalizeMemory(input) {
    const key=memoryKey(input.userId,input.dedupeKey);
    const current=plainObject(ledger.get(key));
    const claimAt=canonicalTimestamp(input.claimAt);
    if (
      !current
      || current.status !== 'sending'
      || !claimAt
      || canonicalTimestamp(current.claimAt) !== claimAt
      || !FINAL_STATUSES.has(input.status)
    ) return false;

    const currentTime=safeClock(now);
    const timestamp=new Date(currentTime).toISOString();
    const retryAfter=boundedSeconds(
      input.retryAfterSeconds,
      0,
      MAX_RETRY_AFTER_SECONDS,
      {allowZero:true},
    );
    if (retryAfter === null) return false;

    ledger.set(key,{
      ...current,
      status:input.status,
      sentAt:input.status === 'sent' ? timestamp : current.sentAt,
      retryAt:input.status === 'retry_pending' && retryAfter > 0
        ? new Date(currentTime+retryAfter*1000).toISOString()
        : null,
      lastError:cleanError(input.error,''),
      updatedAt:timestamp,
    });
    return true;
  }

  async function finalize(input,cfg) {
    if (!FINAL_STATUSES.has(input.status)) return false;
    const retryAfter=boundedSeconds(
      input.retryAfterSeconds,
      0,
      MAX_RETRY_AFTER_SECONDS,
      {allowZero:true},
    );
    if (retryAfter === null) return false;

    const mode=supabaseMode(hasSupabase,cfg);
    if (mode === 'memory') return finalizeMemory({...input,retryAfterSeconds:retryAfter});
    if (mode !== 'persistent') return false;

    try {
      const raw=await supaRpc(cfg,'finalize_smart_notification_delivery',{
        p_telegram_id:input.userId,
        p_dedupe_key:input.dedupeKey,
        p_claimed_at:input.claimAt,
        p_status:input.status,
        p_error:cleanError(input.error,''),
        p_retry_after_seconds:retryAfter,
      },5000);
      return normalizeFinalizeResult(raw);
    } catch {
      return false;
    }
  }

  async function deliverSmartNotification(input={},cfg) {
    const normalized=normalizeInput(input);
    if (!normalized) return {state:'invalid'};

    const {
      userId,
      fixtureId,
      eventType,
      category,
      text,
      dedupeKey,
      cooldownSeconds,
    }=normalized;

    const claimed=await claim({
      userId,
      fixtureId,
      eventType,
      category,
      dedupeKey,
      cooldownSeconds,
    },cfg);

    if (claimed.allowed !== true) {
      if (claimed.reason === 'persistence_error') {
        await observe(cfg,{
          severity:'error',
          code:'SMART_NOTIFICATION_CLAIM_UNAVAILABLE',
          message:'Smart notification was not sent because delivery ownership could not be established.',
          fixtureId,eventType,category,disposition:'persistence_error',
        });
        return {state:'persistence_ambiguous'};
      }
      const state=claimed.reason === 'cooldown'
        ? 'cooldown'
        : claimed.reason === 'retry_wait'
          ? 'retry_wait'
          : 'duplicate';
      await observe(cfg,{
        severity:'info',
        code:state === 'cooldown'
          ? 'SMART_NOTIFICATION_SUPPRESSED_COOLDOWN'
          : 'SMART_NOTIFICATION_SUPPRESSED_DEDUPE',
        message:`Smart notification suppressed: ${state}.`,
        fixtureId,eventType,category,disposition:state,
      });
      return {state};
    }

    const claimAt=canonicalTimestamp(claimed.claimAt);
    if (!claimAt) {
      await observe(cfg,{
        severity:'error',
        code:'SMART_NOTIFICATION_CLAIM_INVALID',
        message:'Smart notification claim returned an invalid ownership timestamp.',
        fixtureId,eventType,category,disposition:'persistence_error',
      });
      return {state:'persistence_ambiguous'};
    }

    const sendStarted=await beginSend({userId,dedupeKey,claimAt},cfg);
    if (sendStarted.started !== true) {
      await observe(cfg,{
        severity:'error',
        code:sendStarted.reason === 'max_retries'
          ? 'SMART_NOTIFICATION_MAX_RETRIES'
          : 'SMART_NOTIFICATION_SEND_NOT_STARTED',
        message:sendStarted.reason === 'max_retries'
          ? 'Smart notification reached the maximum delivery attempts and was not sent.'
          : 'Smart notification was not sent because delivery ownership could not be persisted.',
        fixtureId,eventType,category,
        disposition:cleanToken(sendStarted.reason,80,/^[a-z0-9][a-z0-9_-]{0,79}$/) || 'persistence_error',
      });
      return {
        state:sendStarted.reason === 'max_retries'
          ? 'failed'
          : 'persistence_ambiguous',
      };
    }

    let rawResult;
    try {
      rawResult=await sendTelegramMessage(userId,text,cfg);
    } catch (error) {
      rawResult={
        ok:false,
        outcome:'unknown',
        description:cleanError(error?.message,'Telegram sendMessage transport failed.'),
      };
    }
    const result=normalizeTelegramResult(rawResult);

    if (result.ok === true) {
      const finalized=await finalize({
        userId,dedupeKey,claimAt,status:'sent',
      },cfg);
      if (!finalized) {
        await observe(cfg,{
          severity:'error',
          code:'SMART_NOTIFICATION_SENT_PERSISTENCE_AMBIGUOUS',
          message:'Telegram accepted the notification but final persistence did not confirm ownership; automatic resend is suppressed.',
          fixtureId,eventType,category,disposition:'sent_unconfirmed',
        });
        return {state:'sent_unconfirmed',result};
      }
      await observe(cfg,{
        code:'SMART_NOTIFICATION_SENT',
        message:'Smart notification delivered.',
        fixtureId,eventType,category,disposition:'sent',
      });
      return {state:'sent',result};
    }

    if (result.outcome === 'unknown') {
      const finalized=await finalize({
        userId,dedupeKey,claimAt,status:'unknown',
        error:result.description || 'Telegram delivery outcome unknown.',
      },cfg);
      await observe(cfg,{
        severity:'warning',
        code:'SMART_NOTIFICATION_DELIVERY_UNKNOWN',
        message:'Smart notification delivery outcome is unknown; automatic retry is suppressed.',
        fixtureId,eventType,category,disposition:'unknown',
      });
      return {state:finalized ? 'unknown' : 'persistence_ambiguous',result};
    }

    const retryable=retryableTelegramFailure(result);
    const status=result.status ?? result.errorCode;
    const retryAfterSeconds=retryable
      ? (result.retryAfter > 0 ? result.retryAfter : 60)
      : 0;
    const finalStatus=retryable ? 'retry_pending' : 'terminal_failed';
    const finalized=await finalize({
      userId,dedupeKey,claimAt,
      status:finalStatus,
      error:result.description || 'Telegram delivery failed.',
      retryAfterSeconds,
    },cfg);

    if (!finalized) {
      await observe(cfg,{
        severity:'error',
        code:'SMART_NOTIFICATION_FAILURE_PERSISTENCE_AMBIGUOUS',
        message:'Telegram failure could not be finalized safely; automatic retry is suppressed until reconciliation.',
        fixtureId,eventType,category,disposition:'failure_unconfirmed',
      });
      return {state:'persistence_ambiguous',result};
    }

    await observe(cfg,{
      severity:'warning',
      code:retryable ? 'SMART_NOTIFICATION_RETRY_PENDING' : 'SMART_NOTIFICATION_TERMINAL_FAILURE',
      message:retryable
        ? 'Smart notification delivery failed and is eligible for bounded retry.'
        : 'Smart notification delivery failed with a terminal Telegram response.',
      fixtureId,eventType,category,
      disposition:retryable
        ? `retry_${status ?? 'telegram'}`
        : `terminal_${status ?? 'telegram'}`,
    });
    return {state:retryable ? 'retry_pending' : 'failed',result};
  }

  return Object.freeze({
    deliverSmartNotification,
  });
}
