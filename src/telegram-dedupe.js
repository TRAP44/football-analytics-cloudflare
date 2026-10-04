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
    const data=String(update?.callback_query?.data || '');
    if (
      /^(?:digest:(?:on|off)|favorite:toggle:\d+:\d+|postmatch:return:(?:on|off))$/.test(data)
    ) {
      return { kind:TELEGRAM_DEDUPE_RISK.IDEMPOTENT_MUTATION, highRisk:true };
    }
    return { kind:TELEGRAM_DEDUPE_RISK.EXTERNAL_SIDE_EFFECT, highRisk:true };
  }

  const text=String(update?.message?.text || '').trim();
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
  function telegramUpdateDedupeKey(update = {}, cfg = {}) {
    return primaryTelegramUpdateDedupeKey(cfg.botToken, update);
  }

  function claimTelegramUpdate(update = {}, cfg = {}) {
    const key=telegramUpdateDedupeKey(update,cfg);
    if (!key) return {key:'',duplicate:false};
    const now=Date.now();
    const prior=memory.telegramUpdateDedupe.get(key);
    if (prior && now-Number(prior.at || 0)<10*60*1000) {
      bumpTelemetry('telegramDuplicateUpdates');
      return {key,duplicate:true};
    }
    memory.telegramUpdateDedupe.set(key,{at:now,state:'processing'});
    if (memory.telegramUpdateDedupe.size>4000) pruneMemoryState();
    return {key,duplicate:false};
  }

  function completeTelegramUpdate(key='') {
    if (!key) return;
    const current=memory.telegramUpdateDedupe.get(key);
    memory.telegramUpdateDedupe.set(key,{at:Date.now(),state:'done',startedAt:current?.at || null});
  }

  function releaseTelegramUpdate(key='') {
    if (key) memory.telegramUpdateDedupe.delete(key);
  }

  function degradedTelegramDedupeDecision(update = {}) {
    const risk=telegramUpdateDedupeRisk(update);
    bumpTelemetry('telegramPersistentDedupeUnavailable');
    if (risk.highRisk) {
      bumpTelemetry('telegramDedupeFailClosedHighRisk');
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
    bumpTelemetry('telegramDedupeSafeFallbacks');
    return { persistent:false, claimed:true, duplicate:false, status:'fallback' };
  }

  async function claimTelegramUpdatePersistent(cfg, key='', update = {}) {
    if (!key || !hasSupabase(cfg)) return degradedTelegramDedupeDecision(update);
    try {
      const claimed=Boolean(await supaRpc(cfg,'claim_telegram_update',{p_update_key:key,p_lease_seconds:90},1800));
      if (!claimed) {
        bumpTelemetry('telegramPersistentDuplicateUpdates');
        return { persistent:true, claimed:false, duplicate:true, status:'duplicate' };
      }
      return { persistent:true, claimed:true, duplicate:false, status:'claimed' };
    } catch {
      bumpTelemetry('telegramDedupeFallbacks');
      return degradedTelegramDedupeDecision(update);
    }
  }

  async function completeTelegramUpdatePersistent(cfg, key='') {
    if (!key || !hasSupabase(cfg)) return false;
    try {
      await supaRpc(cfg,'complete_telegram_update',{p_update_key:key},1200);
      return true;
    } catch {
      bumpTelemetry('telegramDedupeFallbacks');
      return false;
    }
  }

  async function releaseTelegramUpdatePersistent(cfg, key='') {
    if (!key || !hasSupabase(cfg)) return false;
    try {
      await supaRpc(cfg,'release_telegram_update',{p_update_key:key},1200);
      return true;
    } catch {
      bumpTelemetry('telegramDedupeFallbacks');
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
    if (!health.available) return { state:'watch', label:'Persistent dedupe observability недоступна' };
    const stale=Number(health.staleProcessing || 0);
    const failedRecent=Number(health.failedRecent || 0);
    const failedCurrent=Number(health.failedCurrent || 0);
    if (stale >= 5 || failedRecent >= 5) {
      return { state:'incident', label:'Telegram webhook dedupe требует немедленной проверки' };
    }
    if (stale > 0 || failedRecent > 0 || failedCurrent > 0) {
      return { state:'watch', label:'Есть незавершённые Telegram webhook claims' };
    }
    return { state:'healthy', label:'Persistent Telegram dedupe работает штатно' };
  }

  function normalizeTelegramDedupeHealth(raw = {}, available = true, detail = '') {
    const value={
      available:Boolean(available),
      windowMinutes:Number(raw?.window_minutes ?? raw?.windowMinutes ?? 60) || 60,
      ledgerRows:Number(raw?.ledger_rows ?? raw?.ledgerRows ?? 0) || 0,
      claimsRecent:Number(raw?.claims_recent ?? raw?.claimsRecent ?? 0) || 0,
      completedRecent:Number(raw?.completed_recent ?? raw?.completedRecent ?? 0) || 0,
      failedRecent:Number(raw?.failed_recent ?? raw?.failedRecent ?? 0) || 0,
      failedCurrent:Number(raw?.failed_current ?? raw?.failedCurrent ?? 0) || 0,
      activeProcessing:Number(raw?.active_processing ?? raw?.activeProcessing ?? 0) || 0,
      staleProcessing:Number(raw?.stale_processing ?? raw?.staleProcessing ?? 0) || 0,
      duplicateAttemptsRetained:Number(raw?.duplicate_attempts_retained ?? raw?.duplicateAttemptsRetained ?? 0) || 0,
      duplicateRowsRecent:Number(raw?.duplicate_rows_recent ?? raw?.duplicateRowsRecent ?? 0) || 0,
      lastDuplicateAt:raw?.last_duplicate_at ?? raw?.lastDuplicateAt ?? null,
      oldestStaleSeconds:Number(raw?.oldest_stale_seconds ?? raw?.oldestStaleSeconds ?? 0) || 0,
      generatedAt:raw?.generated_at ?? raw?.generatedAt ?? new Date().toISOString(),
      detail:redactOpsString(detail || '',160),
    };
    return { ...value, ...telegramDedupeHealthState(value) };
  }

  async function readTelegramDedupeHealth(cfg, windowMinutes = 60) {
    if (!hasSupabase(cfg)) return normalizeTelegramDedupeHealth({},false,'supabase_not_configured');
    try {
      const raw=await supaRpc(cfg,'telegram_webhook_dedupe_health',{
        p_window_minutes:Math.max(5,Math.min(1440,Number(windowMinutes || 60))),
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
    const callback=String(update?.callback_query?.data || '');
    if (/^(?:news:refresh|news:team_refresh:|match:refresh:)/.test(callback) || /^news:impact:[^:]+:recheck:/.test(callback)) return 'refresh';
    if (update?.callback_query) return 'callback';
    if (update?.message?.text) return 'message';
    return '';
  }

  function enforceTelegramBurst(update = {}) {
    const kind=telegramBurstKind(update);
    const policy=TELEGRAM_BURST_POLICIES[kind];
    if (!policy) return null;
    const userId=Number(update?.callback_query?.from?.id || update?.message?.from?.id || 0);
    if (!userId) return null;
    const now=Date.now();
    const key=`${userId}:${policy.label}`;
    let bucket=memory.telegramBurst.get(key);
    if (!bucket || now-Number(bucket.startedAt || 0)>=policy.windowMs) bucket={startedAt:now,count:0};
    bucket.count+=1;
    memory.telegramBurst.set(key,bucket);
    if (bucket.count<=policy.limit) {
      if (memory.telegramBurst.size>2500) pruneMemoryState();
      return null;
    }
    const retryAfter=Math.max(1,Math.ceil((policy.windowMs-(now-bucket.startedAt))/1000));
    bumpTelemetry('telegramBurstBlocks');
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
