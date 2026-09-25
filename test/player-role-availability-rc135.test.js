import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichFixtureAbsencesWithSeasonRole, normalizeFixtureAbsences } from '../src/availability.js';

function baseAbsence(id = 10, name = 'Key Player') {
  return normalizeFixtureAbsences([{ team:{id:1}, player:{id,name,type:'Injury',reason:'Muscle injury'} }], { homeId:1, awayId:2 });
}

test('RC135 exact id adds bounded season-role weight', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(), {homePlayerStats:{available:true,complete:true,scope:'team-season',sourceMeta:{provider:'api-football'},players:[{id:10,name:'Key Player',source:'api-football',games:{appearances:20,lineups:19,minutes:1680,position:'Midfielder'},goals:{total:6,assists:7}}]}});
  const role=data.home[0].seasonRole;
  assert.equal(role.matched,true);
  assert.ok(role.weight>=1.35 && role.weight<=1.60);
  assert.equal(role.label,'Высокая игровая нагрузка');
  assert.equal(data.summary.seasonRole.home.matched,1);
});

test('RC135 unique normalized name fallback works across providers', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(30,'José Álvarez'), {homePlayerStats:{available:true,partial:true,scope:'competition-scorers',sourceMeta:{provider:'football-data'},players:[{id:0,providerId:999,name:'Jose Alvarez',source:'football-data',games:{appearances:9,lineups:null,minutes:null,position:'Forward'},goals:{total:7,assists:2}}]}});
  assert.equal(data.home[0].seasonRole?.matched,true);
  assert.ok(data.home[0].seasonRole.weight>=1 && data.home[0].seasonRole.weight<=1.20);
});

test('RC135 ambiguous names are not force-matched', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(0,'Alex Silva'), {homePlayerStats:{available:true,players:[{id:101,name:'Alex Silva',games:{appearances:10,lineups:8,minutes:700},goals:{total:1,assists:1}},{id:102,name:'Alex Silva',games:{appearances:9,lineups:7,minutes:620},goals:{total:2,assists:0}}]}});
  assert.equal(data.home[0].seasonRole,undefined);
  assert.equal(data.summary.seasonRole.home.matched,0);
});

test('RC135 small samples shrink toward neutral', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(), {homePlayerStats:{available:true,players:[{id:10,name:'Key Player',games:{appearances:1,lineups:1,minutes:90},goals:{total:1,assists:1}}]}});
  const weight=data.home[0].seasonRole.weight;
  assert.ok(weight>=0.85 && weight<=1.60);
  assert.ok(Math.abs(weight-1)<0.10);
});

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC135 reuses Team Intelligence v2 without player endpoint calls in apiAnalyze', () => {
  assert.match(worker,/async function cachedTeamIntelligenceForAnalysis/);
  assert.match(worker,/enrichFixtureAbsencesWithSeasonRole\(formatAbsences\(injuries, homeId, awayId, lineups\), \{ homePlayerStats, awayPlayerStats \}\)/);
  const start=worker.indexOf('async function apiAnalyze');
  const analyze=worker.slice(start);
  assert.doesNotMatch(analyze,/apiFootballTeamSeasonPlayers\(/);
});

test('RC135 keeps weighted availability bounded and doubtful at half weight', () => {
  assert.match(worker,/clamp\(roleWeightRaw, 0\.85, 1\.60\)/);
  assert.match(worker,/row\?\.status === 'doubtful' \? 0\.5 : 1/);
  assert.match(worker,/clamp\(\(awayCount - homeCount\) \* 0\.55, -3\.3, 3\.3\)/);
});

test('RC135 exposes methodology without a player quality score', () => {
  assert.match(worker,/availabilityUnits:\{home:homeUnits,away:awayUnits\}/);
  assert.match(worker,/seasonRoleCoverage:/);
  assert.match(worker,/Это не рейтинг качества игрока/);
  assert.doesNotMatch(worker,/playerImpactScore|playerQualityScore/);
  assert.match(app,/x\.seasonRole\?\.matched \? x\.seasonRole\.label : ''/);
});

test('RC135 updates model-input and health identity', () => {
  assert.match(worker,/analysisVersion: '4\.9\.0-player-role'/);
  assert.match(worker,/playerRoleAvailability: 'enabled'/);
  assert.match(worker,/const APP_VERSION = '6\.111\.0-rc135'/);
  assert.match(worker,/const RC_NAME = 'RC135'/);
  assert.match(app,/const CLIENT_VERSION = '6\.111\.0-rc135'/);
});
