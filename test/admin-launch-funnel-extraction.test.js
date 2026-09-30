import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const launchFunnel = readFileSync(new URL('../public/modules/admin-launch-funnel.js', import.meta.url), 'utf8');

test('launch funnel implementation lives outside the shared app root', () => {
  assert.match(launchFunnel, /export function createAdminLaunchFunnelModule/);
  assert.match(launchFunnel, /function renderLaunchFunnel\(\)/);
  assert.match(launchFunnel, /async function acknowledgeRecoveryIncident/);
  assert.match(launchFunnel, /async function loadLaunchFunnel\(force=false\)/);
  assert.doesNotMatch(app, /Собираю first-party воронку/);
  assert.doesNotMatch(app, /newsImpactRecoveryIncidentSloBreachImpactRanking/);
});

test('shared app root lazy-loads launch funnel only for admins', () => {
  const start = app.indexOf('async function ensureAdminLaunchFunnelModule()');
  const end = app.indexOf('\nlet adminDiagnosticsModule', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-launch-funnel\.js'\)/);
  assert.match(boundary, /renderLaunchFunnel/);
  assert.match(boundary, /loadLaunchFunnel/);
  assert.match(boundary, /acknowledgeRecoveryIncident/);
});
