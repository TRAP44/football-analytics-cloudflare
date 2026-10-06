// Supabase connectivity and readiness probes extracted from worker.js.
// Transport, telemetry and retry primitives are injected by the composition root.
export function createSupabaseReadinessRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Supabase readiness runtime dependencies are required.');
  }
  const {
    bumpTelemetry,
    fetchWithTimeout,
    hasSupabase,
    redactOpsString,
    sleepMs,
    supaHeaders,
  } = deps;

  async function probeSupabase(cfg) {
    if (!hasSupabase(cfg)) return { configured: false, ok: false, status: 'not_configured', latencyMs: null, cache: null };
    const startedAt = Date.now();
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
      url.searchParams.set('select', 'cache_key,expires_at');
      url.searchParams.set('order', 'expires_at.desc');
      url.searchParams.set('limit', '200');
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg, { Prefer: 'count=exact' }) }, 7000, 'Supabase diagnostics');
      const latencyMs = Date.now() - startedAt;
      if (!r.ok) {
        bumpTelemetry('supabaseErrors');
        const text = await r.text().catch(() => '');
        return { configured: true, ok: false, status: `http_${r.status}`, latencyMs, detail: redactOpsString(text, 180), cache: null };
      }
      const rows = await r.json().catch(() => []);
      const now = Date.now();
      const fresh = rows.filter(x => Date.parse(x.expires_at || '') > now).length;
      const stale = rows.filter(x => Date.parse(x.expires_at || '') <= now).length;
      const range = r.headers.get('content-range') || '';
      const totalRaw = range.includes('/') ? range.split('/').pop() : '';
      const total = /^\d+$/.test(totalRaw) ? Number(totalRaw) : rows.length;
      return {
        configured: true,
        ok: true,
        status: 'ok',
        latencyMs,
        cache: { total, sampled: rows.length, freshInSample: fresh, staleInSample: stale, newestExpiry: rows?.[0]?.expires_at || null },
      };
    } catch (error) {
      bumpTelemetry('supabaseErrors');
      return { configured: true, ok: false, status: 'network_error', latencyMs: Date.now() - startedAt, detail: redactOpsString(error?.message || error, 180), cache: null };
    }
  }
  
  function combineSupabaseProbeAttempts(first = {}, second = null) {
    const firstOk=Boolean(first?.ok);
    if (firstOk) {
      return {
        ...first,
        attempts:1,
        recovered:false,
        confirmedFailure:false,
        initialStatus:first?.status || 'ok',
        initialLatencyMs:Number(first?.latencyMs || 0) || null,
      };
    }
  
    if (second && second.ok) {
      return {
        ...second,
        attempts:2,
        recovered:true,
        confirmedFailure:false,
        initialStatus:first?.status || 'unknown',
        initialLatencyMs:Number(first?.latencyMs || 0) || null,
      };
    }
  
    const final=second || first;
    return {
      ...final,
      attempts:second ? 2 : 1,
      recovered:false,
      confirmedFailure:true,
      initialStatus:first?.status || 'unknown',
      initialLatencyMs:Number(first?.latencyMs || 0) || null,
    };
  }
  
  async function probeSupabaseConfirmed(cfg, options = {}) {
    const first=await probeSupabase(cfg);
    if (first.ok || !first.configured) return combineSupabaseProbeAttempts(first);
    const retryDelayMs=Math.max(0,Math.min(1500,Number(options.retryDelayMs ?? 250)));
    if (retryDelayMs) await sleepMs(retryDelayMs);
    const second=await probeSupabase(cfg);
    const combined=combineSupabaseProbeAttempts(first,second);
    if (combined.recovered) bumpTelemetry('supabaseProbeRecoveries');
    if (combined.confirmedFailure) bumpTelemetry('supabaseProbeConfirmedFailures');
    return combined;
  }
  
  async function probeSupabaseReadiness(cfg) {
    if (!hasSupabase(cfg)) return { configured:false, ok:false, status:'not_configured', latencyMs:null };
    const startedAt=Date.now();
    try {
      const url=new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
      url.searchParams.set('select','cache_key');
      url.searchParams.set('limit','1');
      const response=await fetchWithTimeout(url,{headers:supaHeaders(cfg)},7000,'Supabase readiness');
      const latencyMs=Date.now()-startedAt;
      if (!response.ok) {
        bumpTelemetry('supabaseErrors');
        const detail=await response.text().catch(()=>'');
        return {configured:true,ok:false,status:`http_${response.status}`,latencyMs,detail:redactOpsString(detail,180)};
      }
      return {configured:true,ok:true,status:'ok',latencyMs};
    } catch (error) {
      bumpTelemetry('supabaseErrors');
      return {configured:true,ok:false,status:'network_error',latencyMs:Date.now()-startedAt,detail:redactOpsString(error?.message || error,180)};
    }
  }
  
  async function probeSupabaseReadinessConfirmed(cfg, options = {}) {
    const first=await probeSupabaseReadiness(cfg);
    if (first.ok || !first.configured) return combineSupabaseProbeAttempts(first);
    const retryDelayMs=Math.max(0,Math.min(1500,Number(options.retryDelayMs ?? 250)));
    if (retryDelayMs) await sleepMs(retryDelayMs);
    const second=await probeSupabaseReadiness(cfg);
    const combined=combineSupabaseProbeAttempts(first,second);
    if (combined.recovered) bumpTelemetry('supabaseProbeRecoveries');
    if (combined.confirmedFailure) bumpTelemetry('supabaseProbeConfirmedFailures');
    return combined;
  }

  return {
    probeSupabase,
    combineSupabaseProbeAttempts,
    probeSupabaseConfirmed,
    probeSupabaseReadiness,
    probeSupabaseReadinessConfirmed,
    supabaseProbeConfirmationSelfTest,
  };
}
