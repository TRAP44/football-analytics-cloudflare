import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeControlsRuntime } from '../src/runtime-controls.js';

const DEFAULT_RUNTIME_CONTROLS = Object.freeze({
  maintenanceMode: false,
  analysisEnabled: true,
  searchEnabled: true,
  liveEnabled: true,
  remindersEnabled: true,
  expandedDataEnabled: true,
  autoSettlementRecoveryEnabled: false,
  message: '',
  revision: 1,
  updatedAt: null,
});

function runtime(overrides = {}) {
  const memory = { runtimeControls: null };
  const events = [];
  let nowMs = 1_700_000_000_000;
  const api = createRuntimeControlsRuntime({
    memory,
    DEFAULT_RUNTIME_CONTROLS,
    RUNTIME_CONTROLS_CACHE_MS: 30_000,
    SUPABASE_SCHEMA_GUIDANCE: 'schema guidance',
    APP_VERSION: 'test',
    hasSupabase: overrides.hasSupabase || (() => false),
    supaSelectOne: overrides.supaSelectOne || (async () => null),
    supaInsertIgnore: overrides.supaInsertIgnore || (async () => null),
    supaSelectMany: overrides.supaSelectMany || (async () => []),
    fetchWithTimeout: overrides.fetchWithTimeout || (async () => new Response('[]', { status: 200 })),
    supaHeaders: () => ({ authorization: 'test' }),
    recordOpsEvent: async (_cfg, event) => { events.push(event); },
    redactOpsString: value => String(value || '').slice(0, 160),
    json: (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
    isAdminUser: overrides.isAdminUser || (() => false),
    now: () => nowMs,
  });
  return {
    api,
    memory,
    events,
    setNow(value) { nowMs = value; },
  };
}

test('runtime-controls domain normalizes database rows and exposes only public control state', () => {
  const { api } = runtime();
  const normalized = api.normalizeRuntimeControls({
    maintenance_mode: true,
    analysis_enabled: false,
    search_enabled: true,
    live_enabled: false,
    reminders_enabled: true,
    expanded_data_enabled: false,
    auto_settlement_recovery_enabled: true,
    message: 'maintenance',
    revision: 7,
    updated_at: '2026-10-04T12:00:00.000Z',
  });

  assert.deepEqual(api.publicRuntimeControls(normalized), {
    maintenanceMode: true,
    analysisEnabled: false,
    searchEnabled: true,
    liveEnabled: false,
    remindersEnabled: true,
    expandedDataEnabled: false,
    autoSettlementRecoveryEnabled: true,
    securityLockdown: false,
    controlPlaneFailClosed: false,
    message: 'maintenance',
    revision: 7,
    updatedAt: '2026-10-04T12:00:00.000Z',
  });
});

test('runtime-controls domain fails closed when the control plane cannot be verified', async () => {
  const { api, memory } = runtime({ hasSupabase: () => false });
  const state = await api.loadRuntimeControls({});

  assert.equal(state.schemaReady, false);
  assert.equal(state.failClosed, true);
  assert.equal(state.source, 'fail_closed');
  assert.equal(state.value.controlPlaneFailClosed, true);
  assert.equal(state.value.controlPlaneReason, 'supabase_not_configured');
  assert.equal(memory.runtimeControls.value.controlPlaneFailClosed, true);
});

test('runtime-controls domain caches a verified control row for the configured TTL', async () => {
  let reads = 0;
  const { api, setNow } = runtime({
    hasSupabase: () => true,
    supaSelectOne: async () => {
      reads += 1;
      return { id:'global', revision:4, analysis_enabled:true };
    },
  });

  const first = await api.loadRuntimeControls({});
  setNow(1_700_000_010_000);
  const second = await api.loadRuntimeControls({});

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(reads, 1);
  assert.equal(second.value.revision, 4);
});

test('runtime-controls domain preserves optimistic revision conflict semantics', async () => {
  const { api } = runtime({
    hasSupabase: () => true,
    supaSelectOne: async () => ({
      id:'global',
      revision:9,
      maintenance_mode:false,
      analysis_enabled:true,
      search_enabled:true,
      live_enabled:true,
      reminders_enabled:true,
      expanded_data_enabled:true,
      auto_settlement_recovery_enabled:false,
    }),
  });

  const result = await api.saveRuntimeControls({}, { id:123 }, { expectedRevision:8 });
  assert.equal(result.status, 409);
  assert.equal(result.code, 'RUNTIME_CONTROLS_CONFLICT');
  assert.equal(result.current.revision, 9);
});

test('runtime-controls domain preserves maintenance and feature guards for normal users', async () => {
  const { api } = runtime();

  const maintenance = api.runtimeGuard(
    new Request('https://example.com/api/matches'),
    { id:1 },
    {},
    { ...DEFAULT_RUNTIME_CONTROLS, maintenanceMode:true, message:'planned work' },
  );
  assert.equal(maintenance.status, 503);
  assert.equal((await maintenance.json()).code, 'MAINTENANCE_MODE');

  const analysis = api.runtimeGuard(
    new Request('https://example.com/api/analyze', { method:'POST' }),
    { id:1 },
    {},
    { ...DEFAULT_RUNTIME_CONTROLS, analysisEnabled:false },
  );
  assert.equal(analysis.status, 503);
  assert.equal((await analysis.json()).code, 'ANALYSIS_DISABLED');
});

test('runtime-controls domain keeps administrators exempt from ordinary feature toggles', () => {
  const { api } = runtime({ isAdminUser: () => true });
  const response = api.runtimeGuard(
    new Request('https://example.com/api/search'),
    { id:99 },
    {},
    { ...DEFAULT_RUNTIME_CONTROLS, maintenanceMode:true, searchEnabled:false },
  );
  assert.equal(response, null);
});
