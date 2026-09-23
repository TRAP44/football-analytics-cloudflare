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

async function request(fetchImpl, baseUrl, path, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(new URL(path, baseUrl), {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'application/json' },
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
  let lastError = '';

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await request(fetchImpl, baseUrl, '/health');
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

      return {
        ok: true,
        version: health.version,
        releaseCandidate: health.releaseCandidate,
        attempt,
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
  runRollbackSmoke(baseUrl, expectedVersion)
    .then(result => {
      console.log(`Rollback smoke passed: ${result.version} / ${result.releaseCandidate}.`);
    })
    .catch(error => {
      console.error(error?.message || error);
      process.exit(1);
    });
}
