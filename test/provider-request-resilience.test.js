import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRequestBoundary, retryAfterSeconds } from '../src/providers/provider-request.js';

function runtime(overrides = {}) {
  const events = [];
  const counters = {};
  const sleeps = [];
  const inflight = new Map();
  const keys = [];
  let nowMs = 1_000;

  const withSingleFlight = overrides.withSingleFlight || (async (key, factory) => {
    keys.push(key);
    const existing = inflight.get(key);
    if (existing) return await existing;
    const task = Promise.resolve().then(factory);
    inflight.set(key, task);
    try { return await task; }
    finally { if (inflight.get(key) === task) inflight.delete(key); }
  });

  const api = createProviderRequestBoundary({
    fetchWithTimeout: overrides.fetchWithTimeout || (async () => new Response(JSON.stringify({ ok:true }), { status:200 })),
    withSingleFlight,
    sleepMs: async ms => { sleeps.push(ms); },
    recordOpsEvent: async (_cfg, event) => { events.push(event); },
    bumpTelemetry: (key, amount = 1) => { counters[key] = Number(counters[key] || 0) + Number(amount || 0); },
    now: () => { nowMs += 5; return nowMs; },
  });

  return { api, events, counters, sleeps, keys };
}

test('secondary provider success returns JSON payload unchanged', async () => {
  const { api } = runtime({
    fetchWithTimeout: async () => new Response(JSON.stringify([{ id:1 }]), { status:200 }),
  });
  const result = await api.providerRequestJson('https://example.com/data', {}, { provider:'OpenLigaDB', operation:'standings' });
  assert.deepEqual(result, [{ id:1 }]);
});

test('secondary provider retries one network rejection and succeeds', async () => {
  let calls = 0;
  const { api, sleeps, counters } = runtime({
    fetchWithTimeout: async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket reset');
      return new Response(JSON.stringify({ ok:true }), { status:200 });
    },
  });
  const result = await api.providerRequestJson('https://example.com/data', {}, { provider:'football-data.org', operation:'standings' });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [180]);
  assert.equal(counters.providerRetries, 1);
});

test('secondary provider timeout is classified and bounded when retries exhaust', async () => {
  let calls = 0;
  const timeout = Object.assign(new Error('timeout'), { code:'UPSTREAM_TIMEOUT' });
  const { api, counters } = runtime({
    fetchWithTimeout: async () => { calls += 1; throw timeout; },
  });
  await assert.rejects(
    () => api.providerRequestJson('https://example.com/data', {}, { provider:'OpenLigaDB', operation:'events' }),
    error => error?.code === 'PROVIDER_TIMEOUT',
  );
  assert.equal(calls, 2);
  assert.equal(counters.providerTimeouts, 2);
  assert.equal(counters.providerRetries, 1);
});

test('secondary provider retries HTTP 503 once and returns the recovered response', async () => {
  let calls = 0;
  const { api, sleeps } = runtime({
    fetchWithTimeout: async () => {
      calls += 1;
      if (calls === 1) return new Response('temporarily unavailable', { status:503 });
      return new Response(JSON.stringify({ recovered:true }), { status:200 });
    },
  });
  const result = await api.providerRequestJson('https://example.com/data', {}, { provider:'The Odds API', operation:'odds' });
  assert.equal(result.recovered, true);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [180]);
});

test('secondary provider does not retry HTTP 500', async () => {
  let calls = 0;
  const { api } = runtime({
    fetchWithTimeout: async () => { calls += 1; return new Response('error', { status:500 }); },
  });
  await assert.rejects(
    () => api.providerRequestJson('https://example.com/data', {}, { provider:'OpenLigaDB', operation:'standings' }),
    error => error?.code === 'PROVIDER_HTTP_ERROR' && error?.status === 500,
  );
  assert.equal(calls, 1);
});

test('secondary provider handles HTTP 429 separately and respects Retry-After without retry storm', async () => {
  let calls = 0;
  const { api, counters, events } = runtime({
    fetchWithTimeout: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error:'limit' }), { status:429, headers:{ 'Retry-After':'17' } });
    },
  });
  await assert.rejects(
    () => api.providerRequestJson('https://example.com/data', {}, { provider:'football-data.org', operation:'scorers' }),
    error => error?.code === 'PROVIDER_RATE_LIMITED' && error?.retryAfter === 17,
  );
  assert.equal(calls, 1);
  assert.equal(counters.providerRateLimits, 1);
  assert.equal(events.at(-1)?.meta?.finalResult, 'rate_limited');
});

test('secondary provider does not retry 400, 401, or 403', async () => {
  for (const status of [400, 401, 403]) {
    let calls = 0;
    const { api } = runtime({
      fetchWithTimeout: async () => { calls += 1; return new Response('client error', { status }); },
    });
    await assert.rejects(
      () => api.providerRequestJson(`https://example.com/${status}`, {}, { provider:'OpenLigaDB', operation:'standings' }),
      error => error?.code === 'PROVIDER_HTTP_ERROR' && error?.status === status,
    );
    assert.equal(calls, 1, String(status));
  }
});

test('secondary provider rejects invalid JSON as PROVIDER_INVALID_RESPONSE', async () => {
  const { api } = runtime({
    fetchWithTimeout: async () => new Response('{not-json', { status:200, headers:{ 'content-type':'application/json' } }),
  });
  await assert.rejects(
    () => api.providerRequestJson('https://example.com/data', {}, { provider:'OpenLigaDB', operation:'events' }),
    error => error?.code === 'PROVIDER_INVALID_RESPONSE',
  );
});

test('secondary provider rejects primitive response shapes', async () => {
  const { api } = runtime({
    fetchWithTimeout: async () => new Response(JSON.stringify('unexpected'), { status:200 }),
  });
  await assert.rejects(
    () => api.providerRequestJson('https://example.com/data', {}, { provider:'OpenLigaDB', operation:'events' }),
    error => error?.code === 'PROVIDER_INVALID_RESPONSE',
  );
});

test('secondary provider single-flight deduplicates identical concurrent requests and redacts secret query keys', async () => {
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { api, keys } = runtime({
    fetchWithTimeout: async () => {
      calls += 1;
      await pending;
      return new Response(JSON.stringify({ ok:true }), { status:200 });
    },
  });

  const url = 'https://example.com/data?apiKey=secret-value&league=39';
  const a = api.providerRequestJson(url, {}, { provider:'The Odds API', operation:'odds' });
  const b = api.providerRequestJson(url, {}, { provider:'The Odds API', operation:'odds' });
  await Promise.resolve();
  release();
  const [left, right] = await Promise.all([a, b]);

  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.equal(calls, 1);
  assert.equal(keys.length, 2);
  assert.equal(keys[0].includes('secret-value'), false);
});

test('Retry-After supports HTTP-date form', () => {
  const headers = new Headers({ 'Retry-After':'Thu, 01 Jan 1970 00:00:20 GMT' });
  assert.equal(retryAfterSeconds(headers, 60, 10_000), 10);
});
