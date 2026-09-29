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
