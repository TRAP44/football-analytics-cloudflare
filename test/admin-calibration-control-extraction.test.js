import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminCalibrationControlModule } from '../public/modules/admin-calibration-control.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const calibration = readFileSync(new URL('../public/modules/admin-calibration-control.js', import.meta.url), 'utf8');

function element() {
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
    ['calibrationControlStatus', element()],
    ['calibrationControlSummary', element()],
    ['calibrationControlHistory', element()],
    ['calibrationFreezeBtn', element()],
    ['calibrationUnfreezeBtn', element()],
    ['calibrationRollbackBtn', element()],
    ['calibrationControlReason', element()],
  ]);
}

test('calibration control implementation lives outside app without capturing remediation', () => {
  assert.match(calibration, /export function createAdminCalibrationControlModule/);
  assert.match(calibration, /function calibrationTransitionLabel\(action\)/);
  assert.match(calibration, /function renderCalibrationControl\(\)/);
  assert.match(calibration, /async function loadCalibrationControl\(force = false\)/);
  assert.match(calibration, /async function runCalibrationControlAction\(action\)/);
  assert.doesNotMatch(app, /function calibrationTransitionLabel\(action\)/);
  assert.doesNotMatch(app, /Загружаю состояние жизненного цикла/);

  assert.match(app, /function renderModelRemediation\(\)/);
  assert.match(app, /async function runModelRemediation\(\)/);
  assert.match(app, /async function resolveSettlementDriftFromUi\(fixtureId, action\)/);
  assert.match(app, /async function resetSettlementCircuitFromUi\(\)/);
  assert.doesNotMatch(calibration, /\/api\/model-remediation|runModelRemediation|resolveSettlementDriftFromUi|resetSettlementCircuitFromUi/);
});

test('app lazy-loads calibration control behind admin gate with explicit callbacks', () => {
  const start = app.indexOf('async function ensureAdminCalibrationControlModule()');
  const end = app.indexOf('\nfunction remediationActionLabel', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-calibration-control\.js'\)/);
  assert.match(boundary, /confirmAction: message => window\.confirm\(message\)/);
  assert.match(boundary, /refreshModelQuality: \(\.\.\.args\) => loadModelQuality\(\.\.\.args\)/);
  assert.match(boundary, /toast/);
});

test('calibration control fails closed for non-admin calls', async () => {
  let apiCalls = 0;
  let confirms = 0;
  let toasts = 0;
  let refreshes = 0;
  const state = {
    calibrationControl: null,
    calibrationControlLoading: false,
    calibrationControlSaving: false,
  };
  const module = createAdminCalibrationControlModule({
    state,
    elementById: () => { throw new Error('DOM must not be touched'); },
    isAdmin: () => false,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: value => String(value ?? ''),
    api: async () => { apiCalls += 1; return {}; },
    toast: () => { toasts += 1; },
    confirmAction: () => { confirms += 1; return true; },
    refreshModelQuality: async () => { refreshes += 1; },
  });

  assert.doesNotThrow(() => module.renderCalibrationControl());
  await module.loadCalibrationControl(true);
  await module.runCalibrationControlAction('freeze');

  assert.equal(apiCalls, 0);
  assert.equal(confirms, 0);
  assert.equal(toasts, 0);
  assert.equal(refreshes, 0);
});

test('calibration loader preserves GET endpoint and loading lifecycle', async () => {
  const elements = createElements();
  const state = {
    calibrationControl: null,
    calibrationControlLoading: false,
    calibrationControlSaving: false,
  };
  const calls = [];
  const module = createAdminCalibrationControlModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin: () => true,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: () => 'только что',
    api: async (path, options) => {
      calls.push({ path, options });
      return {
        available: true,
        frozen: false,
        revision: 7,
        activeFingerprint: 'abcdefghijklmno',
        previousFingerprint: 'previous123456',
        transitions: [],
      };
    },
    toast: () => {},
    confirmAction: () => true,
    refreshModelQuality: async () => {},
  });

  await module.loadCalibrationControl(true);

  assert.deepEqual(calls, [{ path: '/api/calibration-control', options: undefined }]);
  assert.equal(state.calibrationControlLoading, false);
  assert.equal(state.calibrationControl.revision, 7);
  assert.match(elements.get('calibrationControlSummary').innerHTML, /abcdefgh/);
});

test('confirmed calibration action preserves POST contract and refreshes model quality', async () => {
  const elements = createElements();
  elements.get('calibrationControlReason').value = 'planned freeze';
  const state = {
    calibrationControl: {
      available: true,
      frozen: false,
      revision: 4,
      activeFingerprint: 'activefingerprint',
      previousFingerprint: 'previousfingerprint',
      transitions: [],
    },
    calibrationControlLoading: false,
    calibrationControlSaving: false,
  };
  const calls = [];
  const toasts = [];
  const refreshes = [];
  const confirms = [];
  const module = createAdminCalibrationControlModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin: () => true,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: () => 'только что',
    api: async (path, options) => {
      calls.push({ path, options });
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
    confirmAction: message => { confirms.push(message); return true; },
    refreshModelQuality: async force => { refreshes.push(force); },
  });

  await module.runCalibrationControlAction('freeze');

  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /заморозить автоматические переходы/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/calibration-control');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.retry, false);
  assert.equal(calls[0].options.dedupe, false);
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'freeze', reason: 'planned freeze' });
  assert.equal(elements.get('calibrationControlReason').value, '');
  assert.deepEqual(refreshes, [true]);
  assert.deepEqual(toasts, ['Состояние калибровки обновлено атомарно.']);
  assert.equal(state.calibrationControlSaving, false);
  assert.equal(state.calibrationControl.frozen, true);
});

test('cancelled calibration action does not mutate or call API', async () => {
  const elements = createElements();
  elements.get('calibrationControlReason').value = 'do not execute';
  const state = {
    calibrationControl: { available: true, frozen: false, transitions: [] },
    calibrationControlLoading: false,
    calibrationControlSaving: false,
  };
  let apiCalls = 0;
  let refreshes = 0;
  const module = createAdminCalibrationControlModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin: () => true,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: value => String(value ?? ''),
    api: async () => { apiCalls += 1; return {}; },
    toast: () => {},
    confirmAction: () => false,
    refreshModelQuality: async () => { refreshes += 1; },
  });

  await module.runCalibrationControlAction('freeze');

  assert.equal(apiCalls, 0);
  assert.equal(refreshes, 0);
  assert.equal(state.calibrationControlSaving, false);
  assert.equal(elements.get('calibrationControlReason').value, 'do not execute');
});
