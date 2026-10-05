import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRuntimeControlsRuntime } from '../src/runtime-controls.js';

const source = fs.readFileSync('src/runtime-controls.js', 'utf8');

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

function row(revision = 5, overrides = {}) {
  return {
    id: 'global',
    maintenance_mode: false,
    analysis_enabled: true,
    search_enabled: true,
    live_enabled: true,
    reminders_enabled: true,
    expanded_data_enabled: true,
    auto_settlement_recovery_enabled: false,
    message: '',
    revision,
    updated_at: '2026-10-05T09:00:00.000Z',
    updated_by: 1,
    ...overrides,
  };
}

function buildRuntime({ historyRow = null, fetchWithTimeout } = {}) {
  const memory = { runtimeControls: null };
  const events = [];
  const inserts = [];

  const api = createRuntimeControlsRuntime({
    memory,
    DEFAULT_RUNTIME_CONTROLS,
    RUNTIME_CONTROLS_CACHE_MS: 30_000,
    SUPABASE_SCHEMA_GUIDANCE: 'schema guidance',
    APP_VERSION: 'test-484',
    hasSupabase: () => true,
    supaSelectOne: async (_cfg, table, filters) => {
      if (table === 'runtime_controls') return row(5);
      if (table === 'runtime_control_history' && filters?.id === 'eq.77') {
        return historyRow;
      }
      return null;
    },
    supaInsertIgnore: async (_cfg, table, value, conflict) => {
      inserts.push({ table, value, conflict });
      return value;
    },
    supaSelectMany: async () => [],
    fetchWithTimeout,
    supaHeaders: (_cfg, extra = {}) => ({ authorization: 'test', ...extra }),
    recordOpsEvent: async (_cfg, event) => { events.push(event); },
    redactOpsString: value => String(value || '').slice(0, 160),
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    isAdminUser: () => true,
    clock: () => Date.parse('2026-10-05T09:30:00.000Z'),
  });

  return { api, memory, events, inserts };
}

test('P0 #484 restores distinct rollback and save function declarations', () => {
  assert.match(source, /async function rollbackRuntimeControls\(cfg, user, body = \{\}\)/);
  assert.match(source, /async function saveRuntimeControls\(cfg, user, body = \{\}\)/);

  const rollbackStart = source.indexOf('async function rollbackRuntimeControls');
  const saveStart = source.indexOf('async function saveRuntimeControls');
  const featureStart = source.indexOf('function runtimeFeatureResponse');

  assert.ok(rollbackStart >= 0);
  assert.ok(saveStart > rollbackStart);
  assert.ok(featureStart > saveStart);

  const rollbackSection = source.slice(rollbackStart, saveStart);
  const saveSection = source.slice(saveStart, featureStart);

  assert.match(rollbackSection, /return await saveRuntimeControls\(cfg, user,/);
  assert.match(saveSection, /const currentState = await loadRuntimeControls\(cfg, \{ force: true \}\)/);
  assert.match(saveSection, /const expectedRevision = Number\(body\.expectedRevision \|\| 0\)/);
  assert.match(saveSection, /RUNTIME_CONTROLS_CONFLICT/);
  assert.match(saveSection, /X-Runtime-Action/);
  assert.match(saveSection, /X-Runtime-Reason-Hex/);
});

test('P0 #484 save validates current revision and performs the atomic rule PATCH', async () => {
  const calls = [];
  const { api, memory, inserts } = buildRuntime({
    fetchWithTimeout: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/runtime_control_history')) {
        return new Response('[]', { status: 200 });
      }
      if (String(url).includes('/runtime_controls')) {
        const request = JSON.parse(options.body);
        assert.equal(request.revision, 6);
        assert.equal(options.headers['X-Runtime-Action'], 'lockdown');
        assert.ok(options.headers['X-Runtime-Reason-Hex']);
        return new Response(JSON.stringify([
          row(6, {
            maintenance_mode: true,
            analysis_enabled: false,
            search_enabled: false,
            live_enabled: false,
            reminders_enabled: false,
            expanded_data_enabled: false,
            auto_settlement_recovery_enabled: false,
            message: 'Аварийный режим безопасности активен. Изменения временно недоступны.',
          }),
        ]), { status: 200 });
      }
      throw new Error('unexpected request');
    },
  });

  const result = await api.saveRuntimeControls(
    { supabaseUrl: 'https://example.supabase.co' },
    { id: 123 },
    { expectedRevision: 5, action: 'lockdown', reason: 'incident' },
  );

  assert.equal(result.status, 200);
  assert.equal(result.historyReady, true);
  assert.equal(result.value.revision, 6);
  assert.equal(memory.runtimeControls.value.revision, 6);
  assert.equal(memory.runtimeControls.value.securityLockdown, undefined);
  assert.equal(inserts.filter(x => x.table === 'runtime_control_history').length, 1);
  assert.equal(calls.filter(x => x.url.includes('/runtime_controls')).length, 1);
});

test('P0 #484 save fails closed when history schema is unavailable', async () => {
  let mutationCalls = 0;
  const { api, memory } = buildRuntime({
    fetchWithTimeout: async (url) => {
      if (String(url).includes('/runtime_control_history')) {
        return new Response('unavailable', { status: 503 });
      }
      mutationCalls += 1;
      return new Response('[]', { status: 200 });
    },
  });

  const result = await api.saveRuntimeControls(
    { supabaseUrl: 'https://example.supabase.co' },
    { id: 123 },
    { expectedRevision: 5, maintenanceMode: true },
  );

  assert.equal(result.status, 503);
  assert.equal(result.code, 'RUNTIME_HISTORY_REQUIRED');
  assert.equal(mutationCalls, 0);
  assert.equal(memory.runtimeControls.value.revision, 5);
});

test('P0 #484 rollback loads the selected snapshot and delegates to atomic save', async () => {
  const calls = [];
  const selected = {
    id: 77,
    revision: 2,
    snapshot: {
      maintenanceMode: true,
      analysisEnabled: false,
      searchEnabled: true,
      liveEnabled: true,
      remindersEnabled: true,
      expandedDataEnabled: true,
      autoSettlementRecoveryEnabled: false,
      message: 'old state',
      revision: 2,
      updatedAt: '2026-10-01T10:00:00.000Z',
    },
  };
  const { api } = buildRuntime({
    historyRow: selected,
    fetchWithTimeout: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/runtime_control_history')) {
        return new Response('[]', { status: 200 });
      }
      if (String(url).includes('/runtime_controls')) {
        assert.equal(options.headers['X-Runtime-Action'], 'rollback');
        assert.equal(options.headers['X-Runtime-Source-Revision'], '2');
        const request = JSON.parse(options.body);
        assert.equal(request.revision, 6);
        assert.equal(request.maintenance_mode, true);
        assert.equal(request.analysis_enabled, false);
        assert.equal(request.message, 'old state');
        return new Response(JSON.stringify([
          row(6, {
            maintenance_mode: true,
            analysis_enabled: false,
            message: 'old state',
          }),
        ]), { status: 200 });
      }
      throw new Error('unexpected request');
    },
  });

  const result = await api.rollbackRuntimeControls(
    { supabaseUrl: 'https://example.supabase.co' },
    { id: 123 },
    { expectedRevision: 5, historyId: 77, reason: 'restore known good' },
  );

  assert.equal(result.status, 200);
  assert.equal(result.value.revision, 6);
  assert.equal(calls.filter(x => x.url.includes('/runtime_controls')).length, 1);
});
