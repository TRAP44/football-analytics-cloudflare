import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReminderListModule } from '../public/modules/reminder-list.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/modules/reminder-list.js', import.meta.url), 'utf8');

function element() {
  return {
    innerHTML: '',
    listeners: [],
    dataset: {},
    addEventListener(type, handler, options) {
      this.listeners.push({ type, handler, options });
    },
  };
}

function createHarness({
  state,
  onRetry = () => {},
  onOpenMatches = () => {},
  onRemove = () => {},
} = {}) {
  const elements = new Map([
    ['reminderList', element()],
    ['remindersRetry', element()],
    ['remindersEmptyRetry', element()],
    ['remindersEmptyMatches', element()],
  ]);
  const removeButtons = [];

  const module = createReminderListModule({
    state,
    elementById: id => elements.get(id) || null,
    querySelectorAll: selector => selector === '.reminder-remove' ? removeButtons : [],
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    dateTime: value => 'DT:' + String(value ?? ''),
    recoveryCardHtml: ({ title, message, retryId }) => `<section><strong>${title}</strong><span>${message}</span><button id="${retryId}">Повторить</button></section>`,
    onRetry,
    onOpenMatches,
    onRemove,
  });

  return { module, elements, removeButtons };
}

test('reminder list renderer lives outside app while mutation lifecycle stays in composition root', () => {
  assert.match(app, /import \{ createReminderListModule \} from '\.\/modules\/reminder-list\.js'/);
  assert.match(app, /const \{ renderReminderList \} = createReminderListModule\(\{/);
  assert.match(app, /onRemove: fixtureId => handleReminderRemove\(fixtureId\)/);
  assert.match(app, /async function handleReminderRemove\(fixtureId\)/);
  assert.match(app, /\/api\/reminders\?fixtureId=\$\{fixtureId\}/);
  assert.match(app, /state\.reminderMutations\.add\(fixtureId\)/);
  assert.match(app, /state\.profile = \{/);
  assert.match(app, /toast\('Напоминание отключено'\)/);

  assert.match(source, /export function createReminderListModule/);
  assert.match(source, /function renderReminderList\(\)/);
  assert.match(source, /function reminderDeliveryBadge\(item\)/);
  assert.doesNotMatch(source, /\bapi\s*\(|fetch\s*\(|state\.profile\s*=|toast\s*\(|renderProfile\s*\(|renderAnalysis\s*\(/);
});

test('initial reminder loading renders compact loader only', () => {
  const state = {
    reminders: [],
    remindersLoading: true,
    remindersLoaded: false,
    remindersLoadError: '',
    reminderMutations: new Set(),
  };
  const { module, elements } = createHarness({ state });

  module.renderReminderList();

  assert.match(elements.get('reminderList').innerHTML, /Загружаю напоминания/);
  assert.match(elements.get('reminderList').innerHTML, /compact-loader/);
});

test('initial reminder error renders recovery card and injected retry callback', () => {
  const state = {
    reminders: [],
    remindersLoading: false,
    remindersLoaded: false,
    remindersLoadError: 'offline',
    reminderMutations: new Set(),
  };
  let retries = 0;
  const { module, elements } = createHarness({ state, onRetry: () => { retries += 1; } });

  module.renderReminderList();

  assert.match(elements.get('reminderList').innerHTML, /Напоминания временно недоступны/);
  assert.match(elements.get('reminderList').innerHTML, /offline/);
  const [listener] = elements.get('remindersRetry').listeners;
  assert.equal(listener.type, 'click');
  listener.handler();
  assert.equal(retries, 1);
});

test('empty reminder state preserves stale warning, retry and open-matches actions', () => {
  const state = {
    reminders: [],
    remindersLoading: false,
    remindersLoaded: true,
    remindersLoadError: 'stale <data>',
    reminderMutations: new Set(),
  };
  let retries = 0;
  let opens = 0;
  const { module, elements } = createHarness({
    state,
    onRetry: () => { retries += 1; },
    onOpenMatches: () => { opens += 1; },
  });

  module.renderReminderList();

  const html = elements.get('reminderList').innerHTML;
  assert.match(html, /Активных напоминаний пока нет/);
  assert.match(html, /stale &lt;data&gt;/);
  assert.match(html, /remindersEmptyRetry/);
  assert.match(html, /remindersEmptyMatches/);

  elements.get('remindersEmptyRetry').listeners[0].handler();
  elements.get('remindersEmptyMatches').listeners[0].handler();
  assert.equal(retries, 1);
  assert.equal(opens, 1);
});

test('reminder rows are sorted, escaped, badged and preserve pending disable state', () => {
  const state = {
    reminders: [
      {
        fixtureId: 22,
        fixtureDate: '2026-10-02T18:00:00Z',
        homeName: 'Later <Home>',
        awayName: 'Away',
        remindBeforeMinutes: 15,
        kickoffNotify: true,
        deliveryStatus: 'kickoff_sent',
      },
      {
        fixtureId: 11,
        fixtureDate: '2026-10-01T18:00:00Z',
        homeName: 'Earlier',
        awayName: 'Away & Co',
        remindBeforeMinutes: 30,
        kickoffNotify: false,
        deliveryStatus: 'retry_pending',
      },
    ],
    remindersLoading: false,
    remindersLoaded: true,
    remindersLoadError: '',
    reminderMutations: new Set([22]),
  };
  const { module, elements } = createHarness({ state });

  module.renderReminderList();

  const html = elements.get('reminderList').innerHTML;
  assert.ok(html.indexOf('Earlier') < html.indexOf('Later &lt;Home&gt;'));
  assert.match(html, /Away &amp; Co/);
  assert.match(html, /↻ Повтор доставки/);
  assert.match(html, /✓ Старт отправлен/);
  assert.match(html, /data-fixture-id="22" disabled/);
  assert.match(html, /DT:2026-10-01T18:00:00Z · за 30 мин\./);
  assert.match(html, /DT:2026-10-02T18:00:00Z · за 15 мин\. · \+ старт/);
});

test('remove click delegates fixture id and blocks invalid or already-pending ids', () => {
  const state = {
    reminders: [{ fixtureId: 31, fixtureDate: '2026-10-01', homeName: 'A', awayName: 'B' }],
    remindersLoading: false,
    remindersLoaded: true,
    remindersLoadError: '',
    reminderMutations: new Set(),
  };
  const removed = [];
  const { module, removeButtons } = createHarness({ state, onRemove: id => removed.push(id) });
  const valid = element();
  valid.dataset.fixtureId = '31';
  const invalid = element();
  invalid.dataset.fixtureId = '0';
  removeButtons.push(valid, invalid);

  module.renderReminderList();

  valid.listeners[0].handler();
  invalid.listeners[0].handler();
  assert.deepEqual(removed, [31]);

  state.reminderMutations.add(31);
  valid.listeners[0].handler();
  assert.deepEqual(removed, [31]);
});

test('delivery badge keeps all existing status labels', () => {
  const state = {
    reminders: [],
    remindersLoading: false,
    remindersLoaded: true,
    remindersLoadError: '',
    reminderMutations: new Set(),
  };
  const { module } = createHarness({ state });

  assert.match(module.reminderDeliveryBadge({ deliveryStatus: 'kickoff_sent' }), /Старт отправлен/);
  assert.match(module.reminderDeliveryBadge({ deliveryStatus: 'prematch_sent' }), /Предматчевое отправлено/);
  assert.match(module.reminderDeliveryBadge({ deliveryStatus: 'retry_pending' }), /Повтор доставки/);
  assert.match(module.reminderDeliveryBadge({ deliveryStatus: 'scheduled' }), /Запланировано/);
});

test('missing reminder list DOM fails soft without invoking callbacks', () => {
  let callbacks = 0;
  const module = createReminderListModule({
    state: {
      reminders: [],
      remindersLoading: false,
      remindersLoaded: true,
      remindersLoadError: '',
      reminderMutations: new Set(),
    },
    elementById: () => null,
    querySelectorAll: () => [],
    escapeHtml: value => String(value ?? ''),
    dateTime: value => String(value ?? ''),
    recoveryCardHtml: () => '',
    onRetry: () => { callbacks += 1; },
    onOpenMatches: () => { callbacks += 1; },
    onRemove: () => { callbacks += 1; },
  });

  assert.doesNotThrow(() => module.renderReminderList());
  assert.equal(callbacks, 0);
});
