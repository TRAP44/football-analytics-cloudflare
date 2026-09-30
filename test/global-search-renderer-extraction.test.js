import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGlobalSearchRenderer } from '../public/modules/global-search-renderer.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../public/modules/global-search-renderer.js', import.meta.url), 'utf8');

function button(dataset = {}) {
  return {
    dataset,
    disabled: false,
    textContent: '',
    innerHTML: '',
    hidden: false,
    attrs: {},
    listeners: {},
    classList: { toggle() {} },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { this.listeners.click?.(); },
  };
}

function elements() {
  const map = new Map([
    ['searchResultsWrap', button()],
    ['searchResults', button()],
    ['searchResultsMeta', button()],
    ['searchStatus', button()],
    ['globalSearchBtn', button()],
  ]);
  return {
    map,
    elementById(id) {
      if (!map.has(id)) map.set(id, button());
      return map.get(id);
    },
  };
}

function mergeById(first = [], second = [], idKey = 'id') {
  const seen = new Set();
  const out = [];
  for (const row of [...first, ...second]) {
    const id = Number(row?.[idKey] || 0);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function countLabel(value, one, few, many) {
  const n = Number(value || 0);
  return `${n} ${n === 1 ? one : n < 5 ? few : many}`;
}

function makeRenderer({ state, els, local = {}, callbacks = {}, filters = [] }) {
  return createGlobalSearchRenderer({
    state,
    elementById: els.elementById,
    querySelectorAll: () => filters,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    localDiscoveryResults: () => ({
      teams: local.teams || [],
      competitions: local.competitions || [],
      matches: local.matches || [],
    }),
    mergeById,
    russianCountLabel: countLabel,
    searchTeamSummaryCard: row => `<team>${row.name}</team>`,
    knownTeamSummaryCard: row => `<known>${row.name}</known>`,
    searchCompetitionSummaryCard: row => `<competition>${row.name}</competition>`,
    searchMatchCard: row => `<match>${row.fixtureId}</match>`,
    setDiscoveryHomeVisibility: callbacks.setDiscoveryHomeVisibility || (() => {}),
    onRenderDiscoveryHome: callbacks.onRenderDiscoveryHome,
    onRetry: callbacks.onRetry,
    onBindDiscoveryActions: callbacks.onBindDiscoveryActions,
    onBindSearchMatchActions: callbacks.onBindSearchMatchActions,
    onSetMode: callbacks.onSetMode,
  });
}

test('global search renderer owns presentation only while search lifecycle stays in app root', () => {
  assert.match(rendererSource, /export function createGlobalSearchRenderer/);
  assert.match(rendererSource, /function renderGlobalSearch\(\)/);
  assert.doesNotMatch(rendererSource, /\/api\/search|\bapi\s*\(|sendProductAction|sendActionError/);
  assert.match(app, /async function runGlobalSearch\(/);
  assert.match(app, /\/api\/search\?q=/);
  assert.doesNotMatch(app, /function renderGlobalSearch\(\)/);
});

test('app wires the renderer synchronously with explicit lifecycle callbacks', () => {
  assert.match(app, /import \{ createGlobalSearchRenderer \} from '\.\/modules\/global-search-renderer\.js'/);
  assert.match(app, /const \{ renderGlobalSearch \} = createGlobalSearchRenderer\(\{/);
  assert.match(app, /onRetry: \(\) => runGlobalSearch\(\{ manual:true \}\)/);
  assert.match(app, /onSetMode: mode => setGlobalSearchMode\(mode\)/);
});

test('empty query hides results and returns to discovery home', () => {
  const els = elements();
  const calls = [];
  const state = {
    globalSearch: {
      query: '',
      mode: 'all',
      loading: false,
      remoteTeams: [],
      knownTeams: [],
      remoteCompetitions: [],
      remoteMatches: [],
    },
  };
  const renderer = makeRenderer({
    state,
    els,
    callbacks: {
      setDiscoveryHomeVisibility: visible => calls.push(['visibility', visible]),
      onRenderDiscoveryHome: () => calls.push(['home']),
    },
  });

  renderer.renderGlobalSearch();

  assert.equal(els.map.get('searchResultsWrap').hidden, true);
  assert.equal(els.map.get('searchStatus').innerHTML, '');
  assert.deepEqual(calls, [['visibility', true], ['home']]);
});

test('loading search keeps local results usable and updates filters', () => {
  const els = elements();
  const filter = button({ searchMode: 'all' });
  const calls = [];
  const state = {
    globalSearch: {
      query: 'arsenal',
      mode: 'all',
      loading: true,
      status: 'refreshing',
      remoteTeams: [],
      knownTeams: [],
      remoteCompetitions: [],
      remoteMatches: [],
      resolvedQuery: '',
    },
  };
  const renderer = makeRenderer({
    state,
    els,
    filters: [filter],
    local: { teams: [{ id: 1, name: 'Arsenal' }] },
    callbacks: {
      onBindDiscoveryActions: root => calls.push(['entities', root]),
      onBindSearchMatchActions: root => calls.push(['matches', root]),
    },
  });

  renderer.renderGlobalSearch();

  assert.equal(els.map.get('globalSearchBtn').disabled, true);
  assert.equal(els.map.get('globalSearchBtn').textContent, 'Ищу…');
  assert.match(els.map.get('searchStatus').innerHTML, /Обновляем результаты/);
  assert.match(els.map.get('searchResults').innerHTML, /<team>Arsenal<\/team>/);
  assert.match(els.map.get('searchResultsMeta').textContent, /1 команда/);
  assert.equal(filter.attrs['aria-pressed'], 'true');
  assert.equal(calls.length, 2);
});

test('timeout state preserves retry callback', () => {
  const els = elements();
  const calls = [];
  const state = {
    globalSearch: {
      query: 'inter',
      mode: 'all',
      loading: false,
      status: 'timeout',
      remoteTeams: [],
      knownTeams: [],
      remoteCompetitions: [],
      remoteMatches: [],
    },
  };
  const renderer = makeRenderer({
    state,
    els,
    callbacks: { onRetry: () => calls.push('retry') },
  });

  renderer.renderGlobalSearch();
  els.map.get('searchRetryBtn').click();

  assert.match(els.map.get('searchStatus').innerHTML, /Источник отвечает слишком долго/);
  assert.deepEqual(calls, ['retry']);
});

test('empty filtered result keeps mode-reset action', () => {
  const els = elements();
  const calls = [];
  const state = {
    globalSearch: {
      query: 'unknown',
      mode: 'teams',
      loading: false,
      status: 'empty',
      remoteTeams: [],
      knownTeams: [],
      remoteCompetitions: [],
      remoteMatches: [],
    },
  };
  const renderer = makeRenderer({
    state,
    els,
    callbacks: { onSetMode: mode => calls.push(mode) },
  });

  renderer.renderGlobalSearch();
  els.map.get('searchEmptyAll').click();

  assert.match(els.map.get('searchResults').innerHTML, /Ничего не найдено в этом разделе/);
  assert.deepEqual(calls, ['all']);
});
