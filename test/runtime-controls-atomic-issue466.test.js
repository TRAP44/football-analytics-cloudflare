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

function buildRuntime(fetchWithTimeout, currentRevision = 3) {
  const memory = { runtimeControls: null };
  const events = [];
  const api = createRuntimeControlsRuntime({
    memory,
    DEFAULT_RUNTIME_CONTROLS,
    RUNTIME_CONTROLS_CACHE_MS: 30_000,
    SUPABASE_SCHEMA_GUIDANCE: 'schema guidance',
    APP_VERSION: 'test-466',
    hasSupabase: () => true,
    supaSelectOne: async (_cfg, table) => {
      if (table === 'runtime_controls') {
        return {
          id: 'global',
          revision: currentRevision,
          maintenance_mode: false,
          analysis_enabled: true,
          search_enabled: true,
          live_enabled: true,
          reminders_enabled: true,
          expanded_data_enabled: true,
          auto_settlement_recovery_enabled: false,
          message: '',
          updated_at: '2026-10-05T08:00:00.000Z',
        };
      }
      return null;
    },
    supaInsertIgnore: async () => {
      throw new Error('legacy history insert must not be called');
    },
    supaSelectMany: async () => [],
    fetchWithTimeout,
    supaHeaders: (_cfg, extra = {}) => ({ authorization: 'test', ...extra }),
    recordOpsEvent: async (_cfg, event) => { events.push(event); },
    redactOpsString: value => String(value || '').slice(0, 160),
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    isAdminUser: () => true,
    clock: () => Date.parse('2026-10-05T08:30:00.000Z'),
  });
  return { api, memory, events };
}

test('issue #466 commits runtime state and history through one atomic RPC', async () => {
  const calls = [];
  const { api, memory } = buildRuntime(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/rest/v1/runtime_control_history')) {
      return new Response('[]', { status: 200 });
    }
    if (String(url).includes('/rest/v1/rpc/commit_runtime_controls')) {
      const body = JSON.parse(options.body);
      assert.deepEqual(body, {
        p_expected_revision: 3,
        p_maintenance_mode: true,
        p_analysis_enabled: false,
        p_search_enabled: true,
        p_live_enabled: true,
        p_reminders_enabled: true,
        p_expanded_data_enabled: true,
        p_auto_settlement_recovery_enabled: false,
        p_message: 'maintenance',
        p_updated_by: 123,
        p_action: 'update',
        p_reason: 'planned',
        p_app_version: 'test-466',
        p_source_revision: null,
      });
      return new Response(JSON.stringify({
        ok: true,
        historyRevision: 4,
        row: {
          id: 'global',
          revision: 4,
          maintenance_mode: true,
          analysis_enabled: false,
          search_enabled: true,
          live_enabled: true,
          reminders_enabled: true,
          expanded_data_enabled: true,
          auto_settlement_recovery_enabled: false,
          message: 'maintenance',
          updated_at: '2026-10-05T08:30:00.000Z',
          updated_by: 123,
        },
      }), { status: 200 });
    }
    throw new Error('unexpected request ' + url);
  });

  const result = await api.saveRuntimeControls(
    { supabaseUrl: 'https://example.supabase.co' },
    { id: 123 },
    {
      expectedRevision: 3,
      maintenanceMode: true,
      analysisEnabled: false,
      searchEnabled: true,
      liveEnabled: true,
      remindersEnabled: true,
      expandedDataEnabled: true,
      autoSettlementRecoveryEnabled: false,
      message: 'maintenance',
      reason: 'planned',
    },
  );

  assert.equal(result.status, 200);
  assert.equal(result.historyReady, true);
  assert.equal(result.value.revision, 4);
  assert.equal(memory.runtimeControls.value.revision, 4);
  assert.equal(calls.filter(call => call.url.includes('/rpc/commit_runtime_controls')).length, 1);
  assert.equal(calls.some(call => call.url.includes('/rest/v1/runtime_controls?')), false);
});

test('issue #466 fails closed before mutation when runtime history schema is unavailable', async () => {
  let atomicCalls = 0;
  const { api, memory } = buildRuntime(async (url) => {
    if (String(url).includes('/rest/v1/runtime_control_history')) {
      return new Response('schema unavailable', { status: 503 });
    }
    if (String(url).includes('/rpc/commit_runtime_controls')) atomicCalls += 1;
    return new Response('{}', { status: 500 });
  });

  const result = await api.saveRuntimeControls(
    { supabaseUrl: 'https://example.supabase.co' },
    { id: 123 },
    { expectedRevision: 3 },
  );

  assert.equal(result.status, 503);
  assert.equal(result.code, 'RUNTIME_HISTORY_SCHEMA');
  assert.equal(atomicCalls, 0);
  assert.equal(memory.runtimeControls.value.revision, 3);
});

test('issue #466 does not promote in-memory state when atomic commit is unconfirmed', async () => {
  const { api, memory, events } = buildRuntime(async (url) => {
    if (String(url).includes('/rest/v1/runtime_control_history')) {
      return new Response('[]', { status: 200 });
    }
    if (String(url).includes('/rpc/commit_runtime_controls')) {
      return new Response(JSON.stringify({
        ok: false,
        reason: 'history_insert_failed',
      }), { status: 200 });
    }
    throw new Error('unexpected request ' + url);
  });

  const result = await api.saveRuntimeControls(
    { supabaseUrl: 'https://example.supabase.co' },
    { id: 123 },
    { expectedRevision: 3, maintenanceMode: true },
  );

  assert.equal(result.status, 503);
  assert.equal(result.code, 'RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED');
  assert.equal(memory.runtimeControls.value.revision, 3);
  assert.equal(events.some(event => event.code === 'RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED'), true);
});

test('issue #466 preserves optimistic conflict semantics returned by the atomic RPC', async () => {
  const { api, memory } = buildRuntime(async (url) => {
    if (String(url).includes('/rest/v1/runtime_control_history')) {
      return new Response('[]', { status: 200 });
    }
    if (String(url).includes('/rpc/commit_runtime_controls')) {
      return new Response(JSON.stringify({
        ok: false,
        reason: 'revision_conflict',
        current: {
          id: 'global',
          revision: 4,
          maintenance_mode: false,
          analysis_enabled: true,
          search_enabled: true,
          live_enabled: true,
          reminders_enabled: true,
          expanded_data_enabled: true,
          auto_settlement_recovery_enabled: false,
          message: '',
        },
      }), { status: 200 });
    }
    throw new Error('unexpected request ' + url);
  });

  const result = await api.saveRuntimeControls(
    { supabaseUrl: 'https://example.supabase.co' },
    { id: 123 },
    { expectedRevision: 3 },
  );

  assert.equal(result.status, 409);
  assert.equal(result.code, 'RUNTIME_CONTROLS_CONFLICT');
  assert.equal(result.current.revision, 4);
  assert.equal(memory.runtimeControls.value.revision, 3);
});
