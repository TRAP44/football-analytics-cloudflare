function cacheOpsCategory(cacheKey) {
  const raw = String(cacheKey || '').trim();
  if (!raw) return 'unknown';

  const parts = raw.split(':').filter(Boolean);
  const safe = [];
  for (const part of parts) {
    const value = String(part).trim();
    if (!value) continue;

    // Stop before user/fixture ids, UUIDs, hashes or other opaque tokens.
    if (
      /^\d+$/.test(value)
      || /^[0-9a-f]{8,}$/i.test(value)
      || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)
      || value.length > 32
    ) break;

    safe.push(value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 24));
    if (safe.length >= 3) break;
  }

  return (safe.join(':') || 'opaque').slice(0, 80);
}

function cacheTtlMinutes(value, fallback = 10) {
  const parsed = Number(value);
  const fallbackParsed = Number(fallback);
  const safeFallback = Number.isFinite(fallbackParsed)
    ? Math.max(1 / 6, Math.min(24 * 60, fallbackParsed))
    : 10;
  return Number.isFinite(parsed)
    ? Math.max(1 / 6, Math.min(24 * 60, parsed))
    : safeFallback;
}

function cacheExpiryMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createSharedCacheRuntime({
  memory,
  bumpTelemetry,
  phase5ProviderCacheUsage,
  hasSupabase,
  supaSelectOne,
  supaUpsert,
  pruneMemoryState,
  recordOpsEvent,
}) {
  async function emitOpsEvent(cfg, event) {
    if (typeof recordOpsEvent !== 'function') return;
    try {
      await Promise.resolve(recordOpsEvent(cfg, event));
    } catch {
      // Cache observability is best-effort and must never break cache fallback.
    }
  }

  async function getCacheEntry(cacheKey, cfg, allowExpired = false) {
    // L1 cache inside the current Worker isolate. This reduces Supabase reads and
    // also gives us a tiny fallback during a transient database problem.
    let local = memory.cache.get(cacheKey);
    const localExpiresAt = cacheExpiryMs(local?.expiresAt);
    if (local && localExpiresAt === null) {
      memory.cache.delete(cacheKey);
      local = null;
    }
    if (local && localExpiresAt > Date.now()) {
      bumpTelemetry('cacheHits');
      phase5ProviderCacheUsage(cfg,cacheKey,'cacheHits');
      // Touch the key so Map insertion order acts as a lightweight LRU.
      memory.cache.delete(cacheKey);
      memory.cache.set(cacheKey, local);
      return { payload: local.payload, expired: false, expiresAt: new Date(localExpiresAt).toISOString(), layer: 'memory' };
    }

    if (hasSupabase(cfg)) {
      try {
        const row = await supaSelectOne(cfg, 'analysis_cache', { cache_key: `eq.${cacheKey}` });
        if (!row) {
          bumpTelemetry('cacheMisses');
          if (allowExpired && local) {
            bumpTelemetry('staleCacheHits');
            phase5ProviderCacheUsage(cfg,cacheKey,'staleCacheHits');
            return { payload: local.payload, expired: true, expiresAt: new Date(localExpiresAt).toISOString(), layer: 'memory-stale' };
          }
          return null;
        }
        const expiresAtMs = Date.parse(row.expires_at);
        const expired = Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : true;
        memory.cache.set(cacheKey, { payload: row.payload, expiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() - 1 });
        if (expired && !allowExpired) {
          bumpTelemetry('cacheMisses');
          return null;
        }
        if (expired) {
          bumpTelemetry('staleCacheHits');
          phase5ProviderCacheUsage(cfg,cacheKey,'staleCacheHits');
        } else {
          bumpTelemetry('cacheHits');
          phase5ProviderCacheUsage(cfg,cacheKey,'cacheHits');
        }
        return { payload: row.payload, expired, expiresAt: row.expires_at, layer: 'supabase' };
      } catch (error) {
        bumpTelemetry('supabaseErrors');
        if (local && (allowExpired || localExpiresAt > Date.now())) {
          if (localExpiresAt <= Date.now()) {
            bumpTelemetry('staleCacheHits');
            phase5ProviderCacheUsage(cfg,cacheKey,'staleCacheHits');
          } else {
            bumpTelemetry('cacheHits');
            phase5ProviderCacheUsage(cfg,cacheKey,'cacheHits');
          }
          await emitOpsEvent(cfg, {
            severity: 'warning', source: 'cache', eventType: 'supabase_cache_read_fallback', code: 'CACHE_DB_READ',
            message: error?.message || error, meta: { cacheCategory: cacheOpsCategory(cacheKey) },
          });
          return { payload: local.payload, expired: localExpiresAt <= Date.now(), expiresAt: new Date(localExpiresAt).toISOString(), layer: 'memory-fallback' };
        }
        await emitOpsEvent(cfg, {
          severity: 'warning', source: 'cache', eventType: 'supabase_cache_read_degraded', code: 'CACHE_DB_READ_NO_L1',
          message: error?.message || error, meta: { cacheCategory: cacheOpsCategory(cacheKey) },
        });
        // Treat a transient shared-cache outage as a cache miss. The route may
        // still refresh from the provider and serve the user.
        return null;
      }
    }

    if (!local) {
      bumpTelemetry('cacheMisses');
      return null;
    }
    const expired = localExpiresAt <= Date.now();
    if (expired && !allowExpired) {
      bumpTelemetry('cacheMisses');
      return null;
    }
    if (expired) {
      bumpTelemetry('staleCacheHits');
      phase5ProviderCacheUsage(cfg,cacheKey,'staleCacheHits');
    } else {
      bumpTelemetry('cacheHits');
      phase5ProviderCacheUsage(cfg,cacheKey,'cacheHits');
    }
    return { payload: local.payload, expired, expiresAt: new Date(localExpiresAt).toISOString(), layer: 'memory' };
  }

  async function getCache(cacheKey, cfg) {
    const entry = await getCacheEntry(cacheKey, cfg, false);
    return entry ? entry.payload : null;
  }

  async function getStaleCache(cacheKey, cfg) {
    const entry = await getCacheEntry(cacheKey, cfg, true);
    return entry ? entry.payload : null;
  }

  function cacheSourceProvenance(payload = {}) {
    const meta = payload?.sourceMeta || {};
    const provider = String(
      meta?.provider
      || payload?.provider
      || payload?.dataProvenance?.primaryProvider
      || ''
    ).slice(0, 80);
    const timestampCandidates = [
      meta?.fetchedAt,
      payload?.refreshedAt,
      payload?.generatedAt,
      payload?.fetchedAt,
    ];
    const sourceUpdatedAt = timestampCandidates.find(value => Number.isFinite(Date.parse(String(value || '')))) || null;
    const freshness = String(
      payload?.stale ? 'stale'
        : meta?.freshness
          || (provider ? 'fresh' : 'unknown')
    ).slice(0, 40);
    return { provider, sourceUpdatedAt, freshness };
  }

  async function setCache(cacheKey, fixtureId, payload, cfg = {}, minutes = cfg?.cacheMinutes) {
    const ttlMinutes = cacheTtlMinutes(minutes, cfg?.cacheMinutes);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    const expiresAtMs = Date.parse(expiresAt);
    const provenance = cacheSourceProvenance(payload);
    // Always keep an L1 copy. Supabase remains the persistent/shared cache.
    memory.cache.set(cacheKey, { payload, expiresAt: expiresAtMs });
    if (memory.cache.size > 600) pruneMemoryState();
    bumpTelemetry('cacheWrites');
    if (!hasSupabase(cfg)) return;
    try {
      await supaUpsert(cfg, 'analysis_cache', {
        cache_key: cacheKey,
        fixture_id: Number.isSafeInteger(Number(fixtureId)) && Number(fixtureId) > 0 ? Number(fixtureId) : null,
        payload,
        expires_at: expiresAt,
        provider: provenance.provider,
        source_updated_at: provenance.sourceUpdatedAt,
        freshness_status: provenance.freshness,
        updated_at: new Date().toISOString(),
      }, 'cache_key');
    } catch (error) {
      bumpTelemetry('cacheWriteErrors');
      bumpTelemetry('supabaseErrors');
      await emitOpsEvent(cfg, {
        severity: 'warning', source: 'cache', eventType: 'supabase_cache_write_fallback', code: 'CACHE_DB_WRITE',
        message: error?.message || error, meta: { cacheCategory: cacheOpsCategory(cacheKey), provider: provenance.provider },
      });
      // Cache persistence is an optimization. Do not fail a successful user request
      // only because the shared cache could not be written.
    }
  }

  return {
    getCacheEntry,
    getCache,
    getStaleCache,
    cacheSourceProvenance,
    cacheOpsCategory,
    setCache,
  };
}
