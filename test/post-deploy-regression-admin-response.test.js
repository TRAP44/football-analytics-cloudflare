import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('admin release monitor exposes a dedicated post-deploy regression response panel',()=>{
  assert.match(html,/id="releaseMonitorRegression"/);
  assert.match(app,/Post-deploy regression/);
  assert.match(app,/release_regression_alert/);
  assert.match(app,/Regression timeline/);
  assert.match(app,/Ручное действие/);
});

test('regression response panel is read-only and does not introduce automatic remediation',()=>{
  const start=app.indexOf("const regressionRows =");
  const end=app.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);
  const block=app.slice(start,end);
  assert.doesNotMatch(block,/api\(/);
  assert.doesNotMatch(block,/runtime-controls|rollback|provider-switch|feature-disable/i);
  assert.match(block,/без auto-rollback/);
  assert.match(block,/Не менять provider или runtime controls автоматически/);
});

test('regression response derives lifecycle and alert state only from existing release monitor events',()=>{
  const start=app.indexOf("const regressionRows =");
  const end=app.indexOf("const codes = c.topCodes || [];",start);
  const block=app.slice(start,end);
  assert.match(block,/Array\.isArray\(r\.incidents\)/);
  assert.match(block,/x\?\.source === 'release_regression'/);
  assert.match(block,/x\?\.source === 'release_regression_alert'/);
  assert.match(block,/POST_DEPLOY|WATCH|INCIDENT|RECOVERED|includes\('INCIDENT'\)/);
});
