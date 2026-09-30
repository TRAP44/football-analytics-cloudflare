import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const router=fs.readFileSync('src/router.js','utf8');
const releaseMonitor=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');

test('regression response endpoint is admin-only at the router boundary',()=>{
  assert.match(router,/url\.pathname === '\/api\/post-deploy-regression-response'/);
  const start=router.indexOf("if (url.pathname === '/api/post-deploy-regression-response')");
  const block=router.slice(start,start+260);
  assert.match(block,/isAdminUser\(user, cfg\)/);
  assert.match(block,/adminForbidden\(\)/);
  assert.match(block,/apiPostDeployRegressionResponse/);
});

test('response writes require persistent ops history and exact active deployment identity',()=>{
  const start=worker.indexOf('async function apiPostDeployRegressionResponse');
  const end=worker.indexOf('async function apiReleaseMonitor',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/currentReleaseIdentity\(cfg\)/);
  assert.match(block,/body\?\.deploySha/);
  assert.match(block,/readOpsEventsRange/);
  assert.match(block,/!source\.persistent/);
  assert.match(block,/source\.truncated/);
  assert.match(block,/planPostDeployRegressionResponseTransition/);
  assert.match(block,/recordOpsEvent\(cfg,plan\)/);
  assert.match(block,/_persistenceStatus/);
});

test('release monitor exposes deployment-scoped lifecycle alert and response audit timeline',()=>{
  const start=worker.indexOf('async function apiReleaseMonitor');
  const end=worker.indexOf('async function apiDiagnostics',start);
  const block=worker.slice(start,end);
  assert.match(block,/summarizePostDeployRegressionResponse/);
  assert.match(block,/release_regression_response/);
  assert.match(block,/postDeployRegressionTimeline/);
  assert.match(block,/postDeployRegression:\{/);
});

test('admin UI exposes only sequential manual incident response actions',()=>{
  assert.match(releaseMonitor,/NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED/);
  assert.match(releaseMonitor,/RESOLVED разрешён только после RECOVERED/);
  assert.match(releaseMonitor,/\/api\/post-deploy-regression-response/);
  assert.match(releaseMonitor,/data-response-state/);
  assert.match(releaseMonitor,/releaseRegressionResponsePending/);
  assert.doesNotMatch(releaseMonitor.slice(
    releaseMonitor.indexOf('async function transitionPostDeployRegressionResponse'),
    releaseMonitor.indexOf('async function loadReleaseMonitor'),
  ),/runtime-controls|rollbackTo|switchProvider|disableFeature/);
});
