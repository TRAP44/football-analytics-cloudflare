import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8') + '\n' + fs.readFileSync('public/modules/global-search-controller.js', 'utf8');
const matchCenterController = fs.readFileSync('public/modules/match-center-controller.js', 'utf8');
const analysisController = fs.readFileSync('public/modules/analysis-controller.js', 'utf8');
const profileAccessState = fs.readFileSync('public/modules/profile-access-state.js', 'utf8');
const journeyState = fs.readFileSync('public/modules/journey-state.js', 'utf8');
const historyRenderer = fs.readFileSync('public/modules/history-renderer.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const checklist = fs.readFileSync('BETA_READINESS_CHECKLIST_RU.md', 'utf8');

function block(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, startNeedle + ' missing');
  assert.ok(end > start, endNeedle + ' missing after ' + startNeedle);
  return source.slice(start, end);
}

test('beta product analytics are privacy-safe and server allowlisted', () => {
  for (const event of ['product_action', 'action_error']) {
    assert.ok(worker.includes("'" + event + "'"), event);
  }
  for (const action of [
    'matches_open','search_used','search_found','search_empty','match_open','live_open',
    'ai_start','ai_complete','history_open','history_item_open','profile_open',
  ]) {
    assert.ok(worker.includes("'" + action + "'"), action);
  }
  for (const reason of ['matches','search','match','live_refresh','ai','history','profile']) {
    assert.ok(worker.includes("'" + reason + "'"), reason);
  }
  const metadata = block(worker, 'function clientTelemetryMetadata', 'async function apiClientTelemetry');
  assert.match(metadata, /CLIENT_PRODUCT_ACTIONS\.has\(rawReason\)/);
  assert.match(metadata, /CLIENT_ACTION_ERROR_REASONS\.has\(rawReason\)/);
  assert.match(metadata, /CLIENT_ACTION_ERROR_KINDS\.has\(rawErrorKind\)/);
  assert.match(metadata, /CLIENT_TELEMETRY_VIEWS\.has\(rawView\)/);
  assert.doesNotMatch(metadata, /meta\.query|meta\.team|meta\.message|meta\.username/);

  const apiBlock = block(worker, 'async function apiClientTelemetry', 'async function readOpsEventsRange');
  assert.match(apiBlock, /Unsupported product action/);
  assert.match(apiBlock, /Unsupported action error/);
  assert.match(apiBlock, /eventName:`miniapp_\$\{meta\.reason\}`/);
  assert.match(apiBlock, /eventName:'miniapp_error'/);
  assert.doesNotMatch(apiBlock, /body\?\.query|body\?\.team|body\?\.message/);
});

test('critical Mini App journey emits bounded product events without user search text', () => {
  for (const action of [
    'matches_open','history_open','history_item_open','profile_open',
  ]) {
    assert.ok(app.includes("sendProductAction('" + action + "'"), action);
  }
  for (const action of ['ai_start','ai_complete']) {
    assert.ok(analysisController.includes("productAction('" + action + "'"), action);
  }
  for (const action of ['match_open','live_open']) {
    assert.ok(matchCenterController.includes("productAction('" + action + "'"), action);
  }
  assert.ok(app.includes("productAction('search_used'"), 'search_used');
  assert.match(app,/productAction\(totalMatches \|\| totalEntities \? 'search_found' : 'search_empty','searchView'\)/);
  assert.match(app, /function sendProductAction\(reason, view = telemetryViewName\(\)\)/);
  assert.match(app, /sendClientTelemetry\('product_action'/);
  const sender = block(app, 'function sendClientTelemetry', 'function sendProductAction');
  assert.doesNotMatch(sender, /query|teamName|leagueName|searchText/);
});

test('main action failures are measured by category without leaking backend details', () => {
  for (const action of ['matches','history','profile']) {
    assert.ok(app.includes("sendActionError('" + action + "'"), action);
  }
  assert.ok(analysisController.includes("actionError('ai'"), 'ai');
  for (const action of ['match','live_refresh']) {
    assert.ok(matchCenterController.includes("actionError('" + action + "'"), action);
  }
  assert.ok(app.includes("actionError('search'"), 'search');
  const helper = block(app, 'function sendActionError', 'function sendOperationTiming');
  assert.match(helper, /apiErrorCategory\(error\)/);
  assert.doesNotMatch(helper, /error\?\.message/);
  const errors = block(app, 'function friendlyErrorMessage', 'function normalizeApiError');
  assert.match(errors, /category === 'rate_limit'.*Обновления временно на паузе/s);
  assert.doesNotMatch(errors, /retryAfter|error\?\.message|payload\?\.error/);
});

test('match and AI transitions have explicit loading error and retry states', () => {
  assert.match(journeyState, /function renderJourneyState/);
  assert.match(journeyState, /analysisStateRetry/);
  assert.match(app, /createJourneyStateModule/);
  const center = block(matchCenterController, 'async function openMatchCenter', 'return Object.freeze');
  assert.match(center, /showView\('analysisView'\)/);
  assert.match(center, /renderJourney\('loading'/);
  assert.match(center, /renderJourney\('error'/);
  assert.match(center, /retry: \(\) => openMatchCenter/);

  const analysis = block(analysisController, 'async function analyzeMatch', 'return Object.freeze');
  assert.match(analysis, /productAction\('ai_start'/);
  assert.match(analysis, /productAction\('ai_complete'/);
  assert.match(analysis, /renderJourney\('loading'/);
  assert.match(analysis, /renderJourney\('error'/);
  assert.match(analysis, /retry: \(\) => analyzeMatch/);
});

test('LIVE refresh is interval-sized, stale-safe and recovers from transient errors', () => {
  const live = block(matchCenterController, 'function isActiveLiveFixture', 'async function openMatchCenter');
  assert.doesNotMatch(live, /setInterval\s*\(/);
  assert.match(live, /setTimer\(async \(\) =>/);
  assert.match(live, /delayMs/);
  assert.match(live, /activeViewId\(\) === 'analysisView'/);
  assert.match(live, /currentCenter\?\.match\?\.fixtureId/);
  assert.match(live, /if \(!data \|\| !isActiveLiveFixture\(fixtureId\)\) return/);
  assert.match(live, /Не удалось обновить\. Повторим автоматически\./);
  assert.match(live, /actionError\('live_refresh'/);
  assert.doesNotMatch(live, /showToast\(error\?\.message\)/);
  assert.match(live, /clearTimer\(liveRefreshTimer\)/);
});

test('history profile and match-list recovery states are actionable', () => {
  assert.match(html, /id="profileRecovery" hidden/);
  assert.match(profileAccessState, /function renderProfileAccessState/);
  assert.match(profileAccessState, /profileRecoveryRetry/);
  assert.match(app, /createProfileAccessStateModule/);

  const history = block(historyRenderer, 'function renderHistory', 'return Object.freeze');
  assert.match(history, /История временно недоступна/);
  assert.match(history, /historyRecoveryRetry/);
  assert.match(history, /История пока пуста/);
  assert.match(history, /Найти матч/);

  const matches = block(app, 'function renderMatches', 'function currentTournamentMatches');
  assert.match(matches, /Матчей на эту дату пока нет/);
  assert.match(matches, /matchesEmptySearch/);
  assert.match(matches, /Найти матч/);
});

test('closed beta contract preserves Telegram to Mini App to profile path', () => {
  assert.match(app, /x-telegram-init-data/);
  assert.match(app, /sendClientTelemetry\('boot_ok'/);
  assert.match(html, /id="matchesView" class="view active"/);
  assert.match(html, /id="navMatches"/);
  assert.match(html, /id="navMyTeams"/);
  assert.doesNotMatch(html, /id="navSearch"/);
  assert.match(html, /id="navHistory"/);
  assert.match(html, /id="navProfile"/);
  assert.match(app, /async function runGlobalSearch/);
  assert.match(app, /async function openMatchCenter/);
  assert.match(app, /async function analyzeMatch/);
  assert.match(app, /function startLiveRefresh/);
  assert.match(app, /async function loadHistory/);
  assert.match(app, /async function openProfileView/);
});

test('beta readiness checklist separates rollout blockers from post-beta improvements', () => {
  assert.match(checklist, /Blocking before beta/);
  assert.match(checklist, /Improvements after beta/);
  assert.match(checklist, /не-админскими/);
  assert.match(checklist, /LIVE/);
  assert.match(checklist, /квоту\/тариф/);
  assert.match(checklist, /privacy-safe|Privacy contract/i);
});
