import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMyTeamsRenderer } from '../public/modules/my-teams-renderer.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/modules/my-teams-renderer.js', import.meta.url), 'utf8');

function button(dataset = {}) {
  return {
    dataset: { ...dataset },
    listeners: new Map(),
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    click() { this.listeners.get('click')?.(); },
  };
}

function rootElement() {
  return {
    innerHTML: '',
    openButtons: [],
    fixtureButtons: [],
    querySelectorAll(selector) {
      if (selector === '[data-open-team]') return this.openButtons;
      if (selector === '[data-team-fixture]') return this.fixtureButtons;
      return [];
    },
  };
}

function createHarness(overrides = {}) {
  const root = rootElement();
  const onboarding = { hidden: false };
  const elements = new Map([['myTeamsList', root], ['myTeamsOnboarding', onboarding]]);
  const state = {
    favorites: [],
    favoritesLoading: false,
    favoritesLoaded: true,
    matches: [],
    ...overrides.state,
  };
  const calls = { open: [], analyze: [] };
  const module = createMyTeamsRenderer({
    state,
    elementById: id => elements.get(id) || null,
    escapeHtml: value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    safeUrl: value => String(value || '').startsWith('https://') ? String(value) : '',
    isLiveMatch: match => Boolean(match?.live),
    isFinishedMatch: match => Boolean(match?.finished),
    scoreText: match => `${match?.home?.score ?? 0}:${match?.away?.score ?? 0}`,
    timeOf: value => 'TIME:' + String(value ?? ''),
    onOpenTeam: team => calls.open.push(team),
    onAnalyzeMatch: (fixtureId, btn) => calls.analyze.push({ fixtureId, btn }),
  });
  return { module, state, root, onboarding, calls };
}

test('my teams renderer lives outside app while navigation and analysis stay in composition root', () => {
  assert.match(app, /import \{ createMyTeamsRenderer \} from '\.\/modules\/my-teams-renderer\.js'/);
  assert.match(app, /const \{ renderMyTeams \} = createMyTeamsRenderer\(\{/);
  assert.match(app, /onOpenTeam: team => openTeam\(team\)/);
  assert.match(app, /onAnalyzeMatch: \(fixtureId, button\) => analyzeMatch\(fixtureId, button\)/);
  assert.doesNotMatch(app, /function renderMyTeams\(\)/);

  assert.match(source, /export function createMyTeamsRenderer/);
  assert.match(source, /function renderMyTeams\(\)/);
  for (const forbidden of ['function openTeam', 'async function analyzeMatch', '/api/', 'showView(']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('my teams loading and empty states preserve onboarding behavior', () => {
  const loading = createHarness({ state: { favoritesLoading: true, favoritesLoaded: false } });
  loading.module.renderMyTeams();
  assert.match(loading.root.innerHTML, /Загружаю ваши команды/);
  assert.equal(loading.onboarding.hidden, true);

  const empty = createHarness({ state: { favorites: [], favoritesLoading: false, favoritesLoaded: true } });
  empty.onboarding.hidden = true;
  empty.module.renderMyTeams();
  assert.equal(empty.root.innerHTML, '');
  assert.equal(empty.onboarding.hidden, false);
});

test('my teams prefers live match over upcoming and recent', () => {
  const { module, root, onboarding } = createHarness({
    state: {
      favorites: [{ teamId: 7, teamName: 'Team Seven', teamLogo: 'https://img.test/7.png' }],
      matches: [
        { fixtureId: 1, date: '2026-09-29T10:00:00Z', finished: true, home: { id: 7, name: 'Old', score: 2 }, away: { id: 8, name: 'Away', score: 1 } },
        { fixtureId: 2, date: '2026-10-01T10:00:00Z', home: { id: 7, name: 'Next' }, away: { id: 9, name: 'Away' } },
        { fixtureId: 3, date: '2026-09-30T10:00:00Z', live: true, home: { id: 10, name: 'Live Home', score: 1 }, away: { id: 7, name: 'Team Seven', score: 0 } },
      ],
    },
  });

  module.renderMyTeams();

  assert.equal(onboarding.hidden, true);
  assert.match(root.innerHTML, /🔴 Матч идёт/);
  assert.match(root.innerHTML, /data-team-fixture="3"/);
  assert.match(root.innerHTML, /1:0/);
  assert.doesNotMatch(root.innerHTML, /data-team-fixture="2"/);
});

test('my teams uses earliest upcoming then latest recent when no live match exists', () => {
  const upcoming = createHarness({
    state: {
      favorites: [{ teamId: 7, teamName: 'Team Seven' }],
      matches: [
        { fixtureId: 4, date: '2026-10-03T10:00:00Z', home: { id: 7, name: 'Later' }, away: { id: 8, name: 'Away' } },
        { fixtureId: 5, date: '2026-10-01T10:00:00Z', home: { id: 8, name: 'Away' }, away: { id: 7, name: 'Sooner' } },
      ],
    },
  });
  upcoming.module.renderMyTeams();
  assert.match(upcoming.root.innerHTML, /Ближайший матч/);
  assert.match(upcoming.root.innerHTML, /data-team-fixture="5"/);
  assert.match(upcoming.root.innerHTML, /TIME:2026-10-01T10:00:00Z/);

  const recent = createHarness({
    state: {
      favorites: [{ teamId: 7, teamName: 'Team Seven' }],
      matches: [
        { fixtureId: 6, date: '2026-09-20T10:00:00Z', finished: true, home: { id: 7, name: 'Older' }, away: { id: 8, name: 'Away' } },
        { fixtureId: 7, date: '2026-09-29T10:00:00Z', finished: true, home: { id: 8, name: 'Away' }, away: { id: 7, name: 'Recent' } },
      ],
    },
  });
  recent.module.renderMyTeams();
  assert.match(recent.root.innerHTML, /Последний матч/);
  assert.match(recent.root.innerHTML, /data-team-fixture="7"/);
});

test('unsafe team logos use placeholder and delegated callbacks preserve sanitized values', () => {
  const { module, root, calls } = createHarness({
    state: {
      favorites: [{ teamId: 7, teamName: 'Team <Seven>', teamLogo: 'javascript:bad' }],
      matches: [{ fixtureId: 9, date: '2026-10-01T10:00:00Z', home: { id: 7, name: 'Team <Seven>' }, away: { id: 8, name: 'Away' } }],
    },
  });
  root.openButtons = [button({ openTeam: '7', teamName: 'Team <Seven>', teamLogo: '' })];
  root.fixtureButtons = [button({ teamFixture: '9' })];

  module.renderMyTeams();

  assert.match(root.innerHTML, /team-placeholder/);
  assert.doesNotMatch(root.innerHTML, /javascript:bad/);
  assert.match(root.innerHTML, /Team &lt;Seven&gt;/);

  root.openButtons[0].click();
  root.fixtureButtons[0].click();
  assert.deepEqual(calls.open, [{ id: 7, name: 'Team <Seven>', logo: '' }]);
  assert.equal(calls.analyze[0].fixtureId, 9);
  assert.equal(calls.analyze[0].btn, root.fixtureButtons[0]);
});

test('missing my teams root fails soft without callbacks', () => {
  let calls = 0;
  const module = createMyTeamsRenderer({
    state: { favorites: [], favoritesLoading: false, favoritesLoaded: true, matches: [] },
    elementById: () => null,
    escapeHtml: value => String(value ?? ''),
    safeUrl: value => String(value ?? ''),
    isLiveMatch: () => false,
    isFinishedMatch: () => false,
    scoreText: () => '',
    timeOf: value => String(value ?? ''),
    onOpenTeam: () => { calls += 1; },
    onAnalyzeMatch: () => { calls += 1; },
  });
  assert.doesNotThrow(() => module.renderMyTeams());
  assert.equal(calls, 0);
});
