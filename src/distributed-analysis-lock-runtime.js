export function createDistributedAnalysisLockRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Distributed analysis lock dependencies are required.');
  }

  const {
    APP_VERSION,
    DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS,
    DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS,
    DISTRIBUTED_ANALYSIS_WAIT_MS,
    bumpTelemetry,
    fetchWithTimeout,
    getCache,
    getCacheEntry,
    hasSupabase,
    memory,
    randomUUID,
    recordOpsEvent,
    sleepMs,
    supaDelete,
    supaHeaders,
    supaSelectOne,
  }=deps;

  const requiredFunctions={
    bumpTelemetry,
    fetchWithTimeout,
    getCache,
    getCacheEntry,
    hasSupabase,
    randomUUID,
    recordOpsEvent,
    sleepMs,
    supaDelete,
    supaHeaders,
    supaSelectOne,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }
  if (!(memory.cache instanceof Map)) {
    throw new TypeError('memory.cache must be a Map');
  }

  function safeText(value,max=240) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    try {
      return String(value)
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F]/g,' ')
        .replace(/\s+/g,' ')
        .trim()
        .slice(0,max);
    } catch {
      return '';
    }
  }

  function objectValue(value) {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  }

  function integerValue(value) {
    if (typeof value==='number') {
      return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value!=='string') return null;
    const raw=value.trim();
    if (!/^-?\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=integerValue(value);
    return number !== null && number>0 ? number : null;
  }

  function boundedInteger(value,fallback,min,max) {
    const number=integerValue(value);
    return number !== null && number>=min && number<=max
      ? number
      : fallback;
  }

  function normalizeUuid(value) {
    const id=safeText(value,80).toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
      ? id
      : '';
  }

  function createClaimId() {
    const id=normalizeUuid(randomUUID());
    if (!id) throw new Error('analysis lock claim id invalid');
    return id;
  }

  function safeTelemetry(key,amount=1) {
    try { bumpTelemetry(key,amount); } catch {}
  }

  async function safeRecord(cfg,event) {
    try { await recordOpsEvent(cfg,event); } catch {}
  }

  function supabaseAvailability(cfg) {
    try {
      return {configured:hasSupabase(cfg)===true,probeFailed:false};
    } catch {
      return {configured:false,probeFailed:true};
    }
  }

  function analysisCacheInsertUrl(cfg) {
    const base=safeText(cfg?.supabaseUrl,1000).replace(/\/+$/,'');
    if (!/^https?:\/\/[^\s/?#]+(?::\d+)?(?:\/[^\s?#]*)?$/i.test(base)) {
      throw new Error('analysis lock Supabase URL invalid');
    }
    return `${base}/rest/v1/analysis_cache?on_conflict=cache_key`;
  }

  function lockPolicy() {
    const ttlSeconds=boundedInteger(
      DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS,
      90,
      60,
      600,
    );
    const waitAttempts=boundedInteger(
      DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS,
      4,
      1,
      10,
    );
    const waitMs=boundedInteger(
      DISTRIBUTED_ANALYSIS_WAIT_MS,
      1600,
      250,
      5000,
    );
    const maxWaitMs=waitAttempts*waitMs;
    if (maxWaitMs<5000 || maxWaitMs>=15000) {
      return {
        ttlSeconds:90,
        waitAttempts:4,
        waitMs:1600,
        maxWaitMs:6400,
      };
    }
    return {ttlSeconds,waitAttempts,waitMs,maxWaitMs};
  }

  function distributedAnalysisLockKey(fixtureId) {
    const id=positiveSafeInteger(fixtureId);
    return id ? `analysis:compute-lock:${id}:v1` : '';
  }

  function distributedAnalysisLockPolicy() {
    return Object.freeze({...lockPolicy()});
  }

  function lockFixtureIdFromKey(value) {
    const key=safeText(value,160);
    const match=/^analysis:compute-lock:(\d+):v1$/.exec(key);
    return match ? positiveSafeInteger(match[1]) : null;
  }

  function analysisFixtureIdFromCacheKey(value) {
    const key=safeText(value,200);
    const match=/^fixture:(\d+):/.exec(key);
    return match ? positiveSafeInteger(match[1]) : null;
  }

  function validLockEntry(entry,fixtureId) {
    const value=objectValue(entry);
    if (!value || value.expired!==false) return false;
    const expiresAt=Date.parse(safeText(value.expiresAt,80));
    if (!Number.isFinite(expiresAt) || expiresAt<=Date.now()) return false;
    const payload=objectValue(value.payload);
    if (!payload || payload.state!=='computing') return false;
    if (positiveSafeInteger(payload.fixtureId)!==fixtureId) return false;
    return Boolean(normalizeUuid(payload.claimId));
  }

  function sharedAnalysisPayload(value,cacheKey) {
    const payload=objectValue(value);
    const fixtureId=analysisFixtureIdFromCacheKey(cacheKey);
    if (!payload || !fixtureId) return null;
    return positiveSafeInteger(payload?.match?.fixtureId)===fixtureId
      ? payload
      : null;
  }

  async function clearExpiredLock(key,existing,cfg) {
    const now=Date.now();
    const local=objectValue(memory.cache.get(key));
    const localExpiresAt=typeof local?.expiresAt==='number' && Number.isFinite(local.expiresAt)
      ? local.expiresAt
      : null;
    if (local && localExpiresAt !== null && localExpiresAt<=now) {
      memory.cache.delete(key);
    }

    const nowIso=new Date(now).toISOString();
    await supaDelete(cfg,'analysis_cache',{
      cache_key:`eq.${key}`,
      expires_at:`lte.${nowIso}`,
    });

    const payload=objectValue(existing?.payload);
    return {
      previousClaimId:normalizeUuid(payload?.claimId),
      expiredAt:safeText(existing?.expiresAt,80) || null,
    };
  }

  async function claimDistributedAnalysisLock(fixtureId,cfg) {
    const id=positiveSafeInteger(fixtureId);
    const key=distributedAnalysisLockKey(id);
    if (!id || !key) {
      return {
        claimed:false,
        key:'',
        claimId:'',
        shared:false,
        degraded:true,
        unavailable:true,
        reason:'invalid_fixture_id',
      };
    }

    const supabase=supabaseAvailability(cfg);
    if (supabase.probeFailed) {
      safeTelemetry('analysisLockFailClosed');
      await safeRecord(cfg,{
        severity:'error',
        source:'analysis_lock',
        eventType:'analysis_lock_degraded',
        code:'ANALYSIS_LOCK_FAIL_CLOSED',
        message:'Supabase coordination availability could not be determined.',
        endpoint:'/api/analyze',
        meta:{fixtureId:id},
      });
      return {
        claimed:false,
        key,
        claimId:'',
        fixtureId:id,
        shared:false,
        degraded:true,
        unavailable:true,
        reason:'coordination_probe_failed',
      };
    }
    if (!supabase.configured) {
      return {
        claimed:true,
        key,
        claimId:'local-only',
        fixtureId:id,
        shared:false,
        degraded:false,
      };
    }

    const policy=lockPolicy();
    try {
      const existing=await getCacheEntry(key,cfg,true);
      if (existing && existing.expired!==true) {
        if (!validLockEntry(existing,id)) {
          safeTelemetry('analysisLockInvalidEntries');
          await safeRecord(cfg,{
            severity:'error',
            source:'analysis_lock',
            eventType:'analysis_lock_invalid_entry',
            code:'ANALYSIS_LOCK_ENTRY_INVALID',
            message:'Existing distributed analysis lock failed identity validation.',
            endpoint:'/api/analyze',
            meta:{fixtureId:id},
          });
          return {
            claimed:false,
            key,
            claimId:'',
            fixtureId:id,
            shared:false,
            degraded:true,
            unavailable:true,
            reason:'invalid_existing_lock',
          };
        }
        safeTelemetry('analysisLockJoins');
        return {
          claimed:false,
          key,
          claimId:'',
          fixtureId:id,
          shared:true,
          degraded:false,
        };
      }

      if (existing?.expired===true) {
        await clearExpiredLock(key,existing,cfg);
      }

      const claimId=createClaimId();
      const now=Date.now();
      const expiresAt=new Date(now+policy.ttlSeconds*1000).toISOString();
      const payload={
        state:'computing',
        fixtureId:id,
        claimId,
        claimedAt:new Date(now).toISOString(),
        version:safeText(APP_VERSION,80),
      };

      const url=analysisCacheInsertUrl(cfg);

      const response=await fetchWithTimeout(url,{
        method:'POST',
        headers:supaHeaders(cfg,{
          Prefer:'resolution=ignore-duplicates,return=representation',
        }),
        body:JSON.stringify([{
          cache_key:key,
          fixture_id:id,
          payload,
          expires_at:expiresAt,
        }]),
      },7000,'Supabase analysis compute lock');

      if (!response?.ok) {
        const status=positiveSafeInteger(response?.status) || 0;
        throw new Error(`analysis lock HTTP ${status}`);
      }

      const responseRows=await response.json().catch(()=>null);
      if (!Array.isArray(responseRows)) {
        throw new Error('analysis lock response payload invalid');
      }

      if (responseRows.length===0) {
        safeTelemetry('analysisLockJoins');
        return {
          claimed:false,
          key,
          claimId:'',
          fixtureId:id,
          shared:true,
          degraded:false,
        };
      }

      if (responseRows.length!==1) {
        throw new Error('analysis lock response cardinality invalid');
      }

      const row=objectValue(responseRows[0]);
      const rowPayload=objectValue(row?.payload);
      if (
        safeText(row?.cache_key,200)!==key
        || positiveSafeInteger(row?.fixture_id)!==id
        || normalizeUuid(rowPayload?.claimId)!==claimId
        || rowPayload?.state!=='computing'
      ) {
        throw new Error('analysis lock claim confirmation invalid');
      }

      memory.cache.set(key,{
        payload,
        expiresAt:Date.parse(expiresAt),
      });
      safeTelemetry('analysisLockClaims');
      return {
        claimed:true,
        key,
        claimId,
        fixtureId:id,
        shared:true,
        degraded:false,
      };
    } catch (error) {
      safeTelemetry('analysisLockFailClosed');
      await safeRecord(cfg,{
        severity:'error',
        source:'analysis_lock',
        eventType:'analysis_lock_degraded',
        code:'ANALYSIS_LOCK_FAIL_CLOSED',
        message:safeText(error?.message || error,240) || 'analysis lock unavailable',
        endpoint:'/api/analyze',
        meta:{fixtureId:id},
      });
      return {
        claimed:false,
        key,
        claimId:'',
        fixtureId:id,
        shared:false,
        degraded:true,
        unavailable:true,
        reason:'coordination_unavailable',
      };
    }
  }

  async function releaseDistributedAnalysisLock(lock,cfg) {
    const value=objectValue(lock);
    if (!value?.shared || !value?.claimId) {
      return {released:false,skipped:true,reason:'not_shared_owner'};
    }

    const key=safeText(value.key,160);
    const fixtureId=lockFixtureIdFromKey(key);
    const claimId=normalizeUuid(value.claimId);
    if (!key || !fixtureId || !claimId) {
      return {released:false,skipped:true,reason:'invalid_lock'};
    }
    const supabase=supabaseAvailability(cfg);
    if (supabase.probeFailed) {
      safeTelemetry('analysisLockReleaseFailures');
      return {released:false,skipped:false,reason:'coordination_probe_failed'};
    }
    if (!supabase.configured) {
      return {released:false,skipped:true,reason:'supabase_not_configured'};
    }

    try {
      const row=objectValue(await supaSelectOne(
        cfg,
        'analysis_cache',
        {cache_key:`eq.${key}`},
      ));
      if (!row) {
        const local=objectValue(memory.cache.get(key));
        if (normalizeUuid(local?.payload?.claimId)===claimId) {
          memory.cache.delete(key);
        }
        return {released:false,skipped:true,reason:'not_found'};
      }

      const payload=objectValue(row.payload);
      const rowKey=safeText(row.cache_key,160);
      const rowFixtureId=positiveSafeInteger(row.fixture_id);
      if (
        normalizeUuid(payload?.claimId)!==claimId
        || positiveSafeInteger(payload?.fixtureId)!==fixtureId
        || (rowKey && rowKey!==key)
        || (rowFixtureId && rowFixtureId!==fixtureId)
      ) {
        safeTelemetry('analysisLockReleaseOwnershipMisses');
        return {released:false,skipped:true,reason:'ownership_changed'};
      }

      await supaDelete(cfg,'analysis_cache',{
        cache_key:`eq.${key}`,
        fixture_id:`eq.${fixtureId}`,
        'payload->>claimId':`eq.${claimId}`,
      });

      const remaining=objectValue(await supaSelectOne(
        cfg,
        'analysis_cache',
        {cache_key:`eq.${key}`},
      ));
      if (normalizeUuid(remaining?.payload?.claimId)===claimId) {
        throw new Error('analysis lock release not confirmed');
      }

      const local=objectValue(memory.cache.get(key));
      if (normalizeUuid(local?.payload?.claimId)===claimId) {
        memory.cache.delete(key);
      }
      safeTelemetry('analysisLockReleases');
      return {released:true,skipped:false};
    } catch (error) {
      safeTelemetry('analysisLockReleaseFailures');
      await safeRecord(cfg,{
        severity:'warning',
        source:'analysis_lock',
        eventType:'analysis_lock_release',
        code:'ANALYSIS_LOCK_RELEASE_FAILED',
        message:safeText(error?.message || error,240) || 'analysis lock release failed',
        endpoint:'/api/analyze',
        meta:{fixtureId},
      });
      // TTL is the final safety net if cleanup fails.
      return {released:false,skipped:false,reason:'release_failed'};
    }
  }

  async function waitForSharedAnalysis(cacheKey,cfg) {
    const key=safeText(cacheKey,200);
    const fixtureId=analysisFixtureIdFromCacheKey(key);
    if (!key || !fixtureId) {
      safeTelemetry('analysisLockWaitInvalidKeys');
      return null;
    }

    const policy=lockPolicy();
    for (let attempt=0;attempt<policy.waitAttempts;attempt+=1) {
      try {
        await sleepMs(policy.waitMs);
      } catch {
        safeTelemetry('analysisLockWaitSleepFailures');
        return null;
      }

      let ready=null;
      try { ready=await getCache(key,cfg); } catch {}
      const payload=sharedAnalysisPayload(ready,key);
      if (payload) {
        safeTelemetry('analysisLockJoinHits');
        return payload;
      }
      if (ready) safeTelemetry('analysisLockJoinInvalidPayloads');
    }

    safeTelemetry('analysisLockTimeouts');
    return null;
  }

  function distributedAnalysisLockDrill() {
    const policy=lockPolicy();
    const key=distributedAnalysisLockKey(12345);
    return {
      pass:key==='analysis:compute-lock:12345:v1'
        && distributedAnalysisLockKey(true)===''
        && policy.ttlSeconds>=60
        && policy.maxWaitMs>=5000
        && policy.maxWaitMs<15000,
      ttlSeconds:policy.ttlSeconds,
      maxWaitMs:policy.maxWaitMs,
    };
  }

  return Object.freeze({
    distributedAnalysisLockKey,
    distributedAnalysisLockPolicy,
    claimDistributedAnalysisLock,
    releaseDistributedAnalysisLock,
    waitForSharedAnalysis,
    distributedAnalysisLockDrill,
  });
}
