import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const release = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));
const publicHtml = fs.readFileSync('public/index.html', 'utf8');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
const appRuntime = fs.readFileSync('public/modules/app-runtime.js', 'utf8');

test('frontend asset revision matches the runtime release identity', () => {
  const expected = release.runtimeVersion;
  const publicRevision = /<meta name="frontend-asset-revision" content="([^"]+)" \/>/.exec(publicHtml)?.[1];
  const adminRevision = /<meta name="frontend-asset-revision" content="([^"]+)" \/>/.exec(adminHtml)?.[1];
  const runtimeRevision = /FRONTEND_ASSET_REVISION = '([^']+)'/.exec(appRuntime)?.[1];

  assert.equal(publicRevision, expected);
  assert.equal(adminRevision, expected);
  assert.equal(runtimeRevision, expected);

  for (const html of [publicHtml, adminHtml]) {
    assert.ok(html.includes(`/app.js?v=${expected}`));
    assert.ok(html.includes(`/styles.css?v=${expected}`));
    assert.ok(html.includes(`/styles/public-shell.css?v=${expected}`));
    assert.ok(html.includes(`/assets/brand/matchradar-mark.svg?v=${expected}`));
  }
  assert.ok(publicHtml.includes(`/styles/premium-ui.css?v=${expected}`));
});


test('frontend assets do not retain legacy launch/p revision labels', () => {
  const expected = release.runtimeVersion;
  for (const html of [publicHtml, adminHtml]) {
    assert.ok(html.includes(`/assets/brand/matchradar-mark.svg?v=${expected}`));
    assert.doesNotMatch(html,/\?v=\d+\.\d+\.\d+-(?:launch|p)\d+/);
  }
});
