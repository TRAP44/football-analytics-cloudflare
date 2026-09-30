import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const releaseMonitor = readFileSync(new URL('../public/modules/admin-release-monitor.js', import.meta.url), 'utf8');

test('release monitor implementation lives outside the shared app root', () => {
  assert.match(releaseMonitor, /export function createAdminReleaseMonitorModule/);
  assert.match(releaseMonitor, /function renderReleaseMonitor\(\)/);
  assert.match(releaseMonitor, /async function loadReleaseMonitor\(force = false\)/);
  assert.match(releaseMonitor, /async function transitionPostDeployRegressionResponse/);
  assert.doesNotMatch(app, /Собираю операционные события/);
  assert.doesNotMatch(app, /postDeployRegression\?\.response/);
});

test('shared app root lazy-loads release monitor only for admins', () => {
  const start = app.indexOf('async function ensureAdminReleaseMonitorModule()');
  const end = app.indexOf('\nlet adminMediaPublisherModule', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-release-monitor\.js'\)/);
  assert.match(boundary, /loadReleaseMonitor/);
  assert.match(boundary, /transitionPostDeployRegressionResponse/);
});
