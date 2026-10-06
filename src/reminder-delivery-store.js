const REMINDER_CLAIM_STATE = 'delivery_claimed';
const REMINDER_SENDING_STATE = 'telegram_delivery_sending';
const REMINDER_UNKNOWN_STATE = 'telegram_delivery_unknown';
const MAX_TELEGRAM_RETRY_AFTER_SECONDS = 604800;
const MAX_TIMESTAMP_MS = 8.64e15;

export const REMINDER_DELIVERY_KINDS = Object.freeze({
  prematch: Object.freeze({
    claimColumn: 'prematch_claimed_at',
    doneColumn: 'notified_at',
    attemptsColumn: 'prematch_attempts',
  }),
  kickoff: Object.freeze({
    claimColumn: 'kickoff_claimed_at',
    doneColumn: 'kickoff_notified_at',
    attemptsColumn: 'kickoff_attempts',
  }),
  lineup: Object.freeze({
    claimColumn: 'lineup_claimed_at',
    doneColumn: 'lineup_notified_at',
    attemptsColumn: 'lineup_attempts',
  }),
  important_change: Object.freeze({
    claimColumn: 'important_change_claimed_at',
    doneColumn: 'important_change_notified_at',
    attemptsColumn: 'important_change_attempts',
  }),
});

function required(name,value) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
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

function strictSupabaseAvailable(hasSupabase,cfg) {
  try {
    return hasSupabase(cfg) === true;
  } catch {
    return false;
  }
}

function supabaseOrigin(cfg) {
  if (typeof cfg?.supabaseUrl !== 'string' || !cfg.supabaseUrl.trim()) return '';
  try {
    const url=new URL(cfg.supabaseUrl.trim());
    return ['http:','https:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}

function clockValue(now) {
  try {
    const value=now();
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= MAX_TIMESTAMP_MS
      ? value
      : null;
  } catch {
    return null;
  }
}

function isoNow(now) {
  const timestamp=clockValue(now);
  if (timestamp === null) throw new Error('Reminder delivery clock is invalid.');
  return new Date(timestamp).toISOString();
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validReminderIdentity(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const telegramId=positiveSafeInteger(row.telegram_id);
  const fixtureId=positiveSafeInteger(row.fixture_id);
  return telegramId && fixtureId ? {telegramId,fixtureId} : null;
}

function validClaimAt(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw=value.trim();
  const timestamp=Date.parse(raw);
  if (!Number.isFinite(timestamp)) return '';
  try {
    return new Date(timestamp).toISOString() === raw ? raw : '';
  } catch {
    return '';
  }
}

function responseStatus(response) {
  const status=integerCandidate(response?.status);
  return status !== null && status >= 100 && status <= 599 ? status : 0;
}

function requireConfirmedResponse(response,label) {
  if (response?.ok === true) return;
  throw new Error(`${label}: HTTP ${responseStatus(response) || 'unknown'}`);
}

export function reminderDeliveryKindConfig(kind) {
  if (typeof kind !== 'string') {
    throw new Error('Unsupported reminder delivery kind: unknown');
  }
  const normalized=kind.trim();
  const config = REMINDER_DELIVERY_KINDS[normalized];
  if (!config || normalized !== kind) {
    throw new Error(`Unsupported reminder delivery kind: ${normalized || 'unknown'}`);
  }
  return config;
}

export function createReminderDeliveryStore({
  hasSupabase,
  fetchWithTimeout,
  supaHeaders,
  recordOpsEvent,
  redactOpsString,
  now = Date.now,
}) {
  required('hasSupabase',hasSupabase);
  required('fetchWithTimeout',fetchWithTimeout);
  required('supaHeaders',supaHeaders);
  required('recordOpsEvent',recordOpsEvent);
  required('redactOpsString',redactOpsString);
  required('now',now);

  function requireIdentity(row) {
    const identity=validReminderIdentity(row);
    if (!identity) {
      const error=new Error('Reminder delivery identity is invalid.');
      error.code='REMINDER_DELIVERY_IDENTITY_INVALID';
      throw error;
    }
    return identity;
  }

  function requireOwnedClaimMutation(rows, action, {
    identity,
    claimColumn='',
    claimAt='',
    doneColumn='',
    requireDone=false,
  } = {}) {
    if (!Array.isArray(rows) || rows.length !== 1) {
      const error = new Error(`Reminder delivery claim was lost during ${action}.`);
      error.code = 'REMINDER_DELIVERY_CLAIM_LOST';
      error.claimLost = true;
      throw error;
    }

    const row=rows[0];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      const error = new Error(`Reminder delivery persistence response was malformed during ${action}.`);
      error.code='REMINDER_DELIVERY_PERSISTENCE_INVALID';
      throw error;
    }

    if (
      identity
      && (
        positiveSafeInteger(row.telegram_id) !== identity.telegramId
        || positiveSafeInteger(row.fixture_id) !== identity.fixtureId
      )
    ) {
      const error=new Error(`Reminder delivery identity mismatch during ${action}.`);
      error.code='REMINDER_DELIVERY_IDENTITY_MISMATCH';
      throw error;
    }

    if (claimColumn && claimAt && row[claimColumn] !== claimAt) {
      const error=new Error(`Reminder delivery claim ownership mismatch during ${action}.`);
      error.code='REMINDER_DELIVERY_CLAIM_MISMATCH';
      error.claimLost=true;
      throw error;
    }

    if (requireDone && (!doneColumn || parseTimestamp(row[doneColumn]) === null)) {
      const error=new Error(`Reminder delivery sent state was not confirmed during ${action}.`);
      error.code='REMINDER_DELIVERY_FINISH_UNCONFIRMED';
      throw error;
    }

    return row;
  }

  function reminderDeliveryStatus(row) {
    const source=row&&typeof row === 'object'&&!Array.isArray(row) ? row : {};
    if (parseTimestamp(source.kickoff_notified_at) !== null) return 'kickoff_sent';
    if (parseTimestamp(source.notified_at) !== null) return 'prematch_sent';
    if (parseTimestamp(source.important_change_notified_at) !== null) return 'important_change_sent';
    if (parseTimestamp(source.lineup_notified_at) !== null) return 'lineup_sent';
    if (source.delivery_last_error === REMINDER_UNKNOWN_STATE || source.delivery_last_error === REMINDER_SENDING_STATE) return 'delivery_unknown';
    if (typeof source.delivery_last_error === 'string' && source.delivery_last_error.trim()) return 'retry_pending';
    return 'scheduled';
  }

  async function clearStaleReminderClaims(cfg) {
    if (!strictSupabaseAvailable(hasSupabase,cfg)) {
      return { prematch:0, kickoff:0, lineup:0, important_change:0, failed:0 };
    }
    const origin=supabaseOrigin(cfg);
    if (!origin) throw new Error('Supabase reminder store URL is invalid.');
    const current=clockValue(now);
    if (current === null || current < 20*60_000) throw new Error('Reminder delivery clock is invalid.');
    const cutoff = new Date(current - 20 * 60_000).toISOString();

    const clearColumn = async column => {
      const url = new URL(`${origin}/rest/v1/match_reminders`);
      url.searchParams.set('enabled', 'eq.true');
      url.searchParams.set(column, `lt.${cutoff}`);
      url.searchParams.set('or', `(delivery_last_error.is.null,delivery_last_error.eq.${REMINDER_CLAIM_STATE})`);
      const r = await fetchWithTimeout(url, {
        method: 'PATCH',
        headers: supaHeaders(cfg, { Prefer: 'return=representation' }),
        body: JSON.stringify({ [column]: null }),
      }, 7000, 'Supabase reminder stale claim');
      requireConfirmedResponse(r,'Supabase reminder claims');
      const rows = await r.json().catch(() => null);
      if (!Array.isArray(rows)) throw new Error('Supabase reminder stale claim response is malformed.');
      return rows.length;
    };

    const reconcileSendingColumn = async ({ claimColumn, doneColumn }) => {
      const url = new URL(`${origin}/rest/v1/match_reminders`);
      url.searchParams.set('enabled', 'eq.true');
      url.searchParams.set(claimColumn, `lt.${cutoff}`);
      url.searchParams.set(doneColumn, 'is.null');
      url.searchParams.set('delivery_last_error', `eq.${REMINDER_SENDING_STATE}`);
      const r = await fetchWithTimeout(url, {
        method: 'PATCH',
        headers: supaHeaders(cfg, { Prefer: 'return=representation' }),
        body: JSON.stringify({
          delivery_last_error: REMINDER_UNKNOWN_STATE,
          delivery_last_attempt_at: isoNow(now),
          delivery_retry_after: null,
        }),
      }, 7000, 'Supabase reminder sending reconciliation');
      requireConfirmedResponse(r,'Supabase reminder sending reconciliation');
      const rows = await r.json().catch(() => null);
      if (!Array.isArray(rows)) throw new Error('Supabase reminder sending reconciliation response is malformed.');
      return rows.length;
    };

    const cleared = Object.fromEntries(Object.keys(REMINDER_DELIVERY_KINDS).map(kind => [kind, 0]));
    const reconciled = Object.fromEntries(Object.keys(REMINDER_DELIVERY_KINDS).map(kind => [kind, 0]));
    const failures = [];

    for (const [kind, config] of Object.entries(REMINDER_DELIVERY_KINDS)) {
      try {
        cleared[kind] = await clearColumn(config.claimColumn);
      } catch (error) {
        failures.push({ kind, phase:'clear', message: error?.message || String(error) });
      }
      try {
        reconciled[kind] = await reconcileSendingColumn(config);
      } catch (error) {
        failures.push({ kind, phase:'reconcile_sending', message: error?.message || String(error) });
      }
    }

    const prematch = nonNegativeInteger(cleared.prematch) ?? 0;
    const kickoff = nonNegativeInteger(cleared.kickoff) ?? 0;
    const lineup = nonNegativeInteger(cleared.lineup) ?? 0;
    const important_change = nonNegativeInteger(cleared.important_change) ?? 0;
    const total = prematch + kickoff + lineup + important_change;
    const reconciledCounts={
      prematch:nonNegativeInteger(reconciled.prematch) ?? 0,
      kickoff:nonNegativeInteger(reconciled.kickoff) ?? 0,
      lineup:nonNegativeInteger(reconciled.lineup) ?? 0,
      important_change:nonNegativeInteger(reconciled.important_change) ?? 0,
    };
    const reconciledTotal = Object.values(reconciledCounts).reduce((sum,value)=>sum+value,0);

    if (total > 0) {
      await recordOpsEvent(cfg, {
        severity:'warning',
        source:'reminders',
        eventType:'reminder_delivery',
        code:'REMINDER_STALE_CLAIMS',
        message:`Восстановлено зависших заявок на доставку уведомлений: ${total}.`,
        meta:{ prematch, kickoff, lineup, important_change },
      }).catch(() => {});
    }

    if (reconciledTotal > 0) {
      await recordOpsEvent(cfg, {
        severity:'warning',
        source:'reminders',
        eventType:'reminder_delivery',
        code:'REMINDER_STALE_SENDING_RECONCILED',
        message:`Неопределённые отправки переведены из sending в fail-closed unknown: ${reconciledTotal}.`,
        endpoint:'cron:reminders',
        meta:{total:reconciledTotal,...reconciledCounts},
      }).catch(() => {});
    }

    if (failures.length > 0) {
      await recordOpsEvent(cfg, {
        severity:'error',
        source:'reminders',
        eventType:'reminder_delivery',
        code:'REMINDER_STALE_CLAIM_CLEANUP_FAILED',
        message:`Не удалось очистить ${failures.length} типов зависших claim.`,
        endpoint:'cron:reminders',
        meta:{
          failed: failures.length,
          kinds: failures.map(item => item.kind),
        },
      }).catch(() => {});
    }

    return { prematch, kickoff, lineup, important_change, failed: failures.length };
  }

  async function claimReminderDelivery(row, kind, cfg) {
    const { claimColumn, doneColumn, attemptsColumn } = reminderDeliveryKindConfig(kind);
    const claimAt=isoNow(now);
    if (!strictSupabaseAvailable(hasSupabase,cfg)) return { claimed:true, claimAt };
    const identity=requireIdentity(row);

    const origin=supabaseOrigin(cfg);
    if (!origin) throw new Error('Supabase reminder store URL is invalid.');
    const attemptsRaw=row?.[attemptsColumn];
    const attempts=attemptsRaw === undefined || attemptsRaw === null || attemptsRaw === ''
      ? 0
      : nonNegativeInteger(attemptsRaw);
    if (attempts === null || attempts >= Number.MAX_SAFE_INTEGER) {
      const error=new Error('Reminder delivery attempt counter is invalid.');
      error.code='REMINDER_DELIVERY_ATTEMPTS_INVALID';
      throw error;
    }

    const url = new URL(`${origin}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${identity.telegramId}`);
    url.searchParams.set('fixture_id', `eq.${identity.fixtureId}`);
    url.searchParams.set('enabled', 'eq.true');
    url.searchParams.set(doneColumn, 'is.null');
    url.searchParams.set(claimColumn, 'is.null');

    const r = await fetchWithTimeout(url, {
      method:'PATCH',
      headers:supaHeaders(cfg, { Prefer:'return=representation' }),
      body:JSON.stringify({
        [claimColumn]:claimAt,
        [attemptsColumn]:attempts+1,
        delivery_last_attempt_at:claimAt,
        delivery_last_error:REMINDER_CLAIM_STATE,
      }),
    },7000,'Supabase reminder claim');

    requireConfirmedResponse(r,'Supabase reminder claim');
    const rows=await r.json().catch(()=>null);
    if (!Array.isArray(rows)) throw new Error('Supabase reminder claim response is malformed.');
    if (rows.length === 0) return {claimed:false,claimAt};
    requireOwnedClaimMutation(rows,'claim',{
      identity,
      claimColumn,
      claimAt,
    });
    return {claimed:true,claimAt};
  }

  async function markReminderDeliverySending(row, kind, claimAt, cfg) {
    const { claimColumn } = reminderDeliveryKindConfig(kind);
    if (!strictSupabaseAvailable(hasSupabase,cfg)) return;
    const identity=requireIdentity(row);
    const ownedClaimAt=validClaimAt(claimAt);
    if (!ownedClaimAt) throw new Error('Reminder delivery claim timestamp is invalid.');

    const origin=supabaseOrigin(cfg);
    if (!origin) throw new Error('Supabase reminder store URL is invalid.');
    const url = new URL(`${origin}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${identity.telegramId}`);
    url.searchParams.set('fixture_id', `eq.${identity.fixtureId}`);
    url.searchParams.set(claimColumn, `eq.${ownedClaimAt}`);

    const r = await fetchWithTimeout(url, {
      method:'PATCH',
      headers:supaHeaders(cfg, { Prefer:'return=representation' }),
      body:JSON.stringify({
        delivery_last_error:REMINDER_SENDING_STATE,
        delivery_last_attempt_at:isoNow(now),
        delivery_retry_after:null,
      }),
    },7000,'Supabase reminder sending state');

    requireConfirmedResponse(r,'Supabase reminder sending state');
    const rows=await r.json().catch(()=>null);
    requireOwnedClaimMutation(rows,'sending state',{
      identity,
      claimColumn,
      claimAt:ownedClaimAt,
    });
  }

  async function holdReminderDeliveryUnknown(row, kind, claimAt, cfg) {
    const { claimColumn } = reminderDeliveryKindConfig(kind);
    if (!strictSupabaseAvailable(hasSupabase,cfg)) return;
    const identity=requireIdentity(row);
    const ownedClaimAt=validClaimAt(claimAt);
    if (!ownedClaimAt) throw new Error('Reminder delivery claim timestamp is invalid.');

    const origin=supabaseOrigin(cfg);
    if (!origin) throw new Error('Supabase reminder store URL is invalid.');
    const url = new URL(`${origin}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${identity.telegramId}`);
    url.searchParams.set('fixture_id', `eq.${identity.fixtureId}`);
    url.searchParams.set(claimColumn, `eq.${ownedClaimAt}`);

    const r = await fetchWithTimeout(url, {
      method:'PATCH',
      headers:supaHeaders(cfg, { Prefer:'return=representation' }),
      body:JSON.stringify({
        delivery_last_error:REMINDER_UNKNOWN_STATE,
        delivery_last_attempt_at:isoNow(now),
        delivery_retry_after:null,
      }),
    },7000,'Supabase reminder unknown hold');

    requireConfirmedResponse(r,'Supabase reminder unknown hold');
    const rows=await r.json().catch(()=>null);
    requireOwnedClaimMutation(rows,'unknown hold',{
      identity,
      claimColumn,
      claimAt:ownedClaimAt,
    });
  }

  async function readReminderDeliveryState(row, kind, cfg) {
    const { claimColumn, doneColumn } = reminderDeliveryKindConfig(kind);
    if (!strictSupabaseAvailable(hasSupabase,cfg)) return null;
    const identity=requireIdentity(row);

    const origin=supabaseOrigin(cfg);
    if (!origin) throw new Error('Supabase reminder store URL is invalid.');
    const url = new URL(`${origin}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${identity.telegramId}`);
    url.searchParams.set('fixture_id', `eq.${identity.fixtureId}`);
    url.searchParams.set('select', `telegram_id,fixture_id,${claimColumn},${doneColumn},delivery_last_error,delivery_last_attempt_at,delivery_last_success_at`);
    url.searchParams.set('limit', '2');

    const r = await fetchWithTimeout(url, {
      method:'GET',
      headers:supaHeaders(cfg),
    },7000,'Supabase reminder delivery reconciliation read');
    requireConfirmedResponse(r,'Supabase reminder delivery reconciliation read');
    const rows=await r.json().catch(()=>null);
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const current=rows[0];
    if (
      !current
      || typeof current !== 'object'
      || Array.isArray(current)
      || positiveSafeInteger(current.telegram_id) !== identity.telegramId
      || positiveSafeInteger(current.fixture_id) !== identity.fixtureId
    ) return null;
    return current;
  }

  async function finishReminderDelivery(row, kind, claimAt, cfg) {
    const { claimColumn, doneColumn } = reminderDeliveryKindConfig(kind);
    const doneAt=isoNow(now);
    if (!strictSupabaseAvailable(hasSupabase,cfg)) return { finalized:true, reconciled:false, doneAt };
    const identity=requireIdentity(row);
    const ownedClaimAt=validClaimAt(claimAt);
    if (!ownedClaimAt) throw new Error('Reminder delivery claim timestamp is invalid.');

    const origin=supabaseOrigin(cfg);
    if (!origin) throw new Error('Supabase reminder store URL is invalid.');
    const kickoff = kind === 'kickoff';

    const confirmCommittedFinish = async () => {
      const current = await readReminderDeliveryState(row, kind, cfg);
      if (current && parseTimestamp(current[doneColumn]) !== null) {
        return {
          finalized:true,
          reconciled:true,
          doneAt:current[doneColumn],
        };
      }
      return null;
    };

    const url = new URL(`${origin}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${identity.telegramId}`);
    url.searchParams.set('fixture_id', `eq.${identity.fixtureId}`);
    url.searchParams.set(claimColumn, `eq.${ownedClaimAt}`);

    const patch = {
      [doneColumn]:doneAt,
      [claimColumn]:null,
      delivery_last_success_at:doneAt,
      delivery_last_error:null,
      delivery_retry_after:null,
    };

    if (kickoff && parseTimestamp(row?.notified_at) === null) patch.notified_at=doneAt;

    let r;
    try {
      r = await fetchWithTimeout(url, {
        method:'PATCH',
        headers:supaHeaders(cfg, { Prefer:'return=representation' }),
        body:JSON.stringify(patch),
      },7000,'Supabase reminder finish');
    } catch (error) {
      const reconciled = await confirmCommittedFinish().catch(() => null);
      if (reconciled) return reconciled;
      throw error;
    }

    if (r?.ok !== true) {
      const reconciled = await confirmCommittedFinish().catch(() => null);
      if (reconciled) return reconciled;
      throw new Error(`Supabase reminder finish: HTTP ${responseStatus(r) || 'unknown'}`);
    }

    const rows = await r.json().catch(() => null);
    if (Array.isArray(rows) && rows.length === 1) {
      const confirmed=requireOwnedClaimMutation(rows,'finish',{
        identity,
        doneColumn,
        requireDone:true,
      });
      return {
        finalized:true,
        reconciled:false,
        doneAt:confirmed[doneColumn],
      };
    }

    const reconciled = await confirmCommittedFinish().catch(() => null);
    if (reconciled) return reconciled;
    requireOwnedClaimMutation(rows,'finish',{identity,doneColumn,requireDone:true});
  }

  async function releaseReminderClaim(row, kind, claimAt, errorMessage, cfg, options = {}) {
    const { claimColumn } = reminderDeliveryKindConfig(kind);
    if (!strictSupabaseAvailable(hasSupabase,cfg)) return;
    const identity=requireIdentity(row);
    const ownedClaimAt=validClaimAt(claimAt);
    if (!ownedClaimAt) throw new Error('Reminder delivery claim timestamp is invalid.');

    const origin=supabaseOrigin(cfg);
    if (!origin) throw new Error('Supabase reminder store URL is invalid.');
    const optionSource=options&&typeof options === 'object'&&!Array.isArray(options) ? options : {};
    const retrySeconds=Math.min(
      MAX_TELEGRAM_RETRY_AFTER_SECONDS,
      positiveSafeInteger(optionSource.retryAfter),
    );
    const current=clockValue(now);
    if (current === null || current > MAX_TIMESTAMP_MS-retrySeconds*1000) {
      throw new Error('Reminder delivery retry clock is invalid.');
    }

    const url = new URL(`${origin}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${identity.telegramId}`);
    url.searchParams.set('fixture_id', `eq.${identity.fixtureId}`);
    url.searchParams.set(claimColumn, `eq.${ownedClaimAt}`);

    const patch = {
      [claimColumn]:null,
      delivery_last_error:redactOpsString(
        typeof errorMessage === 'string' && errorMessage.trim()
          ? errorMessage
          : 'Telegram delivery failed.',
        240,
      ),
      delivery_last_attempt_at:new Date(current).toISOString(),
      delivery_retry_after:retrySeconds > 0
        ? new Date(current + retrySeconds*1000).toISOString()
        : null,
    };

    if (optionSource.disable === true) {
      patch.enabled=false;
      patch.delivery_disabled_reason=redactOpsString(
        typeof optionSource.disableReason === 'string' && optionSource.disableReason.trim()
          ? optionSource.disableReason
          : 'telegram_forbidden',
        80,
      );
    }

    const r = await fetchWithTimeout(url, {
      method:'PATCH',
      headers:supaHeaders(cfg, { Prefer:'return=representation' }),
      body:JSON.stringify(patch),
    },7000,'Supabase reminder release');
    requireConfirmedResponse(r,'Supabase reminder release');
    const rows=await r.json().catch(()=>null);
    requireOwnedClaimMutation(rows,'release',{identity});
  }

  return Object.freeze({
    reminderDeliveryStatus,
    clearStaleReminderClaims,
    claimReminderDelivery,
    markReminderDeliverySending,
    holdReminderDeliveryUnknown,
    readReminderDeliveryState,
    finishReminderDelivery,
    releaseReminderClaim,
  });
}
