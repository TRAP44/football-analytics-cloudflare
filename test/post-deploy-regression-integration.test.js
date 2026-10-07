import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const productionMonitor=fs.readFileSync('src/production-monitor-runtime.js','utf8');
const telemetryOps=fs.readFileSync('src/telemetry-ops-runtime.js','utf8');

test('production monitor exposes non-blocking 15/30/60 post-deploy regression windows',()=>{
  assert.match(productionMonitor,/const releaseRegression=postDeployRegressionReport\(/);
  assert.match(productionMonitor,/windowsMinutes:\[15,30,60\]/);
  assert.match(productionMonitor,/regression:\{[\s\S]*\.\.\.releaseRegression[\s\S]*lifecycle:/);
  assert.match(productionMonitor,/postDeployRegressionState:String\(releaseRegression\.state/);
  assert.match(productionMonitor,/postDeployRegressionCompletedWindows:Number\(releaseRegression\.completedWindows/);
  assert.match(productionMonitor,/autoRollback: false/);
});

test('post-deploy regression uses historical ops source rather than only current-deploy events',()=>{
  const start=productionMonitor.indexOf('const releaseRegression=postDeployRegressionReport');
  assert.ok(start>=0);
  const close=productionMonitor.indexOf(');',start);
  assert.ok(close>start);
  const call=productionMonitor.slice(start,close+2);
  assert.match(call,/releaseMetricItems/);
  assert.doesNotMatch(call,/releaseItems/);
});


test('regression lifecycle is persisted without feeding its own events back into release metrics',()=>{
  const start=productionMonitor.indexOf('async function runProductionMonitor');
  const end=productionMonitor.indexOf('  return Object.freeze({',start);
  const block=productionMonitor.slice(start,end);
  assert.match(block,/item\?\.source !== 'release_regression'/);
  assert.match(block,/planPostDeployRegressionLifecycle\(releaseRegression,source\.items\)/);
  assert.match(block,/releaseRegressionLifecycle\.action === 'record'/);
  assert.match(block,/recordOpsEvent\(cfg,releaseRegressionLifecycle\)/);
  assert.match(block,/postDeployRegressionLifecycleAction/);
});


test('regression lifecycle persistence uses an atomic transition key and remains fail-soft',()=>{
  assert.match(telemetryOps,/const transitionText=redactOpsString\(safeRead\(source,'transitionKey'\),220\)/);
  assert.match(telemetryOps,/transition_key:transitionText \|\| null/);
  assert.match(telemetryOps,/record_ops_event_occurrence/);
  assert.match(telemetryOps,/url\.searchParams\.set\('on_conflict','transition_key'\)/);
  assert.match(telemetryOps,/persistenceStatus\(row,'persistent'\)/);
  assert.match(telemetryOps,/persistenceStatus\(row,'failed'\)/);
});

test('production monitor exposes lifecycle persistence failure without failing the monitor',()=>{
  const start=productionMonitor.indexOf('async function runProductionMonitor');
  const end=productionMonitor.indexOf('  return Object.freeze({',start);
  const block=productionMonitor.slice(start,end);

  assert.match(block,/postDeployRegressionLifecyclePersistence/);
  assert.match(block,/value\.release\.regression\.lifecycle\.persistence/);
  assert.match(block,/POST_DEPLOY_REGRESSION_LIFECYCLE_PERSISTENCE_FAILED/);
  assert.doesNotMatch(block,/throw new Error\(['"]POST_DEPLOY_REGRESSION_LIFECYCLE_PERSISTENCE_FAILED/);
});


test('post-deploy regression alerting reuses persistent operational delivery and cannot feed its own metrics',()=>{
  const start=productionMonitor.indexOf('async function runProductionMonitor');
  const end=productionMonitor.indexOf('  return Object.freeze({',start);
  const block=productionMonitor.slice(start,end);

  assert.match(block,/item\?\.source !== 'release_regression_alert'/);
  assert.match(block,/planPostDeployRegressionAlert\(source\.items,providerAlertLedger\.items/);
  assert.match(block,/deliverOperationalIncidentAlert\(\{/);
  assert.match(block,/formatPostDeployRegressionAlert\(releaseRegressionAlertPlan\)/);
  assert.match(block,/postDeployRegressionAlertOpsEvents\(releaseRegressionAlertPlan,delivery\)/);
  assert.match(block,/claimProviderIncidentAlertDelivery\(cfg,input\)/);
  assert.match(block,/finalizeProviderIncidentAlertDelivery\(cfg,input\)/);
});

test('WATCH is not sent and alert delivery waits for lifecycle persistence in the same monitor run',()=>{
  const start=productionMonitor.indexOf('async function runProductionMonitor');
  const end=productionMonitor.indexOf('  return Object.freeze({',start);
  const block=productionMonitor.slice(start,end);

  assert.match(block,/releaseRegressionLifecycleReady/);
  assert.match(block,/releaseRegressionLifecyclePersistence === 'persistent'/);
  assert.match(block,/lifecycle_persistence_unconfirmed/);
  assert.match(block,/releaseRegressionAlertPlan\.action === 'send'/);
  assert.match(block,/alerting:\{/);
  assert.doesNotMatch(block,/autoRollback:\s*true/);
});
