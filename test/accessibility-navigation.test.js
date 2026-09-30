import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const navigationShell = fs.readFileSync('public/modules/navigation-shell.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');

test('all interactive tab groups expose keyboard and ARIA relationships', () => {
  assert.match(app, /function bindRovingTabKeyboard\(/);
  assert.match(app, /ArrowRight/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /aria-controls/);
  assert.match(app, /aria-labelledby/);
  assert.match(app, /bindRovingTabKeyboard\(buttons, 'tab'/);
  assert.match(app, /bindRovingTabKeyboard\(buttons, 'centerTab'/);
  assert.match(app, /bindRovingTabKeyboard\(tournamentTabs, 'tournamentTab'/);
  assert.match(app, /bindRovingTabKeyboard\(teamTabs, 'teamTab'/);
  assert.match(app, /tournament-tab-/);
  assert.match(app, /team-tab-/);
  assert.match(styles, /\.analysis-tab-btn:focus-visible/);
  assert.match(styles, /\.center-tab-btn:focus-visible/);
  assert.match(styles, /\.tournament-tab:focus-visible/);
  assert.match(styles, /\.team-tab:focus-visible/);
});

test('history empty state gives the user a useful next action', () => {
  assert.match(app, /historyEmptyMatches/);
  assert.match(app, /Найти матч/);
  assert.match(app, /historyEmptyRetry/);
  assert.match(app, /Обновить историю/);
  assert.match(app, /aria-label="Открыть анализ матча/);
});

test('top bar heading can receive programmatic focus', () => {
  assert.match(html, /id="topbarTitle" tabindex="-1"/);
  assert.match(navigationShell, /options\.focusHeading === true/);
});

test('search, favorites and reminders empty states provide recovery actions', () => {
  assert.match(app, /searchEmptyAll/);
  assert.match(app, /favoritesEmptyMatches/);
  assert.match(app, /remindersEmptyMatches/);
  assert.match(app, /favoritesEmptyRetry/);
  assert.match(app, /remindersEmptyRetry/);
});
