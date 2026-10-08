import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const monitor=fs.readFileSync('src/production-monitor-runtime.js','utf8');
const providerSlo=fs.readFileSync('src/provider-slo-runtime.js','utf8');

test('production monitor scopes release health to the active deploy SHA',()=>{
  const start=monitor.indexOf('async function runProductionMonitor');
  const end=monitor.indexOf('  return {',start);
  assert.ok(start>=0 && end>start);
  const block=monitor.slice(start,end);

  assert.match(block,/activeReleaseIdentity=currentReleaseIdentity\(cfg\)/);
  assert.match(block,/scopeOpsEventsToDeployment\(/);
  assert.match(block,/const releaseItems=releaseScope\.actionable/);
  assert.match(block,/releaseExcludedPriorDeploymentEvents/);
  assert.match(block,/releaseUnattributedEvents/);
  assert.doesNotMatch(block,/metadata\?\.appVersion[^\n]+=== APP_VERSION/);
});

test('production monitor resets state comparison at deployment boundary',()=>{
  const start=monitor.indexOf('async function runProductionMonitor');
  const end=monitor.indexOf('  return {',start);
  const block=monitor.slice(start,end);
  assert.match(block,/const monitorScope=scopeOpsEventsToDeployment/);
  assert.match(block,/const previousMonitor = \[\.\.\.monitorScope\.actionable\]/);
});

test('direct provider SLO persistence carries deployment identity',()=>{
  const start=providerSlo.indexOf('function providerSloEventRow');
  const end=providerSlo.indexOf('async function flushProviderSloWindow',start);
  const block=providerSlo.slice(start,end);
  assert.match(block,/currentReleaseIdentity\(cfg\)/);
  assert.doesNotMatch(block,/appVersion:\s*APP_VERSION,\s*releaseCandidate:\s*RC_NAME/);
});

test('production monitor excludes its own events before release attribution',()=>{
  const start=monitor.indexOf('async function runProductionMonitor');
  const end=monitor.indexOf('  const provider = providerSnapshot()',start);
  assert.ok(start>=0 && end>start);
  const block=monitor.slice(start,end);
  assert.match(block,/item\?\.source !== 'monitor'/);
  assert.match(block,/item\?\.source !== 'release_regression'/);
  assert.match(block,/item\?\.source !== 'release_regression_alert'/);
  assert.match(block,/const releaseMetricItems=source\.items\.filter/);
  assert.match(block,/const releaseScope=scopeOpsEventsToDeployment\(\s*releaseMetricItems/);
  assert.match(block,/const releaseItems=releaseScope\.actionable/);
  assert.match(block,/releaseMonitorHealth\(current, source\.persistent\)/);
});

test('read-only monitor guards release regression lifecycle and alert planning',()=>{
  assert.match(monitor,/const releaseRegressionLifecycle=options\.record !== false/);
  assert.match(monitor,/const releaseRegressionAlertCandidate=options\.record !== false/);
  assert.match(monitor,/reason:'read_only_monitor'/);
  assert.match(monitor,/deploySha:activeReleaseIdentity\.deploySha/);
});
