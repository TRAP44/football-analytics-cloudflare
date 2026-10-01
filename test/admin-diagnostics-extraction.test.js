import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const diagnostics = readFileSync(new URL('../public/modules/admin-diagnostics.js', import.meta.url), 'utf8');

test('admin diagnostics implementation lives outside the shared app root', () => {
  assert.match(diagnostics, /export function createAdminDiagnosticsModule/);
  assert.match(diagnostics, /function renderDiagnostics\(\)/);
  assert.match(diagnostics, /async function loadDiagnostics\(force = false\)/);
  assert.doesNotMatch(app, /function renderDiagnostics\(\) \{\n  const root = \$\('diagnosticsStatus'\)/);
  assert.doesNotMatch(app, /Проверяю сервер, Supabase, сохранённые данные и API-Football/);
});

test('shared app root lazy-loads diagnostics only behind admin role', () => {
  const start = app.indexOf('async function ensureAdminDiagnosticsModule()');
  const end = app.indexOf('\nfunction renderBilling()', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-diagnostics\.js'\)/);
  assert.match(boundary, /createAdminDiagnosticsModule/);
});

