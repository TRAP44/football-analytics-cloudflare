import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisAccessLeaseRuntime } from '../src/analysis-access-lease.js';

test('local analysis access lease serializes one user and releases without charging anything', async () => {
  let clock = Date.parse('2026-10-05T10:00:00Z');
  const memory = {};
  const runtime = createAnalysisAccessLeaseRuntime({
    memory,
    hasSupabase: () => false,
    supaRpc: async () => { throw new Error('unexpected rpc'); },
    now: () => clock,
  });

  const first = await runtime.claimAnalysisAccessLease(42, {}, '2026-10-05');
  assert.equal(first.claimed, true);
  const blocked = await runtime.claimAnalysisAccessLease(42, {}, '2026-10-05');
  assert.equal(blocked.claimed, false);
  assert.equal(blocked.reason, 'duplicate_inflight');
  assert.ok(blocked.retryAfter > 0);

  assert.equal(await runtime.releaseAnalysisAccessLease(first, {}), true);
  const next = await runtime.claimAnalysisAccessLease(42, {}, '2026-10-05');
  assert.equal(next.claimed, true);

  clock += 601_000;
  const recovered = await runtime.claimAnalysisAccessLease(77, {}, '2026-10-05');
  assert.equal(recovered.claimed, true);
});

test('persistent lease reuses distributed sensitive-mutation coordinator and releases as retryable', async () => {
  const calls = [];
  const runtime = createAnalysisAccessLeaseRuntime({
    memory: {},
    hasSupabase: () => true,
    supaRpc: async (_cfg, name, payload) => {
      calls.push({ name, payload });
      if (name === 'claim_sensitive_mutation') {
        return { claimed: true, leaseToken: 'lease-1', lockedUntil: '2026-10-05T10:10:00Z' };
      }
      if (name === 'fail_sensitive_mutation') return { ok: true, updated: true };
      throw new Error('unexpected rpc');
    },
    now: () => Date.parse('2026-10-05T10:00:00Z'),
  });

  const claim = await runtime.claimAnalysisAccessLease(42, { supabaseUrl: 'x' }, '2026-10-05');
  assert.equal(claim.claimed, true);
  assert.match(claim.operationKey, /^[0-9a-f]{64}$/);
  assert.equal(calls[0].name, 'claim_sensitive_mutation');
  assert.equal(calls[0].payload.p_path, '/api/analyze-access-lease');
  assert.equal(calls[0].payload.p_lease_seconds, 600);
  assert.equal(calls[0].payload.p_retention_seconds, 600);

  assert.equal(await runtime.releaseAnalysisAccessLease(claim, { supabaseUrl: 'x' }), true);
  assert.equal(calls[1].name, 'fail_sensitive_mutation');
  assert.equal(calls[1].payload.p_retryable, true);
});

test('persistent coordinator outage fails closed and emits an operational signal', async () => {
  const events = [];
  const counters = [];
  const runtime = createAnalysisAccessLeaseRuntime({
    memory: {},
    hasSupabase: () => true,
    supaRpc: async () => { throw Object.assign(new Error('db unavailable'), { code: 'UPSTREAM_TIMEOUT' }); },
    recordOpsEvent: async (_cfg, event) => events.push(event),
    bumpTelemetry: key => counters.push(key),
  });

  const claim = await runtime.claimAnalysisAccessLease(42, { supabaseUrl: 'x' }, '2026-10-05');
  assert.equal(claim.claimed, false);
  assert.equal(claim.unavailable, true);
  assert.equal(claim.reason, 'guard_unavailable');
  assert.ok(counters.includes('analysisAccessLeaseErrors'));
  assert.equal(events[0].code, 'ANALYSIS_ACCESS_LEASE_UNAVAILABLE');
});
