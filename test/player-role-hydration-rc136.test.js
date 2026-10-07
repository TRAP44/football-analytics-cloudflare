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
  assert.match(analysis,/const baseAbsences\s*=\s*formatAbsences\(trustedInjuries,homeId,awayId,lineups\)/);
  assert.match(analysis,/needed:baseAbsences\.home\.length>0/);
  assert.match(analysis,/needed:baseAbsences\.away\.length>0/);
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
  assert.match(analysis,/hydrateUnavailablePlayerRoles/);
  assert.match(analysisContext,/resolveTeamSeasonPlayers/);
  assert.match(worker,/const APP_VERSION = '6\.120\.0-rc144'/);
});
