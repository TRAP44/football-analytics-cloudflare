import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  startupSurfacePlan,
  shouldPrepareAdminSurface,
  shouldPreparePublicSurface,
} from '../public/modules/startup-policy.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('public startup keeps football journey and excludes admin bootstrap work', () => {
  const plan = startupSurfacePlan('public', { admin:true });
  assert.deepEqual(plan.publicInitial, ['favorites','matches']);
  assert.deepEqual(plan.publicIdle, ['history']);
  assert.deepEqual(plan.adminInitial, []);
  assert.deepEqual(plan.adminIdle, []);
  assert.equal(shouldPreparePublicSurface('public'), true);
  assert.equal(shouldPrepareAdminSurface('public'), false);
});

test('admin startup skips public feed and loads admin tools only after role confirmation', () => {
  const allowed = startupSurfacePlan('admin', { admin:true });
  assert.deepEqual(allowed.publicInitial, []);
  assert.deepEqual(allowed.publicIdle, []);
  assert.deepEqual(allowed.adminInitial, ['provider']);
  assert.deepEqual(allowed.adminIdle, ['advanced_admin']);

  const denied = startupSurfacePlan('admin', { admin:false });
  assert.deepEqual(denied.adminInitial, []);
  assert.deepEqual(denied.adminIdle, []);
  assert.equal(shouldPrepareAdminSurface('admin'), true);
  assert.equal(shouldPreparePublicSurface('admin'), false);
});

test('app startup keeps identity gate before surface-specific work', () => {
  const start = app.indexOf('async function runStartupSequence()');
  const end = app.indexOf('const api = createApiClient', start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);

  const identity = source.indexOf('await Promise.allSettled([');
  const blocked = source.indexOf('if (state.closedBetaBlocked) return false');
  const surfacePlan = source.indexOf('startupSurfacePlan(APP_SURFACE, { admin })');
  const adminBranch = source.indexOf("if (APP_SURFACE === 'admin')");
  const publicFeed = source.indexOf('const startupTasks = [loadFavorites(), loadMatches()]');

  assert.ok(identity >= 0 && blocked > identity);
  assert.ok(surfacePlan > blocked);
  assert.ok(adminBranch > surfacePlan);
  assert.ok(publicFeed > adminBranch);
  assert.match(source, /if \(!admin\) return true/);
  assert.match(source, /startupPlan\.adminIdle\.includes\('advanced_admin'\)/);
  assert.match(source, /startupPlan\.publicIdle\.includes\('history'\)/);
});

test('admin surface preparation is conditional at boot', () => {
  assert.match(app, /if \(shouldPrepareAdminSurface\(APP_SURFACE\)\) organizeAdminConsole\(\)/);
  assert.match(app, /if \(shouldPreparePublicSurface\(APP_SURFACE\)\) \{/);
});
