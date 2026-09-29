import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('release monitor exposes regression SLO dashboard derived from ops history',()=>{
  const start=worker.indexOf('async function apiReleaseMonitor');
  const end=worker.indexOf('async function apiDiagnostics',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/buildPostDeployRegressionSloDashboard/);
  assert.match(block,/activeDeploySha/);
  assert.match(block,/postDeployRegressionSlo/);
  assert.match(block,/slo:postDeployRegressionSlo/);
});

test('admin regression panel shows existing ACK and recovery SLO thresholds',()=>{
  const start=app.indexOf('const regressionData =');
  const end=app.indexOf('const codes = c.topCodes || [];',start);
  assert.ok(start>=0 && end>start);
  const block=app.slice(start,end);
  assert.match(block,/ACK latency/);
  assert.match(block,/Investigation latency/);
  assert.match(block,/Recovery latency/);
  assert.match(block,/Resolution latency/);
  assert.match(block,/ackCriticalMinutes/);
  assert.match(block,/recoveryMinutes/);
  assert.match(block,/метрика без отдельного SLA/);
});

test('SLO visualization does not add automatic remediation actions',()=>{
  const start=app.indexOf('const regressionData =');
  const end=app.indexOf('const codes = c.topCodes || [];',start);
  const block=app.slice(start,end);
  assert.doesNotMatch(block,/rollbackTo|switchProvider|disableFeature|runtimeControlsSaving/);
  assert.doesNotMatch(block,/investigationTargetMinutes\s*:\s*[1-9]/);
  assert.doesNotMatch(block,/resolutionTargetMinutes\s*:\s*[1-9]/);
});
