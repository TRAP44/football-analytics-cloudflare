import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const uiPreferences = readFileSync(new URL('../public/modules/ui-preferences.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('home prioritizes a personal daily overview with three always-visible quick filters', () => {
  assert.match(html, /id="dailyOverview"/);
  const primaryStrip = html.match(/<div class="filter-strip home-quick-filter-strip" id="filterStrip"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  assert.equal((primaryStrip.match(/class="filter-btn/g) || []).length, 3);
  for (const filter of ['top', 'live', 'all']) assert.match(primaryStrip, new RegExp(`data-filter="${filter}"`));
  assert.doesNotMatch(primaryStrip, /data-filter="favorites"/);
  assert.match(html, /class="home-filter-drawer league-filter-drawer"/);
});

test('interface preferences still persist while advanced styling is progressively disclosed', () => {
  for (const theme of ['system', 'dark', 'light', 'ocean']) {
    assert.match(html, new RegExp(`data-theme-choice="${theme}"`));
  }
  assert.match(html, /id="advancedAppearance"/);
  assert.match(html, /id="advancedAppearanceSummary">По умолчанию/);
  assert.match(html, /class="theme-options theme-options-primary"/);
  assert.match(html, /class="theme-options theme-options-extra"/);
  assert.match(uiPreferences, /UI_PREFERENCES_KEY/);
  assert.match(uiPreferences, /storage\.setItem\(UI_PREFERENCES_KEY/);
  assert.match(uiPreferences, /return parts\.length \? parts\.join\(' · '\) : 'По умолчанию'/);
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

test('admin opens with an owner dashboard while rare validation and model tools stay on demand', () => {
  for (const id of [
    'adminOverviewService',
    'adminOverviewSource',
    'adminOverviewDatabase',
    'adminOverviewNotifications',
    'adminOverviewAi',
  ]) assert.match(adminHtml, new RegExp(`id="${id}"`));
  assert.match(adminHtml, /OWNER DASHBOARD/);
  assert.match(adminHtml, /Расширенные инструменты/);
  assert.doesNotMatch(adminHtml, /class="admin-console-actions"/);
  assert.match(adminHtml, /id="adminAdvancedTools"/);
  assert.match(adminHtml, /id="adminAdvancedContent"/);

  const organizeStart = app.indexOf('function organizeAdminConsole()');
  const organizeEnd = app.indexOf('async function loadAdvancedAdminTools()', organizeStart);
  const organize = app.slice(organizeStart, organizeEnd);
  assert.match(organize, /#betaHealthPanel/);
  assert.match(organize, /#betaDashboardPanel/);

  const advancedStart = app.indexOf('async function loadAdvancedAdminTools()');
  const advancedEnd = app.indexOf('function planLabel', advancedStart);
  const advanced = app.slice(advancedStart, advancedEnd);
  assert.match(advanced, /loadBetaDashboard\(false\)/);
  assert.match(advanced, /loadModelQuality\(false\)/);

  const profileStart = app.indexOf('async function openProfileView');
  const profileEnd = app.indexOf('let adminReleaseReadinessModule', profileStart);
  assert.ok(profileStart >= 0 && profileEnd > profileStart);
  const profileOpen = app.slice(profileStart, profileEnd);
  assert.match(profileOpen, /loadRuntimeControlsAdmin\(false\)/);
  assert.match(profileOpen, /loadDiagnostics\(false\)/);
  assert.match(profileOpen, /loadReminderHealth\(false\)/);
  assert.doesNotMatch(profileOpen, /loadBetaDashboard\(false\)/);
  assert.doesNotMatch(profileOpen, /loadModelQuality\(false\)/);
});
