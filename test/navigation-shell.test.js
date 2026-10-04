import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNavigationShell } from '../public/modules/navigation-shell.js';

const VIEW_IDS = [
  'matchesView',
  'searchView',
  'myTeamsView',
  'tournamentView',
  'teamView',
  'playerView',
  'analysisView',
  'historyView',
  'profileView',
];

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(id, classes = []) {
    this.id = id;
    this.classList = new FakeClassList(classes);
    this.hidden = false;
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  toggleAttribute(name, force) {
    const enabled = force === undefined ? !this.attributes.has(name) : Boolean(force);
    if (enabled) this.attributes.set(name, '');
    else this.attributes.delete(name);
    return enabled;
  }
  contains(node) { return node?.ownerView === this; }
}

function createHarness({
  initialView = 'matchesView',
  resolveBackTarget = view => view === 'analysisView' ? 'teamView' : 'matchesView',
  onLeaveView,
  onEffectError,
} = {}) {
  const elements = Object.fromEntries(VIEW_IDS.map(id => [id, new FakeElement(id, ['view'])]));
  const navIds = ['navMatches', 'navMyTeams', 'navHistory', 'navProfile'];
  for (const id of navIds) elements[id] = new FakeElement(id, ['nav-item']);
  elements.topbarTitle = new FakeElement('topbarTitle');

  if (initialView && elements[initialView]) {
    elements[initialView].classList.add('active');
  }
  elements.navMatches.classList.add('active');
  elements.navMatches.setAttribute('aria-current', 'page');

  const document = {
    activeElement: null,
    querySelector(selector) {
      if (selector === '.view.active') {
        return VIEW_IDS.map(id => elements[id]).find(view => view.classList.contains('active')) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.nav-item') return navIds.map(id => elements[id]);
      return [];
    },
  };

  const window = {
    scrollY: 0,
    scrollCalls: [],
    requestAnimationFrame(callback) { callback(); },
    scrollTo(options) {
      this.scrollCalls.push(options);
      this.scrollY = Number(options?.top || 0);
    },
  };

  const effects = [];
  const shell = createNavigationShell({
    window,
    document,
    elementById: id => elements[id] || null,
    viewIds: VIEW_IDS,
    homeView: 'matchesView',
    resolveBackTarget,
    syncTopbar: id => effects.push(['topbar', id]),
    syncBackButtons: () => effects.push(['back-buttons']),
    syncTelegramBackButton: id => effects.push(['telegram-back', id]),
    onLeaveView,
    onEffectError,
  });

  return { shell, elements, document, window, effects, navIds };
}

test('showView activates only the requested view and hides/inerts the rest', () => {
  const { shell, elements } = createHarness();
  shell.showView('teamView');

  for (const id of VIEW_IDS) {
    const active = id === 'teamView';
    assert.equal(elements[id].classList.contains('active'), active, id);
    assert.equal(elements[id].hidden, !active, id);
    assert.equal(elements[id].hasAttribute('inert'), !active, id);
    assert.equal(elements[id].getAttribute('aria-hidden'), active ? 'false' : 'true', id);
  }
});

test('bottom navigation has one active aria-current item and clears the previous item', () => {
  const { shell, elements, navIds } = createHarness();
  shell.showView('historyView');

  const active = navIds.filter(id => elements[id].classList.contains('active'));
  const current = navIds.filter(id => elements[id].getAttribute('aria-current') === 'page');
  assert.deepEqual(active, ['navHistory']);
  assert.deepEqual(current, ['navHistory']);

  shell.showView('profileView');
  assert.equal(elements.navHistory.classList.contains('active'), false);
  assert.equal(elements.navHistory.hasAttribute('aria-current'), false);
  assert.equal(elements.navProfile.classList.contains('active'), true);
  assert.equal(elements.navProfile.getAttribute('aria-current'), 'page');
});

test('scroll restoration is isolated per view and bounded to known views', () => {
  const { shell, window } = createHarness();
  window.scrollY = 420;
  shell.showView('teamView');

  window.scrollY = 88;
  shell.showView('analysisView');
  shell.showView('teamView', { restore: true });
  assert.equal(window.scrollCalls.at(-1).top, 88);

  shell.showView('matchesView', { restore: true });
  assert.equal(window.scrollCalls.at(-1).top, 420);
});

test('Back uses the injected parent resolver and restores the parent view', () => {
  const { shell } = createHarness({
    resolveBackTarget: view => view === 'analysisView' ? 'teamView' : 'matchesView',
  });

  shell.showView('analysisView');
  assert.equal(shell.handleBackNavigation(), true);
  assert.equal(shell.activeViewId(), 'teamView');
  assert.equal(shell.handleBackNavigation(), true);
  assert.equal(shell.activeViewId(), 'matchesView');
  assert.equal(shell.handleBackNavigation(), false);
});

test('direct initial navigation does not require an intermediate visible view', () => {
  const { shell, elements } = createHarness({ initialView: null });
  shell.showView('tournamentView');

  assert.equal(shell.activeViewId(), 'tournamentView');
  assert.equal(elements.tournamentView.hidden, false);
  assert.equal(elements.matchesView.hidden, true);
});

test('onboarding-style Search to Home navigation uses the same shell contract', () => {
  const { shell } = createHarness();
  shell.showView('searchView');
  assert.equal(shell.activeViewId(), 'searchView');
  shell.showView('matchesView');
  assert.equal(shell.activeViewId(), 'matchesView');
});

test('leave-view lifecycle callback is explicit and runs after DOM navigation commits', () => {
  const observations = [];
  let harness;
  harness = createHarness({
    onLeaveView: context => {
      observations.push({
        ...context,
        activeAtCallback: harness.shell.activeViewId(),
      });
    },
  });

  harness.shell.showView('analysisView');
  assert.equal(observations.length, 1);
  assert.equal(observations[0].from, 'matchesView');
  assert.equal(observations[0].to, 'analysisView');
  assert.equal(observations[0].activeAtCallback, 'analysisView');
});

test('optional lifecycle failure cannot leave a half-switched DOM state', () => {
  const errors = [];
  const { shell, elements } = createHarness({
    onLeaveView: () => { throw new Error('lifecycle failed'); },
    onEffectError: (error, context) => errors.push([error.message, context.effect]),
  });

  assert.doesNotThrow(() => shell.showView('teamView'));
  assert.equal(elements.teamView.hidden, false);
  assert.equal(elements.matchesView.hidden, true);
  assert.deepEqual(errors, [['lifecycle failed', 'onLeaveView']]);
});

test('focus is released before its old view becomes hidden', () => {
  const { shell, elements, document } = createHarness();
  const focused = {
    ownerView: elements.matchesView,
    blurred: false,
    blur() { this.blurred = true; },
  };
  document.activeElement = focused;

  shell.showView('searchView');
  assert.equal(focused.blurred, true);
  assert.equal(elements.matchesView.hidden, true);
});

test('regression guard keeps navigation shell generic while Match Center owns live refresh', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const shell = fs.readFileSync('public/modules/navigation-shell.js', 'utf8');
  const matchCenterController = fs.readFileSync('public/modules/match-center-controller.js', 'utf8');

  assert.match(app, /function deactivateLiveRefresh\(\)[\s\S]*?matchCenterController\?\.deactivateLiveRefresh\(\)/);
  assert.match(app, /onLeaveView:\s*\(\{ from, to, options \}\) => \{[\s\S]*?deactivateLiveRefresh\(\)/);
  assert.match(matchCenterController, /function stopLiveRefresh\(\)/);
  assert.match(matchCenterController, /let liveRefreshTimer = null/);
  assert.doesNotMatch(shell, /stopLiveRefresh|liveRefreshTimer|provider|supabase|api\(/i);
  assert.match(app, /createFirstRunGuideController\([\s\S]*?showView:\s*\(id, options\) => showView\(id, options\)/);
  assert.match(app, /function applyLaunchIntent\(\)[\s\S]*?showView\('searchView'\)/);
});
