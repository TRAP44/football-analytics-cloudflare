import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const runtimeControls = readFileSync(new URL('../public/modules/admin-runtime-controls.js', import.meta.url), 'utf8');

test('runtime controls implementation lives outside the shared app root', () => {
  assert.match(runtimeControls, /export function createAdminRuntimeControlsModule/);
  assert.match(runtimeControls, /function renderRuntimeControls\(\)/);
  assert.match(runtimeControls, /async function loadRuntimeControlsAdmin\(force = false\)/);
  assert.match(runtimeControls, /async function saveRuntimeControls\(payload = null, options = \{\}\)/);
  assert.doesNotMatch(app, /function runtimeHistorySummary\(controls = \{\}\)/);
  assert.doesNotMatch(app, /Откат к версии/);
});

test('shared app root lazy-loads runtime controls only for admins', () => {
  const start = app.indexOf('async function ensureAdminRuntimeControlsModule()');
  const end = app.indexOf('\nfunction renderReminderHealth()', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-runtime-controls\.js'\)/);
  assert.match(boundary, /loadRuntimeControlsAdmin/);
  assert.match(boundary, /saveRuntimeControls/);
  assert.match(boundary, /restoreRuntimeDefaults/);
});
