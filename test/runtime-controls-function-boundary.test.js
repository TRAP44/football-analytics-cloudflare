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
  assert.match(rollback, /supaSelectOne\(cfg\s*,\s*'runtime_control_history'/);
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

  assert.match(save, /const currentState\s*=\s*await loadRuntimeControls\(cfg\s*,\s*\{\s*force\s*:\s*true\s*\}\)/);
  assert.match(save, /const current\s*=\s*currentState\.value/);
  assert.match(save, /const expectedRevision=positiveRevision\(source\.expectedRevision,0\)/);
  assert.match(save, /RUNTIME_CONTROLS_CONFLICT/);
  assert.match(save, /RUNTIME_HISTORY_REQUIRED/);
  assert.match(save, /await ensureRuntimeHistoryBaseline\(cfg\s*,\s*current\s*,\s*user\)/);
  assert.match(save, /X-Runtime-Action/);
  assert.match(save, /X-Runtime-Reason-Hex/);
  assert.match(save, /method:\s*'PATCH'/);
  assert.match(save, /RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED/);
  assert.doesNotMatch(save, /await appendRuntimeHistory\(/);
});

test('Issue #484 API mutation and rollback routes call the restored functions', () => {
  const api = section('async function apiRuntimeControls', 'return Object.freeze({\n    runtimeControlsSnapshot');
  assert.match(api, /const result\s*=\s*await saveRuntimeControls\(cfg\s*,\s*user\s*,\s*body\)/);
  assert.match(api, /const result\s*=\s*await rollbackRuntimeControls\(cfg\s*,\s*user\s*,\s*body\)/);
});

test('rollback validates immutable history identity before trusted save',()=>{
  const rollback=section('async function rollbackRuntimeControls','async function saveRuntimeControls');
  const probe=rollback.indexOf('await probeRuntimeHistorySchema(cfg)');
  const identity=rollback.indexOf('positiveId(row.id) !== historyId');
  const inspection=rollback.indexOf('inspectRuntimeControls(row.snapshot,defaults,{requireComplete:true})');
  const save=rollback.indexOf('return await saveRuntimeControls(cfg,user,');
  assert.ok(probe>=0 && identity>probe && inspection>identity && save>inspection);
  assert.match(rollback,/targetInspection\.value\.revision !== rowRevision/);
  assert.match(rollback,/sourceRevision:rowRevision/);
  assert.match(rollback,/\},\{trustedRollback:true\}\)/);
  assert.doesNotMatch(rollback,/method:\s*'PATCH'/);
});
