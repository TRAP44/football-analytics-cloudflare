import { bytesToHex } from './crypto-utils.js';

const enc = new TextEncoder();
const DEFAULT_LEASE_SECONDS = 600;
const RELEASE_RETENTION_SECONDS = 60;

function positiveSafeInteger(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

async function sha256Hex(value = '') {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(value)));
  return bytesToHex(new Uint8Array(digest));
}

function claimRetryAfter(claim = {}, nowMs = Date.now()) {
  const until = Date.parse(String(claim?.lockedUntil || claim?.locked_until || claim?.expiresAt || claim?.expires_at || ''));
  if (!Number.isFinite(until)) return 5;
  return Math.max(1, Math.ceil((until - Number(nowMs || Date.now())) / 1000));
}

export function createAnalysisAccessLeaseRuntime({
  memory,
  hasSupabase,
  supaRpc,
  recordOpsEvent = async () => null,
  bumpTelemetry = () => {},
  now = () => Date.now(),
} = {}) {
  if (!memory) throw new TypeError('memory is required');
  if (typeof hasSupabase !== 'function') throw new TypeError('hasSupabase is required');
  if (typeof supaRpc !== 'function') throw new TypeError('supaRpc is required');
  if (!(memory.analysisAccessLeases instanceof Map)) memory.analysisAccessLeases = new Map();

  async function identity(userId, date) {
    const uid = positiveSafeInteger(userId);
    const normalizedDate = String(date || '');
    if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return null;
    const operationKey = await sha256Hex(`matchradar-analysis-access-lease-v1|${uid}|${normalizedDate}`);
    const requestDigest = await sha256Hex(`matchradar-analysis-access-capacity-v1|${uid}|${normalizedDate}`);
    return { uid, date: normalizedDate, operationKey, requestDigest };
  }

  async function safeEvent(cfg, event) {
    try { await recordOpsEvent(cfg, event); } catch {}
  }

  async function claimAnalysisAccessLease(userId, cfg, date = new Date(now()).toISOString().slice(0, 10)) {
    const leaseIdentity = await identity(userId, date);
    if (!leaseIdentity) return { claimed: false, unavailable: false, reason: 'invalid_identity', retryAfter: 0 };

    if (!hasSupabase(cfg)) {
      const key = `${leaseIdentity.uid}:${leaseIdentity.date}`;
      const currentTime = Number(now());
      const existing = memory.analysisAccessLeases.get(key);
      if (existing && Number(existing.expiresAt || 0) > currentTime) {
        bumpTelemetry('analysisAccessLeaseBlocks');
        return {
          claimed: false,
          persistent: false,
          unavailable: false,
          reason: 'duplicate_inflight',
          retryAfter: Math.max(1, Math.ceil((Number(existing.expiresAt) - currentTime) / 1000)),
        };
      }
      const leaseToken = crypto.randomUUID();
      memory.analysisAccessLeases.set(key, {
        leaseToken,
        expiresAt: currentTime + DEFAULT_LEASE_SECONDS * 1000,
      });
      return {
        claimed: true,
        persistent: false,
        key,
        leaseToken,
        operationKey: leaseIdentity.operationKey,
        date: leaseIdentity.date,
      };
    }

    let claim;
    try {
      claim = await supaRpc(cfg, 'claim_sensitive_mutation', {
        p_operation_key: leaseIdentity.operationKey,
        p_actor_id: leaseIdentity.uid,
        p_method: 'POST',
        p_path: '/api/analyze-access-lease',
        p_request_digest: leaseIdentity.requestDigest,
        p_idempotency_key_hash: null,
        p_lease_seconds: DEFAULT_LEASE_SECONDS,
        p_retention_seconds: DEFAULT_LEASE_SECONDS,
      }, 2500);
    } catch (error) {
      bumpTelemetry('analysisAccessLeaseErrors');
      await safeEvent(cfg, {
        severity: 'error',
        source: 'analysis_access',
        eventType: 'lease',
        code: 'ANALYSIS_ACCESS_LEASE_UNAVAILABLE',
        message: error?.message || 'Analysis access lease coordinator unavailable.',
        endpoint: '/api/analyze',
        meta: { disposition: 'fail_closed' },
      });
      return { claimed: false, persistent: true, unavailable: true, reason: 'guard_unavailable', retryAfter: 5 };
    }

    if (!claim?.claimed) {
      bumpTelemetry('analysisAccessLeaseBlocks');
      return {
        claimed: false,
        persistent: true,
        unavailable: false,
        reason: String(claim?.reason || 'duplicate_inflight'),
        retryAfter: claimRetryAfter(claim, now()),
      };
    }

    const leaseToken = String(claim?.leaseToken || claim?.lease_token || '');
    if (!leaseToken) {
      bumpTelemetry('analysisAccessLeaseErrors');
      return { claimed: false, persistent: true, unavailable: true, reason: 'lease_token_missing', retryAfter: 5 };
    }

    return {
      claimed: true,
      persistent: true,
      operationKey: leaseIdentity.operationKey,
      leaseToken,
      date: leaseIdentity.date,
      lockedUntil: claim?.lockedUntil || claim?.locked_until || null,
    };
  }

  async function releaseAnalysisAccessLease(claim = {}, cfg) {
    if (!claim?.claimed) return true;

    if (!claim.persistent) {
      const existing = memory.analysisAccessLeases.get(String(claim.key || ''));
      if (existing && String(existing.leaseToken || '') === String(claim.leaseToken || '')) {
        memory.analysisAccessLeases.delete(String(claim.key || ''));
      }
      return true;
    }

    try {
      const result = await supaRpc(cfg, 'fail_sensitive_mutation', {
        p_operation_key: String(claim.operationKey || ''),
        p_lease_token: String(claim.leaseToken || ''),
        p_retryable: true,
        p_retention_seconds: RELEASE_RETENTION_SECONDS,
      }, 2500);
      const released = Boolean(result?.ok ?? result?.updated);
      if (!released) {
        bumpTelemetry('analysisAccessLeaseErrors');
        await safeEvent(cfg, {
          severity: 'warning',
          source: 'analysis_access',
          eventType: 'lease',
          code: 'ANALYSIS_ACCESS_LEASE_RELEASE_NOT_CONFIRMED',
          message: 'Analysis access lease release was not confirmed; expiry will recover the slot.',
          endpoint: '/api/analyze',
        });
      }
      return released;
    } catch (error) {
      bumpTelemetry('analysisAccessLeaseErrors');
      await safeEvent(cfg, {
        severity: 'warning',
        source: 'analysis_access',
        eventType: 'lease',
        code: 'ANALYSIS_ACCESS_LEASE_RELEASE_FAILED',
        message: error?.message || 'Analysis access lease release failed; expiry will recover the slot.',
        endpoint: '/api/analyze',
      });
      return false;
    }
  }

  return Object.freeze({
    claimAnalysisAccessLease,
    releaseAnalysisAccessLease,
  });
}
