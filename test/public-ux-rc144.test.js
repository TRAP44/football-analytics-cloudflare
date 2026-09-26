import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8') + '\n' + fs.readFileSync('public/styles/public-shell.css', 'utf8');

function functionBody(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = nextName ? app.indexOf(`function ${nextName}`, start + 1) : -1;
  assert.ok(start >= 0, `${name} must exist`);
  return app.slice(start, end >= 0 ? end : undefined);
}

test('public profile remains available to non-admin users while admin controls stay gated', () => {
  assert.doesNotMatch(app, /profileBtn'\)\.hidden=!admin/);
  assert.doesNotMatch(app, /navProfile'\)\.hidden=!admin/);
  assert.match(app, /profileView:\s*\['Профиль',\s*'Команды, напоминания и настройки'\]/);
  assert.match(html, /id="profileBtn"[^>]*aria-label="Открыть профиль"/);
  assert.match(html, /id="navProfile"[^>]*>[\\s\\S]*?<small>Профиль<\\/small>/);
  assert.match(html, /class="panel admin-console" data-admin-only hidden/);
  assert.match(app, /querySelectorAll\('\[data-admin-only\]'\)/);
});

test('appearance choices stay in the user profile and apply immediately', () => {
  for (const theme of ['system', 'dark', 'light', 'ocean']) {
    assert.match(html, new RegExp(`data-theme-choice="${theme}"`));
  }
  assert.match(app, /saveInterfacePreference\('theme'/);
  assert.match(app, /applyInterfacePreferences\(\{ announce: true \}\)/);
  assert.match(html, /Цвет интерфейса применяется сразу/);
});

test('global search shows local results first and bounds the remote wait', () => {
  const body = functionBody('renderGlobalSearch', 'runGlobalSearch');
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
  assert.match(html, /id="navMatches" class="nav-item active"[^>]*>[\\s\\S]*?<small>Главная<\\/small>/);
  assert.match(html, /id="navMyTeams" class="nav-item"[^>]*><span>⭐<\/span><small>Мои команды<\/small>/);
  assert.doesNotMatch(html, /id="navSearch"/);
  assert.match(html, /id="navHistory" class="nav-item"/);
  assert.match(html, /id="navProfile" class="nav-item"/);
  assert.match(html, /id="homeSearchBtn"/);
  assert.match(html, /id="myTeamsView"/);
  assert.match(app, /function renderMyTeams\(\)/);
  assert.match(app, /\$\('navMyTeams'\)\?\.addEventListener/);
  assert.match(app, /sendProductAction\('matches_open', 'myTeamsView'\)/);
  assert.match(app, /sendProductAction\('open', 'matchesView'\)/);
  assert.match(app, /async function openProfileView\(\)/);
});

test('admin journey keeps operational tools gated without hiding the user profile', () => {
  assert.match(html, /id="adminRoleBadge"[^>]*data-admin-only hidden/);
  assert.match(html, /class="panel admin-console" data-admin-only hidden/);
  assert.match(html, /id="modelQualityRefreshBtn"/);
  assert.match(app, /if \(isAdmin\(\)\) \{/);
  assert.match(app, /loadProvider\(\)/);
  assert.match(app, /loadRuntimeControlsAdmin\(false\)/);
  assert.match(app, /function applyAdminVisibility\(\)/);
});
