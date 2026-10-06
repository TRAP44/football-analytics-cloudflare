export function createMaintenanceRuntime(deps = {}) {
  const {
    hasSupabase,
    memory,
    redactOpsString,
    supaDelete
  } = deps;

  async function cleanupRateWindows(cfg) {
    if (!hasSupabase(cfg)) return { skipped: true };
    const cutoff = new Date(Date.now() - 2 * 86400_000).toISOString();
    try {
      await supaDelete(cfg, 'provider_rate_windows', { updated_at: `lt.${cutoff}` });
      return { ok: true, cutoff };
    } catch (error) {
      return { ok: false, error: redactOpsString(error?.message || error, 180) };
    }
  }

  async function cleanupScheduledJobLeases(cfg) {
    if (!hasSupabase(cfg)) return { skipped: true };
    const cutoff = new Date().toISOString();
    try {
      await supaDelete(cfg, 'scheduled_job_leases', { expires_at: `lt.${cutoff}` });
      return { ok: true, cutoff };
    } catch (error) {
      return { ok: false, error: redactOpsString(error?.message || error, 180) };
    }
  }

  async function cleanupOpsEvents(cfg) {
    if (!hasSupabase(cfg)) return { skipped: true };
    const days = Math.max(1, Number(cfg.opsRetentionDays || 14));
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    try {
      await supaDelete(cfg, 'ops_events', { created_at: `lt.${cutoff}` });
      return { ok: true, cutoff };
    } catch (error) {
      return { ok: false, error: redactOpsString(error?.message || error, 180) };
    }
  }

  async function cleanupIntegrityData(cfg) {
    if (!hasSupabase(cfg)) return { skipped: true };
    const days = Math.max(1, Number(cfg.opsRetentionDays || 14));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const failedTables = [];
  
    for (const table of ['match_integrity_events', 'match_integrity_runs']) {
      try {
        await supaDelete(cfg, table, { observed_at: `lt.${cutoff}` });
      } catch (error) {
        failedTables.push({
          table,
          error: redactOpsString(error?.message || error, 180),
        });
      }
    }
  
    if (failedTables.length) {
      return {
        ok: false,
        error: `Integrity cleanup failed for: ${failedTables.map(item => item.table).join(', ')}`,
        cutoff,
        failedTables,
      };
    }
    return { ok: true, cutoff };
  }

  function telemetrySnapshot() {
    const t = memory.telemetry || {};
    const requests = Number(t.apiRequests || 0);
    const hits = Number(t.cacheHits || 0);
    const misses = Number(t.cacheMisses || 0);
    const stale = Number(t.staleCacheHits || 0);
    const cacheLookups = hits + misses + stale;
    return {
      startedAt: t.startedAt || null,
      uptimeSeconds: t.startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(t.startedAt)) / 1000)) : null,
      apiRequests: requests,
      apiSuccess: Number(t.apiSuccess || 0),
      apiErrors: Number(t.apiErrors || 0),
      rateLimits: Number(t.rateLimits || 0),
      quotaBlocks: Number(t.quotaBlocks || 0),
      apiSuccessRate: requests ? Math.round((Number(t.apiSuccess || 0) / requests) * 1000) / 10 : null,
      cacheHits: hits,
      cacheMisses: misses,
      staleCacheHits: stale,
      cacheWrites: Number(t.cacheWrites || 0),
      cacheWriteErrors: Number(t.cacheWriteErrors || 0),
      cacheHitRate: cacheLookups ? Math.round((hits / cacheLookups) * 1000) / 10 : null,
      supabaseErrors: Number(t.supabaseErrors || 0),
      supabaseProbeRecoveries: Number(t.supabaseProbeRecoveries || 0),
      supabaseProbeConfirmedFailures: Number(t.supabaseProbeConfirmedFailures || 0),
      routeErrors: Number(t.routeErrors || 0),
      integrityRuns: Number(t.integrityRuns || 0),
      integrityWarnings: Number(t.integrityWarnings || 0),
      integrityErrors: Number(t.integrityErrors || 0),
      integrityQuarantined: Number(t.integrityQuarantined || 0),
      integrityDuplicates: Number(t.integrityDuplicates || 0),
      singleflightJoins: Number(t.singleflightJoins || 0),
      burstBlocks: Number(t.burstBlocks || 0),
      upstreamTimeouts: Number(t.upstreamTimeouts || 0),
      userSyncSkips: Number(t.userSyncSkips || 0),
      memoryPrunes: Number(t.memoryPrunes || 0),
      providerDistributedBlocks: Number(t.providerDistributedBlocks || 0),
      providerDistributedFallbacks: Number(t.providerDistributedFallbacks || 0),
      providerRequests: Number(t.providerRequests || 0),
      providerErrors: Number(t.providerErrors || 0),
      providerTimeouts: Number(t.providerTimeouts || 0),
      providerRateLimits: Number(t.providerRateLimits || 0),
      providerRetries: Number(t.providerRetries || 0),
      providerAvgLatencyMs: Number(t.providerLatencySamples || 0)
        ? Math.round(Number(t.providerLatencyMs || 0) / Number(t.providerLatencySamples || 1))
        : null,
      providerSloPersistenceErrors: Number(t.providerSloPersistenceErrors || 0),
      quotaReservations: Number(t.quotaReservations || 0),
      quotaRefunds: Number(t.quotaRefunds || 0),
      analysisHistoryWriteErrors: Number(t.analysisHistoryWriteErrors || 0),
      analysisHistoryRetryAttempts: Number(t.analysisHistoryRetryAttempts || 0),
      analysisHistoryWriteRecovered: Number(t.analysisHistoryWriteRecovered || 0),
      analysisHistoryWriteLosses: Number(t.analysisHistoryWriteLosses || 0),
      analysisHistoryRetryPending: Number(t.analysisHistoryRetryPending || 0),
      digestDeliveryClaims: Number(t.digestDeliveryClaims || 0),
      digestDeliveryDuplicates: Number(t.digestDeliveryDuplicates || 0),
      inflightNow: memory.inflight.size,
      routeBucketsNow: memory.routeBurst.size,
      l1CacheEntries: memory.cache.size,
      note: 'Счётчики среды относятся к текущему серверному обработчику Cloudflare; квоты источника данных берутся из ответов API-Football.',
    };
  }

  return {
    cleanupRateWindows,
    cleanupScheduledJobLeases,
    cleanupOpsEvents,
    cleanupIntegrityData,
    telemetrySnapshot
  };
}
