import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminCalibrationControlModule } from '../public/modules/admin-calibration-control.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
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

function createElements() {
  return new Map([
    ['calibrationControlStatus', createElement()],
    ['calibrationControlSummary', createElement()],
    ['calibrationControlHistory', createElement()],
    ['calibrationFreezeBtn', createElement()],
    ['calibrationUnfreezeBtn', createElement()],
    ['calibrationRollbackBtn', createElement()],
    ['calibrationControlReason', createElement()],
  ]);
}

function createState(overrides = {}) {
  return {
    calibrationControl: null,
    calibrationControlLoading: false,
    calibrationControlSaving: false,
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
  refreshModelQuality = async () => {},
} = {}) {
  return {
    state,
    elements,
    module: createAdminCalibrationControlModule({
      state,
      elementById: id => elements.get(id) || null,
      isAdmin,
      escapeHtml: value => String(value ?? ''),
      humanizeTechnicalText: value => String(value ?? ''),
      relativeAge: () => 'только что',
      api,
      toast,
      confirmAction,
      refreshModelQuality,
    }),
  };
}

const app = readRepoFile('public/app.js');
const calibration = readRepoFile('public/modules/admin-calibration-control.js');
const remediation = readRepoFile('public/modules/admin-model-remediation.js');
const router = readRepoFile('src/router.js');

test('calibration control implementation stays isolated from app root and remediation lifecycle', () => {
  assert.match(calibration, /export function createAdminCalibrationControlModule/);
  assert.match(calibration, /function calibrationTransitionLabel\(action\)/);
  assert.match(calibration, /function renderCalibrationControl\(\)/);
  assert.match(calibration, /async function loadCalibrationControl\(force = false\)/);
  assert.match(calibration, /async function runCalibrationControlAction\(action\)/);

  assert.doesNotMatch(app, /function calibrationTransitionLabel\(action\)/);
  assert.doesNotMatch(app, /Загружаю состояние жизненного цикла/);

  assert.match(remediation, /function renderModelRemediation\(\)/);
  assert.match(remediation, /async function runModelRemediation\(\)/);
  assert.match(remediation, /async function resolveSettlementDriftFromUi\(fixtureId, action\)/);
  assert.match(remediation, /async function resetSettlementCircuitFromUi\(\)/);
  assert.doesNotMatch(
    calibration,
    /\/api\/model-remediation|runModelRemediation|resolveSettlementDriftFromUi|resetSettlementCircuitFromUi/,
  );
});

test('calibration route is admin-only and protects mutations against replay', () => {
  assert.match(
    router,
    /if \(pathname === '\/api\/calibration-control'\)[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\)/,
  );
  assert.match(
    router,
    /method === 'GET'[\s\S]*?apiCalibrationControl\(request,cfg,user\)/,
  );
  assert.match(
    router,
    /method === 'POST'[\s\S]*?sensitiveMutation\(\(\)=>apiCalibrationControl\(request,cfg,user\)\)/,
  );
});

test('app lazy-loads calibration control behind admin gate with explicit callbacks', () => {
  assert.match(
    app,
    /async function ensureAdminCalibrationControlModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-calibration-control\.js'\)/,
  );
  assert.match(
    app,
    /createAdminCalibrationControlModule\(\{[\s\S]*?elementById: \$,[\s\S]*?isAdmin,[\s\S]*?api,[\s\S]*?toast,[\s\S]*?confirmAction: message => window\.confirm\(message\),[\s\S]*?refreshModelQuality:/,
  );
});

test('calibration control fails closed for non-admin calls without touching DOM or callbacks', async () => {
  let apiCalls = 0;
  let confirms = 0;
  let toasts = 0;
  let refreshes = 0;
  const state = createState();

  const module = createAdminCalibrationControlModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be touched');
    },
    isAdmin: () => false,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: value => String(value ?? ''),
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
    refreshModelQuality: async () => {
      refreshes += 1;
    },
  });

  assert.doesNotThrow(() => module.renderCalibrationControl());
  await module.loadCalibrationControl(true);
  await module.runCalibrationControlAction('freeze');

  assert.equal(apiCalls, 0);
  assert.equal(confirms, 0);
  assert.equal(toasts, 0);
  assert.equal(refreshes, 0);
  assert.deepEqual(state, createState());
});

test('calibration loader preserves GET contract and restores loading state', async () => {
  const calls = [];
  const { state, elements, module } = createModule({
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return {
        available: true,
        frozen: false,
        revision: 7,
        activeFingerprint: 'abcdefghijklmno',
        previousFingerprint: 'previous123456',
        transitions: [],
      };
    },
  });

  await module.loadCalibrationControl(true);

  assert.deepEqual(calls, [{ path: '/api/calibration-control', options: undefined }]);
  assert.equal(state.calibrationControlLoading, false);
  assert.equal(state.calibrationControl.revision, 7);
  assert.match(elements.get('calibrationControlSummary').innerHTML, /abcdefgh/);
  assert.equal(elements.get('calibrationFreezeBtn').hidden, false);
  assert.equal(elements.get('calibrationUnfreezeBtn').hidden, true);
  assert.equal(elements.get('calibrationRollbackBtn').disabled, false);
});

test('calibration loader converts API failures into a safe unavailable state', async () => {
  const { state, elements, module } = createModule({
    api: async () => {
      throw new Error('lifecycle unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadCalibrationControl(true));

  assert.equal(state.calibrationControlLoading, false);
  assert.deepEqual(state.calibrationControl, {
    available: false,
    reason: 'lifecycle unavailable',
  });
  assert.equal(elements.get('calibrationControlStatus').textContent, 'lifecycle unavailable');
  assert.equal(elements.get('calibrationFreezeBtn').disabled, true);
  assert.equal(elements.get('calibrationRollbackBtn').disabled, true);
});

test('calibration action requires a meaningful reason before confirmation or API mutation', async () => {
  let apiCalls = 0;
  let confirms = 0;
  const toasts = [];
  const { elements, module } = createModule({
    state: createState({
      calibrationControl: {
        available: true,
        frozen: false,
        previousFingerprint: 'previousfingerprint',
        transitions: [],
      },
    }),
    api: async () => {
      apiCalls += 1;
      return {};
    },
    toast: message => toasts.push(message),
    confirmAction: () => {
      confirms += 1;
      return true;
    },
  });

  elements.get('calibrationControlReason').value = 'no';
  await module.runCalibrationControlAction('freeze');

  assert.equal(apiCalls, 0);
  assert.equal(confirms, 0);
  assert.deepEqual(toasts, ['Укажите причину действия — минимум 5 символов.']);
});

test('confirmed calibration action preserves POST contract and refreshes model quality', async () => {
  const calls = [];
  const toasts = [];
  const refreshes = [];
  const confirms = [];
  const state = createState({
    calibrationControl: {
      available: true,
      frozen: false,
      revision: 4,
      activeFingerprint: 'activefingerprint',
      previousFingerprint: 'previousfingerprint',
      transitions: [],
    },
  });

  const { elements, module } = createModule({
    state,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return {
        available: true,
        frozen: true,
        revision: 5,
        activeFingerprint: 'activefingerprint',
        previousFingerprint: 'previousfingerprint',
        transitions: [],
      };
    },
    toast: message => toasts.push(message),
    confirmAction: message => {
      confirms.push(message);
      return true;
    },
    refreshModelQuality: async force => {
      refreshes.push(force);
    },
  });
  elements.get('calibrationControlReason').value = 'planned freeze';

  await module.runCalibrationControlAction('freeze');

  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /заморозить автоматические переходы/);
  assert.deepEqual(calls, [{
    path: '/api/calibration-control',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'freeze', reason: 'planned freeze' }),
      retry: false,
      dedupe: false,
    },
  }]);
  assert.equal(elements.get('calibrationControlReason').value, '');
  assert.deepEqual(refreshes, [true]);
  assert.deepEqual(toasts, ['Состояние калибровки обновлено атомарно.']);
  assert.equal(state.calibrationControlSaving, false);
  assert.equal(state.calibrationControl.frozen, true);
});

test('cancelled calibration action leaves state and reason untouched', async () => {
  let apiCalls = 0;
  let refreshes = 0;
  const state = createState({
    calibrationControl: {
      available: true,
      frozen: false,
      transitions: [],
    },
  });
  const { elements, module } = createModule({
    state,
    api: async () => {
      apiCalls += 1;
      return {};
    },
    confirmAction: () => false,
    refreshModelQuality: async () => {
      refreshes += 1;
    },
  });
  elements.get('calibrationControlReason').value = 'do not execute';

  await module.runCalibrationControlAction('freeze');

  assert.equal(apiCalls, 0);
  assert.equal(refreshes, 0);
  assert.equal(state.calibrationControlSaving, false);
  assert.equal(elements.get('calibrationControlReason').value, 'do not execute');
});

test('failed calibration mutation clears saving state and reloads authoritative server state', async () => {
  const calls = [];
  const toasts = [];
  const state = createState({
    calibrationControl: {
      available: true,
      frozen: false,
      revision: 9,
      activeFingerprint: 'activefingerprint',
      previousFingerprint: 'previousfingerprint',
      transitions: [],
    },
  });

  const { elements, module } = createModule({
    state,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (options?.method === 'POST') throw new Error('revision conflict');
      return {
        available: true,
        frozen: false,
        revision: 10,
        activeFingerprint: 'serverfingerprint',
        previousFingerprint: 'previousfingerprint',
        transitions: [],
      };
    },
    toast: message => toasts.push(message),
  });
  elements.get('calibrationControlReason').value = 'rollback conflict';

  await assert.doesNotReject(() => module.runCalibrationControlAction('manual_rollback'));

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[1], {
    path: '/api/calibration-control',
    options: undefined,
  });
  assert.equal(state.calibrationControlSaving, false);
  assert.equal(state.calibrationControl.revision, 10);
  assert.equal(state.calibrationControl.activeFingerprint, 'serverfingerprint');
  assert.equal(elements.get('calibrationControlReason').value, 'rollback conflict');
  assert.deepEqual(toasts, ['revision conflict']);
});
