import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminModelQualityModule } from '../public/modules/admin-model-quality.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createElement() {
  return {
    textContent: '',
    innerHTML: '',
    hidden: false,
    value: '',
    classList: {
      toggle() {},
    },
  };
}

function createElements() {
  const elements = new Map();
  for (const id of [
    'modelQualityStatus',
    'modelQualitySampleBadge',
    'modelQualityHeadline',
    'modelQualityCalibration',
    'modelQualityEngine',
    'modelQualityConfidence',
    'modelQualitySecondary',
    'modelQualityDashboard',
    'modelQualityRecent',
    'modelQualityPeriod',
  ]) {
    elements.set(id, createElement());
  }
  return {
    elements,
    elementById: id => elements.get(id) || null,
  };
}

function createState(overrides = {}) {
  return {
    modelQuality: null,
    modelQualityLoading: false,
    modelQualityDays: 90,
    ...overrides,
  };
}

function createModule({
  state = createState(),
  elementById,
  isAdmin = () => true,
  api = async () => ({}),
} = {}) {
  return createAdminModelQualityModule({
    state,
    elementById,
    isAdmin,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    technicalStateLabel: value => String(value ?? ''),
    russianCountLabel: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    outcomeShortLabel: value => String(value ?? ''),
    api,
  });
}

const app = readRepoFile('public/app.js');
const modelQuality = readRepoFile('public/modules/admin-model-quality.js');
const remediation = readRepoFile('public/modules/admin-model-remediation.js');
const router = readRepoFile('src/router.js');

test('model quality read-only implementation stays outside the shared app root', () => {
  assert.match(modelQuality, /export function createAdminModelQualityModule/);
  assert.match(modelQuality, /function qualityPct\(value\)/);
  assert.match(modelQuality, /function qualityNum\(value, digits = 3\)/);
  assert.match(modelQuality, /function signalLabel\(name\)/);
  assert.match(modelQuality, /function renderModelQuality\(\)/);
  assert.match(modelQuality, /async function loadModelQuality\(force = false\)/);
  assert.match(modelQuality, /if \(!isAdmin\(\)\) return/);

  assert.doesNotMatch(app, /function qualityPct\(value\)/);
  assert.doesNotMatch(app, /Калибратор вероятностей/);
});

test('model quality route and lazy-loaded UI are both protected by admin gates', () => {
  assert.match(
    router,
    /method === 'GET' && pathname === '\/api\/model-quality'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?apiModelQuality\(request, cfg\)/,
  );
  assert.match(
    app,
    /async function ensureAdminModelQualityModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-model-quality\.js'\)/,
  );
  assert.match(
    app,
    /createAdminModelQualityModule\(\{[\s\S]*?state,[\s\S]*?elementById: \$,[\s\S]*?isAdmin,[\s\S]*?escapeHtml,[\s\S]*?humanizeTechnicalText,[\s\S]*?technicalStateLabel,[\s\S]*?russianCountLabel,[\s\S]*?dateTime,[\s\S]*?outcomeShortLabel,[\s\S]*?api,/,
  );
});

test('model quality stays isolated from destructive remediation and calibration actions', () => {
  assert.match(app, /function outcomeShortLabel\(key\)/);
  assert.match(remediation, /async function runModelRemediation\(\)/);
  assert.match(remediation, /async function resolveSettlementDriftFromUi\(fixtureId, action\)/);
  assert.match(remediation, /async function resetSettlementCircuitFromUi\(\)/);

  assert.doesNotMatch(
    modelQuality,
    /runCalibrationControlAction|runModelRemediation|resolveSettlementDriftFromUi|resetSettlementCircuitFromUi/,
  );
  assert.doesNotMatch(
    modelQuality,
    /\/api\/calibration-control|\/api\/model-remediation|method:\s*'POST'|window\.confirm|toast\(/,
  );
});

test('model quality fails closed for non-admin render and load calls without DOM or API work', async () => {
  let apiCalls = 0;
  const state = createState();
  const module = createModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be read for non-admin model quality');
    },
    isAdmin: () => false,
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  assert.doesNotThrow(() => module.renderModelQuality());
  await module.loadModelQuality(true);

  assert.equal(apiCalls, 0);
  assert.deepEqual(state, createState());
});

test('model quality loader preserves period, refresh endpoint and unavailable rendering', async () => {
  const { elements, elementById } = createElements();
  elements.get('modelQualityPeriod').value = '30';

  const state = createState();
  const calls = [];
  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return { available: false, reason: 'test snapshot', periodDays: 30 };
    },
  });

  await module.loadModelQuality(true);

  assert.deepEqual(calls, [{
    path: '/api/model-quality?days=30&refresh=1',
    options: undefined,
  }]);
  assert.equal(state.modelQualityDays, 30);
  assert.equal(state.modelQualityLoading, false);
  assert.deepEqual(state.modelQuality, {
    available: false,
    reason: 'test snapshot',
    periodDays: 30,
  });
  assert.equal(elements.get('modelQualityStatus').textContent, 'test snapshot');
  assert.equal(elements.get('modelQualitySampleBadge').textContent, 'Нужна миграция');
});

test('model quality reuses cached report for the selected period without another request', async () => {
  const { elements, elementById } = createElements();
  elements.get('modelQualityPeriod').value = '30';
  let apiCalls = 0;
  const state = createState({
    modelQualityDays: 30,
    modelQuality: {
      available: false,
      reason: 'cached snapshot',
      periodDays: 30,
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

  await module.loadModelQuality(false);

  assert.equal(apiCalls, 0);
  assert.equal(elements.get('modelQualityStatus').textContent, 'cached snapshot');
  assert.equal(state.modelQualityLoading, false);
});

test('model quality loader converts API failure into safe unavailable state and clears loading', async () => {
  const { elements, elementById } = createElements();
  const state = createState();

  const module = createModule({
    state,
    elementById,
    api: async () => {
      throw new Error('quality unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadModelQuality(true));

  assert.equal(state.modelQualityLoading, false);
  assert.deepEqual(state.modelQuality, {
    available: false,
    reason: 'quality unavailable',
  });
  assert.equal(elements.get('modelQualityStatus').textContent, 'quality unavailable');
  assert.equal(elements.get('modelQualitySampleBadge').textContent, 'Нужна миграция');
});
