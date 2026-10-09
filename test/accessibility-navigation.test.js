import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function readPublicFile(relativePath) {
  return fs.readFileSync(new URL(`../public/${relativePath}`, import.meta.url), 'utf8');
}

function assertContainsAll(source, patterns) {
  patterns.forEach(pattern => assert.match(source, pattern));
}

const app = readPublicFile('app.js');
const navigationShell = readPublicFile('modules/navigation-shell.js');
const reminderList = readPublicFile('modules/reminder-list.js');
const favoriteTeamsRenderer = readPublicFile('modules/favorite-teams-renderer.js');
const historyRenderer = readPublicFile('modules/history-renderer.js');
const globalSearchRenderer = readPublicFile('modules/global-search-renderer.js');
const html = readPublicFile('index.html');
const styles = readPublicFile('styles.css');

test('interactive tab groups expose keyboard navigation and ARIA relationships', () => {
  assertContainsAll(app, [
    /function bindRovingTabKeyboard\(/,
    /ArrowRight/,
    /ArrowLeft/,
    /Home/,
    /End/,
    /setAttribute\('role', 'tab'\)/,
    /setAttribute\('role', 'tabpanel'\)/,
    /setAttribute\('aria-controls'/,
    /setAttribute\('aria-selected'/,
    /setAttribute\('aria-labelledby'/,
    /toggleAttribute\('inert'/,
    /bindRovingTabKeyboard\(buttons, 'tab'/,
    /bindRovingTabKeyboard\(buttons, 'centerTab'/,
    /bindRovingTabKeyboard\(tournamentTabs, 'tournamentTab'/,
    /bindRovingTabKeyboard\(teamTabs, 'teamTab'/,
    /tournament-tab-/,
    /team-tab-/,
  ]);

  assertContainsAll(styles, [
    /\.analysis-tab-btn:focus-visible/,
    /\.center-tab-btn:focus-visible/,
    /\.tournament-tab:focus-visible/,
    /\.team-tab:focus-visible/,
  ]);
});

test('history empty state gives the user useful recovery actions', () => {
  assertContainsAll(historyRenderer, [
    /historyEmptyMatches/,
    /Найти матч/,
    /historyEmptyRetry/,
    /Обновить историю/,
    /aria-label="Открыть анализ матча/,
  ]);
});

test('top bar heading supports programmatic focus after navigation', () => {
  assert.match(html, /<h1\b[^>]*\bid="topbarTitle"[^>]*>/);
  assert.match(html, /<h1\b[^>]*\btabindex="-1"[^>]*>/);
  assert.match(navigationShell, /safeOptions\.focusHeading === true/);
  assert.match(navigationShell, /\$\('topbarTitle'\)\?\.focus\?\./);
});

test('search, favorites and reminders empty states provide recovery actions', () => {
  assertContainsAll(globalSearchRenderer, [
    /searchEmptyAll/,
  ]);
  assertContainsAll(favoriteTeamsRenderer, [
    /favoritesEmptyMatches/,
    /favoritesEmptyRetry/,
  ]);
  assertContainsAll(reminderList, [
    /remindersEmptyMatches/,
    /remindersEmptyRetry/,
  ]);
});
