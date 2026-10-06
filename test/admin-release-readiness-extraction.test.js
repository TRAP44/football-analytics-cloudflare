import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminReleaseReadinessModule } from '../public/modules/admin-release-readiness.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createState(overrides = {}) {
  return {
    releaseReadiness: null,
    releaseReadinessLoading: false,
    diagnostics: null,
    provider: null,
    providerLoaded: false,
    providerObservability: null,
    ...overrides,
  };
}

function createElements() {
  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: '',
        innerHTML: '',
        className: '',
      });
    }
    return elements.get(id);
  };
  return { elements, elementById };
}

function createModule({
  state = createState(),
  elementById,
  isAdmin = () => true,
  api = async () => ({}),
  renderProvider = () => {},
  renderDiagnostics = () => {},
} = {}) {
  return createAdminReleaseReadinessModule({
    state,
    elementById,
    isAdmin,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: () => 'только что',
    api,
    renderProvider,
    renderDiagnostics,
  });
}

const app = readRepoFile('public/app.js');
const releaseReadiness = readRepoFile('public/modules/admin-release-readiness.js');
const router = readRepoFile('src/router.js');
const adminApi = readRepoFile('src/admin-operational-api.js');

test('release readiness implementation stays outside the shared app root', () => {
  assert.match(releaseReadiness, /export function createAdminReleaseReadinessModule/);
  assert.match(releaseReadiness, /function releaseStateLabel\(value\)/);
  assert.match(releaseReadiness, /function renderReleaseReadiness\(\)/);
  assert.match(releaseReadiness, /async function loadReleaseReadiness\(force = false\)/);
  assert.match(releaseReadiness, /if \(!isAdmin\(\)\) return/);

  assert.doesNotMatch(app, /function releaseStateLabel/);
  assert.doesNotMatch(app, /Проверяю обязательные зависимости ядра/);
  assert.doesNotMatch(app, /class="release-check/);
});

test('release readiness endpoint and lazy-loaded UI are both protected by admin gates', () => {
  assert.match(
    router,
    /method === 'GET' && pathname === '\/api\/release-readiness'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?apiReleaseReadiness\(request, cfg\)/,
  );
  assert.match(
    app,
    /async function ensureAdminReleaseReadinessModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-release-readiness\.js'\)/,
  );
  assert.match(
    app,
    /createAdminReleaseReadinessModule\(\{[\s\S]*?state,[\s\S]*?elementById: \$,[\s\S]*?isAdmin,[\s\S]*?escapeHtml,[\s\S]*?humanizeTechnicalText,[\s\S]*?relativeAge,[\s\S]*?api,[\s\S]*?renderProvider,[\s\S]*?renderDiagnostics,/,
  );
});

test('server readiness remains fail-closed when blocking checks fail', () => {
  const start = adminApi.indexOf('async function apiReleaseReadiness');
  assert.ok(start >= 0);
  const end = adminApi.indexOf('async function apiRcRegression', start);
  assert.ok(end > start);
  const boundary = adminApi.slice(start, end);

  assert.match(boundary, /const blockers = checks\.filter\(x => x\.state === 'fail' && x\.blocking\)/);
  assert.match(boundary, /const warnings = checks\.filter\(x => x\.state === 'warn' \|\| \(x\.state === 'fail' && !x\.blocking\)\)/);
  assert.match(boundary, /const status = blockers\.length \? 'blocked' : warnings\.length \? 'warning' : 'ready'/);
  assert.match(boundary, /score = Math\.round\(\(passed \/ checks\.length\) \* 100\)/);
});

test('release readiness fails closed for non-admin render and load calls without DOM, API or callbacks', async () => {
  let apiCalls = 0;
  let providerRenders = 0;
  let diagnosticRenders = 0;
  const state = createState();

  const module = createAdminReleaseReadinessModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be read for non-admin callers');
    },
    isAdmin: () => false,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: () => 'now',
    api: async () => {
      apiCalls += 1;
      return {};
    },
    renderProvider: () => {
      providerRenders += 1;
    },
    renderDiagnostics: () => {
      diagnosticRenders += 1;
    },
  });

  assert.doesNotThrow(() => module.renderReleaseReadiness());
  await module.loadReleaseReadiness(true);

  assert.equal(apiCalls, 0);
  assert.equal(providerRenders, 0);
  assert.equal(diagnosticRenders, 0);
  assert.deepEqual(state, createState());
});

test('release readiness loader preserves refresh endpoint and synchronizes diagnostics/provider state', async () => {
  const { elements, elementById } = createElements();
  const state = createState({
    providerObservability: { retained: true },
  });
  const calls = [];
  let providerRenders = 0;
  let diagnosticRenders = 0;

  const module = createModule({
    state,
    elementById,
    api: async requestPath => {
      calls.push(requestPath);
      return {
        available: true,
        status: 'ready',
        label: 'Release ready',
        score: 100,
        generatedAt: '2026-09-30T10:00:00Z',
        checks: [{
          state: 'pass',
          label: 'Core',
          detail: 'ok',
        }],
        diagnostics: {
          provider: { plan: 'FREE' },
          providerObservability: { requests: 3 },
        },
      };
    },
    renderProvider: () => {
      providerRenders += 1;
    },
    renderDiagnostics: () => {
      diagnosticRenders += 1;
    },
  });

  await module.loadReleaseReadiness(true);

  assert.deepEqual(calls, ['/api/release-readiness?refresh=1']);
  assert.equal(state.releaseReadinessLoading, false);
  assert.equal(state.releaseReadiness.status, 'ready');
  assert.deepEqual(state.provider, { plan: 'FREE' });
  assert.equal(state.providerLoaded, true);
  assert.deepEqual(state.providerObservability, { requests: 3 });
  assert.equal(providerRenders, 1);
  assert.equal(diagnosticRenders, 1);
  assert.equal(elements.get('releaseBadge').textContent, 'Готово');
  assert.equal(elements.get('releaseMeta').textContent, '100% · только что');
});

test('release readiness keeps previous provider observability when readiness diagnostics omit it', async () => {
  const { elementById } = createElements();
  const state = createState({
    providerObservability: { retained: true },
  });

  const module = createModule({
    state,
    elementById,
    api: async () => ({
      available: true,
      status: 'warning',
      label: 'Release warning',
      score: 90,
      generatedAt: '2026-09-30T10:00:00Z',
      checks: [],
      diagnostics: {
        provider: { plan: 'PRO' },
      },
    }),
  });

  await module.loadReleaseReadiness(true);

  assert.deepEqual(state.providerObservability, { retained: true });
  assert.equal(state.providerLoaded, true);
});

test('release readiness reuses cached client state without another request', async () => {
  const { elements, elementById } = createElements();
  let apiCalls = 0;
  let providerRenders = 0;
  let diagnosticRenders = 0;
  const existing = {
    available: true,
    status: 'warning',
    label: 'Cached warning',
    score: 88,
    generatedAt: '2026-09-30T10:00:00Z',
    checks: [],
  };
  const state = createState({
    releaseReadiness: existing,
  });

  const module = createModule({
    state,
    elementById,
    api: async () => {
      apiCalls += 1;
      return {};
    },
    renderProvider: () => {
      providerRenders += 1;
    },
    renderDiagnostics: () => {
      diagnosticRenders += 1;
    },
  });

  await module.loadReleaseReadiness(false);

  assert.equal(apiCalls, 0);
  assert.equal(providerRenders, 0);
  assert.equal(diagnosticRenders, 0);
  assert.equal(state.releaseReadiness, existing);
  assert.equal(elements.get('releaseBadge').textContent, 'Почти готово');
  assert.equal(elements.get('releaseStatus').textContent, 'Cached warning');
});

test('release readiness API failure is rendered as unavailable rather than never started', async () => {
  const { elements, elementById } = createElements();
  const state = createState();

  const module = createModule({
    state,
    elementById,
    api: async () => {
      throw new Error('readiness unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadReleaseReadiness(true));

  assert.equal(state.releaseReadinessLoading, false);
  assert.deepEqual(state.releaseReadiness, {
    available: false,
    reason: 'readiness unavailable',
  });
  assert.equal(elements.get('releaseBadge').textContent, 'Недоступно');
  assert.match(elements.get('releaseBadge').className, /blocked/);
  assert.equal(elements.get('releaseStatus').textContent, 'readiness unavailable');
  assert.equal(
    elements.get('releaseMeta').textContent,
    'Повторите проверку после восстановления административного API.',
  );
});

test('release readiness renderer preserves check severity classes', () => {
  const { elements, elementById } = createElements();
  const state = createState({
    releaseReadiness: {
      available: true,
      status: 'blocked',
      label: 'Есть блокирующие проверки',
      score: 50,
      generatedAt: '2026-09-30T10:00:00Z',
      checks: [
        { state: 'pass', label: 'Pass', detail: 'ok' },
        { state: 'warn', label: 'Warning', detail: 'observe' },
        { state: 'fail', label: 'Failure', detail: 'blocked' },
      ],
    },
  });

  const module = createModule({ state, elementById });
  module.renderReleaseReadiness();

  const rendered = elements.get('releaseChecks').innerHTML;
  assert.match(rendered, /release-check pass/);
  assert.match(rendered, /release-check warn/);
  assert.match(rendered, /release-check fail/);
  assert.equal(elements.get('releaseBadge').textContent, 'Блокировано');
});
