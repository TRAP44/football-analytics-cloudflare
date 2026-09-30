import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CANONICAL_HOME_VIEW,
  PUBLIC_VIEW_IDS,
  backTargetForView,
  normalizeBackTarget,
  telegramBackButtonVisible,
} from '../public/modules/navigation.js';

const app = fs.readFileSync('public/app.js', 'utf8');
const viewChrome = fs.readFileSync('public/modules/view-chrome.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

test('matchesView is the single canonical Home and bottom Home always opens it', () => {
  assert.equal(CANONICAL_HOME_VIEW, 'matchesView');
  assert.equal(PUBLIC_VIEW_IDS.filter(id => id === CANONICAL_HOME_VIEW).length, 1);
  assert.match(html, /id="navMatches"[\s\S]*?<small>Главная<\/small>/);
  assert.match(app, /\$\('navMatches'\)\.addEventListener\('click', \(\) => \{[\s\S]*?showView\('matchesView'\);[\s\S]*?\}\);/);
  assert.match(app, /\$\('navMatches'\)\.classList\.toggle\('active', id === 'matchesView'\)/);
  assert.doesNotMatch(app, /\$\('navMatches'\)\.classList\.toggle\('active', id === 'matchesView' \|\|/);
});

test('search always has a direct BackButton path to Home', () => {
  assert.equal(backTargetForView('searchView', {}), 'matchesView');
  assert.equal(telegramBackButtonVisible('searchView'), true);
});

test('team and tournament preserve concrete parents but invalid or missing parents fall back Home', () => {
  assert.equal(backTargetForView('teamView', { teamBackView: 'searchView' }), 'searchView');
  assert.equal(backTargetForView('tournamentView', { tournamentBackView: 'teamView' }), 'teamView');
  assert.equal(backTargetForView('teamView', { teamBackView: '' }), 'matchesView');
  assert.equal(backTargetForView('tournamentView', { tournamentBackView: 'tournamentView' }), 'matchesView');
  assert.equal(normalizeBackTarget('unknownView', 'teamView'), 'matchesView');
});

test('analysis return chain reaches Home from search-team-match center flow', () => {
  const state = {
    analysisBackView: 'teamView',
    teamBackView: 'searchView',
  };
  const afterCenterBack = backTargetForView('analysisView', state);
  const afterTeamBack = backTargetForView(afterCenterBack, state);
  const afterSearchBack = backTargetForView(afterTeamBack, state);
  assert.equal(afterCenterBack, 'teamView');
  assert.equal(afterTeamBack, 'searchView');
  assert.equal(afterSearchBack, 'matchesView');
});

test('myTeams-opened match returns to myTeams and then Home', () => {
  const state = { analysisBackView: 'myTeamsView' };
  assert.equal(backTargetForView('analysisView', state), 'myTeamsView');
  assert.equal(backTargetForView('myTeamsView', state), 'matchesView');
  assert.match(viewChrome, /myTeamsView:\s*Object\.freeze\(\['Мои команды'/);
});

test('history-opened match returns to history and then Home', () => {
  const state = { analysisBackView: 'historyView' };
  assert.equal(backTargetForView('analysisView', state), 'historyView');
  assert.equal(backTargetForView('historyView', state), 'matchesView');
  assert.match(app, /async function openHistoryAnalysis[\s\S]*?state\.analysisBackView = sourceView/);
});

test('fixture deep-link Match Center has Home as its fallback parent', () => {
  assert.equal(backTargetForView('analysisView', { analysisBackView: 'matchesView' }), 'matchesView');
  assert.match(app, /async function openLaunchFixture[\s\S]*?if \(action === 'center'\) return openMatchCenter\(id, null\)/);
  assert.match(app, /analysisBackView:\s*'matchesView'/);
});

test('Telegram BackButton is available on every non-Home public view and routes through the same parent resolver', () => {
  for (const view of PUBLIC_VIEW_IDS) {
    assert.equal(telegramBackButtonVisible(view), view !== 'matchesView');
  }
  assert.match(app, /isTelegramBackVisible: id => telegramBackButtonVisible\(id\)/);
  assert.match(viewChrome, /if \(isTelegramBackVisible\(id\)\) telegramWebApp\.BackButton\.show\(\)/);
  assert.match(app, /showView\(viewBackTarget\(current\), \{ restore: true \}\)/);
  assert.match(app, /tg\.BackButton\.onClick\(handleBackNavigation\)/);
});

test('legacy navSearch contracts are removed from current navigation smoke checks', () => {
  assert.doesNotMatch(html, /id="navSearch"/);
  assert.doesNotMatch(app, /['"]navSearch['"]/);
  assert.match(app, /\['navMatches','navMyTeams','navHistory','navProfile'\]/);
});
