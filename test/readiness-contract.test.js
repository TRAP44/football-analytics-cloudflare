import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCompositeReadinessRuntime,
  normalizeCompositeReadinessResponse,
} from '../src/readiness-contract.js';

const FP = '6a7f0fe444f49a2a52c4603e952ee9ea';
const CONTRACT_VERSION = 2;

function healthyRaw(overrides = {}) {
  return {
    ok: true,
    status: 'ok',
    schemaContractVersion: CONTRACT_VERSION,
    connectivity: { ok: true, status: 'ok' },
    schema: {
      ok: true,
      status: 'ok',
      contractVersion: CONTRACT_VERSION,
      fingerprint: {
        ok: true,
        status: 'ok',
        fingerprint: FP,
        expected: FP,
        parts: 100,
      },
      tableChecks: [],
      personalWriteGuards: { ok: true, status: 'ok' },
      providerIncidentAlertDeliveryContract: { ok: true, status: 'ok' },
    },
    backendSecurity: {
      ok: true,
      status: 'ok',
      contract: { ok: true },
      defaultAcl: { ok: true },
    },
    recentSupabaseAuthFailures: {
      available: true,
      count: 0,
      windowMinutes: 5,
    },
    failureReasons: [],
    ...overrides,
  };
}

test('composite readiness healthy path uses exactly one Supabase RPC round-trip', async () => {
  const rpcCalls = [];
  let connectivityCalls = 0;
  const runtime = createCompositeReadinessRuntime({
    hasSupabase: () => true,
    expectedFingerprint: FP,
    expectedContractVersion: CONTRACT_VERSION,
    readinessRpc: 'backend_readiness_contract_v2',
    supaRpc: async (...args) => {
      rpcCalls.push(args);
      return healthyRaw();
    },
    probeConnectivity: async () => {
      connectivityCalls += 1;
      return { ok: true, status: 'ok', attempts: 1 };
    },
  });

  const result = await runtime.readCompositeReadiness({ supabaseUrl: 'x', supabaseKey: 'y' }, 5);
  assert.equal(result.valid, true);
  assert.equal(result.ok, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(connectivityCalls, 0);
  assert.equal(rpcCalls[0][1], 'backend_readiness_contract_v2');
  assert.deepEqual(rpcCalls[0][2], {
    p_expected_fingerprint: FP,
    p_auth_window_minutes: 5,
  });
});

test('one failed security contract remains fail-closed', () => {
  const raw = healthyRaw({
    ok: false,
    backendSecurity: {
      ok: false,
      status: 'violations',
      contract: { ok: false, table_violations: [{ object: 'public.example' }] },
      defaultAcl: { ok: true },
    },
    failureReasons: ['backend_security_contract'],
  });
  const result = normalizeCompositeReadinessResponse(raw, FP);
  assert.equal(result.valid, true);
  assert.equal(result.backendSecurity.ok, false);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failureReasons, ['backend_security_contract']);
});

test('database contract version mismatch remains fail-closed even with matching fingerprint', () => {
  const raw = healthyRaw();
  raw.schemaContractVersion = 1;
  raw.schema = {
    ...raw.schema,
    contractVersion: 1,
  };
  const result = normalizeCompositeReadinessResponse(raw, FP, CONTRACT_VERSION);
  assert.equal(result.valid, true);
  assert.equal(result.schema.fingerprint.ok, false);
  assert.equal(result.schema.ok, false);
  assert.equal(result.ok, false);
});

test('schema fingerprint mismatch remains fail-closed even if top-level RPC lies ok=true', () => {
  const raw = healthyRaw();
  raw.schema = {
    ...raw.schema,
    ok: true,
    fingerprint: {
      ...raw.schema.fingerprint,
      ok: true,
      fingerprint: 'wrong-fingerprint',
    },
  };
  raw.ok = true;
  const result = normalizeCompositeReadinessResponse(raw, FP);
  assert.equal(result.valid, true);
  assert.equal(result.schema.fingerprint.ok, false);
  assert.equal(result.schema.ok, false);
  assert.equal(result.ok, false);
});

test('RPC unavailable uses connectivity only for diagnosis and never falls back to PASS', async () => {
  let connectivityCalls = 0;
  const runtime = createCompositeReadinessRuntime({
    hasSupabase: () => true,
    expectedFingerprint: FP,
    expectedContractVersion: CONTRACT_VERSION,
    readinessRpc: 'backend_readiness_contract_v2',
    supaRpc: async () => {
      throw Object.assign(new Error('Supabase RPC backend_readiness_contract_v2: HTTP 404'), { code: 'PGRST202' });
    },
    probeConnectivity: async () => {
      connectivityCalls += 1;
      return { ok: true, status: 'ok', attempts: 1 };
    },
  });

  const result = await runtime.readCompositeReadiness({}, 5);
  assert.equal(connectivityCalls, 1);
  assert.equal(result.rpcStatus, 'rpc_unavailable');
  assert.equal(result.connectivity.ok, true);
  assert.equal(result.schema.ok, false);
  assert.equal(result.backendSecurity.ok, false);
  assert.equal(result.ok, false);
});

test('malformed RPC response is fail-closed without hiding successful transport connectivity', async () => {
  let connectivityCalls = 0;
  const runtime = createCompositeReadinessRuntime({
    hasSupabase: () => true,
    expectedFingerprint: FP,
    expectedContractVersion: CONTRACT_VERSION,
    readinessRpc: 'backend_readiness_contract_v2',
    supaRpc: async () => ({ ok: true, schema: null }),
    probeConnectivity: async () => {
      connectivityCalls += 1;
      return { ok: true, status: 'ok', attempts: 1 };
    },
  });

  const result = await runtime.readCompositeReadiness({}, 5);
  assert.equal(connectivityCalls, 0);
  assert.equal(result.valid, false);
  assert.equal(result.rpcStatus, 'malformed_response');
  assert.equal(result.connectivity.ok, true);
  assert.equal(result.ok, false);
});

test('Supabase composite timeout remains fail-closed and preserves connectivity diagnosis', async () => {
  const runtime = createCompositeReadinessRuntime({
    hasSupabase: () => true,
    expectedFingerprint: FP,
    expectedContractVersion: CONTRACT_VERSION,
    readinessRpc: 'backend_readiness_contract_v2',
    supaRpc: async () => {
      throw Object.assign(new Error('Supabase readiness timeout'), { code: 'UPSTREAM_TIMEOUT' });
    },
    probeConnectivity: async () => ({ ok: false, status: 'network_error', attempts: 2 }),
  });

  const result = await runtime.readCompositeReadiness({}, 5);
  assert.equal(result.rpcStatus, 'timeout');
  assert.equal(result.connectivity.ok, false);
  assert.equal(result.connectivity.attempts, 2);
  assert.equal(result.ok, false);
});

test('recent auth failures remain fail-closed', () => {
  const raw = healthyRaw({
    ok: false,
    recentSupabaseAuthFailures: { available: true, count: 2, windowMinutes: 5 },
    failureReasons: ['recent_supabase_auth_failures'],
  });
  const result = normalizeCompositeReadinessResponse(raw, FP);
  assert.equal(result.authFailures.count, 2);
  assert.equal(result.ok, false);
});

test('old and composite readiness decisions match on equivalent fixtures', () => {
  const fixtures = [
    { schema: true, security: true, auth: 0, telegram: true },
    { schema: false, security: true, auth: 0, telegram: true },
    { schema: true, security: false, auth: 0, telegram: true },
    { schema: true, security: true, auth: 1, telegram: true },
    { schema: true, security: true, auth: 0, telegram: false },
  ];

  for (const fixture of fixtures) {
    const raw = healthyRaw();
    raw.schema = { ...raw.schema, ok: fixture.schema };
    raw.backendSecurity = { ...raw.backendSecurity, ok: fixture.security };
    raw.recentSupabaseAuthFailures = {
      ...raw.recentSupabaseAuthFailures,
      count: fixture.auth,
    };
    raw.ok = fixture.schema && fixture.security && fixture.auth === 0;

    const composite = normalizeCompositeReadinessResponse(raw, FP);
    const oldDecision = Boolean(
      true
      && fixture.schema
      && fixture.security
      && fixture.telegram
      && fixture.auth === 0
    );
    const newDecision = Boolean(composite.valid && composite.ok && fixture.telegram);
    assert.equal(newDecision, oldDecision);
  }
});
