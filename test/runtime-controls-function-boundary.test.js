import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync('src/runtime-controls.js', 'utf8');

function section(startMarker, endMarker) {
  const start = runtime.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  const end = runtime.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return runtime.slice(start, end);
}

test('Issue #484 keeps rollback and save as distinct runtime-control functions', () => {
  assert.equal((runtime.match(/async function rollbackRuntimeControls/g) || []).length, 1);
  assert.equal((runtime.match(/async function saveRuntimeControls/g) || []).length, 1);

  const rollback = section(
    'async function rollbackRuntimeControls',
    'async function saveRuntimeControls',
  );
  assert.match(rollback, /historyId/);
  assert.match(rollback, /supaSelectOne\(cfg, 'runtime_control_history'/);
  assert.match(rollback, /action:\s*'rollback'/);
  assert.match(rollback, /return await saveRuntimeControls\(/);
  assert.doesNotMatch(rollback, /X-Runtime-Action/);
  assert.doesNotMatch(rollback, /method:\s*'PATCH'/);
});

test('Issue #484 save owns current-state CAS and atomic-history mutation', () => {
  const save = section(
    'async function saveRuntimeControls',
    'function runtimeFeatureResponse',
  );

  assert.match(save, /const currentState = await loadRuntimeControls\(cfg, \{ force: true \}\)/);
  assert.match(save, /const current = currentState\.value/);
  assert.match(save, /const expectedRevision = Number\(body\.expectedRevision \|\| 0\)/);
  assert.match(save, /RUNTIME_CONTROLS_CONFLICT/);
  assert.match(save, /RUNTIME_HISTORY_REQUIRED/);
  assert.match(save, /await ensureRuntimeHistoryBaseline\(cfg, current, user\)/);
  assert.match(save, /X-Runtime-Action/);
  assert.match(save, /X-Runtime-Reason-Hex/);
  assert.match(save, /method:\s*'PATCH'/);
  assert.match(save, /RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED/);
  assert.doesNotMatch(save, /await appendRuntimeHistory\(/);
});

test('Issue #484 API mutation and rollback routes call the restored functions', () => {
  const api = section('async function apiRuntimeControls', 'return {\n    runtimeControlsSnapshot');
  assert.match(api, /const result = await saveRuntimeControls\(cfg, user, body\)/);
  assert.match(api, /const result = await rollbackRuntimeControls\(cfg, user, body\)/);
});
