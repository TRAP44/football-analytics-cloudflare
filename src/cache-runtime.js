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

function finiteCacheNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cacheTtlMinutes(value, fallback = 10) {
  const parsed = finiteCacheNumber(value);
  const fallbackParsed = finiteCacheNumber(fallback);
  const safeFallback = fallbackParsed !== null
    ? Math.max(1 / 6, Math.min(24 * 60, fallbackParsed))
    : 10;
  return parsed !== null
    ? Math.max(1 / 6, Math.min(24 * 60, parsed))
    : safeFallback;
}

function cacheExpiryMs(value) {
  return finiteCacheNumber(value);
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
  if (!memory?.cache || typeof memory.cache.get !== 'function' || typeof memory.cache.set !== 'function') {
    throw new TypeError('Shared cache runtime requires memory.cache Map-like storage.');
  }

  function noteTelemetry(key) {
    try { bumpTelemetry?.(key); } catch {}
  }

  function noteProviderCacheUsage(cfg, cacheKey, kind) {
    try { phase5ProviderCacheUsage?.(cfg, cacheKey, kind); } catch {}
  }

  function sharedCacheEnabled(cfg) {
    try { return hasSupabase?.(cfg) === true; } catch { return false; }
  }

  function pruneLocalCache() {
    try { pruneMemoryState?.(); } catch {}
  }

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
      noteTelemetry('cacheHits');
      noteProviderCacheUsage(cfg,cacheKey,'cacheHits');
      // Touch the key so Map insertion order acts as a lightweight LRU.
      memory.cache.delete(cacheKey);
      memory.cache.set(cacheKey, local);
      return { payload: local.payload, expired: false, expiresAt: new Date(localExpiresAt).toISOString(), layer: 'memory' };
    }

    if (sharedCacheEnabled(cfg)) {
      try {
        const row = await supaSelectOne(cfg, 'analysis_cache', { cache_key: `eq.${cacheKey}` });
        if (!row) {
          noteTelemetry('cacheMisses');
          if (allowExpired && local) {
            noteTelemetry('staleCacheHits');
            noteProviderCacheUsage(cfg,cacheKey,'staleCacheHits');
            return { payload: local.payload, expired: true, expiresAt: new Date(localExpiresAt).toISOString(), layer: 'memory-stale' };
          }
          return null;
        }
        const expiresAtMs = Date.parse(String(row?.expires_at || ''));
        if (!Number.isFinite(expiresAtMs)) {
          noteTelemetry('cacheMisses');
          await emitOpsEvent(cfg, {
            severity: 'warning', source: 'cache', eventType: 'supabase_cache_invalid_row', code: 'CACHE_DB_INVALID_ROW',
            message: 'Shared cache row has an invalid expiration timestamp.', meta: { cacheCategory: cacheOpsCategory(cacheKey) },
          });
          if (allowExpired && local) {
            noteTelemetry('staleCacheHits');
            noteProviderCacheUsage(cfg,cacheKey,'staleCacheHits');
            return { payload: local.payload, expired: true, expiresAt: new Date(localExpiresAt).toISOString(), layer: 'memory-stale' };
          }
          return null;
        }
        const expired = expiresAtMs <= Date.now();
        memory.cache.set(cacheKey, { payload: row.payload, expiresAt: expiresAtMs });
        if (expired && !allowExpired) {
          noteTelemetry('cacheMisses');
          return null;
        }
        if (expired) {
          noteTelemetry('staleCacheHits');
          noteProviderCacheUsage(cfg,cacheKey,'staleCacheHits');
        } else {
          noteTelemetry('cacheHits');
          noteProviderCacheUsage(cfg,cacheKey,'cacheHits');
        }
        return { payload: row.payload, expired, expiresAt: row.expires_at, layer: 'supabase' };
      } catch (error) {
        noteTelemetry('supabaseErrors');
        if (local && (allowExpired || localExpiresAt > Date.now())) {
          if (localExpiresAt <= Date.now()) {
            noteTelemetry('staleCacheHits');
            noteProviderCacheUsage(cfg,cacheKey,'staleCacheHits');
          } else {
            noteTelemetry('cacheHits');
            noteProviderCacheUsage(cfg,cacheKey,'cacheHits');
          }
          await emitOpsEvent(cfg, {
            severity: 'warning', source: 'cache', eventType: 'supabase_cache_read_fallback', code: 'CACHE_DB_READ',
            message: 'Shared cache read failed; served the local cache fallback.', meta: { cacheCategory: cacheOpsCategory(cacheKey), errorName: String(error?.name || 'Error').slice(0, 40) },
          });
          return { payload: local.payload, expired: localExpiresAt <= Date.now(), expiresAt: new Date(localExpiresAt).toISOString(), layer: 'memory-fallback' };
        }
        await emitOpsEvent(cfg, {
          severity: 'warning', source: 'cache', eventType: 'supabase_cache_read_degraded', code: 'CACHE_DB_READ_NO_L1',
          message: 'Shared cache read failed and no local fallback was available.', meta: { cacheCategory: cacheOpsCategory(cacheKey), errorName: String(error?.name || 'Error').slice(0, 40) },
        });
        // Treat a transient shared-cache outage as a cache miss. The route may
        // still refresh from the provider and serve the user.
        return null;
      }
    }

    if (!local) {
      noteTelemetry('cacheMisses');
      return null;
    }
    const expired = localExpiresAt <= Date.now();
    if (expired && !allowExpired) {
      noteTelemetry('cacheMisses');
      return null;
    }
    if (expired) {
      noteTelemetry('staleCacheHits');
      noteProviderCacheUsage(cfg,cacheKey,'staleCacheHits');
    } else {
      noteTelemetry('cacheHits');
      noteProviderCacheUsage(cfg,cacheKey,'cacheHits');
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
    const source=payload && typeof payload==='object' && !Array.isArray(payload)
      ? payload
      : {};
    const meta=source?.sourceMeta && typeof source.sourceMeta==='object'
      && !Array.isArray(source.sourceMeta)
      ? source.sourceMeta
      : {};

    const text=(value,max)=>{
      if (typeof value!=='string') return '';
      return value.trim().slice(0,max);
    };
    const timestamp=value=>{
      if (value instanceof Date) {
        const ms=value.getTime();
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
      }
      if (typeof value!=='string' || !value.trim()) return null;
      const raw=value.trim();
      const calendar=/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw);
      if (!calendar) return null;
      const year=Number(calendar[1]);
      const month=Number(calendar[2]);
      const day=Number(calendar[3]);
      if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
      const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
      if (day>maxDay) return null;
      if (
        raw.length>10
        && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
      ) return null;
      const parsed=Date.parse(raw);
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    };
    const timestampPresent=value=>{
      if (value instanceof Date) return true;
      if (typeof value==='string') return Boolean(value.trim());
      return value !== null && value !== undefined;
    };

    const provider=text(meta.provider,80)
      || text(source.provider,80)
      || text(source?.dataProvenance?.primaryProvider,80);
    const timestampCandidates=[
      meta.fetchedAt,
      source.refreshedAt,
      source.generatedAt,
      source.fetchedAt,
    ];
    let sourceUpdatedAt=null;
    for (const candidate of timestampCandidates) {
      if (!timestampPresent(candidate)) continue;
      sourceUpdatedAt=timestamp(candidate);
      break;
    }

    const freshnessCandidate=(
      text(meta.freshness,40)
      || text(meta.freshnessState,40)
    ).toLowerCase().replace(/\s+/g,'_');
    const measurableSource=Boolean(provider && sourceUpdatedAt);
    const freshness=source.stale===true || freshnessCandidate==='stale'
      ? 'stale'
      : measurableSource && ['fresh','cached'].includes(freshnessCandidate)
        ? freshnessCandidate
        : measurableSource
          ? 'fresh'
          : 'unknown';

    return {provider,sourceUpdatedAt,freshness};
  }

  async function setCache(cacheKey, fixtureId, payload, cfg = {}, minutes = cfg?.cacheMinutes) {
    const ttlMinutes = cacheTtlMinutes(minutes, cfg?.cacheMinutes);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    const expiresAtMs = Date.parse(expiresAt);
    const provenance = cacheSourceProvenance(payload);
    // Always keep an L1 copy. Supabase remains the persistent/shared cache.
    memory.cache.set(cacheKey, { payload, expiresAt: expiresAtMs });
    if (memory.cache.size > 600) pruneLocalCache();
    noteTelemetry('cacheWrites');
    if (!sharedCacheEnabled(cfg)) return;
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
      noteTelemetry('cacheWriteErrors');
      noteTelemetry('supabaseErrors');
      await emitOpsEvent(cfg, {
        severity: 'warning', source: 'cache', eventType: 'supabase_cache_write_fallback', code: 'CACHE_DB_WRITE',
        message: 'Shared cache persistence failed; the local cache copy remains available.', meta: { cacheCategory: cacheOpsCategory(cacheKey), provider: provenance.provider, errorName: String(error?.name || 'Error').slice(0, 40) },
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
