import test from 'node:test';
import assert from 'node:assert/strict';
import { runDeploymentSmoke } from '../scripts/post-deploy-smoke.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

function healthyFetch({ staleOnce = false, devMode = false } = {}) {
  let healthCalls = 0;
  return async input => {
    const url = new URL(input);
    if (url.pathname === '/health') {
      healthCalls += 1;
      return json({
        ok: true,
        version: staleOnce && healthCalls === 1 ? '6.11.0-rc19' : '6.12.0-rc20',
        releaseCandidate: 'RC20',
        devMode,
        adminSecurity: 'enabled',
        adminDevModeIsolation: 'enabled',
        backendSecurityContract: 'enabled',
        cloudflareDeploymentGate: 'enabled',
      });
    }
    if (url.pathname === '/api/app-manifest') return json({ version: '6.12.0-rc20', releaseCandidate: 'RC20' });
    if (url.pathname === '/') return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });
    if (url.pathname === '/health/supabase') return json({ error: 'not found' }, 404);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Telegram auth required' }, 401);
    return json({ error: 'not found' }, 404);
  };
}

test('post-deploy smoke validates RC20 and protected routes', async () => {
  const result = await runDeploymentSmoke('https://football.example.test', '6.12.0-rc20', {
    fetchImpl: healthyFetch(),
    retries: 1,
    retryDelayMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks, 9);
});

test('post-deploy smoke retries while the previous Worker version is propagating', async () => {
  const result = await runDeploymentSmoke('https://football.example.test/', '6.12.0-rc20', {
    fetchImpl: healthyFetch({ staleOnce: true }),
    retries: 2,
    retryDelayMs: 0,
  });
  assert.equal(result.version, '6.12.0-rc20');
});

test('post-deploy smoke rejects DEV_MODE in production', async () => {
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test', '6.12.0-rc20', {
      fetchImpl: healthyFetch({ devMode: true }),
      retries: 1,
      retryDelayMs: 0,
    }),
    /DEV_MODE=true/,
  );
});
