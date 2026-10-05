import { pathToFileURL } from 'node:url';

function rollbackBaseUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('Rollback verification URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Rollback verification URL must not contain credentials.');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

function expectedReleaseCandidate(version) {
  const match = /-rc(\d+)$/i.exec(String(version || ''));
  if (!match) throw new Error('Expected rollback version must end with -rc<number>.');
  return `RC${match[1]}`;
}

async function request(fetchImpl, baseUrl, path, timeoutMs = 8000, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(new URL(path, baseUrl), {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'application/json', ...headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function runRollbackSmoke(rawBaseUrl, expectedVersion, options = {}) {
  const baseUrl = rollbackBaseUrl(rawBaseUrl);
  const expectedRc = expectedReleaseCandidate(expectedVersion);
  const fetchImpl = options.fetchImpl || fetch;
  const retries = Math.max(1, Number(options.retries || 10));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 6000));
  const healthProbeToken=String(options.healthProbeToken || process.env.HEALTH_PROBE_TOKEN || '').trim();
  if (!healthProbeToken) throw new Error('HEALTH_PROBE_TOKEN is required for rollback health verification.');
  let lastError = '';

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const publicResponse=await request(fetchImpl,baseUrl,'/health');
      if (!publicResponse.ok) throw new Error(`/health returned HTTP ${publicResponse.status}`);
      const publicHealth=await publicResponse.json();
      if (publicHealth?.ok!==true || Object.keys(publicHealth).some(key=>key!=='ok')) {
        throw new Error('/health must remain minimal without the probe token.');
      }

      const response = await request(fetchImpl, baseUrl, '/health', 8000, {'x-health-token':healthProbeToken});
      if (!response.ok) throw new Error(`/health returned HTTP ${response.status}`);
      const health = await response.json();
      if (health?.ok !== true) throw new Error('/health.ok must be true after rollback.');
      if (health?.version !== expectedVersion) throw new Error(`Expected ${expectedVersion}, got ${health?.version || 'unknown'}.`);
      if (health?.releaseCandidate !== expectedRc) throw new Error(`Expected ${expectedRc}, got ${health?.releaseCandidate || 'unknown'}.`);
      if (health?.devMode !== false) throw new Error('DEV_MODE must remain false after rollback.');

      const privateProbe = await request(fetchImpl, baseUrl, '/health/supabase');
      if (![401, 403, 404].includes(Number(privateProbe.status || 0))) {
        throw new Error(`/health/supabase must not be public; got HTTP ${privateProbe.status}.`);
      }

      const manifestResponse = await request(fetchImpl, baseUrl, '/api/app-manifest');
      if (!manifestResponse.ok) throw new Error(`/api/app-manifest returned HTTP ${manifestResponse.status}.`);
      const manifest = await manifestResponse.json();
      if (manifest?.version !== expectedVersion || manifest?.releaseCandidate !== expectedRc) {
        throw new Error('Public app manifest does not match the restored rollback release.');
      }

      const publicStatusResponse = await request(fetchImpl, baseUrl, '/api/public-status');
      if (!publicStatusResponse.ok) throw new Error(`/api/public-status returned HTTP ${publicStatusResponse.status}.`);
      const publicStatus = await publicStatusResponse.json();
      if (publicStatus?.version !== expectedVersion || publicStatus?.releaseCandidate !== expectedRc) {
        throw new Error('Public status endpoint does not match the restored rollback release.');
      }

      for (const path of ['/api/me', '/api/release-readiness', '/api/calibration-control', '/api/launch-funnel']) {
        const protectedResponse = await request(fetchImpl, baseUrl, path);
        if (protectedResponse.status !== 401) {
          throw new Error(`${path} must reject missing Telegram auth with HTTP 401 after rollback.`);
        }
      }

      return {
        ok: true,
        version: health.version,
        releaseCandidate: health.releaseCandidate,
        attempt,
        checks: 9,
      };
    } catch (error) {
      lastError = String(error?.message || error);
      if (attempt < retries && retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  throw new Error(`Rollback verification failed: ${lastError || 'unknown error'}`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const [baseUrl, expectedVersion] = process.argv.slice(2);
  runRollbackSmoke(baseUrl, expectedVersion, {healthProbeToken:process.env.HEALTH_PROBE_TOKEN})
    .then(result => {
      console.log(`Rollback smoke passed: ${result.version} / ${result.releaseCandidate}.`);
    })
    .catch(error => {
      console.error(error?.message || error);
      process.exit(1);
    });
}
