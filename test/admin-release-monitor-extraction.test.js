import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminReleaseMonitorModule } from '../public/modules/admin-release-monitor.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createState(overrides = {}) {
  return {
    releaseMonitor: null,
    releaseMonitorLoading: false,
    releaseRegressionResponsePending: false,
    releaseMonitorHours: 24,
    releaseMonitorDigestDays: 7,
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
        value: '',
        querySelectorAll() {
          return [];
        },
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
  toast = () => {},
} = {}) {
  return createAdminReleaseMonitorModule({
    state,
    $: elementById,
    isAdmin,
    escapeHtml: value => String(value ?? ''),
    relativeAge: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    toast,
    api,
  });
}

const app = readRepoFile('public/app.js');
const releaseMonitor = readRepoFile('public/modules/admin-release-monitor.js');
const router = readRepoFile('src/router.js');

test('release monitor implementation stays outside the shared app root', () => {
  assert.match(releaseMonitor, /export function createAdminReleaseMonitorModule/);
  assert.match(releaseMonitor, /function renderReleaseMonitor\(\)/);
  assert.match(releaseMonitor, /async function loadReleaseMonitor\(force = false\)/);
  assert.match(releaseMonitor, /async function transitionPostDeployRegressionResponse/);
  assert.match(releaseMonitor, /if \(!isAdmin\(\)\) return/);

  assert.doesNotMatch(app, /Собираю операционные события/);
  assert.doesNotMatch(app, /postDeployRegression\?\.response/);
});

test('release monitor and regression response routes are admin-only and POST response mutations are replay-protected', () => {
  assert.match(
    router,
    /method === 'GET' && pathname === '\/api\/release-monitor'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?apiReleaseMonitor\(request, cfg\)/,
  );
  assert.match(
    router,
    /if \(pathname === '\/api\/post-deploy-regression-response'\)[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?method === 'POST'[\s\S]*?sensitiveMutation\(\(\)=>apiPostDeployRegressionResponse\(request,cfg,user\)\)/,
  );
});

test('shared app root lazy-loads release monitor only behind admin role', () => {
  assert.match(
    app,
    /async function ensureAdminReleaseMonitorModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-release-monitor\.js'\)/,
  );
  assert.match(
    app,
    /createAdminReleaseMonitorModule\(\{[\s\S]*?state, \$, isAdmin, escapeHtml, relativeAge, humanizeTechnicalText,[\s\S]*?dateTime, toast, api/,
  );
  assert.match(app, /module\?\.loadReleaseMonitor\(\.\.\.args\)/);
  assert.match(app, /module\?\.transitionPostDeployRegressionResponse\(\.\.\.args\)/);
});

test('release monitor fails closed for non-admin render, load and mutation calls', async () => {
  let apiCalls = 0;
  let toastCalls = 0;
  const state = createState();
  const module = createModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be touched');
    },
    isAdmin: () => false,
    api: async () => {
      apiCalls += 1;
      return {};
    },
    toast: () => {
      toastCalls += 1;
    },
  });

  assert.doesNotThrow(() => module.renderReleaseMonitor());
  await module.loadReleaseMonitor(true);
  await module.transitionPostDeployRegressionResponse('acknowledged');

  assert.equal(apiCalls, 0);
  assert.equal(toastCalls, 0);
  assert.deepEqual(state, createState());
});

test('release monitor loader preserves selected windows and refresh request contract', async () => {
  const { elements, elementById } = createElements();
  elementById('releaseMonitorPeriod').value = '48';
  elementById('releaseMonitorDigestPeriod').value = '30';

  const state = createState();
  const calls = [];
  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return { available: false, reason: 'test snapshot' };
    },
  });

  await module.loadReleaseMonitor(true);

  assert.deepEqual(calls, [{
    path: '/api/release-monitor?hours=48&digestDays=30&refresh=1',
    options: {
      retry: false,
      timeoutMs: 12000,
    },
  }]);
  assert.equal(state.releaseMonitorHours, 48);
  assert.equal(state.releaseMonitorDigestDays, 30);
  assert.equal(state.releaseMonitorLoading, false);
  assert.deepEqual(state.releaseMonitor, {
    available: false,
    reason: 'test snapshot',
  });
  assert.equal(elements.get('releaseMonitorBadge').textContent, 'НЕДОСТУПНО');
  assert.equal(elements.get('releaseMonitorStatus').textContent, 'test snapshot');
});

test('release monitor normalizes digest window to 7 days unless 30-day view is selected', async () => {
  const { elementById } = createElements();
  elementById('releaseMonitorPeriod').value = '12';
  elementById('releaseMonitorDigestPeriod').value = '14';
  const calls = [];

  const module = createModule({
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return { available: false, reason: 'snapshot' };
    },
  });

  await module.loadReleaseMonitor(true);

  assert.equal(calls[0].path, '/api/release-monitor?hours=12&digestDays=7&refresh=1');
});

test('release monitor reuses cached state without another request when force is false', async () => {
  const { elementById } = createElements();
  let apiCalls = 0;
  const state = createState({
    releaseMonitor: {
      available: false,
      reason: 'cached failure',
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

  await module.loadReleaseMonitor(false);

  assert.equal(apiCalls, 0);
  assert.equal(elementById('releaseMonitorStatus').textContent, 'cached failure');
  assert.equal(elementById('releaseMonitorBadge').textContent, 'НЕДОСТУПНО');
});

test('release monitor API failure remains visible instead of being rendered as never started', async () => {
  const { elements, elementById } = createElements();
  const state = createState();
  const toasts = [];

  const module = createModule({
    state,
    elementById,
    api: async () => {
      throw new Error('monitor unavailable');
    },
    toast: message => toasts.push(message),
  });

  await assert.doesNotReject(() => module.loadReleaseMonitor(true));

  assert.equal(state.releaseMonitorLoading, false);
  assert.deepEqual(state.releaseMonitor, {
    available: false,
    reason: 'monitor unavailable',
  });
  assert.equal(elements.get('releaseMonitorBadge').textContent, 'НЕДОСТУПНО');
  assert.match(elements.get('releaseMonitorBadge').className, /blocked/);
  assert.equal(elements.get('releaseMonitorStatus').textContent, 'monitor unavailable');
  assert.deepEqual(toasts, ['monitor unavailable']);
});

test('regression response mutation preserves POST contract and refreshes authoritative monitor state', async () => {
  const { elementById } = createElements();
  const state = createState({
    releaseMonitor: {
      available: false,
      reason: 'stale',
      postDeployRegression: {
        response: {
          deploySha: 'a'.repeat(40),
        },
      },
    },
  });
  const calls = [];
  const toasts = [];

  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (requestPath === '/api/post-deploy-regression-response') {
        return { state: 'acknowledged' };
      }
      return { available: false, reason: 'refreshed monitor' };
    },
    toast: message => toasts.push(message),
  });

  await module.transitionPostDeployRegressionResponse('acknowledged');

  assert.deepEqual(calls, [
    {
      path: '/api/post-deploy-regression-response',
      options: {
        method: 'POST',
        body: JSON.stringify({
          state: 'acknowledged',
          deploySha: 'a'.repeat(40),
        }),
        retry: false,
        dedupe: false,
        timeoutMs: 10000,
      },
    },
    {
      path: '/api/release-monitor?hours=24&digestDays=7&refresh=1',
      options: {
        retry: false,
        timeoutMs: 12000,
      },
    },
  ]);
  assert.deepEqual(toasts, ['Инцидент подтверждён.']);
  assert.equal(state.releaseRegressionResponsePending, false);
  assert.deepEqual(state.releaseMonitor, {
    available: false,
    reason: 'refreshed monitor',
  });
});

test('409 regression response conflict reloads authoritative monitor state and clears pending flag', async () => {
  const { elementById } = createElements();
  const state = createState({
    releaseMonitor: {
      available: false,
      reason: 'stale',
      postDeployRegression: {
        response: {
          deploySha: 'a'.repeat(40),
        },
      },
    },
  });
  const calls = [];
  const toasts = [];

  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (requestPath === '/api/post-deploy-regression-response') {
        const error = new Error('response conflict');
        error.status = 409;
        throw error;
      }
      return { available: false, reason: 'authoritative monitor' };
    },
    toast: message => toasts.push(message),
  });

  await assert.doesNotReject(() => module.transitionPostDeployRegressionResponse('investigating'));

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].path, '/api/release-monitor?hours=24&digestDays=7&refresh=1');
  assert.deepEqual(toasts, ['response conflict']);
  assert.equal(state.releaseRegressionResponsePending, false);
  assert.deepEqual(state.releaseMonitor, {
    available: false,
    reason: 'authoritative monitor',
  });
});
