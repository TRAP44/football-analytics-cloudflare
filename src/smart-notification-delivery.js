const CLAIM_STALE_MS = 20 * 60_000;
const MAX_DELIVERY_ATTEMPTS = 4;

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
  supaSelectOne,
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

    let retryReady = false;
    let staleClaim = false;
    if (existing) {
      const retryAt = Date.parse(existing.retryAt || '');
      const claimedAt = Date.parse(existing.claimedAt || '');
      retryReady = existing.status === 'retry_pending' && (!Number.isFinite(retryAt) || retryAt <= now);
      staleClaim = existing.status === 'claimed' && Number.isFinite(claimedAt) && claimedAt <= now - CLAIM_STALE_MS;
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
    return {
      allowed: true,
      reason: staleClaim ? 'stale_claim_recovered' : retryReady ? 'retry' : 'created',
      claimAt,
      attempts: Math.max(0, Number(existing?.attempts || 0)) + 1,
    };
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
    const claimed = {
      allowed: result?.allowed === true,
      reason: String(result?.reason || (result?.allowed ? 'claimed' : 'duplicate')),
      claimAt: result?.claimAt || result?.claim_at || null,
      attempts: Number(result?.attempts || 0) || 0,
    };
    if (claimed.allowed && typeof supaSelectOne === 'function') {
      const row = await supaSelectOne(cfg, 'smart_notification_deliveries', {
        telegram_id: `eq.${Number(input.userId)}`,
        dedupe_key: `eq.${String(input.dedupeKey || '')}`,
      });
      claimed.attempts = Math.max(claimed.attempts, Number(row?.attempts || 0));
    }
    return claimed;
  }

  async function finalizeMemory(input) {
    const key = memoryKey(input.userId, input.dedupeKey);
    const current = ledger.get(key);
    if (!current || String(current.claimAt) !== String(input.claimAt)) return false;
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
        attempts: Number(payload.attempts || 0) || null,
      },
    }).catch(() => {});
  }

  async function finalizeOwned(input, cfg, context = {}) {
    try {
      const updated = await finalize(input, cfg);
      if (updated === true) return { updated: true };
      await observe(cfg, {
        severity: 'error',
        code: 'SMART_NOTIFICATION_FINALIZE_CLAIM_LOST',
        message: 'Smart notification finalization lost claim ownership; automatic resend is suppressed.',
        fixtureId: context.fixtureId,
        eventType: context.eventType,
        category: context.category,
        disposition: context.disposition || 'finalize_claim_lost',
        attempts: context.attempts,
      });
      return { updated: false, claimLost: true };
    } catch (error) {
      await observe(cfg, {
        severity: 'error',
        code: 'SMART_NOTIFICATION_FINALIZE_FAILED',
        message: error?.message || 'Smart notification finalization failed; automatic resend is suppressed.',
        fixtureId: context.fixtureId,
        eventType: context.eventType,
        category: context.category,
        disposition: context.disposition || 'finalize_failed',
        attempts: context.attempts,
      });
      return { updated: false, error };
    }
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
        attempts: claimed.attempts,
      });
      return { state };
    }

    const finalizeContext = {
      fixtureId,
      eventType,
      category,
      attempts: claimed.attempts,
    };

    if (claimed.reason === 'stale_claim_recovered') {
      const quarantined = await finalizeOwned({
        userId,
        dedupeKey,
        claimAt: claimed.claimAt,
        status: 'unknown',
        error: 'Recovered stale claim quarantined to prevent duplicate delivery.',
      }, cfg, { ...finalizeContext, disposition: 'stale_claim_quarantine' });
      await observe(cfg, {
        severity: 'warning',
        code: 'SMART_NOTIFICATION_STALE_CLAIM_QUARANTINED',
        message: 'Recovered stale smart-notification claim was quarantined before send to prevent a duplicate.',
        fixtureId,
        eventType,
        category,
        disposition: 'stale_claim_quarantined',
        attempts: claimed.attempts,
      });
      return { state: 'unknown', quarantined: true, persistenceFailed: quarantined.updated !== true };
    }

    if (Number(claimed.attempts || 0) > MAX_DELIVERY_ATTEMPTS) {
      const capped = await finalizeOwned({
        userId,
        dedupeKey,
        claimAt: claimed.claimAt,
        status: 'terminal_failed',
        error: `Maximum delivery attempts exceeded (${MAX_DELIVERY_ATTEMPTS}).`,
      }, cfg, { ...finalizeContext, disposition: 'max_attempts' });
      await observe(cfg, {
        severity: 'warning',
        code: 'SMART_NOTIFICATION_MAX_ATTEMPTS',
        message: `Smart notification stopped after ${MAX_DELIVERY_ATTEMPTS} delivery attempts.`,
        fixtureId,
        eventType,
        category,
        disposition: 'max_attempts',
        attempts: claimed.attempts,
      });
      return { state: 'failed', maxAttempts: true, persistenceFailed: capped.updated !== true };
    }

    let result;
    try {
      result = await sendTelegramMessage(userId, text, cfg);
    } catch (error) {
      result = {
        ok: false,
        outcome: 'confirmed_failure',
        status: Number(error?.status || 0),
        errorCode: Number(error?.status || 0),
        retryAfter: Number(error?.retryAfter || 0),
        description: error?.message || String(error),
      };
    }

    if (result?.ok) {
      const finalized = await finalizeOwned(
        { userId, dedupeKey, claimAt: claimed.claimAt, status: 'sent' },
        cfg,
        { ...finalizeContext, disposition: 'sent_finalize' },
      );
      if (finalized.updated !== true) {
        return { state: 'unknown', result, persistenceFailed: true };
      }
      await observe(cfg, {
        code: 'SMART_NOTIFICATION_SENT',
        message: 'Smart notification delivered.',
        fixtureId,
        eventType,
        category,
        disposition: 'sent',
        attempts: claimed.attempts,
      });
      return { state: 'sent', result };
    }

    if (result?.outcome === 'unknown') {
      const finalized = await finalizeOwned({
        userId,
        dedupeKey,
        claimAt: claimed.claimAt,
        status: 'unknown',
        error: result?.description || 'Telegram delivery outcome unknown.',
      }, cfg, { ...finalizeContext, disposition: 'unknown_finalize' });
      await observe(cfg, {
        severity: 'warning',
        code: 'SMART_NOTIFICATION_DELIVERY_UNKNOWN',
        message: 'Smart notification delivery outcome is unknown; automatic retry is suppressed.',
        fixtureId,
        eventType,
        category,
        disposition: 'unknown',
        attempts: claimed.attempts,
      });
      return { state: 'unknown', result, persistenceFailed: finalized.updated !== true };
    }

    const status = Number(result?.status || result?.errorCode || 0);
    const retryable = retryableTelegramFailure(result);
    const retryAfterSeconds = retryable ? Math.max(1, Number(result?.retryAfter || 60)) : 0;
    const finalStatus = retryable ? 'retry_pending' : 'terminal_failed';
    const finalized = await finalizeOwned({
      userId,
      dedupeKey,
      claimAt: claimed.claimAt,
      status: finalStatus,
      error: result?.description || 'Telegram delivery failed.',
      retryAfterSeconds,
    }, cfg, { ...finalizeContext, disposition: `${finalStatus}_finalize` });
    if (finalized.updated !== true) {
      return { state: 'failed', result, persistenceFailed: true };
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
      attempts: claimed.attempts,
    });
    return { state: retryable ? 'retry_pending' : 'failed', result };
  }

  return Object.freeze({
    deliverSmartNotification,
  });
}
