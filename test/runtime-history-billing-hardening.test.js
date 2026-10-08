import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const billingApi = fs.readFileSync('src/billing-api-runtime.js', 'utf8');
const runtimeControls = fs.readFileSync('src/runtime-controls.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8') + '\n' + fs.readFileSync('public/modules/admin-runtime-controls.js', 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

test('runtime history failures are surfaced instead of being rendered as an empty audit trail', () => {
  const runtimeApi = section(runtimeControls, 'async function apiRuntimeControls', 'async function apiRuntimeRollback');
  assert.match(runtimeApi, /RUNTIME_HISTORY_READ_FAILED/);
  assert.match(runtimeApi, /RUNTIME_HISTORY_POST_WRITE_READ_FAILED/);
  assert.match(runtimeApi, /historyReady\s*=\s*false/);
  assert.match(runtimeApi, /historyReason/);
  assert.doesNotMatch(runtimeApi, /listRuntimeHistory\(cfg, 12\)\.catch\(\(\) => \[\]\)/);

  const saveRuntime = section(runtimeControls, 'async function saveRuntimeControls', 'function runtimeFeatureResponse');
  assert.match(saveRuntime, /RUNTIME_HISTORY_REQUIRED/);
  assert.match(saveRuntime, /RUNTIME_HISTORY_BASELINE_WRITE_FAILED/);
  assert.match(saveRuntime, /RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED/);
  assert.match(saveRuntime, /X-Runtime-Action/);
  assert.match(saveRuntime, /X-Runtime-Reason-Hex/);
  assert.match(saveRuntime, /const historyReady = true/);
  assert.doesNotMatch(saveRuntime, /RUNTIME_HISTORY_APPEND_FAILED/);
  assert.doesNotMatch(saveRuntime, /await appendRuntimeHistory\(/);
  assert.match(saveRuntime, /return \{ value, status: 200, historyReady, historyReason \}/);

  const rollback = section(runtimeControls, 'async function apiRuntimeRollback', 'return {\n    runtimeControlsSnapshot');
  assert.match(rollback, /RUNTIME_HISTORY_ROLLBACK_READ_FAILED/);
  assert.doesNotMatch(rollback, /historyReady:\s*true/);

  assert.match(app, /historyReady: Boolean\(result\.historyReady\),\s*historyReason: String\(result\.historyReason \|\| ''\)/);
  const rollbackClient = section(app, 'async function restoreRuntimeRevision', 'function renderRuntimeControls');
  assert.doesNotMatch(rollbackClient, /historyReady:\s*true/);
});

test('billing subscription mutation rejects malformed or missing actions instead of defaulting to cancel', () => {
  const billing = section(billingApi, 'async function apiBillingSubscription', 'async function apiBillingRefundLookup');
  assert.match(billing, /BILLING_INVALID_JSON/);
  assert.match(billing, /BILLING_INVALID_ACTION/);
  assert.match(billing, /\['cancel', 'resume'\]\.includes\(action\)/);
  assert.doesNotMatch(billing, /body\.action === 'resume' \? 'resume' : 'cancel'/);
  assert.match(billing, /is_canceled: action === 'cancel'/);
  assert.match(worker,/createBillingApiRuntime\(\{/);
});

test('billing rejects invalid actions before looking up charges or mutating Telegram',()=>{
  const subscription=section(billingApi,'async function apiBillingSubscription','async function apiBillingRefundLookup');
  const decode=subscription.indexOf('await request.json()');
  const invalidJson=subscription.indexOf('BILLING_INVALID_JSON');
  const invalidAction=subscription.indexOf('BILLING_INVALID_ACTION');
  const lookup=subscription.indexOf('await getUserRecord(user.id, cfg)');
  const telegram=subscription.indexOf("telegramApi('editUserStarSubscription'");
  assert.ok(decode>=0 && invalidJson>decode && invalidAction>invalidJson);
  assert.ok(lookup>invalidAction && telegram>lookup);
  assert.match(subscription,/userId === null/);
  assert.match(subscription,/is_canceled: action === 'cancel'/);
});
