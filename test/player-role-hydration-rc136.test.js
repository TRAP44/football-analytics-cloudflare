import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker=fs.readFileSync('src/worker.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC136 bounds player pagination for analysis hydration',()=>{
  assert.match(worker,/const maxPages=Math\.max\(1,Math\.min\(3,Number\(context\.maxPages \|\| 3\)\)\)/);
  assert.match(worker,/async function resolveTeamSeasonPlayers\([\s\S]*options = \{\}/);
  assert.match(worker,/maxPages:Math\.max\(1,Math\.min\(2,Number\(maxPages \|\| 1\)\)\)/);
});

test('RC136 hydrates roles only for sides with active reconciled absences',()=>{
  assert.match(worker,/const baseAbsences = formatAbsences\(injuries, homeId, awayId, lineups\)/);
  assert.match(worker,/needed:baseAbsences\.home\.length>0/);
  assert.match(worker,/needed:baseAbsences\.away\.length>0/);
  assert.match(worker,/if \(!needed \|\| !teamId \|\| !leagueId \|\| !season\)/);
});

test('RC136 uses a dedicated shared cache and quota guard',()=>{
  assert.match(worker,/analysis:player-role:\$\{Number\(teamId\)\}:\$\{Number\(leagueId\)\}:\$\{Number\(season\)\}:v1/);
  assert.match(worker,/if \(!freeQuotaHealthy\(12,1\)\)/);
  assert.match(worker,/await setCache\(cacheKey,teamId,\{playerStats,refreshedAt:new Date\(\)\.toISOString\(\)\},cfg,360\)/);
  assert.match(worker,/source:'analysis-stale-cache'/);
});

test('RC136 exposes hydration provenance and neutral fallback',()=>{
  assert.match(worker,/playerRoleHydration:\{/);
  assert.match(worker,/home:\{source:homeRoleHydration\.source/);
  assert.match(worker,/Роль отсутствующих игроков хозяев не уточнена/);
  assert.match(worker,/analysisVersion: '4\.12\.0-lineup-reliability'/);
});

test('RC136 is part of release health contract',()=>{
  assert.match(worker,/playerRoleHydration: 'enabled'/);
  assert.match(worker,/const APP_VERSION = '6\.114\.0-rc138'/);
  assert.match(worker,/const RC_NAME = 'RC138'/);
  assert.match(smoke,/'playerRoleHydration'/);
});
