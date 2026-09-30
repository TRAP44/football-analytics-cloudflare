import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminModelRemediationViewModule } from '../public/modules/admin-model-remediation-view.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const remediationView = readFileSync(new URL('../public/modules/admin-model-remediation-view.js', import.meta.url), 'utf8');

function element() {
  return {
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
  };
}

function createElements() {
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
  ];
  return new Map(ids.map(id => [id, element()]));
}

test('remediation read-only view lives outside app while destructive actions stay in composition root', () => {
  assert.match(remediationView, /export function createAdminModelRemediationViewModule/);
  assert.match(remediationView, /function remediationActionLabel\(action\)/);
  assert.match(remediationView, /function remediationActionCodeLabel\(value\)/);
  assert.match(remediationView, /function renderModelRemediation\(\)/);
  assert.match(remediationView, /async function loadModelRemediation\(force = false\)/);

  assert.doesNotMatch(app, /function remediationActionLabel\(action\)/);
  assert.doesNotMatch(app, /Сканирую историю прогнозов без внешних запросов/);

  assert.match(app, /async function runModelRemediation\(\)/);
  assert.match(app, /async function resolveSettlementDriftFromUi\(fixtureId, action\)/);
  assert.match(app, /async function resetSettlementCircuitFromUi\(\)/);
  assert.doesNotMatch(remediationView, /method:\s*'POST'|window\.confirm|runModelRemediation|resolveSettlementDriftFromUi|resetSettlementCircuitFromUi/);
});

test('app lazy-loads remediation view behind admin gate with explicit shared dependencies', () => {
  const start = app.indexOf('async function ensureAdminModelRemediationViewModule()');
  const end = app.indexOf('\nasync function runModelRemediation()', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-model-remediation-view\.js'\)/);
  for (const dependency of [
    'state',
    'elementById: $',
    'isAdmin',
    'escapeHtml',
    'humanizeTechnicalText',
    'dateTime',
    'outcomeShortLabel',
    'schemaHint: SUPABASE_SCHEMA_HINT',
    'api',
  ]) assert.ok(boundary.includes(dependency), dependency);
});

test('remediation view fails closed for non-admin render and load', async () => {
  let apiCalls = 0;
  const state = {
    modelRemediation: null,
    modelRemediationLoading: false,
    modelRemediationRunning: false,
  };
  const module = createAdminModelRemediationViewModule({
    state,
    elementById: () => { throw new Error('DOM must not be touched'); },
    isAdmin: () => false,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    outcomeShortLabel: value => String(value ?? ''),
    schemaHint: 'schema hint',
    api: async () => { apiCalls += 1; return {}; },
  });

  assert.doesNotThrow(() => module.renderModelRemediation());
  await module.loadModelRemediation(true);

  assert.equal(apiCalls, 0);
  assert.equal(state.modelRemediation, null);
  assert.equal(state.modelRemediationLoading, false);
});

test('remediation loader preserves safe GET request options and loading lifecycle', async () => {
  const elements = createElements();
  const state = {
    modelRemediation: null,
    modelRemediationLoading: false,
    modelRemediationRunning: false,
  };
  const calls = [];
  const module = createAdminModelRemediationViewModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin: () => true,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    outcomeShortLabel: value => String(value ?? ''),
    schemaHint: 'schema hint',
    api: async (path, options) => {
      calls.push({ path, options });
      return { available: false, reason: 'test remediation snapshot' };
    },
  });

  await module.loadModelRemediation(true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/model-remediation');
  assert.deepEqual(calls[0].options, { retry: false, timeoutMs: 45000, dedupe: false });
  assert.equal(state.modelRemediationLoading, false);
  assert.deepEqual(state.modelRemediation, { available: false, reason: 'test remediation snapshot' });
  assert.equal(elements.get('modelRemediationStatus').textContent, 'test remediation snapshot');
});

test('remediation render preserves action affordance state without executing actions', () => {
  const elements = createElements();
  const state = {
    modelRemediationLoading: false,
    modelRemediationRunning: false,
    modelRemediation: {
      available: true,
      schemaReady: true,
      scan: { loadedRows: 12, truncated: false },
      recovery: {
        stalePending: 2,
        selectedCount: 2,
        maxFixturesPerRun: 20,
        estimatedProviderCalls: 1,
        candidateToken: 'token',
        candidates: [],
      },
      watchdog: {
        autoRecoveryEnabled: true,
        schemaReady: true,
        scheduleUtc: '04:00',
        reliability: {
          schemaReady: true,
          circuitOpen: false,
          consecutiveFailures: 0,
          failureThreshold: 2,
        },
        runLedger: {
          schemaReady: true,
          activeStarted: 0,
          staleStarted: 0,
          maxAttempts: 3,
        },
        finality: {
          schemaReady: true,
          confirmed: 2,
          verified: 0,
          unverified: 0,
          adjudicated: 0,
          drift: 0,
          trustedForMetrics: 2,
        },
      },
      driftReview: { schemaReady: true, unresolved: 0, items: [] },
      recentActions: [],
    },
  };
  const module = createAdminModelRemediationViewModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin: () => true,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    outcomeShortLabel: value => String(value ?? ''),
    schemaHint: 'schema hint',
    api: async () => { throw new Error('render must not call API'); },
  });

  module.renderModelRemediation();

  assert.equal(elements.get('modelRemediation').hidden, false);
  assert.equal(elements.get('modelRemediationRunBtn').disabled, false);
  assert.equal(elements.get('modelRemediationRunBtn').textContent, 'Восстановить ожидающие');
  assert.equal(elements.get('modelRemediationCircuitResetBtn').hidden, true);
  assert.match(elements.get('modelRemediationSummary').innerHTML, /Просканировано/);
});
