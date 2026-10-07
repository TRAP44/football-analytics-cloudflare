import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cloudflareVersionIdValid, validateReleaseIdentity } from '../src/release-identity.js';

const REQUIRED_MANIFEST_FEATURES = Object.freeze([
  'startupSafety',
  'rollbackSafety',
  'productionMonitor',
  'rollbackVerification',
  'providerDataReliability',
  'aiAnalysisQualityGate',
  'telegramMiniAppE2E',
  'telegramWebhookPersistentDedupe',
  'supabaseProbeConfirmation',
  'supabaseSchemaProbeConfirmation',
  'cloudflareEdgeRateLimits',
  'aiFreshnessGuard',
  'preKickoffRecheck',
  'preKickoffChangeDetection',
  'analysisDeltaSummary',
]);

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function deploymentBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Deployment URL is required.');
  const url=new URL(value.trim());
  if (url.protocol !== 'https:') throw new Error('Deployment URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Deployment URL must not contain credentials.');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

function boundedNumber(value, fallback, min, max) {
  let parsed=null;
  if (typeof value==='number' && Number.isFinite(value)) {
    parsed=value;
  } else if (typeof value==='string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    parsed=Number(value.trim());
  }
  if (parsed===null || !Number.isFinite(parsed)) return fallback;
  return Math.max(min,Math.min(max,parsed));
}

async function request(fetchImpl, baseUrl, path, timeoutMs = 8000, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(new URL(path, baseUrl), {
      method: init.method || 'GET',
      redirect: 'manual',
      headers: {
        accept: 'application/json, text/html;q=0.9',
        'cache-control': 'no-cache',
        'user-agent': 'MatchRadar-Post-Deploy-Smoke/1.0',
        ...(init.headers || {}),
      },
      ...(init.body !== undefined ? { body:init.body } : {}),
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

function verifyRuntimeDeploymentIdentity(body, label, expectedSha, expectedVersionId = '') {
  if (!expectedSha) return;
  const normalizedSha=String(expectedSha).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/i.test(normalizedSha)) throw new Error('Expected deploy SHA must be a 40-character Git commit SHA.');
  const deployment=body?.deployment || {};
  const runtimeDeploySha=String(deployment?.deploySha || '').trim();
  const runtimeVersionTag=String(deployment?.cloudflareVersionTag || '').trim();
  const runtimeVersionId=String(deployment?.cloudflareVersionId || '').trim();

  // Prefer the strongest runtime identity when Cloudflare exposes its Version tag.
  // Some Version URL executions expose id/timestamp but omit tag. In that narrow
  // case the caller must provide the exact immutable Version ID already proven
  // by the Cloudflare control plane for expectedSha.
  if (runtimeDeploySha || runtimeVersionTag) {
    const validation=validateReleaseIdentity({
      ...deployment,
      appVersion:body?.version,
      releaseCandidate:body?.releaseCandidate,
    });
    if (!validation.ok) {
      throw new Error(`${label} release identity validation failed: ${validation.code}.`);
    }
    if (runtimeDeploySha.toLowerCase() !== normalizedSha) {
      throw new Error(`${label} deploy SHA does not match the verified production revision.`);
    }
    if (expectedVersionId && runtimeVersionId.toLowerCase() !== String(expectedVersionId).trim().toLowerCase()) {
      throw new Error(`${label} Cloudflare Version ID does not match the verified version.`);
    }
    return;
  }

  const normalizedVersionId=String(expectedVersionId || '').trim().toLowerCase();
  if (!cloudflareVersionIdValid(normalizedVersionId)) {
    throw new Error(`${label} runtime tag is unavailable and no verified Cloudflare Version ID was supplied.`);
  }
  if (runtimeVersionId.toLowerCase() !== normalizedVersionId) {
    throw new Error(`${label} Cloudflare Version ID does not match the verified version.`);
  }

  // Validate every runtime-owned identity field while substituting only the
  // SHA/tag that the immediately preceding control-plane check already bound
  // to this exact immutable Version ID.
  const validation=validateReleaseIdentity({
    ...deployment,
    appVersion:body?.version,
    releaseCandidate:body?.releaseCandidate,
    deploySha:normalizedSha,
    cloudflareVersionTag:normalizedSha,
  });
  if (!validation.ok) {
    throw new Error(`${label} release identity validation failed: ${validation.code}.`);
  }
}

async function requestJsonForDeployment(fetchImpl, baseUrl, path, label, expectedSha, expectedVersionId = '', options = {}) {
  const retries=boundedNumber(options.retries,1,1,20);
  const retryDelayMs=boundedNumber(options.retryDelayMs,0,0,60000);
  let lastError='';
  for(let attempt=1;attempt<=retries;attempt+=1){
    try{
      const response=await request(fetchImpl,baseUrl,path);
      const body=await jsonBody(response,label);
      if(!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
      verifyRuntimeDeploymentIdentity(body,label,expectedSha,expectedVersionId);
      return {response,body};
    }catch(error){
      lastError=error?.message || String(error);
      if(attempt<retries) await delay(retryDelayMs);
    }
  }
  throw new Error(`${label} did not converge to the verified deployment: ${lastError}`);
}

export async function runDeploymentSmoke(rawBaseUrl, expectedVersion, expectedShaOrOptions = {}, maybeOptions = {}) {
  const expectedSha=typeof expectedShaOrOptions === 'string' ? expectedShaOrOptions : '';
  const options=typeof expectedShaOrOptions === 'string' ? maybeOptions : (expectedShaOrOptions || {});
  const baseUrl = deploymentBaseUrl(rawBaseUrl);
  const fetchImpl = options.fetchImpl || fetch;
  const retries = boundedNumber(options.retries,10,1,20);
  const retryDelayMs = boundedNumber(options.retryDelayMs,6000,0,60000);
  const monetizationRaw=typeof options.expectedMonetization === 'string'
    ? options.expectedMonetization.trim().toLowerCase()
    : 'paused';
  if (!['enabled','paused'].includes(monetizationRaw)) {
    throw new Error('Expected monetization state must be enabled or paused.');
  }
  const expectedMonetization=monetizationRaw;
  const versionRaw=typeof expectedVersion === 'string' ? expectedVersion.trim() : '';
  const versionMatch=/^\d+\.\d+\.\d+-rc(\d+)$/i.exec(versionRaw);
  if (!versionMatch) throw new Error('Expected version must use <semver>-rc<number>.');
  const expectedReleaseCandidate=`RC${versionMatch[1]}`;
  let readiness = null;
  let health = null;
  let lastHealthError = '';

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await request(fetchImpl, baseUrl, '/health/ready');
      const body = await jsonBody(response, 'Readiness endpoint');
      if (!response.ok) throw new Error(`Readiness endpoint returned HTTP ${response.status}.`);
      if (body?.version !== expectedVersion) {
        throw new Error(`Expected ${expectedVersion}, received ${body?.version || 'unknown'}.`);
      }
      if (body?.ok !== true || body?.status !== 'ready') throw new Error('Readiness contract is not ready.');
      if (body?.checks?.supabase?.ok !== true) throw new Error('Readiness Supabase probe failed.');
      if (body?.checks?.schema?.ok !== true) throw new Error('Readiness schema fingerprint failed.');
      if (body?.checks?.backendSecurity?.ok !== true) throw new Error('Readiness backend security contract failed.');
      if (body?.checks?.telegramConfigured !== true) throw new Error('Readiness Telegram configuration failed.');
      readiness = body;
      break;
    } catch (error) {
      lastHealthError = error?.message || String(error);
      if (attempt < retries) await delay(retryDelayMs);
    }
  }

  if (!readiness) throw new Error(`Deployment did not become ready: ${lastHealthError}`);
  if (readiness.releaseCandidate !== expectedReleaseCandidate) throw new Error(`Expected ${expectedReleaseCandidate}, received ${readiness.releaseCandidate || 'unknown'}.`);

  const healthResult=await requestJsonForDeployment(fetchImpl,baseUrl,'/health','Health endpoint','',{retries,retryDelayMs});
  const healthResponse=healthResult.response;
  health=healthResult.body;
  if (health?.ok !== true || health?.status !== 'ready') throw new Error('Health endpoint is not healthy.');
  if (health.version !== expectedVersion) {
    throw new Error(`Expected ${expectedVersion}, received ${health.version || 'unknown'}.`);
  }
  if (health.releaseCandidate !== expectedReleaseCandidate) throw new Error(`Expected ${expectedReleaseCandidate}, received ${health.releaseCandidate || 'unknown'}.`);
  if (health.devMode !== false) throw new Error('Production deployment exposes DEV_MODE=true.');
  if (health?.readiness?.ok !== true || health?.readiness?.status !== 'ready') {
    throw new Error('Health endpoint must embed a passing readiness snapshot.');
  }

  const expectedVersionId=typeof options.expectedVersionId === 'string' ? options.expectedVersionId.trim() : '';
  const manifestResult=await requestJsonForDeployment(fetchImpl,baseUrl,'/api/app-manifest','App manifest',expectedSha,expectedVersionId,{retries,retryDelayMs});
  const manifestResponse=manifestResult.response;
  const manifest=manifestResult.body;
  if (manifest?.version !== expectedVersion || manifest?.releaseCandidate !== expectedReleaseCandidate) {
    throw new Error(`Public app manifest does not match the deployed ${expectedReleaseCandidate} release.`);
  }
  if (manifest?.monetization !== expectedMonetization) {
    throw new Error(`Production deployment must expose MONETIZATION_ENABLED=${expectedMonetization === 'enabled' ? 'true' : 'false'} in the app manifest.`);
  }
  for (const feature of REQUIRED_MANIFEST_FEATURES) {
    if (manifest?.features?.[feature] !== true) {
      throw new Error(`App manifest feature ${feature} is not enabled.`);
    }
  }

  const rootResponse = await request(fetchImpl, baseUrl, '/');
  const rootContentType = String(rootResponse.headers.get('content-type') || '').toLowerCase();
  if (!rootResponse.ok || !rootContentType.includes('text/html')) {
    throw new Error(`Static application shell failed: HTTP ${rootResponse.status}.`);
  }
  const contentSecurityPolicy = String(rootResponse.headers.get('content-security-policy') || '');
  if (!contentSecurityPolicy.includes("script-src 'self' https://telegram.org") || !contentSecurityPolicy.includes("object-src 'none'")) {
    throw new Error('Static application shell is missing the required Content-Security-Policy.');
  }
  if (String(rootResponse.headers.get('x-content-type-options') || '').toLowerCase() !== 'nosniff') {
    throw new Error('Static application shell is missing X-Content-Type-Options: nosniff.');
  }

  for (const path of ['/api/me', '/api/release-readiness', '/api/calibration-control', '/api/launch-funnel', '/api/admin/channel-publisher/test']) {
    const response = await request(fetchImpl, baseUrl, path);
    if (response.status !== 401) throw new Error(`${path} must reject missing Telegram auth with HTTP 401.`);
  }

  const hiddenProbe = await request(fetchImpl, baseUrl, '/health/supabase');
  if (hiddenProbe.status !== 404) throw new Error('/health/supabase must remain unavailable publicly.');

  const publicStatusResult=await requestJsonForDeployment(fetchImpl,baseUrl,'/api/public-status','Public status endpoint','',{retries,retryDelayMs});
  const publicStatusResponse=publicStatusResult.response;
  const publicStatus=publicStatusResult.body;
  if (publicStatus?.version !== expectedVersion || publicStatus?.releaseCandidate !== expectedReleaseCandidate) {
    throw new Error('Public status endpoint does not match the deployed release.');
  }
  const requiredServices = ['telegram','miniApp','aiAnalysis','search','live'];
  for (const service of requiredServices) {
    if (publicStatus?.services?.[service] !== 'operational') {
      throw new Error(`Public status service ${service} must be operational before production acceptance.`);
    }
  }

  for (const path of ['/privacy.html','/terms.html','/status.html']) {
    const response=await request(fetchImpl,baseUrl,path);
    const type=String(response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok || !type.includes('text/html')) throw new Error(`${path} must be a public HTML page.`);
    const csp=String(response.headers.get('content-security-policy') || '');
    if (!csp.includes("object-src 'none'")) throw new Error(`${path} is missing the static security policy.`);
  }

  const statusScript=await request(fetchImpl,baseUrl,'/status.js');
  const statusScriptType=String(statusScript.headers.get('content-type') || '').toLowerCase();
  if (!statusScript.ok || !/(javascript|ecmascript)/.test(statusScriptType)) {
    throw new Error(`/status.js must be a public JavaScript asset, received HTTP ${statusScript.status}.`);
  }

  const webhookProbe=await request(fetchImpl,baseUrl,'/telegram/webhook',8000,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  if (webhookProbe.status !== 403) throw new Error(`Telegram webhook must reject a request without its secret with HTTP 403, received ${webhookProbe.status}.`);

  return {
    ok: true,
    origin: baseUrl.origin,
    version: health.version,
    releaseCandidate: health.releaseCandidate,
    checks: 25,
  };
}

async function main() {
  const [, , baseUrl, expectedVersion, expectedSha, expectedVersionId=''] = process.argv;
  if (!baseUrl || !expectedVersion || !expectedSha) {
    throw new Error('Usage: node scripts/post-deploy-smoke.js <deployment-url> <expected-version> <expected-sha> [expected-version-id]');
  }
  let configuredMonetization = 'paused';
  try {
    const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    configuredMonetization = String(wrangler?.vars?.MONETIZATION_ENABLED || '').toLowerCase() === 'true' ? 'enabled' : 'paused';
  } catch {}
  const requestedMonetization=process.env.EXPECTED_MONETIZATION || configuredMonetization;
  const expectedMonetization=String(requestedMonetization).trim().toLowerCase();
  if (!['enabled','paused'].includes(expectedMonetization)) {
    throw new Error('EXPECTED_MONETIZATION must be enabled or paused.');
  }
  const result=await runDeploymentSmoke(baseUrl,expectedVersion,expectedSha,{expectedMonetization,expectedVersionId});
  console.log(`Post-deploy smoke passed: ${result.version} sha=${expectedSha} at ${result.origin} (${result.checks} checks).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
