import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const profileAccessState = fs.readFileSync('public/modules/profile-access-state.js', 'utf8');
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
    'matches_open','search_used','search_found','search_empty','match_open','live_open',
    'ai_start','ai_complete','history_open','history_item_open','profile_open',
  ]) {
    assert.ok(app.includes("sendProductAction('" + action + "'"), action);
  }
  assert.match(app, /function sendProductAction\(reason, view = telemetryViewName\(\)\)/);
  assert.match(app, /sendClientTelemetry\('product_action'/);
  const sender = block(app, 'function sendClientTelemetry', 'function sendProductAction');
  assert.doesNotMatch(sender, /query|teamName|leagueName|searchText/);
});

test('main action failures are measured by category, not free-form error text', () => {
  for (const action of ['matches','search','match','live_refresh','ai','history','profile']) {
    assert.ok(app.includes("sendActionError('" + action + "'"), action);
  }
  const helper = block(app, 'function sendActionError', 'function renderJourneyState');
  assert.match(helper, /apiErrorCategory\(error\)/);
  assert.doesNotMatch(helper, /error\?\.message/);
});

test('match and AI transitions have explicit loading error and retry states', () => {
  const center = block(app, 'async function openMatchCenter', 'function syncAnalysisBusyUi');
  assert.match(center, /showView\('analysisView'\)/);
  assert.match(center, /renderJourneyState\('loading'/);
  assert.match(center, /renderJourneyState\('error'/);
  assert.match(center, /retry: \(\) => openMatchCenter/);

  const analysis = block(app, 'async function analyzeMatch', 'function historyItemFromAnalysis');
  assert.match(analysis, /sendProductAction\('ai_start'/);
  assert.match(analysis, /sendProductAction\('ai_complete'/);
  assert.match(analysis, /renderJourneyState\('loading'/);
  assert.match(analysis, /renderJourneyState\('error'/);
  assert.match(analysis, /retry: \(\) => analyzeMatch/);
});

test('LIVE background refresh keeps the current screen usable on transient errors', () => {
  const live = block(app, 'function startLiveRefresh', 'function signedPp');
  assert.match(live, /Не удалось обновить\. Повторим автоматически\./);
  assert.match(live, /sendActionError\('live_refresh'/);
  assert.doesNotMatch(live, /toast\(e\.message\)/);
});

test('history profile and match-list recovery states are actionable', () => {
  assert.match(html, /id="profileRecovery" hidden/);
  assert.match(profileAccessState, /function renderProfileAccessState/);
  assert.match(profileAccessState, /profileRecoveryRetry/);
  assert.match(app, /createProfileAccessStateModule/);

  const history = block(app, 'function renderHistory', 'function pct');
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
