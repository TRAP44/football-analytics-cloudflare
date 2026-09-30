import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminModelRemediationModule } from '../public/modules/admin-model-remediation.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const remediation = readFileSync(new URL('../public/modules/admin-model-remediation.js', import.meta.url), 'utf8');

function element() {
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
  const elements = new Map(ids.map(id => [id, element()]));
  elements.get('modelRemediationReason').value = reason;
  return elements;
}

function createModule({
  state,
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

test('model remediation implementation lives outside shared app root', () => {
  assert.match(remediation, /export function createAdminModelRemediationModule/);
  assert.match(remediation, /function renderModelRemediation\(\)/);
  assert.match(remediation, /async function loadModelRemediation\(force = false\)/);
  assert.match(remediation, /async function runModelRemediation\(\)/);
  assert.match(remediation, /async function resolveSettlementDriftFromUi\(fixtureId, action\)/);
  assert.match(remediation, /async function resetSettlementCircuitFromUi\(\)/);
  assert.doesNotMatch(app, /function remediationActionLabel|function remediationActionCodeLabel/);
  assert.doesNotMatch(app, /async function runModelRemediation\(\) \{|async function resolveSettlementDriftFromUi\(fixtureId, action\) \{/);
});

test('app lazy-loads remediation behind admin gate with explicit destructive-action dependencies', () => {
  const start = app.indexOf('async function ensureAdminModelRemediationModule()');
  const end = app.indexOf('\nasync function openProfileView()', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-model-remediation\.js'\)/);
  assert.match(boundary, /confirmAction: message => window\.confirm\(message\)/);
  assert.match(boundary, /loadModelQuality/);
  assert.match(boundary, /outcomeShortLabel/);
  assert.match(boundary, /SUPABASE_SCHEMA_HINT/);
});

test('non-admin remediation fails closed without DOM, API, confirmations or callbacks', async () => {
  const state = {
    modelRemediation: null,
    modelRemediationLoading: false,
    modelRemediationRunning: false,
  };
  let apiCalls = 0;
  let confirms = 0;
  let toasts = 0;
  let refreshes = 0;
  const module = createAdminModelRemediationModule({
    state,
    elementById: () => { throw new Error('DOM must not be touched'); },
    isAdmin: () => false,
    SUPABASE_SCHEMA_HINT: 'schema',
    escapeHtml: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    outcomeShortLabel: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    api: async () => { apiCalls += 1; return {}; },
    toast: () => { toasts += 1; },
    confirmAction: () => { confirms += 1; return true; },
    loadModelQuality: async () => { refreshes += 1; },
  });

  await module.loadModelRemediation(true);
  await module.runModelRemediation();
  await module.resolveSettlementDriftFromUi(1, 'keep_stored');
  await module.resetSettlementCircuitFromUi();

  assert.equal(apiCalls, 0);
  assert.equal(confirms, 0);
  assert.equal(toasts, 0);
  assert.equal(refreshes, 0);
  assert.equal(state.modelRemediation, null);
});

test('remediation dry-run loader preserves GET endpoint and loading lifecycle', async () => {
  const state = {
    modelRemediation: null,
    modelRemediationLoading: false,
    modelRemediationRunning: false,
  };
  const elements = createElements();
  const calls = [];
  const module = createModule({
    state,
    elements,
    api: async (path, options) => {
      calls.push({ path, options });
      return { available: false, reason: 'test snapshot' };
    },
  });

  await module.loadModelRemediation(true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/model-remediation');
  assert.deepEqual(calls[0].options, { retry: false, timeoutMs: 45000, dedupe: false });
  assert.equal(state.modelRemediationLoading, false);
  assert.deepEqual(state.modelRemediation, { available: false, reason: 'test snapshot' });
  assert.equal(elements.get('modelRemediationStatus').textContent, 'test snapshot');
});

test('cancelled recovery does not call API or mutate running state', async () => {
  const state = {
    modelRemediation: {
      schemaReady: true,
      recovery: {
        candidateToken: 'candidate-token',
        fixtureIds: [101, 102],
        selectedCount: 2,
        estimatedProviderCalls: 1,
      },
    },
    modelRemediationLoading: false,
    modelRemediationRunning: false,
  };
  const elements = createElements('planned recovery');
  let apiCalls = 0;
  let refreshes = 0;
  const module = createModule({
    state,
    elements,
    api: async () => { apiCalls += 1; return {}; },
    confirmAction: () => false,
    loadModelQuality: async () => { refreshes += 1; },
  });

  await module.runModelRemediation();

  assert.equal(apiCalls, 0);
  assert.equal(refreshes, 0);
  assert.equal(state.modelRemediationRunning, false);
  assert.equal(elements.get('modelRemediationReason').value, 'planned recovery');
});

test('confirmed recovery preserves POST contract and refreshes model quality', async () => {
  const state = {
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
    modelRemediationLoading: false,
    modelRemediationRunning: false,
  };
  const elements = createElements('planned recovery');
  const calls = [];
  const refreshes = [];
  const module = createModule({
    state,
    elements,
    api: async (path, options) => {
      calls.push({ path, options });
      return {
        report: { available: false, reason: 'after recovery' },
        execution: { status: 'completed', settledCount: 2, skippedCount: 0 },
      };
    },
    loadModelQuality: async force => { refreshes.push(force); },
  });

  await module.runModelRemediation();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/model-remediation');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.timeoutMs, 60000);
  assert.equal(calls[0].options.retry, false);
  assert.equal(calls[0].options.dedupe, false);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: 'recover',
    reason: 'planned recovery',
    candidateToken: 'candidate-token',
    fixtureIds: [101, 102],
  });
  assert.equal(state.modelQuality, null);
  assert.deepEqual(refreshes, [true]);
  assert.equal(elements.get('modelRemediationReason').value, '');
  assert.equal(state.modelRemediationRunning, false);
});

test('drift resolution preserves immutable-ledger POST contract and refreshes quality', async () => {
  const state = {
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
    modelRemediationLoading: false,
    modelRemediationRunning: false,
  };
  const elements = createElements('accept provider correction');
  const calls = [];
  const refreshes = [];
  const module = createModule({
    state,
    elements,
    api: async (path, options) => {
      calls.push({ path, options });
      return { report: { available: false, reason: 'resolved' } };
    },
    loadModelQuality: async force => { refreshes.push(force); },
  });

  await module.resolveSettlementDriftFromUi(77, 'accept_provider');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/model-remediation');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.timeoutMs, 30000);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: 'resolve_drift',
    resolutionAction: 'accept_provider',
    fixtureId: 77,
    eventId: 9,
    resolutionToken: 'resolution-token',
    reason: 'accept provider correction',
  });
  assert.equal(state.modelQuality, null);
  assert.deepEqual(refreshes, [true]);
  assert.equal(state.modelRemediationRunning, false);
});

test('circuit reset preserves explicit confirmation and POST contract', async () => {
  const state = {
    modelRemediation: {
      schemaReady: true,
      watchdog: { reliability: { circuitOpen: true, schemaReady: true } },
    },
    modelRemediationLoading: false,
    modelRemediationRunning: false,
  };
  const elements = createElements('manual circuit reset');
  const calls = [];
  const confirms = [];
  const module = createModule({
    state,
    elements,
    api: async (path, options) => {
      calls.push({ path, options });
      return { report: { available: false, reason: 'circuit reset' } };
    },
    confirmAction: message => { confirms.push(message); return true; },
  });

  await module.resetSettlementCircuitFromUi();

  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /снова разрешить автоматическое восстановление/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/model-remediation');
  assert.equal(calls[0].options.timeoutMs, 20000);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: 'reset_circuit',
    reason: 'manual circuit reset',
  });
  assert.equal(state.modelRemediationRunning, false);
  assert.equal(elements.get('modelRemediationReason').value, '');
});
