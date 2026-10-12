// Ложная тревога монитора 12.10: «schema_fingerprint» при здоровой схеме.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSupabaseSchemaRuntime } from '../src/supabase-schema-runtime.js';

const contract = JSON.parse(fs.readFileSync('release-contract.json', 'utf8')).databaseContract;

function runtime(rpc) {
  const calls = [];
  const schema = createSupabaseSchemaRuntime({
    EXPECTED_SCHEMA_FINGERPRINT: contract.fingerprint,
    COMPATIBLE_SCHEMA_FINGERPRINTS: contract.compatibleFingerprints,
    PERSONAL_WRITE_LIMITS: {},
    bumpTelemetry() {},
    fetchWithTimeout: async () => new Response('[]'),
    hasSupabase: () => true,
    readProviderIncidentAlertDeliveryContract: async () => ({ ok: true }),
    redactOpsString: value => String(value),
    sleepMs: async () => {},
    supaHeaders: () => ({}),
    supaRpc: async (_cfg, name) => { calls.push(name); return rpc(name); },
  });
  return { schema, calls };
}

test('the monitor checks the v2 schema contract, not the frozen v1 fingerprint', async () => {
  const { schema, calls } = runtime(name => (name === 'backend_schema_contract_v2'
    ? { ok: true, version: 2, fingerprint: contract.fingerprint }
    : { ok: true, fingerprint: contract.legacyFingerprint }));
  const result = await schema.readSupabaseSchemaFingerprint({});
  assert.deepEqual(calls, ['backend_schema_contract_v2']);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');
});

test('a fresh-install or previous compatible contract is healthy, an unknown one is drift', async () => {
  for (const fingerprint of contract.compatibleFingerprints) {
    assert.equal((await runtime(() => ({ ok: true, fingerprint })).schema.readSupabaseSchemaFingerprint({})).ok, true, fingerprint);
  }
  const drift = await runtime(() => ({ ok: true, fingerprint: contract.legacyFingerprint })).schema.readSupabaseSchemaFingerprint({});
  assert.equal(drift.ok, false);
  assert.equal(drift.status, 'fingerprint_mismatch');
  const unconfirmed = await runtime(() => ({ ok: 'yes', fingerprint: contract.fingerprint })).schema.readSupabaseSchemaFingerprint({});
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.status, 'fingerprint_unconfirmed');
});

test('the worker passes the same compatible list the release contract declares', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.match(worker, new RegExp(`const EXPECTED_SCHEMA_FINGERPRINT = '${contract.fingerprint}'`));
  assert.match(worker, /createSupabaseSchemaRuntime\(\{\n\s+EXPECTED_SCHEMA_FINGERPRINT,\n\s+COMPATIBLE_SCHEMA_FINGERPRINTS,/);
});
