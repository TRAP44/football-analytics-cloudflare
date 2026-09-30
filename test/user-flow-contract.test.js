import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const navigationShell = fs.readFileSync('public/modules/navigation-shell.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8')+'\n'+fs.readFileSync('src/router.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

test('nested screens preserve their real back destination and Telegram BackButton uses it', () => {
  assert.match(app, /analysisBackView:\s*'matchesView'/);
  assert.match(app, /function viewBackTarget/);
  assert.match(app, /tg\.BackButton\.onClick\(handleBackNavigation\)/);
  assert.match(app, /state\.analysisBackView = sourceView/);
  assert.match(app, /\$\('backBtn'\)\.addEventListener\('click', handleBackNavigation\)/);
});

test('inactive views and tab panels are not focusable or exposed to assistive technology', () => {
  assert.match(navigationShell, /view\.toggleAttribute\('inert', !active\)/);
  assert.match(navigationShell, /view\.setAttribute\('aria-hidden', active \? 'false' : 'true'\)/);
  assert.match(app, /panel\.toggleAttribute\('inert', !active\)/);
  assert.match(app, /btn\.setAttribute\('aria-selected', active \? 'true' : 'false'\)/);
  assert.match(css, /\.view\[hidden\]/);
  assert.match(html, /role="tablist" aria-label="Разделы турнира"/);
  assert.match(html, /role="tablist" aria-label="Разделы команды"/);
});

test('history opens cached analysis read-only without spending another analysis quota', () => {
  const match = worker.match(/async function apiHistoryAnalysis[\s\S]*?\n}\n\n\nasync function apiFavorites/);
  assert.ok(match, 'apiHistoryAnalysis must exist');
  assert.match(match[0], /getHistory\(user\.id, cfg\)/);
  assert.match(match[0], /getStaleCache\(cacheKey, cfg\)/);
  assert.doesNotMatch(match[0], /incrementUsage\(/);
  assert.match(worker, /url\.pathname === '\/api\/history-analysis'/);
  assert.match(app, /openHistoryAnalysis\(Number\(btn\.dataset\.fixture\), btn\)/);
});

test('global search ignores stale responses and mobile navigation does not force the keyboard open', () => {
  assert.match(app, /requestSeq:\s*0/);
  assert.match(app, /seq !== state\.globalSearch\.requestSeq/);
  assert.match(app, /query !== String\(state\.globalSearch\.query \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(html, /id="navSearch"/);
  assert.match(html, /id="homeSearchBtn"/);
});

test('small-screen controls retain usable touch targets and search input avoids iOS zoom', () => {
  assert.match(css, /input\[type="search"\]\s*\{\s*font-size:\s*16px/);
  assert.match(css, /\.back-btn, \.icon-btn, \.global-search-btn, \.history-open\s*\{\s*min-height:\s*44px/);
  assert.match(css, /min-height:\s*100dvh/);
});
