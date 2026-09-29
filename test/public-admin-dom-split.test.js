import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const publicHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('public shell excludes heavy admin panels while keeping the admin entry point', () => {
  assert.match(publicHtml, /id="openAdminSurfaceBtn"/);
  for (const marker of [
    'runtime-controls-panel',
    'provider-status-panel',
    'diagnostics-panel',
    'model-quality-panel',
    'provider-audit-panel',
    'reminder-health-panel',
    'release-monitor-panel',
    'launch-funnel-panel',
    'production-readiness-panel',
  ]) {
    assert.doesNotMatch(publicHtml, new RegExp(marker));
  }
});

test('dedicated admin surface retains operational panels', () => {
  for (const marker of [
    'runtime-controls-panel',
    'provider-status-panel',
    'diagnostics-panel',
    'model-quality-panel',
    'provider-audit-panel',
    'reminder-health-panel',
    'release-monitor-panel',
    'launch-funnel-panel',
    'production-readiness-panel',
  ]) {
    assert.match(adminHtml, new RegExp(marker));
  }
});

test('public admin profile avoids loading admin datasets until dedicated surface opens', () => {
  const start = app.indexOf('function openProfileView');
  const end = app.indexOf('function releaseStateLabel', start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /isAdmin\(\) && APP_SURFACE === 'admin'/);
  assert.match(app, /openAdminSurfaceBtn.*location\.href = '\/admin\.html'/s);
});

test('split surfaces use launch14 assets', () => {
  for (const html of [publicHtml, adminHtml]) {
    assert.match(html, /frontend-asset-revision" content="6\.120\.0-launch14"/);
  }
});
