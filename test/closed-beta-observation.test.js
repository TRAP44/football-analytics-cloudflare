import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../src/router.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../src/auth-user.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/modules/global-search-controller.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const adminHtml=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');

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

test('admin first level is owner status while Phase 5 and technical tools stay under details',()=>{
  assert.match(adminHtml,/OWNER DASHBOARD/);
  assert.match(adminHtml,/id="adminOverviewDatabase"/);
  assert.match(adminHtml,/id="adminOverviewNotifications"/);
  assert.match(adminHtml,/id="adminOverviewAi"/);
  assert.match(adminHtml,/id="betaHealthPanel"/);
  assert.match(adminHtml,/id="betaDashboardPanel"/);
  assert.match(adminHtml,/id="adminAdvancedTools"/);
  assert.match(adminHtml,/Расширенные инструменты/);
  const organize=block(app,'function organizeAdminConsole','async function loadAdvancedAdminTools');
  for (const panel of ['#betaHealthPanel','#betaDashboardPanel','runtime-controls-panel','provider-status-panel','diagnostics-panel','model-quality-panel']) {
    assert.ok(organize.includes(panel),panel);
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
  assert.match(telemetry,/isClosedBetaUser\(user, cfg\)/);
  assert.match(telemetry,/betaMembershipVerified:\s*true/);
  const feedback=block(worker,'async function apiBetaFeedback','function betaMetricSummary');
  assert.match(feedback,/isClosedBetaUser\(user,cfg\)/);
  assert.match(feedback,/betaMembershipVerified:true/);
  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(dashboard,/metadata\?\.betaCohort/);
  assert.match(dashboard,/betaMembershipVerified===true/);
  assert.match(dashboard,/cohort:CLOSED_BETA_COHORT/);
  assert.match(dashboard,/membershipBoundary:'server_allowlist_verified'/);
  const subject=block(worker,'async function closedBetaTelemetrySubject','const CLIENT_TELEMETRY_VIEWS');
  assert.match(subject,/hmacSha256/);
  assert.match(subject,/cfg\.botToken/);
  assert.match(subject,/slice\(0,32\)/);
  assert.match(telemetry,/!betaParticipant && event === 'boot_ok'/);
  assert.match(telemetry,/!betaParticipant && event === 'product_action'/);
  assert.match(telemetry,/!betaParticipant && event === 'action_error'/);
  assert.match(dashboard,/betaClientRows/);
  assert.match(dashboard,/betaSubject/);
  assert.match(dashboard,/telegramIdsStoredInBetaTelemetry:false/);
  assert.doesNotMatch(dashboard,/growth_events|telegram_id/);
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
