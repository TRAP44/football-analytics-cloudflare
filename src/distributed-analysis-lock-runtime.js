export function createDistributedAnalysisLockRuntime(deps = {}) {
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
    recordOpsEvent,
    sleepMs,
    supaDelete,
    supaHeaders,
    supaSelectOne
  } = deps;

  function distributedAnalysisLockKey(fixtureId) {
    return `analysis:compute-lock:${Number(fixtureId || 0)}:v1`;
  }
  
  function distributedAnalysisLockPolicy() {
    return {
      ttlSeconds:DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS,
      waitAttempts:DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS,
      waitMs:DISTRIBUTED_ANALYSIS_WAIT_MS,
      maxWaitMs:DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS*DISTRIBUTED_ANALYSIS_WAIT_MS,
    };
  }
  
  async function claimDistributedAnalysisLock(fixtureId,cfg) {
    const id=Number(fixtureId || 0);
    const key=distributedAnalysisLockKey(id);
    if (!hasSupabase(cfg)) return {claimed:true,key,claimId:'local-only',shared:false,degraded:false};
    try {
      const existing=await getCacheEntry(key,cfg,true).catch(()=>null);
      if (existing && !existing.expired) {
        bumpTelemetry('analysisLockJoins');
        return {claimed:false,key,claimId:'',shared:true,degraded:false};
      }
      if (existing?.expired) {
        memory.cache.delete(key);
        await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`}).catch(()=>null);
      }
  
      const claimId=crypto.randomUUID();
      const expiresAt=new Date(Date.now()+DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS*1000).toISOString();
      const payload={state:'computing',fixtureId:id,claimId,claimedAt:new Date().toISOString(),version:APP_VERSION};
      const url=new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
      url.searchParams.set('on_conflict','cache_key');
      const r=await fetchWithTimeout(url,{
        method:'POST',
        headers:supaHeaders(cfg,{Prefer:'resolution=ignore-duplicates,return=representation'}),
        body:JSON.stringify([{cache_key:key,fixture_id:id,payload,expires_at:expiresAt}]),
      },7000,'Supabase analysis compute lock');
      if (!r.ok) throw new Error(`analysis lock HTTP ${r.status}`);
      const rows=await r.json().catch(()=>[]);
      if (Array.isArray(rows) && rows.length===1) {
        memory.cache.set(key,{payload,expiresAt:Date.parse(expiresAt)});
        bumpTelemetry('analysisLockClaims');
        return {claimed:true,key,claimId,shared:true,degraded:false};
      }
      bumpTelemetry('analysisLockJoins');
      return {claimed:false,key,claimId:'',shared:true,degraded:false};
    } catch (error) {
      bumpTelemetry('analysisLockFailOpen');
      void recordOpsEvent(cfg,{
        severity:'error',
        source:'analysis_lock',
        eventType:'analysis_lock_degraded',
        code:'ANALYSIS_LOCK_FAIL_CLOSED',
        message:error?.message || error,
        endpoint:'/api/analyze',
        meta:{fixtureId:id},
      }).catch(()=>null);
      return {claimed:false,key,claimId:'',shared:false,degraded:true,unavailable:true};
    }
  }
  
  async function releaseDistributedAnalysisLock(lock,cfg) {
    if (!lock?.shared || !lock?.claimId) return;
    try {
      const row=await supaSelectOne(cfg,'analysis_cache',{cache_key:`eq.${lock.key}`});
      if (String(row?.payload?.claimId || '')!==String(lock.claimId)) return;
      memory.cache.delete(lock.key);
      await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${lock.key}`});
    } catch {
      // TTL is the final safety net if cleanup fails.
    }
  }
  
  async function waitForSharedAnalysis(cacheKey,cfg) {
    for (let attempt=0;attempt<DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS;attempt++) {
      await sleepMs(DISTRIBUTED_ANALYSIS_WAIT_MS);
      const ready=await getCache(cacheKey,cfg).catch(()=>null);
      if (ready) {
        bumpTelemetry('analysisLockJoinHits');
        return ready;
      }
    }
    bumpTelemetry('analysisLockTimeouts');
    return null;
  }
  
  function distributedAnalysisLockDrill() {
    const p=distributedAnalysisLockPolicy();
    const key=distributedAnalysisLockKey(12345);
    return {pass:key==='analysis:compute-lock:12345:v1' && p.ttlSeconds>=60 && p.maxWaitMs>=5000 && p.maxWaitMs<15000,ttlSeconds:p.ttlSeconds,maxWaitMs:p.maxWaitMs};
  }

  return {
    distributedAnalysisLockKey,
    distributedAnalysisLockPolicy,
    claimDistributedAnalysisLock,
    releaseDistributedAnalysisLock,
    waitForSharedAnalysis,
    distributedAnalysisLockDrill
  };
}
