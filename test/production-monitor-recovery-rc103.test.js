import test from 'node:test';
import assert from 'node:assert/strict';
import { runRollbackSmoke } from '../scripts/rollback-smoke.js';

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('RC103 verifies exact rollback version and private Supabase probe', async () => {
  const fetchImpl = async url => {
    if (url.pathname === '/health') {
      return response(200, {
        ok: true,
        version: '6.94.0-rc102',
        releaseCandidate: 'RC102',
        devMode: false,
      });
    }
    if (url.pathname === '/health/supabase') return response(404, { ok: false });
    return response(404);
  };
  const result = await runRollbackSmoke('https://example.com', '6.94.0-rc102', {
    fetchImpl, retries: 1, retryDelayMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.version, '6.94.0-rc102');
});

test('RC103 rejects a rollback that restored the wrong version', async () => {
  const fetchImpl = async url => {
    if (url.pathname === '/health') {
      return response(200, {
        ok: true,
        version: '6.95.0-rc103',
        releaseCandidate: 'RC103',
        devMode: false,
      });
    }
    return response(404);
  };
  await assert.rejects(
    runRollbackSmoke('https://example.com', '6.94.0-rc102', { fetchImpl, retries: 1, retryDelayMs: 0 }),
    /Expected 6\.94\.0-rc102/
  );
});

test('RC103 rejects public technical Supabase health', async () => {
  const fetchImpl = async url => {
    if (url.pathname === '/health') {
      return response(200, {
        ok: true,
        version: '6.94.0-rc102',
        releaseCandidate: 'RC102',
        devMode: false,
      });
    }
    if (url.pathname === '/health/supabase') return response(200, { ok: true });
    return response(404);
  };
  await assert.rejects(
    runRollbackSmoke('https://example.com', '6.94.0-rc102', { fetchImpl, retries: 1, retryDelayMs: 0 }),
    /must not be public/
  );
});
