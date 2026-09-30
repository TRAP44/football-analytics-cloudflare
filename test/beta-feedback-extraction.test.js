import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBetaFeedbackModule } from '../public/modules/beta-feedback.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const betaFeedback = readFileSync(new URL('../public/modules/beta-feedback.js', import.meta.url), 'utf8');

function element() {
  return {
    value: '',
    textContent: '',
    hidden: false,
    disabled: false,
    attrs: new Map(),
    focused: false,
    setAttribute(name, value) { this.attrs.set(name, value); },
    focus() { this.focused = true; },
  };
}

function createElements() {
  return new Map([
    ['betaFeedbackForm', element()],
    ['betaFeedbackOpenBtn', element()],
    ['betaFeedbackCategory', element()],
    ['betaFeedbackSeverity', element()],
    ['betaFeedbackNote', element()],
    ['betaFeedbackStatus', element()],
    ['betaFeedbackSendBtn', element()],
  ]);
}

test('beta feedback implementation lives outside shared app root and outside admin beta dashboard', () => {
  assert.match(betaFeedback, /export function createBetaFeedbackModule/);
  assert.match(betaFeedback, /function setBetaFeedbackOpen\(open\)/);
  assert.match(betaFeedback, /async function submitBetaFeedback\(\)/);
  assert.match(betaFeedback, /\/api\/beta-feedback/);
  assert.doesNotMatch(app, /const category=String\(\$\('betaFeedbackCategory'\)/);
  assert.doesNotMatch(app, /Спасибо\. Сообщение добавлено в beta-наблюдение/);
});

test('app lazy-loads beta feedback with explicit state DOM API and scheduler dependencies', () => {
  const start = app.indexOf('async function ensureBetaFeedbackModule()');
  const end = app.indexOf('\nlet adminOverviewModule', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /import\('\.\/modules\/beta-feedback\.js'\)/);
  assert.match(boundary, /state/);
  assert.match(boundary, /elementById: \$/);
  assert.match(boundary, /api/);
  assert.match(boundary, /schedule: \(fn, ms\) => setTimeout\(fn, ms\)/);
});

test('feedback open/close preserves visibility, aria state and focus behavior', () => {
  const state = { betaFeedbackSending: false };
  const elements = createElements();
  elements.get('betaFeedbackForm').hidden = true;
  const module = createBetaFeedbackModule({
    state,
    elementById: id => elements.get(id) || null,
    api: async () => ({}),
    schedule: () => {},
  });

  module.setBetaFeedbackOpen(true);
  assert.equal(elements.get('betaFeedbackForm').hidden, false);
  assert.equal(elements.get('betaFeedbackOpenBtn').attrs.get('aria-expanded'), 'true');
  assert.equal(elements.get('betaFeedbackNote').focused, true);

  module.setBetaFeedbackOpen(false);
  assert.equal(elements.get('betaFeedbackForm').hidden, true);
  assert.equal(elements.get('betaFeedbackOpenBtn').attrs.get('aria-expanded'), 'false');
});

test('feedback validation blocks short notes without API calls', async () => {
  const state = { betaFeedbackSending: false };
  const elements = createElements();
  elements.get('betaFeedbackCategory').value = 'data';
  elements.get('betaFeedbackSeverity').value = 'minor';
  elements.get('betaFeedbackNote').value = 'bad';
  let apiCalls = 0;
  const module = createBetaFeedbackModule({
    state,
    elementById: id => elements.get(id) || null,
    api: async () => { apiCalls += 1; return {}; },
    schedule: () => {},
  });

  await module.submitBetaFeedback();

  assert.equal(apiCalls, 0);
  assert.equal(state.betaFeedbackSending, false);
  assert.equal(elements.get('betaFeedbackStatus').textContent, 'Кратко опишите, что произошло.');
});

test('feedback submission preserves endpoint, payload, request options and delayed close', async () => {
  const state = { betaFeedbackSending: false };
  const elements = createElements();
  elements.get('betaFeedbackCategory').value = 'availability';
  elements.get('betaFeedbackSeverity').value = 'major';
  elements.get('betaFeedbackNote').value = 'lineup data missing';
  const calls = [];
  const scheduled = [];
  const module = createBetaFeedbackModule({
    state,
    elementById: id => elements.get(id) || null,
    api: async (path, options) => { calls.push({ path, options }); return {}; },
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  });

  await module.submitBetaFeedback();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/beta-feedback');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.timeoutMs, 6500);
  assert.equal(calls[0].options.retry, false);
  assert.equal(calls[0].options.dedupe, false);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    category: 'availability',
    severity: 'major',
    note: 'lineup data missing',
  });
  assert.equal(elements.get('betaFeedbackStatus').textContent, 'Спасибо. Сообщение добавлено в beta-наблюдение.');
  assert.equal(elements.get('betaFeedbackNote').value, '');
  assert.equal(elements.get('betaFeedbackSendBtn').disabled, false);
  assert.equal(state.betaFeedbackSending, false);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 900);
  scheduled[0].fn();
  assert.equal(elements.get('betaFeedbackForm').hidden, true);
});

test('feedback API failure restores sending state and surfaces error without auto-close', async () => {
  const state = { betaFeedbackSending: false };
  const elements = createElements();
  elements.get('betaFeedbackCategory').value = 'other';
  elements.get('betaFeedbackSeverity').value = 'minor';
  elements.get('betaFeedbackNote').value = 'valid feedback note';
  let scheduled = 0;
  const module = createBetaFeedbackModule({
    state,
    elementById: id => elements.get(id) || null,
    api: async () => { throw new Error('feedback unavailable'); },
    schedule: () => { scheduled += 1; },
  });

  await module.submitBetaFeedback();

  assert.equal(elements.get('betaFeedbackStatus').textContent, 'feedback unavailable');
  assert.equal(elements.get('betaFeedbackSendBtn').disabled, false);
  assert.equal(state.betaFeedbackSending, false);
  assert.equal(scheduled, 0);
});
