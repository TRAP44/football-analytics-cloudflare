import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker=fs.readFileSync('src/worker.js','utf8');
const analysis=fs.readFileSync('src/analysis-runtime.js','utf8');
const analysisContext=fs.readFileSync('src/analysis-context-runtime.js','utf8');
const teamTournament=fs.readFileSync('src/team-tournament-runtime.js','utf8');
const capabilities=fs.readFileSync('src/app-capabilities.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC136 bounds player pagination for analysis hydration',()=>{
  assert.match(teamTournament,/const maxPages=Math\.min\(3,positiveSafeInteger\(context\?\.maxPages\) \|\| 3\)/);
  assert.match(teamTournament,/async function resolveTeamSeasonPlayers\([\s\S]*options = \{\}/);
  assert.match(analysisContext,/const pageLimit=requestedPages \? Math\.min\(2,requestedPages\) : 1/);
});

test('RC136 hydrates roles only for sides with active reconciled absences',()=>{
  assert.match(analysis,/formatAbsences\(trustedInjuries,homeId,awayId,trustedLineups\)/);
  assert.match(analysis,/const baseAbsences=normalizedAbsences/);
  assert.match(analysis,/const startingXiStatsNeeded=Boolean\(/);
  assert.match(analysis,/needed:baseAbsences\.home\.length>0 \|\| startingXiStatsNeeded/);
  assert.match(analysis,/needed:baseAbsences\.away\.length>0 \|\| startingXiStatsNeeded/);
  assert.match(analysisContext,/needed !== true[\s\S]*!normalizedTeamId[\s\S]*!normalizedLeagueId[\s\S]*!normalizedSeason/);
});

test('RC136 uses a dedicated shared cache and quota guard',()=>{
  assert.match(analysisContext,/analysis:player-role:\$\{normalizedTeamId\}:\$\{normalizedLeagueId\}:\$\{normalizedSeason\}:v1/);
  assert.match(analysisContext,/if \(!quotaHealthy\(12,1\)\)/);
  assert.match(analysisContext,/await setCache\([\s\S]*cacheKey,[\s\S]*normalizedTeamId,[\s\S]*refreshedAt:new Date\(\)\.toISOString\(\),[\s\S]*cfg,[\s\S]*360/);
  assert.match(analysisContext,/source:'analysis-stale-cache'/);
});

test('RC136 exposes hydration provenance and neutral fallback',()=>{
  assert.match(analysis,/playerRoleHydration:\{/);
  assert.match(analysis,/source:safeText\(homeRoleHydration\.source,80\)/);
  assert.match(analysis,/Роль отсутствующих игроков хозяев не уточнена/);
  assert.match(analysis,/analysisVersion:'4\.17\.0-starting-xi'/);
});

test('RC136 remains wired through current analysis hydration runtimes',()=>{
  assert.match(worker,/createAnalysisContextRuntime\(\{/);
  assert.match(worker,/createAnalysisRuntime\(\{/);
  assert.match(analysis,/playerRoleHydration:\{/);
  assert.match(analysisContext,/async function hydratePlayerRolesForAnalysis\(/);
  assert.match(analysisContext,/resolveTeamSeasonPlayers/);
  assert.match(worker,/const APP_VERSION = '6\.120\.0-rc144'/);
});



function hydrationBlock(){
  const start=analysisContext.indexOf('async function hydratePlayerRolesForAnalysis');
  const end=analysisContext.indexOf('function comparisonNumber',start);
  assert.ok(start>=0 && end>start);
  return analysisContext.slice(start,end);
}

test('RC136 prefers cached Team Intelligence player stats before the expensive hydration path',()=>{
  const code=hydrationBlock();
  const supplied=code.indexOf('if (suppliedPlayerStats)');
  const notNeeded=code.indexOf('needed !== true');
  const cache=code.indexOf('await getCache(cacheKey,cfg)');
  assert.ok(supplied>=0 && notNeeded>supplied && cache>notNeeded);
  assert.match(code,/source:'team-intelligence-cache',\s*network:false,\s*stale:false/);
  assert.match(code,/source:'not-needed',\s*network:false,\s*stale:false,\s*reason:'not_needed'/);
});

test('RC136 uses competition-specific cache keys and caps provider pagination',()=>{
  const code=hydrationBlock();
  assert.match(code,/analysis:player-role:\$\{normalizedTeamId\}:\$\{normalizedLeagueId\}:\$\{normalizedSeason\}:v1/);
  assert.match(code,/const pageLimit=requestedPages \? Math\.min\(2,requestedPages\) : 1/);
  assert.match(code,/resolveTeamSeasonPlayers\([\s\S]*?\{maxPages:pageLimit\}/);
  assert.match(code,/source:'analysis-cache',\s*network:false,\s*stale:false/);
});

test('RC136 quota limits preserve stale data but never start unauthorized provider calls',()=>{
  const code=hydrationBlock();
  const guard=code.indexOf('if (!quotaHealthy(12,1))');
  const provider=code.indexOf('await resolveTeamSeasonPlayers(');
  assert.ok(guard>=0 && provider>guard);
  const guarded=code.slice(guard,provider);
  assert.match(guarded,/source:'analysis-stale-cache',\s*network:false,\s*stale:true,\s*reason:'quota_guard'/);
  assert.match(guarded,/source:'unavailable',\s*network:false,\s*stale:false,\s*reason:'quota_guard'/);
  assert.match(code,/getStaleCache\(cacheKey,cfg\)\.catch\(\(\)=>null\)/);
});

test('RC136 leaves failed provider data uncached and exposes fallback provenance',()=>{
  const code=hydrationBlock();
  assert.match(code,/if \(playerStats\) \{\s*await setCache\(/);
  assert.match(code,/refreshedAt:new Date\(\)\.toISOString\(\)/);
  assert.match(code,/source:'analysis-hydration',\s*network:true,\s*stale:false/);
  assert.match(code,/const reason=safeText\(error\?\.code,120\) \|\| 'provider_error'/);
  assert.match(code,/source:'analysis-stale-cache',\s*network:true,\s*stale:true/);
  assert.match(code,/source:'unavailable',\s*network:true,\s*stale:false/);
});
