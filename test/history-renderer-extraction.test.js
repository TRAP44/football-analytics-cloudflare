import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHistoryRenderer } from '../public/modules/history-renderer.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../public/modules/history-renderer.js', import.meta.url), 'utf8');

function makeButton(dataset = {}) {
  return {
    dataset,
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { this.listeners.click?.(); },
  };
}

function makeRoot() {
  return {
    innerHTML: '',
    buttons: [],
    querySelectorAll(selector) {
      return selector === '.history-open' ? this.buttons : [];
    },
  };
}

function createElements(root = makeRoot()) {
  const map = new Map([['history', root]]);
  return {
    map,
    elementById(id) {
      if (!map.has(id)) map.set(id, makeButton());
      return map.get(id);
    },
  };
}

function createRenderer({ state, elements, callbacks = {} }) {
  return createHistoryRenderer({
    state,
    elementById: elements.elementById,
    recoveryCardHtml: ({ title, message, retryId }) => `<div id="${retryId}"><strong>${title}</strong><span>${message}</span></div>`,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    safeUrl: value => String(value ?? ''),
    dateTime: value => `date:${value}`,
    relativeAge: value => `age:${value}`,
    onReloadHistory: callbacks.onReloadHistory,
    onOpenSearch: callbacks.onOpenSearch,
    onOpenHistoryAnalysis: callbacks.onOpenHistoryAnalysis,
  });
}

test('history renderer owns presentation only while history lifecycle stays in app root', () => {
  assert.match(rendererSource, /export function createHistoryRenderer/);
  assert.match(rendererSource, /function renderHistory\(\)/);
  assert.doesNotMatch(rendererSource, /\/api\/history|\/api\/history-analysis|requestMatchCenter|showView\(/);
  assert.match(app, /async function loadHistory\(showLoader = true\)/);
  assert.match(app, /async function openHistoryAnalysis\(fixtureId, btn\)/);
  assert.doesNotMatch(app, /class="history-item"/);
});

test('app lazy-loads history renderer with explicit lifecycle callbacks', () => {
  const start = app.indexOf('async function ensureHistoryRenderer()');
  const end = app.indexOf('\nfunction pct(v)', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /import\('\.\/modules\/history-renderer\.js'\)/);
  assert.match(boundary, /onReloadHistory: force => loadHistory\(force\)/);
  assert.match(boundary, /onOpenSearch: \(\) => showView\('searchView'\)/);
  assert.match(boundary, /onOpenHistoryAnalysis: \(fixtureId, button\) => openHistoryAnalysis\(fixtureId, button\)/);
});

test('history renderer shows initial loading state without callbacks', () => {
  const root = makeRoot();
  const elements = createElements(root);
  const renderer = createRenderer({
    state: { historyLoading: true, historyLoaded: false, historyLoadError: '', history: [] },
    elements,
  });

  renderer.renderHistory();

  assert.match(root.innerHTML, /Загружаю историю/);
});

test('history renderer error state wires retry callback', () => {
  const root = makeRoot();
  const elements = createElements(root);
  const calls = [];
  const renderer = createRenderer({
    state: { historyLoading: false, historyLoaded: false, historyLoadError: 'offline', history: [] },
    elements,
    callbacks: { onReloadHistory: force => calls.push(force) },
  });

  renderer.renderHistory();
  elements.map.get('historyRecoveryRetry').click();

  assert.match(root.innerHTML, /История временно недоступна/);
  assert.deepEqual(calls, [true]);
});

test('empty history preserves search and optional refresh actions', () => {
  const root = makeRoot();
  const elements = createElements(root);
  const calls = [];
  const renderer = createRenderer({
    state: { historyLoading: false, historyLoaded: true, historyLoadError: 'stale', history: [] },
    elements,
    callbacks: {
      onReloadHistory: force => calls.push(['reload', force]),
      onOpenSearch: () => calls.push(['search']),
    },
  });

  renderer.renderHistory();
  elements.map.get('historyEmptyRetry').click();
  elements.map.get('historyEmptyMatches').click();

  assert.match(root.innerHTML, /История пока пуста/);
  assert.match(root.innerHTML, /Обновить историю/);
  assert.deepEqual(calls, [['reload', true], ['search']]);
});

test('history list preserves formatting, escaping and open-analysis callback', () => {
  const root = makeRoot();
  const button = makeButton({ fixture: '77' });
  root.buttons = [button];
  const elements = createElements(root);
  const calls = [];
  const renderer = createRenderer({
    state: {
      historyLoading: false,
      historyLoaded: true,
      historyLoadError: '',
      history: [{
        fixtureId: 77,
        homeName: '<Home>',
        awayName: 'Away',
        homeLogo: 'https://img/home.png',
        awayLogo: '',
        leagueName: 'League',
        fixtureDate: '2026-09-30T10:00:00Z',
        viewedAt: '2026-09-30T11:00:00Z',
        aiSignalLabel: 'Сигнал',
        aiSignalCode: 'skip',
        aiConfidence: 81.6,
      }],
    },
    elements,
    callbacks: { onOpenHistoryAnalysis: (fixtureId, btn) => calls.push([fixtureId, btn]) },
  });

  renderer.renderHistory();
  button.click();

  assert.match(root.innerHTML, /&lt;Home&gt; — Away/);
  assert.match(root.innerHTML, /date:2026-09-30T10:00:00Z/);
  assert.match(root.innerHTML, /age:2026-09-30T11:00:00Z/);
  assert.match(root.innerHTML, /AI · Сигнал · 82\/100/);
  assert.deepEqual(calls, [[77, button]]);
});
