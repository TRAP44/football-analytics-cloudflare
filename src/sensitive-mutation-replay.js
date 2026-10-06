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
const CLAIMED_REASONS = new Set(['claimed','retry_failed','reclaimed']);
const DUPLICATE_REASONS = new Set([
  'duplicate_inflight',
  'duplicate_completed',
  'duplicate_failed',
  'request_conflict',
]);
const CLAIM_STATES = new Set(['inflight','completed','failed']);
const LEASE_TOKEN_RE = /^[A-Za-z0-9._:-]{16,80}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_PATH_LENGTH = 160;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_TIMESTAMP_MS = 8.64e15;

export const SENSITIVE_REPLAY_WINDOW_MS = 5 * 60_000;
export const MAX_SENSITIVE_REPLAY_ENTRIES = 1024;
const SENSITIVE_REPLAY_LEASE_SECONDS = 300;
const SENSITIVE_REPLAY_RETENTION_SECONDS = 300;

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

function positiveSafeInteger(value) {
  const id=integerCandidate(value);
  return id !== null && id>0 ? id : 0;
}

function safeClock(now) {
  try {
    const value=now();
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= MAX_TIMESTAMP_MS-SENSITIVE_REPLAY_WINDOW_MS
      ? value
      : Date.now();
  } catch {
    return Date.now();
  }
}

function requestMethod(request) {
  if (typeof request?.method !== 'string') return '';
  const method=request.method.trim().toUpperCase();
  return /^[A-Z]+$/.test(method) ? method : '';
}

function sensitivePath(pathname='') {
  if (typeof pathname !== 'string') return '';
  const path=pathname.trim();
  if (
    path !== pathname
    || !path.startsWith('/api/')
    || path.length > MAX_PATH_LENGTH
    || /[?#\\\u0000-\u001f\u007f-\u009f]/u.test(path)
  ) return '';
  return SENSITIVE_MUTATION_PATHS.includes(path) ? path : '';
}

function requestSensitivePath(request,url) {
  const supplied=sensitivePath(url?.pathname);
  if (supplied) return supplied;
  if (url?.pathname !== undefined) return '';
  if (typeof request?.url !== 'string' || !request.url.trim()) return '';
  try {
    return sensitivePath(new URL(request.url).pathname);
  } catch {
    return '';
  }
}

function cleanIdempotencyKey(request) {
  let value;
  try {
    value=request?.headers?.get?.('x-idempotency-key');
  } catch {
    return '';
  }
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string') return '';
  const raw=value.trim();
  if (
    !raw
    || raw.length > MAX_IDEMPOTENCY_KEY_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)
  ) return '';
  return raw;
}

function cleanLeaseToken(value) {
  if (typeof value !== 'string') return '';
  const token=value.trim();
  return LEASE_TOKEN_RE.test(token) ? token : '';
}

function strictStatus(value,fallback=500) {
  const status=integerCandidate(value);
  return status !== null && status >= 100 && status <= 599 ? status : fallback;
}

function validLedgerTime(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_TIMESTAMP_MS;
}

function configuredSecret(value,maxLength=8192) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function supabaseBaseUrl(cfg) {
  if (typeof cfg?.supabaseUrl !== 'string' || !cfg.supabaseUrl.trim()) return '';
  try {
    const url=new URL(cfg.supabaseUrl.trim());
    if (!['https:','http:'].includes(url.protocol)) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return url.toString().replace(/\/$/,'');
  } catch {
    return '';
  }
}

function boundedTimeout(value,fallback=2500) {
  const timeout=integerCandidate(value);
  return timeout !== null && timeout >= 500 && timeout <= 10_000 ? timeout : fallback;
}

export function isReplaySensitiveMutation(request, url) {
  const method=requestMethod(request);
  if (!MUTATION_METHODS.has(method)) return false;
  return Boolean(requestSensitivePath(request,url));
}

async function sha256Hex(value='') {
  if (typeof value !== 'string') return '';
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function requestBodyText(request) {
  if (!request || typeof request.clone !== 'function') return null;
  try {
    const body=await request.clone().text();
    if (typeof body !== 'string') return null;
    const bytes=new TextEncoder().encode(body).byteLength;
    return bytes <= MAX_REQUEST_BODY_BYTES ? body : null;
  } catch {
    return null;
  }
}

export async function sensitiveMutationReplayIdentity(request, url, user) {
  const actorId=positiveSafeInteger(user?.id);
  if (!actorId) return null;

  const method=requestMethod(request);
  const path=requestSensitivePath(request,url);
  if (!MUTATION_METHODS.has(method) || !path) return null;

  const body=await requestBodyText(request);
  if (body === null) return null;

  const requestDigest=await sha256Hex([
    'matchradar-sensitive-request-v2',
    method,
    path,
    body,
  ].join('|'));
  if (!SHA256_RE.test(requestDigest)) return null;

  const rawIdempotencyKey=cleanIdempotencyKey(request);
  const idempotencyKeyHash=rawIdempotencyKey
    ? await sha256Hex([
        'matchradar-sensitive-client-key-v2',
        String(actorId),
        method,
        path,
        rawIdempotencyKey,
      ].join('|'))
    : '';
  if (idempotencyKeyHash && !SHA256_RE.test(idempotencyKeyHash)) return null;

  const operationKey=await sha256Hex([
    'matchradar-sensitive-operation-v2',
    String(actorId),
    method,
    path,
    idempotencyKeyHash || requestDigest,
  ].join('|'));
  if (!SHA256_RE.test(operationKey)) return null;

  return Object.freeze({
    operationKey,
    actorId,
    method,
    path,
    requestDigest,
    idempotencyKeyHash,
  });
}

function pruneReplayLedger(ledger, now=Date.now()) {
  if (!(ledger instanceof Map)) return;
  const current=validLedgerTime(now) ? now : Date.now();
  for (const [key,value] of ledger) {
    const source=plainObject(value);
    const expiresAt=source?.expiresAt;
    const createdAt=source?.createdAt;
    if (
      !validLedgerTime(expiresAt)
      || !validLedgerTime(createdAt)
      || expiresAt <= current
      || createdAt > current
      || expiresAt < createdAt
    ) ledger.delete(key);
  }
  if (ledger.size<MAX_SENSITIVE_REPLAY_ENTRIES) return;
  const overflow=ledger.size-MAX_SENSITIVE_REPLAY_ENTRIES+1;
  const oldest=[...ledger.entries()]
    .sort((a,b)=>{
      const left=validLedgerTime(a[1]?.createdAt) ? a[1].createdAt : 0;
      const right=validLedgerTime(b[1]?.createdAt) ? b[1].createdAt : 0;
      return left-right;
    })
    .slice(0,overflow);
  for (const [key] of oldest) ledger.delete(key);
}

function hasPersistentCoordinatorConfig(cfg = {}) {
  return Boolean(
    supabaseBaseUrl(cfg)
    && configuredSecret(cfg?.supabaseKey)
  );
}

async function supabaseReplayRpc(cfg, functionName, payload, timeoutMs=2500) {
  const baseUrl=supabaseBaseUrl(cfg);
  if (
    !hasPersistentCoordinatorConfig(cfg)
    || !['claim_sensitive_mutation','complete_sensitive_mutation','fail_sensitive_mutation'].includes(functionName)
    || !plainObject(payload)
  ) {
    const error=new Error('Persistent mutation replay coordinator is not configured.');
    error.code='SENSITIVE_MUTATION_GUARD_UNAVAILABLE';
    throw error;
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),boundedTimeout(timeoutMs));
  try {
    const response=await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`,{
      method:'POST',
      headers:{
        apikey:cfg.supabaseKey,
        'content-type':'application/json',
      },
      body:JSON.stringify(payload),
      signal:controller.signal,
    });
    let body=null;
    try { body=await response.json(); } catch {}
    if (response?.ok !== true) {
      const error=new Error(`Persistent mutation replay coordinator returned HTTP ${strictStatus(response?.status,503)}.`);
      error.code='SENSITIVE_MUTATION_GUARD_UNAVAILABLE';
      throw error;
    }
    if (Array.isArray(body)) return body.length===1 && plainObject(body[0]) ? body[0] : null;
    return plainObject(body);
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
  return Object.freeze({
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
      p_lease_token:cleanLeaseToken(claim?.leaseToken ?? claim?.lease_token),
      p_retention_seconds:SENSITIVE_REPLAY_RETENTION_SECONDS,
    }),
    fail:(identity,claim,retryable)=>supabaseReplayRpc(cfg,'fail_sensitive_mutation',{
      p_operation_key:identity.operationKey,
      p_lease_token:cleanLeaseToken(claim?.leaseToken ?? claim?.lease_token),
      p_retryable:retryable === true,
      p_retention_seconds:SENSITIVE_REPLAY_RETENTION_SECONDS,
    }),
  });
}

export function sensitiveMutationRetryPolicy(path='', status=0, error=null) {
  const normalizedPath=sensitivePath(path);
  if (!normalizedPath || !RETRYABLE_FAILED_PATHS.has(normalizedPath)) return false;
  if (error !== null && error !== undefined) return true;
  const code=strictStatus(status,0);
  return code===408 || code===425 || code===429 || code>=500;
}

function localReplayReason(entry) {
  const source=plainObject(entry);
  if (source?.state==='inflight') return 'duplicate_inflight';
  if (source?.state==='failed') return 'duplicate_failed';
  return 'duplicate_completed';
}

function normalizedClaim(value) {
  const claim=plainObject(value);
  if (!claim || typeof claim.claimed !== 'boolean') {
    return {valid:false,claimed:false,reason:'guard_unavailable',leaseToken:''};
  }

  const state=typeof claim.state === 'string' && CLAIM_STATES.has(claim.state)
    ? claim.state
    : '';
  const reason=typeof claim.reason === 'string' ? claim.reason.trim() : '';

  if (claim.claimed === false) {
    if (!DUPLICATE_REASONS.has(reason) || !state) {
      return {valid:false,claimed:false,reason:'guard_unavailable',leaseToken:''};
    }
    return {valid:true,claimed:false,state,reason,leaseToken:''};
  }

  const leaseToken=cleanLeaseToken(claim.leaseToken ?? claim.lease_token);
  if (state !== 'inflight' || !CLAIMED_REASONS.has(reason) || !leaseToken) {
    return {valid:false,claimed:false,reason:'guard_unavailable',leaseToken:''};
  }
  return {valid:true,claimed:true,state,reason,leaseToken};
}

function settlementConfirmed(value,expectedState,{retryable=null}={}) {
  const source=plainObject(value);
  if (
    !source
    || source.ok !== true
    || source.updated !== true
    || source.state !== expectedState
  ) return false;
  if (expectedState === 'failed' && retryable !== null && source.retryable !== retryable) {
    return false;
  }
  return true;
}

async function settleFailure(persistent,identity,claim,retryable) {
  if (!persistent || typeof persistent.fail !== 'function') return false;
  try {
    const result=await persistent.fail(identity,claim,retryable);
    return settlementConfirmed(result,'failed',{retryable});
  } catch {
    return false;
  }
}

async function settleSuccess(persistent,identity,claim) {
  if (!persistent || typeof persistent.complete !== 'function') return false;
  try {
    const result=await persistent.complete(identity,claim);
    return settlementConfirmed(result,'completed');
  } catch {
    return false;
  }
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

  if (memory !== undefined && memory !== null && (!plainObject(memory))) {
    return {blocked:true,replayProtected:true,persistent:true,reason:'guard_unavailable',retryAfter:3};
  }
  if (plainObject(memory) && !(memory.sensitiveMutationReplay instanceof Map)) {
    memory.sensitiveMutationReplay=new Map();
  }
  const ledger=memory?.sensitiveMutationReplay;
  const identity=await sensitiveMutationReplayIdentity(request,url,user);
  if (!identity) return { blocked:true, replayProtected:true, reason:'invalid_identity' };

  const currentTime=safeClock(now);
  if (ledger instanceof Map) {
    pruneReplayLedger(ledger,currentTime);
    const existing=plainObject(ledger.get(identity.operationKey));
    if (
      existing
      && validLedgerTime(existing.expiresAt)
      && validLedgerTime(existing.createdAt)
      && existing.createdAt <= currentTime
      && existing.expiresAt > currentTime
    ) {
      return {
        blocked:true,
        replayProtected:true,
        persistent:true,
        reason:localReplayReason(existing),
      };
    }
  }

  const persistent=coordinator ?? persistentReplayCoordinator(cfg);
  if (!plainObject(persistent) || typeof persistent.claim !== 'function') {
    return {
      blocked:true,
      replayProtected:true,
      persistent:true,
      reason:'guard_unavailable',
      retryAfter:3,
    };
  }

  let rawClaim;
  try {
    rawClaim=await persistent.claim(identity);
  } catch {
    return {
      blocked:true,
      replayProtected:true,
      persistent:true,
      reason:'guard_unavailable',
      retryAfter:3,
    };
  }

  const claimState=normalizedClaim(rawClaim);
  if (!claimState.valid) {
    return {
      blocked:true,
      replayProtected:true,
      persistent:true,
      reason:'guard_unavailable',
      retryAfter:3,
    };
  }

  if (!claimState.claimed) {
    const reason=claimState.reason;
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

  const claim={
    ...plainObject(rawClaim),
    leaseToken:claimState.leaseToken,
  };
  const localEntry={
    state:'inflight',
    createdAt:currentTime,
    expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
  };
  if (ledger instanceof Map) ledger.set(identity.operationKey,localEntry);

  try {
    const response=await handler();
    const status=strictStatus(response?.status,500);
    if (status>=400) {
      const retryable=sensitiveMutationRetryPolicy(identity.path,status,null);
      const failedPersisted=await settleFailure(persistent,identity,claim,retryable);

      if (ledger instanceof Map) {
        if (retryable && failedPersisted) ledger.delete(identity.operationKey);
        else ledger.set(identity.operationKey,{
          ...localEntry,
          state:'failed',
          expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
        });
      }
      return {
        blocked:false,
        replayProtected:true,
        persistent:true,
        response,
        replayPersistenceConfirmed:failedPersisted,
      };
    }

    let completedPersisted=await settleSuccess(persistent,identity,claim);
    let terminalFallbackPersisted=false;
    if (!completedPersisted) {
      terminalFallbackPersisted=await settleFailure(persistent,identity,claim,false);
    }
    if (ledger instanceof Map) {
      ledger.set(identity.operationKey,{
        ...localEntry,
        state:'completed',
        expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
      });
    }
    return {
      blocked:false,
      replayProtected:true,
      persistent:true,
      response,
      replayPersistenceConfirmed:completedPersisted || terminalFallbackPersisted,
      ...(completedPersisted || terminalFallbackPersisted
        ? {}
        : {replayPersistenceDegraded:true}),
    };
  } catch (error) {
    const retryable=sensitiveMutationRetryPolicy(identity.path,strictStatus(error?.status,0),error);
    const failedPersisted=await settleFailure(persistent,identity,claim,retryable);

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
  return Object.freeze([...SENSITIVE_MUTATION_PATHS]);
}
