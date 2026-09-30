import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminLaunchFunnelModule } from '../public/modules/admin-launch-funnel.js';

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

test('admin launch funnel module fails closed for non-admin callers', async () => {
  let apiCalls = 0;
  const state = {
    launchFunnel: null,
    launchFunnelLoading: false,
    launchFunnelDays: 7,
    recoveryIncidentAckPending: new Set(),
  };
  const module = createAdminLaunchFunnelModule({
    state,
    $: () => { throw new Error('DOM lookup must not run for non-admin callers'); },
    isAdmin: () => false,
    escapeHtml: value => String(value ?? ''),
    api: async () => { apiCalls += 1; return {}; },
    toast: () => {},
    dateTime: value => String(value ?? ''),
  });

  assert.doesNotThrow(() => module.renderLaunchFunnel());
  await module.loadLaunchFunnel(true);
  await module.acknowledgeRecoveryIncident({
    reason: 'delivery_failed',
    action: 'recheck',
    code: 'test',
    lastSeenAt: new Date().toISOString(),
  });

  assert.equal(apiCalls, 0);
  assert.equal(state.launchFunnel, null);
  assert.equal(state.launchFunnelLoading, false);
  assert.equal(state.recoveryIncidentAckPending.size, 0);
});
