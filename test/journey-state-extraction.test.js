import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJourneyStateModule } from '../public/modules/journey-state.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/modules/journey-state.js', import.meta.url), 'utf8');

function element() {
  return {
    innerHTML: '',
    attrs: new Map(),
    listeners: [],
    setAttribute(name, value) { this.attrs.set(name, value); },
    addEventListener(type, handler, options) { this.listeners.push({ type, handler, options }); },
  };
}

function createElements() {
  return new Map([
    ['analysis', element()],
    ['analysisStateRetry', element()],
  ]);
}

function createModule({ elements = createElements() } = {}) {
  return {
    elements,
    module: createJourneyStateModule({
      elementById: id => elements.get(id) || null,
      escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    }),
  };
}

test('journey state renderer lives outside app without capturing match or AI lifecycle', () => {
  assert.match(app, /import \{ createJourneyStateModule \} from '\.\/modules\/journey-state\.js'/);
  assert.match(app, /const \{ renderJourneyState \} = createJourneyStateModule\(\{/);
  assert.doesNotMatch(app, /function renderJourneyState\(/);
  assert.match(source, /export function createJourneyStateModule/);
  assert.match(source, /function renderJourneyState\(kind,/);
  assert.doesNotMatch(source, /openMatchCenter|analyzeMatch|\bapi\s*\(|fetch\s*\(|state\./);
});

test('loading journey state sets aria busy and has no retry action', () => {
  const { module, elements } = createModule();

  module.renderJourneyState('loading', {
    title: 'Открываем матч',
    message: 'Загружаем данные',
  });

  const root = elements.get('analysis');
  assert.equal(root.attrs.get('aria-busy'), 'true');
  assert.match(root.innerHTML, /is-loading/);
  assert.match(root.innerHTML, /Открываем матч/);
  assert.match(root.innerHTML, /Загружаем данные/);
  assert.doesNotMatch(root.innerHTML, /analysisStateRetry/);
  assert.equal(elements.get('analysisStateRetry').listeners.length, 0);
});

test('error journey state escapes copy and binds one-shot injected retry callback', () => {
  const { module, elements } = createModule();
  let retries = 0;

  module.renderJourneyState('error', {
    title: 'Ошибка <матча>',
    message: 'Повторите <позже>',
    retry: () => { retries += 1; },
  });

  const root = elements.get('analysis');
  assert.equal(root.attrs.get('aria-busy'), 'false');
  assert.match(root.innerHTML, /is-error/);
  assert.match(root.innerHTML, /Ошибка &lt;матча&gt;/);
  assert.match(root.innerHTML, /Повторите &lt;позже&gt;/);
  assert.match(root.innerHTML, /analysisStateRetry/);

  const [listener] = elements.get('analysisStateRetry').listeners;
  assert.equal(listener.type, 'click');
  assert.deepEqual(listener.options, { once: true });
  listener.handler();
  assert.equal(retries, 1);
});

test('journey state preserves default loading and error copy', () => {
  const { module, elements } = createModule();

  module.renderJourneyState('loading');
  assert.match(elements.get('analysis').innerHTML, /Загружаем…/);
  assert.match(elements.get('analysis').innerHTML, /Подготавливаем данные матча/);

  module.renderJourneyState('error');
  assert.match(elements.get('analysis').innerHTML, /Не удалось открыть раздел/);
  assert.match(elements.get('analysis').innerHTML, /Попробуйте ещё раз/);
});

test('missing analysis DOM fails soft and never invokes retry', () => {
  let retries = 0;
  const module = createJourneyStateModule({
    elementById: () => null,
    escapeHtml: value => String(value ?? ''),
  });

  assert.doesNotThrow(() => module.renderJourneyState('error', { retry: () => { retries += 1; } }));
  assert.equal(retries, 0);
});
