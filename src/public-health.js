export const PUBLIC_READINESS_CACHE_MS = 15_000;

function cleanStatus(value, fallback='unknown') {
  const text=String(value || '').trim();
  return text || fallback;
}

export function sanitizePublicReadiness(raw = {}) {
  const checks=raw?.checks && typeof raw.checks==='object' ? raw.checks : {};
  return Object.freeze({
    ok:Boolean(raw?.ok),
    status:cleanStatus(raw?.status, raw?.ok ? 'ready' : 'not_ready'),
    version:String(raw?.version || ''),
    releaseCandidate:String(raw?.releaseCandidate || ''),
    latencyMs:Number.isFinite(Number(raw?.latencyMs)) ? Number(raw.latencyMs) : null,
    checks:Object.freeze({
      supabase:Object.freeze({
        ok:Boolean(checks?.supabase?.ok),
        status:cleanStatus(checks?.supabase?.status),
      }),
      schema:Object.freeze({
        ok:Boolean(checks?.schema?.ok),
        status:cleanStatus(checks?.schema?.status),
      }),
      backendSecurity:Object.freeze({
        ok:Boolean(checks?.backendSecurity?.ok),
        status:cleanStatus(checks?.backendSecurity?.status),
      }),
      telegramConfigured:Boolean(checks?.telegramConfigured),
    }),
  });
}

export function createPublicHealthRuntime({
  computeReadiness,
  version='',
  releaseCandidate='',
  cacheMs=PUBLIC_READINESS_CACHE_MS,
  now=Date.now,
} = {}) {
  if (typeof computeReadiness!=='function') throw new TypeError('computeReadiness is required');

  let cached=null;
  let inFlight=null;

  function liveSnapshot() {
    return Object.freeze({
      ok:true,
      status:'alive',
      version:String(version || ''),
      releaseCandidate:String(releaseCandidate || ''),
    });
  }

  async function readinessSnapshot(context) {
    const current=Number(now());
    if (
      cached
      && Number.isFinite(current)
      && current-Number(cached.at || 0) < Math.max(1,Number(cacheMs || PUBLIC_READINESS_CACHE_MS))
    ) return cached.value;

    if (inFlight) return await inFlight;

    const task=Promise.resolve()
      .then(()=>computeReadiness(context))
      .then(value=>{
        const safe=sanitizePublicReadiness(value);
        cached={at:Number(now()),value:safe};
        return safe;
      });

    inFlight=task;
    try {
      return await task;
    } finally {
      if (inFlight===task) inFlight=null;
    }
  }

  async function healthSnapshot(context) {
    const readiness=await readinessSnapshot(context);
    return Object.freeze({
      ok:Boolean(readiness.ok),
      status:readiness.ok ? 'ready' : 'not_ready',
      version:String(version || readiness.version || ''),
      releaseCandidate:String(releaseCandidate || readiness.releaseCandidate || ''),
      devMode:Boolean(context?.devMode),
      readiness:Object.freeze({
        ok:Boolean(readiness.ok),
        status:String(readiness.status || ''),
      }),
    });
  }

  function invalidate() {
    cached=null;
  }

  return Object.freeze({
    liveSnapshot,
    readinessSnapshot,
    healthSnapshot,
    invalidate,
  });
}
