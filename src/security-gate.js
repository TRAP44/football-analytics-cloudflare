export const MAX_TELEGRAM_INIT_DATA_LENGTH = 16 * 1024;
export const MAX_API_BODY_BYTES = 64 * 1024;
export const MAX_TELEGRAM_WEBHOOK_BODY_BYTES = 256 * 1024;

const SAFE_API_METHODS = new Set(['GET','POST','PATCH','DELETE','HEAD']);
const UNSAFE_METHODS = new Set(['POST','PATCH','DELETE']);
const INVALID_AUTH_POLICIES = Object.freeze({
  public: { limit: 30, windowMs: 60_000 },
  admin: { limit: 12, windowMs: 60_000 },
});

function headerValue(request, name) {
  return String(request?.headers?.get?.(name) || '').trim();
}

function declaredContentLength(request) {
  const raw=headerValue(request,'content-length');
  if (!raw) return null;
  if (!/^\d{1,12}$/.test(raw)) return Number.POSITIVE_INFINITY;
  const value=Number(raw);
  return Number.isSafeInteger(value) && value>=0 ? value : Number.POSITIVE_INFINITY;
}

function sameRequestOrigin(request, origin) {
  if (!origin) return true;
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
    if (!reader) return true;
    let total=0;
    while (true) {
      const {done,value}=await reader.read();
      if (done) return true;
      total+=Number(value?.byteLength || value?.length || 0);
      if (total>maxBytes) {
        await reader.cancel().catch(()=>{});
        return false;
      }
    }
  } catch {
    try { await reader?.cancel?.(); } catch {}
    return false;
  }
}

export async function preAuthRequestShapeDecision(request, {
  api=false,
  webhook=false,
} = {}) {
  const method=String(request?.method || 'GET').toUpperCase();

  if (webhook) {
    if (method!=='POST') {
      return { allowed:false, status:405, code:'WEBHOOK_METHOD_NOT_ALLOWED', error:'Метод не поддерживается.' };
    }
    const length=declaredContentLength(request);
    if (length!==null && length>MAX_TELEGRAM_WEBHOOK_BODY_BYTES) {
      return { allowed:false, status:413, code:'REQUEST_TOO_LARGE', error:'Запрос слишком большой.' };
    }
    if (length===null && !(await bodyWithinLimit(request,MAX_TELEGRAM_WEBHOOK_BODY_BYTES))) {
      return { allowed:false, status:413, code:'REQUEST_TOO_LARGE', error:'Запрос слишком большой.' };
    }
    const contentType=headerValue(request,'content-type').toLowerCase();
    if (contentType && !contentType.startsWith('application/json')) {
      return { allowed:false, status:415, code:'UNSUPPORTED_MEDIA_TYPE', error:'Ожидается JSON.' };
    }
    return { allowed:true };
  }

  if (!api) return { allowed:true };

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

    const contentType=headerValue(request,'content-type').toLowerCase();
    if (contentType && !contentType.startsWith('application/json')) {
      return { allowed:false, status:415, code:'UNSUPPORTED_MEDIA_TYPE', error:'Ожидается JSON.' };
    }
  }

  return { allowed:true };
}

async function sha256Hex(value='') {
  const bytes=new TextEncoder().encode(String(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function clientNetworkFingerprint(request) {
  const ip=headerValue(request,'cf-connecting-ip');
  if (!ip) return '';
  return (await sha256Hex(`matchradar-security-v1|${ip}`)).slice(0,24);
}

function pruneBuckets(map, now=Date.now()) {
  if (!(map instanceof Map)) return;
  if (map.size<2000) return;
  for (const [key,bucket] of map) {
    const policy=INVALID_AUTH_POLICIES[bucket?.scope] || INVALID_AUTH_POLICIES.public;
    if (now-Number(bucket?.startedAt || 0)>policy.windowMs*2) map.delete(key);
  }
}

export function createPreAuthAbuseGuard({
  memory,
  bumpTelemetry=()=>{},
  recordOpsEvent=async()=>{},
} = {}) {
  if (!(memory?.authFailureBurst instanceof Map)) memory.authFailureBurst=new Map();

  async function registerInvalidAuthFailure(request, { adminSensitive=false } = {}) {
    const fingerprint=await clientNetworkFingerprint(request);
    if (!fingerprint) return { blocked:false, tracked:false };

    const scope=adminSensitive ? 'admin' : 'public';
    const policy=INVALID_AUTH_POLICIES[scope];
    const key=`${scope}:${fingerprint}`;
    const now=Date.now();
    let bucket=memory.authFailureBurst.get(key);
    if (!bucket || now-Number(bucket.startedAt || 0)>=policy.windowMs) {
      bucket={scope,startedAt:now,count:0,reported:false};
    }
    bucket.count+=1;
    memory.authFailureBurst.set(key,bucket);
    pruneBuckets(memory.authFailureBurst,now);

    if (bucket.count<=policy.limit) return { blocked:false, tracked:true, scope, remaining:policy.limit-bucket.count };

    const retryAfter=Math.max(1,Math.ceil((policy.windowMs-(now-bucket.startedAt))/1000));
    bumpTelemetry('securityInvalidAuthBlocks');
    if (!bucket.reported) {
      bucket.reported=true;
      memory.authFailureBurst.set(key,bucket);
      await recordOpsEvent({
        severity:'warning',
        source:'security',
        eventType:'invalid_auth_burst',
        code:'INVALID_AUTH_BURST_BLOCKED',
        message:'Repeated invalid Telegram authorization attempts were throttled.',
        status:429,
        meta:{scope,limit:policy.limit,windowSeconds:Math.round(policy.windowMs/1000)},
      }).catch(()=>{});
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
