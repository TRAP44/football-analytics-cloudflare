export const ROUTE_BURST_POLICIES = Object.freeze([
  { test: p => p === '/api/analyze', limit: 3, windowMs: 30000, label: 'analysis' },
  { test: p => p === '/api/match-center', limit: 8, windowMs: 10000, label: 'match-center' },
  { test: p => p === '/api/search', limit: 10, windowMs: 10000, label: 'search' },
  { test: p => p === '/api/tournament', limit: 8, windowMs: 10000, label: 'tournament' },
  { test: p => p === '/api/team' || p.startsWith('/api/team/'), limit: 10, windowMs: 10000, label: 'team' },
  { test: p => p === '/api/client-telemetry', limit: 12, windowMs: 60000, label: 'client-telemetry' },
  { test: p => p === '/api/beta-feedback', limit: 4, windowMs: 60000, label: 'beta-feedback' },
]);

export function createRouteSecurityRuntime(deps = {}) {
  const {
    TELEGRAM_BURST_POLICIES,
    accountRatePolicies,
    bumpTelemetry,
    cloudflareEdgePolicies,
    distributedAnalysisLockPolicy,
    distributedPreAuthPolicies,
    hasSupabase,
    json,
    memory,
    privilegedLocalRatePolicy,
    pruneMemoryState,
    redactOpsString,
    supaRpc
  } = deps;

  function routeBurstPolicy(pathname) {
    return ROUTE_BURST_POLICIES.find(policy => policy.test(pathname))
      || privilegedLocalRatePolicy(pathname);
  }
  
  function enforceRouteBurst(request, user) {
    const path = new URL(request.url).pathname;
    const policy = routeBurstPolicy(path);
    if (!policy) return null;
  
    const rawId=user?.id;
    const userId=typeof rawId==='number'
      ? (Number.isSafeInteger(rawId) && rawId>0 ? rawId : 0)
      : (typeof rawId==='string' && /^\d+$/.test(rawId.trim()) ? Number(rawId.trim()) : 0);
    if (!Number.isSafeInteger(userId) || userId<=0) return null;
  
    const now=Date.now();
    const key=`${userId}:${policy.label}`;
    const current=memory.routeBurst.get(key);
    const startedAt=typeof current?.startedAt==='number' && Number.isFinite(current.startedAt)
      ? current.startedAt
      : 0;
    const count=typeof current?.count==='number' && Number.isSafeInteger(current.count) && current.count>=0
      ? current.count
      : 0;
    const expired=!startedAt || now<startedAt || now-startedAt>=policy.windowMs;
    const bucket=expired ? {startedAt:now,count:1} : {startedAt,count:count+1};
    memory.routeBurst.set(key,bucket);
  
    if (bucket.count<=policy.limit) {
      if (memory.routeBurst.size>2500) pruneMemoryState();
      return null;
    }
  
    const retryAfter=Math.max(1,Math.ceil((policy.windowMs-(now-bucket.startedAt))/1000));
    bumpTelemetry('burstBlocks');
    return json({
      error: 'Слишком много одинаковых действий подряд. Подождите несколько секунд.',
      code: 'BURST_GUARD',
      retryAfter,
    }, 429, { 'retry-after': String(retryAfter) });
  }
  
  function productionSafetySnapshot() {
    return {
      singleflight: {
        active: memory.inflight.size,
        joins: Number(memory.telemetry?.singleflightJoins || 0),
      },
      distributedAnalysis: {
        claims:Number(memory.telemetry?.analysisLockClaims || 0),
        joins:Number(memory.telemetry?.analysisLockJoins || 0),
        joinHits:Number(memory.telemetry?.analysisLockJoinHits || 0),
        timeouts:Number(memory.telemetry?.analysisLockTimeouts || 0),
        failOpen:Number(memory.telemetry?.analysisLockFailOpen || 0),
        policy:distributedAnalysisLockPolicy(),
      },
      securityGuard: {
        invalidAuthBuckets: memory.authFailureBurst.size,
        edgeRateLimitBlocked:Number(memory.telemetry?.edgeRateLimitBlocks || 0),
        edgeRateLimitFallbacks:Number(memory.telemetry?.edgeRateLimitFallbacks || 0),
        edgeScannerBlocked:Number(memory.telemetry?.edgeScannerBlocks || 0),
        edgePolicies:cloudflareEdgePolicies(),
        invalidAuthBlocked:Number(memory.telemetry?.securityInvalidAuthBlocks || 0),
        distributedPreAuthBlocked:Number(memory.telemetry?.securityPreAuthBlocks || 0),
        distributedPreAuthFallbacks:Number(memory.telemetry?.securityPreAuthFallbacks || 0),
        distributedPreAuthFailClosed:Number(memory.telemetry?.securityPreAuthFailClosed || 0),
        distributedPreAuthPolicies:distributedPreAuthPolicies(),
        crossOriginBlocked:Number(memory.telemetry?.securityCrossOriginBlocks || 0),
        oversizeBlocked:Number(memory.telemetry?.securityOversizeBlocks || 0),
        shapeBlocked:Number(memory.telemetry?.securityShapeBlocks || 0),
      },
      burstGuard: {
        activeBuckets: memory.routeBurst.size,
        blocked: Number(memory.telemetry?.burstBlocks || 0),
        policies: ROUTE_BURST_POLICIES.map(x => ({ label: x.label, limit: x.limit, windowMs: x.windowMs })),
        distributedBlocked: Number(memory.telemetry?.distributedBurstBlocks || 0),
        distributedFallbacks: Number(memory.telemetry?.distributedBurstFallbacks || 0),
        distributedPolicies: accountRatePolicies(),
      },
      telegramWebhook: {
        activeBuckets: memory.telegramBurst.size,
        blocked: Number(memory.telemetry?.telegramBurstBlocks || 0),
        duplicateUpdates: Number(memory.telemetry?.telegramDuplicateUpdates || 0),
        persistentDuplicateUpdates: Number(memory.telemetry?.telegramPersistentDuplicateUpdates || 0),
        persistentFallbacks: Number(memory.telemetry?.telegramDedupeFallbacks || 0),
        dedupeEntries: memory.telegramUpdateDedupe.size,
        policies: Object.values(TELEGRAM_BURST_POLICIES).map(x=>({label:x.label,limit:x.limit,windowMs:x.windowMs})),
      },
      analysisHistoryPersistence: {
        writeErrors: Number(memory.telemetry?.analysisHistoryWriteErrors || 0),
        retryAttempts: Number(memory.telemetry?.analysisHistoryRetryAttempts || 0),
        recovered: Number(memory.telemetry?.analysisHistoryWriteRecovered || 0),
        acceptedDataLoss: Number(memory.telemetry?.analysisHistoryWriteLosses || 0),
        retryPending: Math.max(0, Number(memory.telemetry?.analysisHistoryRetryPending || 0)),
        sustainedFailureThreshold: 3,
      },
      upstream: {
        timeouts: Number(memory.telemetry?.upstreamTimeouts || 0),
        supabaseTimeoutMs: 7000,
        apiFootballTimeoutMs: 10000,
      },
      memory: {
        cacheEntries: memory.cache.size,
        cacheSoftLimit: 500,
        userSyncEntries: memory.userSyncAt.size,
        userSyncTtlSeconds: 600,
        pruned: Number(memory.telemetry?.memoryPrunes || 0),
      },
    };
  }
  
  async function readBackendSecurityContract(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const [contract, defaultAcl] = await Promise.all([
        supaRpc(cfg, 'backend_security_contract'),
        supaRpc(cfg, 'backend_default_acl_contract'),
      ]);
      return {
        ok: Boolean(contract?.ok && defaultAcl?.ok),
        status: contract?.ok && defaultAcl?.ok ? 'ok' : 'violations',
        checkedAt: defaultAcl?.checked_at || contract?.checked_at || null,
        schemaViolations: Array.isArray(contract?.schema_violations) ? contract.schema_violations : [],
        tableViolations: Array.isArray(contract?.table_violations) ? contract.table_violations : [],
        sequenceViolations: Array.isArray(contract?.sequence_violations) ? contract.sequence_violations : [],
        functionViolations: Array.isArray(contract?.function_violations) ? contract.function_violations : [],
        defaultAclViolations: Array.isArray(defaultAcl?.default_acl_violations) ? defaultAcl.default_acl_violations : [],
      };
    } catch (error) {
      return {
        ok: false,
        status: error?.code || 'error',
        detail: redactOpsString(error?.message || error, 160),
        schemaViolations: [],
        tableViolations: [],
        sequenceViolations: [],
        functionViolations: [],
        defaultAclViolations: [],
      };
    }
  }

  return {
    routeBurstPolicy,
    enforceRouteBurst,
    productionSafetySnapshot,
    readBackendSecurityContract
  };
}
