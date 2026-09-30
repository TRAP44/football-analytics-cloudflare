import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFavoriteTeamsRenderer } from '../public/modules/favorite-teams-renderer.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/modules/favorite-teams-renderer.js', import.meta.url), 'utf8');

function button(dataset = {}) {
  return {
    dataset: { ...dataset },
    listeners: new Map(),
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    click() { this.listeners.get('click')?.(); },
  };
}

function createRoot() {
  return {
    innerHTML: '',
    removeButtons: [],
    openButtons: [],
    querySelectorAll(selector) {
      if (selector === '.favorite-remove') return this.removeButtons;
      if (selector === '[data-open-team]') return this.openButtons;
      return [];
    },
  };
}

function createHarness(overrides = {}) {
  const root = createRoot();
  const retry = button();
  const emptyRetry = button();
  const matches = button();
  const elements = new Map([
    ['favoriteTeams', root],
    ['favoritesRetry', retry],
    ['favoritesEmptyRetry', emptyRetry],
    ['favoritesEmptyMatches', matches],
  ]);
  const state = {
    favorites: [],
    favoritesLoading: false,
    favoritesLoaded: false,
    favoritesLoadError: '',
    favoriteMutations: new Set(),
    ...overrides.state,
  };
  const calls = { retry: 0, matches: 0, remove: [], open: [] };
  const module = createFavoriteTeamsRenderer({
    state,
    elementById: id => elements.get(id) || null,
    escapeHtml: value => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
    safeUrl: value => String(value || '').startsWith('https://') ? String(value) : '',
    recoveryCardHtml: ({ title, message, retryId }) =>
      `<div class="recovery"><strong>${title}</strong><p>${message}</p><button id="${retryId}">retry</button></div>`,
    onRetryLoad: () => { calls.retry += 1; },
    onShowMatches: () => { calls.matches += 1; },
    onRemoveFavorite: team => { calls.remove.push(team); },
    onOpenTeam: team => { calls.open.push(team); },
  });
  return { module, state, root, elements, calls };
}

test('favorite teams renderer lives outside app while mutations and loading remain in composition root', () => {
  assert.match(app, /import \{ createFavoriteTeamsRenderer \} from '\.\/modules\/favorite-teams-renderer\.js'/);
  assert.match(app, /const \{ renderFavoriteTeams \} = createFavoriteTeamsRenderer\(\{/);
  assert.match(app, /onRetryLoad: \(\) => loadFavorites\(\)/);
  assert.match(app, /onShowMatches: \(\) => showView\('matchesView'\)/);
  assert.match(app, /onRemoveFavorite: team => toggleFavorite\(team\)/);
  assert.match(app, /onOpenTeam: team => openTeam\(team\)/);
  assert.doesNotMatch(app, /function renderFavoriteTeams\(\)/);

  assert.match(source, /export function createFavoriteTeamsRenderer/);
  assert.match(source, /function renderFavoriteTeams\(\)/);
  for (const forbidden of ['async function loadFavorites', 'async function toggleFavorite', 'function openTeam', "showView('matchesView')", '/api/favorites']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('favorite teams loading state preserves existing compact loader', () => {
  const { module, root } = createHarness({
    state: { favoritesLoading: true, favoritesLoaded: false },
  });

  module.renderFavoriteTeams();

  assert.match(root.innerHTML, /Загружаю избранное…/);
  assert.match(root.innerHTML, /compact-loader/);
});

test('favorite teams first-load error renders recovery and delegates retry', () => {
  const { module, root, elements, calls } = createHarness({
    state: { favoritesLoadError: 'offline', favoritesLoaded: false },
  });

  module.renderFavoriteTeams();

  assert.match(root.innerHTML, /Избранное временно недоступно/);
  assert.match(root.innerHTML, /offline/);
  elements.get('favoritesRetry').click();
  assert.equal(calls.retry, 1);
});

test('empty favorite teams state preserves stale warning, retry and matches callbacks', () => {
  const { module, root, elements, calls } = createHarness({
    state: { favorites: [], favoritesLoaded: true, favoritesLoadError: '<stale>' },
  });

  module.renderFavoriteTeams();

  assert.match(root.innerHTML, /Избранных команд пока нет/);
  assert.match(root.innerHTML, /&lt;stale&gt;/);
  assert.match(root.innerHTML, /Последний загруженный список избранного был пуст/);
  assert.match(root.innerHTML, /favoritesEmptyRetry/);
  assert.match(root.innerHTML, /favoritesEmptyMatches/);

  elements.get('favoritesEmptyRetry').click();
  elements.get('favoritesEmptyMatches').click();
  assert.equal(calls.retry, 1);
  assert.equal(calls.matches, 1);
});

test('favorite teams rows preserve safe logo, pending removal state and delegated actions', () => {
  const state = {
    favorites: [
      { teamId: 7, teamName: 'Team <Seven>', teamLogo: 'https://img.test/7.png' },
      { teamId: 8, teamName: 'No Logo', teamLogo: 'javascript:bad' },
    ],
    favoritesLoaded: true,
    favoriteMutations: new Set([7]),
  };
  const { module, root, calls } = createHarness({ state });

  root.removeButtons = [
    button({ teamId: '7', teamName: 'Team <Seven>' }),
    button({ teamId: '8', teamName: 'No Logo' }),
  ];
  root.openButtons = [
    button({ openTeam: '7', teamName: 'Team <Seven>', teamLogo: 'https://img.test/7.png' }),
    button({ openTeam: '8', teamName: 'No Logo', teamLogo: '' }),
  ];

  module.renderFavoriteTeams();

  assert.match(root.innerHTML, /https:\/\/img\.test\/7\.png/);
  assert.match(root.innerHTML, /Team &lt;Seven&gt;/);
  assert.match(root.innerHTML, /team-placeholder/);
  assert.match(root.innerHTML, /data-team-id="7"[^>]*disabled/);

  root.removeButtons[0].click();
  root.openButtons[1].click();

  assert.deepEqual(calls.remove, [{ id: 7, name: 'Team <Seven>', logo: 'https://img.test/7.png' }]);
  assert.deepEqual(calls.open, [{ id: 8, name: 'No Logo', logo: '' }]);
});

test('missing favorite teams root fails soft without invoking callbacks', () => {
  let callbackCalls = 0;
  const module = createFavoriteTeamsRenderer({
    state: {
      favorites: [],
      favoritesLoading: false,
      favoritesLoaded: true,
      favoritesLoadError: '',
      favoriteMutations: new Set(),
    },
    elementById: () => null,
    escapeHtml: value => String(value ?? ''),
    safeUrl: value => String(value ?? ''),
    recoveryCardHtml: () => '',
    onRetryLoad: () => { callbackCalls += 1; },
    onShowMatches: () => { callbackCalls += 1; },
    onRemoveFavorite: () => { callbackCalls += 1; },
    onOpenTeam: () => { callbackCalls += 1; },
  });

  assert.doesNotThrow(() => module.renderFavoriteTeams());
  assert.equal(callbackCalls, 0);
});
