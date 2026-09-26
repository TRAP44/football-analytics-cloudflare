import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('home prioritizes a personal daily overview and four core filters', () => {
  assert.match(html, /id="dailyOverview"/);
  const primaryStrip = html.match(/<div class="filter-strip" id="filterStrip">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.equal((primaryStrip.match(/class="filter-btn/g) || []).length, 4);
  assert.match(html, /class="home-filter-drawer league-filter-drawer"/);
});

test('interface themes and button styles persist per device', () => {
  for (const theme of ['system', 'dark', 'light', 'ocean']) {
    assert.match(html, new RegExp(`data-theme-choice="${theme}"`));
  }
  assert.match(app, /UI_PREFERENCES_KEY/);
  assert.match(app, /localStorage\.setItem\(UI_PREFERENCES_KEY/);
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

test('rare administrator panels are grouped and loaded on demand', () => {
  assert.match(html, /id="adminAdvancedTools"/);
  assert.match(html, /id="adminAdvancedContent"/);
  assert.match(app, /function organizeAdminConsole\(\)/);
  assert.match(app, /function loadAdvancedAdminTools\(\)/);
  const profileOpen = app.match(/async function openProfileView[\s\S]*?\n}\n\n\nfunction releaseStateLabel/)?.[0] || '';
  assert.match(profileOpen, /loadRuntimeControlsAdmin\(false\)/);
  assert.doesNotMatch(profileOpen, /loadModelQuality\(false\)/);
});
