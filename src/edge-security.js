import { isAdminSensitivePath } from './security-route-registry.js';
import { privacyNetworkFingerprint } from './security-gate.js';

const POLICIES = Object.freeze([
  Object.freeze({
    id: 'analyze',
    binding: 'EDGE_ANALYZE_RATE_LIMIT',
    limit: 120,
    period: 60,
    matches: (path) => path === '/api/analyze',
  }),
  Object.freeze({
    id: 'sensitive',
    binding: 'EDGE_SENSITIVE_RATE_LIMIT',
    limit: 30,
    period: 60,
    matches: (path) => path.startsWith('/api/billing/') || isAdminSensitivePath(path),
  }),
  Object.freeze({
    id: 'telegram-webhook',
    binding: 'EDGE_WEBHOOK_RATE_LIMIT',
    limit: 6000,
    period: 60,
    matches: (path) => path === '/telegram/webhook',
  }),
]);

const SCANNER_PATH_PATTERNS = Object.freeze([
  /(?:^|\/)\.env(?:\.|\/|$)/i,
  /(?:^|\/)\.git(?:\/|$)/i,
  /(?:^|\/)wp-(?:admin|login|content|includes)(?:\/|\.|$)/i,
  /(?:^|\/)phpmyadmin(?:\/|$)/i,
  /(?:^|\/)vendor\/phpunit(?:\/|$)/i,
  /(?:^|\/)actuator(?:\/|$)/i,
  /(?:^|\/)server-status(?:\/|$)/i,
  /(?:^|\/)cgi-bin(?:\/|$)/i,
]);

async function requestFingerprint(request, secret='') {
  // First-stage edge identity is deliberately independent of Telegram
  // credentials. Attacker-controlled initData must never create a fresh
  // pre-auth bucket before its HMAC has been verified.
  return await privacyNetworkFingerprint(request, secret);
}

export function obviousScannerPath(pathname = '') {
  const path = String(pathname || '');
  return SCANNER_PATH_PATTERNS.some(pattern => pattern.test(path));
}

export function edgePolicyForRequest(request) {
  const path = new URL(request.url).pathname;
  return POLICIES.find(policy => policy.matches(path)) || null;
}

export function cloudflareEdgePolicies() {
  return POLICIES.map(policy => ({
    id: policy.id,
    binding: policy.binding,
    limit: policy.limit,
    period: policy.period,
  }));
}

export async function cloudflareEdgeGuard(request, env = {}) {
  const path = new URL(request.url).pathname;
  if (obviousScannerPath(path)) {
    return {
      blocked: true,
      kind: 'scanner',
      code: 'EDGE_SCANNER_BLOCKED',
      status: 404,
      policy: 'scanner',
    };
  }

  const policy = edgePolicyForRequest(request);
  if (!policy) return { blocked: false, configured: true };

  const limiter = env?.[policy.binding];
  if (!limiter || typeof limiter.limit !== 'function') {
    return { blocked: false, configured: false, degraded: true, policy: policy.id };
  }

  const fingerprint = await requestFingerprint(request, env?.TELEGRAM_BOT_TOKEN || '');
  if (!fingerprint) {
    // Never collapse unrelated visitors into one global bucket when the
    // Cloudflare network identity is unavailable. The distributed Worker guard
    // provides a stricter fail-closed boundary for expensive/sensitive APIs.
    return { blocked: false, configured: true, degraded: true, policy: policy.id };
  }

  try {
    const result = await limiter.limit({ key: `${policy.id}:${fingerprint}` });
    if (result?.success !== false) {
      return { blocked: false, configured: true, policy: policy.id };
    }
    return {
      blocked: true,
      configured: true,
      kind: 'rate_limit',
      code: 'EDGE_RATE_LIMIT_BLOCKED',
      status: 429,
      retryAfter: policy.period,
      policy: policy.id,
    };
  } catch {
    // Edge rate limiting remains defense-in-depth. Binding failure falls
    // through to the Worker-level distributed pre-auth guard before Telegram
    // HMAC verification and business/provider routing.
    return { blocked: false, configured: true, degraded: true, policy: policy.id };
  }
}
