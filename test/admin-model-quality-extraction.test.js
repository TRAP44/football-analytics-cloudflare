import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminModelQualityModule } from '../public/modules/admin-model-quality.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const modelQuality = readFileSync(new URL('../public/modules/admin-model-quality.js', import.meta.url), 'utf8');

function element() {
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

test('model quality read-only implementation lives outside the shared app root', () => {
  assert.match(modelQuality, /export function createAdminModelQualityModule/);
  assert.match(modelQuality, /function qualityPct\(value\)/);
  assert.match(modelQuality, /function qualityNum\(value, digits = 3\)/);
  assert.match(modelQuality, /function signalLabel\(name\)/);
  assert.match(modelQuality, /function renderModelQuality\(\)/);
  assert.match(modelQuality, /async function loadModelQuality\(force = false\)/);
  assert.doesNotMatch(app, /function qualityPct\(value\)/);
  assert.doesNotMatch(app, /Калибратор вероятностей/);
});

test('shared app root lazy-loads model quality only for admins with explicit dependencies', () => {
  const start = app.indexOf('async function ensureAdminModelQualityModule()');
  const end = app.indexOf('\nlet adminCalibrationControlModule', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-model-quality\.js'\)/);
  for (const dependency of [
    'state',
    'elementById: $',
    'isAdmin',
    'escapeHtml',
    'humanizeTechnicalText',
    'technicalStateLabel',
    'russianCountLabel',
    'dateTime',
    'outcomeShortLabel',
    'api',
  ]) assert.ok(boundary.includes(dependency), dependency);
});

test('remediation-shared and destructive remediation logic stays in app composition root', () => {
  assert.match(app, /function outcomeShortLabel\(key\)/);
  assert.match(app, /function renderModelRemediation\(\)/);
  assert.match(app, /async function runModelRemediation\(\)/);
  assert.match(app, /async function resolveSettlementDriftFromUi\(fixtureId, action\)/);
  assert.match(app, /async function resetSettlementCircuitFromUi\(\)/);
  assert.doesNotMatch(modelQuality, /function outcomeShortLabel|runCalibrationControlAction|runModelRemediation|resolveSettlementDriftFromUi|resetSettlementCircuitFromUi/);
  assert.doesNotMatch(modelQuality, /\/api\/calibration-control|\/api\/model-remediation|method:\s*'POST'|window\.confirm|toast\(/);
});

test('model quality loader fails closed for non-admin callers without DOM or API work', async () => {
  let apiCalls = 0;
  const state = {
    modelQuality: null,
    modelQualityLoading: false,
    modelQualityDays: 90,
  };
  const module = createAdminModelQualityModule({
    state,
    elementById: () => { throw new Error('DOM must not be read for non-admin loader'); },
    isAdmin: () => false,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    technicalStateLabel: value => String(value ?? ''),
    russianCountLabel: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    outcomeShortLabel: value => String(value ?? ''),
    api: async () => { apiCalls += 1; return {}; },
  });

  await module.loadModelQuality(true);

  assert.equal(apiCalls, 0);
  assert.equal(state.modelQuality, null);
  assert.equal(state.modelQualityLoading, false);
});

test('model quality loader preserves period, refresh endpoint and unavailable rendering', async () => {
  const elements = new Map();
  const ids = [
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
  ];
  for (const id of ids) elements.set(id, element());
  elements.get('modelQualityPeriod').value = '30';

  const state = {
    modelQuality: null,
    modelQualityLoading: false,
    modelQualityDays: 90,
  };
  const calls = [];
  const module = createAdminModelQualityModule({
    state,
    elementById: id => elements.get(id) || null,
    isAdmin: () => true,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    technicalStateLabel: value => String(value ?? ''),
    russianCountLabel: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    outcomeShortLabel: value => String(value ?? ''),
    api: async path => {
      calls.push(path);
      return { available: false, reason: 'test snapshot', periodDays: 30 };
    },
  });

  await module.loadModelQuality(true);

  assert.deepEqual(calls, ['/api/model-quality?days=30&refresh=1']);
  assert.equal(state.modelQualityDays, 30);
  assert.equal(state.modelQualityLoading, false);
  assert.deepEqual(state.modelQuality, { available: false, reason: 'test snapshot', periodDays: 30 });
  assert.equal(elements.get('modelQualityStatus').textContent, 'test snapshot');
  assert.equal(elements.get('modelQualitySampleBadge').textContent, 'Нужна миграция');
});
