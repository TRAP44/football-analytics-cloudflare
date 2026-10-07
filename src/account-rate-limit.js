import { privilegedDistributedRatePolicy, privilegedRatePolicyInventory } from './security-route-registry.js';

const PUBLIC_ACCOUNT_POLICIES = Object.freeze([
  Object.freeze({ test:(p,m)=>p==='/api/analyze', limit:6, windowSeconds:60, label:'analysis' }),
  Object.freeze({ test:(p,m)=>p==='/api/match-center', limit:48, windowSeconds:60, label:'match-center' }),
  Object.freeze({ test:(p,m)=>p==='/api/search', limit:60, windowSeconds:60, label:'search' }),
  Object.freeze({ test:(p,m)=>p==='/api/tournament', limit:48, windowSeconds:60, label:'tournament' }),
  Object.freeze({ test:(p,m)=>p==='/api/team' || p.startsWith('/api/team/'), limit:60, windowSeconds:60, label:'team' }),
  Object.freeze({ test:(p,m)=>p==='/api/client-telemetry', limit:12, windowSeconds:60, label:'client-telemetry' }),
  Object.freeze({ test:(p,m)=>p==='/api/beta-feedback', limit:4, windowSeconds:60, label:'beta-feedback' }),
  Object.freeze({ test:(p,m)=>p==='/api/favorites' && m!=='GET', limit:20, windowSeconds:60, label:'favorites-write' }),
  Object.freeze({ test:(p,m)=>p==='/api/favorite-players' && m!=='GET', limit:20, windowSeconds:60, label:'favorite-players-write' }),
  Object.freeze({ test:(p,m)=>p==='/api/reminders' && m!=='GET', limit:20, windowSeconds:60, label:'reminders-write' }),
  Object.freeze({ test:(p,m)=>p==='/api/preferences' && m!=='GET', limit:20, windowSeconds:60, label:'preferences-write' }),
  Object.freeze({ test:(p,m)=>p.startsWith('/api/billing/') && m!=='GET', limit:10, windowSeconds:60, label:'billing-write' }),
]);

function plainObject(value) {
  return value && typeof value==='object' && !Array.isArray(value) ? value : null;
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeText(value,max=180,fallback='') {
  if (!['string','number','bigint'].includes(typeof value)) return fallback;
  try {
    const text=String(value)
      .replace(/[\u0000-\u001f\u007f]+/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,max);
    return text || fallback;
  } catch {
    return fallback;
  }
}

function requestIdentity(request) {
  const rawUrl=safeRead(request,'url');
  if (typeof rawUrl!=='string' || !rawUrl) return null;

  let url;
  try {
    url=new URL(rawUrl);
  } catch {
    return null;
  }

  const rawMethod=safeRead(request,'method');
  const method=typeof rawMethod==='string'
    ? rawMethod.trim().toUpperCase()
    : '';
  if (!/^[A-Z]+$/.test(method)) return null;

  return {pathname:url.pathname,method};
}

function positiveUserId(user) {
  const raw=safeRead(user,'id');
  if (typeof raw==='number') {
    return Number.isSafeInteger(raw) && raw>0 ? raw : 0;
  }
  if (typeof raw!=='string') return 0;
  const text=raw.trim();
  if (!/^\d+$/.test(text)) return 0;
  const id=Number(text);
  return Number.isSafeInteger(id) && id>0 ? id : 0;
}

function boundedRetryAfter(value,fallback) {
  let number=null;
  if (typeof value==='number' && Number.isFinite(value)) {
    number=value;
  } else if (typeof value==='string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    number=Number(value.trim());
  }
  if (number===null || !Number.isFinite(number) || number<=0) return fallback;
  return Math.max(1,Math.min(3600,Math.ceil(number)));
}

function safeTelemetry(fn,key) {
  try {
    if (typeof fn==='function') fn(key);
  } catch {}
}

function safeMemoryRead(memory,key) {
  return safeRead(plainObject(memory),key);
}

function safeMemoryWrite(memory,key,value) {
  const target=plainObject(memory);
  if (!target) return false;
  try {
    target[key]=value;
    return true;
  } catch {
    return false;
  }
}

function safeErrorMessage(error) {
  return safeText(
    safeRead(error,'message') ?? safeRead(error,'code') ?? error,
    180,
    'distributed account limiter unavailable',
  );
}

export function accountRatePolicyForRequest(request) {
  const identity=requestIdentity(request);
  if (!identity) return null;
  const {pathname,method}=identity;
  return PUBLIC_ACCOUNT_POLICIES.find(policy=>policy.test(pathname,method))
    || privilegedDistributedRatePolicy(pathname,method);
}

export function accountRateLimitBucketKey(user, policy) {
  const userId=positiveUserId(user);
  const rawLabel=safeRead(policy,'label');
  const label=typeof rawLabel==='string' ? rawLabel.trim() : '';
  if (!userId || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(label)) return '';
  return `route:${userId}:${label}`;
}

export function accountRatePolicies() {
  return Object.freeze([
    ...PUBLIC_ACCOUNT_POLICIES.map(policy=>Object.freeze({
      label:policy.label,
      limit:policy.limit,
      windowSeconds:policy.windowSeconds,
      scope:'account',
    })),
    ...privilegedRatePolicyInventory().map(policy=>Object.freeze({
      label:policy.label,
      limit:policy.distributedLimit,
      windowSeconds:policy.distributedWindowSeconds,
      scope:'privileged-account',
    })),
  ]);
}

export async function enforceDistributedAccountRateLimit({
  request,
  user,
  cfg,
  hasSupabase,
  supaRpc,
  bumpTelemetry=()=>{},
  recordOpsEvent=async()=>{},
  json,
  memory,
} = {}) {
  const identity=requestIdentity(request);
  const policy=identity ? accountRatePolicyForRequest(request) : null;
  const bucketKey=accountRateLimitBucketKey(user,policy);
  if (!policy || !bucketKey) return null;

  let configured=false;
  try {
    configured=typeof hasSupabase==='function' && hasSupabase(cfg)===true;
  } catch {
    configured=false;
  }
  if (!configured) return null;

  if (typeof supaRpc!=='function' || typeof json!=='function') {
    throw new TypeError('distributed account limiter dependencies are required');
  }

  try {
    const result=plainObject(await supaRpc(cfg,'claim_provider_request',{
      p_bucket_key:bucketKey,
      p_limit:policy.limit,
      p_window_seconds:policy.windowSeconds,
    },1800));
    const allowed=safeRead(result,'allowed');
    if (allowed===true) return null;
    if (allowed!==false) {
      throw new Error('Distributed account limiter returned an invalid allowed flag.');
    }

    const retryAfter=boundedRetryAfter(
      safeRead(result,'retryAfter'),
      policy.windowSeconds,
    );
    safeTelemetry(bumpTelemetry,'distributedBurstBlocks');
    return json({
      error:'Слишком много запросов за короткое время. Повторите немного позже.',
      code:'DISTRIBUTED_BURST_GUARD',
      retryAfter,
    },429,{'retry-after':String(retryAfter)});
  } catch (error) {
    safeTelemetry(bumpTelemetry,'distributedBurstFallbacks');
    const now=Date.now();
    const previousRaw=safeMemoryRead(memory,'distributedRouteGuardWarningAt');
    const previous=typeof previousRaw==='number' && Number.isFinite(previousRaw)
      ? previousRaw
      : 0;
    if (now-previous>=60_000) {
      safeMemoryWrite(memory,'distributedRouteGuardWarningAt',now);
      try {
        Promise.resolve(recordOpsEvent(cfg,{
          severity:'warning',
          source:'rate_limit',
          eventType:'distributed_route_guard',
          code:'DISTRIBUTED_ROUTE_GUARD_DEGRADED',
          message:safeErrorMessage(error),
          endpoint:identity?.pathname || '',
        })).catch(()=>{});
      } catch {}
    }
    return null;
  }
}
