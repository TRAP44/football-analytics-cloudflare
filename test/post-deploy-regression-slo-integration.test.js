import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const releaseApi=fs.readFileSync('src/release-monitor-api-runtime.js','utf8');
const releaseMonitor=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');

test('release monitor exposes regression SLO dashboard derived from ops history',()=>{
  assert.match(releaseApi,/const activeDeploySha=String\(currentReleaseIdentity\(cfg\)\?\.deploySha \|\| ''\)\.toLowerCase\(\)/);
  assert.match(releaseApi,/const postDeployRegressionSlo=buildPostDeployRegressionSloDashboard\(source\.items,/);
  assert.match(releaseApi,/postDeployRegression:\{/);
  assert.match(releaseApi,/slo:postDeployRegressionSlo/);
});

test('admin regression panel shows existing ACK and recovery SLO thresholds',()=>{
  const start=releaseMonitor.indexOf('const regressionData =');
  const end=releaseMonitor.indexOf('const codes = c.topCodes || [];',start);
  assert.ok(start>=0 && end>start);
  const block=releaseMonitor.slice(start,end);
  assert.match(block,/ACK latency/);
  assert.match(block,/Investigation latency/);
  assert.match(block,/Recovery latency/);
  assert.match(block,/Resolution latency/);
  assert.match(block,/ackCriticalMinutes/);
  assert.match(block,/recoveryMinutes/);
  assert.match(block,/метрика без отдельного SLA/);
});

test('SLO visualization does not add automatic remediation actions',()=>{
  const start=releaseMonitor.indexOf('const regressionData =');
  const end=releaseMonitor.indexOf('const codes = c.topCodes || [];',start);
  const block=releaseMonitor.slice(start,end);
  assert.doesNotMatch(block,/rollbackTo|switchProvider|disableFeature|runtimeControlsSaving/);
  assert.doesNotMatch(block,/investigationTargetMinutes\s*:\s*[1-9]/);
  assert.doesNotMatch(block,/resolutionTargetMinutes\s*:\s*[1-9]/);
});
