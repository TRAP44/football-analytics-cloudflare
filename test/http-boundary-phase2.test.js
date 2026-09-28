import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpRuntime } from '../src/http.js';

const runtime = createHttpRuntime({
  appVersion: '6.120.0-rc144',
  apiContractVersion: 5,
  minClientVersion: '5.8.0',
  releaseChannel: 'rc144',
  personalWriteLimits: { favorites: 25, reminders: 20 },
});

test('HTTP boundary preserves JSON response metadata and restrictive security headers', async () => {
  const response = runtime.json({ ok: true }, 201, { 'x-test': 'yes' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-app-version'), '6.120.0-rc144');
  assert.equal(response.headers.get('x-api-contract'), '5');
  assert.equal(response.headers.get('x-min-client-version'), '5.8.0');
  assert.equal(response.headers.get('x-release-channel'), 'rc144');
  assert.equal(response.headers.get('vary'), 'x-telegram-init-data');
  assert.equal(response.headers.get('x-test'), 'yes');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('HTTP boundary preserves admin forbidden response contract', async () => {
  const response = runtime.adminForbidden();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Этот технический раздел доступен только администратору.',
    code: 'ADMIN_ONLY',
  });
});

test('HTTP boundary preserves public route error categories and limits', () => {
  assert.deepEqual(runtime.publicRouteError({ code: 'FOOTBALL_RATE_LIMIT', retryAfter: 7 }), {
    status: 429,
    body: {
      error: 'Футбольные данные временно обновляются медленнее. Повторите примерно через 7 сек.',
      code: 'FOOTBALL_RATE_LIMIT',
      category: 'rate_limit',
      recoverable: true,
      retryAfter: 7,
    },
  });

  assert.deepEqual(runtime.publicRouteError({ code: 'FAVORITES_LIMIT' }), {
    status: 409,
    body: {
      error: 'Достигнут лимит избранных команд: 25.',
      code: 'FAVORITES_LIMIT',
      category: 'limit',
      recoverable: false,
    },
  });

  assert.equal(runtime.publicRouteError(new Error('Supabase unavailable')).status, 503);
  assert.equal(runtime.publicRouteError({ code: 'UPSTREAM_TIMEOUT' }).status, 504);
  assert.equal(runtime.publicRouteError({ code: 'FOOTBALL_PROVIDER_FAILURE' }).status, 502);
  assert.equal(runtime.publicRouteError(new Error('unknown')).body.category, 'service');
});

test('worker composes HTTP runtime instead of owning response helper implementations', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.match(worker, /import \{ createHttpRuntime \} from '\.\/http\.js';/);
  assert.match(worker, /const \{ json, adminForbidden, publicRouteError \} = createHttpRuntime\(/);
  assert.doesNotMatch(worker, /function json\(/);
  assert.doesNotMatch(worker, /function adminForbidden\(/);
  assert.doesNotMatch(worker, /function publicRouteError\(/);
});
