import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRuntimeControlsRuntime } from '../src/runtime-controls.js';
import { failClosedRuntimeControls } from '../src/runtime-lockdown.js';

const DEFAULTS = Object.freeze({
  maintenanceMode: false,
  analysisEnabled: true,
  searchEnabled: true,
  liveEnabled: true,
  remindersEnabled: true,
  expandedDataEnabled: true,
  autoSettlementRecoveryEnabled: false,
  aiEnabled: true,
  message: '',
  revision: 1,
  updatedAt: null,
});
const cfg = { supabaseUrl: 'https://example.supabase.co' };

function baseRow(extra = {}) {
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
    revision: 5,
    updated_at: '2026-10-12T10:00:00.000Z',
    ...extra,
  };
}

function harness(row) {
  const memory = { runtimeControls: null };
  const patches = [];
  const api = createRuntimeControlsRuntime({
    memory,
    DEFAULT_RUNTIME_CONTROLS: DEFAULTS,
    RUNTIME_CONTROLS_CACHE_MS: 30_000,
    SUPABASE_SCHEMA_GUIDANCE: 'schema guidance',
    APP_VERSION: 'test',
    hasSupabase: () => true,
    supaSelectOne: async () => row,
    supaInsertIgnore: async () => null,
    supaSelectMany: async () => [],
    fetchWithTimeout: async (url, init = {}) => {
      if (init.method === 'POST') {
        if(!Object.hasOwn(row,'ai_enabled'))return new Response('',{status:404});
        const args=JSON.parse(init.body);
        const body={...args.p_controls,revision:args.p_expected_revision+1,updated_by:args.p_actor_id};
        patches.push(body);
        return new Response(JSON.stringify([{ ...row, ...body }]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    },
    supaHeaders: () => ({}),
    recordOpsEvent: async () => {},
    redactOpsString: value => String(value || ''),
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    isAdminUser: () => true,
    clock: () => Date.parse('2026-10-12T12:00:00.000Z'),
  });
  return { api, memory, patches };
}

const update = (extra = {}) => ({
  expectedRevision: 5,
  maintenanceMode: false,
  analysisEnabled: true,
  searchEnabled: true,
  liveEnabled: true,
  remindersEnabled: true,
  expandedDataEnabled: true,
  autoSettlementRecoveryEnabled: false,
  message: '',
  action: 'update',
  ...extra,
});

test('a row without ai_enabled (before v6.29.15) stays valid and means AI is on', async () => {
  const { api, memory } = harness(baseRow());
  const state = await api.loadRuntimeControls(cfg, { force: true });
  assert.equal(state.failClosed, false);
  assert.equal(state.value.aiEnabled, true);
  assert.equal(memory.runtimeControls.aiColumnReady, false);
});

test('a malformed ai_enabled value fails the control plane closed', async () => {
  const { api } = harness(baseRow({ ai_enabled: 'false' }));
  const state = await api.loadRuntimeControls(cfg, { force: true });
  assert.equal(state.failClosed, true);
  assert.equal(state.value.analysisEnabled, false);
  assert.equal(failClosedRuntimeControls({}).aiEnabled, false);
});

test('a pre-migration database cannot save through the missing RPC or bypass it with PATCH', async () => {
  const { api, patches } = harness(baseRow());
  const saved = await api.saveRuntimeControls(cfg, { id: 1 }, update({ searchEnabled: false, aiEnabled: true }));
  assert.equal(saved.code, 'RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED');
  assert.equal(patches.length,0);
  const { api: api2 } = harness(baseRow());
  const refused = await api2.saveRuntimeControls(cfg, { id: 1 }, update({ aiEnabled: false }));
  assert.equal(refused.code, 'RUNTIME_CONTROLS_AI_SCHEMA');
});

test('after the migration the AI switch is saved and confirmed by the database', async () => {
  const { api, patches, memory } = harness(baseRow({ ai_enabled: true }));
  const saved = await api.saveRuntimeControls(cfg, { id: 1 }, update({ aiEnabled: false }));
  assert.equal(saved.status, 200);
  assert.equal(patches[0].ai_enabled, false);
  assert.equal(saved.value.aiEnabled, false);
  assert.equal(memory.runtimeControls.aiColumnReady, true);
});

test('an old panel without aiEnabled keeps the current value; a wrong type is rejected', async () => {
  const { api, patches } = harness(baseRow({ ai_enabled: false }));
  const saved = await api.saveRuntimeControls(cfg, { id: 1 }, update());
  assert.equal(saved.status, 200);
  assert.equal(patches[0].ai_enabled, false, 'AI stays off');

  const { api: api2 } = harness(baseRow({ ai_enabled: true }));
  const bad = await api2.saveRuntimeControls(cfg, { id: 1 }, update({ aiEnabled: 'false' }));
  assert.equal(bad.code, 'RUNTIME_CONTROLS_INPUT');
});

test('security lockdown turns AI off and its release turns it back on', async () => {
  const { api, patches } = harness(baseRow({ ai_enabled: true }));
  await api.saveRuntimeControls(cfg, { id: 1 }, { expectedRevision: 5, action: 'lockdown' });
  assert.equal(patches[0].ai_enabled, false);

  const locked = baseRow({ ai_enabled: false, maintenance_mode: true, analysis_enabled: false, search_enabled: false, live_enabled: false, reminders_enabled: false, expanded_data_enabled: false });
  const { api: api2, patches: patches2 } = harness(locked);
  await api2.saveRuntimeControls(cfg, { id: 1 }, { expectedRevision: 5, action: 'lockdown_release' });
  assert.equal(patches2[0].ai_enabled, true);
});

test('history snapshots carry aiEnabled so a rollback restores it', () => {
  const { api } = harness(baseRow());
  assert.equal(api.runtimeHistorySnapshot({ ...DEFAULTS, aiEnabled: false }).aiEnabled, false);
  // Старые точки журнала без поля — AI включён.
  assert.equal(api.normalizeRuntimeControls({ ...baseRow() }).aiEnabled, true);
});

test('Workers AI calls respect the switch; presets and the plain explanation keep working', () => {
  const explanation = fs.readFileSync('src/match-explanation-runtime.js', 'utf8');
  assert.match(explanation, /if \(aiEnabled === false\) return \{ ids: null, reason: 'ai_disabled' \};/);
  assert.match(explanation, /aiEnabled = runtime\.aiEnabled !== false;/);
  assert.match(explanation, /aiSelection\(cfg, facts, userId, \{ aiEnabled \}\)/);
  // Кеш прежних ответов AI при выключенном AI не используется.
  assert.ok(explanation.indexOf("if (!aiEnabled) reason = 'ai_disabled';") < explanation.indexOf('await getCache(selectionKey, cfg)'));
  assert.match(explanation, /if \(!ids && aiEnabled\) \{/);
  const question = fs.readFileSync('src/match-question-runtime.js', 'utf8');
  const gate = question.indexOf("if (!aiEnabled) return json({ available: false, reason: 'ai_disabled' });");
  assert.ok(gate > question.indexOf('if (preset) {'), 'presets are answered before the AI gate');
  assert.ok(gate < question.indexOf('await getCache(cacheKey, cfg)'), 'cached AI answers are not served when AI is off');
  assert.ok(gate < question.indexOf('await aiAnswer('), 'no Workers AI call when AI is off');
  const ui = fs.readFileSync('public/modules/match-questions.js', 'utf8');
  assert.match(ui, /ai_disabled: 'AI-ассистент временно недоступен\.'/);
});

test('admin panel has the AI toggle wired into every payload', () => {
  const html = fs.readFileSync('public/admin.html', 'utf8');
  assert.match(html, /<input id="runtimeAiToggle" type="checkbox" checked>/);
  const admin = fs.readFileSync('public/modules/admin-runtime-controls.js', 'utf8');
  assert.match(admin, /\['runtimeAiToggle', 'aiEnabled'\]/);
  assert.match(admin, /aiEnabled: runtimeControlsFormValue\('runtimeAiToggle', true\)/);
  assert.equal(admin.match(/aiEnabled: (true|false),/g)?.length, 3, 'lockdown, release and defaults set it explicitly');
});

test('migration v6.29.15 adds the column, keeps the legacy fingerprint frozen and records aiEnabled in history', () => {
  const sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_29_15.sql', 'utf8');
  assert.match(sql, /alter table public\.runtime_controls\s+add column if not exists ai_enabled boolean not null default true;/);
  assert.match(sql, /or \(c\.table_name = 'runtime_controls' and c\.column_name = 'ai_enabled'\)/);
  assert.match(sql, /'aiEnabled', new\.ai_enabled,/);
  assert.match(sql, /create or replace rule runtime_controls_atomic_history as\non update to public\.runtime_controls\nwhere old\.revision is distinct from new\.revision/);
  // Определение Security Lockdown в журнале не меняется.
  assert.doesNotMatch(sql, /and not new\.ai_enabled/);
  const contract = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));
  assert.equal(contract.databaseContract.runtimeAiSwitch.column, 'runtime_controls.ai_enabled');
  assert.equal(contract.databaseContract.legacyFingerprint, '2557059895624917aebf24eec0e97cab');
});
