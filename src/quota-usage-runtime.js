export function createQuotaUsageRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Quota usage runtime dependencies are required.');
  }
  const {
    bumpTelemetry,
    durableAnalysisUsageHeaders,
    getUserRecord,
    hasSupabase,
    memory,
    recordOpsEvent,
    redactOpsString,
    supaRpc,
    supaSelectOne,
    todayUtc
  } = deps;

  if (!memory || typeof memory !== 'object' || Array.isArray(memory) || !(memory.usage instanceof Map)) {
    throw new TypeError('Quota usage runtime requires usage memory map.');
  }
  for (const [name,fn] of Object.entries({
    bumpTelemetry,
    durableAnalysisUsageHeaders,
    getUserRecord,
    hasSupabase,
    recordOpsEvent,
    redactOpsString,
    supaRpc,
    supaSelectOne,
    todayUtc,
  })) {
    if (typeof fn !== 'function') throw new TypeError(`Quota usage runtime requires ${name}.`);
  }

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || value.length > 24) return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveId(value) {
    const number=integerCandidate(value);
    return number !== null && number > 0 ? number : null;
  }

  function nonNegativeCount(value) {
    const number=integerCandidate(value);
    return number !== null && number >= 0 ? number : null;
  }

  function normalizedPlan(value) {
    return ['FREE','PRO','PREMIUM'].includes(value) ? value : 'FREE';
  }

  function quotaLimit(cfg,plan) {
    const raw=cfg?.limits?.[plan] ?? cfg?.limits?.FREE;
    const limit=integerCandidate(raw);
    return limit !== null && limit > 0 ? limit : null;
  }

  async function getUsage(userId, cfg) {
    const uid=positiveId(userId);
    if (uid === null) return 0;
    const date = todayUtc();
    if (hasSupabase(cfg)) {
      const row = await supaSelectOne(cfg, 'usage_daily', {
        telegram_id:`eq.${uid}`,
        usage_date: `eq.${date}`,
      });
      return nonNegativeCount(row?.analyses) ?? 0;
    }
    return nonNegativeCount(memory.usage.get(`${uid}:${date}`)) ?? 0;
  }
  
  async function reserveAnalysisQuota(userId, cfg) {
    const uid=positiveId(userId);
    if (uid === null) return {reserved:false,allowed:false,durable:false,kind:'quota',userId:null,reason:'invalid_user'};
    const date=todayUtc();
    const user=await getUserRecord(uid,cfg);
    let plan=normalizedPlan(user?.plan);
    if (plan !== 'FREE' && user?.subscription_until) {
      const expiresAt=Date.parse(typeof user.subscription_until === 'string' ? user.subscription_until : '');
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) plan='FREE';
    }
    const limit=quotaLimit(cfg,plan);
    if (limit === null) return {reserved:false,allowed:false,durable:false,kind:'quota',userId:uid,date,plan,reason:'invalid_limit'};
  
    if (hasSupabase(cfg)) {
      const requestedOperationId = crypto.randomUUID();
      let result;
      try {
        result = await supaRpc(cfg, 'consume_analysis_quota', {
          p_telegram_id:uid,
          p_usage_date: date,
          p_limit: limit,
        }, 7000, durableAnalysisUsageHeaders(requestedOperationId));
      } catch (error) {
        await recordOpsEvent(cfg, {
          severity: 'error',
          source: 'quota',
          eventType: 'analysis_usage_reservation',
          code: 'ANALYSIS_QUOTA_RESERVATION_OUTCOME_UNKNOWN',
          message: 'Analysis quota reservation response was not confirmed. A durable database reservation, if created, will be reconciled automatically.',
          meta: {
            operationId: requestedOperationId,
            usageDate: date,
            error: redactOpsString(error?.message || error, 180),
          },
        }).catch(() => null);
        throw error;
      }
  
      const used=nonNegativeCount(result?.used) ?? 0;
      const operationId=typeof result?.operationId === 'string' ? result.operationId.trim().slice(0,160) : '';
      const allowed=result?.allowed === true;
      const durable=allowed && result?.durable === true && Boolean(operationId);
      if (allowed) bumpTelemetry('quotaReservations');
      return {
        reserved:allowed,
        allowed,
        durable,
        operationId:durable ? operationId : null,
        kind:'quota',
        userId:uid,
        date,
        plan,
        used,
        limit,
        left: Math.max(0, limit - used),
        reason:typeof result?.reason === 'string' ? result.reason.slice(0,120) : '',
      };
    }
  
    const used=await getUsage(uid,cfg);
    if (used >= limit) return { reserved:false, allowed:false, durable:false, kind:'quota', userId:uid, date, plan, used, limit, left:0, reason:'quota_exhausted' };
    const next = used + 1;
    memory.usage.set(`${uid}:${date}`,next);
    bumpTelemetry('quotaReservations');
    return { reserved:true, allowed:true, durable:false, kind:'quota', userId:uid, date, plan, used:next, limit, left:Math.max(0,limit-next), reason:'reserved_local' };
  }
  
  async function refundAnalysisQuota(userId, reservation, cfg) {
    const uid=positiveId(userId);
    if (uid === null) return {ok:false,skipped:true,reason:'invalid_user'};
    if (reservation?.reserved !== true) return { ok:true, skipped:true, reason:'not_reserved' };
    if (hasSupabase(cfg)) {
      const result = await supaRpc(cfg, 'refund_analysis_quota', {
        p_telegram_id:uid,
        p_usage_date: reservation.date || todayUtc(),
      });
      if (result?.refunded !== true) {
        const error = new Error(String(result?.reason || 'legacy_quota_refund_not_confirmed'));
        error.code = 'LEGACY_QUOTA_REFUND_NOT_CONFIRMED';
        throw error;
      }
    } else {
      const key=`${uid}:${reservation.date || todayUtc()}`;
      memory.usage.set(key,Math.max(0,(nonNegativeCount(memory.usage.get(key)) ?? 0)-1));
    }
    bumpTelemetry('quotaRefunds');
    return { ok:true, refunded:true };
  }
  
  async function getQuota(userId, cfg) {
    const uid=positiveId(userId);
    if (uid === null) return {plan:'FREE',used:0,limit:0,left:0};
    const user=await getUserRecord(uid,cfg);
    let plan=normalizedPlan(user?.plan);
    if (plan !== 'FREE' && user?.subscription_until) {
      const expiresAt=Date.parse(typeof user.subscription_until === 'string' ? user.subscription_until : '');
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) plan='FREE';
    }
    const used=await getUsage(uid,cfg);
    const limit=quotaLimit(cfg,plan) ?? 0;
    return {plan,used,limit,left:Math.max(0,limit-used)};
  }

  return Object.freeze({
    getUsage,
    reserveAnalysisQuota,
    refundAnalysisQuota,
    getQuota
  });
}
