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

test('beta expansion is fail-closed until real verified evidence is sufficient',()=>{
  const decision=block(worker,'function betaExpansionDecision','function buildBetaIssueGroups');
  assert.match(decision,/verifiedUsers:\{required:2,actual:betaUsers,pass:betaUsers>=2\}/);
  assert.doesNotMatch(decision,/verifiedUsers:\{required:5/);
  assert.match(decision,/verifiedSessionStarts:\{required:7/);
  assert.match(decision,/fullJourneys:\{required:2/);
  assert.match(decision,/searchTimingSamples:\{required:3/);
  assert.match(decision,/matchTimingSamples:\{required:3/);
  assert.match(decision,/aiTimingSamples:\{required:3/);
  assert.match(decision,/coverageSamples:\{required:10/);
  assert.match(decision,/status='collecting_verified_beta'/);
  assert.match(decision,/status='hold'/);
  assert.match(decision,/status='expand_with_data_limitations'/);
  assert.match(decision,/status='ready_to_expand'/);
});

test('closed beta launch cannot be marked complete unless expansion is actually allowed',()=>{
  const decision=block(worker,'function betaExpansionDecision','function buildBetaIssueGroups');
  assert.match(decision,/const expansionAllowed=\['ready_to_expand','expand_with_data_limitations'\]\.includes\(status\)/);
  assert.match(decision,/closedBetaLaunchStageComplete:expansionAllowed/);
  assert.match(decision,/confirmed_blocker/);
  assert.match(decision,/confirmed_major/);
  assert.match(decision,/beta_ops_sample_truncated/);
});

test('data coverage decision does not recommend a provider without enough evidence',()=>{
  const decision=block(worker,'function betaExpansionDecision','function buildBetaIssueGroups');
  assert.match(decision,/collect_more_coverage/);
  assert.match(decision,/review_new_or_paid_provider/);
  assert.match(decision,/keep_current_provider/);
  assert.match(decision,/providerEvidence==='review_provider_options'/);

  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(dashboard,/providerSignals>=5/);
  assert.match(dashboard,/coverage\.samples>=10/);
  assert.match(dashboard,/systematicMissingCategories>=2/);
  assert.match(dashboard,/dataSourceFeedback>=2/);
});

test('dashboard exposes the expansion decision without raw identities',()=>{
  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(dashboard,/expansionDecision/);
  assert.match(dashboard,/closedBetaLaunchStageComplete/);
  assert.match(dashboard,/dataCoverageDecision/);
  assert.match(dashboard,/idsReturned:false/);
  assert.doesNotMatch(dashboard,/betaTelegramIdsReturned|telegramIdsReturned:true/);

  assert.match(app,/Verified normal users/);
  assert.match(app,/Phase 5 status/);
  assert.match(app,/Capacity decision/);
  assert.match(app,/Coverage decision/);
  assert.doesNotMatch(block(app,'function renderBetaDashboard','async function'),/Closed Beta Launch завершён/);
});

test('verified session definition stays inside existing closed beta telemetry',()=>{
  const decision=block(worker,'function betaExpansionDecision','function buildBetaIssueGroups');
  assert.match(decision,/BOOT_OK event after telemetry dedupe/);
  const dashboard=block(worker,'async function apiBetaDashboard','async function readOpsEventsRange');
  assert.match(dashboard,/metrics,/);
  assert.match(dashboard,/journey,/);
  assert.doesNotMatch(decision,/growth_events|new analytics|second pipeline/i);
});
