import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');

test('production monitor exposes non-blocking 15/30/60 post-deploy regression windows',()=>{
  const start=worker.indexOf('async function runProductionMonitor');
  const end=worker.indexOf('async function apiProductionMonitor',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);

  assert.match(block,/postDeployRegressionReport\(/);
  assert.match(block,/windowsMinutes:\[15,30,60\]/);
  assert.match(block,/regression:\{[\s\S]*\.\.\.releaseRegression[\s\S]*lifecycle:/);
  assert.match(block,/postDeployRegressionState/);
  assert.match(block,/postDeployRegressionCompletedWindows/);
  assert.doesNotMatch(block,/productionMonitorState\(\{[\s\S]{0,700}releaseRegression/);
});

test('post-deploy regression uses historical ops source rather than only current-deploy events',()=>{
  const start=worker.indexOf('const releaseRegression=postDeployRegressionReport');
  assert.ok(start>=0);
  const close=worker.indexOf(');',start);
  assert.ok(close>start);
  const call=worker.slice(start,close+2);
  assert.match(call,/releaseMetricItems/);
  assert.doesNotMatch(call,/releaseItems/);
});


test('regression lifecycle is persisted without feeding its own events back into release metrics',()=>{
  const start=worker.indexOf('async function runProductionMonitor');
  const end=worker.indexOf('async function apiProductionMonitor',start);
  const block=worker.slice(start,end);
  assert.match(block,/item\?\.source !== 'release_regression'/);
  assert.match(block,/planPostDeployRegressionLifecycle\(releaseRegression,source\.items\)/);
  assert.match(block,/releaseRegressionLifecycle\.action === 'record'/);
  assert.match(block,/recordOpsEvent\(cfg,releaseRegressionLifecycle\)/);
  assert.match(block,/postDeployRegressionLifecycleAction/);
});


test('regression lifecycle persistence uses an atomic transition key and remains fail-soft',()=>{
  const start=worker.indexOf('async function recordOpsEventTask');
  const end=worker.indexOf('async function cleanupRateWindows',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);

  assert.match(block,/transition_key: event\.transitionKey/);
  assert.match(block,/on_conflict', 'transition_key'/);
  assert.match(block,/resolution=ignore-duplicates,return=minimal/);
  assert.match(block,/_persistenceStatus/);
  assert.match(block,/setPersistenceStatus\('failed'\)/);
});

test('production monitor exposes lifecycle persistence failure without failing the monitor',()=>{
  const start=worker.indexOf('async function runProductionMonitor');
  const end=worker.indexOf('async function apiProductionMonitor',start);
  const block=worker.slice(start,end);

  assert.match(block,/postDeployRegressionLifecyclePersistence/);
  assert.match(block,/value\.release\.regression\.lifecycle\.persistence/);
  assert.match(block,/POST_DEPLOY_REGRESSION_LIFECYCLE_PERSISTENCE_FAILED/);
  assert.doesNotMatch(block,/throw new Error\(['"]POST_DEPLOY_REGRESSION_LIFECYCLE_PERSISTENCE_FAILED/);
});


test('post-deploy regression alerting reuses persistent operational delivery and cannot feed its own metrics',()=>{
  const start=worker.indexOf('async function runProductionMonitor');
  const end=worker.indexOf('async function apiProductionMonitor',start);
  const block=worker.slice(start,end);

  assert.match(block,/item\?\.source !== 'release_regression_alert'/);
  assert.match(block,/planPostDeployRegressionAlert\(source\.items,providerAlertLedger\.items/);
  assert.match(block,/deliverOperationalIncidentAlert\(\{/);
  assert.match(block,/formatPostDeployRegressionAlert\(releaseRegressionAlertPlan\)/);
  assert.match(block,/postDeployRegressionAlertOpsEvents\(releaseRegressionAlertPlan,delivery\)/);
  assert.match(block,/claimProviderIncidentAlertDelivery\(cfg,input\)/);
  assert.match(block,/finalizeProviderIncidentAlertDelivery\(cfg,input\)/);
});

test('WATCH is not sent and alert delivery waits for lifecycle persistence in the same monitor run',()=>{
  const start=worker.indexOf('async function runProductionMonitor');
  const end=worker.indexOf('async function apiProductionMonitor',start);
  const block=worker.slice(start,end);

  assert.match(block,/releaseRegressionLifecycleReady/);
  assert.match(block,/releaseRegressionLifecyclePersistence === 'persistent'/);
  assert.match(block,/lifecycle_persistence_unconfirmed/);
  assert.match(block,/releaseRegressionAlertPlan\.action === 'send'/);
  assert.match(block,/alerting:\{/);
  assert.doesNotMatch(block,/autoRollback:\s*true/);
});
