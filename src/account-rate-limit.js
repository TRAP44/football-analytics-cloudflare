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

function positiveUserId(user) {
  const id=Number(user?.id);
  return Number.isSafeInteger(id) && id>0 ? id : 0;
}

export function accountRatePolicyForRequest(request) {
  const url=new URL(request.url);
  const method=String(request.method || 'GET').toUpperCase();
  return PUBLIC_ACCOUNT_POLICIES.find(policy=>policy.test(url.pathname,method))
    || privilegedDistributedRatePolicy(url.pathname,method);
}

export function accountRateLimitBucketKey(user, policy) {
  const userId=positiveUserId(user);
  const label=String(policy?.label || '').trim();
  if (!userId || !label) return '';
  return `route:${userId}:${label}`;
}

export function accountRatePolicies() {
  return [
    ...PUBLIC_ACCOUNT_POLICIES.map(policy=>({
      label:policy.label,
      limit:policy.limit,
      windowSeconds:policy.windowSeconds,
      scope:'account',
    })),
    ...privilegedRatePolicyInventory().map(policy=>({
      label:policy.label,
      limit:policy.distributedLimit,
      windowSeconds:policy.distributedWindowSeconds,
      scope:'privileged-account',
    })),
  ];
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
  const policy=accountRatePolicyForRequest(request);
  const bucketKey=accountRateLimitBucketKey(user,policy);
  if (!policy || !bucketKey || typeof hasSupabase!=='function' || !hasSupabase(cfg)) return null;
  if (typeof supaRpc!=='function' || typeof json!=='function') throw new TypeError('distributed account limiter dependencies are required');

  try {
    const result=await supaRpc(cfg,'claim_provider_request',{
      p_bucket_key:bucketKey,
      p_limit:policy.limit,
      p_window_seconds:policy.windowSeconds,
    },1800);
    if (result?.allowed) return null;

    const retryAfter=Math.max(1,Number(result?.retryAfter || policy.windowSeconds));
    bumpTelemetry('distributedBurstBlocks');
    return json({
      error:'Слишком много запросов за короткое время. Повторите немного позже.',
      code:'DISTRIBUTED_BURST_GUARD',
      retryAfter,
    },429,{'retry-after':String(retryAfter)});
  } catch (error) {
    bumpTelemetry('distributedBurstFallbacks');
    const now=Date.now();
    if (memory && now-Number(memory.distributedRouteGuardWarningAt || 0)>=60_000) {
      memory.distributedRouteGuardWarningAt=now;
      void recordOpsEvent(cfg,{
        severity:'warning',
        source:'rate_limit',
        eventType:'distributed_route_guard',
        code:'DISTRIBUTED_ROUTE_GUARD_DEGRADED',
        message:error?.message || error,
        endpoint:new URL(request.url).pathname,
      }).catch(()=>{});
    }
    return null;
  }
}
