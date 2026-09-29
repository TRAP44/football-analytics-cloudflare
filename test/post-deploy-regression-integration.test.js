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
  assert.match(block,/regression:releaseRegression/);
  assert.match(block,/postDeployRegressionState/);
  assert.match(block,/postDeployRegressionCompletedWindows/);
  assert.doesNotMatch(block,/productionMonitorState\(\{[\s\S]{0,700}releaseRegression/);
});

test('post-deploy regression uses historical ops source rather than only current-deploy events',()=>{
  const start=worker.indexOf('const releaseRegression=postDeployRegressionReport');
  const block=worker.slice(start,start+500);
  assert.match(block,/source\.items\.filter/);
  assert.doesNotMatch(block,/releaseItems/);
});
