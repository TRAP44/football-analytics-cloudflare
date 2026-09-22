import { pathToFileURL } from 'node:url';

const REQUIRED_HEALTH_FLAGS = [
  'adminSecurity',
  'adminDevModeIsolation',
  'backendSecurityContract',
  'cloudflareDeploymentGate',
  'browserSecurityPolicy',
  'failClosedDeployment',
  'interactionSafety',
  'actionDeduplication',
  'staleResponseGuard',
  'profileFailSoft',
  'entityNavigationSafety',
  'personalDataStateSafety',
  'asyncEntityGuard',
  'personalDataWriteConsistency',
  'reminderWriteConfirmation',
  'readWriteRaceGuard',
  'analysisHistoryTransition',
  'historyStaleGuard',
  'immediateAnalysisHandoff',
  'russianUiLocalization',
  'adminRussianLocalization',
  'prematchRussianLocalization',
  'dynamicRussianLocalization',
  'adminTextHumanization',
  'matchCenterRussianLocalization',
];

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function deploymentBaseUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('Deployment URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Deployment URL must not contain credentials.');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

async function request(fetchImpl, baseUrl, path, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(new URL(path, baseUrl), {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'application/json, text/html;q=0.9' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonBody(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

export async function runDeploymentSmoke(rawBaseUrl, expectedVersion, options = {}) {
  const baseUrl = deploymentBaseUrl(rawBaseUrl);
  const fetchImpl = options.fetchImpl || fetch;
  const retries = Math.max(1, Number(options.retries || 10));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 6000));
  let health = null;
  let lastHealthError = '';

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await request(fetchImpl, baseUrl, '/health');
      const body = await jsonBody(response, 'Health endpoint');
      if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}.`);
      if (body?.version !== expectedVersion) {
        throw new Error(`Expected ${expectedVersion}, received ${body?.version || 'unknown'}.`);
      }
      health = body;
      break;
    } catch (error) {
      lastHealthError = error?.message || String(error);
      if (attempt < retries) await delay(retryDelayMs);
    }
  }

  if (!health) throw new Error(`Deployment did not become ready: ${lastHealthError}`);
  if (health.ok !== true) throw new Error('Health endpoint is not healthy.');
  if (health.releaseCandidate !== 'RC33') throw new Error(`Expected RC33, received ${health.releaseCandidate || 'unknown'}.`);
  if (health.devMode !== false) throw new Error('Production deployment exposes DEV_MODE=true.');
  for (const flag of REQUIRED_HEALTH_FLAGS) {
    if (health[flag] !== 'enabled') throw new Error(`Health flag ${flag} is not enabled.`);
  }

  const manifestResponse = await request(fetchImpl, baseUrl, '/api/app-manifest');
  const manifest = await jsonBody(manifestResponse, 'App manifest');
  if (!manifestResponse.ok || manifest?.version !== expectedVersion || manifest?.releaseCandidate !== 'RC33') {
    throw new Error('Public app manifest does not match the deployed RC33 release.');
  }

  const rootResponse = await request(fetchImpl, baseUrl, '/');
  const rootContentType = String(rootResponse.headers.get('content-type') || '').toLowerCase();
  if (!rootResponse.ok || !rootContentType.includes('text/html')) {
    throw new Error(`Static application shell failed: HTTP ${rootResponse.status}.`);
  }
  const contentSecurityPolicy = String(rootResponse.headers.get('content-security-policy') || '');
  if (!contentSecurityPolicy.includes("script-src 'self' https://telegram.org") || !contentSecurityPolicy.includes("object-src 'none'")) {
    throw new Error('Static application shell is missing the RC33 Content-Security-Policy.');
  }
  if (String(rootResponse.headers.get('x-content-type-options') || '').toLowerCase() !== 'nosniff') {
    throw new Error('Static application shell is missing X-Content-Type-Options: nosniff.');
  }

  for (const path of ['/api/me', '/api/release-readiness', '/api/calibration-control']) {
    const response = await request(fetchImpl, baseUrl, path);
    if (response.status !== 401) throw new Error(`${path} must reject missing Telegram auth with HTTP 401.`);
  }

  const hiddenProbe = await request(fetchImpl, baseUrl, '/health/supabase');
  if (hiddenProbe.status !== 404) throw new Error('/health/supabase must remain unavailable publicly.');

  return {
    ok: true,
    origin: baseUrl.origin,
    version: health.version,
    releaseCandidate: health.releaseCandidate,
    checks: 11,
  };
}

async function main() {
  const [, , baseUrl, expectedVersion] = process.argv;
  if (!baseUrl || !expectedVersion) {
    throw new Error('Usage: node scripts/post-deploy-smoke.js <deployment-url> <expected-version>');
  }
  const result = await runDeploymentSmoke(baseUrl, expectedVersion);
  console.log(`Post-deploy smoke passed: ${result.version} at ${result.origin} (${result.checks} checks).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
