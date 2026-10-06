import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminRuntimeControlsModule } from '../public/modules/admin-runtime-controls.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createState(overrides = {}) {
  return {
    runtimeControlsAdmin: null,
    runtimeControlsLoading: false,
    runtimeControlsSaving: false,
    runtimeStatus: null,
    ...overrides,
  };
}

function createElement() {
  return {
    textContent: '',
    innerHTML: '',
    className: '',
    value: '',
    checked: false,
    disabled: false,
    dataset: {},
    querySelectorAll() {
      return [];
    },
  };
}

function createElements() {
  const ids = [
    'runtimeControlsBadge',
    'runtimeControlsStatus',
    'runtimeControlsRevision',
    'runtimeSaveBtn',
    'runtimeDefaultsBtn',
    'runtimeControlsRefreshBtn',
    'runtimeSecurityLockdownToggle',
    'runtimeMaintenanceToggle',
    'runtimeAnalysisToggle',
    'runtimeSearchToggle',
    'runtimeLiveToggle',
    'runtimeRemindersToggle',
    'runtimeExpandedToggle',
    'runtimeAutoSettlementRecoveryToggle',
    'runtimeMessage',
    'runtimeChangeReason',
    'runtimeHistoryStatus',
    'runtimeHistoryList',
  ];
  return new Map(ids.map(id => [id, createElement()]));
}

function createModule({
  state = createState(),
  elements = createElements(),
  isAdmin = () => true,
  api = async () => ({}),
  applyRuntimeUi = () => {},
  toast = () => {},
  renderAdminOverview = () => {},
} = {}) {
  return {
    elements,
    module: createAdminRuntimeControlsModule({
      state,
      $: id => elements.get(id) || null,
      isAdmin,
      api,
      applyRuntimeUi,
      toast,
      renderAdminOverview,
      escapeHtml: value => String(value ?? ''),
      dateTime: value => String(value ?? ''),
      humanizeTechnicalText: value => String(value ?? ''),
      relativeAge: value => String(value ?? ''),
      SUPABASE_SCHEMA_HINT: 'schema migration required',
    }),
  };
}

const app = readRepoFile('public/app.js');
const runtimeControls = readRepoFile('public/modules/admin-runtime-controls.js');
const router = readRepoFile('src/router.js');
const runtimeBackend = readRepoFile('src/runtime-controls.js');

test('runtime controls implementation stays outside the shared app root', () => {
  assert.match(runtimeControls, /export function createAdminRuntimeControlsModule/);
  assert.match(runtimeControls, /function renderRuntimeControls\(\)/);
  assert.match(runtimeControls, /async function loadRuntimeControlsAdmin\(force = false\)/);
  assert.match(runtimeControls, /async function saveRuntimeControls\(payload = null, options = \{\}\)/);
  assert.match(runtimeControls, /async function restoreRuntimeRevision\(historyId, sourceRevision\)/);
  assert.match(runtimeControls, /async function restoreRuntimeDefaults\(\)/);

  assert.doesNotMatch(app, /function runtimeHistorySummary\(controls = \{\}\)/);
  assert.doesNotMatch(app, /Откат к версии/);
});

test('runtime controls routes are admin-only and protect PATCH, POST and rollback mutations', () => {
  assert.match(
    router,
    /if \(pathname === '\/api\/runtime-controls'\)[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?method === 'GET'[\s\S]*?apiRuntimeControls\(request,cfg,user\)[\s\S]*?method === 'PATCH' \|\| method === 'POST'[\s\S]*?sensitiveMutation\(\(\)=>apiRuntimeControls\(request,cfg,user\)\)/,
  );
  assert.match(
    router,
    /if \(pathname === '\/api\/runtime-controls\/rollback'\)[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?method !== 'POST'[\s\S]*?sensitiveMutation\(\(\)=>apiRuntimeRollback\(request,cfg,user\)\)/,
  );
  assert.match(
    runtimeBackend,
    /if \(request\?\.method === 'PATCH' \|\| request\?\.method === 'POST'\)/,
  );
});

test('shared app root lazy-loads runtime controls only behind admin role', () => {
  assert.match(
    app,
    /async function ensureAdminRuntimeControlsModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-runtime-controls\.js'\)/,
  );
  assert.match(
    app,
    /createAdminRuntimeControlsModule\(\{[\s\S]*?state, \$, isAdmin, api, applyRuntimeUi, toast, renderAdminOverview,[\s\S]*?SUPABASE_SCHEMA_HINT/,
  );
  assert.match(app, /module\?\.loadRuntimeControlsAdmin\(\.\.\.args\)/);
  assert.match(app, /module\?\.saveRuntimeControls\(\.\.\.args\)/);
  assert.match(app, /module\?\.restoreRuntimeDefaults\(\.\.\.args\)/);
});

test('non-admin runtime controls fail closed for render, load, save and defaults restore', async () => {
  const state = createState({
    runtimeControlsAdmin: {
      controls: { revision: 7 },
    },
  });
  let apiCalls = 0;
  let uiCalls = 0;
  let toastCalls = 0;

  const module = createAdminRuntimeControlsModule({
    state,
    $: () => {
      throw new Error('DOM must not be touched for non-admin runtime controls');
    },
    isAdmin: () => false,
    api: async () => {
      apiCalls += 1;
      return {};
    },
    applyRuntimeUi: () => {
      uiCalls += 1;
    },
    toast: () => {
      toastCalls += 1;
    },
    renderAdminOverview: () => {
      uiCalls += 1;
    },
    escapeHtml: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: value => String(value ?? ''),
    SUPABASE_SCHEMA_HINT: 'schema',
  });

  assert.doesNotThrow(() => module.renderRuntimeControls());
  await module.loadRuntimeControlsAdmin(true);
  await module.saveRuntimeControls({
    expectedRevision: 7,
    analysisEnabled: false,
  }, { skipConfirm: true });
  await module.restoreRuntimeDefaults();

  assert.equal(apiCalls, 0);
  assert.equal(uiCalls, 0);
  assert.equal(toastCalls, 0);
  assert.equal(state.runtimeControlsSaving, false);
  assert.equal(state.runtimeControlsLoading, false);
});

test('runtime controls loader preserves forced refresh contract and applies runtime snapshot', async () => {
  const state = createState();
  const elements = createElements();
  const calls = [];
  let uiCalls = 0;

  const { module } = createModule({
    state,
    elements,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return {
        available: true,
        schemaReady: true,
        historyReady: true,
        controls: {
          revision: 8,
          maintenanceMode: false,
          analysisEnabled: true,
          searchEnabled: true,
          liveEnabled: true,
          remindersEnabled: true,
          expandedDataEnabled: true,
          autoSettlementRecoveryEnabled: false,
        },
        history: [],
      };
    },
    applyRuntimeUi: () => {
      uiCalls += 1;
    },
  });

  await module.loadRuntimeControlsAdmin(true);

  assert.deepEqual(calls, [{
    path: '/api/runtime-controls?refresh=1',
    options: {
      retry: false,
      dedupe: false,
      timeoutMs: 12000,
    },
  }]);
  assert.equal(state.runtimeControlsLoading, false);
  assert.equal(state.runtimeControlsAdmin.controls.revision, 8);
  assert.equal(state.runtimeStatus.revision, 8);
  assert.equal(uiCalls, 1);
  assert.equal(elements.get('runtimeControlsBadge').textContent, 'АКТИВНО');
});

test('runtime controls loader turns API failure into blocked unavailable state', async () => {
  const state = createState();
  const elements = createElements();

  const { module } = createModule({
    state,
    elements,
    api: async () => {
      throw new Error('control plane unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadRuntimeControlsAdmin(true));

  assert.equal(state.runtimeControlsLoading, false);
  assert.deepEqual(state.runtimeControlsAdmin, {
    available: false,
    schemaReady: false,
    reason: 'control plane unavailable',
  });
  assert.equal(elements.get('runtimeControlsBadge').textContent, 'БД');
  assert.equal(elements.get('runtimeControlsStatus').textContent, 'control plane unavailable');
});

test('runtime controls save uses PATCH contract and synchronizes authoritative revision', async () => {
  const state = createState({
    runtimeControlsAdmin: {
      available: true,
      schemaReady: true,
      historyReady: true,
      controls: { revision: 8 },
      history: [],
    },
  });
  const elements = createElements();
  const calls = [];
  const toasts = [];
  let uiCalls = 0;
  const payload = {
    expectedRevision: 8,
    maintenanceMode: false,
    analysisEnabled: true,
    searchEnabled: false,
    liveEnabled: true,
    remindersEnabled: true,
    expandedDataEnabled: true,
    autoSettlementRecoveryEnabled: false,
    message: 'search maintenance',
    reason: 'planned search maintenance',
    action: 'update',
  };

  const { module } = createModule({
    state,
    elements,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return {
        controls: {
          ...payload,
          revision: 9,
        },
        historyReady: true,
        historyReason: '',
        history: [],
      };
    },
    applyRuntimeUi: () => {
      uiCalls += 1;
    },
    toast: message => toasts.push(message),
  });

  await module.saveRuntimeControls(payload, { skipConfirm: true });

  assert.deepEqual(calls, [{
    path: '/api/runtime-controls',
    options: {
      method: 'PATCH',
      body: JSON.stringify(payload),
      retry: false,
      dedupe: false,
      timeoutMs: 12000,
    },
  }]);
  assert.equal(state.runtimeControlsSaving, false);
  assert.equal(state.runtimeControlsAdmin.controls.revision, 9);
  assert.equal(state.runtimeStatus.revision, 9);
  assert.equal(uiCalls, 1);
  assert.deepEqual(toasts, ['Настройки функций применены']);
});

test('failed runtime save reloads authoritative state after releasing stale panel data', async () => {
  const state = createState({
    runtimeControlsAdmin: {
      available: true,
      schemaReady: true,
      controls: { revision: 8 },
      history: [],
    },
  });
  const elements = createElements();
  const calls = [];
  const toasts = [];

  const { module } = createModule({
    state,
    elements,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (options?.method === 'PATCH') {
        const error = new Error('revision conflict');
        error.status = 409;
        throw error;
      }
      return {
        available: true,
        schemaReady: true,
        historyReady: true,
        controls: {
          revision: 10,
          maintenanceMode: false,
          analysisEnabled: true,
          searchEnabled: true,
          liveEnabled: true,
          remindersEnabled: true,
          expandedDataEnabled: true,
          autoSettlementRecoveryEnabled: false,
        },
        history: [],
      };
    },
    toast: message => toasts.push(message),
  });

  await assert.doesNotReject(() => module.saveRuntimeControls({
    expectedRevision: 8,
    maintenanceMode: false,
    analysisEnabled: true,
    searchEnabled: false,
    liveEnabled: true,
    remindersEnabled: true,
    expandedDataEnabled: true,
    autoSettlementRecoveryEnabled: false,
    message: '',
    reason: 'test conflict',
    action: 'update',
  }, { skipConfirm: true }));

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(calls[1], {
    path: '/api/runtime-controls?refresh=1',
    options: {
      retry: false,
      dedupe: false,
      timeoutMs: 12000,
    },
  });
  assert.deepEqual(toasts, ['revision conflict']);
  assert.equal(state.runtimeControlsSaving, false);
  assert.equal(state.runtimeControlsLoading, false);
  assert.equal(state.runtimeControlsAdmin.controls.revision, 10);
});

test('defaults restore emits safe defaults through the same PATCH mutation contract', async () => {
  const state = createState({
    runtimeControlsAdmin: {
      available: true,
      schemaReady: true,
      controls: {
        revision: 11,
        maintenanceMode: true,
        analysisEnabled: false,
        searchEnabled: false,
        liveEnabled: false,
        remindersEnabled: false,
        expandedDataEnabled: false,
        autoSettlementRecoveryEnabled: true,
      },
      history: [],
    },
  });
  const elements = createElements();
  const calls = [];
  const previousWindow = globalThis.window;
  globalThis.window = { confirm: () => true };

  try {
    const { module } = createModule({
      state,
      elements,
      api: async (requestPath, options) => {
        calls.push({ path: requestPath, options });
        const body = JSON.parse(options.body);
        return {
          controls: {
            ...body,
            revision: 12,
          },
          historyReady: true,
          history: [],
        };
      },
    });

    await module.restoreRuntimeDefaults();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/runtime-controls');
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    expectedRevision: 11,
    maintenanceMode: false,
    analysisEnabled: true,
    searchEnabled: true,
    liveEnabled: true,
    remindersEnabled: true,
    expandedDataEnabled: true,
    autoSettlementRecoveryEnabled: false,
    message: '',
    reason: 'Администратор восстановил безопасные настройки.',
    action: 'defaults',
  });
});
