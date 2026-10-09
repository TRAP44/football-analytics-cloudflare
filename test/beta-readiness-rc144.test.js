import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClientTelemetryRuntime } from '../src/client-telemetry-runtime.js';
import { createBetaPhase5Runtime } from '../src/beta-phase5-runtime.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const matchCenterController = readFileSync(new URL('../public/modules/match-center-controller.js', import.meta.url), 'utf8');
const analysisController = readFileSync(new URL('../public/modules/analysis-controller.js', import.meta.url), 'utf8');
const globalSearchController = readFileSync(new URL('../public/modules/global-search-controller.js', import.meta.url), 'utf8');
const profileAccessState = readFileSync(new URL('../public/modules/profile-access-state.js', import.meta.url), 'utf8');
const journeyState = readFileSync(new URL('../public/modules/journey-state.js', import.meta.url), 'utf8');
const historyRenderer = readFileSync(new URL('../public/modules/history-renderer.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

const PRODUCT_ACTIONS = new Set([
  'matches_open',
  'search_used',
  'search_found',
  'search_empty',
  'match_open',
  'live_open',
  'ai_start',
  'ai_complete',
  'history_open',
  'history_item_open',
  'profile_open',
  'player_open',
]);

const ACTION_ERROR_REASONS = new Set([
  'matches',
  'search',
  'match',
  'live_refresh',
  'ai',
  'history',
  'profile',
  'profile_modules',
  'billing_ui',
]);

const ACTION_ERROR_KINDS = new Set([
  'offline',
  'maintenance',
  'feature_disabled',
  'auth',
  'timeout',
  'rate_limit',
  'integrity',
  'database',
  'provider',
  'service',
  'unknown',
]);

const TELEMETRY_EVENTS = new Set([
  'boot_ok',
  'boot_recovery',
  'compatibility_block',
  'network_recovery',
  'client_error',
  'product_action',
  'action_error',
  'operation_timing',
  'data_coverage',
]);

const TIMING_OPERATIONS = new Set(['search', 'match', 'ai', 'live']);

function block(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `${startNeedle} missing`);
  assert.ok(end > start, `${endNeedle} missing after ${startNeedle}`);
  return source.slice(start, end);
}

function extractSet(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(match, `${name} set missing`);
  return new Set([...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(item => item[1]));
}

function readJavaScriptTree(root) {
  let source = '';
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) source += readJavaScriptTree(path);
    else if (name.endsWith('.js')) source += `\n// ${path}\n${readFileSync(path, 'utf8')}`;
  }
  return source;
}

function createTelemetryHarness({ closedBeta = false } = {}) {
  const ops = [];
  const growth = [];
  const memory = { clientTelemetryDedupe: new Map() };
  const runtime = createClientTelemetryRuntime({
    CLIENT_ACTION_ERROR_KINDS: ACTION_ERROR_KINDS,
    CLIENT_ACTION_ERROR_REASONS: ACTION_ERROR_REASONS,
    CLIENT_PRODUCT_ACTIONS: PRODUCT_ACTIONS,
    CLIENT_TELEMETRY_EVENTS: TELEMETRY_EVENTS,
    CLIENT_TIMING_OPERATIONS: TIMING_OPERATIONS,
    CLOSED_BETA_COHORT: 'closed_beta_v1',
    bytesToHex: bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join(''),
    enc: new TextEncoder(),
    ensureLaunchAttribution: async () => ({}),
    hmacSha256: async () => new Uint8Array(32).fill(0xab),
    isAdminUser: () => false,
    isClosedBetaUser: () => closedBeta,
    isTelegramValidatedUser: () => true,
    json: (body, status = 200) => ({ body, status }),
    memory,
    pruneMemoryState: () => {},
    recordGrowthEvent: async (_cfg, event) => { growth.push(event); },
    recordOpsEvent: async (_cfg, event) => { ops.push(event); },
    redactOpsString: (value, max = 200) => String(value ?? '').slice(0, max),
  });
  return { runtime, ops, growth, memory };
}

function telemetryRequest(body) {
  return { json: async () => body };
}

test('client telemetry allowlists stay aligned with every literal product/error action emitted by public JS', () => {
  const serverProductActions = extractSet(worker, 'CLIENT_PRODUCT_ACTIONS');
  const serverErrorReasons = extractSet(worker, 'CLIENT_ACTION_ERROR_REASONS');
  assert.deepEqual(serverProductActions, PRODUCT_ACTIONS);
  assert.deepEqual(serverErrorReasons, ACTION_ERROR_REASONS);

  const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
  const publicSource = readJavaScriptTree(publicRoot);
  const emittedProductActions = new Set(
    [...publicSource.matchAll(/\b(?:sendProductAction|productAction)\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
  );
  const emittedErrorReasons = new Set(
    [...publicSource.matchAll(/\b(?:sendActionError|actionError)\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
  );

  const unknownProducts = [...emittedProductActions].filter(value => !serverProductActions.has(value));
  const unknownErrors = [...emittedErrorReasons].filter(value => !serverErrorReasons.has(value));
  assert.deepEqual(unknownProducts, []);
  assert.deepEqual(unknownErrors, []);
  assert.doesNotMatch(publicSource, /sendProductAction\(\s*['"]open['"]/);

  assert.match(globalSearchController, /'search_found'\s*:\s*'search_empty'|'search_found'\s*:\s*'search_empty'/);
  assert.ok(serverProductActions.has('search_found'));
  assert.ok(serverProductActions.has('search_empty'));
});

test('telemetry metadata strips unapproved user text and rejects unsupported actions', async () => {
  const { runtime, ops } = createTelemetryHarness();

  const accepted = await runtime.apiClientTelemetry(
    telemetryRequest({
      event: 'product_action',
      meta: {
        reason: 'SEARCH_USED',
        view: 'searchView',
        query: 'private search text',
        teamName: 'private team',
        message: 'backend details',
        username: 'private-user',
      },
    }),
    {},
    { id: 1001 },
  );

  assert.deepEqual(accepted, { status: 200, body: { ok: true, deduped: false } });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].meta.reason, 'search_used');
  const serialized = JSON.stringify(ops[0]);
  assert.doesNotMatch(serialized, /private search text|private team|backend details|private-user/);

  const rejected = await runtime.apiClientTelemetry(
    telemetryRequest({ event: 'product_action', meta: { reason: 'not_allowlisted' } }),
    {},
    { id: 1002 },
  );
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, 'Unsupported product action.');
  assert.equal(ops.length, 1);
});

test('closed-beta telemetry uses a pseudonymous subject and never writes raw identity to growth events', async () => {
  const { runtime, ops, growth } = createTelemetryHarness({ closedBeta: true });
  const rawUserId = 987654321;

  const result = await runtime.apiClientTelemetry(
    telemetryRequest({
      event: 'action_error',
      meta: {
        reason: 'profile_modules',
        errorKind: 'service',
        view: 'profileView',
      },
    }),
    { botToken: 'test-bot-token' },
    { id: rawUserId },
  );

  assert.equal(result.status, 200);
  assert.equal(growth.length, 0);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].meta.betaMembershipVerified, true);
  assert.equal(ops[0].meta.betaCohort, 'closed_beta_v1');
  assert.match(ops[0].meta.betaSubject, /^[0-9a-f]{32}$/);
  assert.doesNotMatch(JSON.stringify(ops[0]), new RegExp(String(rawUserId)));
});

test('ambiguous numeric telemetry cannot fabricate zero-duration or boot evidence', async () => {
  const { runtime, ops } = createTelemetryHarness();

  const metadata = runtime.clientTelemetryMetadata({
    meta: {
      apiContract: false,
      bootMs: null,
      moduleReadyMs: '',
      viewportWidth: true,
    },
  }, 'boot_ok');
  assert.equal('apiContract' in metadata, false);
  assert.equal('bootMs' in metadata, false);
  assert.equal('moduleReadyMs' in metadata, false);
  assert.equal('viewportWidth' in metadata, false);

  const invalidTiming = await runtime.apiClientTelemetry(
    telemetryRequest({
      event: 'operation_timing',
      meta: { reason: 'search', durationMs: null, view: 'searchView' },
    }),
    {},
    { id: 1003 },
  );
  assert.equal(invalidTiming.status, 400);
  assert.equal(invalidTiming.body.error, 'Unsupported operation timing.');
  assert.equal(ops.length, 0);

  const validTiming = await runtime.apiClientTelemetry(
    telemetryRequest({
      event: 'operation_timing',
      meta: { reason: 'search', durationMs: '123.6', view: 'searchView' },
    }),
    {},
    { id: 1003 },
  );
  assert.equal(validTiming.status, 200);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].durationMs, 124);
});

test('critical Mini App journey keeps bounded analytics and explicit loading/retry states', () => {
  const sender = block(app, 'function sendClientTelemetry', 'function sendProductAction');
  assert.doesNotMatch(sender, /query|teamName|leagueName|searchText/);
  assert.match(app, /sendProductAction\('matches_open', 'matchesView'\)/);
  assert.match(app, /sendProductAction\('history_open'/);
  assert.match(app, /sendProductAction\('history_item_open'/);
  assert.match(app, /sendProductAction\('profile_open'/);
  assert.match(app, /sendProductAction\('player_open'/);
  assert.match(globalSearchController, /safeCall\(productAction,'search_used','searchView'\)/);

  const center = block(matchCenterController, 'async function openMatchCenter', 'return Object.freeze');
  assert.match(center, /safeCall\(showView,'analysisView'\)/);
  assert.match(center, /safeCall\(renderJourney,'loading'/);
  assert.match(center, /safeCall\(renderJourney,'error'/);
  assert.match(center, /retry:\(\)=>openMatchCenter/);
  assert.match(center, /safeCall\(productAction,'match_open'/);

  const analysis = block(analysisController, 'async function analyzeMatch', 'return Object.freeze');
  assert.match(analysis, /safeCall\(productAction,'ai_start'/);
  assert.match(analysis, /safeCall\(productAction,'ai_complete'/);
  assert.match(analysis, /safeCall\(renderJourney,'loading'/);
  assert.match(analysis, /safeCall\(renderJourney,'error'/);
  assert.match(analysis, /retry:\(\)=>analyzeMatch/);

  assert.match(journeyState, /analysisStateRetry/);
});

test('LIVE refresh remains timeout-sized, stale-safe and automatically recoverable', () => {
  const live = block(matchCenterController, 'function isActiveLiveFixture', 'async function openMatchCenter');
  assert.doesNotMatch(live, /setInterval\s*\(/);
  assert.match(live, /safeCall\(setTimer,async\(\)=>/);
  assert.match(live, /refreshDelayMs/);
  assert.match(live, /currentView\(\)==='analysisView'/);
  assert.match(live, /currentCenterFixtureId\(\)===id/);
  assert.match(live, /if \(!data \|\| !isActiveLiveFixture\(id\)\) return/);
  assert.match(live, /Не удалось обновить\. Повторим автоматически\./);
  assert.match(live, /safeCall\(actionError,'live_refresh'/);
  assert.match(live, /safeCall\(clearTimer,liveRefreshTimer\)/);
  assert.doesNotMatch(live, /setInterval\s*\(|showToast\(error\?\.message\)/);
});

test('profile, history and match-list recovery states remain actionable', () => {
  assert.match(html, /id="profileRecovery" hidden/);
  assert.match(profileAccessState, /profileRecoveryRetry/);
  assert.match(profileAccessState, /onRetry/);

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

test('Telegram-to-Mini-App navigation contract keeps the canonical public path', () => {
  assert.match(app, /x-telegram-init-data/);
  assert.match(app, /sendClientTelemetry\('boot_ok'/);
  assert.match(html, /id="matchesView" class="view active"/);
  for (const id of ['navMatches', 'navMyTeams', 'navHistory', 'navProfile']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="navSearch"/);
  assert.match(globalSearchController, /async function runGlobalSearch/);
  assert.match(matchCenterController, /async function openMatchCenter/);
  assert.match(analysisController, /async function analyzeMatch/);
  assert.match(matchCenterController, /function startLiveRefresh/);
  assert.match(app, /async function loadHistory/);
  assert.match(app, /async function openProfileView/);
});

test('profile-module and billing-UI failures contribute to beta UX issue classification', () => {
  const runtime = createBetaPhase5Runtime({});
  const issues = runtime.buildBetaIssueGroups({
    metrics: {
      miniAppLaunch: { events: 4 },
      historyOpen: { events: 0 },
      profileOpen: { events: 2 },
      searchUsed: { events: 0 },
      matchOpen: { events: 0 },
      aiStart: { events: 0 },
      liveOpen: { events: 0 },
    },
    errorRows: [
      { metadata: { action: 'profile_modules' } },
      { metadata: { action: 'billing_ui' } },
    ],
    feedbackRows: [],
    timings: {},
    clientErrorRows: [],
  });

  const ux = issues.find(issue => issue.category === 'ux');
  assert.ok(ux);
  assert.equal(ux.telemetryErrors, 2);
  assert.equal(ux.classification, 'MAJOR');
  assert.equal(ux.active, true);
});
