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

const MUTATION_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
export const SENSITIVE_REPLAY_WINDOW_MS = 5 * 60_000;
export const MAX_SENSITIVE_REPLAY_ENTRIES = 1024;

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

async function mutationReplayKey(request, url, user) {
  const userId=positiveSafeInteger(user?.id);
  if (!userId) return '';
  const method=String(request?.method || 'GET').toUpperCase();
  const path=String(url?.pathname || new URL(request.url).pathname);
  const idempotencyKey=String(request?.headers?.get?.('x-idempotency-key') || '').trim().slice(0,128);
  const body=await request.clone().text();
  return await sha256Hex([
    'matchradar-sensitive-mutation-v1',
    userId,
    method,
    path,
    idempotencyKey,
    body,
  ].join('|'));
}

export async function runSensitiveMutationWithReplay({
  request,
  url,
  user,
  memory,
  handler,
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
  if (!(ledger instanceof Map)) {
    return { blocked:true, replayProtected:true, reason:'guard_unavailable' };
  }

  const key=await mutationReplayKey(request,url,user);
  if (!key) return { blocked:true, replayProtected:true, reason:'invalid_identity' };

  const currentTime=Number(now());
  pruneReplayLedger(ledger,currentTime);
  const existing=ledger.get(key);
  if (existing && Number(existing.expiresAt || 0)>currentTime) {
    return {
      blocked:true,
      replayProtected:true,
      reason:existing.state==='inflight' ? 'duplicate_inflight' : 'duplicate_completed',
    };
  }

  const entry={
    state:'inflight',
    createdAt:currentTime,
    expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
  };
  ledger.set(key,entry);

  try {
    const response=await handler();
    const status=Number(response?.status || 200);
    if (status>=400) {
      ledger.delete(key);
    } else {
      ledger.set(key,{
        ...entry,
        state:'completed',
        expiresAt:currentTime+SENSITIVE_REPLAY_WINDOW_MS,
      });
    }
    return { blocked:false, replayProtected:true, response };
  } catch (error) {
    ledger.delete(key);
    throw error;
  }
}

export function sensitiveMutationReplayPaths() {
  return [...SENSITIVE_MUTATION_PATHS];
}
