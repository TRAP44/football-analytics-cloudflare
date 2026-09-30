import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const globalSearchRenderer = fs.readFileSync('public/modules/global-search-renderer.js', 'utf8');
const viewChrome = fs.readFileSync('public/modules/view-chrome.js', 'utf8');
const myTeamsRenderer = fs.readFileSync('public/modules/my-teams-renderer.js', 'utf8');
const uiPreferences = fs.readFileSync('public/modules/ui-preferences.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8') + '\n' + fs.readFileSync('public/styles/public-shell.css', 'utf8');

function functionBodyFrom(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : -1;
  assert.ok(start >= 0, `${name} must exist`);
  return source.slice(start, end >= 0 ? end : undefined);
}

function functionBody(name, nextName) {
  return functionBodyFrom(app, name, nextName);
}

test('public profile remains available to non-admin users while admin controls stay gated', () => {
  assert.doesNotMatch(app, /profileBtn'\)\.hidden=!admin/);
  assert.doesNotMatch(app, /navProfile'\)\.hidden=!admin/);
  assert.match(viewChrome, /profileView:\s*Object\.freeze\(\['Профиль',\s*'Напоминания и настройки'\]\)/);
  assert.match(html, /id="profileBtn"[^>]*aria-label="Открыть профиль"/);
  assert.match(html, /id="navProfile"[^>]*>/);
  assert.match(html, /<small>Профиль<\/small>/);
  assert.doesNotMatch(html, /data-admin-only|class="panel admin-console"/);
  assert.match(adminHtml, /class="panel admin-console" data-admin-only hidden/);
  assert.match(app, /querySelectorAll\('\[data-admin-only\]'\)/);
});

test('profile keeps favorite-team management in one dedicated My Teams destination', () => {
  assert.doesNotMatch(html, /id="favoriteTeams"/);
  assert.match(html, /id="profileMyTeamsBtn"[^>]*>Открыть<\/button>/);
  assert.match(html, /Любимые клубы и их ближайшие матчи собраны в отдельном разделе/);
  assert.match(app, /\$\('profileMyTeamsBtn'\)\?\.addEventListener/);
  assert.match(app, /renderMyTeams\(\);[\s\S]{0,80}showView\('myTeamsView'\)/);
});

test('profile keeps common appearance choices visible and moves rare styling behind disclosure', () => {
  const panelStart = html.indexOf('<section class="panel preferences-panel">');
  const panelEnd = html.indexOf('<details class="profile-data-details">', panelStart);
  const panel = html.slice(panelStart, panelEnd);
  const advancedStart = panel.indexOf('<details id="advancedAppearance"');
  const advancedEnd = panel.indexOf('</details>', advancedStart);
  const primary = panel.slice(0, advancedStart);
  const advanced = panel.slice(advancedStart, advancedEnd + 10);

  for (const theme of ['system', 'dark', 'light']) {
    assert.match(primary, new RegExp(`data-theme-choice="${theme}"`));
  }
  assert.doesNotMatch(primary, /data-theme-choice="ocean"/);
  assert.match(advanced, /data-theme-choice="ocean"/);
  assert.match(advanced, /data-accent-choice="green"/);
  assert.match(advanced, /data-button-style-choice="compact"/);
  assert.match(panel, /Матчи и уведомления/);
  assert.match(uiPreferences, /advancedAppearanceLabel/);
  assert.match(uiPreferences, /advancedAppearanceSummary/);
  assert.match(app, /saveInterfacePreference\('theme'/);
  assert.match(uiPreferences, /applyInterfacePreferences\(\{ announce: true \}\)/);
});

test('global search shows local results first and bounds the remote wait', () => {
  const body = functionBodyFrom(globalSearchRenderer, 'renderGlobalSearch');
  const run = functionBody('runGlobalSearch', 'openTournamentMeta');
  assert.match(body, /localDiscoveryResults\(query\)/);
  assert.match(body, /Ищем/);
  assert.match(body, /Матч найден/);
  assert.match(body, /Матчей сейчас нет/);
  assert.match(body, /Источник отвечает слишком долго/);
  assert.match(body, /Повторить/);
  assert.match(run, /timeoutMs:\s*6500/);
  assert.match(run, /retry:\s*false/);
  assert.match(app, /state\.globalSearch\.query\.trim\(\)\.length >= 3/);
  assert.match(app, /globalSearchTimer = setTimeout\(\(\) => runGlobalSearch\(\), 500\)/);
});

test('match list renders snapshots immediately and refreshes without blocking visible matches', () => {
  const body = app.slice(app.indexOf('async function loadMatches'), app.indexOf('function syncFilterButtons'));
  assert.match(body, /readMatchSnapshot\(date\)/);
  assert.match(body, /applyMatchPayload\(snapshot, \{ snapshot: true, refreshing: true \}\)/);
  assert.match(body, /state\.matchesMeta\.refreshing = true/);
  assert.match(body, /timeoutMs:\s*6500/);
  assert.match(body, /retry:\s*false/);
  assert.match(app, /state\.matchesMeta\.refreshing/);
});

test('match cards keep one primary action with compact secondary favorite and reminder actions', () => {
  const body = functionBody('matchCardHtml', 'bindMatchActions');
  assert.match(body, /compact-match-card/);
  assert.match(body, /compact-actions/);
  assert.match(body, /match-secondary-actions/);
  assert.match(body, /data-quick-reminder/);
  assert.match(body, /fav-star compact/);
  assert.doesNotMatch(body, /match-card-more/);
  assert.doesNotMatch(body, /matchAiSnapshotHtml/);
});

test('analysis uses progressive disclosure and keeps technical material off the first level', () => {
  assert.match(app, /function analysisGlanceHtml/);
  assert.match(app, /Главные факторы/);
  assert.match(app, /Основные риски/);
  const body = functionBody('renderAnalysis', 'safeUrl');
  const tabs = body.indexOf('<div class="analysis-tabs"');
  assert.ok(tabs > 0);
  const beforeTabs = body.slice(0, tabs);
  assert.match(beforeTabs, /analysisGlanceHtml\(d\)/);
  assert.doesNotMatch(beforeTabs, /providerCoverageHtml/);
  assert.doesNotMatch(beforeTabs, /dataProvenanceHtml/);
  assert.match(body, /<summary>Подробнее о расчёте<\/summary>/);
  assert.match(body, /<summary>Подробнее о данных<\/summary>/);
  assert.doesNotMatch(body, /Переиспользование данных/);
});

test('Telegram mobile UX includes safe areas, four-item navigation and touch targets', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\.center-tabs-wrap,[\s\S]*\.analysis-tabs[\s\S]*position:\s*sticky/);
  assert.match(html, /enterkeyhint="search"/);
});


test('Phase 4 normal user journey uses Home, My Teams, History and Profile', () => {
  assert.match(html, /id="navMatches" class="nav-item active"/);
  assert.match(html, /<small>Главная<\/small>/);
  assert.match(html, /id="navMyTeams" class="nav-item"/);
  assert.match(html, /<small>Мои команды<\/small>/);
  assert.doesNotMatch(html, /id="navSearch"/);
  assert.match(html, /id="navHistory" class="nav-item"/);
  assert.match(html, /id="navProfile" class="nav-item"/);
  assert.match(html, /id="homeSearchBtn"/);
  assert.match(html, /id="myTeamsView"/);
  assert.match(myTeamsRenderer, /function renderMyTeams\(\)/);
  assert.match(app, /\$\('navMyTeams'\)\?\.addEventListener/);
  assert.match(app, /sendProductAction\('matches_open', 'myTeamsView'\)/);
  assert.match(app, /sendProductAction\('open', 'matchesView'\)/);
  assert.match(app, /async function openProfileView\(\)/);
});

test('admin journey keeps operational tools gated without hiding the user profile', () => {
  assert.match(adminHtml, /id="adminRoleBadge"[^>]*data-admin-only hidden/);
  assert.match(adminHtml, /class="panel admin-console" data-admin-only hidden/);
  assert.match(adminHtml, /id="modelQualityRefreshBtn"/);
  assert.match(app, /if \(isAdmin\(\)\) \{/);
  assert.match(app, /loadProvider\(\)/);
  assert.match(app, /loadRuntimeControlsAdmin\(false\)/);
  assert.match(app, /function applyAdminVisibility\(\)/);
});
