import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminRcRegressionModule } from '../public/modules/admin-rc-regression.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createElement() {
  return {
    textContent: '',
    innerHTML: '',
    className: '',
    disabled: false,
  };
}

function createElements() {
  return new Map([
    ['rcBadge', createElement()],
    ['rcStatus', createElement()],
    ['rcMeta', createElement()],
    ['rcSummary', createElement()],
    ['rcGroups', createElement()],
    ['rcClient', createElement()],
    ['rcChecks', createElement()],
    ['rcRunBtn', createElement()],
  ]);
}

function createState(overrides = {}) {
  return {
    rcRegression: null,
    rcRegressionLoading: false,
    ...overrides,
  };
}

function createModule({
  state = createState(),
  elements = createElements(),
  isAdmin = () => true,
  runClientContractSmoke = () => ({ total: 2, passed: 2, failed: 0, checks: [] }),
  api = async () => ({}),
  toast = () => {},
} = {}) {
  return {
    elements,
    module: createAdminRcRegressionModule({
      state,
      elementById: id => elements.get(id) || null,
      isAdmin,
      runClientContractSmoke,
      relativeAge: () => 'только что',
      escapeHtml: value => String(value ?? ''),
      humanizeTechnicalText: value => String(value ?? ''),
      api,
      toast,
    }),
  };
}

const app = readRepoFile('public/app.js');
const rcRegression = readRepoFile('public/modules/admin-rc-regression.js');
const router = readRepoFile('src/router.js');

test('RC regression implementation stays outside app while client contract smoke stays in composition root', () => {
  assert.match(rcRegression, /export function createAdminRcRegressionModule/);
  assert.match(rcRegression, /function rcStateText\(status\)/);
  assert.match(rcRegression, /function renderRcRegression\(\)/);
  assert.match(rcRegression, /async function loadRcRegression\(force = true\)/);
  assert.match(rcRegression, /effectiveStatus = r\.status === 'blocked' \|\| clientFailed > 0 \? 'blocked' : r\.status/);

  assert.doesNotMatch(app, /function rcStateText\(status\)/);
  assert.doesNotMatch(app, /Запускаю безопасную регрессионную проверку/);
  assert.match(app, /function runClientContractSmoke\(\)/);
  assert.doesNotMatch(rcRegression, /function runClientContractSmoke\(\)/);
  assert.doesNotMatch(rcRegression, /window\.Telegram|document\.querySelector/);
});

test('RC regression endpoint and lazy-loaded UI are both protected by admin gates', () => {
  assert.match(
    router,
    /method === 'GET' && pathname === '\/api\/rc-regression'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?apiRcRegression\(request, cfg, user\)/,
  );
  assert.match(
    app,
    /async function ensureAdminRcRegressionModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-rc-regression\.js'\)/,
  );
  assert.match(
    app,
    /createAdminRcRegressionModule\(\{[\s\S]*?state,[\s\S]*?elementById: \$,[\s\S]*?isAdmin,[\s\S]*?runClientContractSmoke,[\s\S]*?relativeAge,[\s\S]*?escapeHtml,[\s\S]*?humanizeTechnicalText,[\s\S]*?api,[\s\S]*?toast,/,
  );
});

test('non-admin RC regression fails closed without DOM, API, smoke or toast work', async () => {
  const state = createState();
  let apiCalls = 0;
  let smokeCalls = 0;
  let toastCalls = 0;

  const module = createAdminRcRegressionModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be touched');
    },
    isAdmin: () => false,
    runClientContractSmoke: () => {
      smokeCalls += 1;
      return {};
    },
    relativeAge: value => String(value ?? ''),
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    api: async () => {
      apiCalls += 1;
      return {};
    },
    toast: () => {
      toastCalls += 1;
    },
  });

  assert.doesNotThrow(() => module.renderRcRegression());
  await module.loadRcRegression(true);

  assert.equal(apiCalls, 0);
  assert.equal(smokeCalls, 0);
  assert.equal(toastCalls, 0);
  assert.deepEqual(state, createState());
});

test('RC regression loader preserves refresh endpoint, request options and client contract attachment', async () => {
  const state = createState();
  const elements = createElements();
  const calls = [];
  const toasts = [];
  let smokeCalls = 0;

  const { module } = createModule({
    state,
    elements,
    runClientContractSmoke: () => {
      smokeCalls += 1;
      return { total: 3, passed: 3, failed: 0, checks: [] };
    },
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
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

  assert.deepEqual(calls, [{
    path: '/api/rc-regression?refresh=1',
    options: {
      retry: false,
      timeoutMs: 45000,
      dedupe: false,
    },
  }]);
  assert.equal(smokeCalls, 1);
  assert.equal(state.rcRegressionLoading, false);
  assert.equal(state.rcRegression.clientContract.failed, 0);
  assert.deepEqual(toasts, ['Регрессионная проверка RC завершена']);
  assert.equal(elements.get('rcBadge').textContent, 'ГОТОВО');
  assert.match(elements.get('rcClient').innerHTML, /3\/3/);
});

test('client contract failure blocks effective RC readiness even when server reports ready', async () => {
  const state = createState();
  const elements = createElements();
  const toasts = [];

  const { module } = createModule({
    state,
    elements,
    runClientContractSmoke: () => ({
      total: 3,
      passed: 2,
      failed: 1,
      checks: [{
        pass: false,
        label: 'Client DOM contract',
        detail: 'missing required node',
      }],
    }),
    api: async () => ({
      status: 'rc_ready',
      label: 'Server checks passed',
      score: 100,
      generatedAt: '2026-09-30T10:00:00Z',
      durationMs: 42,
      summary: { total: 8, passed: 8, warnings: 0, blockers: 0 },
      groups: {},
      checks: [],
      policy: {},
    }),
    toast: message => toasts.push(message),
  });

  await module.loadRcRegression(true);

  assert.equal(state.rcRegression.status, 'rc_ready');
  assert.equal(state.rcRegression.clientContract.failed, 1);
  assert.equal(elements.get('rcBadge').textContent, 'ЗАБЛОКИРОВАНО');
  assert.match(elements.get('rcBadge').className, /blocked/);
  assert.equal(elements.get('rcStatus').textContent, 'Клиентский контракт не пройден: 1 ошибок.');
  assert.match(elements.get('rcClient').innerHTML, /2\/3/);
  assert.deepEqual(toasts, ['Регрессионная проверка RC: есть пункты для проверки']);
});

test('cached RC regression render avoids API and smoke rerun when client result already exists', async () => {
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
  const state = createState({ rcRegression: existing });
  let apiCalls = 0;
  let smokeCalls = 0;

  const { module } = createModule({
    state,
    runClientContractSmoke: () => {
      smokeCalls += 1;
      return {};
    },
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  await module.loadRcRegression(false);

  assert.equal(apiCalls, 0);
  assert.equal(smokeCalls, 0);
  assert.equal(state.rcRegression, existing);
});

test('RC regression API failure becomes blocked state and still captures client contract smoke', async () => {
  const state = createState();
  const elements = createElements();
  let smokeCalls = 0;

  const { module } = createModule({
    state,
    elements,
    runClientContractSmoke: () => {
      smokeCalls += 1;
      return { total: 2, passed: 1, failed: 1, checks: [] };
    },
    api: async () => {
      throw new Error('network unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadRcRegression(true));

  assert.equal(smokeCalls, 1);
  assert.equal(state.rcRegressionLoading, false);
  assert.equal(state.rcRegression.status, 'blocked');
  assert.equal(state.rcRegression.label, 'network unavailable');
  assert.equal(state.rcRegression.summary.blockers, 1);
  assert.equal(state.rcRegression.clientContract.failed, 1);
  assert.equal(elements.get('rcBadge').textContent, 'ЗАБЛОКИРОВАНО');
  assert.match(elements.get('rcBadge').className, /blocked/);
});
