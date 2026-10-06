import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminModelRemediationModule } from '../public/modules/admin-model-remediation.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createElement() {
  return {
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    value: '',
  };
}

function createElements(reason = '') {
  const ids = [
    'modelRemediation',
    'modelRemediationStatus',
    'modelRemediationSummary',
    'modelRemediationCandidates',
    'modelRemediationHistory',
    'modelRemediationDriftQueue',
    'modelRemediationDryRunBtn',
    'modelRemediationRunBtn',
    'modelRemediationCircuitResetBtn',
    'modelRemediationReason',
  ];
  const elements = new Map(ids.map(id => [id, createElement()]));
  elements.get('modelRemediationReason').value = reason;
  return elements;
}

function createState(overrides = {}) {
  return {
    modelRemediation: null,
    modelRemediationLoading: false,
    modelRemediationRunning: false,
    ...overrides,
  };
}

function createModule({
  state = createState(),
  elements = createElements(),
  isAdmin = () => true,
  api = async () => ({}),
  toast = () => {},
  confirmAction = () => true,
  loadModelQuality = async () => {},
} = {}) {
  return createAdminModelRemediationModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin,
    SUPABASE_SCHEMA_HINT: 'schema migration required',
    escapeHtml: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    outcomeShortLabel: value => String(value ?? '—'),
    humanizeTechnicalText: value => String(value ?? ''),
    api,
    toast,
    confirmAction,
    loadModelQuality,
  });
}

const app = readRepoFile('public/app.js');
const remediation = readRepoFile('public/modules/admin-model-remediation.js');
const router = readRepoFile('src/router.js');

test('model remediation implementation stays outside shared app root', () => {
  assert.match(remediation, /export function createAdminModelRemediationModule/);
  assert.match(remediation, /function renderModelRemediation\(\)/);
  assert.match(remediation, /async function loadModelRemediation\(force = false\)/);
  assert.match(remediation, /async function runModelRemediation\(\)/);
  assert.match(remediation, /async function resolveSettlementDriftFromUi\(fixtureId, action\)/);
  assert.match(remediation, /async function resetSettlementCircuitFromUi\(\)/);
  assert.match(remediation, /function renderModelRemediation\(\) \{\n\s*if \(!isAdmin\(\)\) return;/);

  assert.doesNotMatch(app, /function remediationActionLabel|function remediationActionCodeLabel/);
  assert.doesNotMatch(
    app,
    /async function runModelRemediation\(\) \{|async function resolveSettlementDriftFromUi\(fixtureId, action\) \{/,
  );
});

test('model remediation route is admin-only and protects POST actions against replay', () => {
  assert.match(
    router,
    /if \(pathname === '\/api\/model-remediation'\)[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\)/,
  );
  assert.match(
    router,
    /method === 'GET'[\s\S]*?apiModelRemediation\(request,cfg,user\)/,
  );
  assert.match(
    router,
    /method === 'POST'[\s\S]*?sensitiveMutation\(\(\)=>apiModelRemediation\(request,cfg,user\)\)/,
  );
});

test('app lazy-loads remediation behind admin gate with explicit destructive-action dependencies', () => {
  assert.match(
    app,
    /async function ensureAdminModelRemediationModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-model-remediation\.js'\)/,
  );
  assert.match(
    app,
    /createAdminModelRemediationModule\(\{[\s\S]*?state,[\s\S]*?elementById: \$,[\s\S]*?isAdmin,[\s\S]*?SUPABASE_SCHEMA_HINT,[\s\S]*?outcomeShortLabel,[\s\S]*?api,[\s\S]*?toast,[\s\S]*?confirmAction: message => window\.confirm\(message\),[\s\S]*?loadModelQuality,/,
  );
});

test('non-admin remediation fails closed for render and actions without DOM, API or callbacks', async () => {
  const state = createState();
  let apiCalls = 0;
  let confirms = 0;
  let toasts = 0;
  let refreshes = 0;

  const module = createAdminModelRemediationModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be touched');
    },
    isAdmin: () => false,
    SUPABASE_SCHEMA_HINT: 'schema',
    escapeHtml: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    outcomeShortLabel: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    api: async () => {
      apiCalls += 1;
      return {};
    },
    toast: () => {
      toasts += 1;
    },
    confirmAction: () => {
      confirms += 1;
      return true;
    },
    loadModelQuality: async () => {
      refreshes += 1;
    },
  });

  assert.doesNotThrow(() => module.renderModelRemediation());
  await module.loadModelRemediation(true);
  await module.runModelRemediation();
  await module.resolveSettlementDriftFromUi(1, 'keep_stored');
  await module.resetSettlementCircuitFromUi();

  assert.equal(apiCalls, 0);
  assert.equal(confirms, 0);
  assert.equal(toasts, 0);
  assert.equal(refreshes, 0);
  assert.deepEqual(state, createState());
});

test('remediation dry-run loader preserves GET contract and loading lifecycle', async () => {
  const state = createState();
  const elements = createElements();
  const calls = [];
  const module = createModule({
    state,
    elements,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return { available: false, reason: 'test snapshot' };
    },
  });

  await module.loadModelRemediation(true);

  assert.deepEqual(calls, [{
    path: '/api/model-remediation',
    options: { retry: false, timeoutMs: 45000, dedupe: false },
  }]);
  assert.equal(state.modelRemediationLoading, false);
  assert.deepEqual(state.modelRemediation, {
    available: false,
    reason: 'test snapshot',
  });
  assert.equal(elements.get('modelRemediationStatus').textContent, 'test snapshot');
});

test('remediation loader converts API failure into safe unavailable state', async () => {
  const state = createState();
  const elements = createElements();
  const module = createModule({
    state,
    elements,
    api: async () => {
      throw new Error('scan unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadModelRemediation(true));

  assert.equal(state.modelRemediationLoading, false);
  assert.deepEqual(state.modelRemediation, {
    available: false,
    reason: 'scan unavailable',
  });
  assert.equal(elements.get('modelRemediationStatus').textContent, 'scan unavailable');
});

test('recovery requires current candidates and explicit confirmation before mutation', async () => {
  const state = createState({
    modelRemediation: {
      schemaReady: true,
      recovery: {
        candidateToken: 'candidate-token',
        fixtureIds: [101, 102],
        selectedCount: 2,
        estimatedProviderCalls: 1,
      },
    },
  });
  const elements = createElements('planned recovery');
  let apiCalls = 0;
  let refreshes = 0;

  const module = createModule({
    state,
    elements,
    api: async () => {
      apiCalls += 1;
      return {};
    },
    confirmAction: () => false,
    loadModelQuality: async () => {
      refreshes += 1;
    },
  });

  await module.runModelRemediation();

  assert.equal(apiCalls, 0);
  assert.equal(refreshes, 0);
  assert.equal(state.modelRemediationRunning, false);
  assert.equal(elements.get('modelRemediationReason').value, 'planned recovery');
});

test('confirmed recovery preserves POST contract and refreshes model quality', async () => {
  const state = createState({
    modelQuality: { stale: true },
    modelRemediation: {
      schemaReady: true,
      recovery: {
        candidateToken: 'candidate-token',
        fixtureIds: [101, 102],
        selectedCount: 2,
        estimatedProviderCalls: 1,
      },
    },
  });
  const elements = createElements('planned recovery');
  const calls = [];
  const refreshes = [];

  const module = createModule({
    state,
    elements,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return {
        report: { available: false, reason: 'after recovery' },
        execution: { status: 'completed', settledCount: 2, skippedCount: 0 },
      };
    },
    loadModelQuality: async force => {
      refreshes.push(force);
    },
  });

  await module.runModelRemediation();

  assert.deepEqual(calls, [{
    path: '/api/model-remediation',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'recover',
        reason: 'planned recovery',
        candidateToken: 'candidate-token',
        fixtureIds: [101, 102],
      }),
      retry: false,
      timeoutMs: 60000,
      dedupe: false,
    },
  }]);
  assert.equal(state.modelQuality, null);
  assert.deepEqual(refreshes, [true]);
  assert.equal(elements.get('modelRemediationReason').value, '');
  assert.equal(state.modelRemediationRunning, false);
});

test('drift resolution preserves immutable-ledger POST contract and refreshes quality', async () => {
  const state = createState({
    modelQuality: { stale: true },
    modelRemediation: {
      schemaReady: true,
      driftReview: {
        items: [{
          fixtureId: 77,
          eventId: 9,
          resolutionToken: 'resolution-token',
          providerAcceptable: true,
          stored: {},
          provider: {},
        }],
      },
    },
  });
  const elements = createElements('accept provider correction');
  const calls = [];
  const refreshes = [];

  const module = createModule({
    state,
    elements,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return { report: { available: false, reason: 'resolved' } };
    },
    loadModelQuality: async force => {
      refreshes.push(force);
    },
  });

  await module.resolveSettlementDriftFromUi(77, 'accept_provider');

  assert.deepEqual(calls, [{
    path: '/api/model-remediation',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve_drift',
        resolutionAction: 'accept_provider',
        fixtureId: 77,
        eventId: 9,
        resolutionToken: 'resolution-token',
        reason: 'accept provider correction',
      }),
      retry: false,
      timeoutMs: 30000,
      dedupe: false,
    },
  }]);
  assert.equal(state.modelQuality, null);
  assert.deepEqual(refreshes, [true]);
  assert.equal(state.modelRemediationRunning, false);
});

test('failed drift resolution clears running state before reloading authoritative report', async () => {
  const state = createState({
    modelRemediation: {
      schemaReady: true,
      driftReview: {
        items: [{
          fixtureId: 77,
          eventId: 9,
          resolutionToken: 'resolution-token',
          providerAcceptable: true,
          stored: {},
          provider: {},
        }],
      },
    },
  });
  const elements = createElements('accept provider correction');
  const calls = [];
  const toasts = [];

  const module = createModule({
    state,
    elements,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (options?.method === 'POST') throw new Error('resolution conflict');
      return { available: false, reason: 'authoritative report' };
    },
    toast: message => toasts.push(message),
  });

  await assert.doesNotReject(() => module.resolveSettlementDriftFromUi(77, 'accept_provider'));

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[1], {
    path: '/api/model-remediation',
    options: { retry: false, timeoutMs: 45000, dedupe: false },
  });
  assert.equal(state.modelRemediationRunning, false);
  assert.deepEqual(state.modelRemediation, {
    available: false,
    reason: 'authoritative report',
  });
  assert.deepEqual(toasts, ['resolution conflict']);
});

test('circuit reset preserves explicit confirmation and POST contract', async () => {
  const state = createState({
    modelRemediation: {
      schemaReady: true,
      watchdog: {
        reliability: {
          circuitOpen: true,
          schemaReady: true,
        },
      },
    },
  });
  const elements = createElements('manual circuit reset');
  const calls = [];
  const confirms = [];

  const module = createModule({
    state,
    elements,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return { report: { available: false, reason: 'circuit reset' } };
    },
    confirmAction: message => {
      confirms.push(message);
      return true;
    },
  });

  await module.resetSettlementCircuitFromUi();

  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /снова разрешить автоматическое восстановление/);
  assert.deepEqual(calls, [{
    path: '/api/model-remediation',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'reset_circuit',
        reason: 'manual circuit reset',
      }),
      retry: false,
      timeoutMs: 20000,
      dedupe: false,
    },
  }]);
  assert.equal(state.modelRemediationRunning, false);
  assert.equal(elements.get('modelRemediationReason').value, '');
});

test('failed circuit reset reloads authoritative report after releasing running guard', async () => {
  const state = createState({
    modelRemediation: {
      watchdog: {
        reliability: {
          circuitOpen: true,
          schemaReady: true,
        },
      },
    },
  });
  const elements = createElements('manual circuit reset');
  const calls = [];
  const toasts = [];

  const module = createModule({
    state,
    elements,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (options?.method === 'POST') throw new Error('reset conflict');
      return { available: false, reason: 'authoritative reset state' };
    },
    toast: message => toasts.push(message),
  });

  await assert.doesNotReject(() => module.resetSettlementCircuitFromUi());

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].path, '/api/model-remediation');
  assert.equal(state.modelRemediationRunning, false);
  assert.deepEqual(state.modelRemediation, {
    available: false,
    reason: 'authoritative reset state',
  });
  assert.deepEqual(toasts, ['reset conflict']);
});
