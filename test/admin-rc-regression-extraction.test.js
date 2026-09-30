import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminRcRegressionModule } from '../public/modules/admin-rc-regression.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const rcRegression = readFileSync(new URL('../public/modules/admin-rc-regression.js', import.meta.url), 'utf8');

function element() {
  return {
    textContent: '',
    innerHTML: '',
    className: '',
    disabled: false,
  };
}

function createElements() {
  return new Map([
    ['rcBadge', element()],
    ['rcStatus', element()],
    ['rcMeta', element()],
    ['rcSummary', element()],
    ['rcGroups', element()],
    ['rcClient', element()],
    ['rcChecks', element()],
    ['rcRunBtn', element()],
  ]);
}

function createModule({
  state,
  elements = createElements(),
  isAdmin = () => true,
  runClientContractSmoke = () => ({ total: 2, passed: 2, failed: 0, checks: [] }),
  api = async () => ({}),
  toast = () => {},
} = {}) {
  return createAdminRcRegressionModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin,
    runClientContractSmoke,
    relativeAge: () => 'только что',
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    api,
    toast,
  });
}

test('RC regression implementation lives outside app while client contract smoke stays in composition root', () => {
  assert.match(rcRegression, /export function createAdminRcRegressionModule/);
  assert.match(rcRegression, /function rcStateText\(status\)/);
  assert.match(rcRegression, /function renderRcRegression\(\)/);
  assert.match(rcRegression, /async function loadRcRegression\(force = true\)/);
  assert.doesNotMatch(app, /function rcStateText\(status\)/);
  assert.doesNotMatch(app, /Запускаю безопасную регрессионную проверку/);
  assert.match(app, /function runClientContractSmoke\(\)/);
  assert.doesNotMatch(rcRegression, /function runClientContractSmoke\(\)/);
  assert.doesNotMatch(rcRegression, /window\.Telegram|document\.querySelector/);
});

test('app lazy-loads RC regression behind admin gate with explicit client smoke callback', () => {
  const start = app.indexOf('async function ensureAdminRcRegressionModule()');
  const end = app.indexOf('\nlet adminRuntimeControlsModule', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-rc-regression\.js'\)/);
  assert.match(boundary, /runClientContractSmoke/);
  assert.match(boundary, /relativeAge/);
  assert.match(boundary, /humanizeTechnicalText/);
  assert.match(boundary, /api/);
  assert.match(boundary, /toast/);
});

test('non-admin RC regression fails closed without DOM, API, smoke or toast work', async () => {
  const state = { rcRegression: null, rcRegressionLoading: false };
  let apiCalls = 0;
  let smokeCalls = 0;
  let toastCalls = 0;
  const module = createAdminRcRegressionModule({
    state,
    elementById: () => { throw new Error('DOM must not be touched'); },
    isAdmin: () => false,
    runClientContractSmoke: () => { smokeCalls += 1; return {}; },
    relativeAge: value => String(value ?? ''),
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    api: async () => { apiCalls += 1; return {}; },
    toast: () => { toastCalls += 1; },
  });

  assert.doesNotThrow(() => module.renderRcRegression());
  await module.loadRcRegression(true);

  assert.equal(apiCalls, 0);
  assert.equal(smokeCalls, 0);
  assert.equal(toastCalls, 0);
  assert.equal(state.rcRegression, null);
  assert.equal(state.rcRegressionLoading, false);
});

test('RC regression loader preserves refresh endpoint, request options and client contract attachment', async () => {
  const state = { rcRegression: null, rcRegressionLoading: false };
  const elements = createElements();
  const calls = [];
  const toasts = [];
  let smokeCalls = 0;
  const module = createModule({
    state,
    elements,
    runClientContractSmoke: () => {
      smokeCalls += 1;
      return { total: 3, passed: 3, failed: 0, checks: [] };
    },
    api: async (path, options) => {
      calls.push({ path, options });
      return {
        status: 'rc_ready',
        label: 'ready',
        score: 100,
        generatedAt: '2026-09-30T10:00:00Z',
        durationMs: 42,
        summary: { total: 1, passed: 1, warnings: 0, blockers: 0 },
        groups: {},
        checks: [],
        policy: {},
      };
    },
    toast: message => toasts.push(message),
  });

  await module.loadRcRegression(true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/rc-regression?refresh=1');
  assert.deepEqual(calls[0].options, { retry: false, timeoutMs: 45000, dedupe: false });
  assert.equal(smokeCalls, 1);
  assert.equal(state.rcRegressionLoading, false);
  assert.equal(state.rcRegression.clientContract.failed, 0);
  assert.deepEqual(toasts, ['Регрессионная проверка RC завершена']);
  assert.equal(elements.get('rcBadge').textContent, 'ГОТОВО');
  assert.match(elements.get('rcClient').innerHTML, /3\/3/);
});

test('cached RC regression render avoids API and keeps existing state', async () => {
  const existing = {
    status: 'rc_with_holds',
    label: 'cached',
    score: 80,
    generatedAt: '2026-09-30T10:00:00Z',
    durationMs: 20,
    summary: { total: 2, passed: 1, warnings: 1, blockers: 0 },
    groups: {},
    checks: [],
    clientContract: { total: 1, passed: 1, failed: 0, checks: [] },
    policy: {},
  };
  const state = { rcRegression: existing, rcRegressionLoading: false };
  let apiCalls = 0;
  let smokeCalls = 0;
  const module = createModule({
    state,
    runClientContractSmoke: () => { smokeCalls += 1; return {}; },
    api: async () => { apiCalls += 1; return {}; },
  });

  await module.loadRcRegression(false);

  assert.equal(apiCalls, 0);
  assert.equal(smokeCalls, 0);
  assert.equal(state.rcRegression, existing);
});

test('RC regression API failure becomes blocked state and still captures client contract smoke', async () => {
  const state = { rcRegression: null, rcRegressionLoading: false };
  const elements = createElements();
  let smokeCalls = 0;
  const module = createModule({
    state,
    elements,
    runClientContractSmoke: () => {
      smokeCalls += 1;
      return { total: 2, passed: 1, failed: 1, checks: [] };
    },
    api: async () => { throw new Error('network unavailable'); },
  });

  await module.loadRcRegression(true);

  assert.equal(smokeCalls, 1);
  assert.equal(state.rcRegressionLoading, false);
  assert.equal(state.rcRegression.status, 'blocked');
  assert.equal(state.rcRegression.label, 'network unavailable');
  assert.equal(state.rcRegression.summary.blockers, 1);
  assert.equal(state.rcRegression.clientContract.failed, 1);
  assert.equal(elements.get('rcBadge').textContent, 'ЗАБЛОКИРОВАНО');
});
