import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('closed beta issues expose NEEDS_MORE_EVIDENCE without promoting it to an active issue',()=>{
  const issues=block(worker,'function buildBetaIssueGroups','function betaJourneyEventName');
  assert.match(issues,/classification='NEEDS_MORE_EVIDENCE'/);
  assert.match(issues,/\['BLOCKER','MAJOR','MINOR'\]\.includes\(classification\)/);
  assert.match(issues,/clientErrorRows/);
  assert.match(issues,/repeated_telemetry/);
  assert.match(issues,/needs_more_evidence/);
});

test('closed beta full journey requires the exact ordered path and a real re-entry',()=>{
  const journey=block(worker,'function betaJourneySummary','function latestConfirmedProviderQuota');
  const ordered=[
    "'miniapp_open'",
    "'miniapp_search_used'",
    "'miniapp_search_found'",
    "'miniapp_match_open'",
    "'miniapp_ai_start'",
    "'miniapp_ai_complete'",
    "'miniapp_history_open'",
    "'miniapp_open'",
  ];
  let at=-1;
  for (const token of ordered) {
    const next=journey.indexOf(token,at+1);
    assert.ok(next>at,token);
    at=next;
  }
  assert.match(journey,/fullCompleted/);
  assert.match(journey,/analysisCompleted/);
  assert.match(journey,/sort\(\(a,b\)=>Date\.parse/);
});

test('beta launch readiness uses server config, Telegram getWebhookInfo and persistent provider quota evidence',()=>{
  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(dashboard,/billingWebhookStatus\(request,cfg\)/);
  assert.match(dashboard,/cfg\.betaTelegramIds/);
  assert.match(dashboard,/cfg\.adminTelegramIds/);
  assert.match(dashboard,/strictBetaAccess:Boolean\(cfg\.betaAccessEnabled\)/);
  assert.match(dashboard,/beta_admin_overlap/);
  assert.match(dashboard,/telegram_webhook_unconfirmed/);
  assert.match(dashboard,/provider_quota_unconfirmed/);
  assert.match(dashboard,/idsReturned:false/);
  assert.match(dashboard,/LIVE field validation and CI\/release evidence remain separate evidence gates/);
});

test('provider probe persists only bounded quota facts for later launch evidence',()=>{
  const probe=block(worker,'async function apiProviderProbe','async function apiProviderCoverageAudit');
  assert.match(probe,/PROVIDER_QUOTA_CONFIRMED/);
  assert.match(probe,/PROVIDER_QUOTA_INCOMPLETE/);
  for (const key of ['plan','dailyLimit','dailyRemaining','minuteLimit','minuteRemaining']) {
    assert.match(probe,new RegExp(key));
  }
  assert.doesNotMatch(probe,/apiFootballKey|x-apisports-key|TELEGRAM_BOT_TOKEN/);
});

test('closed-beta launch evidence stays historical while primary admin UI shows Phase 5 public validation',()=>{
  const legacy=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(legacy,/betaAssignments/);
  assert.match(legacy,/telegramWebhook/);
  assert.match(legacy,/providerQuota/);
  const render=block(app,'function renderBetaDashboard','async function loadBetaDashboard');
  assert.match(render,/Verified normal users/);
  assert.match(render,/API-Football quota/);
  assert.match(render,/Phase 5 status/);
  assert.match(render,/COLLECT MORE EVIDENCE/);
  assert.doesNotMatch(render,/Beta-01\/Beta-02/);
});


test('beta data coverage stays inside existing privacy-safe telemetry and tracks required football gaps',()=>{
  const telemetry=block(worker,'const CLIENT_TELEMETRY_EVENTS','const BETA_FEEDBACK_CATEGORIES');
  assert.match(telemetry,/'data_coverage'/);
  for (const key of ['lineupsAvailable','injuriesAvailable','statisticsAvailable','xgAvailable','oddsAvailable']) {
    assert.match(telemetry,new RegExp(key));
  }
  assert.doesNotMatch(telemetry,/fixtureId.*data_coverage|teamName.*data_coverage|searchText.*data_coverage/);
  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(dashboard,/dataCoverage:coverage/);
  for (const key of ['lineups','injuries','statistics','xg','odds']) {
    assert.match(dashboard,new RegExp(key));
  }
  assert.match(app,/sendMatchDataCoverage\(data, sourceView\)/);
  assert.match(app,/sendClientTelemetry\('data_coverage'/);
});

test('new provider review still requires systematic beta evidence rather than one missing field',()=>{
  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(dashboard,/coverage\.samples>=10/);
  assert.match(dashboard,/systematicMissingCategories>=2/);
  assert.match(dashboard,/dataSourceFeedback>=2/);
  assert.match(dashboard,/insufficient_evidence/);
});
