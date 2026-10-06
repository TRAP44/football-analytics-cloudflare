export function createChannelPublishIdempotencyRuntime(deps = {}) {
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

  async function claimChannelPublishIdempotency(cacheKey, meta = {}, cfg) {
    const key=String(cacheKey || '').slice(0,160);
    const fixtureId=Number(meta.fixtureId || 0);
    if (!key.startsWith('telegram:channel-publish:v1:')) return {claimed:false,unavailable:true};
    try {
      const existing=await getCacheEntry(key,cfg,true);
      if (existing && !existing.expired) {
        return {
          claimed:false,
          duplicate:true,
          inProgress:existing.payload?.state === 'publishing',
          messageId:Number(existing.payload?.messageId || 0) || null,
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
        channelId:String(meta.channelId || '').slice(0,80),
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
        messageId:Number(current?.payload?.messageId || 0) || null,
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
    const key=String(cacheKey || '').slice(0,160);
    await setCache(key,Number(meta.fixtureId || 0),{
      state:'sent',
      claimId:String(meta.claimId || ''),
      fixtureId:Number(meta.fixtureId || 0),
      channelId:String(meta.channelId || '').slice(0,80),
      messageId:Number(meta.messageId || 0) || null,
      sentAt:new Date().toISOString(),
      version:APP_VERSION,
    },cfg,CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES);
  }
  
  async function releaseChannelPublishIdempotency(cacheKey, meta = {}, cfg) {
    const key=String(cacheKey || '').slice(0,160);
    const claimId=String(meta.claimId || '');
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

  return {
    claimChannelPublishIdempotency,
    completeChannelPublishIdempotency,
    releaseChannelPublishIdempotency
  };
}
