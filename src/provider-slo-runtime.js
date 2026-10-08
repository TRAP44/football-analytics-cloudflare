// Provider SLO persistence, incident ledger and alert delivery helpers extracted from worker.js.
// Persistence, provider observability and release primitives are injected by the composition root.
export function createProviderSloRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Provider SLO runtime dependencies are required.');
  }
  const {
    MAX_MEMORY_OPS_EVENTS,
    buildProviderSloIncidentTimeline,
    bumpTelemetry,
    currentReleaseIdentity,
    fetchWithTimeout,
    hasSupabase,
    memory,
    providerIncidentBotIdentity,
    providerIncidentDestinationKey,
    providerSloIncidentOpsEvent,
    providerSloWindowsFromBuckets,
    redactOpsString,
    restoreProviderObservabilityWindow,
    rotateProviderObservabilityWindow,
    safeOpsMetadata,
    summarizeProviderObservabilityWindows,
    supaHeaders,
    supaRpc,
    supaSelectMany,
  } = deps;

  function providerSloEventRow(snapshot = {}, report = {}, cfg = {}) {
    const state = String(report?.overall?.state || 'collecting');
    const severity = state === 'incident' ? 'error' : state === 'watch' ? 'warning' : 'info';
    return {
      created_at: new Date().toISOString(),
      severity,
      source: 'provider',
      event_type: 'slo_window',
      code: 'PROVIDER_SLO_WINDOW',
      message: 'Aggregated football provider SLO window.',
      endpoint: 'cron:production-monitor',
      status: null,
      duration_ms: null,
      metadata: safeOpsMetadata({
        ...currentReleaseIdentity(cfg),
        windowId: snapshot.windowId || `provider-slo:${snapshot.windowStartedAt || ''}`,
        windowStartedAt: snapshot.windowStartedAt,
        windowEndedAt: snapshot.windowEndedAt,
        complete: snapshot.complete !== false,
        series: snapshot.series,
        totals: snapshot.totals,
        sloState: state,
      }),
    };
  }
  
  async function persistProviderSloWindowRow(cfg, snapshot = {}) {
    const report=summarizeProviderObservabilityWindows([{metadata:snapshot}],{hours:1,includeCurrent:false});
    const row=providerSloEventRow(snapshot,report,cfg);
    if (hasSupabase(cfg)) {
      const url=new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
      const response=await fetchWithTimeout(url,{
        method:'POST',
        headers:supaHeaders(cfg,{Prefer:'return=minimal'}),
        body:JSON.stringify(row),
      },4000,'Supabase provider SLO window');
      if (!response.ok) throw new Error(`Provider SLO persistence HTTP ${response.status}`);
    }
    memory.opsEvents.unshift(row);
    memory.opsEvents=memory.opsEvents.slice(0,MAX_MEMORY_OPS_EVENTS);
    return {ok:true,state:report.overall.state,requests:Number(report.overall.requests || 0)};
  }
  
  async function flushProviderSloWindow(cfg) {
    const localSnapshot=rotateProviderObservabilityWindow();
    if (hasSupabase(cfg)) {
      try {
        const distributed=await readProviderSloWindows(cfg,2,{includeOpen:false,nowMs:Date.now()});
        if (distributed.distributed) {
          const latest=distributed.items.at(-1)?.metadata || null;
          if (!latest) return {skipped:true,reason:'no_completed_provider_slo_bucket',distributed:true};
          return {...await persistProviderSloWindowRow(cfg,latest),distributed:true,windowId:latest.windowId || null};
        }
      } catch {
        // Fall through to the local snapshot. SLO persistence must never break provider traffic.
      }
    }
  
    if (Number(localSnapshot?.totals?.attempts || 0)===0) {
      return {skipped:true,reason:'no_provider_requests',distributed:false};
    }
    try {
      return {...await persistProviderSloWindowRow(cfg,localSnapshot),distributed:false};
    } catch (error) {
      restoreProviderObservabilityWindow(localSnapshot);
      bumpTelemetry('providerSloPersistenceErrors');
      return {ok:false,error:redactOpsString(error?.message || error,160),distributed:false};
    }
  }
  
  async function readProviderSloWindows(cfg, hours = 24, { nowMs = Date.now(), includeOpen = true } = {}) {
    const safeHours=Math.max(1,Math.min(168,Number(hours || 24)));
    const safeNow=Number(nowMs || Date.now());
    const since=new Date(safeNow-safeHours*60*60_000).toISOString();
    const fallbackItems=memory.opsEvents.filter(item =>
      item?.source==='provider'
      && item?.code==='PROVIDER_SLO_WINDOW'
      && Date.parse(item?.metadata?.windowEndedAt || item?.created_at || '')>=Date.parse(since)
    ).slice(0,800);
    const fallback=()=>({
      persistent:false,
      migrationReady:false,
      distributed:false,
      items:fallbackItems,
      hours:safeHours,
    });
    if (!hasSupabase(cfg)) return fallback();
  
    try {
      const raw=await supaRpc(cfg,'read_provider_slo_buckets',{
        p_since:since,
        p_until:new Date(safeNow+15*60_000).toISOString(),
        p_limit:10000,
      },5000);
      const rows=Array.isArray(raw)
        ? raw
        : raw && typeof raw==='object' && raw.bucket_started_at
          ? [raw]
          : [];
      const items=providerSloWindowsFromBuckets(rows,{
        hours:safeHours,
        nowMs:safeNow,
        windowMinutes:15,
        includeOpen,
      });
      return {
        persistent:true,
        migrationReady:true,
        distributed:true,
        items,
        hours:safeHours,
        bucketRows:rows.length,
      };
    } catch {
      // Backward-compatible fallback for the DDL/deploy boundary and local development.
    }
  
    try {
      const url=new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
      url.searchParams.set('select','created_at,severity,source,event_type,code,metadata');
      url.searchParams.set('source','eq.provider');
      url.searchParams.set('code','eq.PROVIDER_SLO_WINDOW');
      url.searchParams.set('created_at',`gte.${since}`);
      url.searchParams.set('order','created_at.asc');
      url.searchParams.set('limit','800');
      const response=await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase provider SLO fallback');
      if (!response.ok) return fallback();
      const items=await response.json().catch(()=>[]);
      return {
        persistent:true,
        migrationReady:false,
        distributed:false,
        items:Array.isArray(items)?items:[],
        hours:safeHours,
      };
    } catch {
      return fallback();
    }
  }
  
  async function providerSloReport(cfg, hours = 24) {
    const source=await readProviderSloWindows(cfg,hours,{nowMs:Date.now(),includeOpen:true});
    const incidentSource=source.hours>=168
      ? await readProviderSloWindows(cfg,168,{nowMs:Date.now(),includeOpen:false})
      : await readProviderSloWindows(cfg,168,{nowMs:Date.now(),includeOpen:false});
    const report=summarizeProviderObservabilityWindows(source.items,{
      hours:source.hours,
      includeCurrent:!source.distributed,
    });
    return {
      ...report,
      incident:buildProviderSloIncidentTimeline(incidentSource.items),
      persistent:Boolean(source.persistent),
      distributed:Boolean(source.distributed),
      incidentPersistent:Boolean(incidentSource.persistent),
      incidentDistributed:Boolean(incidentSource.distributed),
      migrationReady:Boolean(source.migrationReady && incidentSource.migrationReady),
    };
  }
  
  async function readProviderIncidentAlertEvents(cfg, hours = 168) {
    const safeHours = Math.max(1, Math.min(336, Number(hours || 168)));
    const since = new Date(Date.now() - safeHours * 60 * 60_000).toISOString();
    const fallbackItems = memory.opsEvents.filter(item =>
      item?.source === 'provider_alert'
      && Date.parse(item?.created_at || '') >= Date.parse(since)
    ).slice(0,300);
    const fallback = () => ({ persistent:false, migrationReady:false, items:fallbackItems, hours:safeHours });
    if (!hasSupabase(cfg)) return fallback();
  
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
      url.searchParams.set('select','created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
      url.searchParams.set('source','eq.provider_alert');
      url.searchParams.set('created_at',`gte.${since}`);
      url.searchParams.set('order','created_at.asc');
      url.searchParams.set('limit','300');
      const response = await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase provider incident alerts');
      if (!response.ok) return fallback();
      const items = await response.json().catch(()=>[]);
      return { persistent:true, migrationReady:true, items:Array.isArray(items)?items:[], hours:safeHours };
    } catch {
      return fallback();
    }
  }
  
  
  async function providerIncidentAlertDestinations(cfg) {
    const admins=Array.isArray(cfg.adminTelegramIds) ? cfg.adminTelegramIds : [];
    const botIdentity=providerIncidentBotIdentity(cfg.botToken);
    const rows=await Promise.all(admins.map(async (chatId,slot)=>({
      slot,
      destinationKey:await providerIncidentDestinationKey(chatId,botIdentity),
    })));
    return rows.filter(row=>row.destinationKey);
  }
  
  async function readProviderIncidentAlertDeliveries(cfg, hours = 168) {
    const safeHours=typeof hours==='number' && Number.isFinite(hours) && hours>0
      ? Math.max(1,Math.min(336,Math.floor(hours))) : 168;
    if (!hasSupabase(cfg)) {
      return { ok:false, persistent:false, status:'not_configured', items:[], hours:safeHours };
    }
    const since = new Date(Date.now() - safeHours * 60 * 60_000).toISOString();
    try {
      const items = await supaSelectMany(cfg,'provider_incident_alert_deliveries',{
        created_at:`gte.${since}`,
      },{limit:500,order:'created_at.asc'});
      if (!Array.isArray(items)) {
        return { ok:false, persistent:false, status:'invalid_response', items:[], hours:safeHours };
      }
      return { ok:true, persistent:true, status:'ok', items, hours:safeHours };
    } catch (error) {
      return {
        ok:false,
        persistent:false,
        status:String(error?.code || 'error'),
        items:[],
        hours:safeHours,
        detail:redactOpsString(error?.message || error,160),
      };
    }
  }
  
  async function readProviderIncidentAlertDeliveryContract(cfg) {
    if (!hasSupabase(cfg)) return { ok:false, status:'not_configured', version:'' };
    try {
      const raw = await supaRpc(cfg,'provider_incident_alert_delivery_contract',{},3000);
      const fields={
        table:raw?.table === true,
        claimRpc:raw?.claimRpc === true,
        claimV2Rpc:raw?.claimV2Rpc === true,
        beginRpc:raw?.beginRpc === true,
        finalizeRpc:raw?.finalizeRpc === true,
        uniqueIdentity:raw?.uniqueIdentity === true,
        rls:raw?.rls === true,
      };
      const version=typeof raw?.version === 'string' ? raw.version : '';
      const ok=raw?.ok === true && version==='v2' && Object.values(fields).every(Boolean);
      return {
        ok,
        status:ok ? 'ok' : 'contract_mismatch',
        version,
        ...fields,
      };
    } catch (error) {
      return {
        ok:false,
        status:String(error?.code || 'error'),
        version:'',
        detail:redactOpsString(error?.message || error,160),
      };
    }
  }
  
  async function claimProviderIncidentAlertDelivery(cfg,input = {}) {
    if (!hasSupabase(cfg)) throw new Error('Persistent incident alert ledger is unavailable.');
    const raw = await supaRpc(cfg,'claim_provider_incident_alert_delivery_v2',{
      p_incident_id:String(input.incidentId || ''),
      p_transition:String(input.transition || ''),
      p_alert_key:String(input.alertKey || ''),
      p_destination_key:String(input.destinationKey || ''),
      p_destination_slot:Number(input.destinationSlot || 0),
      p_max_attempts:Math.max(1,Number(input.maxAttempts || 3)),
      p_lease_seconds:Math.max(30,Number(input.leaseSeconds || 120)),
    },4000);
    if (!raw || typeof raw.acquired !== 'boolean') {
      throw new Error('Persistent incident alert claim was not confirmed.');
    }
    return raw;
  }
  
  async function beginProviderIncidentAlertDeliverySend(cfg,input = {}) {
    if (!hasSupabase(cfg)) throw new Error('Persistent incident alert ledger is unavailable.');
    const raw=await supaRpc(cfg,'begin_provider_incident_alert_delivery_send',{
      p_alert_key:String(input.alertKey || ''),
      p_destination_key:String(input.destinationKey || ''),
    },4000);
    if (raw?.ok !== true || raw?.status !== 'sending') {
      throw new Error('Persistent incident alert begin-send transition was not confirmed: ' + String(raw?.reason || 'unknown'));
    }
    return raw;
  }
  
  async function finalizeProviderIncidentAlertDelivery(cfg,input = {}) {
    if (!hasSupabase(cfg)) throw new Error('Persistent incident alert ledger is unavailable.');
    const raw = await supaRpc(cfg,'finalize_provider_incident_alert_delivery',{
      p_alert_key:String(input.alertKey || ''),
      p_destination_key:String(input.destinationKey || ''),
      p_status:String(input.status || ''),
      p_retry_at:input.retryAt || null,
      p_http_status:Number.isFinite(Number(input.httpStatus)) ? Number(input.httpStatus) : null,
      p_error_code:input.errorCode ? String(input.errorCode).slice(0,80) : null,
      p_error_message:input.errorMessage ? redactOpsString(input.errorMessage,160) : null,
    },4000);
    if (raw?.ok !== true) {
      throw new Error('Persistent incident alert finalization was not confirmed: ' + String(raw?.reason || 'unknown'));
    }
    return raw;
  }
  
  function providerSloSelfTest() {
    const endedAt=new Date();
    const startedAt=new Date(endedAt.getTime()-15*60_000);
    const windowStartedAt=startedAt.toISOString();
    const windowEndedAt=endedAt.toISOString();
    const synthetic=summarizeProviderObservabilityWindows([
      {metadata:{windowId:'provider-slo:selftest',windowStartedAt,windowEndedAt,series:[
        {provider:'api-football',operation:'/fixtures',attempts:12,requests:10,successes:10,failures:0,retries:2,timeouts:0,networkErrors:0,rateLimits:0,httpErrors:0,invalidResponses:0,latencySumMs:1200,latencySamples:12,maxLatencyMs:200},
      ]}},
    ],{hours:24,includeCurrent:false});
    const collecting=summarizeProviderObservabilityWindows([
      {metadata:{windowId:'provider-slo:selftest-collecting',windowStartedAt,windowEndedAt,series:[
        {provider:'api-football',operation:'/fixtures',attempts:2,requests:2,successes:2,failures:0,retries:0,timeouts:0,networkErrors:0,rateLimits:0,httpErrors:0,invalidResponses:0,latencySumMs:100,latencySamples:2,maxLatencyMs:50},
      ]}},
    ],{hours:24,includeCurrent:false});
    return {
      pass:synthetic.overall.state==='watch'
        && synthetic.overall.requests===10
        && synthetic.overall.retries===2
        && collecting.overall.state==='collecting',
      state:synthetic.overall.state,
      collecting:collecting.overall.state,
    };
  }
  
  function providerSloIncidentSelfTest() {
    const windows = [
      { created_at:'2026-09-28T10:00:00Z', metadata:{ windowStartedAt:'2026-09-28T09:45:00Z', windowEndedAt:'2026-09-28T10:00:00Z', sloState:'healthy', totals:{requests:12,successRatePct:100} } },
      { created_at:'2026-09-28T10:15:00Z', metadata:{ windowStartedAt:'2026-09-28T10:00:00Z', windowEndedAt:'2026-09-28T10:15:00Z', sloState:'healthy', totals:{requests:11,successRatePct:100} } },
      { created_at:'2026-09-28T10:30:00Z', metadata:{ windowStartedAt:'2026-09-28T10:15:00Z', windowEndedAt:'2026-09-28T10:30:00Z', sloState:'watch', totals:{requests:10,successRatePct:97,retryRatePct:15} } },
      { created_at:'2026-09-28T10:45:00Z', metadata:{ windowStartedAt:'2026-09-28T10:30:00Z', windowEndedAt:'2026-09-28T10:45:00Z', sloState:'watch', totals:{requests:10,successRatePct:96,retryRatePct:18} } },
    ];
    const incident = buildProviderSloIncidentTimeline(windows,{nowMs:Date.parse('2026-09-28T11:00:00Z')});
    const event = providerSloIncidentOpsEvent(incident.transition);
    return {
      pass: incident.state === 'watch'
        && incident.activeIncident?.active === true
        && incident.transition?.kind === 'opened'
        && event?.code === 'PROVIDER_SLO_WATCH',
      state:incident.state,
      transition:incident.transition?.kind || '',
    };
  }

  return {
    providerSloEventRow,
    persistProviderSloWindowRow,
    flushProviderSloWindow,
    readProviderSloWindows,
    providerSloReport,
    readProviderIncidentAlertEvents,
    providerIncidentAlertDestinations,
    readProviderIncidentAlertDeliveries,
    readProviderIncidentAlertDeliveryContract,
    claimProviderIncidentAlertDelivery,
    beginProviderIncidentAlertDeliverySend,
    finalizeProviderIncidentAlertDelivery,
    providerSloSelfTest,
    providerSloIncidentSelfTest,
  };
}
