export function createTelemetryOpsRuntime(deps = {}) {
  const {
    MAX_MEMORY_OPS_EVENTS,
    currentReleaseIdentity,
    fetchWithTimeout,
    hasSupabase,
    memory,
    observeProviderRequestLocal,
    supaHeaders,
    supaRpc
  } = deps;

  function bumpTelemetry(key, amount = 1) {
    if (!memory.telemetry) return;
    const current = Number(memory.telemetry[key] || 0);
    memory.telemetry[key] = current + Number(amount || 0);
  }

  function redactOpsString(value, max = 500) {
    return String(value ?? '')
      .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
      .replace(/sb_secret_[A-Za-z0-9_-]+/gi, 'sb_secret_[redacted]')
      .replace(/x-apisports-key\s*[:=]\s*[^\s,;]+/gi, 'x-apisports-key=[redacted]')
      .slice(0, max);
  }

  async function observeProviderRequest(event = {}, cfg = {}) {
    observeProviderRequestLocal(event);
    if (!hasSupabase(cfg)) return { ok:true, persistent:false, reason:'supabase_not_configured' };
    try {
      const result=await supaRpc(cfg,'record_provider_slo_observation',{
        p_provider:String(event?.provider || 'provider'),
        p_operation:String(event?.operation || 'unknown'),
        p_outcome:String(event?.outcome || event?.finalResult || ''),
        p_error_type:event?.errorType ? String(event.errorType) : null,
        p_latency_ms:Number.isFinite(Number(event?.latencyMs)) ? Math.max(0,Math.round(Number(event.latencyMs))) : null,
        p_observed_at:new Date().toISOString(),
      },2500);
      if (!result?.ok) throw new Error('Provider SLO observation was not confirmed.');
      return { ok:true, persistent:true, bucketStartedAt:result.bucketStartedAt || null };
    } catch (error) {
      bumpTelemetry('providerSloPersistenceErrors');
      return { ok:false, persistent:false, reason:redactOpsString(error?.message || error,160) };
    }
  }

  function sensitiveOpsMetadataKey(key = '') {
    return /token|secret|password|authorization|api.?key|init.?data|telegram.?id|user.?id|chat.?id|username|first.?name|last.?name|photo.?url/i.test(String(key));
  }

  function sanitizeOpsMetadataValue(value, depth = 0) {
    if (value === null || value === undefined || depth > 3) return undefined;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return redactOpsString(value, depth === 0 ? 240 : 160);
    if (Array.isArray(value)) {
      return value.slice(0, 12)
        .map(item => sanitizeOpsMetadataValue(item, depth + 1))
        .filter(item => item !== undefined);
    }
    if (typeof value === 'object') {
      const out = {};
      for (const [key, nested] of Object.entries(value).slice(0, 24)) {
        if (sensitiveOpsMetadataKey(key)) continue;
        const clean = sanitizeOpsMetadataValue(nested, depth + 1);
        if (clean !== undefined) out[key] = clean;
      }
      return out;
    }
    return redactOpsString(String(value), 160);
  }

  function safeOpsMetadata(meta = {}) {
    const out = {};
    for (const [key, value] of Object.entries(meta || {}).slice(0, 32)) {
      if (sensitiveOpsMetadataKey(key)) continue;
      const clean = sanitizeOpsMetadataValue(value, 0);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }

  async function recordOpsEvent(cfg, event = {}) {
    const task = recordOpsEventTask(cfg, event);
    if (typeof cfg?.waitUntil === 'function') cfg.waitUntil(task);
    return await task;
  }

  async function recordOpsEventTask(cfg, event = {}) {
    const createdAt = new Date().toISOString();
    const row = {
      created_at: createdAt,
      severity: ['info','warning','error','critical'].includes(String(event.severity || '')) ? String(event.severity) : 'info',
      source: redactOpsString(event.source || 'worker', 80),
      event_type: redactOpsString(event.eventType || 'runtime', 100),
      code: redactOpsString(event.code || '', 100),
      message: redactOpsString(event.message || '', 500),
      endpoint: redactOpsString(event.endpoint || '', 160),
      status: Number.isFinite(Number(event.status)) ? Number(event.status) : null,
      duration_ms: Number.isFinite(Number(event.durationMs)) ? Math.max(0, Math.round(Number(event.durationMs))) : null,
      transition_key: event.transitionKey ? redactOpsString(event.transitionKey, 220) : null,
      occurrence_count: 1,
      last_occurred_at: createdAt,
      metadata: {
        ...safeOpsMetadata({ ...currentReleaseIdentity(cfg), ...(event.meta || {}), ...currentReleaseIdentity(cfg) }),
        occurrenceCount:1,
        lastOccurredAt:createdAt,
      },
    };
  
    const memoryExisting = row.transition_key
      ? memory.opsEvents.find(item => String(item?.transition_key || '') === row.transition_key)
      : null;
    if (memoryExisting) {
      const nextCount=Math.max(1,Number(memoryExisting?.occurrence_count || memoryExisting?.metadata?.occurrenceCount || 1))+1;
      memoryExisting.occurrence_count=nextCount;
      memoryExisting.last_occurred_at=createdAt;
      memoryExisting.metadata={
        ...(memoryExisting.metadata || {}),
        occurrenceCount:nextCount,
        lastOccurredAt:createdAt,
      };
      row.occurrence_count=nextCount;
      row.metadata={...(row.metadata || {}),occurrenceCount:nextCount,lastOccurredAt:createdAt};
    } else {
      memory.opsEvents.unshift(row);
      memory.opsEvents = memory.opsEvents.slice(0, MAX_MEMORY_OPS_EVENTS);
    }
  
    const setPersistenceStatus = status => {
      Object.defineProperty(row, '_persistenceStatus', {
        value: status,
        enumerable: false,
        configurable: true,
      });
    };
    if (!hasSupabase(cfg)) {
      setPersistenceStatus('memory_only');
      return row;
    }
  
    if (row.transition_key) {
      try {
        const result=await supaRpc(cfg,'record_ops_event_occurrence',{
          p_created_at:row.created_at,
          p_severity:row.severity,
          p_source:row.source,
          p_event_type:row.event_type,
          p_transition_key:row.transition_key,
          p_code:row.code,
          p_message:row.message,
          p_endpoint:row.endpoint,
          p_status:row.status,
          p_duration_ms:row.duration_ms,
          p_metadata:row.metadata,
        },4000);
        if (!result?.ok) throw new Error('Persistent ops occurrence was not confirmed.');
        row.occurrence_count=Math.max(1,Number(result.occurrenceCount || result.occurrence_count || row.occurrence_count || 1));
        row.last_occurred_at=result.lastOccurredAt || result.last_occurred_at || row.last_occurred_at;
        row.metadata={
          ...(row.metadata || {}),
          occurrenceCount:row.occurrence_count,
          lastOccurredAt:row.last_occurred_at,
        };
        setPersistenceStatus('persistent');
        return row;
      } catch {
        // Backward-compatible DDL boundary: old schemas still dedupe transition
        // events safely, but cannot yet retain the true occurrence volume.
      }
    }
  
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
      const prefer = row.transition_key
        ? 'resolution=ignore-duplicates,return=minimal'
        : 'return=minimal';
      if (row.transition_key) url.searchParams.set('on_conflict', 'transition_key');
      const { occurrence_count: _occurrenceCount, last_occurred_at: _lastOccurredAt, ...legacyRow } = row;
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: supaHeaders(cfg, { Prefer: prefer }),
        body: JSON.stringify(legacyRow),
      }, 4000, 'Supabase ops event');
      if (!response.ok) {
        const error = new Error(`Supabase ops event HTTP ${response.status}`);
        error.status = Number(response.status || 0);
        throw error;
      }
      setPersistenceStatus('persistent');
    } catch {
      // Observability must never become a new failure mode for the product.
      setPersistenceStatus('failed');
    }
    return row;
  }

  return {
    bumpTelemetry,
    redactOpsString,
    observeProviderRequest,
    sensitiveOpsMetadataKey,
    sanitizeOpsMetadataValue,
    safeOpsMetadata,
    recordOpsEvent,
    recordOpsEventTask
  };
}
