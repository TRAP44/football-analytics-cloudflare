import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workerCore=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8');
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
  assert.match(decision,/if \(!cfg\.betaAccessEnabled\)/);
  assert.match(decision,/allowed: isTelegramValidatedUser\(user\)/);
  assert.match(decision,/allowed: betaParticipant/);
});

test('production beta mode defaults public and becomes strict only on explicit true',()=>{
  const cfg=block(worker,'function config(env)','function runtimeControlsSnapshot');
  assert.match(cfg,/betaAccessConfigured:\s*boolEnvState\(env\.BETA_ACCESS_ENABLED\)/);
  assert.match(cfg,/betaAccessEnabled:\s*boolEnv\(env\.BETA_ACCESS_ENABLED, false\)/);

  const routes=block(workerCore,"if (!url.pathname.startsWith('/api/'))","async scheduled(controller")+'\n'+router;
  const guard=routes.indexOf('closedBetaAccessDecision(user, cfg)');
  const matches=routes.indexOf("url.pathname === '/api/matches'");
  assert.ok(guard>=0 && matches>guard);
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
  const tasksAt=startup.indexOf('const startupTasks = [loadFavorites(), loadMatches()]');
  assert.ok(blockAt>=0 && tasksAt>blockAt);
});

test('shared quota and cooldown are persisted before provider fan-out',()=>{
  const quota=block(worker,"const PROVIDER_QUOTA_SHARED_CACHE_KEY",'function quotaUsed');
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
  const evidence=block(worker,'async function claimReleaseEvidenceLock','async function readinessSnapshot');
  assert.match(evidence,/BETA_ACCESS_CONFIG_CONFIRMED/);
  assert.match(evidence,/betaAccessConfigured/);
  assert.match(evidence,/betaAllowlistCount/);
  assert.match(evidence,/newestUserBetaAllowlisted/);
  assert.match(evidence,/PROVIDER_RELEASE_QUOTA_PROBE/);
  assert.match(evidence,/apiFootball\('\/status',\{\},cfg,\{responseType:'any',transportRetries:0/);
  assert.match(evidence,/evidenceSource:'controlled_release_probe'/);

  const readinessCompute=block(worker,'async function computeReadinessSnapshot','async function readinessSnapshot');
  assert.match(readinessCompute,/scheduleReleaseFieldEvidence\(cfg\)/);

  const readiness=block(worker,'async function readinessSnapshot','export default');
  assert.match(readiness,/computeReadinessSnapshot\(cfg\)/);
});

test('one normal startup match-list request can make at most one API-Football call',()=>{
  const matches=block(worker,'async function apiMatches','function normalizeStandingRow');
  const calls=(matches.match(/apiFootball\(/g) || []).length;
  assert.equal(calls,1);
  assert.match(matches,/providerBatch/);
  assert.match(matches,/getCache\(providerBatchKey/);
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
