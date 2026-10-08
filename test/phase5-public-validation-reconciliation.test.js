import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closedBetaAccessDecision } from '../src/access-control.js';
import { phase5SessionToken } from '../public/modules/client-core.js';

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
  assert.match(adminIndex,/Проверка публичного сценария/);
  assert.match(adminIndex,/Production Dashboard/);
  assert.match(betaDashboard,/PUBLIC VALIDATION HEALTHY/);
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



test('public access never treats an unverified normal user as authenticated',()=>{
  const config={betaAccessEnabled:false,betaTelegramIds:[123456]};
  for(const user of [null,{id:123456},{id:123456,__telegramValidated:false},{id:0,__telegramValidated:true},{id:'not-an-id',__telegramValidated:true}]){
    const decision=closedBetaAccessDecision(user,config);
    assert.equal(decision.allowed,false);
    assert.equal(decision.adminBypass,false);
  }
  const valid={id:123456,__telegramValidated:true};
  assert.equal(closedBetaAccessDecision(valid,config).allowed,true);
  assert.equal(closedBetaAccessDecision(valid,{...config,betaAccessEnabled:true}).allowed,true);
  assert.equal(closedBetaAccessDecision(valid,{...config,betaAccessEnabled:true,betaTelegramIds:[]}).allowed,false);
});

test('Phase 5 session token is 128-bit hex, reused in-session and regenerated after corruption',()=>{
  const cache=new Map();
  let generated=0;
  const scope={
    sessionStorage:{
      getItem:key=>cache.get(key)??null,
      setItem:(key,value)=>cache.set(key,value),
    },
    crypto:{getRandomValues(bytes){generated++;for(let i=0;i<bytes.length;i++)bytes[i]=i+1;return bytes;}},
  };
  const token=phase5SessionToken(scope);
  assert.match(token,/^[0-9a-f]{32}$/);
  assert.equal(generated,1);
  assert.equal(phase5SessionToken(scope),token);
  assert.equal(generated,1);
  const [key]=cache.keys();
  assert.match(key,/phase5-session:v2$/);
  cache.set(key,'invalid-token');
  assert.equal(phase5SessionToken(scope),token);
  assert.equal(generated,2);
  assert.equal(phase5SessionToken({sessionStorage:scope.sessionStorage}),token);
});

test('Phase 5 session token fails closed without crypto or when storage throws',()=>{
  assert.equal(phase5SessionToken({sessionStorage:{getItem:()=>null}}),'');
  assert.equal(phase5SessionToken({
    sessionStorage:{getItem(){throw new Error('Storage blocked');}},
    crypto:{getRandomValues(){}},
  }),'');
});

test('Phase 5 dashboard handlers check admin authorization before serving evidence',()=>{
  for(const [route,handler] of [
    ['/api/phase5-dashboard','apiPhase5Dashboard'],
    ['/api/beta-dashboard','apiBetaDashboard'],
  ]){
    const start=router.indexOf("if (method === 'GET' && pathname === '"+route+"')");
    assert.ok(start>=0,'Missing dashboard route '+route);
    const block=router.slice(start,start+260);
    assert.match(block,/if \(!adminAllowed\(\)\) return adminForbidden\(\);/);
    assert.ok(block.indexOf('adminForbidden()')<block.indexOf('return await '+handler+'('));
  }
});

test('Phase 5 does not record raw Telegram identity or unhashed session as validation evidence',()=>{
  const start=clientTelemetryRuntime.indexOf('async function phase5ValidationContext');
  const end=clientTelemetryRuntime.indexOf('function phase5ProviderUsage',start);
  assert.ok(start>=0 && end>start);
  const context=clientTelemetryRuntime.slice(start,end);
  assert.match(context,/isTelegramValidatedUser\(user\)/);
  assert.match(context,/isAdminUser\(user,cfg\)/);
  assert.match(context,/!cfg\.botToken/);
  assert.match(context,/^\s*if \(!\/\^\[0-9a-f\]\{32\}\$\/\.test\(rawSession\)\) return null;/m);
  assert.match(context,/hmacSha256/);
  assert.match(context,/bytesToHex\(subjectDigest\)\.slice\(0,32\)/);
  assert.match(context,/bytesToHex\(sessionDigest\)\.slice\(0,32\)/);
  assert.doesNotMatch(context,/rawSession\s*:/);
});
