import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient } from '../src/supabase-client.js';

function response({ ok = true, status = 200, json = null, text = '' } = {}) {
  return {
    ok,
    status,
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
