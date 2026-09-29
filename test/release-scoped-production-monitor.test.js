import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');

test('production monitor scopes release health to the active deploy SHA',()=>{
  const start=worker.indexOf('async function runProductionMonitor');
  const end=worker.indexOf('async function apiProductionMonitor',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);

  assert.match(block,/activeReleaseIdentity=currentReleaseIdentity\(cfg\)/);
  assert.match(block,/scopeOpsEventsToDeployment\(/);
  assert.match(block,/const releaseItems=releaseScope\.actionable/);
  assert.match(block,/releaseExcludedPriorDeploymentEvents/);
  assert.match(block,/releaseUnattributedEvents/);
  assert.doesNotMatch(block,/metadata\?\.appVersion[^\n]+=== APP_VERSION/);
});

test('production monitor resets state comparison at deployment boundary',()=>{
  const start=worker.indexOf('async function runProductionMonitor');
  const end=worker.indexOf('async function apiProductionMonitor',start);
  const block=worker.slice(start,end);
  assert.match(block,/const monitorScope=scopeOpsEventsToDeployment/);
  assert.match(block,/const previousMonitor = \[\.\.\.monitorScope\.actionable\]/);
});

test('direct provider SLO persistence carries deployment identity',()=>{
  const start=worker.indexOf('function providerSloEventRow');
  const end=worker.indexOf('async function flushProviderSloWindow',start);
  const block=worker.slice(start,end);
  assert.match(block,/currentReleaseIdentity\(cfg\)/);
  assert.doesNotMatch(block,/appVersion:\s*APP_VERSION,\s*releaseCandidate:\s*RC_NAME/);
});
