import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const router=fs.readFileSync('src/router.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

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
  assert.match(app,/NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED/);
  assert.match(app,/RESOLVED разрешён только после RECOVERED/);
  assert.match(app,/\/api\/post-deploy-regression-response/);
  assert.match(app,/data-response-state/);
  assert.match(app,/releaseRegressionResponsePending/);
  assert.doesNotMatch(app.slice(
    app.indexOf('async function transitionPostDeployRegressionResponse'),
    app.indexOf('async function loadReleaseMonitor'),
  ),/runtime-controls|rollbackTo|switchProvider|disableFeature/);
});
