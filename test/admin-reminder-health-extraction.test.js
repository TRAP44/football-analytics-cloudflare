import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminReminderHealthModule } from '../public/modules/admin-reminder-health.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createState(overrides = {}) {
  return {
    reminderHealth: null,
    reminderHealthLoading: false,
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
        disabled: false,
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
  toast = () => {},
} = {}) {
  return createAdminReminderHealthModule({
    state,
    $: elementById,
    isAdmin,
    SUPABASE_SCHEMA_HINT: 'schema migration required',
    escapeHtml: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    technicalStateLabel: value => String(value ?? ''),
    humanizeTechnicalText: value => String(value ?? ''),
    api,
    toast,
  });
}

const app = readRepoFile('public/app.js');
const reminderHealth = readRepoFile('public/modules/admin-reminder-health.js');
const router = readRepoFile('src/router.js');

test('reminder health implementation stays outside the shared app root', () => {
  assert.match(reminderHealth, /export function createAdminReminderHealthModule/);
  assert.match(reminderHealth, /function renderReminderHealth\(\)/);
  assert.match(reminderHealth, /async function loadReminderHealth\(force = false\)/);
  assert.match(reminderHealth, /async function sendReminderTest\(\)/);
  assert.match(reminderHealth, /if \(!isAdmin\(\)\) return/);

  assert.doesNotMatch(app, /Проверяю расписание и фиксацию задач доставки/);
  assert.doesNotMatch(app, /prematchSent24h/);
});

test('reminder health route is admin-only and protects POST test delivery against replay', () => {
  assert.match(
    router,
    /if \(pathname === '\/api\/reminder-health'\)[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\);[\s\S]*?method === 'GET'[\s\S]*?apiReminderHealth\(request,cfg,user\)[\s\S]*?method === 'POST'[\s\S]*?sensitiveMutation\(\(\)=>apiReminderHealth\(request,cfg,user\)\)/,
  );
});

test('shared app root lazy-loads reminder health only behind admin role', () => {
  assert.match(
    app,
    /async function ensureAdminReminderHealthModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-reminder-health\.js'\)/,
  );
  assert.match(
    app,
    /createAdminReminderHealthModule\(\{[\s\S]*?state, \$, isAdmin,[\s\S]*?SUPABASE_SCHEMA_HINT,[\s\S]*?technicalStateLabel,[\s\S]*?humanizeTechnicalText,[\s\S]*?api, toast/,
  );
  assert.match(app, /module\?\.loadReminderHealth\(\.\.\.args\)/);
  assert.match(app, /module\?\.sendReminderTest\(\.\.\.args\)/);
});

test('reminder health fails closed for non-admin render, load and test-send calls', async () => {
  let apiCalls = 0;
  let toastCalls = 0;
  const state = createState();
  const module = createModule({
    state,
    elementById: () => {
      throw new Error('DOM must not be touched for non-admin reminder health');
    },
    isAdmin: () => false,
    api: async () => {
      apiCalls += 1;
      return {};
    },
    toast: () => {
      toastCalls += 1;
    },
  });

  assert.doesNotThrow(() => module.renderReminderHealth());
  await module.loadReminderHealth(true);
  await module.sendReminderTest();

  assert.equal(apiCalls, 0);
  assert.equal(toastCalls, 0);
  assert.deepEqual(state, createState());
});

test('reminder health loader preserves GET contract and healthy rendering', async () => {
  const { elements, elementById } = createElements();
  const state = createState();
  const calls = [];

  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return {
        available: true,
        scheduler: { cadenceMinutes: 5 },
        summary: {
          activeUpcoming: 3,
          dueNext90Minutes: 1,
          prematchSent24h: 4,
          kickoffSent24h: 2,
          failed24h: 0,
          activeClaims: 1,
          staleClaims: 0,
        },
        recent: [],
        health: {
          state: 'healthy',
          label: 'Доставка выглядит штатно',
        },
      };
    },
  });

  await module.loadReminderHealth(true);

  assert.deepEqual(calls, [{
    path: '/api/reminder-health',
    options: {
      retry: false,
      timeoutMs: 12000,
    },
  }]);
  assert.equal(state.reminderHealthLoading, false);
  assert.equal(elements.get('reminderHealthBadge').textContent, 'НОРМА');
  assert.equal(
    elements.get('reminderHealthStatus').textContent,
    'Доставка выглядит штатно · проверка каждые 5 мин.',
  );
  assert.match(elements.get('reminderHealthKpis').innerHTML, />3</);
});

test('reminder health reuses cached state without another API request', async () => {
  const { elements, elementById } = createElements();
  let apiCalls = 0;
  const existing = {
    available: true,
    scheduler: { cadenceMinutes: 5 },
    summary: {},
    recent: [],
    health: {
      state: 'healthy',
      label: 'Cached healthy',
    },
  };
  const state = createState({ reminderHealth: existing });

  const module = createModule({
    state,
    elementById,
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  await module.loadReminderHealth(false);

  assert.equal(apiCalls, 0);
  assert.equal(state.reminderHealth, existing);
  assert.equal(elements.get('reminderHealthStatus').textContent, 'Cached healthy · проверка каждые 5 мин.');
});

test('schema-missing and runtime failures are rendered as distinct unavailable states', async () => {
  const first = createElements();
  const schemaState = createState({
    reminderHealth: {
      available: false,
      migrationReady: false,
      reason: 'schema migration required',
    },
  });
  createModule({
    state: schemaState,
    elementById: first.elementById,
  }).renderReminderHealth();

  assert.equal(first.elements.get('reminderHealthBadge').textContent, 'БД');
  assert.match(first.elements.get('reminderHealthKpis').innerHTML, /schema migration required/);

  const second = createElements();
  const runtimeState = createState();
  const module = createModule({
    state: runtimeState,
    elementById: second.elementById,
    api: async () => {
      throw new Error('network unavailable');
    },
  });

  await assert.doesNotReject(() => module.loadReminderHealth(true));

  assert.equal(runtimeState.reminderHealthLoading, false);
  assert.deepEqual(runtimeState.reminderHealth, {
    available: false,
    reason: 'network unavailable',
  });
  assert.equal(second.elements.get('reminderHealthBadge').textContent, 'НЕДОСТУПНО');
  assert.equal(second.elements.get('reminderHealthStatus').textContent, 'network unavailable');
});

test('reminder test preserves POST contract, shows response and reloads authoritative health', async () => {
  const { elementById } = createElements();
  const state = createState({
    reminderHealth: {
      available: true,
      health: { state: 'healthy', label: 'old' },
      scheduler: { cadenceMinutes: 5 },
      summary: {},
      recent: [],
    },
  });
  const calls = [];
  const toasts = [];

  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (options?.method === 'POST') {
        return { ok: true, message: 'Тестовое Telegram-уведомление отправлено.' };
      }
      return {
        available: true,
        scheduler: { cadenceMinutes: 5 },
        summary: {},
        recent: [],
        health: {
          state: 'healthy',
          label: 'authoritative health',
        },
      };
    },
    toast: message => toasts.push(message),
  });

  await module.sendReminderTest();

  assert.deepEqual(calls, [
    {
      path: '/api/reminder-health',
      options: {
        method: 'POST',
        body: JSON.stringify({ action: 'test' }),
        retry: false,
        dedupe: false,
        timeoutMs: 12000,
      },
    },
    {
      path: '/api/reminder-health',
      options: {
        retry: false,
        timeoutMs: 12000,
      },
    },
  ]);
  assert.deepEqual(toasts, ['Тестовое Telegram-уведомление отправлено.']);
  assert.equal(state.reminderHealthLoading, false);
  assert.equal(state.reminderHealth.health.label, 'authoritative health');
});

test('failed reminder test still reloads health and clears loading state', async () => {
  const { elementById } = createElements();
  const state = createState();
  const calls = [];
  const toasts = [];

  const module = createModule({
    state,
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (options?.method === 'POST') {
        throw new Error('telegram unavailable');
      }
      return {
        available: true,
        scheduler: { cadenceMinutes: 5 },
        summary: {},
        recent: [],
        health: {
          state: 'watch',
          label: 'Нужен контроль доставки',
        },
      };
    },
    toast: message => toasts.push(message),
  });

  await assert.doesNotReject(() => module.sendReminderTest());

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].path, '/api/reminder-health');
  assert.deepEqual(toasts, ['telegram unavailable']);
  assert.equal(state.reminderHealthLoading, false);
  assert.equal(state.reminderHealth.health.state, 'watch');
});
