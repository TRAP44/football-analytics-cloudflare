import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('closed beta telemetry adds bounded operation timings only',()=>{
  assert.match(worker,/operation_timing/);
  assert.match(worker,/CLIENT_TIMING_OPERATIONS = new Set\(\['search', 'match', 'ai', 'live'\]\)/);
  const metadata=block(worker,'function clientTelemetryMetadata','async function apiClientTelemetry');
  assert.match(metadata,/durationMs/);
  assert.doesNotMatch(metadata,/query|teamName|leagueName|searchText/);
  assert.match(app,/function sendOperationTiming/);
  assert.match(app,/sendOperationTiming\('search'/);
  assert.match(app,/sendOperationTiming\('match'/);
  assert.match(app,/sendOperationTiming\('ai'/);
  assert.match(app,/sendOperationTiming\('live'/);
});

test('beta feedback is explicit and does not attach identity or logs to the record',()=>{
  const endpoint=block(worker,'async function apiBetaFeedback','function betaMetricSummary');
  assert.match(endpoint,/explicitUserFeedback:true/);
  assert.doesNotMatch(endpoint,/user\.id|telegram_id|query|initData|error\.message/);
  assert.match(html,/id="betaFeedbackOpenBtn"[^>]*>Сообщить о проблеме<\/button>/);
  assert.match(html,/Telegram ID, поисковые запросы, введённые названия команд и технические логи/);
});

test('beta dashboard returns aggregate product metrics health timings and classified issues',()=>{
  const endpoint=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  for (const event of [
    'miniapp_open','miniapp_search_used','miniapp_search_found','miniapp_search_empty',
    'miniapp_match_open','miniapp_ai_start','miniapp_ai_complete','miniapp_live_open',
    'miniapp_history_open','miniapp_profile_open','miniapp_error',
  ]) assert.match(endpoint,new RegExp(event));
  assert.match(endpoint,/telegramIdsReturned:false/);
  assert.match(endpoint,/searchQueriesReturned:false/);
  assert.match(endpoint,/errorTextsReturned:false/);
  assert.match(endpoint,/feedbackTextsReturned:false/);
  const timing=block(worker,'function betaTimingSummary','function betaFeedbackCounts');
  assert.match(timing,/medianMs/);
  assert.match(timing,/p90Ms/);
  assert.match(endpoint,/providerRateLimit/);
  assert.match(endpoint,/timeout/);
  assert.match(endpoint,/activeProblems/);
  const classifications=block(worker,'function buildBetaIssueGroups','async function apiBetaDashboard');
  assert.match(classifications,/BLOCKER/);
  assert.match(classifications,/MAJOR/);
  assert.match(classifications,/MINOR/);
});

test('single subjective feedback is not automatically promoted to an active beta issue',()=>{
  const issues=block(worker,'function buildBetaIssueGroups','async function apiBetaDashboard');
  assert.match(issues,/feedback\.severity\.BLOCKER>=2/);
  assert.match(issues,/feedback\.severity\.MAJOR>=2/);
  assert.match(issues,/feedback\.severity\.MINOR>=2/);
  assert.match(issues,/correlated/);
  assert.match(issues,/needs_more_evidence/);
});

test('admin first level is beta health while technical tools stay under details',()=>{
  assert.match(html,/id="betaHealthPanel"/);
  assert.match(html,/id="betaDashboardPanel"/);
  assert.match(html,/id="adminAdvancedTools"/);
  assert.match(html,/Технические разделы/);
  const organize=block(app,'function organizeAdminConsole','async function loadAdvancedAdminTools');
  for (const panel of ['runtime-controls-panel','provider-status-panel','diagnostics-panel','model-quality-panel']) {
    assert.match(organize,new RegExp(panel));
  }
});

test('beta dashboard is admin-only while feedback remains available to beta users',()=>{
  assert.match(worker,/url\.pathname === '\/api\/beta-dashboard'[\s\S]*isAdminUser\(user, cfg\)/);
  assert.match(worker,/url\.pathname === '\/api\/beta-feedback'/);
  assert.doesNotMatch(html,/beta-feedback-panel" data-admin-only/);
});


test('closed beta dashboard requires verified server-side membership and excludes pre-boundary cohort rows',()=>{
  assert.match(worker,/const CLOSED_BETA_COHORT = 'closed_beta_v1'/);
  const telemetry=block(worker,'async function apiClientTelemetry','const BETA_FEEDBACK_CATEGORIES');
  assert.match(telemetry,/closedBetaTelemetryMetadata\(user, cfg\)/);
  assert.match(telemetry,/betaMembershipVerified===true/);
  const feedback=block(worker,'async function apiBetaFeedback','function betaMetricSummary');
  assert.match(feedback,/isClosedBetaUser\(user,cfg\)/);
  assert.match(feedback,/betaMembershipVerified:true/);
  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(dashboard,/metadata\?\.betaCohort/);
  assert.match(dashboard,/betaMembershipVerified===true/);
  assert.match(dashboard,/cohort:CLOSED_BETA_COHORT/);
  assert.match(dashboard,/membershipBoundary:'server_allowlist_verified'/);
});


test('beta telemetry stores no raw Telegram ID and dashboard counts only server-pseudonymized participants',()=>{
  const identity=block(worker,'async function closedBetaTelemetryMetadata','function betaProductEventName');
  assert.match(identity,/hmacSha256/);
  assert.match(identity,/betaParticipantKey/);
  assert.match(identity,/betaMembershipVerified:true/);

  const telemetry=block(worker,'async function apiClientTelemetry','const BETA_FEEDBACK_CATEGORIES');
  assert.match(telemetry,/const betaParticipant = betaMeta\.betaMembershipVerified===true/);
  assert.match(telemetry,/event === 'product_action' && !betaParticipant/);
  assert.match(telemetry,/event === 'action_error' && !betaParticipant/);

  const metric=block(worker,'function betaMetricSummary','function betaTimingSummary');
  assert.match(metric,/betaProductEventName/);
  assert.match(metric,/betaParticipantKey/);
  assert.doesNotMatch(metric,/telegram_id/);

  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.doesNotMatch(dashboard,/growth_events|telegram_id/);
  assert.match(dashboard,/participantKeysReturned:false/);
});

test('strict beta API gate runs only after Telegram initData validation and before normal API routing',()=>{
  const auth=block(worker,'async function getRequestUser','async function upsertUser');
  assert.match(auth,/validateTelegramInitData/);
  assert.match(auth,/const telegramValidated = Boolean\(user\)/);
  assert.match(auth,/user\.__telegramValidated = telegramValidated/);
  const userAt=worker.indexOf('const user = await getRequestUser(request, cfg)');
  const betaAt=worker.indexOf('const betaAccess = closedBetaAccessDecision(user, cfg)',userAt);
  const runtimeAt=worker.indexOf('const runtimeState = await loadRuntimeControls(cfg)',userAt);
  assert.ok(userAt>=0 && betaAt>userAt && runtimeAt>betaAt);
  assert.match(worker,/CLOSED_BETA_ACCESS_REQUIRED/);
  assert.match(worker,/apiBetaFeedback\(request, cfg, user\)/);
});
