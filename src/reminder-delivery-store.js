const REMINDER_CLAIM_STATE = 'delivery_claimed';
const REMINDER_SENDING_STATE = 'telegram_delivery_sending';
const REMINDER_UNKNOWN_STATE = 'telegram_delivery_unknown';

export function createReminderDeliveryStore({
  hasSupabase,
  fetchWithTimeout,
  supaHeaders,
  recordOpsEvent,
  redactOpsString,
}) {
  function reminderDeliveryStatus(row) {
    if (row?.kickoff_notified_at) return 'kickoff_sent';
    if (row?.notified_at) return 'prematch_sent';
    if (row?.delivery_last_error === REMINDER_UNKNOWN_STATE || row?.delivery_last_error === REMINDER_SENDING_STATE) return 'delivery_unknown';
    if (row?.delivery_last_error) return 'retry_pending';
    return 'scheduled';
  }

  async function clearStaleReminderClaims(cfg) {
    if (!hasSupabase(cfg)) return { prematch: 0, kickoff: 0, failed: 0 };
    const cutoff = new Date(Date.now() - 20 * 60_000).toISOString();

    const clearColumn = async column => {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
      url.searchParams.set('enabled', 'eq.true');
      url.searchParams.set(column, `lt.${cutoff}`);
      url.searchParams.set('or', `(delivery_last_error.is.null,delivery_last_error.eq.${REMINDER_CLAIM_STATE})`);
      const r = await fetchWithTimeout(url, {
        method: 'PATCH',
        headers: supaHeaders(cfg, { Prefer: 'return=representation' }),
        body: JSON.stringify({ [column]: null }),
      }, 7000, 'Supabase reminder stale claim');
      if (!r.ok) throw new Error(`Supabase reminder claims: HTTP ${r.status}`);
      const rows = await r.json().catch(() => []);
      return Array.isArray(rows) ? rows.length : 0;
    };

    let prematch = 0;
    let kickoff = 0;
    const failures = [];

    try {
      prematch = await clearColumn('prematch_claimed_at');
    } catch (error) {
      failures.push({ kind: 'prematch', message: error?.message || String(error) });
    }

    try {
      kickoff = await clearColumn('kickoff_claimed_at');
    } catch (error) {
      failures.push({ kind: 'kickoff', message: error?.message || String(error) });
    }

    const total = prematch + kickoff;

    if (total > 0) {
      await recordOpsEvent(cfg, {
        severity: 'warning',
        source: 'reminders',
        eventType: 'reminder_delivery',
        code: 'REMINDER_STALE_CLAIMS',
        message: `Восстановлено зависших заявок на доставку уведомлений: ${total}.`,
        meta: { prematch, kickoff },
      }).catch(() => {});
    }

    if (failures.length > 0) {
      await recordOpsEvent(cfg, {
        severity: 'error',
        source: 'reminders',
        eventType: 'reminder_delivery',
        code: 'REMINDER_STALE_CLAIM_CLEANUP_FAILED',
        message: `Не удалось очистить ${failures.length} типов зависших claim.`,
        endpoint: 'cron:reminders',
        meta: {
          failed: failures.length,
          kinds: failures.map(item => item.kind),
        },
      }).catch(() => {});
    }

    return { prematch, kickoff, failed: failures.length };
  }

  async function claimReminderDelivery(row, kind, cfg) {
    if (!hasSupabase(cfg)) return { claimed: true, claimAt: new Date().toISOString() };

    const kickoff = kind === 'kickoff';
    const claimColumn = kickoff ? 'kickoff_claimed_at' : 'prematch_claimed_at';
    const doneColumn = kickoff ? 'kickoff_notified_at' : 'notified_at';
    const attemptsColumn = kickoff ? 'kickoff_attempts' : 'prematch_attempts';
    const claimAt = new Date().toISOString();

    const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
    url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
    url.searchParams.set('enabled', 'eq.true');
    url.searchParams.set(doneColumn, 'is.null');
    url.searchParams.set(claimColumn, 'is.null');

    const r = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        [claimColumn]: claimAt,
        [attemptsColumn]: Math.max(0, Number(row?.[attemptsColumn] || 0)) + 1,
        delivery_last_attempt_at: claimAt,
        delivery_last_error: REMINDER_CLAIM_STATE,
      }),
    }, 7000, 'Supabase reminder claim');

    if (!r.ok) throw new Error(`Supabase reminder claim: HTTP ${r.status}`);
    const rows = await r.json().catch(() => []);
    return { claimed: Array.isArray(rows) && rows.length === 1, claimAt };
  }

  async function markReminderDeliverySending(row, kind, claimAt, cfg) {
    if (!hasSupabase(cfg)) return;
    const claimColumn = kind === 'kickoff' ? 'kickoff_claimed_at' : 'prematch_claimed_at';

    const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
    url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
    url.searchParams.set(claimColumn, `eq.${claimAt}`);

    const r = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        delivery_last_error: REMINDER_SENDING_STATE,
        delivery_last_attempt_at: new Date().toISOString(),
        delivery_retry_after: null,
      }),
    }, 7000, 'Supabase reminder sending state');

    if (!r.ok) throw new Error(`Supabase reminder sending state: HTTP ${r.status}`);
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error('Reminder delivery claim was lost before Telegram send.');
    }
  }

  async function holdReminderDeliveryUnknown(row, kind, claimAt, cfg) {
    if (!hasSupabase(cfg)) return;
    const claimColumn = kind === 'kickoff' ? 'kickoff_claimed_at' : 'prematch_claimed_at';

    const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
    url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
    url.searchParams.set(claimColumn, `eq.${claimAt}`);

    const r = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        delivery_last_error: REMINDER_UNKNOWN_STATE,
        delivery_last_attempt_at: new Date().toISOString(),
        delivery_retry_after: null,
      }),
    }, 7000, 'Supabase reminder unknown hold');

    if (!r.ok) throw new Error(`Supabase reminder unknown hold: HTTP ${r.status}`);
  }

  async function finishReminderDelivery(row, kind, claimAt, cfg) {
    if (!hasSupabase(cfg)) return;
    const kickoff = kind === 'kickoff';
    const claimColumn = kickoff ? 'kickoff_claimed_at' : 'prematch_claimed_at';
    const doneColumn = kickoff ? 'kickoff_notified_at' : 'notified_at';
    const doneAt = new Date().toISOString();

    const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
    url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
    url.searchParams.set(claimColumn, `eq.${claimAt}`);

    const patch = {
      [doneColumn]: doneAt,
      [claimColumn]: null,
      delivery_last_success_at: doneAt,
      delivery_last_error: null,
      delivery_retry_after: null,
    };

    if (kickoff && !row.notified_at) patch.notified_at = doneAt;

    const r = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    }, 7000, 'Supabase reminder finish');
    if (!r.ok) throw new Error(`Supabase reminder finish: HTTP ${r.status}`);
  }

  async function releaseReminderClaim(row, kind, claimAt, errorMessage, cfg, options = {}) {
    if (!hasSupabase(cfg)) return;
    const claimColumn = kind === 'kickoff' ? 'kickoff_claimed_at' : 'prematch_claimed_at';

    const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
    url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
    url.searchParams.set(claimColumn, `eq.${claimAt}`);

    const patch = {
      [claimColumn]: null,
      delivery_last_error: redactOpsString(errorMessage || 'Telegram delivery failed.', 240),
      delivery_last_attempt_at: new Date().toISOString(),
      delivery_retry_after: Number(options.retryAfter || 0) > 0
        ? new Date(Date.now() + Number(options.retryAfter) * 1000).toISOString()
        : null,
    };

    if (options.disable) {
      patch.enabled = false;
      patch.delivery_disabled_reason = redactOpsString(options.disableReason || 'telegram_forbidden', 80);
    }

    const r = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    }, 7000, 'Supabase reminder release');
    if (!r.ok) throw new Error(`Supabase reminder release: HTTP ${r.status}`);
  }

  return {
    reminderDeliveryStatus,
    clearStaleReminderClaims,
    claimReminderDelivery,
    markReminderDeliverySending,
    holdReminderDeliveryUnknown,
    finishReminderDelivery,
    releaseReminderClaim,
  };
}
