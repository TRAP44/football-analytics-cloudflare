import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProfileSummaryModule } from '../public/modules/profile-summary.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/modules/profile-summary.js', import.meta.url), 'utf8');

function classList() {
  const values = new Set();
  return {
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

function element() {
  return {
    textContent: '',
    hidden: false,
    value: '',
    checked: false,
    classList: classList(),
    children: [],
    span: null,
    querySelector(selector) { return selector === 'span' ? this.span : null; },
    replaceChildren(...children) { this.children = children; },
  };
}

function imageElement() {
  const listeners = new Map();
  return {
    src: '',
    alt: '',
    loading: '',
    decoding: '',
    referrerPolicy: '',
    addEventListener(type, handler, options) { listeners.set(type, { handler, options }); },
    emit(type) { listeners.get(type)?.handler(); },
    listener(type) { return listeners.get(type); },
  };
}

function createElements() {
  const profileBtn = element();
  profileBtn.span = element();
  return new Map([
    ['profileBtn', profileBtn],
    ['quotaText', element()],
    ['profileName', element()],
    ['avatar', element()],
    ['profileUsername', element()],
    ['profilePlan', element()],
    ['profileUsage', element()],
    ['memberSince', element()],
    ['favoriteCount', element()],
    ['reminderCount', element()],
  ]);
}

function createModule({ state, elements = createElements(), image = imageElement() }) {
  return {
    elements,
    image,
    module: createProfileSummaryModule({
      state,
      elementById: id => elements.get(id) || null,
      safeUrl: value => /^https:\/\//.test(String(value || '')) ? String(value) : '',
      planLabel: value => value === 'FREE' ? 'Бесплатный' : String(value || '—'),
      dateOnly: value => value ? '30.09.2026' : '',
      createElement: tag => {
        assert.equal(tag, 'img');
        return image;
      },
    }),
  };
}

test('profile summary implementation lives outside app while profile orchestration stays in composition root', () => {
  assert.match(app, /import \{ createProfileSummaryModule \} from '\.\/modules\/profile-summary\.js'/);
  assert.match(app, /const \{ renderProfileSummary \} = createProfileSummaryModule\(\{/);
  assert.match(app, /function renderProfile\(\) \{[\s\S]*renderProfileSummary\(\);/);
  assert.doesNotMatch(app, /const photoUrl = safeUrl\(user\.photoUrl\)/);
  assert.match(source, /export function createProfileSummaryModule/);
  assert.match(source, /function renderProfileSummary\(\)/);

  for (const rootConcern of [
    'applyInterfacePreferences',
    'renderFavoriteTeams',
    'renderMyTeams',
    'renderReminderList',
    'renderBilling',
    'applyAdminVisibility',
    'renderDataCapabilities',
    'applyRuntimeUi',
    'renderAdminOverview',
  ]) {
    assert.equal(source.includes(rootConcern), false, rootConcern + ' must stay out of profile summary');
    assert.equal(app.includes(rootConcern), true, rootConcern + ' must remain in app root');
  }
});

test('profile summary renders identity, quota, usage and counters from existing state', () => {
  const state = {
    profileStale: false,
    favorites: [{}, {}],
    reminders: [{}],
    profile: {
      user: {
        firstName: 'Alex',
        username: 'matchradar',
        createdAt: '2026-09-01T00:00:00Z',
        photoUrl: '',
      },
      quota: { plan: 'FREE', used: 2, limit: 10, left: 8 },
      stats: { favorites: 5, reminders: 4 },
    },
  };
  const { module, elements } = createModule({ state });

  module.renderProfileSummary();

  assert.equal(elements.get('profileBtn').span.textContent, 'Профиль');
  assert.equal(elements.get('quotaText').hidden, true);
  assert.equal(elements.get('quotaText').textContent, 'Осталось анализов: 8 из 10');
  assert.equal(elements.get('profileName').textContent, 'Alex');
  assert.equal(elements.get('profileUsername').textContent, '@matchradar');
  assert.equal(elements.get('profilePlan').textContent, 'Бесплатный');
  assert.equal(elements.get('profileUsage').textContent, '2 / 10');
  assert.equal(elements.get('memberSince').textContent, 'С нами с 30.09.2026');
  assert.equal(elements.get('favoriteCount').textContent, '5');
  assert.equal(elements.get('reminderCount').textContent, '4');
});

test('profile summary preserves low-quota and stale-profile visibility semantics', () => {
  const baseProfile = {
    user: { firstName: '', username: '', createdAt: '', photoUrl: '' },
    quota: { plan: 'PRO', used: 7, limit: 10, left: 3 },
    stats: {},
  };

  const low = createModule({
    state: { profile: baseProfile, profileStale: false, favorites: [{}, {}], reminders: [{}, {}, {}] },
  });
  low.module.renderProfileSummary();
  assert.equal(low.elements.get('quotaText').hidden, false);
  assert.equal(low.elements.get('quotaText').textContent, 'Осталось анализов: 3 из 10');
  assert.equal(low.elements.get('profileName').textContent, 'Пользователь');
  assert.equal(low.elements.get('favoriteCount').textContent, '2');
  assert.equal(low.elements.get('reminderCount').textContent, '3');

  const stale = createModule({
    state: {
      profile: { ...baseProfile, quota: { ...baseProfile.quota, left: 9 } },
      profileStale: true,
      favorites: [],
      reminders: [],
    },
  });
  stale.module.renderProfileSummary();
  assert.equal(stale.elements.get('quotaText').hidden, false);
  assert.equal(stale.elements.get('quotaText').textContent, 'Показаны сохранённые данные профиля');
});

test('profile avatar keeps safe-url image lifecycle and football fallback', () => {
  const state = {
    profileStale: false,
    favorites: [],
    reminders: [],
    profile: {
      user: {
        firstName: 'Alex',
        username: '',
        createdAt: '',
        photoUrl: 'https://example.com/avatar.jpg',
      },
      quota: { plan: 'PRO', used: 0, limit: 10, left: 10 },
      stats: {},
    },
  };
  const { module, elements, image } = createModule({ state });
  const avatar = elements.get('avatar');

  module.renderProfileSummary();

  assert.equal(avatar.children.length, 1);
  assert.equal(avatar.children[0], image);
  assert.equal(image.src, 'https://example.com/avatar.jpg');
  assert.equal(image.alt, 'Фото профиля Alex');
  assert.equal(image.loading, 'eager');
  assert.equal(image.decoding, 'async');
  assert.equal(image.referrerPolicy, 'no-referrer');
  assert.deepEqual(image.listener('load').options, { once: true });
  assert.deepEqual(image.listener('error').options, { once: true });

  image.emit('load');
  assert.equal(avatar.classList.contains('has-photo'), true);

  image.emit('error');
  assert.equal(avatar.classList.contains('has-photo'), false);
  assert.equal(avatar.textContent, '⚽');
});

test('missing profile short-circuits without touching DOM', () => {
  let domReads = 0;
  const module = createProfileSummaryModule({
    state: { profile: null, favorites: [], reminders: [], profileStale: false },
    elementById: () => { domReads += 1; return null; },
    safeUrl: value => String(value || ''),
    planLabel: value => String(value || ''),
    dateOnly: value => String(value || ''),
    createElement: () => imageElement(),
  });

  assert.doesNotThrow(() => module.renderProfileSummary());
  assert.equal(domReads, 0);
});
