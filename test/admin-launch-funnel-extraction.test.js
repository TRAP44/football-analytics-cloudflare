import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminLaunchFunnelModule } from '../public/modules/admin-launch-funnel.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createState(overrides = {}) {
  return {
    launchFunnel: null,
    launchFunnelLoading: false,
    launchFunnelDays: 7,
    recoveryIncidentAckPending: new Set(),
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
        value: '',
        hidden: false,
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
  return createAdminLaunchFunnelModule({
    state,
    $: elementById,
    isAdmin,
    escapeHtml: value => String(value ?? ''),
    api,
    toast,
    dateTime: value => String(value ?? ''),
  });
}

const app = readRepoFile('public/app.js');
const launchFunnel = readRepoFile('public/modules/admin-launch-funnel.js');
const router = readRepoFile('src/router.js');

test('launch funnel implementation stays outside the shared app root', () => {
  assert.match(launchFunnel, /export function createAdminLaunchFunnelModule/);
  assert.match(launchFunnel, /function renderLaunchFunnel\(\)/);
  assert.match(launchFunnel, /async function acknowledgeRecoveryIncident/);
  assert.match(launchFunnel, /async function loadLaunchFunnel\(force=false\)/);
  assert.match(launchFunnel, /if \(!isAdmin\(\)/);

  assert.doesNotMatch(app, /Собираю first-party воронку/);
  assert.doesNotMatch(app, /newsImpactRecoveryIncidentSloBreachImpactRanking/);
});

test('launch funnel and recovery acknowledgement routes are admin-only and mutations are replay-protected', () => {
  assert.match(
    router,
    /method === 'GET' && pathname === '\/api\/launch-funnel'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?apiLaunchFunnel\(request, cfg\)/,
  );
  assert.match(
    router,
    /if \(pathname === '\/api\/recovery-incident-ack'\)[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?method === 'POST'[\s\S]*?sensitiveMutation\(\(\)=>apiNewsImpactRecoveryIncidentAck\(request,cfg,user\)\)/,
  );
});

test('shared app root lazy-loads launch funnel only behind admin role', () => {
  assert.match(
    app,
    /async function ensureAdminLaunchFunnelModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-launch-funnel\.js'\)/,
  );
  assert.match(
    app,
    /createAdminLaunchFunnelModule\(\{[\s\S]*?state, \$, isAdmin, escapeHtml, api, toast, dateTime/,
  );
  assert.match(app, /module\?\.acknowledgeRecoveryIncident\(\.\.\.args\)/);
  assert.match(app, /module\?\.loadLaunchFunnel\(\.\.\.args\)/);
});

test('admin launch funnel module fails closed for non-admin callers', async () => {
  let apiCalls = 0;
  const state = createState();
  const module = createModule({
    state,
    elementById: () => {
      throw new Error('DOM lookup must not run for non-admin callers');
    },
    isAdmin: () => false,
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  assert.doesNotThrow(() => module.renderLaunchFunnel());
  await module.loadLaunchFunnel(true);
  await module.acknowledgeRecoveryIncident({
    reason: 'delivery_failed',
    action: 'recheck',
    code: 'test',
    lastSeenAt: '2026-10-06T20:00:00Z',
  });

  assert.equal(apiCalls, 0);
  assert.equal(state.launchFunnel, null);
  assert.equal(state.launchFunnelLoading, false);
  assert.equal(state.recoveryIncidentAckPending.size, 0);
});

test('launch funnel loader preserves period, request options and loading lifecycle', async () => {
  const { elements, elementById } = createElements();
  elementById('launchFunnelPeriod').value = '14';
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

  await module.loadLaunchFunnel(true);

  assert.deepEqual(calls, [{
    path: '/api/launch-funnel?days=14',
    options: { retry: false, timeoutMs: 10000 },
  }]);
  assert.equal(state.launchFunnelDays, 14);
  assert.equal(state.launchFunnelLoading, false);
  assert.deepEqual(state.launchFunnel, {
    available: false,
    reason: 'test snapshot',
  });
  assert.equal(elementById('launchFunnelStatus').textContent, 'test snapshot');
});

test('cached launch funnel is rendered without another request unless force is true', async () => {
  const { elementById } = createElements();
  let apiCalls = 0;
  const state = createState({
    launchFunnel: { available: false, reason: 'cached snapshot' },
  });

  const module = createModule({
    state,
    elementById,
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  await module.loadLaunchFunnel(false);

  assert.equal(apiCalls, 0);
  assert.equal(elementById('launchFunnelStatus').textContent, 'cached snapshot');
});

test('launch funnel loader converts API failure into safe unavailable state', async () => {
  const { elementById } = createElements();
  const toasts = [];
  const state = createState();

  const module = createModule({
    state,
    elementById,
    api: async () => {
      throw new Error('funnel unavailable');
    },
    toast: message => toasts.push(message),
  });

  await assert.doesNotReject(() => module.loadLaunchFunnel(true));

  assert.equal(state.launchFunnelLoading, false);
  assert.deepEqual(state.launchFunnel, {
    available: false,
    reason: 'funnel unavailable',
  });
  assert.deepEqual(toasts, ['funnel unavailable']);
  assert.equal(elementById('launchFunnelStatus').textContent, 'funnel unavailable');
});

test('recovery acknowledgement uses exact mutation contract, refreshes funnel and releases pending lock', async () => {
  const { elementById } = createElements();
  const state = createState({
    launchFunnel: { available: false, reason: 'before acknowledgement' },
  });
  const calls = [];
  const toasts = [];
  const incident = {
    reason: 'delivery_failed',
    action: 'recheck',
    code: 'NEWS_RECOVERY_FAILED',
    lastSeenAt: '2026-10-06T20:00:00Z',
  };

  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (requestPath === '/api/recovery-incident-ack') return { ok: true };
      return { available: false, reason: 'refreshed snapshot' };
    },
    toast: message => toasts.push(message),
  });

  await module.acknowledgeRecoveryIncident(incident);

  assert.deepEqual(calls, [
    {
      path: '/api/recovery-incident-ack',
      options: {
        method: 'POST',
        body: JSON.stringify(incident),
        retry: false,
        dedupe: false,
        timeoutMs: 10000,
      },
    },
    {
      path: '/api/launch-funnel?days=7',
      options: { retry: false, timeoutMs: 10000 },
    },
  ]);
  assert.deepEqual(toasts, ['Инцидент отмечен как просмотренный.']);
  assert.equal(state.recoveryIncidentAckPending.size, 0);
  assert.equal(state.launchFunnelLoading, false);
  assert.deepEqual(state.launchFunnel, {
    available: false,
    reason: 'refreshed snapshot',
  });
});

test('409 acknowledgement conflict refreshes authoritative funnel state and releases pending lock', async () => {
  const { elementById } = createElements();
  const state = createState();
  const calls = [];
  const toasts = [];

  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (requestPath === '/api/recovery-incident-ack') {
        const error = new Error('incident already acknowledged');
        error.status = 409;
        throw error;
      }
      return { available: false, reason: 'authoritative snapshot' };
    },
    toast: message => toasts.push(message),
  });

  await assert.doesNotReject(() => module.acknowledgeRecoveryIncident({
    reason: 'delivery_failed',
    action: 'recheck',
    code: 'NEWS_RECOVERY_FAILED',
    lastSeenAt: '2026-10-06T20:00:00Z',
  }));

  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, '/api/launch-funnel?days=7');
  assert.deepEqual(toasts, ['incident already acknowledged']);
  assert.equal(state.recoveryIncidentAckPending.size, 0);
  assert.deepEqual(state.launchFunnel, {
    available: false,
    reason: 'authoritative snapshot',
  });
});
