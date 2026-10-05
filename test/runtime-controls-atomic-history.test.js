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
  assert.match(save, /await ensureRuntimeHistoryBaseline\(cfg, current, user\)/);
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

  const patchIndex = save.indexOf("method: 'PATCH'");
  const memoryIndex = save.indexOf('memory.runtimeControls =');
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
