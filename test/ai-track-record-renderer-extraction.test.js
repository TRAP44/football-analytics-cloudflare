import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAiTrackRecordRenderer } from '../public/modules/ai-track-record-renderer.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../public/modules/ai-track-record-renderer.js', import.meta.url), 'utf8');

function element() {
  return {
    innerHTML: '',
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { this.listeners.click?.(); },
  };
}

function createElements() {
  const map = new Map([['aiTrackRecord', element()]]);
  return {
    map,
    elementById(id) {
      if (!map.has(id)) map.set(id, element());
      return map.get(id);
    },
  };
}

function createRenderer({ state, elements, onRetry = () => {} }) {
  return createAiTrackRecordRenderer({
    state,
    elementById: elements.elementById,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    dateTime: value => `date:${value}`,
    onRetry,
  });
}

test('AI track record renderer owns presentation only while loading stays in app root', () => {
  assert.match(rendererSource, /export function createAiTrackRecordRenderer/);
  assert.match(rendererSource, /function renderAiTrackRecord\(\)/);
  assert.doesNotMatch(rendererSource, /\/api\/ai-track-record|\bapi\s*\(|fetch\s*\(/);
  assert.match(app, /async function loadAiTrackRecord\(force = false\)/);
  assert.doesNotMatch(app, /Здесь нет рекламного «процента побед»/);
});

test('app lazy-loads AI track record renderer with explicit retry callback', () => {
  const start = app.indexOf('async function ensureAiTrackRecordRenderer()');
  const end = app.indexOf('\nasync function loadHistory(showLoader = true)', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /import\('\.\/modules\/ai-track-record-renderer\.js'\)/);
  assert.match(boundary, /onRetry: force => loadAiTrackRecord\(force\)/);
  assert.match(boundary, /escapeHtml/);
  assert.match(boundary, /dateTime/);
});

test('AI track record renderer preserves initial loading and error retry states', () => {
  const elements = createElements();
  const calls = [];
  const state = {
    aiTrackRecordLoading: true,
    aiTrackRecordLoaded: false,
    aiTrackRecordError: '',
    aiTrackRecord: null,
  };
  const renderer = createRenderer({ state, elements, onRetry: force => calls.push(force) });

  renderer.renderAiTrackRecord();
  assert.match(elements.map.get('aiTrackRecord').innerHTML, /Проверяю подтверждённую историю AI/);

  state.aiTrackRecordLoading = false;
  state.aiTrackRecordError = 'offline';
  renderer.renderAiTrackRecord();
  elements.map.get('aiTrackRetry').click();

  assert.match(elements.map.get('aiTrackRecord').innerHTML, /Протокол AI временно недоступен/);
  assert.deepEqual(calls, [true]);
});

test('AI track record renderer preserves forming empty state', () => {
  const elements = createElements();
  const renderer = createRenderer({
    state: {
      aiTrackRecordLoading: false,
      aiTrackRecordLoaded: true,
      aiTrackRecordError: '',
      aiTrackRecord: { available: false },
    },
    elements,
  });

  renderer.renderAiTrackRecord();

  assert.match(elements.map.get('aiTrackRecord').innerHTML, /Протокол AI формируется/);
  assert.match(elements.map.get('aiTrackRecord').innerHTML, /Подтверждённые результаты появятся здесь/);
});

test('AI track record renderer preserves verified sample metrics and recent rows', () => {
  const elements = createElements();
  const renderer = createRenderer({
    state: {
      aiTrackRecordLoading: false,
      aiTrackRecordLoaded: true,
      aiTrackRecordError: '',
      aiTrackRecord: {
        available: true,
        periodDays: 180,
        sample: {
          state: 'informative',
          label: 'Информативная выборка',
          verified: 42,
          matched: 25,
          missed: 17,
          message: '<sample>',
        },
        probabilityQuality: {
          avgBrier: 0.18349,
          explanation: 'lower is better',
        },
        recent: [{
          matched: true,
          home: '<Home>',
          away: 'Away',
          league: 'League',
          kickoffAt: '2026-09-30T10:00:00Z',
          score: '2:1',
          predictedLabel: 'П1',
          topProbability: 61.2,
          actualLabel: 'П1',
        }],
        methodology: { disclaimer: 'verified only' },
      },
    },
    elements,
  });

  renderer.renderAiTrackRecord();
  const html = elements.map.get('aiTrackRecord').innerHTML;

  assert.match(html, /Проверенная история модели/);
  assert.match(html, /42/);
  assert.match(html, /25/);
  assert.match(html, /17/);
  assert.match(html, /0\.183/);
  assert.match(html, /&lt;Home&gt; — Away/);
  assert.match(html, /date:2026-09-30T10:00:00Z/);
  assert.match(html, /61\.2%/);
  assert.match(html, /Здесь нет рекламного «процента побед»/);
});

test('stale AI track record keeps verified data visible with warning', () => {
  const elements = createElements();
  const renderer = createRenderer({
    state: {
      aiTrackRecordLoading: false,
      aiTrackRecordLoaded: true,
      aiTrackRecordError: 'refresh failed',
      aiTrackRecord: {
        available: true,
        sample: { state: 'early', label: 'Малая выборка', verified: 2, matched: 1, missed: 1 },
        probabilityQuality: {},
        recent: [],
        methodology: {},
      },
    },
    elements,
  });

  renderer.renderAiTrackRecord();

  assert.match(elements.map.get('aiTrackRecord').innerHTML, /Показана последняя загруженная версия/);
  assert.match(elements.map.get('aiTrackRecord').innerHTML, /Малая выборка/);
});
