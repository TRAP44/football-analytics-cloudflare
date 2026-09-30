import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProfileSummaryModule } from '../public/modules/profile-summary.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/modules/profile-summary.js', import.meta.url), 'utf8');

function plainElement() {
  return {
    textContent: '',
    value: '',
    hidden: false,
    checked: false,
    children: [],
    querySelector() { return null; },
    replaceChildren(...children) { this.children = children; },
    classList: {
      values: new Set(),
      add(name) { this.values.add(name); },
      remove(name) { this.values.delete(name); },
      contains(name) { return this.values.has(name); },
    },
  };
}

function imageElement() {
  return {
    src: '',
    alt: '',
    loading: '',
    decoding: '',
    referrerPolicy: '',
    listeners: new Map(),
    addEventListener(type, handler, options) {
      this.listeners.set(type, { handler, options });
    },
  };
}

function createElements() {
  const ids = [
    'profileBtn','quotaText','profileName','avatar','profileUsername','profilePlan','profileUsage',
    'memberSince','favoriteCount','reminderCount','defaultFilterSelect','reminderMinutesSelect',
    'kickoffNotificationToggle','hideYouthToggle','favoriteFirstToggle',
  ];
  const elements = new Map(ids.map(id => [id, plainElement()]));
  const buttonLabel = plainElement();
  elements.get('profileBtn').querySelector = selector => selector === 'span' ? buttonLabel : null;
  return { elements, buttonLabel };
}

function createModule({ state, elements, safeUrl = value => String(value || ''), createdImages = [] }) {
  return createProfileSummaryModule({
    state,
    elementById: id => elements.get(id) || null,
    safeUrl,
    dateOnly: value => value === '2026-01-02T00:00:00Z' ? '02.01.2026' : String(value || ''),
    planLabel: value => value === 'FREE' ? 'Бесплатный' : String(value || ''),
    createImageElement: () => {
      const img = imageElement();
      createdImages.push(img);
      return img;
    },
  });
}

test('profile summary implementation lives outside app without capturing profile orchestration', () => {
  assert.match(app, /import \{ createProfileSummaryModule \} from '\.\/modules\/profile-summary\.js'/);
  assert.match(app, /const \{ renderProfileSummary \} = createProfileSummaryModule\(\{/);
  assert.match(app, /function renderProfile\(\) \{[\s\S]*renderProfileSummary\(\);/);
  assert.doesNotMatch(app, /const profileButtonLabel = \$\('profileBtn'\)/);
  assert.match(source, /export function createProfileSummaryModule/);
  assert.match(source, /function renderProfileSummary\(\)/);
  assert.doesNotMatch(source, /renderBilling|applyAdminVisibility|applyRuntimeUi|renderAdminOverview|renderFavoriteTeams|renderReminderList|\bapi\s*\(|fetch\s*\(/);
});

test('renderProfile keeps business and composition orchestration in app root', () => {
  const start = app.indexOf('function renderProfile()');
  const end = app.indexOf('\nfunction outcomeShortLabel', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  for (const call of [
    'renderProfileSummary();',
    'applyInterfacePreferences();',
    'renderFavoriteTeams();',
    'renderMyTeams();',
    'renderReminderList();',
    'renderBilling();',
    'applyAdminVisibility();',
    'renderDataCapabilities();',
    'applyRuntimeUi();',
    'renderAdminOverview();',
  ]) assert.ok(boundary.includes(call), call);
  assert.match(boundary, /state\.runtimeStatus = state\.profile\.features\.runtime/);
});

test('profile summary renders identity quota counts and preferences from existing state', () => {
  const { elements, buttonLabel } = createElements();
  const state = {
    profile: {
      user: {
        firstName: 'Anna',
        username: 'anna',
        createdAt: '2026-01-02T00:00:00Z',
        photoUrl: '',
      },
      quota: { plan: 'FREE', used: 2, limit: 10, left: 2 },
      stats: { favorites: 4, reminders: 3 },
    },
    profileStale: false,
    favorites: [{}, {}],
    reminders: [{}],
    preferences: {
      defaultFilter: 'live',
      reminderMinutes: 15,
      kickoffNotification: false,
      hideYouth: false,
      favoriteFirst: true,
    },
  };
  const module = createModule({ state, elements });

  module.renderProfileSummary();

  assert.equal(buttonLabel.textContent, 'Профиль');
  assert.equal(elements.get('quotaText').hidden, false);
  assert.equal(elements.get('quotaText').textContent, 'Осталось анализов: 2 из 10');
  assert.equal(elements.get('profileName').textContent, 'Anna');
  assert.equal(elements.get('avatar').textContent, '⚽');
  assert.equal(elements.get('profileUsername').textContent, '@anna');
  assert.equal(elements.get('profilePlan').textContent, 'Бесплатный');
  assert.equal(elements.get('profileUsage').textContent, '2 / 10');
  assert.equal(elements.get('memberSince').textContent, 'С нами с 02.01.2026');
  assert.equal(elements.get('favoriteCount').textContent, '4');
  assert.equal(elements.get('reminderCount').textContent, '3');
  assert.equal(elements.get('defaultFilterSelect').value, 'live');
  assert.equal(elements.get('reminderMinutesSelect').value, '15');
  assert.equal(elements.get('kickoffNotificationToggle').checked, false);
  assert.equal(elements.get('hideYouthToggle').checked, false);
  assert.equal(elements.get('favoriteFirstToggle').checked, true);
});

test('profile summary preserves stale quota fallback and state count fallbacks', () => {
  const { elements } = createElements();
  const state = {
    profile: {
      user: { firstName: '', username: '', createdAt: '', photoUrl: '' },
      quota: { plan: 'FREE', used: 7, limit: 10, left: 8 },
      stats: {},
    },
    profileStale: true,
    favorites: [{}, {}, {}],
    reminders: [{}, {}],
    preferences: {},
  };
  const module = createModule({ state, elements });

  module.renderProfileSummary();

  assert.equal(elements.get('quotaText').hidden, false);
  assert.equal(elements.get('quotaText').textContent, 'Показаны сохранённые данные профиля');
  assert.equal(elements.get('profileName').textContent, 'Пользователь');
  assert.equal(elements.get('profileUsername').textContent, '');
  assert.equal(elements.get('memberSince').textContent, '');
  assert.equal(elements.get('favoriteCount').textContent, '3');
  assert.equal(elements.get('reminderCount').textContent, '2');
  assert.equal(elements.get('defaultFilterSelect').value, 'top');
  assert.equal(elements.get('reminderMinutesSelect').value, '30');
  assert.equal(elements.get('kickoffNotificationToggle').checked, true);
  assert.equal(elements.get('hideYouthToggle').checked, true);
  assert.equal(elements.get('favoriteFirstToggle').checked, true);
});

test('profile summary keeps Telegram photo URL safety and avatar load/error behavior explicit', () => {
  const { elements } = createElements();
  const images = [];
  const state = {
    profile: {
      user: { firstName: 'Anna', username: '', createdAt: '', photoUrl: 'telegram-photo' },
      quota: { plan: 'FREE', used: 0, limit: 10, left: 10 },
      stats: {},
    },
    profileStale: false,
    favorites: [],
    reminders: [],
    preferences: {},
  };
  const module = createModule({
    state,
    elements,
    safeUrl: value => value === 'telegram-photo' ? 'https://safe.example/avatar.jpg' : '',
    createdImages: images,
  });

  module.renderProfileSummary();

  assert.equal(images.length, 1);
  const img = images[0];
  assert.equal(img.src, 'https://safe.example/avatar.jpg');
  assert.equal(img.alt, 'Фото профиля Anna');
  assert.equal(img.loading, 'eager');
  assert.equal(img.decoding, 'async');
  assert.equal(img.referrerPolicy, 'no-referrer');
  assert.deepEqual(img.listeners.get('load').options, { once: true });
  assert.deepEqual(img.listeners.get('error').options, { once: true });
  assert.equal(elements.get('avatar').children[0], img);

  img.listeners.get('load').handler();
  assert.equal(elements.get('avatar').classList.contains('has-photo'), true);

  img.listeners.get('error').handler();
  assert.equal(elements.get('avatar').classList.contains('has-photo'), false);
  assert.equal(elements.get('avatar').textContent, '⚽');
});

test('missing profile state is a no-op without DOM access', () => {
  let domReads = 0;
  const module = createProfileSummaryModule({
    state: { profile: null },
    elementById: () => { domReads += 1; throw new Error('DOM must not be touched'); },
    safeUrl: value => String(value || ''),
    dateOnly: value => String(value || ''),
    planLabel: value => String(value || ''),
    createImageElement: () => imageElement(),
  });

  assert.doesNotThrow(() => module.renderProfileSummary());
  assert.equal(domReads, 0);
});
