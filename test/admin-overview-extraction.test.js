import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminOverviewModule } from '../public/modules/admin-overview.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const overview = readFileSync(new URL('../public/modules/admin-overview.js', import.meta.url), 'utf8');

function element() {
  return { textContent: '' };
}

function createElements() {
  return new Map([
    ['adminOverviewService', element()],
    ['adminOverviewFeatures', element()],
    ['adminOverviewSource', element()],
    ['adminOverviewVersion', element()],
  ]);
}

test('admin overview implementation lives outside app without capturing access or boot orchestration', () => {
  assert.match(overview, /export function createAdminOverviewModule/);
  assert.match(overview, /function renderAdminOverview\(\)/);
  assert.doesNotMatch(app, /const enabled = \['analysisEnabled', 'searchEnabled', 'liveEnabled'\]/);
  assert.match(app, /function applyAdminVisibility\(\)/);
  assert.match(app, /function organizeAdminConsole\(\)/);
  assert.match(app, /async function loadAdvancedAdminTools\(\)/);
  assert.doesNotMatch(overview, /applyAdminVisibility|organizeAdminConsole|loadAdvancedAdminTools|querySelectorAll\('\[data-admin-only\]'\)/);
});

test('app lazy-loads admin overview behind the existing admin gate with explicit dependencies', () => {
  const start = app.indexOf('async function ensureAdminOverviewModule()');
  const end = app.indexOf('\nfunction applyAdminVisibility()', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-overview\.js'\)/);
  assert.match(boundary, /state/);
  assert.match(boundary, /elementById: \$/);
  assert.match(boundary, /planLabel/);
  assert.match(boundary, /clientVersion: CLIENT_VERSION/);
});

test('non-admin overview fails closed without DOM access', () => {
  const state = {};
  const module = createAdminOverviewModule({
    state,
    elementById: () => { throw new Error('DOM must not be touched'); },
    isAdmin: () => false,
    planLabel: value => String(value ?? ''),
    clientVersion: 'test-version',
  });

  assert.doesNotThrow(() => module.renderAdminOverview());
});

test('admin overview preserves runtime, feature, provider and version presentation', () => {
  const elements = createElements();
  const state = {
    runtimeControlsAdmin: {
      controls: {
        analysisEnabled: true,
        searchEnabled: false,
        liveEnabled: true,
        maintenanceMode: false,
      },
    },
    provider: { plan: 'PRO' },
    providerLoaded: true,
  };
  const module = createAdminOverviewModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin: () => true,
    planLabel: value => value === 'PRO' ? 'PRO' : String(value ?? ''),
    clientVersion: '6.120.0-rc144',
  });

  module.renderAdminOverview();

  assert.equal(elements.get('adminOverviewService').textContent, 'Работает');
  assert.equal(elements.get('adminOverviewFeatures').textContent, '2/3 основных функций');
  assert.equal(elements.get('adminOverviewSource').textContent, 'PRO · подключён');
  assert.equal(elements.get('adminOverviewVersion').textContent, '6.120.0-rc144');
});

test('admin overview preserves checking and maintenance fallbacks', () => {
  const elements = createElements();
  const state = {
    runtimeStatus: { maintenanceMode: true },
    provider: { plan: 'UNKNOWN' },
    providerLoaded: false,
  };
  const module = createAdminOverviewModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin: () => true,
    planLabel: value => String(value ?? ''),
    clientVersion: 'test-version',
  });

  module.renderAdminOverview();

  assert.equal(elements.get('adminOverviewService').textContent, 'Обслуживание');
  assert.equal(elements.get('adminOverviewFeatures').textContent, '3/3 основных функций');
  assert.equal(elements.get('adminOverviewSource').textContent, 'Проверяется');
});
