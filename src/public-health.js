export const PUBLIC_READINESS_CACHE_MS = 15_000;

function cleanText(value, fallback='', maxLength=120) {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,maxLength);
}

function cleanStatus(value, fallback='unknown') {
  return cleanText(value,fallback,80);
}

function strictBoolean(value, fallback=false) {
  return typeof value === 'boolean' ? value : fallback;
}

function numericCandidate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeLatency(value) {
  const number=numericCandidate(value);
  return number !== null && number >= 0 && number <= 300000 ? number : null;
}

function cacheDuration(value) {
  const number=numericCandidate(value);
  if (!Number.isSafeInteger(number) || number < 1) return PUBLIC_READINESS_CACHE_MS;
  return Math.min(300000,number);
}

function clockValue(now) {
  try {
    const value=typeof now === 'function' ? now() : Date.now();
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15
      ? value
      : Date.now();
  } catch {
    return Date.now();
  }
}

export function sanitizePublicReadiness(raw = {}) {
  const source=raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const checks=source.checks && typeof source.checks === 'object' && !Array.isArray(source.checks)
    ? source.checks
    : {};
  const supabase=checks.supabase && typeof checks.supabase === 'object' && !Array.isArray(checks.supabase)
    ? checks.supabase
    : {};
  const schema=checks.schema && typeof checks.schema === 'object' && !Array.isArray(checks.schema)
    ? checks.schema
    : {};
  const backendSecurity=checks.backendSecurity && typeof checks.backendSecurity === 'object' && !Array.isArray(checks.backendSecurity)
    ? checks.backendSecurity
    : {};
  const ok=strictBoolean(source.ok,false);

  return Object.freeze({
    ok,
    status:cleanStatus(source.status,ok ? 'ready' : 'not_ready'),
    version:cleanText(source.version,'',80),
    releaseCandidate:cleanText(source.releaseCandidate,'',80),
    latencyMs:nonNegativeLatency(source.latencyMs),
    checks:Object.freeze({
      supabase:Object.freeze({
        ok:strictBoolean(supabase.ok,false),
        status:cleanStatus(supabase.status),
      }),
      schema:Object.freeze({
        ok:strictBoolean(schema.ok,false),
        status:cleanStatus(schema.status),
      }),
      backendSecurity:Object.freeze({
        ok:strictBoolean(backendSecurity.ok,false),
        status:cleanStatus(backendSecurity.status),
      }),
      telegramConfigured:strictBoolean(checks.telegramConfigured,false),
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
  const ttlMs=cacheDuration(cacheMs);
  const publicVersion=cleanText(version,'',80);
  const publicReleaseCandidate=cleanText(releaseCandidate,'',80);

  function liveSnapshot() {
    return Object.freeze({
      ok:true,
      status:'alive',
      version:publicVersion,
      releaseCandidate:publicReleaseCandidate,
    });
  }

  async function readinessSnapshot(context) {
    const current=clockValue(now);
    if (
      cached
      && current >= cached.at
      && current-cached.at < ttlMs
    ) return cached.value;

    if (inFlight) return await inFlight;

    const task=Promise.resolve()
      .then(()=>computeReadiness(context))
      .then(value=>{
        const safe=sanitizePublicReadiness(value);
        cached={at:clockValue(now),value:safe};
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
      ok:readiness.ok === true,
      status:readiness.ok === true ? 'ready' : 'not_ready',
      version:publicVersion || readiness.version,
      releaseCandidate:publicReleaseCandidate || readiness.releaseCandidate,
      devMode:context?.devMode === true,
      readiness:Object.freeze({
        ok:readiness.ok === true,
        status:cleanStatus(readiness.status,'not_ready'),
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
