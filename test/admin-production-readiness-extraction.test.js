import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminProductionReadinessModule } from '../public/modules/admin-production-readiness.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const productionReadiness = readFileSync(new URL('../public/modules/admin-production-readiness.js', import.meta.url), 'utf8');

test('production readiness implementation lives outside the shared app root', () => {
  assert.match(productionReadiness, /export function createAdminProductionReadinessModule/);
  assert.match(productionReadiness, /function renderProductionReadiness\(\)/);
  assert.match(productionReadiness, /async function loadProductionReadiness\(force = false\)/);
  assert.doesNotMatch(app, /function productionStateLabel/);
  assert.doesNotMatch(app, /Проверяю объединение запросов/);
  assert.doesNotMatch(app, /Быстрые сохранённые данные/);
});

test('shared app root lazy-loads production readiness only for admins', () => {
  const start = app.indexOf('async function ensureAdminProductionReadinessModule()');
  const end = app.indexOf('\nfunction runClientContractSmoke()', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-production-readiness\.js'\)/);
  assert.match(boundary, /renderProductionReadiness/);
  assert.match(boundary, /loadProductionReadiness/);
});

test('production readiness fails closed for non-admin callers without DOM or API work', async () => {
  let apiCalls = 0;
  const state = {
    productionReadiness: null,
    productionReadinessLoading: false,
  };
  const module = createAdminProductionReadinessModule({
    state,
    elementById: () => { throw new Error('DOM must not be read for non-admin callers'); },
    isAdmin: () => false,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    api: async () => { apiCalls += 1; return {}; },
  });

  assert.doesNotThrow(() => module.renderProductionReadiness());
  await module.loadProductionReadiness(true);

  assert.equal(apiCalls, 0);
  assert.equal(state.productionReadiness, null);
  assert.equal(state.productionReadinessLoading, false);
});

test('production readiness loader preserves endpoint and request options', async () => {
  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) elements.set(id, { textContent:'', innerHTML:'', className:'' });
    return elements.get(id);
  };
  const state = {
    productionReadiness: null,
    productionReadinessLoading: false,
  };
  const calls = [];
  const module = createAdminProductionReadinessModule({
    state,
    elementById,
    isAdmin: () => true,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    api: async (path, options) => {
      calls.push({ path, options });
      return {
        status:'ready',
        label:'Production ready',
        score:100,
        checks:[],
        safety:{},
        diagnostics:{},
        policy:{ note:'ok' },
      };
    },
  });

  await module.loadProductionReadiness(true);

  assert.deepEqual(calls.map(x => x.path), ['/api/production-readiness?refresh=1']);
  assert.equal(calls[0].options.retry, false);
  assert.equal(calls[0].options.timeoutMs, 15000);
  assert.equal(state.productionReadinessLoading, false);
  assert.equal(state.productionReadiness.status, 'ready');
  assert.equal(elementById('productionReadinessBadge').textContent, 'ГОТОВО');
  assert.equal(elementById('productionReadinessScore').textContent, '100%');
});
