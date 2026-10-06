import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminOverviewModule } from '../public/modules/admin-overview.js';

function readPublicFile(relativePath) {
  return readFileSync(new URL('../public/' + relativePath, import.meta.url), 'utf8');
}

function createElement() {
  return { textContent: '' };
}

function createElements() {
  return new Map([
    ['adminOverviewService', createElement()],
    ['adminOverviewFeatures', createElement()],
    ['adminOverviewSource', createElement()],
    ['adminOverviewProviderDetail', createElement()],
    ['adminOverviewDatabase', createElement()],
    ['adminOverviewDatabaseDetail', createElement()],
    ['adminOverviewNotifications', createElement()],
    ['adminOverviewNotificationsDetail', createElement()],
    ['adminOverviewAi', createElement()],
    ['adminOverviewAiDetail', createElement()],
    ['adminOverviewVersion', createElement()],
  ]);
}

function createModule({
  state = {},
  elements = createElements(),
  isAdmin = () => true,
  planLabel = value => String(value ?? ''),
  clientVersion = 'test-version',
} = {}) {
  return {
    elements,
    module: createAdminOverviewModule({
      state,
      elementById: id => elements.get(id) || null,
      isAdmin,
      planLabel,
      clientVersion,
    }),
  };
}

const app = readPublicFile('app.js');
const overview = readPublicFile('modules/admin-overview.js');

test('admin overview implementation stays outside app without capturing access or boot orchestration', () => {
  assert.match(overview, /export function createAdminOverviewModule/);
  assert.match(overview, /function renderAdminOverview\(\)/);
  assert.match(overview, /if \(!isAdmin\(\)\) return/);

  assert.doesNotMatch(app, /const primaryFeatureKeys = \['analysisEnabled', 'searchEnabled', 'liveEnabled'\]/);
  assert.match(app, /function applyAdminVisibility\(\)/);
  assert.match(app, /function organizeAdminConsole\(\)/);
  assert.match(app, /async function loadAdvancedAdminTools\(\)/);
  assert.doesNotMatch(
    overview,
    /applyAdminVisibility|organizeAdminConsole|loadAdvancedAdminTools|querySelectorAll\('\[data-admin-only\]'\)/,
  );
});

test('app lazy-loads admin overview behind admin gate with explicit dependencies', () => {
  assert.match(
    app,
    /async function ensureAdminOverviewModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-overview\.js'\)/,
  );
  assert.match(
    app,
    /createAdminOverviewModule\(\{[\s\S]*?state,[\s\S]*?elementById: \$,[\s\S]*?isAdmin,[\s\S]*?planLabel,[\s\S]*?clientVersion: CLIENT_VERSION/,
  );
});

test('non-admin overview fails closed without DOM access', () => {
  const module = createAdminOverviewModule({
    state: {},
    elementById: () => {
      throw new Error('DOM must not be touched');
    },
    isAdmin: () => false,
    planLabel: value => String(value ?? ''),
    clientVersion: 'test-version',
  });

  assert.doesNotThrow(() => module.renderAdminOverview());
});

test('admin overview presents production provider database notification and AI status', () => {
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
    provider: {
      plan: 'PRO',
      dailyRemaining: 80,
      dailyLimit: 100,
    },
    providerLoaded: true,
    diagnostics: {
      supabase: {
        ok: true,
        latencyMs: 42,
        attempts: 1,
      },
    },
    reminderHealth: {
      available: true,
      health: { state: 'healthy' },
      summary: {
        activeUpcoming: 3,
        failed24h: 0,
      },
    },
    modelQuality: {
      sample: { settled: 17 },
    },
  };

  const { elements, module } = createModule({
    state,
    planLabel: value => value === 'PRO' ? 'PRO' : String(value ?? ''),
    clientVersion: 'test-version',
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
  assert.equal(elements.get('adminOverviewVersion').textContent, 'test-version');
});

test('partial runtime snapshots never optimistically report unknown features as enabled', () => {
  const state = {
    runtimeStatus: {
      maintenanceMode: true,
    },
    provider: { plan: 'UNKNOWN' },
    providerLoaded: false,
  };

  const { elements, module } = createModule({ state });
  module.renderAdminOverview();

  assert.equal(elements.get('adminOverviewService').textContent, 'Обслуживание');
  assert.equal(elements.get('adminOverviewFeatures').textContent, 'Проверяем основные функции');
  assert.equal(elements.get('adminOverviewNotifications').textContent, 'Не проверено');
  assert.equal(elements.get('adminOverviewNotificationsDetail').textContent, 'Проверка ещё не выполнена');
  assert.equal(elements.get('adminOverviewAi').textContent, 'Проверяется');
});

test('admin overview exposes loading states instead of stale health assumptions', () => {
  const state = {
    runtimeStatus: {
      analysisEnabled: true,
      searchEnabled: true,
      liveEnabled: true,
      remindersEnabled: true,
      maintenanceMode: false,
    },
    diagnosticsLoading: true,
    reminderHealthLoading: true,
  };

  const { elements, module } = createModule({ state });
  module.renderAdminOverview();

  assert.equal(elements.get('adminOverviewFeatures').textContent, '3/3 основных функций');
  assert.equal(elements.get('adminOverviewDatabase').textContent, 'Проверяется');
  assert.equal(elements.get('adminOverviewDatabaseDetail').textContent, 'Проверяем Supabase');
  assert.equal(elements.get('adminOverviewNotifications').textContent, 'Проверяется');
  assert.equal(elements.get('adminOverviewNotificationsDetail').textContent, 'Проверяем доставку');
  assert.equal(elements.get('adminOverviewAi').textContent, 'Включён');
});

test('admin overview surfaces disabled runtime controls explicitly', () => {
  const state = {
    runtimeControlsAdmin: {
      controls: {
        analysisEnabled: false,
        searchEnabled: true,
        liveEnabled: false,
        remindersEnabled: false,
        maintenanceMode: false,
      },
    },
    provider: {
      plan: 'FREE',
    },
    providerLoaded: true,
    modelQuality: {
      available: false,
      reason: 'quality backend unavailable',
    },
  };

  const { elements, module } = createModule({
    state,
    planLabel: value => value === 'FREE' ? 'Бесплатный' : String(value ?? ''),
  });
  module.renderAdminOverview();

  assert.equal(elements.get('adminOverviewFeatures').textContent, '1/3 основных функций');
  assert.equal(elements.get('adminOverviewSource').textContent, 'Бесплатный');
  assert.equal(elements.get('adminOverviewNotifications').textContent, 'Выключены');
  assert.equal(elements.get('adminOverviewNotificationsDetail').textContent, 'Отключены Runtime Control');
  assert.equal(elements.get('adminOverviewAi').textContent, 'Выключен');
  assert.equal(elements.get('adminOverviewAiDetail').textContent, 'Отключён Runtime Control');
});


test('admin overview surfaces unavailable model quality while analysis remains enabled', () => {
  const state = {
    runtimeStatus: {
      analysisEnabled: true,
      searchEnabled: true,
      liveEnabled: true,
      remindersEnabled: true,
      maintenanceMode: false,
    },
    modelQuality: {
      available: false,
      reason: 'quality backend unavailable',
    },
  };

  const { elements, module } = createModule({ state });
  module.renderAdminOverview();

  assert.equal(elements.get('adminOverviewAi').textContent, 'Проверить');
  assert.equal(elements.get('adminOverviewAiDetail').textContent, 'quality backend unavailable');
});
