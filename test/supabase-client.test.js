import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient } from '../src/supabase-client.js';

function response({ ok = true, status = 200, json = null, text = '', headers = {} } = {}) {
  const normalized = new Map(Object.entries(headers).map(([key,value]) => [String(key).toLowerCase(), String(value)]));
  return {
    ok,
    status,
    headers: { get(name) { return normalized.get(String(name).toLowerCase()) || null; } },
    async json() { return json; },
    async text() { return text; },
  };
}

test('supabase client sends opaque secret keys only through apikey', async () => {
  const calls = [];
  const client = createSupabaseClient({
    fetchWithTimeout: async (url, init, timeoutMs, source) => {
      calls.push({ url: String(url), init, timeoutMs, source });
      return response({ json: [{ id: 1 }] });
    },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_secret_example' };
  const row = await client.supaSelectOne(cfg, 'users', { telegram_id: 'eq.1' });
  assert.equal(row.id, 1);
  assert.equal(calls[0].init.headers.apikey, 'sb_secret_example');
  assert.equal('authorization' in calls[0].init.headers, false);
  assert.equal(calls[0].timeoutMs, 7000);
  assert.match(calls[0].url, /\/rest\/v1\/users/);
});

test('supabase client preserves write preferences and RPC error contract', async () => {
  const calls = [];
  const client = createSupabaseClient({
    fetchWithTimeout: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/rpc/fail_me')) {
        return response({ ok: false, status: 409, json: { code: 'PGRST_TEST', message: 'sensitive upstream detail', details: 'detail' } });
      }
      return response({ status: 201, json: null });
    },
    redactMessage: () => '[redacted]',
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'secret' };
  await client.supaUpsert(cfg, 'users', { telegram_id: 1 }, 'telegram_id');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  await assert.rejects(
    client.supaRpc(cfg, 'fail_me', { value: 1 }),
    error => error.code === 'PGRST_TEST' && error.detail === 'detail' && error.message.includes('[redacted]'),
  );
});

test('supabase pagination keeps the existing cap and truncation semantics', async () => {
  let calls = 0;
  const client = createSupabaseClient({
    fetchWithTimeout: async url => {
      calls += 1;
      const offset = Number(new URL(String(url)).searchParams.get('offset') || 0);
      return response({ json: offset === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }] });
    },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'secret' };
  const page = await client.supaSelectPaged(cfg, 'items', {}, { pageSize: 2, maxRows: 4, order: 'id.asc' });
  assert.deepEqual(page, { rows: [{ id: 1 }, { id: 2 }, { id: 3 }], truncated: false });
  assert.equal(calls, 2);
});

test('supabase client rejects construction without timeout transport', () => {
  assert.throws(() => createSupabaseClient(), /requires fetchWithTimeout/);
});


test('supabase client refuses unfiltered patch and delete operations', async () => {
  let calls = 0;
  const client = createSupabaseClient({
    fetchWithTimeout: async () => {
      calls += 1;
      return response({ status: 204, json: null });
    },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'secret' };

  await assert.rejects(
    client.supaPatch(cfg, 'users', {}, { plan: 'FREE' }),
    /PATCH requires at least one filter/,
  );
  await assert.rejects(
    client.supaDelete(cfg, 'users'),
    /DELETE requires at least one filter/,
  );
  assert.equal(calls, 0);
});


test('supabase reads retry one transient 503 before succeeding', async () => {
  let calls = 0;
  const sleeps = [];
  const client = createSupabaseClient({
    fetchWithTimeout: async () => {
      calls += 1;
      if (calls === 1) return response({ ok: false, status: 503, json: null });
      return response({ json: [{ id: 2 }] });
    },
    sleepMs: async ms => { sleeps.push(ms); },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'secret' };

  const row = await client.supaSelectOne(cfg, 'users', { telegram_id: 'eq.2' });
  assert.deepEqual(row, { id: 2 });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [180]);
});

test('supabase reads retry one transient PGRST303 401 for opaque server secret keys', async () => {
  let calls = 0;
  const sleeps = [];
  const client = createSupabaseClient({
    fetchWithTimeout: async () => {
      calls += 1;
      if (calls === 1) {
        return response({
          ok: false,
          status: 401,
          headers: { 'proxy-status': 'PostgREST; error=PGRST303' },
        });
      }
      return response({ json: [{ id: 303 }] });
    },
    sleepMs: async ms => { sleeps.push(ms); },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_secret_example' };

  const row = await client.supaSelectOne(cfg, 'analysis_cache', { cache_key: 'eq.example' });
  assert.deepEqual(row, { id: 303 });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [180]);
});

test('supabase idempotent upsert retries one transient PGRST303 401 for opaque server secret keys', async () => {
  let calls = 0;
  const sleeps = [];
  const client = createSupabaseClient({
    fetchWithTimeout: async () => {
      calls += 1;
      if (calls === 1) {
        return response({
          ok: false,
          status: 401,
          headers: { 'proxy-status': 'PostgREST; error=PGRST303' },
        });
      }
      return response({ ok: true, status: 201, json: null });
    },
    sleepMs: async ms => { sleeps.push(ms); },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_secret_example' };

  await client.supaUpsert(cfg, 'analysis_cache', { cache_key: 'example', payload: { ok: true } }, 'cache_key');
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [180]);
});

test('supabase idempotent upsert keeps ordinary 401 responses fail-closed', async () => {
  let calls = 0;
  const sleeps = [];
  const client = createSupabaseClient({
    fetchWithTimeout: async () => {
      calls += 1;
      return response({
        ok: false,
        status: 401,
        text: 'unauthorized',
        headers: { 'proxy-status': 'PostgREST; error=PGRST301' },
      });
    },
    sleepMs: async ms => { sleeps.push(ms); },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_secret_example' };

  await assert.rejects(
    client.supaUpsert(cfg, 'analysis_cache', { cache_key: 'example' }, 'cache_key'),
    /HTTP 401/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test('supabase read auth retry stays fail-closed for ordinary 401 responses', async () => {
  const cases = [
    {
      key: 'sb_secret_example',
      headers: { 'proxy-status': 'PostgREST; error=PGRST301' },
      label: 'different PostgREST auth code',
    },
    {
      key: 'legacy-service-role-jwt',
      headers: { 'proxy-status': 'PostgREST; error=PGRST303' },
      label: 'non-opaque legacy key',
    },
    {
      key: 'sb_secret_example',
      headers: {},
      label: '401 without gateway evidence',
    },
  ];

  for (const item of cases) {
    let calls = 0;
    const sleeps = [];
    const client = createSupabaseClient({
      fetchWithTimeout: async () => {
        calls += 1;
        return response({ ok: false, status: 401, headers: item.headers });
      },
      sleepMs: async ms => { sleeps.push(ms); },
    });
    const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: item.key };
    await assert.rejects(
      client.supaSelectOne(cfg, 'analysis_cache', { cache_key: 'eq.example' }),
      /HTTP 401/,
      item.label,
    );
    assert.equal(calls, 1, item.label);
    assert.deepEqual(sleeps, [], item.label);
  }
});

test('supabase reads retry one thrown transport failure before succeeding', async () => {
  let calls = 0;
  const sleeps = [];
  const client = createSupabaseClient({
    fetchWithTimeout: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('timeout'), { code: 'UPSTREAM_TIMEOUT' });
      return response({ json: [{ id: 3 }] });
    },
    sleepMs: async ms => { sleeps.push(ms); },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'secret' };

  const row = await client.supaSelectOne(cfg, 'users', { telegram_id: 'eq.3' });
  assert.deepEqual(row, { id: 3 });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [180]);
});

test('supabase read retry stays conservative and generic write transport failures are not retried', async () => {
  let readCalls = 0;
  const readSleeps = [];
  const readClient = createSupabaseClient({
    fetchWithTimeout: async () => {
      readCalls += 1;
      return response({ ok: false, status: 429, json: null });
    },
    sleepMs: async ms => { readSleeps.push(ms); },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'secret' };

  await assert.rejects(
    readClient.supaSelectOne(cfg, 'users', { telegram_id: 'eq.4' }),
    /HTTP 429/,
  );
  assert.equal(readCalls, 1);
  assert.deepEqual(readSleeps, []);

  let writeCalls = 0;
  const writeClient = createSupabaseClient({
    fetchWithTimeout: async () => {
      writeCalls += 1;
      throw new Error('network');
    },
    sleepMs: async () => { throw new Error('write retry must not sleep'); },
  });
  await assert.rejects(
    writeClient.supaUpsert(cfg, 'users', { telegram_id: 4 }, 'telegram_id'),
    /network/,
  );
  assert.equal(writeCalls, 1);
});


test('supabase select-many supports a narrow projection without changing default selection', async () => {
  const calls = [];
  const client = createSupabaseClient({
    fetchWithTimeout: async url => {
      calls.push(new URL(String(url)));
      return response({ json: [] });
    },
  });
  const cfg = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'secret' };

  await client.supaSelectMany(cfg, 'ops_events', {}, { limit: 10, select: 'message,created_at' });
  await client.supaSelectMany(cfg, 'users', {}, { limit: 1 });

  assert.equal(calls[0].searchParams.get('select'), 'message,created_at');
  assert.equal(calls[1].searchParams.get('select'), '*');
});
