import test from 'node:test';
import assert from 'node:assert/strict';
import { runRollbackSmoke } from '../scripts/rollback-smoke.js';

const expectedVersion = '6.101.0-rc109';
const probeToken = 'test-health-token';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function healthyFetch(overrides = {}, { legacyHealth = false } = {}) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (Object.prototype.hasOwnProperty.call(overrides, path)) return overrides[path];
    if (path === '/health') {
      if (legacyHealth) {
        return response(200, { ok:true, version:expectedVersion, releaseCandidate:'RC109', devMode:false });
      }
      const token=init?.headers?.['x-health-token'] || '';
      return token===probeToken
        ? response(200, { ok:true, version:expectedVersion, releaseCandidate:'RC109', devMode:false, database:'supabase', readiness:{ok:true} })
        : response(200, { ok:true });
    }
    if (path === '/health/supabase') return response(404, {});
    if (path === '/api/app-manifest') return response(200, { version:expectedVersion, releaseCandidate:'RC109' });
    if (path === '/api/public-status') return response(200, { version:expectedVersion, releaseCandidate:'RC109' });
    if (['/api/me','/api/release-readiness','/api/calibration-control','/api/launch-funnel'].includes(path)) return response(401, {});
    return response(404, {});
  };
}

test('RC121 rollback smoke verifies token-protected restored release and protected-route parity', async () => {
  const result = await runRollbackSmoke('https://example.workers.dev', expectedVersion, {
    fetchImpl:healthyFetch(),
    retries:1,
    retryDelayMs:0,
    healthProbeToken:probeToken,
  });
  assert.equal(result.ok, true);
  assert.equal(result.version, expectedVersion);
  assert.equal(result.checks, 9);
});

test('RC121 keeps rollback compatibility with legacy releases that expose detailed health publicly', async () => {
  const result = await runRollbackSmoke('https://example.workers.dev', expectedVersion, {
    fetchImpl:healthyFetch({}, {legacyHealth:true}),
    retries:1,
    retryDelayMs:0,
  });
  assert.equal(result.ok,true);
  assert.equal(result.version,expectedVersion);
});

test('RC121 fails when a token-protected health release is checked without HEALTH_PROBE_TOKEN', async () => {
  await assert.rejects(
    runRollbackSmoke('https://example.workers.dev', expectedVersion, {
      fetchImpl:healthyFetch(),
      retries:1,
      retryDelayMs:0,
      healthProbeToken:'',
    }),
    /HEALTH_PROBE_TOKEN is required/,
  );
});

test('RC121 fails when public manifest or public status is stale after rollback', async () => {
  await assert.rejects(
    runRollbackSmoke('https://example.workers.dev', expectedVersion, {
      fetchImpl:healthyFetch({ '/api/app-manifest':response(200,{ version:'6.100.0-rc108', releaseCandidate:'RC108' }) }, {legacyHealth:true}),
      retries:1, retryDelayMs:0,
    }),
    /Public app manifest does not match/
  );
  await assert.rejects(
    runRollbackSmoke('https://example.workers.dev', expectedVersion, {
      fetchImpl:healthyFetch({ '/api/public-status':response(200,{ version:'6.100.0-rc108', releaseCandidate:'RC108' }) }, {legacyHealth:true}),
      retries:1, retryDelayMs:0,
    }),
    /Public status endpoint does not match/
  );
});

test('RC121 fails when a protected route becomes public after rollback', async () => {
  await assert.rejects(
    runRollbackSmoke('https://example.workers.dev', expectedVersion, {
      fetchImpl:healthyFetch({ '/api/me':response(200,{ ok:true }) }, {legacyHealth:true}),
      retries:1, retryDelayMs:0,
    }),
    /must reject missing Telegram auth with HTTP 401/
  );
});
