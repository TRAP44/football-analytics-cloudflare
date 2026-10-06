import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminDiagnosticsModule } from '../public/modules/admin-diagnostics.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createState(overrides = {}) {
  return {
    diagnostics: null,
    diagnosticsLoading: false,
    provider: null,
    providerObservability: null,
    clientPerf: {},
    network: { mode: 'online', lastRecoveredAt: null },
    startup: { manifestOk: true },
    appManifest: null,
    ...overrides,
  };
}

function createElements() {
  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: '',
        innerHTML: '',
        hidden: false,
        className: '',
      });
    }
    return elements.get(id);
  };
  return { elements, elementById };
}

function createModule({
  state = createState(),
  elementById,
  isAdmin = () => true,
  api = async () => ({}),
  renderProvider = () => {},
} = {}) {
  return createAdminDiagnosticsModule({
    state,
    $: elementById,
    isAdmin,
    api,
    renderProvider,
    diagnosticsStateLabel: value => String(value || ''),
    relativeAge: value => String(value || ''),
    escapeHtml: value => String(value ?? ''),
    technicalStateLabel: value => String(value || ''),
    planLabel: value => String(value || ''),
    diagPct: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    diagDuration: value => String(value ?? ''),
    CLIENT_VERSION: 'test-client',
    CLIENT_API_CONTRACT: 5,
    CLIENT_RELEASE_CHANNEL: 'test',
    SUPABASE_SCHEMA_HINT: 'schema hint',
  });
}

const app = readRepoFile('public/app.js');
const diagnostics = readRepoFile('public/modules/admin-diagnostics.js');
const router = readRepoFile('src/router.js');

test('admin diagnostics implementation stays outside the shared app root', () => {
  assert.match(diagnostics, /export function createAdminDiagnosticsModule/);
  assert.match(diagnostics, /function renderDiagnostics\(\)/);
  assert.match(diagnostics, /async function loadDiagnostics\(force = false\)/);
  assert.match(diagnostics, /if \(!isAdmin\(\)\) return/);

  assert.doesNotMatch(
    app,
    /function renderDiagnostics\(\) \{\n\s*const root = \$\('diagnosticsStatus'\)/,
  );
  assert.doesNotMatch(
    app,
    /Проверяю сервер, Supabase, сохранённые данные и API-Football/,
  );
});

test('diagnostics route and lazy-loaded UI are both protected by admin gates', () => {
  assert.match(
    router,
    /method === 'GET' && pathname === '\/api\/diagnostics'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?apiDiagnostics\(request, cfg\)/,
  );
  assert.match(
    app,
    /async function ensureAdminDiagnosticsModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-diagnostics\.js'\)/,
  );
  assert.match(
    app,
    /createAdminDiagnosticsModule\(\{[\s\S]*?state, \$, isAdmin, api, renderProvider,[\s\S]*?CLIENT_VERSION, CLIENT_API_CONTRACT, CLIENT_RELEASE_CHANNEL, SUPABASE_SCHEMA_HINT/,
  );
});

test('diagnostics fails closed for non-admin render and load calls without touching DOM or API', async () => {
  let apiCalls = 0;
  const state = createState();
  const module = createModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be touched for non-admin diagnostics');
    },
    isAdmin: () => false,
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  assert.doesNotThrow(() => module.renderDiagnostics());
  await module.loadDiagnostics(true);

  assert.equal(apiCalls, 0);
  assert.equal(state.diagnostics, null);
  assert.equal(state.diagnosticsLoading, false);
});

test('diagnostics loader preserves refresh endpoint and synchronizes provider state', async () => {
  const { elements, elementById } = createElements();
  let providerRenders = 0;
  const calls = [];
  const state = createState();

  const module = createModule({
    state,
    elementById,
    api: async path => {
      calls.push(path);
      return {
        generatedAt: '2026-10-06T20:00:00Z',
        overall: { state: 'ok', label: 'Система в норме' },
        provider: { plan: 'PRO', health: 'ok' },
        providerObservability: { status: 'healthy' },
        recommendations: [],
      };
    },
    renderProvider: () => {
      providerRenders += 1;
    },
  });

  await module.loadDiagnostics(true);

  assert.deepEqual(calls, ['/api/diagnostics?refresh=1']);
  assert.equal(state.diagnosticsLoading, false);
  assert.deepEqual(state.provider, { plan: 'PRO', health: 'ok' });
  assert.deepEqual(state.providerObservability, { status: 'healthy' });
  assert.equal(providerRenders, 1);
  assert.equal(elements.get('diagnosticsStatus').textContent, 'Система в норме');
});

test('diagnostics loader converts API failures into a rendered critical state', async () => {
  const { elements, elementById } = createElements();
  const state = createState();
  const module = createModule({
    state,
    elementById,
    api: async () => {
      throw new Error('diagnostics unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadDiagnostics(false));

  assert.equal(state.diagnosticsLoading, false);
  assert.deepEqual(state.diagnostics, {
    overall: {
      state: 'critical',
      label: 'diagnostics unavailable',
    },
    recommendations: ['Повторите проверку после обновления приложения.'],
  });
  assert.equal(elements.get('diagnosticsStatus').textContent, 'diagnostics unavailable');
  assert.equal(elements.get('diagnosticsBadge').textContent, 'critical');
});
