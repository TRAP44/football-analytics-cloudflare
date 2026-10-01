import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../public/modules/first-run-guide.js', import.meta.url), 'utf8');
const publicHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');

test('first-run guide behavior lives behind a dedicated controller', () => {
  assert.match(app, /createFirstRunGuideController/);
  assert.doesNotMatch(app, /function hasDirectLaunchIntent/);
  assert.doesNotMatch(app, /function renderFirstRunGuide/);
  assert.doesNotMatch(app, /function dismissFirstRunGuide/);
  assert.match(moduleSource, /function hasDirectLaunchIntent/);
  assert.match(moduleSource, /function renderFirstRunGuide/);
  assert.match(moduleSource, /function dismissFirstRunGuide/);
  assert.match(moduleSource, /function startFirstRunSearch/);
  assert.match(moduleSource, /function startFirstRunFavorite/);
});

test('first-run controller stays local and reuses existing app surfaces', () => {
  assert.match(moduleSource, /FIRST_RUN_GUIDE_KEY/);
  assert.match(moduleSource, /storage\.getItem\(FIRST_RUN_GUIDE_KEY\)/);
  assert.match(moduleSource, /storage\.setItem\(FIRST_RUN_GUIDE_KEY, '1'\)/);
  assert.match(moduleSource, /sendProductAction\('first_run_search', 'matchesView'\)/);
  assert.match(moduleSource, /sendProductAction\('first_run_favorite', 'searchView'\)/);
  assert.match(moduleSource, /showView\('searchView'\)/);
  assert.doesNotMatch(moduleSource, /\/api\//);
});

test('frontend revision refreshes both public surfaces from one runtime source of truth', () => {
  assert.match(FRONTEND_ASSET_REVISION, /^6\.120\.0-launch\d+$/);
  assert.ok(publicHtml.includes(`frontend-asset-revision" content="${FRONTEND_ASSET_REVISION}"`));
  assert.ok(adminHtml.includes(`frontend-asset-revision" content="${FRONTEND_ASSET_REVISION}"`));
  assert.ok(publicHtml.includes(`/app.js?v=${FRONTEND_ASSET_REVISION}`));
  assert.ok(adminHtml.includes(`/app.js?v=${FRONTEND_ASSET_REVISION}`));
});
