import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBetaFeedbackModule } from '../public/modules/beta-feedback.js';
import { createBetaPhase5Runtime } from '../src/beta-phase5-runtime.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

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

function createModule({
  state = { betaFeedbackSending: false },
  elements = createElements(),
  api = async () => ({}),
  schedule = () => {},
} = {}) {
  return {
    state,
    elements,
    module: createBetaFeedbackModule({
      state,
      elementById: id => elements.get(id) || null,
      api,
      schedule,
    }),
  };
}

function createFeedbackRuntime({ invited = true, redact = value => String(value) } = {}) {
  const recorded = [];
  const runtime = createBetaPhase5Runtime({
    APP_VERSION: 'test',
    CLOSED_BETA_COHORT: 'closed_beta_v1',
    PHASE5_VALIDATION_COHORT: 'phase5_public_v2',
    RC_NAME: 'test',
    RELEASE_CHANNEL: 'test',
    billingWebhookStatus: async () => ({ ready: true }),
    collectDiagnostics: async () => ({}),
    hasSupabase: () => true,
    isClosedBetaUser: () => invited,
    json: (body, status = 200) => ({ body, status }),
    providerSnapshot: () => ({}),
    readOpsEventsRange: async () => ({ items: [], persistent: true }),
    recordOpsEvent: async (_cfg, event) => { recorded.push(event); },
    redactOpsString: redact,
  });
  return { runtime, recorded };
}

function request(body, method = 'POST') {
  return {
    method,
    json: async () => body,
  };
}

function optionValues(selectId) {
  const marker = `id="${selectId}"`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `${selectId} missing`);
  const end = html.indexOf('</select>', start);
  assert.ok(end > start, `${selectId} select end missing`);
  return [...html.slice(start, end).matchAll(/<option\s+value="([^"]+)"/g)].map(match => match[1]);
}

test('beta feedback module validates required dependencies', () => {
  assert.throws(
    () => createBetaFeedbackModule({ state: null, elementById: () => null, api: async () => ({}) }),
    /requires state, elementById and api/,
  );
  assert.throws(
    () => createBetaFeedbackModule({ state: [], elementById: () => null, api: async () => ({}) }),
    /requires state, elementById and api/,
  );
  assert.throws(
    () => createBetaFeedbackModule({ state: {}, elementById: null, api: async () => ({}) }),
    /requires state, elementById and api/,
  );
});

test('app lazy-loads feedback module with explicit state, DOM, API and scheduler dependencies', () => {
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

test('feedback selectors stay aligned with the server allowlists', () => {
  assert.deepEqual(optionValues('betaFeedbackCategory'), [
    'search',
    'matches',
    'ai',
    'live',
    'ux',
    'data_sources',
    'performance',
  ]);
  assert.deepEqual(optionValues('betaFeedbackSeverity'), ['MAJOR', 'BLOCKER', 'MINOR']);
});

test('feedback open and close preserve visibility, aria state, focus and stale status cleanup', () => {
  const { module, elements } = createModule();
  elements.get('betaFeedbackForm').hidden = true;
  elements.get('betaFeedbackStatus').textContent = 'old error';

  module.setBetaFeedbackOpen(true);
  assert.equal(elements.get('betaFeedbackForm').hidden, false);
  assert.equal(elements.get('betaFeedbackOpenBtn').attrs.get('aria-expanded'), 'true');
  assert.equal(elements.get('betaFeedbackNote').focused, true);
  assert.equal(elements.get('betaFeedbackStatus').textContent, '');

  module.setBetaFeedbackOpen(false);
  assert.equal(elements.get('betaFeedbackForm').hidden, true);
  assert.equal(elements.get('betaFeedbackOpenBtn').attrs.get('aria-expanded'), 'false');
});

test('client validation blocks malformed category, severity and short note without API calls', async () => {
  const cases = [
    { category: 'availability', severity: 'MAJOR', note: 'valid note', message: 'Выберите раздел проблемы.' },
    { category: 'search', severity: 'urgent', note: 'valid note', message: 'Выберите важность проблемы.' },
    { category: 'search', severity: 'MINOR', note: 'bad', message: 'Кратко опишите, что произошло.' },
  ];

  for (const item of cases) {
    let apiCalls = 0;
    const { module, elements, state } = createModule({
      api: async () => { apiCalls += 1; return {}; },
    });
    elements.get('betaFeedbackCategory').value = item.category;
    elements.get('betaFeedbackSeverity').value = item.severity;
    elements.get('betaFeedbackNote').value = item.note;

    await module.submitBetaFeedback();

    assert.equal(apiCalls, 0);
    assert.equal(state.betaFeedbackSending, false);
    assert.equal(elements.get('betaFeedbackStatus').textContent, item.message);
  }
});

test('feedback submission normalizes selectors, preserves request contract and restores sending state', async () => {
  const calls = [];
  const scheduled = [];
  const { module, elements, state } = createModule({
    api: async (path, options) => { calls.push({ path, options }); return {}; },
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  });

  elements.get('betaFeedbackForm').hidden = false;
  elements.get('betaFeedbackCategory').value = ' DATA_SOURCES ';
  elements.get('betaFeedbackSeverity').value = ' minor ';
  elements.get('betaFeedbackNote').value = '  lineup data missing  ';

  await module.submitBetaFeedback();

  assert.deepEqual(calls, [{
    path: '/api/beta-feedback',
    options: {
      method: 'POST',
      body: JSON.stringify({
        category: 'data_sources',
        severity: 'MINOR',
        note: 'lineup data missing',
      }),
      timeoutMs: 6500,
      retry: false,
      dedupe: false,
    },
  }]);
  assert.equal(elements.get('betaFeedbackStatus').textContent, 'Спасибо. Сообщение отправлено и добавлено в журнал обратной связи.');
  assert.equal(elements.get('betaFeedbackNote').value, '');
  assert.equal(elements.get('betaFeedbackSendBtn').disabled, false);
  assert.equal(state.betaFeedbackSending, false);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 900);

  scheduled[0].fn();
  assert.equal(elements.get('betaFeedbackForm').hidden, true);
});

test('delayed success close does not hide a form the user has resumed editing', async () => {
  const scheduled = [];
  const { module, elements } = createModule({
    api: async () => ({}),
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  });

  elements.get('betaFeedbackForm').hidden = false;
  elements.get('betaFeedbackCategory').value = 'search';
  elements.get('betaFeedbackSeverity').value = 'MINOR';
  elements.get('betaFeedbackNote').value = 'search misses match';

  await module.submitBetaFeedback();
  assert.equal(scheduled.length, 1);

  elements.get('betaFeedbackNote').value = 'new feedback being typed';
  scheduled[0].fn();

  assert.equal(elements.get('betaFeedbackForm').hidden, false);
  assert.equal(elements.get('betaFeedbackNote').value, 'new feedback being typed');
});

test('concurrent submit attempts are deduplicated while one request is in flight', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let apiCalls = 0;
  const { module, elements, state } = createModule({
    api: async () => {
      apiCalls += 1;
      await pending;
      return {};
    },
  });
  elements.get('betaFeedbackCategory').value = 'ux';
  elements.get('betaFeedbackSeverity').value = 'MAJOR';
  elements.get('betaFeedbackNote').value = 'button layout is confusing';

  const first = module.submitBetaFeedback();
  const second = module.submitBetaFeedback();

  assert.equal(apiCalls, 1);
  assert.equal(state.betaFeedbackSending, true);
  release();
  await Promise.all([first, second]);
  assert.equal(state.betaFeedbackSending, false);
});

test('feedback API failure restores sending state and does not schedule auto-close', async () => {
  let scheduled = 0;
  const { module, elements, state } = createModule({
    api: async () => { throw new Error('Сервис временно недоступен.'); },
    schedule: () => { scheduled += 1; },
  });
  elements.get('betaFeedbackCategory').value = 'performance';
  elements.get('betaFeedbackSeverity').value = 'MAJOR';
  elements.get('betaFeedbackNote').value = 'screen takes too long to load';

  await module.submitBetaFeedback();

  assert.equal(elements.get('betaFeedbackStatus').textContent, 'Сервис временно недоступен.');
  assert.equal(elements.get('betaFeedbackSendBtn').disabled, false);
  assert.equal(state.betaFeedbackSending, false);
  assert.equal(scheduled, 0);
});

test('server feedback endpoint is fail-closed on method, membership and invalid fields', async () => {
  const { runtime } = createFeedbackRuntime();

  assert.deepEqual(
    await runtime.apiBetaFeedback(request({}, 'GET'), {}, { id: 1 }),
    { status: 405, body: { error: 'Метод не поддерживается.' } },
  );

  const outsider = createFeedbackRuntime({ invited: false }).runtime;
  const membership = await outsider.apiBetaFeedback(request({
    category: 'search',
    severity: 'MINOR',
    note: 'valid note',
  }), {}, { id: 1 });
  assert.equal(membership.status, 403);
  assert.equal(membership.body.code, 'BETA_MEMBERSHIP_REQUIRED');

  const invalidCategory = await runtime.apiBetaFeedback(request({
    category: 'other',
    severity: 'MINOR',
    note: 'valid note',
  }), {}, { id: 1 });
  assert.equal(invalidCategory.status, 400);
  assert.equal(invalidCategory.body.error, 'Выберите раздел проблемы.');

  const invalidSeverity = await runtime.apiBetaFeedback(request({
    category: 'search',
    severity: 'URGENT',
    note: 'valid note',
  }), {}, { id: 1 });
  assert.equal(invalidSeverity.status, 400);
  assert.equal(invalidSeverity.body.error, 'Выберите важность проблемы.');

  const shortNote = await runtime.apiBetaFeedback(request({
    category: 'search',
    severity: 'MINOR',
    note: 'bad',
  }), {}, { id: 1 });
  assert.equal(shortNote.status, 400);
  assert.equal(shortNote.body.error, 'Кратко опишите, что произошло.');
});

test('server stores only bounded explicit feedback metadata and never raw identity fields', async () => {
  const { runtime, recorded } = createFeedbackRuntime({
    redact: value => String(value).replace(/secret-token/g, '[redacted]').slice(0, 600),
  });

  const result = await runtime.apiBetaFeedback(request({
    category: ' DATA_SOURCES ',
    severity: ' major ',
    note: ' provider failed with secret-token ',
  }), {}, {
    id: 123456789,
    username: 'private-user',
  });

  assert.deepEqual(result, { status: 200, body: { ok: true } });
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], {
    severity: 'warning',
    source: 'beta',
    eventType: 'beta_feedback',
    code: 'BETA_FEEDBACK',
    message: 'Beta feedback: provider failed with [redacted]',
    endpoint: '/api/beta-feedback',
    meta: {
      category: 'data_sources',
      betaSeverity: 'MAJOR',
      explicitUserFeedback: true,
      betaCohort: 'closed_beta_v1',
      betaMembershipVerified: true,
    },
  });

  const serialized = JSON.stringify(recorded[0]);
  assert.doesNotMatch(serialized, /123456789|private-user/);
});
