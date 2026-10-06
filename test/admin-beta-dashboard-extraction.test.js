import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminBetaDashboardModule } from '../public/modules/admin-beta-dashboard.js';

function readPublicFile(relativePath) {
  return readFileSync(new URL(`../public/${relativePath}`, import.meta.url), 'utf8');
}

function createElementStore() {
  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: '',
        innerHTML: '',
        className: '',
        hidden: false,
      });
    }
    return elements.get(id);
  };
  return { elements, elementById };
}

function createDashboardModule({
  state,
  elementById,
  isAdmin = () => true,
  api,
}) {
  return createAdminBetaDashboardModule({
    state,
    elementById,
    isAdmin,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: value => String(value ?? ''),
    api,
  });
}

const app = readPublicFile('app.js');
const betaDashboard = readPublicFile('modules/admin-beta-dashboard.js');
const betaFeedback = readPublicFile('modules/beta-feedback.js');

test('beta dashboard implementation stays outside the shared app root and separate from feedback lifecycle', () => {
  assert.match(betaDashboard, /export function createAdminBetaDashboardModule/);
  assert.match(betaDashboard, /function renderBetaDashboard\(\)/);
  assert.match(betaDashboard, /async function loadBetaDashboard\(force = false\)/);

  assert.doesNotMatch(app, /Verified normal users/);
  assert.doesNotMatch(app, /function betaTimingLabel/);
  assert.doesNotMatch(betaDashboard, /setBetaFeedbackOpen|submitBetaFeedback|betaFeedbackSending|\/api\/beta-feedback/);

  assert.match(betaFeedback, /function setBetaFeedbackOpen\(open\)/);
  assert.match(betaFeedback, /async function submitBetaFeedback\(\)/);
  assert.match(betaFeedback, /\/api\/beta-feedback/);
});

test('shared app root lazy-loads beta dashboard only behind the admin guard', () => {
  assert.match(
    app,
    /async function ensureAdminBetaDashboardModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-beta-dashboard\.js'\)/,
  );
  assert.match(app, /createAdminBetaDashboardModule\(\{[\s\S]*?elementById: \$,[\s\S]*?isAdmin,[\s\S]*?api,/);
  assert.match(app, /module\?\.renderBetaDashboard\(\)/);
  assert.match(app, /module\?\.loadBetaDashboard\(\.\.\.args\)/);
});

test('beta dashboard fails closed for non-admin callers without touching DOM or API', async () => {
  let apiCalls = 0;
  const state = {
    betaDashboard: null,
    betaDashboardLoading: false,
    betaDashboardDays: 7,
  };

  const module = createDashboardModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be read for non-admin callers');
    },
    isAdmin: () => false,
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  assert.doesNotThrow(() => module.renderBetaDashboard());
  await module.loadBetaDashboard(true);

  assert.equal(apiCalls, 0);
  assert.deepEqual(state, {
    betaDashboard: null,
    betaDashboardLoading: false,
    betaDashboardDays: 7,
  });
});

test('admin beta dashboard loader uses the Phase 5 endpoint and restores loading state', async () => {
  const { elementById } = createElementStore();
  const state = {
    betaDashboard: null,
    betaDashboardLoading: false,
    betaDashboardDays: 14,
  };
  const calls = [];

  const module = createDashboardModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return { available: false, reason: 'test snapshot' };
    },
  });

  await module.loadBetaDashboard(true);

  assert.deepEqual(calls, [{
    path: '/api/phase5-dashboard?days=14',
    options: { timeoutMs: 10000, retry: false, dedupe: false },
  }]);
  assert.equal(state.betaDashboardLoading, false);
  assert.deepEqual(state.betaDashboard, {
    available: false,
    reason: 'test snapshot',
  });
  assert.equal(elementById('betaHealthBadge').textContent, 'НЕТ ДАННЫХ');
});

test('admin beta dashboard loader converts API failures into a safe unavailable state', async () => {
  const { elementById } = createElementStore();
  const state = {
    betaDashboard: null,
    betaDashboardLoading: false,
    betaDashboardDays: 7,
  };

  const module = createDashboardModule({
    state,
    elementById,
    api: async () => {
      throw new Error('provider unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadBetaDashboard(true));

  assert.equal(state.betaDashboardLoading, false);
  assert.deepEqual(state.betaDashboard, {
    available: false,
    reason: 'provider unavailable',
  });
  assert.equal(elementById('betaHealthBadge').textContent, 'НЕТ ДАННЫХ');
  assert.match(elementById('betaHealthSummary').innerHTML, /provider unavailable/);
});
