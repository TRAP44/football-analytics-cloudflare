import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminProductionReadinessModule } from '../public/modules/admin-production-readiness.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createState(overrides = {}) {
  return {
    productionReadiness: null,
    productionReadinessLoading: false,
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
} = {}) {
  return createAdminProductionReadinessModule({
    state,
    elementById,
    isAdmin,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    api,
  });
}

const app = readRepoFile('public/app.js');
const productionReadiness = readRepoFile('public/modules/admin-production-readiness.js');
const router = readRepoFile('src/router.js');
const readinessRuntime = readRepoFile('src/release-readiness-runtime.js');

test('production readiness implementation stays outside the shared app root', () => {
  assert.match(productionReadiness, /export function createAdminProductionReadinessModule/);
  assert.match(productionReadiness, /function productionStateLabel\(stateValue\)/);
  assert.match(productionReadiness, /function renderProductionReadiness\(\)/);
  assert.match(productionReadiness, /async function loadProductionReadiness\(force = false\)/);
  assert.match(productionReadiness, /if \(!isAdmin\(\)\) return/);

  assert.doesNotMatch(app, /function productionStateLabel/);
  assert.doesNotMatch(app, /Проверяю объединение запросов/);
  assert.doesNotMatch(app, /Быстрые сохранённые данные/);
});

test('production readiness endpoint and lazy-loaded UI are both protected by admin gates', () => {
  assert.match(
    router,
    /method === 'GET' && pathname === '\/api\/production-readiness'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?apiProductionReadiness\(request, cfg\)/,
  );
  assert.match(
    app,
    /async function ensureAdminProductionReadinessModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-production-readiness\.js'\)/,
  );
  assert.match(
    app,
    /createAdminProductionReadinessModule\(\{[\s\S]*?state,[\s\S]*?elementById: \$,[\s\S]*?isAdmin,[\s\S]*?escapeHtml,[\s\S]*?humanizeTechnicalText,[\s\S]*?api,/,
  );
});

test('server readiness status is derived from blocking failures and warnings rather than a hard-coded ready state', () => {
  assert.match(readinessRuntime, /const blockers = checks\.filter\(x => x\.state === 'fail' && x\.blocking\)/);
  assert.match(readinessRuntime, /const warnings = checks\.filter\(x => x\.state === 'warn' \|\| \(x\.state === 'fail' && !x\.blocking\)\)/);
  assert.match(readinessRuntime, /const status = blockers\.length \? 'blocked' : warnings\.length \? 'warning' : 'ready'/);
  assert.match(readinessRuntime, /score: Math\.round\(passed \/ checks\.length \* 100\)/);
});

test('production readiness fails closed for non-admin render and load calls without DOM or API work', async () => {
  let apiCalls = 0;
  const state = createState();
  const module = createModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be read for non-admin callers');
    },
    isAdmin: () => false,
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  assert.doesNotThrow(() => module.renderProductionReadiness());
  await module.loadProductionReadiness(true);

  assert.equal(apiCalls, 0);
  assert.deepEqual(state, createState());
});

test('production readiness loader preserves refresh endpoint and request options', async () => {
  const { elements, elementById } = createElements();
  const state = createState();
  const calls = [];

  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return {
        status: 'ready',
        label: 'Production ready',
        score: 100,
        checks: [],
        safety: {},
        diagnostics: {},
        policy: { note: 'ok' },
      };
    },
  });

  await module.loadProductionReadiness(true);

  assert.deepEqual(calls, [{
    path: '/api/production-readiness?refresh=1',
    options: {
      retry: false,
      timeoutMs: 15000,
    },
  }]);
  assert.equal(state.productionReadinessLoading, false);
  assert.equal(state.productionReadiness.status, 'ready');
  assert.equal(elements.get('productionReadinessBadge').textContent, 'ГОТОВО');
  assert.equal(elements.get('productionReadinessScore').textContent, '100%');
});

test('production readiness reuses cached client state unless a forced refresh is requested', async () => {
  const { elements, elementById } = createElements();
  let apiCalls = 0;
  const state = createState({
    productionReadiness: {
      status: 'warning',
      label: 'Cached warning',
      score: 88,
      checks: [],
      safety: {},
      diagnostics: {},
      policy: {},
    },
  });

  const module = createModule({
    state,
    elementById,
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  await module.loadProductionReadiness(false);

  assert.equal(apiCalls, 0);
  assert.equal(elements.get('productionReadinessStatus').textContent, 'Cached warning');
  assert.equal(elements.get('productionReadinessBadge').textContent, 'ПРОВЕРИТЬ');
  assert.equal(elements.get('productionReadinessScore').textContent, '88%');
});

test('production readiness loader converts API failures into an explicit blocked state', async () => {
  const { elements, elementById } = createElements();
  const state = createState();

  const module = createModule({
    state,
    elementById,
    api: async () => {
      throw new Error('readiness unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadProductionReadiness(true));

  assert.equal(state.productionReadinessLoading, false);
  assert.deepEqual(state.productionReadiness, {
    status: 'blocked',
    label: 'readiness unavailable',
    score: 0,
    checks: [],
    safety: {},
    policy: {},
  });
  assert.equal(elements.get('productionReadinessStatus').textContent, 'readiness unavailable');
  assert.equal(elements.get('productionReadinessBadge').textContent, 'ЗАБЛОКИРОВАНО');
  assert.equal(elements.get('productionReadinessScore').textContent, '0%');
});

test('production readiness renderer preserves blocking and warning semantics for individual checks', () => {
  const { elements, elementById } = createElements();
  const state = createState({
    productionReadiness: {
      status: 'blocked',
      label: 'Проверка заблокирована',
      score: 50,
      checks: [
        {
          state: 'fail',
          label: 'Blocking guard',
          detail: 'must pass',
          blocking: true,
        },
        {
          state: 'warn',
          label: 'Capacity warning',
          detail: 'observe only',
          blocking: false,
        },
      ],
      safety: {},
      diagnostics: {},
      policy: { note: 'policy note' },
    },
  });

  const module = createModule({ state, elementById });
  module.renderProductionReadiness();

  const rendered = elements.get('productionReadinessChecks').innerHTML;
  assert.match(rendered, /production-check fail/);
  assert.match(rendered, /Blocking guard/);
  assert.match(rendered, /обязательно/);
  assert.match(rendered, /production-check warn/);
  assert.match(rendered, /Capacity warning/);
  assert.match(rendered, /защита/);
});
