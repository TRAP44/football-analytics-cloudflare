import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSettlementRuntime } from '../src/settlement-runtime.js';
import { settlementDependencies } from '../test-support/runtime-deps.js';

// Фоновый запуск начинается с пустой памяти о квоте. Фиксация результатов
// вчерашнего дня должна сама подтянуть снимок квоты (и спросить /status),
// а не откладываться защитой лимитов на платном тарифе (12.10).

function makeRuntime({ probe = true, load = true } = {}) {
  const calls = [];
  const memory = { modelPredictions: new Map(), modelRemediation: { actions: [] }, provider: {} };
  const deps = settlementDependencies({
    memory,
    hasSupabase: () => true,
    getCache: async () => null,
    setCache: async () => { calls.push('setCache'); },
    supaSelectMany: async () => [{ fixture_id: 1, status: 'pending', kickoff_at: new Date(Date.now() - 86400_000).toISOString().slice(0, 10) + 'T15:00:00.000Z' }],
    providerSnapshot: () => ({ plan: memory.provider.plan || 'UNKNOWN', cooldownActive: false }),
    // Как в шлюзе: без подтверждённого тарифа остаток из устаревшего снимка мал.
    freeQuotaHealthy: () => ['PRO', 'ULTRA', 'MEGA'].includes(memory.provider.plan),
    loadProviderFixturesForDate: async () => { calls.push('fixtures'); return []; },
  });
  if (load) deps.loadSharedProviderState = async () => { calls.push('load'); };
  if (probe) deps.probeProviderStatus = async () => { calls.push('probe'); memory.provider = { plan: 'PRO' }; };
  return { runtime: createSettlementRuntime(deps), calls };
}

test('daily settlement probes the provider plan before the quota guard', async () => {
  const { runtime, calls } = makeRuntime();
  const result = await runtime.settleBacktestDaily({ apiFootballKey: 'test' });
  assert.notEqual(result.skipped, 'provider_quota_guard');
  assert.equal(result.pending, 1);
  assert.deepEqual(calls.slice(0, 3), ['load', 'probe', 'fixtures']);
});

test('without the probe dependencies the quota guard behaves as before', async () => {
  const { runtime, calls } = makeRuntime({ probe: false, load: false });
  const result = await runtime.settleBacktestDaily({ apiFootballKey: 'test' });
  assert.equal(result.skipped, 'provider_quota_guard');
  assert.deepEqual(calls, []);
});

test('a failing probe does not break the daily settlement', async () => {
  const { runtime } = makeRuntime({ probe: false });
  const memoryless = createSettlementRuntime(settlementDependencies({
    hasSupabase: () => true,
    getCache: async () => null,
    supaSelectMany: async () => [{ fixture_id: 1, status: 'pending', kickoff_at: new Date(Date.now() - 86400_000).toISOString().slice(0, 10) + 'T15:00:00.000Z' }],
    providerSnapshot: () => ({ plan: 'UNKNOWN' }),
    freeQuotaHealthy: () => false,
    loadSharedProviderState: async () => { throw new Error('db'); },
    probeProviderStatus: async () => { throw new Error('net'); },
  }));
  assert.equal((await memoryless.settleBacktestDaily({ apiFootballKey: 'test' })).skipped, 'provider_quota_guard');
  assert.equal((await runtime.settleBacktestDaily({ apiFootballKey: 'test' })).skipped, 'provider_quota_guard');
});

test('composition root passes the /status probe to the settlement runtime', () => {
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const orchestration = fs.readFileSync(new URL('../src/operational-orchestration-runtime.js', import.meta.url), 'utf8');
  const call = worker.slice(worker.indexOf('} = createOperationalOrchestrationRuntime({'));
  assert.match(call.slice(0, call.indexOf('});')), /\n\s+probeProviderStatus,\n/);
  const settlementCall = orchestration.slice(orchestration.indexOf('} = createSettlementRuntime({'));
  const body = settlementCall.slice(0, settlementCall.indexOf('});'));
  assert.match(body, /\n\s+probeProviderStatus,\n/);
  assert.match(body, /\n\s+loadSharedProviderState,\n/);
});
