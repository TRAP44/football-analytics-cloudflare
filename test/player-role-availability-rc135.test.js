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

test('RC135 does not name-fallback across providers when the absence has an authoritative id', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(30,'José Álvarez'), {homePlayerStats:{available:true,partial:true,scope:'competition-scorers',sourceMeta:{provider:'football-data'},players:[{id:0,providerId:999,name:'Jose Alvarez',source:'football-data',games:{appearances:9,lineups:null,minutes:null,position:'Forward'},goals:{total:7,assists:2}}]}});
  assert.equal(data.home[0].seasonRole,undefined);
  assert.equal(data.summary.seasonRole.home.matched,0);
});

test('RC135 foreign provider ids cannot collide with API-Football absence ids', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(999,'Different Player'), {homePlayerStats:{available:true,partial:true,sourceMeta:{provider:'football-data'},players:[{id:0,providerId:999,name:'Another Player',source:'football-data',games:{appearances:12},goals:{total:5,assists:1}}]}});
  assert.equal(data.home[0].seasonRole,undefined);
});

test('RC135 ambiguous names are not force-matched', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(0,'Alex Silva'), {homePlayerStats:{available:true,players:[{id:101,name:'Alex Silva',games:{appearances:10,lineups:8,minutes:700},goals:{total:1,assists:1}},{id:102,name:'Alex Silva',games:{appearances:9,lineups:7,minutes:620},goals:{total:2,assists:0}}]}});
  assert.equal(data.home[0].seasonRole,undefined);
  assert.equal(data.summary.seasonRole.home.matched,0);
});

test('RC135 malformed season counters fail closed instead of fabricating a neutral role', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(), {
    homePlayerStats:{
      available:true,
      players:[{
        id:10,
        name:'Key Player',
        games:{appearances:'Infinity',lineups:-5,minutes:'NaN'},
        goals:{total:2.5,assists:-1},
      }],
    },
  });
  assert.equal(data.home[0].seasonRole,undefined);
  assert.equal(data.summary.seasonRole.home.matched,0);
});

test('RC135 season role counters reject arrays booleans and coercible containers', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(), {
    homePlayerStats:{
      available:true,
      players:[{
        id:10,
        name:'Key Player',
        games:{appearances:[12],lineups:true,minutes:{valueOf:()=>900}},
        goals:{total:[4],assists:'3'},
      }],
    },
  });
  const role=data.home[0].seasonRole;
  assert.equal(role.appearances,0);
  assert.equal(role.lineups,0);
  assert.equal(role.minutes,0);
  assert.equal(role.goals,0);
  assert.equal(role.assists,3);
  assert.ok(Number.isFinite(role.weight));
});

test('RC135 small samples shrink toward neutral', () => {
  const data=enrichFixtureAbsencesWithSeasonRole(baseAbsence(), {homePlayerStats:{available:true,players:[{id:10,name:'Key Player',games:{appearances:1,lineups:1,minutes:90},goals:{total:1,assists:1}}]}});
  const weight=data.home[0].seasonRole.weight;
  assert.ok(weight>=0.85 && weight<=1.60);
  assert.ok(Math.abs(weight-1)<0.10);
});

const worker=fs.readFileSync('src/worker.js','utf8');
const analysis=fs.readFileSync('src/analysis-runtime.js','utf8');
const analysisContext=fs.readFileSync('src/analysis-context-runtime.js','utf8');
const analysisQuality=fs.readFileSync('src/analysis-quality-runtime.js','utf8');
const modelIntelligence=fs.readFileSync('src/model-intelligence-runtime.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const runtime=fs.readFileSync('public/modules/app-runtime.js','utf8');

test('RC135 weighting remains cache-first while RC136 hydrates only missing roles', () => {
  assert.match(analysisContext,/async function cachedTeamIntelligenceForAnalysis/);
  assert.match(analysis,/formatAbsences\(trustedInjuries,homeId,awayId,trustedLineups\)/);
  assert.match(analysis,/cachedPlayerStats:cachedHomePlayerStats,[\s\S]{0,220}?needed:baseAbsences\.home\.length>0/);
  assert.match(analysis,/cachedPlayerStats:cachedAwayPlayerStats,[\s\S]{0,220}?needed:baseAbsences\.away\.length>0/);
  assert.match(analysis,/enrichFixtureAbsencesWithSeasonRole\([\s\S]{0,220}?baseAbsences,[\s\S]{0,220}?\{homePlayerStats,awayPlayerStats\}/);
});

test('RC135 keeps weighted availability bounded and doubtful at half weight', () => {
  assert.match(modelIntelligence,/clamp\(roleWeightRaw, 0\.85, 1\.60\)/);
  assert.match(modelIntelligence,/row\?\.status === 'doubtful' \? 0\.5 : 1/);
  assert.match(modelIntelligence,/clamp\(\(awayCount-homeCount\)\*0\.55,-3\.3,3\.3\)/);
});

test('RC135 exposes methodology without a player quality score', () => {
  assert.match(analysisQuality,/availabilityUnits:\{home:homeUnits,away:awayUnits\}/);
  assert.match(analysisQuality,/seasonRoleCoverage:/);
  assert.match(analysisQuality,/Это не рейтинг качества игрока/);
  assert.doesNotMatch(analysisQuality,/playerImpactScore|playerQualityScore/);
  assert.match(app,/x\.seasonRole\?\.matched \? x\.seasonRole\.label : ''/);
});

test('RC135 updates model-input and health identity', () => {
  assert.match(analysis,/analysisVersion:'4\.17\.0-starting-xi'/);
  assert.match(worker,/const APP_VERSION = '6\.120\.0-rc144'/);
  assert.match(worker,/const RC_NAME = 'RC144'/);
  assert.match(runtime,/const CLIENT_VERSION = '6\.120\.0-rc144'/);
});



test('RC135 unique id-less names can match a cached season player without an external lookup',()=>{
  const absent=baseAbsence(0,'José Álvarez');
  const enriched=enrichFixtureAbsencesWithSeasonRole(absent,{
    homePlayerStats:{
      available:true,
      sourceMeta:{provider:'api-football'},
      players:[{id:123,name:'Jose Alvarez',games:{appearances:12,lineups:10,minutes:920},goals:{total:3,assists:2}}],
    },
  });
  assert.equal(enriched.home[0].seasonRole?.matched,true);
  assert.equal(enriched.summary.seasonRole.home.matched,1);
});

test('RC135 role weight stays finite and bounded even for extreme but valid season counts',()=>{
  const enriched=enrichFixtureAbsencesWithSeasonRole(baseAbsence(),{
    homePlayerStats:{
      available:true,
      players:[{id:10,name:'Key Player',
        games:{appearances:1000000,lineups:1000000,minutes:90000000},
        goals:{total:1000000,assists:1000000},
      }],
    },
  });
  const weight=enriched.home[0].seasonRole?.weight;
  assert.equal(Number.isFinite(weight),true);
  assert.ok(weight>=0.85 && weight<=1.60);
});

test('RC135 enrichment does not change cached source player statistics or original absences',()=>{
  const absences=baseAbsence();
  const cached={available:true,players:[
    {id:10,name:'Key Player',games:{appearances:10,lineups:8,minutes:700},goals:{total:2,assists:1}},
  ]};
  const originalAbsences=JSON.stringify(absences);
  const originalStats=JSON.stringify(cached);
  const output=enrichFixtureAbsencesWithSeasonRole(absences,{homePlayerStats:cached});
  assert.equal(JSON.stringify(absences),originalAbsences);
  assert.equal(JSON.stringify(cached),originalStats);
  assert.equal(output.home[0].seasonRole?.matched,true);
  assert.equal(absences.home[0].seasonRole,undefined);
});

test('RC135 unavailable cached statistics never fabricate a season-role match',()=>{
  const output=enrichFixtureAbsencesWithSeasonRole(baseAbsence(),{
    homePlayerStats:{available:false,players:[]},
  });
  assert.equal(output.home[0].seasonRole,undefined);
  assert.equal(output.summary.seasonRole.home.matched,0);
  assert.equal(output.summary.seasonRole.home.total,1);
  assert.equal(output.summary.seasonRole.away.total,0);
  assert.equal(output.summary.seasonRole.home.complete,false);
});
