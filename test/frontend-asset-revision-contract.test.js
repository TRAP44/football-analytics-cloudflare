import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

const publicHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const verifier = readFileSync(new URL('../scripts/verify-release.js', import.meta.url), 'utf8');

function surfaceRevision(html) {
  return /<meta name="frontend-asset-revision" content="([^"]+)" \/>/.exec(html)?.[1] || '';
}

test('frontend asset revision has one runtime source of truth', () => {
  assert.match(FRONTEND_ASSET_REVISION, /^6\.120\.0-launch\d+$/);
  assert.equal(surfaceRevision(publicHtml), FRONTEND_ASSET_REVISION);
  assert.equal(surfaceRevision(adminHtml), FRONTEND_ASSET_REVISION);
});

test('all static frontend entrypoints use the same revision token', () => {
  assert.ok(publicHtml.includes(`/app-public.js?v=${FRONTEND_ASSET_REVISION}`));
  assert.ok(adminHtml.includes(`/app-admin.js?v=${FRONTEND_ASSET_REVISION}`));
  for (const html of [publicHtml, adminHtml]) {
    assert.ok(html.includes(`/styles.css?v=${FRONTEND_ASSET_REVISION}`));
    assert.ok(html.includes(`/styles/public-shell.css?v=${FRONTEND_ASSET_REVISION}`));
  }
});

test('release verification fails closed on asset revision drift', () => {
  assert.match(verifier, /runtimeFrontendAssetRevision/);
  assert.match(verifier, /Admin and public frontend asset revisions must match/);
  assert.match(verifier, /Frontend runtime asset revision must match public HTML/);
});
