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
    ['adminOverviewProviderDetail', element()],
    ['adminOverviewDatabase', element()],
    ['adminOverviewDatabaseDetail', element()],
    ['adminOverviewNotifications', element()],
    ['adminOverviewNotificationsDetail', element()],
    ['adminOverviewAi', element()],
    ['adminOverviewAiDetail', element()],
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

test('admin overview presents owner-level production provider database notification and AI status', () => {
  const elements = createElements();
  const state = {
    runtimeControlsAdmin: {
      controls: {
        analysisEnabled: true,
        searchEnabled: false,
        liveEnabled: true,
        remindersEnabled: true,
        maintenanceMode: false,
      },
    },
    provider: { plan: 'PRO', dailyRemaining: 80, dailyLimit: 100 },
    providerLoaded: true,
    diagnostics: { supabase: { ok: true, latencyMs: 42, attempts: 1 } },
    reminderHealth: {
      available: true,
      health: { state: 'healthy' },
      summary: { activeUpcoming: 3, failed24h: 0 },
    },
    modelQuality: { sample: { settled: 17 } },
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
  assert.equal(elements.get('adminOverviewSource').textContent, 'PRO');
  assert.equal(elements.get('adminOverviewProviderDetail').textContent, '80 / 100 запросов осталось сегодня');
  assert.equal(elements.get('adminOverviewDatabase').textContent, 'Норма');
  assert.equal(elements.get('adminOverviewDatabaseDetail').textContent, '42 мс · 1 попыт.');
  assert.equal(elements.get('adminOverviewNotifications').textContent, 'Норма');
  assert.equal(elements.get('adminOverviewNotificationsDetail').textContent, '3 активных · 0 ошибок за 24ч');
  assert.equal(elements.get('adminOverviewAi').textContent, 'Включён');
  assert.equal(elements.get('adminOverviewAiDetail').textContent, '17 прогнозов проверено');
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
  assert.equal(elements.get('adminOverviewDatabase').textContent, 'Не проверено');
  assert.equal(elements.get('adminOverviewNotifications').textContent, 'Включены');
  assert.equal(elements.get('adminOverviewAi').textContent, 'Включён');
});
