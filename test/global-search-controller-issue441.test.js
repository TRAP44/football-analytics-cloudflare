import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createGlobalSearchController,
  discoveryMatchRank,
} from '../public/modules/global-search-controller.js';

function element(value = '') {
  return {
    value,
    dataset: {},
    listeners: {},
    attrs: {},
    classList: { toggle() {} },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
}

function makeState() {
  return {
    matches: [
      {
        fixtureId: 11,
        date: '2026-10-05T12:00:00Z',
        country: 'England',
        leagueId: 39,
        league: 'Premier League',
        leagueShort: 'EPL',
        home: { id: 1, name: 'Arsenal' },
        away: { id: 2, name: 'Chelsea' },
        competition: { tier: 'top' },
      },
    ],
    globalSearch: {
      query: '',
      mode: 'all',
      requestSeq: 0,
      loading: false,
      status: 'idle',
      warning: '',
      resolvedQuery: '',
      remoteTeams: [],
      knownTeams: [],
      remoteCompetitions: [],
      remoteMatches: [],
      matchSourceTeam: '',
      matchDiscovery: null,
      primaryFixtureId: null,
    },
  };
}

function makeController(overrides = {}) {
  const state = overrides.state || makeState();
  const input = element(overrides.inputValue || '');
  const button = element();
  const mode = element();
  mode.dataset.searchMode = 'teams';
  const elements = new Map([
    ['globalSearchInput', input],
    ['globalSearchBtn', button],
  ]);
  const calls = [];
  const timers = [];

  const controller = createGlobalSearchController({
    state,
    elementById: id => elements.get(id),
    querySelectorAll: selector => selector === '[data-search-mode]' ? [mode] : [],
    runtimeAllows: overrides.runtimeAllows || (() => true),
    api: overrides.api || (async () => ({ teams: [], knownTeams: [], competitions: [], matches: [] })),
    renderSearch: () => calls.push(['render']),
    sendProductAction: (...args) => calls.push(['product', ...args]),
    sendOperationTiming: (...args) => calls.push(['timing', ...args]),
    isAdmin: overrides.isAdmin || (() => false),
    renderProvider: () => calls.push(['provider']),
    apiErrorCategory: overrides.apiErrorCategory || (() => 'error'),
    friendlyErrorMessage: overrides.friendlyErrorMessage || (() => 'friendly error'),
    sendActionError: (...args) => calls.push(['error', ...args]),
    toast: message => calls.push(['toast', message]),
    nowIso: () => '2026-10-04T12:00:00.000Z',
    performanceNow: () => 123,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
  });

  return { controller, state, input, button, mode, calls, timers };
}

test('search ranking is directly testable outside app composition root', () => {
  assert.equal(discoveryMatchRank('Arsenal', 'arsenal'), 0);
  assert.equal(discoveryMatchRank('Arsenal Women', 'ars'), 1);
  assert.equal(discoveryMatchRank('Real Madrid', 'mad'), 2);
  assert.equal(discoveryMatchRank('Paris Saint-Germain', 'germain'), 3);
  assert.equal(discoveryMatchRank('Inter', 'xyz'), 99);
});

test('controller owns local discovery ranking and deduplication', () => {
  const { controller } = makeController();
  const result = controller.localDiscoveryResults('ars');
  assert.equal(result.teams.length, 1);
  assert.equal(result.teams[0].name, 'Arsenal');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].fixtureId, 11);
});

test('successful remote search updates bounded search state and analytics', async () => {
  const { controller, state, input, calls } = makeController({
    inputValue: 'Arsenal',
    api: async (url, options) => {
      assert.equal(url, '/api/search?q=Arsenal');
      assert.deepEqual(options, { timeoutMs: 6500, retry: false });
      return {
        teams: [{ id: 1, name: 'Arsenal' }],
        knownTeams: [],
        competitions: [],
        matches: [{ fixtureId: 12, date: '2026-10-06T12:00:00Z' }],
        matchSource: { name: 'Arsenal' },
        matchDiscovery: { primaryFixtureId: 12 },
        resolvedQuery: 'Arsenal',
      };
    },
  });
  input.value = 'Arsenal';

  await controller.runGlobalSearch();

  assert.equal(state.globalSearch.loading, false);
  assert.equal(state.globalSearch.status, 'found');
  assert.equal(state.globalSearch.remoteMatches[0].fixtureId, 12);
  assert.equal(state.globalSearch.primaryFixtureId, 12);
  assert.equal(state.globalSearch.searchedAt, '2026-10-04T12:00:00.000Z');
  assert.ok(calls.some(row => row[0] === 'product' && row[1] === 'search_used'));
  assert.ok(calls.some(row => row[0] === 'product' && row[1] === 'search_found'));
  assert.ok(calls.some(row => row[0] === 'timing' && row[1] === 'search'));
});

test('runtime-disabled remote search fails soft without calling API', async () => {
  let apiCalls = 0;
  const { controller, state, input } = makeController({
    inputValue: 'Arsenal',
    runtimeAllows: () => false,
    api: async () => { apiCalls += 1; return {}; },
  });
  input.value = 'Arsenal';

  await controller.runGlobalSearch({ manual: true });

  assert.equal(apiCalls, 0);
  assert.equal(state.globalSearch.status, 'done');
  assert.match(state.globalSearch.warning, /Удалённый поиск временно недоступен/);
});

test('controller owns input debounce, Enter submit, and mode controls', async () => {
  const { controller, state, input, button, mode, timers } = makeController({
    api: async () => ({ teams: [], knownTeams: [], competitions: [], matches: [] }),
  });
  controller.bindGlobalSearchControls();

  input.value = 'ars';
  input.listeners.input({ target: input });
  assert.equal(state.globalSearch.query, 'ars');
  assert.equal(state.globalSearch.status, 'local');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 500);

  let prevented = false;
  await input.listeners.keydown({ key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);

  mode.listeners.click();
  assert.equal(state.globalSearch.mode, 'teams');

  button.listeners.click();
});

test('app root only wires the extracted controller', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const controller = fs.readFileSync(new URL('../public/modules/global-search-controller.js', import.meta.url), 'utf8');

  assert.match(app, /createGlobalSearchController/);
  assert.match(app, /bindGlobalSearchControls\(\)/);
  assert.doesNotMatch(app, /async function runGlobalSearch\(/);
  assert.doesNotMatch(app, /function discoveryMatchRank\(/);
  assert.doesNotMatch(app, /let globalSearchTimer/);
  assert.match(controller, /async function runGlobalSearch\(/);
  assert.match(controller, /function handleSearchInput\(/);
  assert.match(controller, /\/api\/search\?q=/);
});
