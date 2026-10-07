import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createCompetitionIntegrityRuntime } from '../src/competition-integrity-runtime.js';

function deps(overrides={}) {
  return {
    APP_VERSION:'test',
    bumpTelemetry:()=>{},
    hasSupabase:()=>false,
    isFinishedStatus:status=>['FT','AET','PEN'].includes(String(status || '').toUpperCase()),
    isLiveStatus:status=>['1H','HT','2H','ET','LIVE'].includes(String(status || '').toUpperCase()),
    json:(body,status=200,headers={})=>({body,status,headers}),
    memory:{},
    recordOpsEvent:async()=>{},
    safeOpsMetadata:value=>value,
    supaSelectMany:async()=>[],
    supaUpsert:async()=>true,
    ...overrides,
  };
}

function fixture(id=1,{
  homeId=10,
  awayId=11,
  homeName='Home',
  awayName='Away',
  status='NS',
  elapsed=null,
  home=0,
  away=0,
  date='2026-10-06T18:00:00.000Z',
  leagueId=39,
  leagueName='Premier League',
}={}) {
  return {
    fixture:{
      id,
      date,
      status:{short:status,elapsed},
    },
    league:{
      id:leagueId,
      name:leagueName,
      logo:'league.png',
    },
    teams:{
      home:{id:homeId,name:homeName,logo:'home.png'},
      away:{id:awayId,name:awayName,logo:'away.png'},
    },
    goals:{home,away},
    score:{
      halftime:{home:null,away:null},
      fulltime:{home:null,away:null},
      extratime:{home:null,away:null},
      penalty:{home:null,away:null},
    },
  };
}

test('competition integrity fails fast and exposes an immutable runtime surface', () => {
  const broken=deps();
  delete broken.supaUpsert;

  assert.throws(
    () => createCompetitionIntegrityRuntime(broken),
    /supaUpsert is required/,
  );

  const runtime=createCompetitionIntegrityRuntime(deps());
  assert.equal(Object.isFrozen(runtime),true);
});

test('exported catalog copies cannot mutate the runtime competition catalog', () => {
  const runtime=createCompetitionIntegrityRuntime(deps());

  assert.equal(runtime.normalizeCompetition(39,'Premier League','England').priority,100);

  runtime.COMPETITIONS.set(999999,{name:'Injected',priority:100});
  assert.notEqual(
    runtime.normalizeCompetition(999999,'Unknown','World').name,
    'Injected',
  );

  assert.throws(
    () => {
      runtime.COMPETITIONS.get(39).priority=1;
    },
    TypeError,
  );

  assert.equal(runtime.normalizeCompetition(39,'Premier League','England').priority,100);
});

test('competition normalization and interest score stay finite on malformed input', () => {
  const runtime=createCompetitionIntegrityRuntime(deps());

  const competition=runtime.normalizeCompetition(
    1.5,
    {unexpected:true},
    {unexpected:true},
    'Home',
    'Away',
  );

  assert.equal(competition.id,0);
  assert.equal(competition.name,'Турнир');
  assert.ok(Number.isFinite(competition.priority));

  const score=runtime.matchInterestScore({
    competition:{
      priority:'NaN',
      youth:false,
      friendly:false,
      lower:false,
    },
    homeName:'Home',
    awayName:'Away',
    status:'ns',
    date:'not-a-date',
  });

  assert.equal(score,45);
  assert.equal(runtime.matchInterestScore({
    competition:{priority:false,youth:false,friendly:false,lower:false},
    homeName:'Home',
    awayName:'Away',
    status:'NS',
    date:'not-a-date',
  }),45);
  assert.equal(runtime.finiteNonNegative(true),null);
  assert.equal(runtime.finiteNonNegative(false),null);
});

test('fixture integrity quarantines unsafe identities and malformed scores', () => {
  const runtime=createCompetitionIntegrityRuntime(deps());

  const fractional=runtime.validateFixtureIntegrity(
    fixture(1.5),
    '2026-10-06',
  );
  assert.equal(fractional.fixtureId,null);
  assert.equal(fractional.quarantine,true);
  assert.ok(fractional.issues.some(issue=>issue.code==='FIXTURE_ID_MISSING'));

  const fractionalTeam=runtime.validateFixtureIntegrity(
    fixture(2,{homeId:10.5}),
    '2026-10-06',
  );
  assert.equal(fractionalTeam.quarantine,true);
  assert.ok(fractionalTeam.issues.some(issue=>issue.code==='TEAM_ID_MISSING'));

  const malformedScore=runtime.validateFixtureIntegrity(
    fixture(3,{home:'abc',away:0}),
    '2026-10-06',
  );
  assert.equal(malformedScore.quarantine,true);
  assert.ok(malformedScore.issues.some(issue=>issue.code==='SCORE_INVALID'));

  const negativeScore=runtime.validateFixtureIntegrity(
    fixture(4,{home:-1,away:0}),
    '2026-10-06',
  );
  assert.equal(negativeScore.quarantine,true);
  assert.ok(negativeScore.issues.some(issue=>issue.code==='SCORE_NEGATIVE'));

  const booleanIdentity=runtime.validateFixtureIntegrity(
    fixture(true,{homeId:true,awayId:11}),
    '2026-10-06',
  );
  assert.equal(booleanIdentity.fixtureId,null);
  assert.equal(booleanIdentity.quarantine,true);
  assert.ok(booleanIdentity.issues.some(issue=>issue.code==='FIXTURE_ID_MISSING'));
  assert.ok(booleanIdentity.issues.some(issue=>issue.code==='TEAM_ID_MISSING'));

  const booleanScore=runtime.validateFixtureIntegrity(
    fixture(5,{home:true,away:0}),
    '2026-10-06',
  );
  assert.equal(booleanScore.quarantine,true);
  assert.ok(booleanScore.issues.some(issue=>issue.code==='SCORE_INVALID'));

  const impossibleKickoff=runtime.validateFixtureIntegrity(
    fixture(6,{date:'2026-02-30T18:00:00.000Z'}),
    '2026-02-28',
  );
  assert.equal(impossibleKickoff.quarantine,true);
  assert.ok(impossibleKickoff.issues.some(issue=>issue.code==='KICKOFF_INVALID'));
});

test('missing or boolean elapsed values never become synthetic match minutes', () => {
  const runtime=createCompetitionIntegrityRuntime(deps());

  const result=runtime.validateFixtureIntegrity(
    fixture(7,{status:'1H',elapsed:35,home:0,away:0}),
    '2026-10-06',
    {
      status:'1H',
      elapsed:null,
      score:{home:0,away:0},
    },
  );

  assert.equal(
    result.issues.some(issue=>issue.code==='ELAPSED_REGRESSION'),
    false,
  );

  const booleanElapsed=runtime.validateFixtureIntegrity(
    fixture(8,{status:'1H',elapsed:true,home:0,away:0}),
    '2026-10-06',
  );
  assert.ok(booleanElapsed.issues.some(issue=>issue.code==='ELAPSED_INVALID'));
});

test('invalid fixture collection fails closed instead of reporting healthy empty data', () => {
  const runtime=createCompetitionIntegrityRuntime(deps());

  const result=runtime.runMatchIntegrityGuard(
    {unexpected:true},
    '2026-10-06',
    {matches:{unexpected:true}},
  );

  assert.equal(result.report.inspected,0);
  assert.equal(result.report.qualityScore,0);
  assert.equal(result.report.health,'critical');
  assert.equal(result.report.errors,1);
  assert.equal(result.issues[0].code,'FIXTURE_COLLECTION_INVALID');
});

test('duplicate fixture ids and duplicate signatures are quarantined', () => {
  const runtime=createCompetitionIntegrityRuntime(deps());

  const duplicateId=runtime.runMatchIntegrityGuard(
    [fixture(10),fixture(10)],
    '2026-10-06',
  );
  assert.equal(duplicateId.report.duplicates,1);
  assert.equal(duplicateId.report.quarantined,1);
  assert.ok(duplicateId.issues.some(issue=>issue.code==='DUPLICATE_FIXTURE_ID'));

  const duplicateSignature=runtime.runMatchIntegrityGuard(
    [fixture(11),fixture(12)],
    '2026-10-06',
  );
  assert.equal(duplicateSignature.report.duplicates,1);
  assert.equal(duplicateSignature.report.quarantined,1);
  assert.ok(duplicateSignature.issues.some(issue=>issue.code==='DUPLICATE_MATCH_SIGNATURE'));
});

test('integrity persistence survives telemetry failure and owns run identity metadata', async () => {
  const memory={integrity:null};
  const runtime=createCompetitionIntegrityRuntime(deps({
    memory,
    bumpTelemetry:()=>{ throw new Error('telemetry down'); },
  }));

  const run=await runtime.persistIntegrityRun({},{
    requestedDate:'2026-10-06',
    inspected:2,
    accepted:1,
    clean:1,
    incomplete:0,
    warningMatches:0,
    quarantined:1,
    duplicates:1,
    repaired:0,
    warnings:0,
    errors:1,
    qualityScore:50,
    health:'critical',
  },[
    {
      fixtureId:1,
      severity:'error',
      code:'TEST',
      message:'bad data',
      run_id:'attacker-value',
      observed_at:'attacker-value',
      meta:{source:'test'},
    },
  ]);

  assert.equal(run.health,'critical');
  assert.equal(memory.integrity.lastRun.runId,run.runId);
  assert.equal(memory.integrity.recentIssues.length,1);
  assert.equal(memory.integrity.recentIssues[0].run_id,run.runId);
  assert.notEqual(memory.integrity.recentIssues[0].run_id,'attacker-value');
  assert.notEqual(memory.integrity.recentIssues[0].observed_at,'attacker-value');

  const malformedRun=await runtime.persistIntegrityRun({},{
    requestedDate:'2026-02-30',
    inspected:true,
    accepted:false,
    clean:'2',
    qualityScore:false,
    health:'not-real',
  },[]);
  assert.equal(malformedRun.requestedDate,'');
  assert.equal(malformedRun.inspected,0);
  assert.equal(malformedRun.accepted,0);
  assert.equal(malformedRun.clean,2);
  assert.equal(malformedRun.qualityScore,0);
  assert.equal(malformedRun.health,'warning');
});

test('diagnostics bound the requested limit and fail closed on malformed database collections', async () => {
  const calls=[];
  const runtime=createCompetitionIntegrityRuntime(deps({
    hasSupabase:()=>true,
    supaSelectMany:async(_cfg,table,_filters,options)=>{
      calls.push({table,options});
      return {unexpected:true};
    },
  }));

  const result=await runtime.readIntegrityDiagnostics({},999999);

  assert.equal(result.persistent,false);
  assert.equal(result.migrationReady,false);
  assert.equal(result.lastRun,null);
  assert.deepEqual(result.recentIssues,[]);
  assert.equal(calls[1].options.limit,30);
});

test('persistent diagnostics sanitize malformed stored evidence before returning it', async () => {
  const runtime=createCompetitionIntegrityRuntime(deps({
    hasSupabase:()=>true,
    safeOpsMetadata:value=>({kept:value?.kept}),
    supaSelectMany:async(_cfg,table)=>{
      if (table==='match_integrity_runs') return [{
        run_id:'run-1',
        observed_at:'not-a-date',
        fixture_date:'2026-02-30',
        inspected:true,
        accepted:'3',
        clean:2,
        incomplete:0,
        warning_matches:0,
        quarantined:0,
        duplicates:0,
        repaired:0,
        warning_count:0,
        error_count:0,
        quality_score:false,
        health:'unknown',
      }];
      return [{
        run_id:'run-1',
        observed_at:'not-a-date',
        fixture_date:'2026-02-30',
        fixture_id:true,
        severity:'critical',
        issue_code:'',
        message:{unexpected:true},
        home_name:{unexpected:true},
        away_name:'Away',
        league_name:'League',
        metadata:{kept:'ok',secret:'drop-me'},
      }];
    },
  }));

  const result=await runtime.readIntegrityDiagnostics({},12);

  assert.equal(result.persistent,true);
  assert.equal(result.migrationReady,true);
  assert.equal(result.lastRun.observedAt,'');
  assert.equal(result.lastRun.requestedDate,'');
  assert.equal(result.lastRun.inspected,0);
  assert.equal(result.lastRun.accepted,3);
  assert.equal(result.lastRun.qualityScore,0);
  assert.equal(result.lastRun.health,'warning');
  assert.deepEqual(result.recentIssues,[{
    run_id:'run-1',
    observed_at:'',
    fixture_date:null,
    fixture_id:null,
    severity:'warning',
    issue_code:'DATA_QUALITY',
    message:'',
    home_name:'',
    away_name:'Away',
    league_name:'League',
    metadata:{kept:'ok'},
  }]);
});

test('composition root keeps the integrity runtime dependencies wired', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');

  assert.match(
    worker,
    /createCompetitionIntegrityRuntime\(\{[\s\S]*?APP_VERSION[\s\S]*?bumpTelemetry[\s\S]*?hasSupabase[\s\S]*?isFinishedStatus[\s\S]*?isLiveStatus[\s\S]*?json[\s\S]*?memory[\s\S]*?recordOpsEvent[\s\S]*?safeOpsMetadata[\s\S]*?supaSelectMany[\s\S]*?supaUpsert[\s\S]*?\}\);/,
  );
});
