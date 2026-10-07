import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closedBetaAccessDecision } from '../src/access-control.js';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const clientTelemetryRuntime=readFileSync(new URL('../src/client-telemetry-runtime.js',import.meta.url),'utf8');
const betaPhase5Runtime=readFileSync(new URL('../src/beta-phase5-runtime.js',import.meta.url),'utf8');
const router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const betaDashboard=readFileSync(new URL('../public/modules/admin-beta-dashboard.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/modules/client-core.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const adminIndex=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');

test('public access remains default while strict beta stays explicit',()=>{
  const user={id:123456,__telegramValidated:true};
  assert.equal(closedBetaAccessDecision(user,{betaAccessEnabled:false,betaTelegramIds:[]}).allowed,true);
  assert.equal(closedBetaAccessDecision(user,{betaTelegramIds:[]}).allowed,true);
  assert.equal(closedBetaAccessDecision(user,{betaAccessEnabled:true,betaTelegramIds:[]}).allowed,false);
  assert.equal(closedBetaAccessDecision(user,{betaAccessEnabled:true,betaTelegramIds:[123456]}).allowed,true);
});

test('Phase 5 cohort is verified normal-user based and independent from beta membership',()=>{
  assert.match(clientTelemetryRuntime,/PHASE5_VALIDATION_COHORT\s*=\s*'phase5_public_v2'/);
  assert.match(clientTelemetryRuntime,/isTelegramValidatedUser\(user\)/);
  assert.match(clientTelemetryRuntime,/isAdminUser\(user,cfg\)/);
  assert.match(clientTelemetryRuntime,/x-phase5-session/);
  assert.match(clientTelemetryRuntime,/validationSubject/);
  assert.match(clientTelemetryRuntime,/validationSession/);
  assert.match(clientTelemetryRuntime,/hmacSha256/);
  const context=clientTelemetryRuntime.slice(
    clientTelemetryRuntime.indexOf('async function phase5ValidationContext'),
    clientTelemetryRuntime.indexOf('function phase5ProviderUsage'),
  );
  assert.doesNotMatch(context,/isClosedBetaUser/);
  assert.doesNotMatch(context,/betaTelegramIds/);
});

test('Phase 5 dashboard is admin-only and legacy strict-beta dashboard remains available',()=>{
  assert.match(router,/pathname === '\/api\/phase5-dashboard'/);
  assert.match(router,/return await apiPhase5Dashboard/);
  assert.match(router,/pathname === '\/api\/beta-dashboard'/);
  assert.match(router,/return await apiBetaDashboard/);
  assert.match(betaDashboard,/\/api\/phase5-dashboard\?days=/);
  assert.match(adminIndex,/Phase 5 Dashboard/);
  assert.match(adminIndex,/Public Validation/);
});

test('Phase 5 evidence excludes legacy rows and has exact initial thresholds',()=>{
  assert.match(betaPhase5Runtime,/validationCohort===PHASE5_VALIDATION_COHORT/);
  assert.match(betaPhase5Runtime,/legacyClosedBetaRowsExcluded:true/);
  assert.match(betaPhase5Runtime,/verifiedNormalUsers:\{required:5/);
  assert.match(betaPhase5Runtime,/sessions:\{required:10/);
  assert.match(betaPhase5Runtime,/fullJourneys:\{required:5/);
  assert.match(betaPhase5Runtime,/searchSamples:\{required:10/);
  assert.match(betaPhase5Runtime,/matchCenterSamples:\{required:10/);
  assert.match(betaPhase5Runtime,/aiSamples:\{required:10/);
  assert.match(betaPhase5Runtime,/coverageObservations:\{required:20/);
  assert.match(betaPhase5Runtime,/INSUFFICIENT_LIVE_SAMPLE/);
  assert.match(betaPhase5Runtime,/COLLECT MORE EVIDENCE/);
});

test('raw identity is not persisted in Phase 5 dashboard evidence',()=>{
  assert.match(betaPhase5Runtime,/telegramIdsReturned:false/);
  assert.match(betaPhase5Runtime,/telegramIdsStoredInValidationTelemetry:false/);
  assert.match(betaPhase5Runtime,/rawSessionTokensStored:false/);
  assert.match(betaPhase5Runtime,/hmacSubjectsOnly:true/);
  assert.match(betaPhase5Runtime,/adminExcluded:true/);
  assert.match(betaPhase5Runtime,/unsignedExcluded:true/);
  assert.match(betaPhase5Runtime,/syntheticDevIdentityExcluded:true/);
  assert.match(betaPhase5Runtime,/smokeAndHealthExcluded:true/);
});

test('client creates a per-session token and sends it only with authenticated app requests',()=>{
  assert.match(client,/sessionStorage/);
  assert.match(client,/phase5SessionToken/);
  assert.match(client,/headers\.set\('x-phase5-session', validationSession\)/);
  assert.match(app,/PHASE5_SESSION_TOKEN/);
  assert.match(app,/'x-phase5-session': PHASE5_SESSION_TOKEN/);
});

test('provider cost is separated by product request kind and observed request behavior',()=>{
  for (const kind of ['search','matches_feed','match_center','ai','live_refresh']) assert.match(clientTelemetryRuntime,new RegExp("'" + kind + "'"));
  for (const metric of ['networkRequests','cacheHits','staleCacheHits','quotaBlocks','sharedCooldowns','requestsPerSession','requestsPerCompletedJourney','cacheHitRatePct','aiRequestsPerUser','liveRequestsPerActiveUser']) assert.match(betaPhase5Runtime,new RegExp(metric));
  assert.match(betaPhase5Runtime,/Projection uses observed production requests\/session/);
  assert.match(betaPhase5Runtime,/capacityDecision/);
  assert.match(betaPhase5Runtime,/coverageDecision/);
});

test('provider capacity decision uses observed usage and never auto-upgrades from plan size alone',()=>{
  const start=betaPhase5Runtime.indexOf('async function apiPhase5Dashboard');
  const end=betaPhase5Runtime.indexOf('async function apiBetaDashboard',start);
  const dashboard=betaPhase5Runtime.slice(start,end);
  assert.match(dashboard,/requestsPerSession/);
  assert.match(dashboard,/cacheHitRatePct/);
  assert.match(dashboard,/quotaState\.confirmed/);
  assert.match(dashboard,/dailyHeadroomSessions/);
  assert.match(dashboard,/repeatedCapacityPressure/);
  assert.match(dashboard,/CAPACITY REVIEW REQUIRED/);
  assert.match(dashboard,/upgradeAutomatic:false/);
  assert.doesNotMatch(dashboard,/CAPACITY UPGRADE REQUIRED/);
});

test('closed beta remains a separate legacy dashboard while Phase 5 owns public validation',()=>{
  assert.match(betaPhase5Runtime,/async function apiBetaDashboard/);
  assert.match(betaPhase5Runtime,/async function apiPhase5Dashboard/);
  assert.match(betaPhase5Runtime,/legacyClosedBetaRowsExcluded:true/);
  assert.match(clientTelemetryRuntime,/PHASE5_VALIDATION_COHORT\s*=\s*'phase5_public_v2'/);
});
