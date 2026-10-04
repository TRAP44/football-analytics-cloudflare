const SENSITIVE_MUTATION_PATHS = Object.freeze([
  '/api/admin/billing/refund',
  '/api/admin/channel-publisher/test',
  '/api/runtime-controls',
  '/api/runtime-controls/rollback',
  '/api/recovery-incident-ack',
  '/api/post-deploy-regression-response',
  '/api/calibration-control',
  '/api/model-remediation',
  '/api/billing/invoice',
  '/api/billing/sync',
  '/api/billing/subscription',
]);

const RETRYABLE_FAILED_PATHS = new Set([
  '/api/admin/billing/refund',
  '/api/runtime-controls',
  '/api/runtime-controls/rollback',
  '/api/recovery-incident-ack',
  '/api/post-deploy-regression-response',
  '/api/calibration-control',
  '/api/model-remediation',
  '/api/billing/sync',
]);

const MUTATION_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
export const SENSITIVE_REPLAY_WINDOW_MS = 5 * 60_000;
export const MAX_SENSITIVE_REPLAY_ENTRIES = 1024;
const SENSITIVE_REPLAY_LEASE_SECONDS = 300;
const SENSITIVE_REPLAY_RETENTION_SECONDS = 300;

function positiveSafeInteger(value) {
  const id=Number(value);
  return Number.isSafeInteger(id) && id>0 ? id : 0;
}

function sensitivePath(pathname='') {
  const path=String(pathname || '');
  return SENSITIVE_MUTATION_PATHS.includes(path);
}

export function isReplaySensitiveMutation(request, url) {
  const method=String(request?.method || 'GET').toUpperCase();
  if (!MUTATION_METHODS.has(method)) return false;
  return sensitivePath(url?.pathname || new URL(request.url).pathname);
}

async function sha256Hex(value='') {
  const bytes=new TextEncoder().encode(String(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function sensitiveMutationReplayIdentity(request, url, user) {
  const actorId=positiveSafeInteger(user?.id);
  if (!actorId) return null;

  const method=String(request?.method || 'GET').toUpperCase();
  const path=String(url?.pathname || new URL(request.url).pathname);
  if (!MUTATION_METHODS.has(method) || !sensitivePath(path)) return null;

  const body=await request.clone().text();
  const requestDigest=await sha256Hex([
    'matchradar-sensitive-request-v2',
    method,
    path,
    body,
  ].join('|'));

  const rawIdempotencyKey=String(request?.headers?.get?.('x-idempotency-key') || '')
    .trim()
    .slice(0,128);
  const idempotencyKeyHash=rawIdempotencyKey
    ? await sha256Hex([
        'matchradar-sensitive-client-key-v2',
        actorId,
        method,
        path,
        rawIdempotencyKey,
      ].join('|'))
    : '';

  const operationKey=await sha256Hex([
    'matchradar-sensitive-operation-v2',
    actorId,
    method,
    path,
    idempotencyKeyHash || requestDigest,
  ].join('|'));

  return {
    operationKey,
    actorId,
    method,
    path,
    requestDigest,
    idempotencyKeyHash,
  };
}

function pruneReplayLedger(ledger, now=Date.now()) {
  if (!(ledger instanceof Map)) return;
  for (const [key,value] of ledger) {
    if (Number(value?.expiresAt || 0)<=now) ledger.delete(key);
  }
  if (ledger.size<MAX_SENSITIVE_REPLAY_ENTRIES) return;
  const overflow=ledger.size-MAX_SENSITIVE_REPLAY_ENTRIES+1;
  const oldest=[...ledger.entries()]
    .sort((a,b)=>Number(a[1]?.createdAt || 0)-Number(b[1]?.createdAt || 0))
    .slice(0,overflow);
  for (const [key] of oldest) ledger.delete(key);
}

function hasPersistentCoordinatorConfig(cfg = {}) {
  return Boolean(cfg?.supabaseUrl && cfg?.supabaseKey);
}

async function supabaseReplayRpc(cfg, functionName, payload, timeoutMs=2500) {
  if (!hasPersistentCoordinatorConfig(cfg)) {
    const error=new Error('Persistent mutation replay coordinator is not configured.');
    error.code='SENSITIVE_MUTATION_GUARD_UNAVAILABLE';
    throw error;
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(500,Number(timeoutMs || 2500)));
  try {
    const response=await fetch(`${String(cfg.supabaseUrl).replace(/\/$/,'')}/rest/v1/rpc/${functionName}`,{
      method:'POST',
      headers:{
        apikey:String(cfg.supabaseKey),
        'content-type':'application/json',
      },
      body:JSON.stringify(payload || {}),
      signal:controller.signal,
    });
    const body=await response.json().catch(()=>null);
    if (!response.ok) {
      const error=new Error(`Persistent mutation replay coordinator returned HTTP ${response.status}.`);
      error.code='SENSITIVE_MUTATION_GUARD_UNAVAILABLE';
      throw error;
    }
    return Array.isArray(body) && body.length===1 ? body[0] : body;
  } catch (cause) {
    if (cause?.code==='SENSITIVE_MUTATION_GUARD_UNAVAILABLE') throw cause;
    const error=new Error('Persistent mutation replay coordinator is unavailable.');
    error.code='SENSITIVE_MUTATION_GUARD_UNAVAILABLE';
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function persistentReplayCoordinator(cfg) {
  return {
    claim:identity=>supabaseReplayRpc(cfg,'claim_sensitive_mutation',{
      p_operation_key:identity.operationKey,
      p_actor_id:identity.actorId,
      p_method:identity.method,
      p_path:identity.path,
      p_request_digest:identity.requestDigest,
      p_idempotency_key_hash:identity.idempotencyKeyHash || null,
      p_lease_seconds:SENSITIVE_REPLAY_LEASE_SECONDS,
      p_retention_seconds:SENSITIVE_REPLAY_RETENTION_SECONDS,
    }),
    complete:(identity,claim)=>supabaseReplayRpc(cfg,'complete_sensitive_mutation',{
      p_operation_key:identity.operationKey,
      p_lease_token:String(claim?.leaseToken || claim?.lease_token || ''),
      p_retention_seconds:SENSITIVE_REPLAY_RETENTION_SECONDS,
    }),
    fail:(identity,claim,retryable)=>supabaseReplayRpc(cfg,'fail_sensitive_mutation',{
      p_operation_key:identity.operationKey,
      p_lease_token:String(claim?.leaseToken || claim?.lease_token || ''),
      p_retryable:Boolean(retryable),
      p_retention_seconds:SENSITIVE_REPLAY_RETENTION_SECONDS,
    }),
  };
}

export function sensitiveMutationRetryPolicy(path='', status=0, error=null) {
  const normalizedPath=String(path || '');
  if (!RETRYABLE_FAILED_PATHS.has(normalizedPath)) return false;
  if (error) return true;
  const code=Number(status || 0);
  return code===408 || code===425 || code===429 || code>=500;
}

function localReplayReason(entry) {
  if (entry?.state==='inflight') return 'duplicate_inflight';
  if (entry?.state==='failed') return 'duplicate_failed';
  return 'duplicate_completed';
}

function persistentDuplicateReason(claim = {}) {
  const reason=String(claim?.reason || '');
  if ([
    'duplicate_inflight',
    'duplicate_completed',
    'duplicate_failed',
    'request_conflict',
  ].includes(reason)) return reason;
  const state=String(claim?.state || '');
  if (state==='inflight') return 'duplicate_inflight';
  if (state==='completed') return 'duplicate_completed';
  if (state==='failed') return 'duplicate_failed';
  return 'duplicate_inflight';
}

export async function runSensitiveMutationWithReplay({
  request,
  url,
  user,
  memory,
  cfg,
  handler,
  coordinator=null,
  now=Date.now,
} = {}) {
  if (typeof handler!=='function') throw new TypeError('handler is required');
  if (!isReplaySensitiveMutation(request,url)) {
    return { blocked:false, replayProtected:false, response:await handler() };
  }

  if (!(memory?.sensitiveMutationReplay instanceof Map)) {
    if (memory) memory.sensitiveMutationReplay=new Map();
  }
  const ledger=memory?.sensitiveMutationReplay;
  const identity=await sensitiveMutationReplayIdentity(request,url,user);
  if (!identity) return { blocked:true, replayProtected:true, reason:'invalid_identity' };

  const currentTime=Number(now());
  if (ledger instanceof Map) {
    pruneReplayLedger(ledger,currentTime);
    const existing=ledger.get(identity.operationKey);
    if (existing && Number(existing.expiresAt || 0)>currentTime) {
      return {
        blocked:true,
        replayProtected:true,
        persistent:true,
        reason:localReplayReason(existing),
      };
    }
  }

  const persistent=coordinator || persistentReplayCoordinator(cfg);
  let claim;
  try {
    claim=await persistent.claim(identity);
  } catch {
    return {
      blocked:true,
      replayProtected:true,
      persistent:true,
      reason:'guard_unavailable',
      retryAfter:3,
    };
  }

  if (!claim?.claimed) {
    const reason=persistentDuplicateReason(claim);
    if (ledger instanceof Map && reason!=='request_conflict') {
      ledger.set(identity.operationKey,{
        state:reason==='duplicate_inflight' ? 'inflight' : reason==='duplicate_failed' ? 'failed' : 'completed',
        createdAt:currentTime,
        expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
      });
    }
    return {
      blocked:true,
      replayProtected:true,
      persistent:true,
      reason,
    };
  }

  const leaseToken=String(claim?.leaseToken || claim?.lease_token || '');
  if (!leaseToken) {
    return {
      blocked:true,
      replayProtected:true,
      persistent:true,
      reason:'guard_unavailable',
      retryAfter:3,
    };
  }

  const localEntry={
    state:'inflight',
    createdAt:currentTime,
    expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
  };
  if (ledger instanceof Map) ledger.set(identity.operationKey,localEntry);

  try {
    const response=await handler();
    const status=Number(response?.status || 200);
    if (status>=400) {
      const retryable=sensitiveMutationRetryPolicy(identity.path,status,null);
      let failedPersisted=false;
      try {
        const result=await persistent.fail(identity,claim,retryable);
        failedPersisted=Boolean(result?.ok ?? result?.updated ?? true);
      } catch {}

      if (ledger instanceof Map) {
        if (retryable && failedPersisted) ledger.delete(identity.operationKey);
        else ledger.set(identity.operationKey,{
          ...localEntry,
          state:'failed',
          expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
        });
      }
    } else {
      try { await persistent.complete(identity,claim); } catch {}
      if (ledger instanceof Map) {
        ledger.set(identity.operationKey,{
          ...localEntry,
          state:'completed',
          expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
        });
      }
    }
    return { blocked:false, replayProtected:true, persistent:true, response };
  } catch (error) {
    const retryable=sensitiveMutationRetryPolicy(identity.path,Number(error?.status || 0),error);
    let failedPersisted=false;
    try {
      const result=await persistent.fail(identity,claim,retryable);
      failedPersisted=Boolean(result?.ok ?? result?.updated ?? true);
    } catch {}

    if (ledger instanceof Map) {
      if (retryable && failedPersisted) ledger.delete(identity.operationKey);
      else ledger.set(identity.operationKey,{
        ...localEntry,
        state:'failed',
        expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
      });
    }
    throw error;
  }
}

export function sensitiveMutationReplayPaths() {
  return [...SENSITIVE_MUTATION_PATHS];
}
