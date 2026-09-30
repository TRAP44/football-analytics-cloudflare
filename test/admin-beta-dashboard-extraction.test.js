import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminBetaDashboardModule } from '../public/modules/admin-beta-dashboard.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const betaDashboard = readFileSync(new URL('../public/modules/admin-beta-dashboard.js', import.meta.url), 'utf8');
const betaFeedback = readFileSync(new URL('../public/modules/beta-feedback.js', import.meta.url), 'utf8');

test('beta dashboard implementation lives outside the shared app root without capturing feedback lifecycle', () => {
  assert.match(betaDashboard, /export function createAdminBetaDashboardModule/);
  assert.match(betaDashboard, /function renderBetaDashboard\(\)/);
  assert.match(betaDashboard, /async function loadBetaDashboard\(force = false\)/);
  assert.doesNotMatch(app, /Verified normal users/);
  assert.doesNotMatch(app, /function betaTimingLabel/);
  assert.doesNotMatch(betaDashboard, /setBetaFeedbackOpen|submitBetaFeedback|betaFeedbackSending|\/api\/beta-feedback/);
  assert.match(betaFeedback, /function setBetaFeedbackOpen\(open\)/);
  assert.match(betaFeedback, /async function submitBetaFeedback\(\)/);
  assert.doesNotMatch(app, /const category=String\(\$\('betaFeedbackCategory'\)/);
});

test('shared app root lazy-loads beta dashboard only for admins', () => {
  const start = app.indexOf('async function ensureAdminBetaDashboardModule()');
  const end = app.indexOf('\nlet betaFeedbackModule', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-beta-dashboard\.js'\)/);
  assert.match(boundary, /elementById: \$/);
  assert.match(boundary, /renderBetaDashboard/);
  assert.match(boundary, /loadBetaDashboard/);
});

test('beta dashboard fails closed for non-admin callers without touching DOM or API', async () => {
  let apiCalls = 0;
  const state = {
    betaDashboard: null,
    betaDashboardLoading: false,
    betaDashboardDays: 7,
  };
  const module = createAdminBetaDashboardModule({
    state,
    elementById: () => { throw new Error('DOM must not be read for non-admin callers'); },
    isAdmin: () => false,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: value => String(value ?? ''),
    api: async () => { apiCalls += 1; return {}; },
  });

  assert.doesNotThrow(() => module.renderBetaDashboard());
  await module.loadBetaDashboard(true);

  assert.equal(apiCalls, 0);
  assert.equal(state.betaDashboard, null);
  assert.equal(state.betaDashboardLoading, false);
});

test('admin beta dashboard loader uses the existing Phase 5 endpoint and restores loading state', async () => {
  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) elements.set(id, { textContent:'', innerHTML:'', className:'', hidden:false });
    return elements.get(id);
  };
  const state = {
    betaDashboard: null,
    betaDashboardLoading: false,
    betaDashboardDays: 14,
  };
  const calls = [];
  const module = createAdminBetaDashboardModule({
    state,
    elementById,
    isAdmin: () => true,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: value => String(value ?? ''),
    api: async (path, options) => {
      calls.push({ path, options });
      return { available:false, reason:'test snapshot' };
    },
  });

  await module.loadBetaDashboard(true);

  assert.deepEqual(calls.map(x => x.path), ['/api/phase5-dashboard?days=14']);
  assert.equal(calls[0].options.timeoutMs, 10000);
  assert.equal(calls[0].options.retry, false);
  assert.equal(calls[0].options.dedupe, false);
  assert.equal(state.betaDashboardLoading, false);
  assert.deepEqual(state.betaDashboard, { available:false, reason:'test snapshot' });
  assert.equal(elementById('betaHealthBadge').textContent, 'НЕТ ДАННЫХ');
});
