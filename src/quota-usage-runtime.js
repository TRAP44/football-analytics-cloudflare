export function createQuotaUsageRuntime(deps = {}) {
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

  async function getUsage(userId, cfg) {
    const date = todayUtc();
    if (hasSupabase(cfg)) {
      const row = await supaSelectOne(cfg, 'usage_daily', {
        telegram_id: `eq.${Number(userId)}`,
        usage_date: `eq.${date}`,
      });
      return Number(row?.analyses || 0);
    }
    return Number(memory.usage.get(`${userId}:${date}`) || 0);
  }
  
  async function reserveAnalysisQuota(userId, cfg) {
    const date = todayUtc();
    const user = await getUserRecord(userId, cfg);
    let plan = user?.plan || 'FREE';
    if (plan !== 'FREE' && user?.subscription_until && new Date(user.subscription_until) < new Date()) plan = 'FREE';
    const limit = Number(cfg.limits[plan] || cfg.limits.FREE);
  
    if (hasSupabase(cfg)) {
      const requestedOperationId = crypto.randomUUID();
      let result;
      try {
        result = await supaRpc(cfg, 'consume_analysis_quota', {
          p_telegram_id: Number(userId),
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
  
      const used = Number(result?.used || 0);
      const operationId = String(result?.operationId || '').trim();
      const durable = Boolean(result?.allowed && result?.durable === true && operationId);
      if (result?.allowed) bumpTelemetry('quotaReservations');
      return {
        reserved: Boolean(result?.allowed),
        allowed: Boolean(result?.allowed),
        durable,
        operationId: durable ? operationId : null,
        kind: 'quota',
        userId: Number(userId),
        date,
        plan,
        used,
        limit,
        left: Math.max(0, limit - used),
        reason: String(result?.reason || ''),
      };
    }
  
    const used = await getUsage(userId, cfg);
    if (used >= limit) return { reserved:false, allowed:false, durable:false, kind:'quota', userId:Number(userId), date, plan, used, limit, left:0, reason:'quota_exhausted' };
    const next = used + 1;
    memory.usage.set(`${userId}:${date}`, next);
    bumpTelemetry('quotaReservations');
    return { reserved:true, allowed:true, durable:false, kind:'quota', userId:Number(userId), date, plan, used:next, limit, left:Math.max(0,limit-next), reason:'reserved_local' };
  }
  
  async function refundAnalysisQuota(userId, reservation, cfg) {
    if (!reservation?.reserved) return { ok:true, skipped:true, reason:'not_reserved' };
    if (hasSupabase(cfg)) {
      const result = await supaRpc(cfg, 'refund_analysis_quota', {
        p_telegram_id: Number(userId),
        p_usage_date: reservation.date || todayUtc(),
      });
      if (result?.refunded !== true) {
        const error = new Error(String(result?.reason || 'legacy_quota_refund_not_confirmed'));
        error.code = 'LEGACY_QUOTA_REFUND_NOT_CONFIRMED';
        throw error;
      }
    } else {
      const key=`${userId}:${reservation.date || todayUtc()}`;
      memory.usage.set(key, Math.max(0, Number(memory.usage.get(key) || 0) - 1));
    }
    bumpTelemetry('quotaRefunds');
    return { ok:true, refunded:true };
  }
  
  async function getQuota(userId, cfg) {
    const user = await getUserRecord(userId, cfg);
    let plan = user?.plan || 'FREE';
    if (plan !== 'FREE' && user?.subscription_until && new Date(user.subscription_until) < new Date()) plan = 'FREE';
    const used = await getUsage(userId, cfg);
    const limit = cfg.limits[plan] || cfg.limits.FREE;
    return { plan, used, limit, left: Math.max(0, limit - used) };
  }

  return {
    getUsage,
    reserveAnalysisQuota,
    refundAnalysisQuota,
    getQuota
  };
}
