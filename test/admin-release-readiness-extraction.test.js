import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminReleaseReadinessModule } from '../public/modules/admin-release-readiness.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const releaseReadiness = readFileSync(new URL('../public/modules/admin-release-readiness.js', import.meta.url), 'utf8');

test('release readiness implementation lives outside the shared app root', () => {
  assert.match(releaseReadiness, /export function createAdminReleaseReadinessModule/);
  assert.match(releaseReadiness, /function renderReleaseReadiness\(\)/);
  assert.match(releaseReadiness, /async function loadReleaseReadiness\(force = false\)/);
  assert.doesNotMatch(app, /function releaseStateLabel/);
  assert.doesNotMatch(app, /Проверяю обязательные зависимости ядра/);
  assert.doesNotMatch(app, /class="release-check/);
});

test('shared app root lazy-loads release readiness only for admins', () => {
  const start = app.indexOf('async function ensureAdminReleaseReadinessModule()');
  const end = app.indexOf('\nfunction diagPct(', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-release-readiness\.js'\)/);
  assert.match(boundary, /renderReleaseReadiness/);
  assert.match(boundary, /loadReleaseReadiness/);
});

test('release readiness fails closed for non-admin callers without DOM or API work', async () => {
  let apiCalls = 0;
  let providerRenders = 0;
  let diagnosticRenders = 0;
  const state = {
    releaseReadiness: null,
    releaseReadinessLoading: false,
  };
  const module = createAdminReleaseReadinessModule({
    state,
    elementById: () => { throw new Error('DOM must not be read for non-admin callers'); },
    isAdmin: () => false,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: () => 'now',
    api: async () => { apiCalls += 1; return {}; },
    renderProvider: () => { providerRenders += 1; },
    renderDiagnostics: () => { diagnosticRenders += 1; },
  });

  assert.doesNotThrow(() => module.renderReleaseReadiness());
  await module.loadReleaseReadiness(true);

  assert.equal(apiCalls, 0);
  assert.equal(providerRenders, 0);
  assert.equal(diagnosticRenders, 0);
  assert.equal(state.releaseReadiness, null);
  assert.equal(state.releaseReadinessLoading, false);
});

test('release readiness loader preserves endpoint and diagnostic refresh side effects', async () => {
  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) elements.set(id, { textContent:'', innerHTML:'', className:'' });
    return elements.get(id);
  };
  const state = {
    releaseReadiness: null,
    releaseReadinessLoading: false,
    diagnostics: null,
    provider: null,
    providerObservability: { retained: true },
  };
  const calls = [];
  let providerRenders = 0;
  let diagnosticRenders = 0;
  const module = createAdminReleaseReadinessModule({
    state,
    elementById,
    isAdmin: () => true,
    escapeHtml: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    relativeAge: () => 'только что',
    api: async path => {
      calls.push(path);
      return {
        available: true,
        status: 'ready',
        label: 'Release ready',
        score: 100,
        generatedAt: '2026-09-30T10:00:00Z',
        checks: [{ state:'pass', label:'Core', detail:'ok' }],
        diagnostics: {
          provider: { plan:'FREE' },
          providerObservability: { requests: 3 },
        },
      };
    },
    renderProvider: () => { providerRenders += 1; },
    renderDiagnostics: () => { diagnosticRenders += 1; },
  });

  await module.loadReleaseReadiness(true);

  assert.deepEqual(calls, ['/api/release-readiness?refresh=1']);
  assert.equal(state.releaseReadinessLoading, false);
  assert.equal(state.releaseReadiness.status, 'ready');
  assert.deepEqual(state.provider, { plan:'FREE' });
  assert.deepEqual(state.providerObservability, { requests: 3 });
  assert.equal(providerRenders, 1);
  assert.equal(diagnosticRenders, 1);
  assert.equal(elementById('releaseBadge').textContent, 'Готово');
  assert.equal(elementById('releaseMeta').textContent, '100% · только что');
});
