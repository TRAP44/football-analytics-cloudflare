import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workerCore=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8');
const providerRoutes=readFileSync(new URL('../src/provider-route-registry.js',import.meta.url),'utf8');
const providerFixtureRuntime=readFileSync(new URL('../src/provider-fixture-runtime.js',import.meta.url),'utf8');
const worker=workerCore+'\n'+router+'\n'+readFileSync(new URL('../src/api-football-gateway.js',import.meta.url),'utf8');
const appCore=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const clientCore=readFileSync(new URL('../public/modules/client-core.js',import.meta.url),'utf8');
const app=appCore+'\n'+clientCore;

function block(source,start,end){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('access-control helper opens signed normal users unless strict beta is explicitly enabled',()=>{
  const access=readFileSync(new URL('../src/access-control.js',import.meta.url),'utf8');
  const start=access.indexOf('export function closedBetaAccessDecision');
  assert.notEqual(start,-1);
  const decision=access.slice(start);
  assert.match(decision,/if \(cfg\.betaAccessEnabled !== true\)/);
  assert.match(decision,/allowed: isTelegramValidatedUser\(user\)/);
  assert.match(decision,/allowed: betaParticipant/);
});

test('production beta mode defaults public and becomes strict only on explicit true',()=>{
  const cfg=block(readFileSync('src/common-infrastructure-runtime.js','utf8'),'function config(env)','function currentReleaseIdentity');
  assert.match(cfg,/betaAccessConfigured:\s*boolEnvState\(env\.BETA_ACCESS_ENABLED\)/);
  assert.match(cfg,/betaAccessEnabled:\s*boolEnv\(env\.BETA_ACCESS_ENABLED, false\)/);

  const routes=readFileSync('src/worker-bootstrap-runtime.js','utf8');
  const guard=routes.indexOf('closedBetaAccessDecision(user,cfg)');
  const dispatch=routes.indexOf('dispatchApiRoute(request,url,cfg,user,API_ROUTE_DEPS)',guard);
  assert.ok(guard>=0 && dispatch>guard);
  assert.match(providerRoutes,/method:'GET', path:'\/api\/matches', handler:'apiMatches'/);
  assert.match(routes,/CLOSED_BETA_ACCESS_DENIED/);
  assert.match(routes,/providerRequests:0/);
});

test('unauthorized Mini App stops before favorites and match loading',()=>{
  assert.match(app,/closedBetaBlocked:\s*false/);
  const api=block(clientCore,'return async function api(path','\n  };\n}');
  assert.match(api,/CLOSED_BETA_ACCESS_REQUIRED/);
  assert.match(api,/state\.closedBetaBlocked = true/);
  assert.match(api,/title: 'Доступ временно ограничен'/);

  const startup=block(appCore,'async function runStartupSequence','const api = createApiClient');
  const blockAt=startup.indexOf('if (state.closedBetaBlocked) return false;');
  const tasksAt=startup.indexOf('const startupTasks = [loadFavorites(), loadMatches({ snapshotFastPath:true })]');
  assert.ok(blockAt>=0 && tasksAt>blockAt);
});

test('shared quota and cooldown are persisted before provider fan-out',()=>{
  const quota=readFileSync('src/provider-budget-runtime.js','utf8');
  assert.match(quota,/provider-state:api-football:quota:v1/);
  assert.match(quota,/provider-state:api-football:cooldown:v1/);
  assert.match(quota,/loadSharedProviderState/);
  assert.match(quota,/persistSharedProviderQuota/);
  assert.match(quota,/persistSharedProviderCooldown/);
  assert.match(quota,/setCache\(PROVIDER_QUOTA_SHARED_CACHE_KEY/);
  assert.match(quota,/getCache\(PROVIDER_COOLDOWN_SHARED_CACHE_KEY/);

  const network=block(worker,'async function apiFootballNetwork','function providerRequestKey');
  assert.match(network,/await loadSharedProviderState\(cfg\)/);
  assert.match(network,/await persistSharedProviderQuota\(cfg\)/);
  assert.match(network,/persistSharedProviderCooldown\(cfg, retryAfter/);
  assert.match(network,/persistSharedProviderCooldown\(cfg, 65/);
});

test('FREE distributed budget leaves boundary safety margin',()=>{
  const budget=block(worker,'function distributedProviderMinuteLimit','async function claimDistributedProviderBudget');
  assert.match(budget,/rawBudget/);
  assert.match(budget,/plan === 'FREE' \|\| plan === 'UNKNOWN'/);
  assert.match(budget,/Math\.floor\(rawBudget \/ 2\)/);
});

test('release evidence captures beta config and one real provider quota probe',()=>{
  const evidence=readFileSync('src/release-field-evidence.js','utf8');
  assert.match(evidence,/BETA_ACCESS_CONFIG_CONFIRMED/);
  assert.match(evidence,/betaAccessConfigured/);
  assert.match(evidence,/betaAllowlistCount/);
  assert.match(evidence,/newestUserBetaAllowlisted/);
  assert.match(evidence,/PROVIDER_RELEASE_QUOTA_PROBE/);
  assert.match(evidence,/apiFootball\('\/status',\{\},cfg,\{\s*responseType:'any',\s*transportRetries:0/);
  assert.match(evidence,/evidenceSource:'controlled_release_probe'/);

  const readinessCompute=readFileSync('src/public-status.js','utf8');
  assert.match(readinessCompute,/scheduleReleaseFieldEvidence\(cfg\)/);

  const readiness=readFileSync('src/public-health.js','utf8');
  assert.match(readiness,/computeReadiness\(context\)/);
});

test('one normal startup match-list request delegates to one bounded shared provider loader',()=>{
  const matches=block(providerFixtureRuntime,'async function apiMatches','  return {');
  assert.equal((matches.match(/apiFootball\(/g) || []).length,0);
  assert.equal((matches.match(/loadProviderFixturesForDate\(/g) || []).length,1);
  assert.match(matches,/providerBatch/);
  assert.match(matches,/getCache\(providerBatchKey/);

  const loader=block(providerFixtureRuntime,'async function loadProviderFixturesForDate','function providerTeamDiscoveryCacheKey');
  assert.equal((loader.match(/apiFootball\(/g) || []).length,1);
  assert.match(loader,/apiFootball\('\/fixtures',\{date:normalized\},cfg\)/);
});


test('configured distributed provider guard degradation fails closed while no-Supabase mode stays locally bounded',()=>{
  const gateway=readFileSync(new URL('../src/api-football-gateway.js',import.meta.url),'utf8');
  assert.match(gateway,/function emergencyProviderMinuteLimit/);
  assert.match(gateway,/function claimEmergencyLocalProviderBudget/);
  assert.match(gateway,/return claimEmergencyLocalProviderBudget\('supabase_not_configured'\)/);
  assert.match(gateway,/reason:'guard_unavailable'/);
  assert.match(gateway,/allowed:false,[\s\S]*degraded:true,[\s\S]*local:false/);
  assert.doesNotMatch(gateway,/return claimEmergencyLocalProviderBudget\('guard_unavailable'\)/);
  assert.match(gateway,/FOOTBALL_GUARD_DEGRADED/);
});

test('distributed provider quota uses one server-side atomic guard and fails closed on errors',()=>{
  const gateway=readFileSync(new URL('../src/api-football-gateway.js',import.meta.url),'utf8');
  const section=block(gateway,'async function claimDistributedProviderBudget','async function apiFootballNetwork');
  assert.match(section,/supaRpc\(cfg,'claim_provider_request'/);
  assert.match(section,/p_bucket_key:'api-football:minute'/);
  assert.match(section,/p_window_seconds:60/);
  assert.match(section,/result\?\.allowed !== true && result\?\.allowed !== false/);
  assert.match(section,/reason:'guard_unavailable'/);
  assert.match(section,/allowed:false,[\s\S]*degraded:true,[\s\S]*local:false/);
  assert.doesNotMatch(section,/claimEmergencyLocalProviderBudget\('guard_unavailable'\)/);
});
test('concurrency CI verifies distributed provider quota per fixed time window',()=>{
  const gate=readFileSync(new URL('../scripts/supabase-concurrency-gate.js',import.meta.url),'utf8');
  const section=block(gate,'async function testProviderBudget','async function testTelegramDedupe');
  assert.match(section,/const limit = 4/);
  assert.match(section,/Array\.from\(\{ length: 12 \}/);
  assert.match(section,/Promise\.all\(/);
  assert.match(section,/claim_provider_request/);
  assert.match(section,/assertProviderBudgetWindows\(decoded,limit\)/);
  assert.match(section,/count>=1 && count<=limit/);
});
