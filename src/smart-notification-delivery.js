const CLAIM_STALE_MS = 20 * 60_000;
const MAX_DELIVERY_ATTEMPTS = 3;

function memoryKey(userId, dedupeKey) {
  return `${Number(userId)}:${String(dedupeKey || '')}`;
}

function retryableTelegramFailure(result = {}) {
  const status = Number(result?.status || result?.errorCode || 0);
  return status === 0 || status === 429 || status >= 500;
}

export function createSmartNotificationDeliveryService({
  memory,
  hasSupabase,
  supaRpc,
  sendTelegramMessage,
  recordOpsEvent,
} = {}) {
  const ledger = memory?.smartNotificationDeliveries instanceof Map
    ? memory.smartNotificationDeliveries
    : new Map();
  if (memory && !(memory.smartNotificationDeliveries instanceof Map)) {
    memory.smartNotificationDeliveries = ledger;
  }

  async function claimMemory({ userId, fixtureId, eventType, category, dedupeKey, cooldownSeconds }) {
    const now = Date.now();
    const key = memoryKey(userId, dedupeKey);
    const existing = ledger.get(key);

    if (existing) {
      const retryAt = Date.parse(existing.retryAt || '');
      const claimedAt = Date.parse(existing.claimedAt || '');
      const retryReady = existing.status === 'retry_pending' && (!Number.isFinite(retryAt) || retryAt <= now);
      const staleClaim = existing.status === 'claimed' && Number.isFinite(claimedAt) && claimedAt <= now - CLAIM_STALE_MS;
      if (!retryReady && !staleClaim) return { allowed: false, reason: existing.status === 'retry_pending' ? 'retry_wait' : 'duplicate' };
    }

    const cooldownMs = Math.max(0, Number(cooldownSeconds || 0)) * 1000;
    if (!existing && cooldownMs > 0) {
      for (const item of ledger.values()) {
        if (Number(item.userId) !== Number(userId) || Number(item.fixtureId) !== Number(fixtureId) || item.eventType !== eventType) continue;
        if (!['claimed', 'sent', 'unknown', 'retry_pending'].includes(item.status)) continue;
        const activityAt = Date.parse(item.sentAt || item.claimedAt || item.createdAt || '');
        if (Number.isFinite(activityAt) && activityAt > now - cooldownMs) return { allowed: false, reason: 'cooldown' };
      }
    }

    const claimAt = new Date(now).toISOString();
    ledger.set(key, {
      userId: Number(userId),
      fixtureId: Number(fixtureId),
      eventType,
      category,
      dedupeKey,
      status: 'claimed',
      attempts: Math.max(0, Number(existing?.attempts || 0)) + 1,
      claimAt,
      claimedAt: claimAt,
      sentAt: existing?.sentAt || null,
      retryAt: null,
      lastError: '',
      createdAt: existing?.createdAt || claimAt,
      updatedAt: claimAt,
    });
    return { allowed: true, reason: existing ? 'retry' : 'created', claimAt, attempts: Math.max(0, Number(existing?.attempts || 0)) + 1 };
  }

  async function claim(input, cfg) {
    if (!hasSupabase?.(cfg)) return claimMemory(input);
    const result = await supaRpc(cfg, 'claim_smart_notification_delivery', {
      p_telegram_id: Number(input.userId),
      p_fixture_id: Number(input.fixtureId),
      p_event_type: String(input.eventType || ''),
      p_category: String(input.category || ''),
      p_dedupe_key: String(input.dedupeKey || ''),
      p_cooldown_seconds: Math.max(0, Math.round(Number(input.cooldownSeconds || 0))),
    }, 5000);
    return {
      allowed: result?.allowed === true,
      reason: String(result?.reason || (result?.allowed ? 'claimed' : 'duplicate')),
      claimAt: result?.claimAt || result?.claim_at || null,
      attempts: Math.max(1, Number(result?.attempts || 1)),
    };
  }

  async function beginSendMemory(input) {
    const key = memoryKey(input.userId, input.dedupeKey);
    const current = ledger.get(key);
    if (!current || current.status !== 'claimed' || String(current.claimAt) !== String(input.claimAt)) {
      return { started: false, reason: 'claim_lost' };
    }
    if (Number(current.attempts || 0) > MAX_DELIVERY_ATTEMPTS) {
      const now = new Date().toISOString();
      ledger.set(key, { ...current, status:'terminal_failed', lastError:'Maximum delivery attempts exceeded.', updatedAt:now });
      return { started:false, reason:'max_retries' };
    }
    const now = new Date().toISOString();
    ledger.set(key, { ...current, status:'sending', sendStartedAt:now, updatedAt:now });
    return { started:true, reason:'sending' };
  }

  async function beginSend(input, cfg) {
    if (!hasSupabase?.(cfg)) return beginSendMemory(input);
    const result = await supaRpc(cfg, 'begin_smart_notification_delivery_send', {
      p_telegram_id: Number(input.userId),
      p_dedupe_key: String(input.dedupeKey || ''),
      p_claimed_at: input.claimAt,
      p_max_attempts: MAX_DELIVERY_ATTEMPTS,
    }, 5000);
    return {
      started: result?.started === true,
      reason: String(result?.reason || (result?.started ? 'sending' : 'claim_lost')),
    };
  }

  async function finalizeMemory(input) {
    const key = memoryKey(input.userId, input.dedupeKey);
    const current = ledger.get(key);
    if (!current || current.status !== 'sending' || String(current.claimAt) !== String(input.claimAt)) return false;
    const now = new Date().toISOString();
    ledger.set(key, {
      ...current,
      status: input.status,
      sentAt: input.status === 'sent' ? now : current.sentAt,
      retryAt: input.status === 'retry_pending' && Number(input.retryAfterSeconds || 0) > 0
        ? new Date(Date.now() + Number(input.retryAfterSeconds) * 1000).toISOString()
        : null,
      lastError: String(input.error || '').slice(0, 240),
      updatedAt: now,
    });
    return true;
  }

  async function finalize(input, cfg) {
    if (!hasSupabase?.(cfg)) return finalizeMemory(input);
    const result = await supaRpc(cfg, 'finalize_smart_notification_delivery', {
      p_telegram_id: Number(input.userId),
      p_dedupe_key: String(input.dedupeKey || ''),
      p_claimed_at: input.claimAt,
      p_status: String(input.status || ''),
      p_error: String(input.error || '').slice(0, 240),
      p_retry_after_seconds: Math.max(0, Math.round(Number(input.retryAfterSeconds || 0))),
    }, 5000);
    return result?.updated === true;
  }

  async function observe(cfg, payload) {
    await recordOpsEvent?.(cfg, {
      severity: payload.severity || 'info',
      source: 'smart_notifications',
      eventType: 'smart_notification_delivery',
      code: payload.code,
      message: payload.message,
      endpoint: 'cron:smart-notifications',
      meta: {
        fixtureId: Number(payload.fixtureId || 0),
        notificationType: String(payload.eventType || ''),
        category: String(payload.category || ''),
        disposition: String(payload.disposition || ''),
      },
    }).catch(() => {});
  }

  async function deliverSmartNotification({
    row,
    eventType,
    category,
    text,
    dedupeKey,
    cooldownSeconds = 0,
  } = {}, cfg) {
    const userId = Number(row?.telegram_id || 0);
    const fixtureId = Number(row?.fixture_id || 0);
    if (!userId || !fixtureId || !eventType || !dedupeKey || !text) {
      return { state: 'invalid' };
    }

    const claimed = await claim({ userId, fixtureId, eventType, category, dedupeKey, cooldownSeconds }, cfg);
    if (!claimed.allowed) {
      const state = claimed.reason === 'cooldown' ? 'cooldown' : claimed.reason === 'retry_wait' ? 'retry_wait' : 'duplicate';
      await observe(cfg, {
        severity: 'info',
        code: state === 'cooldown' ? 'SMART_NOTIFICATION_SUPPRESSED_COOLDOWN' : 'SMART_NOTIFICATION_SUPPRESSED_DEDUPE',
        message: `Smart notification suppressed: ${state}.`,
        fixtureId,
        eventType,
        category,
        disposition: state,
      });
      return { state };
    }

    let sendStarted;
    try {
      sendStarted = await beginSend({ userId, dedupeKey, claimAt: claimed.claimAt }, cfg);
    } catch (error) {
      sendStarted = { started:false, reason:'persistence_error', error };
    }
    if (!sendStarted?.started) {
      await observe(cfg, {
        severity: 'error',
        code: sendStarted?.reason === 'max_retries' ? 'SMART_NOTIFICATION_MAX_RETRIES' : 'SMART_NOTIFICATION_SEND_NOT_STARTED',
        message: sendStarted?.reason === 'max_retries'
          ? 'Smart notification reached the maximum delivery attempts and was not sent.'
          : 'Smart notification was not sent because delivery ownership could not be persisted.',
        fixtureId,
        eventType,
        category,
        disposition: String(sendStarted?.reason || 'persistence_error'),
      });
      return { state: sendStarted?.reason === 'max_retries' ? 'failed' : 'persistence_ambiguous' };
    }

    let result;
    try {
      result = await sendTelegramMessage(userId, text, cfg);
    } catch (error) {
      result = {
        ok: false,
        outcome: 'unknown',
        status: Number(error?.status || 0),
        errorCode: Number(error?.status || 0),
        retryAfter: Number(error?.retryAfter || 0),
        description: error?.message || String(error),
      };
    }

    if (result?.ok) {
      let finalized = false;
      try {
        finalized = await finalize({ userId, dedupeKey, claimAt: claimed.claimAt, status: 'sent' }, cfg);
      } catch {}
      if (!finalized) {
        await observe(cfg, {
          severity: 'error',
          code: 'SMART_NOTIFICATION_SENT_PERSISTENCE_AMBIGUOUS',
          message: 'Telegram accepted the notification but final persistence did not confirm ownership; automatic resend is suppressed.',
          fixtureId,
          eventType,
          category,
          disposition: 'sent_unconfirmed',
        });
        return { state: 'sent_unconfirmed', result };
      }
      await observe(cfg, {
        code: 'SMART_NOTIFICATION_SENT',
        message: 'Smart notification delivered.',
        fixtureId,
        eventType,
        category,
        disposition: 'sent',
      });
      return { state: 'sent', result };
    }

    if (result?.outcome === 'unknown') {
      let finalized = false;
      try {
        finalized = await finalize({
          userId,
          dedupeKey,
          claimAt: claimed.claimAt,
          status: 'unknown',
          error: result?.description || 'Telegram delivery outcome unknown.',
        }, cfg);
      } catch {}
      await observe(cfg, {
        severity: 'warning',
        code: 'SMART_NOTIFICATION_DELIVERY_UNKNOWN',
        message: 'Smart notification delivery outcome is unknown; automatic retry is suppressed.',
        fixtureId,
        eventType,
        category,
        disposition: 'unknown',
      });
      return { state: finalized ? 'unknown' : 'persistence_ambiguous', result };
    }

    const status = Number(result?.status || result?.errorCode || 0);
    const retryable = retryableTelegramFailure(result);
    const retryAfterSeconds = retryable ? Math.max(1, Number(result?.retryAfter || 60)) : 0;
    const finalStatus = retryable ? 'retry_pending' : 'terminal_failed';
    let finalized = false;
    try {
      finalized = await finalize({
        userId,
        dedupeKey,
        claimAt: claimed.claimAt,
        status: finalStatus,
        error: result?.description || 'Telegram delivery failed.',
        retryAfterSeconds,
      }, cfg);
    } catch {}
    if (!finalized) {
      await observe(cfg, {
        severity: 'error',
        code: 'SMART_NOTIFICATION_FAILURE_PERSISTENCE_AMBIGUOUS',
        message: 'Telegram failure could not be finalized safely; automatic retry is suppressed until reconciliation.',
        fixtureId,
        eventType,
        category,
        disposition: 'failure_unconfirmed',
      });
      return { state:'persistence_ambiguous', result };
    }

    await observe(cfg, {
      severity: 'warning',
      code: retryable ? 'SMART_NOTIFICATION_RETRY_PENDING' : 'SMART_NOTIFICATION_TERMINAL_FAILURE',
      message: retryable
        ? 'Smart notification delivery failed and is eligible for bounded retry.'
        : 'Smart notification delivery failed with a terminal Telegram response.',
      fixtureId,
      eventType,
      category,
      disposition: retryable ? `retry_${status || 'network'}` : `terminal_${status || 'unknown'}`,
    });
    return { state: retryable ? 'retry_pending' : 'failed', result };
  }

  return Object.freeze({
    deliverSmartNotification,
  });
}
