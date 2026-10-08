import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync('src/runtime-controls.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/supabase_migration_v6_29.sql', 'utf8');

function saveSection() {
  const start = runtime.indexOf('async function saveRuntimeControls');
  const end = runtime.indexOf('function runtimeFeatureResponse', start);
  assert.ok(start >= 0 && end > start, 'saveRuntimeControls section must exist');
  return runtime.slice(start, end);
}

test('runtime-control mutation fails closed when history is unavailable', () => {
  const save = saveSection();
  assert.match(save, /RUNTIME_HISTORY_REQUIRED/);
  assert.match(save, /RUNTIME_HISTORY_BASELINE_WRITE_FAILED/);
  assert.match(save, /status:\s*503/);
  assert.match(save, /await ensureRuntimeHistoryBaseline\(cfg\s*,\s*current\s*,\s*user\)/);
});

test('runtime-control UPDATE carries bounded audit metadata and no longer appends history after commit', () => {
  const save = saveSection();
  assert.match(save, /X-Runtime-Action/);
  assert.match(save, /X-Runtime-Reason-Hex/);
  assert.match(save, /X-Runtime-App-Version/);
  assert.match(save, /X-Runtime-Source-Revision/);
  assert.match(save, /TextEncoder/);
  assert.match(save, /RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED/);
  assert.doesNotMatch(save, /await appendRuntimeHistory\(/);

  const patchIndex = save.search(/method\s*:\s*'PATCH'/);
  const memoryIndex = save.search(/memory\.runtimeControls\s*=/);
  assert.ok(patchIndex >= 0 && memoryIndex > patchIndex, 'memory may update only after the database transaction succeeds');
});

test('v6.29 database rule inserts the new immutable revision in the UPDATE transaction', () => {
  assert.match(migration, /create rule runtime_controls_atomic_history/i);
  assert.match(migration, /on update to public\.runtime_controls/i);
  assert.match(migration, /old\.revision is distinct from new\.revision/i);
  assert.match(migration, /insert into public\.runtime_control_history/i);
  assert.match(migration, /new\.revision/);
  assert.match(migration, /jsonb_build_object\(/);
  assert.doesNotMatch(migration, /on conflict/i);
});

test('v6.29 preserves the public function contract while enforcing rollback on history failure', () => {
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+public\./i);
  assert.doesNotMatch(migration, /alter table public\.runtime_controls\s+add/i);
  assert.match(migration, /drop rule if exists runtime_controls_atomic_history/i);
});

test('atomic history snapshots capture every runtime feature flag and the matching revision',()=>{
  const expected=[
    "'maintenanceMode', new.maintenance_mode",
    "'analysisEnabled', new.analysis_enabled",
    "'searchEnabled', new.search_enabled",
    "'liveEnabled', new.live_enabled",
    "'remindersEnabled', new.reminders_enabled",
    "'expandedDataEnabled', new.expanded_data_enabled",
    "'autoSettlementRecoveryEnabled', new.auto_settlement_recovery_enabled",
    "'revision', new.revision",
    "'updatedAt', new.updated_at",
  ];
  for(const marker of expected)assert.ok(migration.includes(marker),marker);
  assert.match(migration,/old\.revision is distinct from new\.revision/i);
  assert.match(migration,/new\.updated_by/);
  assert.match(migration,/case[\s\S]*when[\s\S]*source-revision/i);
});

test('runtime controls require history availability before database mutation',()=>{
  const save=saveSection();
  const probe=save.indexOf('await probeRuntimeHistorySchema(cfg)');
  const baseline=save.indexOf('await ensureRuntimeHistoryBaseline(cfg,current,user)');
  const patch=save.search(/method\s*:\s*'PATCH'/);
  assert.ok(probe>=0&&baseline>probe&&patch>baseline);
  assert.match(save,/if \(!historySchema\.ok\)/);
  assert.match(save,/RUNTIME_HISTORY_REQUIRED/);
  assert.match(save,/RUNTIME_HISTORY_BASELINE_WRITE_FAILED/);
});
