import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dispatchApiRoute } from '../src/router.js';

const request = method => ({ method });
const url = pathname => ({ pathname });
const baseDeps = () => ({
  json: (body, status = 200) => ({ body, status }),
  publicDataCapabilities: () => ({ ok: true }),
  isAdminUser: () => false,
  adminForbidden: () => ({ status: 403, body: { error: 'forbidden' } }),
  memory: { providerAudit: { last: null } },
});

test('router resolves normal-user API route without changing handler arguments', async () => {
  const calls = [];
  const deps = { ...baseDeps(), apiMe: async (...args) => { calls.push(args); return { ok: 'me' }; } };
  const req = request('GET');
  const cfg = { marker: 'cfg' };
  const user = { id: 42 };
  const result = await dispatchApiRoute(req, url('/api/me'), cfg, user, deps);
  assert.deepEqual(result, { ok: 'me' });
  assert.deepEqual(calls[0], [req, cfg, user]);
});

test('admin routes remain isolated inside router boundary', async () => {
  let handlerCalled = false;
  const deps = { ...baseDeps(), apiDiagnostics: async () => { handlerCalled = true; } };
  const result = await dispatchApiRoute(request('GET'), url('/api/diagnostics'), {}, { id: 7 }, deps);
  assert.equal(result.status, 403);
  assert.equal(handlerCalled, false);
});

test('unknown API route keeps response compatibility', async () => {
  const result = await dispatchApiRoute(request('GET'), url('/api/not-real'), {}, { id: 7 }, baseDeps());
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'Маршрут не найден.');
});

test('billing stays unavailable while monetization is disabled', async () => {
  const result = await dispatchApiRoute(request('GET'), url('/api/billing/plans'), { monetizationEnabled: false }, { id: 7 }, baseDeps());
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'Монетизация отложена до финального этапа проекта.');
});

test('worker authenticates and applies beta/runtime/burst guards before router dispatch', () => {
  const source = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const auth = source.indexOf('const user = await getRequestUser(request, cfg)');
  const beta = source.indexOf('const betaAccess = closedBetaAccessDecision(user, cfg)', auth);
  const runtime = source.indexOf('const runtimeResponse = runtimeGuard(request, user, cfg', beta);
  const burst = source.indexOf('const burstResponse = enforceRouteBurst(request, user)', runtime);
  const dispatch = source.indexOf('dispatchApiRoute(request, url, cfg, user, API_ROUTE_DEPS)', burst);
  assert.ok(auth > -1 && auth < beta && beta < runtime && runtime < burst && burst < dispatch);
});
