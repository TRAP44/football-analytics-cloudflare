import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/admin.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('admin release monitor exposes a dedicated post-deploy regression response panel',()=>{
  assert.match(html,/id="releaseMonitorRegression"/);
  assert.match(app,/Post-deploy regression/);
  assert.match(app,/release_regression_alert/);
  assert.match(app,/Regression timeline/);
  assert.match(app,/Ручное действие/);
});

test('manual regression response controls do not introduce automatic remediation',()=>{
  const start=app.indexOf("const regressionData =");
  const end=app.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);
  const block=app.slice(start,end);
  assert.doesNotMatch(block,/runtimeControlsSaving|saveRuntime|rollbackTo|switchProvider|disableFeature/);
  assert.match(block,/Auto-rollback/);
  assert.match(block,/RESOLVED разрешён только после RECOVERED/);
});

test('regression response derives lifecycle alert and audit state from release monitor payload',()=>{
  const start=app.indexOf("const regressionData =");
  const end=app.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);
  const block=app.slice(start,end);
  assert.match(block,/r\.postDeployRegression/);
  assert.match(block,/Array\.isArray\(regressionData\.timeline\)/);
  assert.match(block,/x\?\.source === 'release_regression'/);
  assert.match(block,/x\?\.source === 'release_regression_alert'/);
  assert.match(block,/x\?\.source === 'release_regression_response'/);
  assert.match(block,/lifecycleState/);
});
