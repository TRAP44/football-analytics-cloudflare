// Release monitor history readers and API endpoints extracted from worker.js.
// Persistence, regression and digest helpers are injected by the composition root.
export function createReleaseMonitorApiRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Release monitor API runtime dependencies are required.');
  }
  const {
    APP_VERSION,
    RC_NAME,
    assessDailyDigestReliabilitySlo,
    buildPostDeployRegressionSloDashboard,
    currentReleaseIdentity,
    fetchWithTimeout,
    hasSupabase,
    json,
    memory,
    planPostDeployRegressionResponseTransition,
    readProviderIncidentAlertDeliveries,
    recordOpsEvent,
    redactOpsString,
    releaseMonitorHealth,
    summarizeDailyDigestOperationalStatus,
    summarizeDailyDigestReliability,
    summarizePostDeployRegressionResponse,
    summarizeReleaseWindow,
    supaHeaders,
    telemetrySnapshot,
  } = deps;

  function boundedPositiveInteger(value, fallback, max) {
    let number=null;
    if (typeof value === 'number') number=value;
    else if (typeof value === 'string' && /^\d+$/.test(value.trim())) number=Number(value.trim());
    const safeFallback=Number.isSafeInteger(fallback) && fallback > 0 ? fallback : 1;
    if (!Number.isSafeInteger(number) || number <= 0) return Math.min(max,safeFallback);
    return Math.min(max,number);
  }

  async function readOpsEventsRange(cfg, startIso, endIso, limit = 600) {
    const startMs = Date.parse(startIso || '');
    const endMs = Date.parse(endIso || '');
    const cap=boundedPositiveInteger(limit,600,1000);
    const fallbackItems = memory.opsEvents.filter(item => {
      const t = Date.parse(item?.created_at || '');
      return Number.isFinite(t) && t >= startMs && t < endMs;
    }).slice(0, cap);
    const fallback = () => ({ persistent: false, migrationReady: false, items: fallbackItems });
    if (!hasSupabase(cfg)) return fallback();
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
      url.searchParams.set('select', 'created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
      url.searchParams.set('created_at', `gte.${startIso}`);
      url.searchParams.append('created_at', `lt.${endIso}`);
      url.searchParams.set('order', 'created_at.desc');
      url.searchParams.set('limit', String(cap));
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase release monitor');
      if (!r.ok) return fallback();
      const items = await r.json();
      if (!Array.isArray(items)) return fallback();
      return { persistent: true, migrationReady: true, items };
    } catch {
      return fallback();
    }
  }
  
  async function readDailyDigestOpsEvents(cfg, startIso, endIso, limit = 1000) {
    const startMs=Date.parse(startIso || '');
    const endMs=Date.parse(endIso || '');
    const cap=boundedPositiveInteger(limit,1000,1000);
    const fallbackMatches=memory.opsEvents.filter(item => {
      const t=Date.parse(item?.created_at || '');
      return Number.isFinite(t)
        && t>=startMs
        && t<endMs
        && item?.source==='telegram'
        && item?.event_type==='daily_digest';
    }).sort((a,b)=>Date.parse(b?.created_at || '')-Date.parse(a?.created_at || ''));
    const fallback=()=>({
      persistent:false,
      migrationReady:false,
      items:fallbackMatches.slice(0,cap),
      truncated:fallbackMatches.length>cap,
    });
    if (!hasSupabase(cfg)) return fallback();
    try {
      const url=new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
      url.searchParams.set('select','created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
      url.searchParams.set('source','eq.telegram');
      url.searchParams.set('event_type','eq.daily_digest');
      url.searchParams.set('created_at',`gte.${startIso}`);
      url.searchParams.append('created_at',`lt.${endIso}`);
      url.searchParams.set('order','created_at.desc');
      url.searchParams.set('limit',String(cap));
      const r=await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase daily digest reliability');
      if (!r.ok) return fallback();
      const items=await r.json();
      if (!Array.isArray(items)) return fallback();
      let truncated=false;
      if (items.length===cap) {
        const probeUrl=new URL(url);
        probeUrl.searchParams.set('offset',String(cap));
        probeUrl.searchParams.set('limit','1');
        const probe=await fetchWithTimeout(probeUrl,{headers:supaHeaders(cfg)},7000,'Supabase daily digest reliability probe');
        if (!probe.ok) return fallback();
        const probeItems=await probe.json();
        if (!Array.isArray(probeItems)) return fallback();
        truncated=probeItems.length>0;
      }
      return {
        persistent:true,
        migrationReady:true,
        items:items.slice(0,cap),
        truncated,
      };
    } catch {
      return fallback();
    }
  }
  
  
  async function readDailyDigestSloEvents(cfg, startIso, endIso, limit = 100) {
    const startMs=Date.parse(startIso || '');
    const endMs=Date.parse(endIso || '');
    const cap=boundedPositiveInteger(limit,100,500);
    const fallbackItems=memory.opsEvents.filter(item => {
      const t=Date.parse(item?.created_at || '');
      return Number.isFinite(t)
        && t>=startMs
        && t<endMs
        && item?.source==='digest_slo'
        && item?.event_type==='reliability_slo';
    }).sort((a,b)=>Date.parse(b?.created_at || '')-Date.parse(a?.created_at || '')).slice(0,cap);
    const fallback=()=>({persistent:false,items:fallbackItems});
    if (!hasSupabase(cfg)) return fallback();
    try {
      const url=new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
      url.searchParams.set('select','created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
      url.searchParams.set('source','eq.digest_slo');
      url.searchParams.set('event_type','eq.reliability_slo');
      url.searchParams.set('created_at',`gte.${startIso}`);
      url.searchParams.append('created_at',`lt.${endIso}`);
      url.searchParams.set('order','created_at.desc');
      url.searchParams.set('limit',String(cap));
      const r=await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase daily digest SLO');
      if (!r.ok) return fallback();
      const items=await r.json();
      if (!Array.isArray(items)) return fallback();
      return {persistent:true,items};
    } catch {
      return fallback();
    }
  }
  
  async function apiPostDeployRegressionResponse(request,cfg,user) {
    if (request.method!=='POST') return json({error:'Метод не поддерживается.'},405);
    if (!hasSupabase(cfg)) return json({error:'Supabase не настроен.'},503);
  
    let body={};
    try { body=await request.json(); } catch {}
    const targetState=String(body?.state || '');
    const identity=currentReleaseIdentity(cfg);
    const deploySha=String(identity?.deploySha || '').trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(deploySha)) {
      return json({error:'Active deployment identity временно недоступен.'},503);
    }
    const requestedSha=typeof body?.deploySha === 'string'
      ? body.deploySha.trim().toLowerCase()
      : '';
    if (!/^[0-9a-f]{40}$/.test(requestedSha) || requestedSha!==deploySha) {
      return json({error:'Deployment уже изменился. Обновите Release Monitor.'},409);
    }
  
    const now=new Date();
    const since=new Date(now.getTime()-7*24*3600_000);
    const source=await readOpsEventsRange(cfg,since.toISOString(),now.toISOString(),1000);
    if (!source.persistent) return json({error:'Persistent ops history временно недоступна.'},503);
    if (source.truncated) return json({error:'Ops history усечена; переход не сохранён для безопасности.'},503);
  
    const plan=planPostDeployRegressionResponseTransition(source.items,deploySha,targetState);
    if (plan.action!=='record') {
      if (plan.reason==='already_recorded') return json({ok:true,alreadyRecorded:true,status:plan.status});
      return json({error:'Переход состояния инцидента сейчас недоступен.',reason:plan.reason,status:plan.status},409);
    }
  
    const written=await recordOpsEvent(cfg,plan).catch(()=>null);
    if (!written || String(written?._persistenceStatus || '')!=='persistent') {
      return json({error:'Не удалось сохранить состояние инцидента.'},503);
    }
  
    memory.releaseMonitor=null;
    const status=summarizePostDeployRegressionResponse([...source.items,written],deploySha);
    return json({
      ok:true,
      incidentId:status.incidentId,
      state:status.state,
      lifecycleState:status.lifecycleState,
      status,
    });
  }
  
  async function apiReleaseMonitor(request, cfg) {
    const url = new URL(request.url);
    const hours=boundedPositiveInteger(url.searchParams.get('hours') || 24,24,168);
    const requestedDigestDays=boundedPositiveInteger(url.searchParams.get('digestDays') || 7,7,30);
    const digestDays=requestedDigestDays>=30 ? 30 : 7;
    const force = url.searchParams.get('refresh') === '1';
    const cacheKey = `h${hours}:d${digestDays}`;
    const cached = memory.releaseMonitor?.[cacheKey];
    if (!force && cached?.value && Date.now() - Number(cached.at || 0) < 30000) {
      return json({ ...cached.value, cached: true });
    }
  
    const end = new Date();
    const currentStart = new Date(end.getTime() - hours * 3600_000);
    const previousStart = new Date(currentStart.getTime() - hours * 3600_000);
    const digestStart = new Date(end.getTime() - digestDays * 24 * 3600_000);
    const [source,digestAlertLedger,digestHistory] = await Promise.all([
      readOpsEventsRange(cfg, previousStart.toISOString(), end.toISOString(), 1000),
      readProviderIncidentAlertDeliveries(cfg,336),
      readDailyDigestOpsEvents(cfg,digestStart.toISOString(),end.toISOString(),1000),
    ]);
    const currentItems = source.items.filter(x => Date.parse(x.created_at || '') >= currentStart.getTime());
    const activeDeploySha=String(currentReleaseIdentity(cfg)?.deploySha || '').toLowerCase();
    const postDeployRegressionResponse=summarizePostDeployRegressionResponse(source.items,activeDeploySha);
    const postDeployRegressionTimeline=source.items
      .filter(x => ['release_regression','release_regression_alert','release_regression_response'].includes(String(x?.source || '')))
      .filter(x => String(x?.metadata?.deploySha || '').toLowerCase()===activeDeploySha)
      .sort((a,b)=>Date.parse(b?.created_at || '')-Date.parse(a?.created_at || ''))
      .slice(0,30)
      .map(x=>({
        createdAt:x.created_at,
        severity:String(x.severity || 'info'),
        source:String(x.source || ''),
        code:String(x.code || x.event_type || ''),
        lifecycleState:String(x?.metadata?.lifecycleState || ''),
        responseState:String(x?.metadata?.responseState || ''),
        message:redactOpsString(x.message || '',180),
      }));
    const postDeployRegressionSlo=buildPostDeployRegressionSloDashboard(source.items,{
      activeDeploySha,
      asOfMs:end.getTime(),
      limit:20,
    });
    const previousItems = source.items.filter(x => {
      const t = Date.parse(x.created_at || '');
      return Number.isFinite(t) && t >= previousStart.getTime() && t < currentStart.getTime();
    });
    const current = summarizeReleaseWindow(currentItems, hours);
    const previous = summarizeReleaseWindow(previousItems, hours);
    const health = releaseMonitorHealth(current, source.persistent);
    const digestEvents=digestHistory.items;
    const dailyDigest={
      ...summarizeDailyDigestOperationalStatus(
        digestEvents,
        digestAlertLedger.items,
        {nowMs:end.getTime()},
      ),
      reliability:summarizeDailyDigestReliability(
        digestEvents,
        {days:digestDays,nowMs:end.getTime()},
      ),
      reliabilitySlo:assessDailyDigestReliabilitySlo(
        digestEvents,
        {
          days:7,
          nowMs:end.getTime(),
          evidenceComplete:Boolean(digestHistory.persistent && !digestHistory.truncated),
        },
      ),
      historyPersistent:Boolean(digestHistory.persistent),
      historyTruncated:Boolean(digestHistory.truncated),
    };
    const incidents = currentItems
      .filter(x => ['warning','error','critical'].includes(String(x.severity || '')))
      .slice(0, 12)
      .map(x => ({
        createdAt: x.created_at,
        severity: x.severity,
        source: x.source,
        code: x.code || x.event_type,
        message: redactOpsString(x.message || '', 180),
        endpoint: x.endpoint || '',
      }));
  
    const value = {
      available: true,
      version: APP_VERSION,
      releaseCandidate: RC_NAME,
      generatedAt: new Date().toISOString(),
      hours,
      digestDays,
      persistent: source.persistent,
      migrationReady: source.migrationReady,
      health,
      current,
      previous,
      trend: {
        errorsDelta: current.errorLike - previous.errorLike,
        warningsDelta: current.warningLike - previous.warningLike,
        clientErrorsDelta: Number(current.client?.clientErrors || 0) - Number(previous.client?.clientErrors || 0),
        bootRecoveryDelta: Number(current.client?.bootRecovery || 0) - Number(previous.client?.bootRecovery || 0),
      },
      incidents,
      postDeployRegression:{
        response:postDeployRegressionResponse,
        slo:postDeployRegressionSlo,
        timeline:postDeployRegressionTimeline,
      },
      dailyDigest,
      runtime: telemetrySnapshot(),
      policy: {
        noFootballApiCalls: true,
        noUserDataMutation: true,
        telemetryPrivacy: 'Телеметрия клиента ограничена разрешёнными полями и не содержит свободный текст чата или пользовательский контент.',
        note: 'Операционный бюджет считает сохранённые ошибки и критические события; это сигнал для выпуска, а не формальный показатель доступности.',
      },
    };
    memory.releaseMonitor ||= {};
    memory.releaseMonitor[cacheKey] = { at: Date.now(), value };
    return json(value);
  }

  return {
    readOpsEventsRange,
    readDailyDigestOpsEvents,
    readDailyDigestSloEvents,
    apiPostDeployRegressionResponse,
    apiReleaseMonitor,
  };
}
