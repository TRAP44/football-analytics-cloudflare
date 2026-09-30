import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const betaDashboard=readFileSync(new URL('../public/modules/admin-beta-dashboard.js',import.meta.url),'utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('controlled beta expansion stays manual and uses two small waves',()=>{
  const decision=block(worker,'function controlledBetaExpansionDecision','function buildBetaIssueGroups');
  assert.match(decision,/automaticExpansion:false/);
  assert.match(decision,/waveSize:2/);
  assert.match(decision,/wave1:\{target:4,observed:wave1Observed\}/);
  assert.match(decision,/wave2:\{target:6,observed:wave2Observed\}/);
  assert.match(decision,/assignedUsers<nextWaveTarget/);
  assert.match(decision,/providerValidationDecision!==\'review_new_or_paid_provider\'/);
});

test('controlled expansion final decision is fail-closed and uses the requested outcomes',()=>{
  const decision=block(worker,'function controlledBetaExpansionDecision','function buildBetaIssueGroups');
  for (const value of [
    'BETA READY FOR PUBLIC PRE-LAUNCH',
    'BETA CONTINUE',
    'DATA PROVIDER UPGRADE REQUIRED',
    'BETA HOLD',
  ]) assert.match(decision,new RegExp(value.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')));
  assert.match(decision,/!expansionDecision\?\.expansionAllowed/);
  assert.match(decision,/blockerCount>0 \|\| majorCount>0/);
  assert.match(decision,/productionMonitor\?\.state===\'incident\'/);
});

test('provider validation uses quota pressure, repeated rate-limit and LIVE coverage evidence',()=>{
  const decision=block(worker,'function controlledBetaExpansionDecision','function buildBetaIssueGroups');
  assert.match(decision,/providerRateLimit>=3/);
  assert.match(decision,/dailyRemainingPct<=10/);
  assert.match(decision,/minuteRemainingPct<=10/);
  assert.match(decision,/coverage\?\.live\?\.samples \|\| 0\)>=5/);
  assert.match(decision,/liveMissingCategories>=2/);
  assert.match(decision,/review_new_or_paid_provider/);
  assert.doesNotMatch(decision,/buy|purchase|subscribe|auto.?connect/i);
});

test('wave checks reuse existing beta telemetry and expose requested operational evidence',()=>{
  const decision=block(worker,'function controlledBetaExpansionDecision','function buildBetaIssueGroups');
  for (const token of [
    'miniAppLaunch','search','matchOpen','ai','fullJourneys','reentries',
    'latency','actionErrors','clientErrors','supabaseOk','telegramConfirmed',
    'productionMonitor','live',
  ]) assert.match(decision,new RegExp(token));
  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(dashboard,/controlledExpansion/);
  assert.match(dashboard,/betaProductionMonitorSummary\(allOpsRows,now\)/);
  assert.match(dashboard,/providerQuota/);
});

test('provider quota exposes limits and remaining values without secrets',()=>{
  const quota=block(worker,'function latestConfirmedProviderQuota','async function apiBetaDashboard');
  for (const key of ['dailyLimit','dailyRemaining','minuteLimit','minuteRemaining']) assert.match(quota,new RegExp(key));
  assert.doesNotMatch(quota,/apiFootballKey|x-apisports-key|TELEGRAM_BOT_TOKEN/);
});

test('legacy controlled-expansion decision stays server-side while admin primary dashboard moves to Phase 5',()=>{
  const decision=block(worker,'function controlledBetaExpansionDecision','function buildBetaIssueGroups');
  assert.match(decision,/BETA READY FOR PUBLIC PRE-LAUNCH/);
  assert.match(decision,/DATA PROVIDER UPGRADE REQUIRED/);
  const render=block(betaDashboard,'function renderBetaDashboard','async function loadBetaDashboard');
  assert.match(render,/verifiedNormalUsers/);
  assert.match(render,/Provider requests\/session/);
  assert.match(render,/Capacity decision/);
  assert.match(render,/Coverage decision/);
  assert.match(render,/Phase 5 status/);
  assert.doesNotMatch(render,/Следующая beta-волна/);
});


test('BETA HOLD exposes actionable field blockers instead of fabricating beta evidence',()=>{
  const decision=block(worker,'function controlledBetaExpansionDecision','function buildBetaIssueGroups');
  for (const token of [
    'fieldBlockers','initialGateGaps','nextRequiredAction','beta_users_not_assigned',
    'verified_beta_telemetry_missing','assign_real_beta_users','collect_verified_beta_usage',
    'evidenceTargets',
  ]) assert.match(decision,new RegExp(token));
  assert.match(decision,/assignedUsers<2/);
  assert.match(decision,/verifiedUsers===0/);
  assert.match(decision,/launchBlockers/);
  assert.match(decision,/strict_beta_access_disabled/);
  assert.match(decision,/provider_quota_unconfirmed/);
  assert.match(decision,/confirm_provider_quota/);
  assert.doesNotMatch(decision,/BETA_TELEGRAM_IDS\s*=/);

  const render=block(betaDashboard,'function renderBetaDashboard','async function loadBetaDashboard');
  assert.match(render,/COLLECT MORE EVIDENCE/);
  assert.match(render,/INSUFFICIENT_LIVE_SAMPLE|liveStatus/);
  assert.doesNotMatch(render,/Назначить минимум 2 реальных beta-пользователя/);
  assert.doesNotMatch(render,/Незакрытые требования gate/);
});
