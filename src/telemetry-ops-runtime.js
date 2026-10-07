const PROVIDER_OUTCOMES = new Set(['retrying','success','failed','rate_limited']);
const MAX_PROVIDER_LENGTH = 80;
const MAX_OPERATION_LENGTH = 180;
const MAX_ERROR_TYPE_LENGTH = 80;
const MAX_PROVIDER_LATENCY_MS = 120_000;
const MAX_METADATA_DEPTH = 3;
const MAX_METADATA_ARRAY_ITEMS = 12;
const MAX_METADATA_OBJECT_KEYS = 24;
const MAX_METADATA_TOP_LEVEL_KEYS = 32;
const MAX_MEMORY_EVENTS_HARD_LIMIT = 10_000;
const MAX_OCCURRENCE_COUNT = 1_000_000_000;
const MAX_DURATION_MS = 86_400_000;

export function createTelemetryOpsRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Telemetry ops runtime dependencies are required.');
  }

  const {
    MAX_MEMORY_OPS_EVENTS,
    currentReleaseIdentity,
    fetchWithTimeout,
    hasSupabase,
    memory,
    observeProviderRequestLocal,
    supaHeaders,
    supaRpc,
  } = deps;

  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('Telemetry ops runtime requires memory.');
  }
  for (const [name,fn] of Object.entries({
    currentReleaseIdentity,
    fetchWithTimeout,
    hasSupabase,
    observeProviderRequestLocal,
    supaHeaders,
    supaRpc,
  })) {
    if (typeof fn !== 'function') throw new TypeError(`Telemetry ops runtime requires ${name}.`);
  }

  function safeRead(value, key) {
    if (!value || typeof value !== 'object') return undefined;
    try { return value[key]; }
    catch { return undefined; }
  }

  function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try {
      Object.getPrototypeOf(value);
      return value;
    } catch {
      return null;
    }
  }

  function safeEntries(value, limit = MAX_METADATA_OBJECT_KEYS) {
    const source=plainObject(value);
    if (!source) return [];
    try { return Object.entries(source).slice(0,limit); }
    catch { return []; }
  }

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || value.length > 24) return null;
    const raw=value.trim();
    if (!/^-?\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.length > 48) return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function boundedInteger(value, fallback, min, max) {
    const number=integerCandidate(value);
    return number !== null && number >= min && number <= max ? number : fallback;
  }

  const maxMemoryOpsEvents=boundedInteger(
    MAX_MEMORY_OPS_EVENTS,
    500,
    1,
    MAX_MEMORY_EVENTS_HARD_LIMIT,
  );

  function primitiveText(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'bigint' || typeof value === 'boolean') return String(value);
    const message=safeRead(value,'message');
    return typeof message === 'string' ? message : '';
  }

  function boundedText(value, max = 500, fallback = '') {
    const safeMax=boundedInteger(max,500,1,4000);
    const raw=primitiveText(value);
    if (!raw || raw.length > safeMax * 8) return fallback;
    try {
      const text=raw
        .normalize('NFKC')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,' ')
        .trim()
        .slice(0,safeMax);
      return text || fallback;
    } catch {
      return fallback;
    }
  }

  function telemetryKey(value) {
    const key=boundedText(value,64);
    return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ? key : '';
  }

  function bumpTelemetry(key, amount = 1) {
    const safeKey=telemetryKey(key);
    if (!safeKey) return false;

    const telemetry=plainObject(safeRead(memory,'telemetry'));
    if (!telemetry) return false;

    const increment=finiteNumber(amount);
    if (increment === null || Math.abs(increment)>1_000_000) return false;

    const current=finiteNumber(safeRead(telemetry,safeKey)) ?? 0;
    const next=current+increment;
    if (!Number.isFinite(next) || Math.abs(next)>Number.MAX_SAFE_INTEGER) return false;
    try {
      telemetry[safeKey]=next;
      return true;
    } catch {
      return false;
    }
  }

  function redactOpsString(value, max = 500) {
    const safeMax=boundedInteger(max,500,1,2000);
    const raw=primitiveText(value);
    if (!raw || raw.length > safeMax * 8) return '';

    let text;
    try { text=raw.normalize('NFKC'); }
    catch { return ''; }

    return text
      .replace(/bot\d{5,20}:[A-Za-z0-9_-]{10,}/g,'bot[redacted]')
      .replace(/\b\d{5,20}:[A-Za-z0-9_-]{20,}\b/g,'[telegram-token-redacted]')
      .replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,'[jwt-redacted]')
      .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/gi,'sb_secret_[redacted]')
      .replace(/\b(?:TELEGRAM_BOT_TOKEN|SUPABASE_SERVICE_ROLE_KEY|API_FOOTBALL_KEY)\s*[:=]\s*[^\s,;]+/gi,'credential=[redacted]')
      .replace(/\b(?:x-apisports-key|x-api-key|api-key|apikey)\s*[:=]\s*[^\s,;]+/gi,'api-key=[redacted]')
      .replace(/([?&](?:token|secret|api[_-]?key|apikey)=)[^&#\s]+/gi,'$1[redacted]')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,' ')
      .slice(0,safeMax);
  }

  function safeHasSupabase(cfg) {
    try {
      return hasSupabase(cfg) === true;
    } catch {
      return false;
    }
  }

  function safeReleaseIdentity(cfg) {
    try {
      return plainObject(currentReleaseIdentity(cfg)) || {};
    } catch {
      return {};
    }
  }

  function providerLabel(value, fallback, max) {
    const label=boundedText(value,max,fallback);
    return label || fallback;
  }

  function providerOutcome(event) {
    const raw=boundedText(
      safeRead(event,'outcome') ?? safeRead(event,'finalResult'),
      32,
    ).toLowerCase();
    return PROVIDER_OUTCOMES.has(raw) ? raw : '';
  }

  function providerLatency(value) {
    const number=finiteNumber(value);
    if (number === null || number < 0) return null;
    return Math.min(MAX_PROVIDER_LATENCY_MS,Math.round(number));
  }

  function safeTimestamp(value) {
    const text=boundedText(value,64);
    if (!text || !Number.isFinite(Date.parse(text))) return null;
    return text;
  }

  async function observeProviderRequest(event = {}, cfg = {}) {
    const source=plainObject(event);
    const outcome=providerOutcome(source);
    if (!source || !outcome) {
      bumpTelemetry('providerObservabilityErrors');
      return {ok:false,persistent:false,reason:'invalid_observation'};
    }

    const normalized={
      provider:providerLabel(safeRead(source,'provider'),'provider',MAX_PROVIDER_LENGTH),
      operation:providerLabel(safeRead(source,'operation'),'unknown',MAX_OPERATION_LENGTH),
      outcome,
      errorType:boundedText(safeRead(source,'errorType'),MAX_ERROR_TYPE_LENGTH) || null,
      latencyMs:providerLatency(safeRead(source,'latencyMs')),
    };

    try {
      if (observeProviderRequestLocal(normalized) !== true) {
        bumpTelemetry('providerObservabilityErrors');
      }
    } catch {
      bumpTelemetry('providerObservabilityErrors');
    }

    if (!safeHasSupabase(cfg)) {
      return {ok:true,persistent:false,reason:'supabase_not_configured'};
    }

    try {
      const result=plainObject(await supaRpc(cfg,'record_provider_slo_observation',{
        p_provider:normalized.provider,
        p_operation:normalized.operation,
        p_outcome:normalized.outcome,
        p_error_type:normalized.errorType,
        p_latency_ms:normalized.latencyMs,
        p_observed_at:new Date().toISOString(),
      },2500));
      if (safeRead(result,'ok') !== true) {
        throw new Error('Provider SLO observation was not confirmed.');
      }
      return {
        ok:true,
        persistent:true,
        bucketStartedAt:safeTimestamp(safeRead(result,'bucketStartedAt') ?? safeRead(result,'bucket_started_at')),
      };
    } catch (error) {
      bumpTelemetry('providerSloPersistenceErrors');
      return {
        ok:false,
        persistent:false,
        reason:redactOpsString(safeRead(error,'message') || error,160) || 'provider_slo_persistence_failed',
      };
    }
  }

  function sensitiveOpsMetadataKey(key = '') {
    const text=boundedText(key,120);
    if (!text) return true;
    if (['__proto__','prototype','constructor'].includes(text.toLowerCase())) return true;
    return /token|secret|password|authorization|api.?key|init.?data|telegram.?id|user.?id|chat.?id|username|first.?name|last.?name|photo.?url|email|phone|ip.?address|device.?id|session.?id/i.test(text);
  }

  function metadataKey(key) {
    const text=boundedText(key,120);
    if (!text || sensitiveOpsMetadataKey(text)) return '';
    return text;
  }

  function sanitizeOpsMetadataValue(value, depth = 0) {
    if (value === null || value === undefined || depth > MAX_METADATA_DEPTH) return undefined;

    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'bigint') return redactOpsString(value,160);
    if (typeof value === 'string') {
      return redactOpsString(value,depth === 0 ? 240 : 160);
    }

    if (Array.isArray(value)) {
      return value
        .slice(0,MAX_METADATA_ARRAY_ITEMS)
        .map(item=>sanitizeOpsMetadataValue(item,depth+1))
        .filter(item=>item !== undefined);
    }

    const source=plainObject(value);
    if (!source) return undefined;

    const out={};
    for (const [rawKey,nested] of safeEntries(source,MAX_METADATA_OBJECT_KEYS)) {
      const key=metadataKey(rawKey);
      if (!key) continue;
      const clean=sanitizeOpsMetadataValue(nested,depth+1);
      if (clean !== undefined) out[key]=clean;
    }
    return out;
  }

  function safeOpsMetadata(meta = {}) {
    const source=plainObject(meta);
    if (!source) return {};

    const out={};
    for (const [rawKey,value] of safeEntries(source,MAX_METADATA_TOP_LEVEL_KEYS)) {
      const key=metadataKey(rawKey);
      if (!key) continue;
      const clean=sanitizeOpsMetadataValue(value,0);
      if (clean !== undefined) out[key]=clean;
    }
    return out;
  }

  function occurrenceCount(value, fallback = 1) {
    return boundedInteger(value,fallback,1,MAX_OCCURRENCE_COUNT);
  }

  function opsEventStore() {
    const current=safeRead(memory,'opsEvents');
    if (Array.isArray(current)) return current;
    try {
      memory.opsEvents=[];
      return memory.opsEvents;
    } catch {
      return null;
    }
  }

  function eventStatus(value) {
    const number=integerCandidate(value);
    return number !== null && number >= 0 && number <= 999 ? number : null;
  }

  function eventDuration(value) {
    const number=finiteNumber(value);
    if (number === null || number < 0) return null;
    return Math.min(MAX_DURATION_MS,Math.round(number));
  }

  function safeSeverity(value) {
    const severity=boundedText(value,16).toLowerCase();
    return ['info','warning','error','critical'].includes(severity) ? severity : 'info';
  }

  function persistenceStatus(row,status) {
    try {
      Object.defineProperty(row,'_persistenceStatus',{
        value:status,
        enumerable:false,
        configurable:true,
      });
    } catch {}
  }

  async function recordOpsEvent(cfg, event = {}) {
    const task=Promise.resolve()
      .then(()=>recordOpsEventTask(cfg,event))
      .catch(()=>{
        bumpTelemetry('opsRecordErrors');
        return null;
      });

    const waitUntil=safeRead(cfg,'waitUntil');
    if (typeof waitUntil === 'function') {
      try { waitUntil.call(cfg,task); }
      catch { bumpTelemetry('opsWaitUntilErrors'); }
    }
    return await task;
  }

  async function recordOpsEventTask(cfg, event = {}) {
    const source=plainObject(event) || {};
    const createdAt=new Date().toISOString();
    const releaseIdentity=safeOpsMetadata(safeReleaseIdentity(cfg));
    const eventMetadata=safeOpsMetadata(safeRead(source,'meta'));

    const transitionText=redactOpsString(safeRead(source,'transitionKey'),220);
    const row={
      created_at:createdAt,
      severity:safeSeverity(safeRead(source,'severity')),
      source:redactOpsString(safeRead(source,'source') || 'worker',80) || 'worker',
      event_type:redactOpsString(safeRead(source,'eventType') || 'runtime',100) || 'runtime',
      code:redactOpsString(safeRead(source,'code'),100),
      message:redactOpsString(safeRead(source,'message'),500),
      endpoint:redactOpsString(safeRead(source,'endpoint'),160),
      status:eventStatus(safeRead(source,'status')),
      duration_ms:eventDuration(safeRead(source,'durationMs')),
      transition_key:transitionText || null,
      occurrence_count:1,
      last_occurred_at:createdAt,
      metadata:{
        ...releaseIdentity,
        ...eventMetadata,
        ...releaseIdentity,
        occurrenceCount:1,
        lastOccurredAt:createdAt,
      },
    };

    const store=opsEventStore();
    let memoryExisting=null;
    if (row.transition_key && store) {
      try {
        memoryExisting=store.find(item=>
          redactOpsString(safeRead(item,'transition_key'),220) === row.transition_key
        ) || null;
      } catch {}
    }

    if (memoryExisting) {
      const previous=occurrenceCount(
        safeRead(memoryExisting,'occurrence_count')
        ?? safeRead(safeRead(memoryExisting,'metadata'),'occurrenceCount'),
        1,
      );
      const nextCount=Math.min(MAX_OCCURRENCE_COUNT,previous+1);
      try {
        memoryExisting.occurrence_count=nextCount;
        memoryExisting.last_occurred_at=createdAt;
        memoryExisting.metadata={
          ...safeOpsMetadata(safeRead(memoryExisting,'metadata')),
          ...row.metadata,
          occurrenceCount:nextCount,
          lastOccurredAt:createdAt,
        };
      } catch {}
      row.occurrence_count=nextCount;
      row.metadata={
        ...row.metadata,
        occurrenceCount:nextCount,
        lastOccurredAt:createdAt,
      };
    } else if (store) {
      try {
        store.unshift(row);
        if (store.length>maxMemoryOpsEvents) {
          store.splice(maxMemoryOpsEvents);
        }
      } catch {}
    }

    if (!safeHasSupabase(cfg)) {
      persistenceStatus(row,'memory_only');
      return row;
    }

    if (row.transition_key) {
      try {
        const result=plainObject(await supaRpc(cfg,'record_ops_event_occurrence',{
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
        },4000));
        if (safeRead(result,'ok') !== true) {
          throw new Error('Persistent ops occurrence was not confirmed.');
        }

        row.occurrence_count=occurrenceCount(
          safeRead(result,'occurrenceCount')
          ?? safeRead(result,'occurrence_count'),
          row.occurrence_count,
        );
        row.last_occurred_at=safeTimestamp(
          safeRead(result,'lastOccurredAt')
          ?? safeRead(result,'last_occurred_at'),
        ) || row.last_occurred_at;
        row.metadata={
          ...row.metadata,
          occurrenceCount:row.occurrence_count,
          lastOccurredAt:row.last_occurred_at,
        };

        // The database is authoritative for deduplicated transition counts.
        // Keep the in-memory copy aligned after concurrent or restarted writers.
        if (memoryExisting) {
          try {
            memoryExisting.occurrence_count=row.occurrence_count;
            memoryExisting.last_occurred_at=row.last_occurred_at;
            memoryExisting.metadata={
              ...safeOpsMetadata(safeRead(memoryExisting,'metadata')),
              ...row.metadata,
              occurrenceCount:row.occurrence_count,
              lastOccurredAt:row.last_occurred_at,
            };
          } catch {}
        }

        persistenceStatus(row,'persistent');
        return row;
      } catch {
        // Backward-compatible DDL boundary: old schemas still dedupe transition
        // events safely, but cannot yet retain the true occurrence volume.
      }
    }

    try {
      const supabaseUrl=boundedText(safeRead(cfg,'supabaseUrl'),2048);
      const url=new URL(`${supabaseUrl}/rest/v1/ops_events`);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Invalid Supabase ops event URL.');
      }

      const prefer=row.transition_key
        ? 'resolution=ignore-duplicates,return=minimal'
        : 'return=minimal';
      if (row.transition_key) url.searchParams.set('on_conflict','transition_key');

      const {
        occurrence_count: _occurrenceCount,
        last_occurred_at: _lastOccurredAt,
        ...legacyRow
      }=row;
      const headers=plainObject(supaHeaders(cfg,{Prefer:prefer}));
      if (!headers) throw new Error('Invalid Supabase ops event headers.');

      const response=await fetchWithTimeout(url,{
        method:'POST',
        headers,
        body:JSON.stringify(legacyRow),
      },4000,'Supabase ops event');
      if (!response || response.ok !== true) {
        const status=eventStatus(safeRead(response,'status'));
        const error=new Error(`Supabase ops event HTTP ${status ?? 0}`);
        error.status=status ?? 0;
        throw error;
      }
      persistenceStatus(row,'persistent');
    } catch {
      // Observability must never become a new failure mode for the product.
      persistenceStatus(row,'failed');
      bumpTelemetry('opsPersistenceErrors');
    }
    return row;
  }

  return Object.freeze({
    bumpTelemetry,
    redactOpsString,
    observeProviderRequest,
    sensitiveOpsMetadataKey,
    sanitizeOpsMetadataValue,
    safeOpsMetadata,
    recordOpsEvent,
    recordOpsEventTask,
  });
}
