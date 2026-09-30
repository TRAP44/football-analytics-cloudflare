import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8') + '\n' + fs.readFileSync('public/modules/admin-runtime-controls.js', 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

test('runtime history failures are surfaced instead of being rendered as an empty audit trail', () => {
  const runtimeApi = section(worker, 'async function apiRuntimeControls', 'function publicDataCapabilities');
  assert.match(runtimeApi, /RUNTIME_HISTORY_READ_FAILED/);
  assert.match(runtimeApi, /RUNTIME_HISTORY_POST_WRITE_READ_FAILED/);
  assert.match(runtimeApi, /historyReady = false/);
  assert.match(runtimeApi, /historyReason/);
  assert.doesNotMatch(runtimeApi, /listRuntimeHistory\(cfg, 12\)\.catch\(\(\) => \[\]\)/);

  const saveRuntime = section(worker, 'async function saveRuntimeControls', 'function runtimeFeatureResponse');
  assert.match(saveRuntime, /RUNTIME_HISTORY_BASELINE_WRITE_FAILED/);
  assert.match(saveRuntime, /RUNTIME_HISTORY_APPEND_FAILED/);
  assert.match(saveRuntime, /return \{ value, status: 200, historyReady, historyReason \}/);

  const rollback = section(worker, 'async function apiRuntimeRollback', 'function publicDataCapabilities');
  assert.match(rollback, /RUNTIME_HISTORY_ROLLBACK_READ_FAILED/);
  assert.doesNotMatch(rollback, /historyReady:\s*true/);

  assert.match(app, /historyReady: Boolean\(result\.historyReady\),\s*historyReason: String\(result\.historyReason \|\| ''\)/);
  const rollbackClient = section(app, 'async function restoreRuntimeRevision', 'function renderRuntimeControls');
  assert.doesNotMatch(rollbackClient, /historyReady:\s*true/);
});

test('billing subscription mutation rejects malformed or missing actions instead of defaulting to cancel', () => {
  const billing = section(worker, 'async function apiBillingSubscription', 'const {\n  getCacheEntry');
  assert.match(billing, /BILLING_INVALID_JSON/);
  assert.match(billing, /BILLING_INVALID_ACTION/);
  assert.match(billing, /\['cancel', 'resume'\]\.includes\(action\)/);
  assert.doesNotMatch(billing, /body\.action === 'resume' \? 'resume' : 'cancel'/);
  assert.match(billing, /is_canceled: action === 'cancel'/);
});
