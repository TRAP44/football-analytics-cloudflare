import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closedBetaAccessDecision } from '../src/access-control.js';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/modules/client-core.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const phase5Doc=readFileSync(new URL('../PHASE5_PUBLIC_VALIDATION_RU.md',import.meta.url),'utf8');
const historical=readFileSync(new URL('../CLOSED_BETA_OBSERVATION_RU.md',import.meta.url),'utf8');

test('public access remains default while strict beta stays explicit',()=>{
  const user={id:123456,__telegramValidated:true};
  assert.equal(closedBetaAccessDecision(user,{betaAccessEnabled:false,betaTelegramIds:[]}).allowed,true);
  assert.equal(closedBetaAccessDecision(user,{betaTelegramIds:[]}).allowed,true);
  assert.equal(closedBetaAccessDecision(user,{betaAccessEnabled:true,betaTelegramIds:[]}).allowed,false);
  assert.equal(closedBetaAccessDecision(user,{betaAccessEnabled:true,betaTelegramIds:[123456]}).allowed,true);
});

test('Phase 5 cohort is verified normal-user based and independent from beta membership',()=>{
  assert.match(worker,/PHASE5_VALIDATION_COHORT\s*=\s*'phase5_public_v1'/);
  assert.match(worker,/isTelegramValidatedUser\(user\)/);
  assert.match(worker,/isAdminUser\(user,cfg\)/);
  assert.match(worker,/x-phase5-session/);
  assert.match(worker,/validationSubject/);
  assert.match(worker,/validationSession/);
  assert.match(worker,/hmacSha256/);
  const context=worker.slice(worker.indexOf('async function phase5ValidationContext'),worker.indexOf('function phase5ProviderUsage'));
  assert.doesNotMatch(context,/isClosedBetaUser/);
  assert.doesNotMatch(context,/betaTelegramIds/);
});

test('Phase 5 dashboard is admin-only and legacy strict-beta dashboard remains available',()=>{
  assert.match(router,/\/api\/phase5-dashboard/);
  assert.match(router,/return await apiPhase5Dashboard/);
  assert.match(router,/\/api\/beta-dashboard/);
  assert.match(router,/return await apiBetaDashboard/);
  assert.match(app,/\/api\/phase5-dashboard\?days=/);
  assert.match(index,/Phase 5 Dashboard/);
  assert.match(index,/Public Validation/);
});

test('Phase 5 evidence excludes legacy rows and has exact initial thresholds',()=>{
  assert.match(worker,/validationCohort===PHASE5_VALIDATION_COHORT/);
  assert.match(worker,/legacyClosedBetaRowsExcluded:true/);
  assert.match(worker,/verifiedNormalUsers:\{required:5/);
  assert.match(worker,/sessions:\{required:10/);
  assert.match(worker,/fullJourneys:\{required:5/);
  assert.match(worker,/searchSamples:\{required:10/);
  assert.match(worker,/matchCenterSamples:\{required:10/);
  assert.match(worker,/aiSamples:\{required:10/);
  assert.match(worker,/coverageObservations:\{required:20/);
  assert.match(worker,/INSUFFICIENT_LIVE_SAMPLE/);
  assert.match(worker,/COLLECT MORE EVIDENCE/);
});

test('raw identity is not persisted in Phase 5 dashboard evidence',()=>{
  assert.match(worker,/telegramIdsReturned:false/);
  assert.match(worker,/telegramIdsStoredInValidationTelemetry:false/);
  assert.match(worker,/rawSessionTokensStored:false/);
  assert.match(worker,/hmacSubjectsOnly:true/);
  assert.match(worker,/adminExcluded:true/);
  assert.match(worker,/unsignedExcluded:true/);
  assert.match(worker,/syntheticDevIdentityExcluded:true/);
  assert.match(worker,/smokeAndHealthExcluded:true/);
});

test('client creates a per-session token and sends it only with authenticated app requests',()=>{
  assert.match(client,/sessionStorage/);
  assert.match(client,/phase5SessionToken/);
  assert.match(client,/headers\.set\('x-phase5-session', validationSession\)/);
  assert.match(app,/PHASE5_SESSION_TOKEN/);
  assert.match(app,/'x-phase5-session': PHASE5_SESSION_TOKEN/);
});

test('provider cost is separated by product request kind and observed request behavior',()=>{
  for (const kind of ['search','matches_feed','match_center','ai','live_refresh']) assert.match(worker,new RegExp("'" + kind + "'"));
  for (const metric of ['networkRequests','cacheHits','staleCacheHits','quotaBlocks','sharedCooldowns','requestsPerSession','requestsPerCompletedJourney','cacheHitRatePct','aiRequestsPerUser','liveRequestsPerActiveUser']) assert.match(worker,new RegExp(metric));
  assert.match(worker,/Projection uses observed production requests\/session/);
  assert.match(worker,/capacityDecision/);
  assert.match(worker,/coverageDecision/);
});

test('provider capacity decision uses observed usage and never auto-upgrades from plan size alone',()=>{
  const start=worker.indexOf('async function apiPhase5Dashboard');
  const end=worker.indexOf('async function apiBetaDashboard',start);
  const dashboard=worker.slice(start,end);
  assert.match(dashboard,/requestsPerSession/);
  assert.match(dashboard,/cacheHitRatePct/);
  assert.match(dashboard,/quotaState\.confirmed/);
  assert.match(dashboard,/dailyHeadroomSessions/);
  assert.match(dashboard,/repeatedCapacityPressure/);
  assert.match(dashboard,/CAPACITY REVIEW REQUIRED/);
  assert.match(dashboard,/upgradeAutomatic:false/);
  assert.doesNotMatch(dashboard,/CAPACITY UPGRADE REQUIRED/);
});

test('closed-beta artifacts are historical rather than public readiness gates',()=>{
  assert.match(historical,/SUPERSEDED ДЛЯ ОСНОВНОГО PRODUCTION-VALIDATION С PHASE 5/);
  assert.match(phase5Doc,/Beta-01\/Beta-02/);
  assert.match(phase5Doc,/manual waves 2 → 4 → 6/);
  assert.match(phase5Doc,/Phase 6 не начинается/);
});
