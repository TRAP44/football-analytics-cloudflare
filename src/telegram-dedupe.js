import { primaryTelegramUpdateDedupeKey } from './telegram-primary-identity.js';

const TELEGRAM_BURST_POLICIES = Object.freeze({
  message: { limit: 10, windowMs: 10000, label: 'message' },
  callback: { limit: 16, windowMs: 10000, label: 'callback' },
  refresh: { limit: 4, windowMs: 30000, label: 'refresh' },
});

const TELEGRAM_DEDUPE_RISK = Object.freeze({
  READ_ONLY: 'read_only',
  IDEMPOTENT_MUTATION: 'idempotent_mutation',
  EXTERNAL_SIDE_EFFECT: 'external_side_effect',
  BILLING: 'billing',
});

const LOCAL_DEDUPE_TTL_MS = 10 * 60 * 1000;
const MAX_DEDUPE_KEY_LENGTH = 240;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^-?\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveIdentifier(value) {
  const number=integerCandidate(value);
  return number !== null && number > 0 ? number : 0;
}

function nonNegativeInteger(value, fallback = 0) {
  const number=integerCandidate(value);
  return number !== null && number >= 0 ? number : fallback;
}

function boundedInteger(value, fallback, min, max) {
  const number=integerCandidate(value);
  return number !== null && number >= min && number <= max ? number : fallback;
}

function validDedupeKey(value) {
  if (typeof value !== 'string') return '';
  const key=value.trim();
  if (
    !key
    || key.length > MAX_DEDUPE_KEY_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(key)
  ) return '';
  return key;
}

function validTimestamp(value) {
  const number=integerCandidate(value);
  return number !== null && number >= 0 ? number : 0;
}

function telegramUpdateDedupeRisk(update = {}) {
  if (
    update?.pre_checkout_query
    || update?.subscription
    || update?.message?.successful_payment
    || update?.message?.refunded_payment
  ) {
    return { kind:TELEGRAM_DEDUPE_RISK.BILLING, highRisk:true };
  }

  if (update?.callback_query) {
    const data=textValue(update?.callback_query?.data);
    if (
      /^(?:digest:(?:on|off)|favorite:toggle:\d+:\d+|postmatch:return:(?:on|off))$/.test(data)
    ) {
      return { kind:TELEGRAM_DEDUPE_RISK.IDEMPOTENT_MUTATION, highRisk:true };
    }
    return { kind:TELEGRAM_DEDUPE_RISK.EXTERNAL_SIDE_EFFECT, highRisk:true };
  }

  const text=textValue(update?.message?.text);
  if (
    /^\/(?:start|digest|digest_off)(?:@\w+)?(?:\s|$)/i.test(text)
  ) {
    return { kind:TELEGRAM_DEDUPE_RISK.IDEMPOTENT_MUTATION, highRisk:true };
  }

  return { kind:TELEGRAM_DEDUPE_RISK.READ_ONLY, highRisk:false };
}

export function createTelegramDedupeRuntime({
  memory,
  pruneMemoryState,
  bumpTelemetry,
  hasSupabase,
  supaRpc,
  redactOpsString,
}) {
  const runtimeMemory=plainObject(memory) || {};
  if (!(runtimeMemory.telegramUpdateDedupe instanceof Map)) runtimeMemory.telegramUpdateDedupe=new Map();
  if (!(runtimeMemory.telegramBurst instanceof Map)) runtimeMemory.telegramBurst=new Map();

  const noteTelemetry = typeof bumpTelemetry === 'function' ? bumpTelemetry : () => {};
  const pruneMemory = typeof pruneMemoryState === 'function' ? pruneMemoryState : () => {};
  const rpc = typeof supaRpc === 'function'
    ? supaRpc
    : async () => { throw new Error('Supabase RPC unavailable'); };
  const redact = typeof redactOpsString === 'function'
    ? redactOpsString
    : (value, limit = 160) => String(value ?? '').slice(0, limit);

  function telegramUpdateDedupeKey(update = {}, cfg = {}) {
    const source=plainObject(cfg) || {};
    return validDedupeKey(primaryTelegramUpdateDedupeKey(source.botToken, update));
  }

  function claimTelegramUpdate(update = {}, cfg = {}) {
    const key=telegramUpdateDedupeKey(update,cfg);
    if (!key) return {key:'',duplicate:false};
    const now=Date.now();
    const prior=runtimeMemory.telegramUpdateDedupe.get(key);
    const priorAt=validTimestamp(prior?.at);
    if (priorAt && now-priorAt<LOCAL_DEDUPE_TTL_MS) {
      noteTelemetry('telegramDuplicateUpdates');
      return {key,duplicate:true};
    }
    runtimeMemory.telegramUpdateDedupe.set(key,{at:now,state:'processing'});
    if (runtimeMemory.telegramUpdateDedupe.size>4000) pruneMemory();
    return {key,duplicate:false};
  }

  function completeTelegramUpdate(key='') {
    const normalizedKey=validDedupeKey(key);
    if (!normalizedKey) return;
    const current=runtimeMemory.telegramUpdateDedupe.get(normalizedKey);
    if (!current) return;
    runtimeMemory.telegramUpdateDedupe.set(normalizedKey,{
      at:Date.now(),
      state:'done',
      startedAt:validTimestamp(current?.at) || null,
    });
  }

  function releaseTelegramUpdate(key='') {
    const normalizedKey=validDedupeKey(key);
    if (normalizedKey) runtimeMemory.telegramUpdateDedupe.delete(normalizedKey);
  }

  function degradedTelegramDedupeDecision(update = {}) {
    const risk=telegramUpdateDedupeRisk(update);
    noteTelemetry('telegramPersistentDedupeUnavailable');
    if (risk.highRisk) {
      noteTelemetry('telegramDedupeFailClosedHighRisk');
      return {
        persistent:false,
        claimed:false,
        duplicate:false,
        status:'fail_closed',
        retry:true,
        retryAfter:3,
        risk:risk.kind,
      };
    }
    noteTelemetry('telegramDedupeSafeFallbacks');
    return { persistent:false, claimed:true, duplicate:false, status:'fallback' };
  }

  async function claimTelegramUpdatePersistent(cfg, key='', update = {}) {
    if (!key || !hasSupabase(cfg)) return degradedTelegramDedupeDecision(update);
    const normalizedKey=validDedupeKey(key);
    if (!normalizedKey) return degradedTelegramDedupeDecision(update);
    try {
      const claimed=await rpc(
        cfg,
        'claim_telegram_update',
        {p_update_key:normalizedKey,p_lease_seconds:90},
        1800,
      );
      if (claimed !== true) {
        noteTelemetry('telegramPersistentDuplicateUpdates');
        return { persistent:true, claimed:false, duplicate:true, status:'duplicate' };
      }
      return { persistent:true, claimed:true, duplicate:false, status:'claimed' };
    } catch {
      noteTelemetry('telegramDedupeFallbacks');
      return degradedTelegramDedupeDecision(update);
    }
  }

  async function completeTelegramUpdatePersistent(cfg, key='') {
    if (!key || !hasSupabase(cfg)) return false;
    const normalizedKey=validDedupeKey(key);
    if (!normalizedKey) return false;
    try {
      await rpc(cfg,'complete_telegram_update',{p_update_key:normalizedKey},1200);
      return true;
    } catch {
      noteTelemetry('telegramDedupeFallbacks');
      return false;
    }
  }

  async function releaseTelegramUpdatePersistent(cfg, key='') {
    if (!key || !hasSupabase(cfg)) return false;
    const normalizedKey=validDedupeKey(key);
    if (!normalizedKey) return false;
    try {
      await rpc(cfg,'release_telegram_update',{p_update_key:normalizedKey},1200);
      return true;
    } catch {
      noteTelemetry('telegramDedupeFallbacks');
      return false;
    }
  }

  function telegramPersistentDedupeSelfTest() {
    const botA={botToken:'100000001:self-test-primary-a'};
    const botB={botToken:'200000002:self-test-primary-b'};
    const byUpdateA=telegramUpdateDedupeKey({update_id:123456},botA);
    const byUpdateB=telegramUpdateDedupeKey({update_id:123456},botB);
    const byCallback=telegramUpdateDedupeKey({callback_query:{id:'cb-123'}},botB);
    const byMessage=telegramUpdateDedupeKey({message:{chat:{id:77},message_id:88}},botB);
    return {
      pass:byUpdateA==='b:id-100000001:u:123456'
        && byUpdateB==='b:id-200000002:u:123456'
        && byUpdateA!==byUpdateB
        && byCallback==='b:id-200000002:c:cb-123'
        && byMessage==='b:id-200000002:m:77:88'
        && !byUpdateA.includes(botA.botToken)
        && !byUpdateB.includes(botB.botToken),
      cases:7,
    };
  }

  function telegramDedupeHealthState(health = {}) {
    const source=plainObject(health) || {};
    if (source.available !== true) return { state:'watch', label:'Persistent dedupe observability недоступна' };
    const stale=nonNegativeInteger(source.staleProcessing);
    const failedRecent=nonNegativeInteger(source.failedRecent);
    const failedCurrent=nonNegativeInteger(source.failedCurrent);
    if (stale >= 5 || failedRecent >= 5) {
      return { state:'incident', label:'Telegram webhook dedupe требует немедленной проверки' };
    }
    if (stale > 0 || failedRecent > 0 || failedCurrent > 0) {
      return { state:'watch', label:'Есть незавершённые Telegram webhook claims' };
    }
    return { state:'healthy', label:'Persistent Telegram dedupe работает штатно' };
  }

  function normalizeTelegramDedupeHealth(raw = {}, available = true, detail = '') {
    const source=plainObject(raw) || {};
    const generatedAt=textValue(source.generated_at ?? source.generatedAt);
    const lastDuplicateAt=textValue(source.last_duplicate_at ?? source.lastDuplicateAt);
    let safeDetail='';
    try { safeDetail=String(redact(textValue(detail),160) ?? '').slice(0,160); } catch {}
    const value={
      available:available === true,
      windowMinutes:boundedInteger(source.window_minutes ?? source.windowMinutes,60,1,1440),
      ledgerRows:nonNegativeInteger(source.ledger_rows ?? source.ledgerRows),
      claimsRecent:nonNegativeInteger(source.claims_recent ?? source.claimsRecent),
      completedRecent:nonNegativeInteger(source.completed_recent ?? source.completedRecent),
      failedRecent:nonNegativeInteger(source.failed_recent ?? source.failedRecent),
      failedCurrent:nonNegativeInteger(source.failed_current ?? source.failedCurrent),
      activeProcessing:nonNegativeInteger(source.active_processing ?? source.activeProcessing),
      staleProcessing:nonNegativeInteger(source.stale_processing ?? source.staleProcessing),
      duplicateAttemptsRetained:nonNegativeInteger(source.duplicate_attempts_retained ?? source.duplicateAttemptsRetained),
      duplicateRowsRecent:nonNegativeInteger(source.duplicate_rows_recent ?? source.duplicateRowsRecent),
      lastDuplicateAt:lastDuplicateAt || null,
      oldestStaleSeconds:nonNegativeInteger(source.oldest_stale_seconds ?? source.oldestStaleSeconds),
      generatedAt:generatedAt || new Date().toISOString(),
      detail:safeDetail,
    };
    return { ...value, ...telegramDedupeHealthState(value) };
  }

  async function readTelegramDedupeHealth(cfg, windowMinutes = 60) {
    if (!hasSupabase(cfg)) return normalizeTelegramDedupeHealth({},false,'supabase_not_configured');
    try {
      const raw=await rpc(cfg,'telegram_webhook_dedupe_health',{
        p_window_minutes:boundedInteger(windowMinutes,60,5,1440),
      },1800);
      return normalizeTelegramDedupeHealth(raw || {},true,'');
    } catch (error) {
      return normalizeTelegramDedupeHealth({},false,error?.code || error?.message || 'dedupe_health_unavailable');
    }
  }

  function telegramDedupeObservabilitySelfTest() {
    const healthy=telegramDedupeHealthState({available:true,staleProcessing:0,failedRecent:0,failedCurrent:0});
    const watch=telegramDedupeHealthState({available:true,staleProcessing:1,failedRecent:0,failedCurrent:0});
    const incident=telegramDedupeHealthState({available:true,staleProcessing:5,failedRecent:0,failedCurrent:0});
    const unavailable=telegramDedupeHealthState({available:false});
    return {
      pass:healthy.state==='healthy' && watch.state==='watch' && incident.state==='incident' && unavailable.state==='watch',
      healthy:healthy.state,
      watch:watch.state,
      incident:incident.state,
      unavailable:unavailable.state,
    };
  }

  function telegramBurstKind(update = {}) {
    if (update?.pre_checkout_query || update?.subscription || update?.message?.successful_payment || update?.message?.refunded_payment) return '';
    const callback=textValue(update?.callback_query?.data);
    if (/^(?:news:refresh|news:team_refresh:|match:refresh:)/.test(callback) || /^news:impact:[^:]+:recheck:/.test(callback)) return 'refresh';
    if (update?.callback_query) return 'callback';
    if (update?.message?.text) return 'message';
    return '';
  }

  function enforceTelegramBurst(update = {}) {
    const kind=telegramBurstKind(update);
    const policy=TELEGRAM_BURST_POLICIES[kind];
    if (!policy) return null;
    const userId=positiveIdentifier(update?.callback_query?.from?.id ?? update?.message?.from?.id);
    if (!userId) return null;
    const now=Date.now();
    const key=`${userId}:${policy.label}`;
    let bucket=runtimeMemory.telegramBurst.get(key);
    const startedAt=validTimestamp(bucket?.startedAt);
    const count=nonNegativeInteger(bucket?.count);
    if (!startedAt || now-startedAt>=policy.windowMs) bucket={startedAt:now,count:0};
    else bucket={startedAt,count};
    bucket.count+=1;
    runtimeMemory.telegramBurst.set(key,bucket);
    if (bucket.count<=policy.limit) {
      if (runtimeMemory.telegramBurst.size>2500) pruneMemory();
      return null;
    }
    const retryAfter=Math.max(1,Math.ceil((policy.windowMs-(now-bucket.startedAt))/1000));
    noteTelemetry('telegramBurstBlocks');
    return {blocked:true,userId,kind,retryAfter};
  }

  return {
    telegramUpdateDedupeKey,
    telegramUpdateDedupeRisk,
    claimTelegramUpdate,
    completeTelegramUpdate,
    releaseTelegramUpdate,
    claimTelegramUpdatePersistent,
    completeTelegramUpdatePersistent,
    releaseTelegramUpdatePersistent,
    telegramPersistentDedupeSelfTest,
    telegramDedupeHealthState,
    normalizeTelegramDedupeHealth,
    readTelegramDedupeHealth,
    telegramDedupeObservabilitySelfTest,
    telegramBurstKind,
    enforceTelegramBurst,
  };
}
