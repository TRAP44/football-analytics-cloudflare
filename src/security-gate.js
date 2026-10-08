export const MAX_TELEGRAM_INIT_DATA_LENGTH = 16 * 1024;
export const MAX_API_BODY_BYTES = 64 * 1024;
export const MAX_TELEGRAM_WEBHOOK_BODY_BYTES = 256 * 1024;

const SAFE_API_METHODS = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD']);
const UNSAFE_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
const JSON_MUTATION_METHODS = new Set(['POST','PUT','PATCH']);
export const MAX_INVALID_AUTH_BUCKETS = 2048;
const INVALID_AUTH_PRUNE_SCAN_LIMIT = 64;
const MAX_TIMESTAMP_MS = 8.64e15;
const MAX_RETRY_AFTER_SECONDS = 3600;
const INVALID_AUTH_POLICIES = Object.freeze({
  public: { limit: 30, windowMs: 60_000 },
  admin: { limit: 12, windowMs: 60_000 },
});

const DISTRIBUTED_PREAUTH_POLICIES = Object.freeze({
  public: Object.freeze({ limit: 180, windowSeconds: 60, failClosed: false, distributed: false }),
  expensive: Object.freeze({ limit: 60, windowSeconds: 60, failClosed: true, distributed: true }),
  admin: Object.freeze({ limit: 24, windowSeconds: 60, failClosed: true, distributed: true }),
});

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function nonNegativeInteger(value,fallback=0) {
  const number=integerCandidate(value);
  return number !== null && number >= 0 ? number : fallback;
}

function boundedRetryAfter(value,fallback) {
  const number=integerCandidate(value);
  return number !== null && number >= 1 && number <= MAX_RETRY_AFTER_SECONDS
    ? number
    : fallback;
}

function safeClock(now) {
  try {
    const value=now();
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= MAX_TIMESTAMP_MS
      ? value
      : Date.now();
  } catch {
    return Date.now();
  }
}

function cleanError(value,fallback='security gate unavailable',maxLength=240) {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,maxLength);
}

function headerValue(request, name) {
  if (typeof name !== 'string') return '';
  try {
    const value=request?.headers?.get?.(name);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function requestMethod(request) {
  if (typeof request?.method !== 'string') return '';
  const method=request.method.trim().toUpperCase();
  return /^[A-Z]+$/.test(method) ? method : '';
}

function requestEndpoint(request) {
  if (typeof request?.url !== 'string' || !request.url.trim()) return '';
  try {
    return new URL(request.url).pathname;
  } catch {
    return '';
  }
}

const JSON_MEDIA_TYPE_RE=/^application\/json(?:\s*;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+\s*=\s*(?:"[^"\r\n]*"|[!#$%&'*+.^_`|~0-9A-Za-z-]+))*\s*$/i;

export function isJsonMediaType(value='') {
  return typeof value === 'string' && JSON_MEDIA_TYPE_RE.test(value.trim());
}

function declaredContentLength(request) {
  const raw=headerValue(request,'content-length');
  if (!raw) return null;
  if (!/^\d{1,12}$/.test(raw)) return Number.POSITIVE_INFINITY;
  const value=Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
}

function sameRequestOrigin(request, origin) {
  if (typeof origin !== 'string' || !origin.trim()) return true;
  if (typeof request?.url !== 'string') return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function bodyWithinLimit(request, maxBytes) {
  if (!request?.body) return true;
  let reader;
  try {
    reader=request.clone().body?.getReader?.();
    if (!reader) return false;
    let total=0;
    while (true) {
      const chunk=await reader.read();
      if (!plainObject(chunk) || typeof chunk.done !== 'boolean') return false;
      if (chunk.done) return true;
      const value=chunk.value;
      const size=typeof value?.byteLength === 'number'
        && Number.isSafeInteger(value.byteLength)
        && value.byteLength >= 0
        ? value.byteLength
        : typeof value?.length === 'number'
          && Number.isSafeInteger(value.length)
          && value.length >= 0
          ? value.length
          : null;
      if (size === null) return false;
      total+=size;
      if (!Number.isSafeInteger(total) || total>maxBytes) {
        try {
          const cancellation=reader.cancel();
          if (cancellation && typeof cancellation.catch==='function') {
            void cancellation.catch(()=>{});
          }
        } catch {}
        return false;
      }
    }
  } catch {
    try {
      const cancellation=reader?.cancel?.();
      if (cancellation && typeof cancellation.catch==='function') {
        void cancellation.catch(()=>{});
      }
    } catch {}
    return false;
  }
}

export async function preAuthRequestShapeDecision(request, {
  api=false,
  webhook=false,
} = {}) {
  const method=requestMethod(request);

  if (webhook === true) {
    if (method !== 'POST') {
      return { allowed:false, status:405, code:'WEBHOOK_METHOD_NOT_ALLOWED', error:'Метод не поддерживается.' };
    }
    const length=declaredContentLength(request);
    if (length!==null && length>MAX_TELEGRAM_WEBHOOK_BODY_BYTES) {
      return { allowed:false, status:413, code:'REQUEST_TOO_LARGE', error:'Запрос слишком большой.' };
    }
    if (length===null && !(await bodyWithinLimit(request,MAX_TELEGRAM_WEBHOOK_BODY_BYTES))) {
      return { allowed:false, status:413, code:'REQUEST_TOO_LARGE', error:'Запрос слишком большой.' };
    }
    const contentType=headerValue(request,'content-type');
    if (!isJsonMediaType(contentType)) {
      return { allowed:false, status:415, code:'UNSUPPORTED_MEDIA_TYPE', error:'Ожидается JSON.' };
    }
    return { allowed:true };
  }

  if (api !== true) return { allowed:true };

  if (!SAFE_API_METHODS.has(method)) {
    return { allowed:false, status:405, code:'API_METHOD_NOT_ALLOWED', error:'Метод не поддерживается.' };
  }

  const initData=headerValue(request,'x-telegram-init-data');
  if (initData.length>MAX_TELEGRAM_INIT_DATA_LENGTH) {
    return { allowed:false, status:431, code:'TELEGRAM_INIT_DATA_TOO_LARGE', error:'Данные авторизации слишком большие.' };
  }

  if (UNSAFE_METHODS.has(method)) {
    const length=declaredContentLength(request);
    if (length!==null && length>MAX_API_BODY_BYTES) {
      return { allowed:false, status:413, code:'REQUEST_TOO_LARGE', error:'Запрос слишком большой.' };
    }
    if (length===null && !(await bodyWithinLimit(request,MAX_API_BODY_BYTES))) {
      return { allowed:false, status:413, code:'REQUEST_TOO_LARGE', error:'Запрос слишком большой.' };
    }

    const origin=headerValue(request,'origin');
    if (origin && !sameRequestOrigin(request,origin)) {
      return { allowed:false, status:403, code:'CROSS_ORIGIN_MUTATION_BLOCKED', error:'Запрос отклонён.' };
    }

    const fetchSite=headerValue(request,'sec-fetch-site').toLowerCase();
    if (fetchSite==='cross-site') {
      return { allowed:false, status:403, code:'CROSS_SITE_MUTATION_BLOCKED', error:'Запрос отклонён.' };
    }

    const contentType=headerValue(request,'content-type');
    if (JSON_MUTATION_METHODS.has(method) && !isJsonMediaType(contentType)) {
      return { allowed:false, status:415, code:'UNSUPPORTED_MEDIA_TYPE', error:'Ожидается JSON.' };
    }
    if (!JSON_MUTATION_METHODS.has(method) && contentType && !isJsonMediaType(contentType)) {
      return { allowed:false, status:415, code:'UNSUPPORTED_MEDIA_TYPE', error:'Ожидается JSON.' };
    }
  }

  return { allowed:true };
}

async function sha256Hex(value='') {
  if (typeof value !== 'string') return '';
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function hmacSha256Hex(secret='', value='') {
  if (typeof secret !== 'string' || typeof value !== 'string' || !secret) return '';
  const keyBytes=new TextEncoder().encode(secret);
  const key=await crypto.subtle.importKey(
    'raw',
    keyBytes,
    {name:'HMAC',hash:'SHA-256'},
    false,
    ['sign'],
  );
  const signature=await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(signature)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function normalizeClientNetworkAddress(value='') {
  if (typeof value !== 'string') return '';
  let raw=value.trim().toLowerCase();
  if (!raw) return '';

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) {
    const parts=raw.split('.').map(part=>Number(part));
    if (parts.length!==4 || parts.some(part=>!Number.isInteger(part) || part<0 || part>255)) return '';
    return parts.join('.');
  }

  if (raw.startsWith('[') && raw.endsWith(']')) raw=raw.slice(1,-1);
  if (!raw.includes(':') || raw.includes('%')) return '';
  try {
    const normalized=new URL(`http://[${raw}]/`).hostname
      .replace(/^\[|\]$/g,'')
      .toLowerCase();
    return normalized.includes(':') ? normalized : '';
  } catch {
    return '';
  }
}

export async function privacyNetworkFingerprint(request, secret='') {
  const normalized=normalizeClientNetworkAddress(headerValue(request,'cf-connecting-ip'));
  if (!normalized) return '';
  if (typeof secret !== 'string' || secret.length>4096 || /[\u0000-\u001f\u007f-\u009f]/u.test(secret)) return '';
  const material=`matchradar-preauth-v2|${normalized}`;
  try {
    const digest=secret.trim()
      ? await hmacSha256Hex(secret,material)
      : await sha256Hex(material);
    return /^[a-f0-9]{64}$/.test(digest) ? digest.slice(0,24) : '';
  } catch {
    return '';
  }
}

function distributedPreAuthPolicy(endpoint, adminSensitive=false) {
  if (adminSensitive === true) return {scope:'admin',...DISTRIBUTED_PREAUTH_POLICIES.admin};
  if (endpoint==='/api/analyze') return {scope:'expensive',...DISTRIBUTED_PREAUTH_POLICIES.expensive};
  return {scope:'public',...DISTRIBUTED_PREAUTH_POLICIES.public};
}

export function distributedPreAuthPolicies() {
  return Object.fromEntries(
    Object.entries(DISTRIBUTED_PREAUTH_POLICIES).map(([scope,policy])=>[
      scope,
      {scope,...policy},
    ]),
  );
}

export async function enforceDistributedPreAuthRateLimit({
  request,
  cfg,
  adminSensitive=false,
  fingerprintSecret='',
  hasSupabase,
  supaRpc,
  bumpTelemetry=()=>{},
  recordOpsEvent=async()=>{},
  json,
} = {}) {
  if (!request || typeof json!=='function') throw new TypeError('distributed pre-auth limiter dependencies are required');

  const endpoint=requestEndpoint(request);
  if (!endpoint) {
    return json({
      error:'Запрос не может быть безопасно обработан.',
      code:'PREAUTH_REQUEST_INVALID',
    },400,{'cache-control':'no-store'});
  }

  const policy=distributedPreAuthPolicy(endpoint,adminSensitive);
  if (!policy.distributed) return null;
  const devMode=cfg?.devMode === true;

  const safeTelemetry=key=>{
    if (typeof bumpTelemetry !== 'function') return;
    try { bumpTelemetry(key); } catch {}
  };
  const safeRecord=async event=>{
    if (typeof recordOpsEvent !== 'function') return false;
    try {
      await recordOpsEvent(cfg,event);
      return true;
    } catch {
      return false;
    }
  };

  const failClosedResponse=()=>{
    safeTelemetry('securityPreAuthFailClosed');
    return json({
      error:'Защитный контур временно недоступен. Повторите немного позже.',
      code:'PREAUTH_RATE_GUARD_UNAVAILABLE',
      retryAfter:5,
    },503,{'retry-after':'5','cache-control':'no-store'});
  };

  const fingerprint=await privacyNetworkFingerprint(request,fingerprintSecret);
  if (!fingerprint) {
    if (policy.failClosed && !devMode) {
      const hourBucket=new Date().toISOString().slice(0,13);
      void safeRecord({
        severity:'warning',
        source:'security',
        eventType:'preauth_rate_limit',
        code:'PREAUTH_NETWORK_ID_UNAVAILABLE',
        message:'Sensitive pre-auth request was rejected because a stable network fingerprint was unavailable.',
        endpoint,
        status:503,
        transitionKey:`preauth-network-id-unavailable:${policy.scope}:${endpoint}:${hourBucket}`,
        meta:{scope:policy.scope,failClosed:true,hourBucket},
      });
      return failClosedResponse();
    }
    return null;
  }

  let supabaseAvailable=false;
  try {
    supabaseAvailable=typeof hasSupabase === 'function' && hasSupabase(cfg) === true;
  } catch {
    supabaseAvailable=false;
  }
  if (!supabaseAvailable || typeof supaRpc!=='function') {
    if (policy.failClosed && !devMode) return failClosedResponse();
    return null;
  }

  const bucketKey=`preauth:${policy.scope}:${fingerprint}`;
  try {
    const raw=await supaRpc(cfg,'claim_provider_request',{
      p_bucket_key:bucketKey,
      p_limit:policy.limit,
      p_window_seconds:policy.windowSeconds,
    },1800);
    const result=plainObject(raw);
    if (!result || typeof result.allowed !== 'boolean') {
      throw new Error('malformed pre-auth limiter response');
    }

    if (result.allowed === true) return null;

    const retryAfter=boundedRetryAfter(result.retryAfter,policy.windowSeconds);
    const minuteBucket=new Date().toISOString().slice(0,16);
    safeTelemetry('securityPreAuthBlocks');
    await safeRecord({
      severity:policy.scope==='admin' ? 'warning' : 'info',
      source:'security',
      eventType:'preauth_rate_limit',
      code:'PREAUTH_RATE_LIMIT_BLOCKED',
      message:'Unauthenticated request burst was blocked before Telegram credential verification.',
      endpoint,
      status:429,
      transitionKey:`preauth-rate-blocked:${policy.scope}:${endpoint}:${minuteBucket}`,
      meta:{
        scope:policy.scope,
        limit:policy.limit,
        windowSeconds:policy.windowSeconds,
        retryAfter,
        minuteBucket,
      },
    });
    return json({
      error:'Слишком много запросов за короткое время. Повторите позже.',
      code:'PREAUTH_RATE_LIMIT',
      retryAfter,
    },429,{'retry-after':String(retryAfter),'cache-control':'no-store'});
  } catch (error) {
    const hourBucket=new Date().toISOString().slice(0,13);
    safeTelemetry('securityPreAuthFallbacks');
    await safeRecord({
      severity:policy.failClosed ? 'error' : 'warning',
      source:'security',
      eventType:'preauth_rate_limit',
      code:'PREAUTH_RATE_LIMIT_DEGRADED',
      message:'Distributed pre-auth limiter unavailable; no provider error details retained.',
      endpoint,
      status:policy.failClosed ? 503 : null,
      transitionKey:`preauth-rate-degraded:${policy.scope}:${endpoint}:${hourBucket}`,
      meta:{scope:policy.scope,failClosed:policy.failClosed,hourBucket},
    });

    if (policy.failClosed && !devMode) return failClosedResponse();
    return null;
  }
}

function evictOldestBucket(map) {
  const oldestKey=map?.keys?.().next?.().value;
  if (oldestKey!==undefined) map.delete(oldestKey);
}

function ensureBucketCapacity(map, now=Date.now()) {
  if (!(map instanceof Map) || map.size<MAX_INVALID_AUTH_BUCKETS) return;
  let scanned=0;
  for (const [key,bucket] of map) {
    if (scanned>=INVALID_AUTH_PRUNE_SCAN_LIMIT) break;
    scanned+=1;
    const source=plainObject(bucket);
    const policy=INVALID_AUTH_POLICIES[source?.scope] || INVALID_AUTH_POLICIES.public;
    const startedAt=typeof source?.startedAt === 'number'
      && Number.isFinite(source.startedAt)
      && source.startedAt >= 0
      ? source.startedAt
      : null;
    if (startedAt===null || now<startedAt || now-startedAt>=policy.windowMs) map.delete(key);
  }
  while (map.size>=MAX_INVALID_AUTH_BUCKETS) evictOldestBucket(map);
}

export function createPreAuthAbuseGuard({
  memory,
  fingerprintSecret='',
  bumpTelemetry=()=>{},
  recordOpsEvent=async()=>{},
  now=Date.now,
} = {}) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }
  if (!(memory.authFailureBurst instanceof Map)) memory.authFailureBurst=new Map();
  if (typeof now !== 'function') throw new TypeError('now is required');

  const safeTelemetry=key=>{
    if (typeof bumpTelemetry !== 'function') return;
    try { bumpTelemetry(key); } catch {}
  };
  const safeRecord=async event=>{
    if (typeof recordOpsEvent !== 'function') return false;
    try {
      await recordOpsEvent(event);
      return true;
    } catch {
      return false;
    }
  };

  async function registerInvalidAuthFailure(request, { adminSensitive=false } = {}) {
    const fingerprint=await privacyNetworkFingerprint(request,fingerprintSecret);
    if (!fingerprint) return { blocked:false, tracked:false };

    const scope=adminSensitive === true ? 'admin' : 'public';
    const policy=INVALID_AUTH_POLICIES[scope];
    const key=`${scope}:${fingerprint}`;
    const timestamp=safeClock(now);
    const existing=plainObject(memory.authFailureBurst.get(key));
    const existingStartedAt=typeof existing?.startedAt === 'number'
      && Number.isFinite(existing.startedAt)
      && existing.startedAt >= 0
      ? existing.startedAt
      : null;
    const existingCount=nonNegativeInteger(existing?.count,-1);
    const bucketExpired=(
      !existing
      || existingStartedAt===null
      || existingCount<0
      || timestamp<existingStartedAt
      || timestamp-existingStartedAt>=policy.windowMs
    );
    const isNew=bucketExpired;
    const bucket=bucketExpired
      ? {scope,startedAt:timestamp,count:0,reported:false}
      : {
          scope,
          startedAt:existingStartedAt,
          count:existingCount,
          reported:existing.reported === true,
        };

    bucket.count+=1;
    if (isNew) ensureBucketCapacity(memory.authFailureBurst,timestamp);
    else memory.authFailureBurst.delete(key);
    memory.authFailureBurst.set(key,bucket);

    if (bucket.count<=policy.limit) {
      return {
        blocked:false,
        tracked:true,
        scope,
        remaining:Math.max(0,policy.limit-bucket.count),
      };
    }

    const elapsed=Math.max(0,timestamp-bucket.startedAt);
    const retryAfter=Math.max(1,Math.min(
      Math.ceil(policy.windowMs/1000),
      Math.ceil((policy.windowMs-elapsed)/1000),
    ));
    safeTelemetry('securityInvalidAuthBlocks');
    if (!bucket.reported) {
      bucket.reported=true;
      memory.authFailureBurst.set(key,bucket);
      await safeRecord({
        severity:'warning',
        source:'security',
        eventType:'invalid_auth_burst',
        code:'INVALID_AUTH_BURST_BLOCKED',
        message:'Repeated invalid Telegram authorization attempts were throttled.',
        status:429,
        meta:{scope,limit:policy.limit,windowSeconds:Math.round(policy.windowMs/1000)},
      });
    }
    return { blocked:true, tracked:true, scope, retryAfter };
  }

  return Object.freeze({
    registerInvalidAuthFailure,
    invalidAuthPolicies:()=>({
      public:{...INVALID_AUTH_POLICIES.public},
      admin:{...INVALID_AUTH_POLICIES.admin},
    }),
  });
}
