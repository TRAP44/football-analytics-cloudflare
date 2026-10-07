import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_UI_PREFERENCES,
  UI_PREFERENCES_KEY,
  readUiPreferences,
} from '../public/modules/app-runtime.js';
import { createInterfacePreferencesController } from '../public/modules/ui-preferences.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('home prioritizes a personal daily overview with three always-visible quick filters', () => {
  assert.match(html, /id="dailyOverview"/);
  const primaryStrip = html.match(/<div class="filter-strip home-quick-filter-strip" id="filterStrip"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  assert.equal((primaryStrip.match(/class="filter-btn/g) || []).length, 3);
  for (const filter of ['top', 'live', 'all']) assert.match(primaryStrip, new RegExp(`data-filter="${filter}"`));
  assert.doesNotMatch(primaryStrip, /data-filter="favorites"/);
  assert.match(html, /class="home-filter-drawer league-filter-drawer"/);
});

function preferenceButton(dataset) {
  const classes = new Set();
  const attributes = new Map();
  return {
    dataset: { ...dataset },
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
  };
}

function createPreferenceHarness({ storageFailure = false } = {}) {
  const themeButtons = ['system', 'dark', 'light', 'ocean']
    .map(themeChoice => preferenceButton({ themeChoice }));
  const accentButtons = ['system', 'green', 'blue', 'violet', 'amber']
    .map(accentChoice => preferenceButton({ accentChoice }));
  const styleButtons = ['soft', 'compact']
    .map(buttonStyleChoice => preferenceButton({ buttonStyleChoice }));
  const rootStyle = new Map();
  const root = {
    dataset: {},
    style: {
      setProperty(name, value) {
        rootStyle.set(name, value);
      },
      removeProperty(name) {
        rootStyle.delete(name);
      },
    },
  };
  const summary = { textContent: '' };
  const meta = {
    content: '',
    setAttribute(name, value) {
      if (name === 'content') this.content = value;
    },
  };
  const writes = [];
  const toasts = [];
  const telegramColors = [];
  const storage = {
    setItem(key, value) {
      if (storageFailure) throw new Error('storage unavailable');
      writes.push([key, value]);
    },
  };
  const document = {
    documentElement: root,
    querySelectorAll(selector) {
      if (selector === '[data-theme-choice]') return themeButtons;
      if (selector === '[data-accent-choice]') return accentButtons;
      if (selector === '[data-button-style-choice]') return styleButtons;
      return [];
    },
    getElementById(id) {
      return id === 'advancedAppearanceSummary' ? summary : null;
    },
    querySelector(selector) {
      return selector === 'meta[name="theme-color"]' ? meta : null;
    },
  };
  const window = {
    matchMedia() {
      return { matches: false };
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    getComputedStyle() {
      return {
        getPropertyValue(name) {
          return name === '--bg' ? '#07111f' : '';
        },
      };
    },
  };
  const tg = {
    colorScheme: 'dark',
    setHeaderColor(value) {
      telegramColors.push(['header', value]);
    },
    setBackgroundColor(value) {
      telegramColors.push(['background', value]);
    },
  };
  const state = { uiPreferences: { ...DEFAULT_UI_PREFERENCES } };
  const controller = createInterfacePreferencesController({
    document,
    window,
    tg,
    state,
    storage,
    toast: message => toasts.push(message),
  });

  return {
    controller,
    state,
    root,
    rootStyle,
    summary,
    meta,
    writes,
    toasts,
    telegramColors,
    themeButtons,
    accentButtons,
    styleButtons,
  };
}

test('stored interface preferences are normalized before entering runtime state', () => {
  const storage = {
    getItem(key) {
      assert.equal(key, UI_PREFERENCES_KEY);
      return JSON.stringify({
        theme: 'not-a-theme',
        accent: 'blue',
        buttonStyle: 'compact',
      });
    },
  };

  assert.deepEqual(readUiPreferences(storage), {
    theme: 'system',
    accent: 'blue',
    buttonStyle: 'compact',
  });
});

test('interface preference mutations persist validated state and update visible controls', () => {
  const harness = createPreferenceHarness();

  assert.equal(harness.controller.saveInterfacePreference('accent', 'violet'), true);
  assert.equal(harness.controller.saveInterfacePreference('theme', 'ocean'), true);
  assert.equal(harness.controller.saveInterfacePreference('buttonStyle', 'compact'), true);

  assert.deepEqual(harness.state.uiPreferences, {
    theme: 'ocean',
    accent: 'violet',
    buttonStyle: 'compact',
  });
  assert.equal(harness.root.dataset.theme, 'ocean');
  assert.equal(harness.root.dataset.accent, 'violet');
  assert.equal(harness.root.dataset.buttonStyle, 'compact');
  assert.equal(harness.rootStyle.get('--accent'), '#c084fc');
  assert.equal(harness.summary.textContent, 'Океан · Фиолетовый акцент · Строгие кнопки');
  assert.equal(harness.meta.content, '#07111f');
  assert.equal(
    harness.accentButtons.find(button => button.dataset.accentChoice === 'violet')
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    harness.styleButtons.find(button => button.dataset.buttonStyleChoice === 'compact')
      .classList.contains('active'),
    true,
  );
  assert.deepEqual(JSON.parse(harness.writes.at(-1)[1]), harness.state.uiPreferences);
  assert.equal(harness.writes.at(-1)[0], UI_PREFERENCES_KEY);
  assert.deepEqual(harness.telegramColors.at(-2), ['header', '#07111f']);
  assert.deepEqual(harness.telegramColors.at(-1), ['background', '#07111f']);
  assert.equal(harness.toasts.at(-1), 'Оформление применено');
});

test('interface preference mutations fail closed on unknown keys and values', () => {
  const harness = createPreferenceHarness();
  const original = { ...harness.state.uiPreferences };

  for (const [key, value] of [
    ['theme', 'javascript:alert(1)'],
    ['accent', 'red'],
    ['buttonStyle', 'huge'],
    ['unknown', 'dark'],
  ]) {
    assert.equal(harness.controller.saveInterfacePreference(key, value), false);
  }

  assert.deepEqual(harness.state.uiPreferences, original);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.toasts.length, 0);
  assert.deepEqual(harness.root.dataset, {});
});

test('storage failure keeps the safe session preference without claiming persistence', () => {
  const harness = createPreferenceHarness({ storageFailure: true });

  assert.equal(harness.controller.saveInterfacePreference('accent', 'green'), false);
  assert.equal(harness.state.uiPreferences.accent, 'green');
  assert.equal(harness.root.dataset.accent, 'green');
  assert.equal(harness.rootStyle.get('--accent'), '#57e389');
  assert.equal(
    harness.toasts.at(-1),
    'Оформление применено до закрытия приложения',
  );
});

test('advanced appearance stays progressively disclosed in the interface', () => {
  for (const theme of ['system', 'dark', 'light', 'ocean']) {
    assert.match(html, new RegExp(`data-theme-choice="${theme}"`));
  }
  assert.match(html, /id="advancedAppearance"/);
  assert.match(html, /id="advancedAppearanceSummary">По умолчанию/);
  assert.match(html, /class="theme-options theme-options-primary"/);
  assert.match(html, /class="theme-options theme-options-extra"/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /:root\[data-theme="ocean"\]/);
  assert.match(css, /:root\[data-button-style="compact"\]/);
});

test('match cards hide technical coverage and numeric interest meters', () => {
  const cardRenderer = app.match(/function matchCardHtml[\s\S]*?\n}\n\nfunction bindMatchActions/)?.[0] || '';
  assert.doesNotMatch(cardRenderer, /coverage-mini/);
  assert.doesNotMatch(cardRenderer, /interest-meter/);
  assert.match(cardRenderer, /match-secondary-actions/);
  assert.doesNotMatch(cardRenderer, /match-signal|favorite-signal/);
});

test('admin opens with an owner dashboard while rare validation and model tools stay on demand', () => {
  for (const id of [
    'adminOverviewService',
    'adminOverviewSource',
    'adminOverviewDatabase',
    'adminOverviewNotifications',
    'adminOverviewAi',
  ]) assert.match(adminHtml, new RegExp(`id="${id}"`));
  assert.match(adminHtml, /OWNER DASHBOARD/);
  assert.match(adminHtml, /Расширенные инструменты/);
  assert.doesNotMatch(adminHtml, /class="admin-console-actions"/);
  assert.match(adminHtml, /id="adminAdvancedTools"/);
  assert.match(adminHtml, /id="adminAdvancedContent"/);

  const organizeStart = app.indexOf('function organizeAdminConsole()');
  const organizeEnd = app.indexOf('async function loadAdvancedAdminTools()', organizeStart);
  const organize = app.slice(organizeStart, organizeEnd);
  assert.match(organize, /#betaHealthPanel/);
  assert.match(organize, /#betaDashboardPanel/);

  const advancedStart = app.indexOf('async function loadAdvancedAdminTools()');
  const advancedEnd = app.indexOf('function planLabel', advancedStart);
  const advanced = app.slice(advancedStart, advancedEnd);
  assert.match(advanced, /loadBetaDashboard\(false\)/);
  assert.match(advanced, /loadModelQuality\(false\)/);

  const profileStart = app.indexOf('async function openProfileView');
  const profileEnd = app.indexOf('let adminReleaseReadinessModule', profileStart);
  assert.ok(profileStart >= 0 && profileEnd > profileStart);
  const profileOpen = app.slice(profileStart, profileEnd);
  assert.match(profileOpen, /loadRuntimeControlsAdmin\(false\)/);
  assert.match(profileOpen, /loadDiagnostics\(false\)/);
  assert.match(profileOpen, /loadReminderHealth\(false\)/);
  assert.doesNotMatch(profileOpen, /loadBetaDashboard\(false\)/);
  assert.doesNotMatch(profileOpen, /loadModelQuality\(false\)/);
});
