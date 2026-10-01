import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

const publicHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const publicEntry = readFileSync(new URL('../public/app-public.js', import.meta.url), 'utf8');
const adminEntry = readFileSync(new URL('../public/app-admin.js', import.meta.url), 'utf8');

test('public and admin surfaces use distinct JavaScript entrypoints', () => {
  assert.ok(publicHtml.includes(`/app-public.js?v=${FRONTEND_ASSET_REVISION}`));
  assert.doesNotMatch(publicHtml, /\/app-admin\.js/);
  assert.ok(adminHtml.includes(`/app-admin.js?v=${FRONTEND_ASSET_REVISION}`));
  assert.doesNotMatch(adminHtml, /\/app-public\.js/);
});

test('surface entrypoints keep the shared composition root explicit during extraction', () => {
  assert.match(publicEntry, /import '\.\/app\.js\?v=6\.120\.0-launch32';/);
  assert.match(adminEntry, /import '\.\/app\.js\?v=6\.120\.0-launch32';/);
  assert.doesNotMatch(publicEntry, /admin-only|runtimeControls|diagnostics/i);
});

test('entrypoint split is a migration boundary, not an authorization boundary', () => {
  assert.match(publicHtml, /matchradar-surface" content="public"/);
  assert.match(adminHtml, /matchradar-surface" content="admin"/);
});
