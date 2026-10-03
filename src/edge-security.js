import { isAdminSensitivePath } from './auth-user.js';

const POLICIES = Object.freeze([
  Object.freeze({
    id: 'analyze',
    binding: 'EDGE_ANALYZE_RATE_LIMIT',
    limit: 30,
    period: 60,
    matches: (path) => path === '/api/analyze',
  }),
  Object.freeze({
    id: 'sensitive',
    binding: 'EDGE_SENSITIVE_RATE_LIMIT',
    limit: 120,
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

function header(request, name) {
  return String(request?.headers?.get?.(name) || '').trim();
}

async function requestFingerprint(request) {
  const ip = header(request, 'cf-connecting-ip');
  const initData = header(request, 'x-telegram-init-data');
  if (!ip && !initData) return '';

  // Prefer a credential-scoped fingerprint when Telegram initData is present so
  // unrelated signed users behind one NAT do not share the same edge bucket.
  // Keep the IP in the hash as defense-in-depth; invalid rotating initData is
  // still constrained by the separate pre-auth IP burst guard.
  const material = initData
    ? `matchradar-edge-v2|telegram|${ip}|${initData}`
    : `matchradar-edge-v2|network|${ip}`;
  const payload = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
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

  const fingerprint = await requestFingerprint(request);
  if (!fingerprint) {
    // Do not collapse unrelated visitors into one global bucket when a network
    // identity is unavailable. Existing authenticated/local/distributed guards
    // remain the fallback.
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
    // Edge rate limiting is defense-in-depth. Binding failure must not turn
    // production into an outage; existing request-shape, auth, local burst and
    // Supabase distributed guards remain active.
    return { blocked: false, configured: true, degraded: true, policy: policy.id };
  }
}
