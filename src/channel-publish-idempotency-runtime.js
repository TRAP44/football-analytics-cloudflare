export function createChannelPublishIdempotencyRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Channel publish idempotency dependencies are required.');
  }
  const {
    APP_VERSION,
    CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES,
    fetchWithTimeout,
    getCacheEntry,
    hasSupabase,
    memory,
    recordOpsEvent,
    setCache,
    supaDelete,
    supaHeaders
  } = deps;

  if (!memory || typeof memory !== 'object' || Array.isArray(memory) || !(memory.cache instanceof Map)) {
    throw new TypeError('Channel publish idempotency requires cache memory map.');
  }
  for (const [name,fn] of Object.entries({
    fetchWithTimeout,
    getCacheEntry,
    hasSupabase,
    recordOpsEvent,
    setCache,
    supaDelete,
    supaHeaders,
  })) {
    if (typeof fn !== 'function') throw new TypeError(`Channel publish idempotency requires ${name}.`);
  }

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || value.length > 24) return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function nonNegativeId(value) {
    const number=integerCandidate(value);
    return number !== null && number >= 0 ? number : 0;
  }

  function positiveId(value) {
    const number=integerCandidate(value);
    return number !== null && number > 0 ? number : null;
  }

  function safeText(value,max=160) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0,max);
  }

  async function claimChannelPublishIdempotency(cacheKey, meta = {}, cfg) {
    const key=safeText(cacheKey,160);
    const fixtureId=nonNegativeId(meta?.fixtureId);
    if (!key.startsWith('telegram:channel-publish:v1:')) return {claimed:false,unavailable:true};
    try {
      const existing=await getCacheEntry(key,cfg,true);
      if (existing && !existing.expired) {
        return {
          claimed:false,
          duplicate:true,
          inProgress:existing.payload?.state === 'publishing',
          messageId:positiveId(existing.payload?.messageId),
        };
      }
      if (existing?.expired) {
        memory.cache.delete(key);
        if (hasSupabase(cfg)) await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`}).catch(()=>null);
      }
  
      const claimId=crypto.randomUUID();
      const expiresAt=new Date(Date.now()+CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES*60_000).toISOString();
      const payload={
        state:'publishing',
        claimId,
        fixtureId,
        channelId:safeText(meta?.channelId,80),
        claimedAt:new Date().toISOString(),
        version:APP_VERSION,
      };
  
      if (!hasSupabase(cfg)) {
        memory.cache.set(key,{payload,expiresAt:Date.parse(expiresAt)});
        return {claimed:true,claimId,shared:false};
      }
  
      const url=new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
      url.searchParams.set('on_conflict','cache_key');
      const response=await fetchWithTimeout(url,{
        method:'POST',
        headers:supaHeaders(cfg,{Prefer:'resolution=ignore-duplicates,return=representation'}),
        body:JSON.stringify([{cache_key:key,fixture_id:fixtureId,payload,expires_at:expiresAt}]),
      },7000,'Telegram channel publish idempotency');
      if (!response.ok) throw new Error(`channel publisher idempotency HTTP ${response.status}`);
      const rows=await response.json().catch(()=>[]);
      if (Array.isArray(rows) && rows.length===1) {
        memory.cache.set(key,{payload,expiresAt:Date.parse(expiresAt)});
        return {claimed:true,claimId,shared:true};
      }
      const current=await getCacheEntry(key,cfg,true).catch(()=>null);
      return {
        claimed:false,
        duplicate:true,
        inProgress:current?.payload?.state === 'publishing',
        messageId:positiveId(current?.payload?.messageId),
        shared:true,
      };
    } catch (error) {
      void recordOpsEvent(cfg,{
        severity:'error',
        source:'channel_publisher',
        eventType:'idempotency',
        code:'CHANNEL_PUBLISH_IDEMPOTENCY_UNAVAILABLE',
        message:error?.message || error,
        endpoint:'/api/admin/channel-publisher/test',
        meta:{fixtureId},
      }).catch(()=>null);
      return {claimed:false,unavailable:true};
    }
  }
  
  async function completeChannelPublishIdempotency(cacheKey, meta = {}, cfg) {
    const key=safeText(cacheKey,160);
    const fixtureId=nonNegativeId(meta?.fixtureId);
    await setCache(key,fixtureId,{
      state:'sent',
      claimId:safeText(meta?.claimId,80),
      fixtureId,
      channelId:safeText(meta?.channelId,80),
      messageId:positiveId(meta?.messageId),
      sentAt:new Date().toISOString(),
      version:APP_VERSION,
    },cfg,CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES);
  }
  
  async function releaseChannelPublishIdempotency(cacheKey, meta = {}, cfg) {
    const key=safeText(cacheKey,160);
    const claimId=safeText(meta?.claimId,80);
    if (!key || !claimId) return;
    try {
      const current=await getCacheEntry(key,cfg,true).catch(()=>null);
      if (String(current?.payload?.claimId || '')!==claimId || current?.payload?.state!=='publishing') return;
      memory.cache.delete(key);
      if (hasSupabase(cfg)) await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${key}`});
    } catch {
      // A retained claim is safer than a duplicate channel post; TTL clears it later.
    }
  }

  return Object.freeze({
    claimChannelPublishIdempotency,
    completeChannelPublishIdempotency,
    releaseChannelPublishIdempotency
  });
}
