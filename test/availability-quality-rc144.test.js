import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  annotateAvailabilityReliability,
  assessFixtureAvailabilityQuality,
  enrichFixtureAbsencesWithSeasonRole,
  normalizeFixtureAbsences,
  sanitizeAvailabilityRows,
} from '../src/availability.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

const trustedMeta = {
  provider:'api-football',
  source:'network',
  state:'available',
  available:true,
  usable:true,
  observed:true,
  stale:false,
  confidenceBearing:true,
  freshnessState:'fresh',
  provenanceState:'verified',
};

test('RC144 accepts trusted fixture absences for either match side', () => {
  const rows = [
    { team:{id:1}, player:{id:10,name:'Home Player',type:'Injury',reason:'Hamstring strain'} },
    { team:{id:2}, player:{id:20,name:'Away Player',type:'Missing Fixture',reason:'Suspended'} },
  ];
  const quality = assessFixtureAvailabilityQuality(rows, {
    homeId:1,
    awayId:2,
    injuriesMeta:trustedMeta,
    mode:'upcoming',
  });

  assert.equal(quality.state,'verified');
  assert.equal(quality.acceptedCount,2);
  assert.equal(quality.rejectedCount,0);
  assert.equal(quality.confidenceBearing,true);
  assert.deepEqual(quality.acceptedIndices,[0,1]);
  assert.equal(sanitizeAvailabilityRows(rows,quality).length,2);
});

test('RC144 fails closed when fixture team ids are missing, equal, fractional or malformed', () => {
  const rows = [
    { team:{id:1}, player:{id:10,name:'Player',type:'Injury'} },
  ];

  for (const fixture of [
    {homeId:0,awayId:2},
    {homeId:-1,awayId:2},
    {homeId:1.5,awayId:2},
    {homeId:1,awayId:1},
    {homeId:'bad',awayId:2},
  ]) {
    const quality=assessFixtureAvailabilityQuality(rows,{
      ...fixture,
      injuriesMeta:trustedMeta,
    });
    assert.equal(quality.acceptedCount,0,JSON.stringify(fixture));
    assert.equal(quality.confidenceBearing,false,JSON.stringify(fixture));
    assert.ok(
      quality.issues.every(issue=>issue.code==='invalid_fixture_teams'),
      JSON.stringify(fixture),
    );
    assert.deepEqual(sanitizeAvailabilityRows(rows,quality),[]);
  }
});

test('RC144 normalization never assigns team-less or foreign-team rows to a fixture side', () => {
  const data=normalizeFixtureAbsences([
    {team:{},player:{id:10,name:'No Team',type:'Injury'}},
    {team:{id:999},player:{id:11,name:'Foreign Team',type:'Injury'}},
    {team:{id:1},player:{id:12,name:'Home Player',type:'Injury'}},
  ],{
    homeId:1,
    awayId:2,
  });

  assert.deepEqual(data.home.map(row=>row.id),[12]);
  assert.deepEqual(data.away,[]);
});

test('RC144 removes rows with unknown team or missing player identity', () => {
  const rows = [
    { team:{id:999}, player:{id:10,name:'Wrong Team',type:'Injury'} },
    { team:{id:1}, player:{name:'',type:'Injury'} },
    { team:{id:1}, player:{id:11,name:'Valid Player',type:'Injury'} },
  ];
  const quality = assessFixtureAvailabilityQuality(rows, {
    homeId:1,
    awayId:2,
    injuriesMeta:trustedMeta,
  });

  assert.equal(quality.state,'sanitized');
  assert.equal(quality.acceptedCount,1);
  assert.equal(quality.rejectedCount,2);
  assert.ok(quality.issues.some(issue=>issue.code==='team_mismatch'));
  assert.ok(quality.issues.some(issue=>issue.code==='player_identity_missing'));
  assert.deepEqual(
    sanitizeAvailabilityRows(rows,quality).map(row=>row.player.id),
    [11],
  );
});

test('RC144 fail-closes one player reported for both teams', () => {
  const rows = [
    { team:{id:1}, player:{id:77,name:'Conflict Player',type:'Injury'} },
    { team:{id:2}, player:{id:77,name:'Conflict Player',type:'Missing Fixture'} },
  ];
  const quality = assessFixtureAvailabilityQuality(rows, {
    homeId:1,
    awayId:2,
    injuriesMeta:trustedMeta,
  });

  assert.equal(quality.state,'invalid');
  assert.equal(quality.acceptedCount,0);
  assert.equal(quality.rejectedCount,2);
  assert.equal(quality.crossTeamConflictCount,1);
  assert.ok(quality.issues.some(issue=>issue.code==='cross_team_player_conflict'));
  assert.deepEqual(sanitizeAvailabilityRows(rows,quality),[]);
});

test('RC144 excludes stale or unverified injury feeds from analytics', () => {
  const rows=[{team:{id:1},player:{id:10,name:'Home Player',type:'Injury'}}];

  for (const meta of [
    {...trustedMeta,stale:true,confidenceBearing:false,freshnessState:'stale'},
    {...trustedMeta,provenanceState:'unknown'},
    {...trustedMeta,usable:false},
    {...trustedMeta,available:false},
    {...trustedMeta,confidenceBearing:false},
  ]) {
    const quality=assessFixtureAvailabilityQuality(rows,{
      homeId:1,
      awayId:2,
      injuriesMeta:meta,
    });
    const annotated=annotateAvailabilityReliability(meta,quality);

    assert.equal(quality.state,'source_untrusted');
    assert.equal(quality.confidenceBearing,false);
    assert.deepEqual(sanitizeAvailabilityRows(rows,quality),[]);
    assert.equal(annotated.available,false);
    assert.equal(annotated.usable,false);
    assert.equal(annotated.confidenceBearing,false);
  }
});

test('RC144 accepts verified cached provenance only when it is explicitly non-stale', () => {
  const rows=[{team:{id:1},player:{id:10,name:'Home Player',type:'Injury'}}];
  const quality=assessFixtureAvailabilityQuality(rows,{
    homeId:1,
    awayId:2,
    injuriesMeta:{
      ...trustedMeta,
      source:'cache',
      freshnessState:'cached',
      stale:false,
    },
  });

  assert.equal(quality.state,'verified');
  assert.equal(quality.sourceTrusted,true);
  assert.equal(quality.confidenceBearing,true);
});

test('RC144 annotation never makes an empty or invalid feed confidence-bearing', () => {
  const empty=assessFixtureAvailabilityQuality([],{
    homeId:1,
    awayId:2,
    injuriesMeta:trustedMeta,
  });
  const annotatedEmpty=annotateAvailabilityReliability(trustedMeta,empty);
  assert.equal(empty.observed,false);
  assert.equal(annotatedEmpty.available,false);
  assert.equal(annotatedEmpty.confidenceBearing,false);

  const invalid=assessFixtureAvailabilityQuality([
    {team:{id:999},player:{id:10,name:'Wrong',type:'Injury'}},
  ],{
    homeId:1,
    awayId:2,
    injuriesMeta:trustedMeta,
  });
  const annotatedInvalid=annotateAvailabilityReliability(trustedMeta,invalid);
  assert.equal(invalid.acceptedCount,0);
  assert.equal(annotatedInvalid.state,'invalid_data');
  assert.equal(annotatedInvalid.available,false);
  assert.equal(annotatedInvalid.confidenceBearing,false);
});

test('Issue #406 resolves mixed ID/name aliases without double-counting one absence', () => {
  const data=normalizeFixtureAbsences([
    {team:{id:1},player:{id:44,name:'José Álvarez',type:'Injury'}},
    {team:{id:1},player:{name:'Jose Alvarez',type:'Missing Fixture'}},
  ],{
    homeId:1,
    awayId:2,
  });

  assert.equal(data.home.length,1);
  assert.equal(data.home[0].id,44);
  assert.equal(data.home[0].duplicateCount,2);
});

test('Issue #406 does not reconcile same-name players when both known IDs conflict', () => {
  const data=normalizeFixtureAbsences([
    {team:{id:1},player:{id:10,name:'Alex Silva',type:'Injury'}},
  ],{
    homeId:1,
    awayId:2,
    lineups:{
      home:{
        startXI:[{id:20,name:'Alex Silva'}],
        substitutes:[],
      },
    },
  });

  assert.equal(data.home.length,1);
  assert.equal(data.home[0].id,10);
  assert.equal(data.resolvedByLineup.home.length,0);
});

test('Issue #406 rejects ambiguous name-only aliases when the same name maps to different known IDs', () => {
  const rows=[
    {team:{id:1},player:{id:10,name:'Alex Silva',type:'Injury'}},
    {team:{id:1},player:{id:20,name:'Alex Silva',type:'Injury'}},
    {team:{id:1},player:{name:'Alex Silva',type:'Injury'}},
  ];
  const quality=assessFixtureAvailabilityQuality(rows,{
    homeId:1,
    awayId:2,
    injuriesMeta:trustedMeta,
  });

  assert.equal(quality.acceptedCount,2);
  assert.equal(quality.rejectedCount,1);
  assert.equal(quality.ambiguousIdentityCount,1);
  assert.ok(quality.issues.some(issue=>issue.code==='player_identity_ambiguous'));
});

test('season-role enrichment never overrides a known absence player ID with a same-name player', () => {
  const absences={
    home:[{
      id:10,
      name:'Alex Silva',
      category:'injury',
      status:'reported_out',
    }],
    away:[],
    summary:{},
  };

  const enriched=enrichFixtureAbsencesWithSeasonRole(absences,{
    homePlayerStats:{
      complete:true,
      sourceMeta:{provider:'api-football'},
      players:[{
        id:20,
        name:'Alex Silva',
        source:'api-football',
        games:{appearances:20,lineups:18,minutes:1600,position:'F'},
        goals:{total:8,assists:4},
      }],
    },
  });

  assert.equal(enriched.home.length,1);
  assert.equal(enriched.home[0].id,10);
  assert.equal(enriched.home[0].seasonRole,undefined);
  assert.equal(enriched.summary.seasonRole.home.matched,0);
});

test('season-role enrichment may use a unique name only for an ID-less absence', () => {
  const absences={
    home:[{
      id:0,
      name:'Alex Silva',
      category:'injury',
      status:'reported_out',
    }],
    away:[],
    summary:{},
  };

  const enriched=enrichFixtureAbsencesWithSeasonRole(absences,{
    homePlayerStats:{
      complete:true,
      sourceMeta:{provider:'api-football'},
      players:[{
        id:20,
        name:'Alex Silva',
        source:'api-football',
        games:{appearances:20,lineups:18,minutes:1600,position:'F'},
        goals:{total:8,assists:4},
      }],
    },
  });

  assert.equal(enriched.home[0].seasonRole?.matched,true);
  assert.equal(enriched.home[0].seasonRole?.appearances,20);
  assert.equal(enriched.summary.seasonRole.home.matched,1);
});

test('season-role name fallback remains disabled when player-stat names are ambiguous', () => {
  const absences={
    home:[{id:0,name:'Alex Silva',category:'injury',status:'reported_out'}],
    away:[],
    summary:{},
  };

  const enriched=enrichFixtureAbsencesWithSeasonRole(absences,{
    homePlayerStats:{
      complete:true,
      sourceMeta:{provider:'api-football'},
      players:[
        {
          id:20,
          name:'Alex Silva',
          source:'api-football',
          games:{appearances:20,lineups:18,minutes:1600},
          goals:{total:8,assists:4},
        },
        {
          id:30,
          name:'Alex Silva',
          source:'api-football',
          games:{appearances:10,lineups:5,minutes:600},
          goals:{total:1,assists:1},
        },
      ],
    },
  });

  assert.equal(enriched.home[0].seasonRole,undefined);
  assert.equal(enriched.summary.seasonRole.home.matched,0);
});

test('RC144 gates prematch availability before absence analytics in analysis runtime', () => {
  const analysis=readRepoFile('src/analysis-runtime.js');

  const assessIndex=analysis.indexOf('assessFixtureAvailabilityQuality(injuries,{');
  const annotateIndex=analysis.indexOf('annotateAvailabilityReliability(',assessIndex);
  const sanitizeIndex=analysis.indexOf('sanitizeAvailabilityRows(injuries,availabilityQuality)',annotateIndex);
  const formatIndex=analysis.indexOf('formatAbsences(trustedInjuries',sanitizeIndex);

  assert.ok(assessIndex>=0,'availability assessment missing');
  assert.ok(annotateIndex>assessIndex,'reliability annotation must follow assessment');
  assert.ok(sanitizeIndex>annotateIndex,'sanitization must follow reliability annotation');
  assert.ok(formatIndex>sanitizeIndex,'absence analytics must consume only sanitized rows');
  assert.match(
    analysis,
    /const trustedLineups=featureTrusted\('lineups'\) \? lineups : \{\}/,
  );
  assert.match(analysis,/availabilityQuality,/);
});

test('RC144 gates Match Center availability before formatted absence output', () => {
  const center=readRepoFile('src/match-center-runtime.js');

  const assessIndex=center.search(/assessFixtureAvailabilityQuality\(\s*injuryRows\s*,\s*\{/);
  const sanitizeIndex=center.search(/sanitizeAvailabilityRows\(\s*injuryRows\s*,\s*availabilityQuality\s*\)/);
  const formatIndex=center.indexOf('formatAbsences(',sanitizeIndex);

  assert.ok(assessIndex>=0,'Match Center availability assessment missing');
  assert.ok(sanitizeIndex>assessIndex,'Match Center sanitization must follow assessment');
  assert.ok(formatIndex>sanitizeIndex,'Match Center formatting must consume sanitized injuries');
  assert.match(center,/lineupSourceTrusted=trustedFeature\(featureMeta\.lineups\)/);
});

test('RC144 exposes availability quality through current cache, UI and smoke contracts', () => {
  const analysis=readRepoFile('src/analysis-runtime.js');
  const center=readRepoFile('src/match-center-runtime.js');
  const app=readRepoFile('public/app.js');

  assert.match(center,/match-center:\$\{fixtureId\}:v17-event-evidence-rc144/);
  assert.match(analysis,/fixture:\$\{fixtureId\}:v17-starting-xi-rc146/);
  assert.match(analysis,/analysisVersion:'4\.17\.0-starting-xi'/);
  assert.match(analysis,/availabilityQuality,/);
  assert.match(
    analysis,
    /trustedInjuries\.length(?:>0)?\s*&&\s*featureTrusted\('injuries'\)/,
  );
  assert.match(app,/function availabilityQualityHintHtml\(quality = \{\}\)/);
  assert.match(app,/availabilityQualityHintHtml\(d\.availabilityQuality\)/);
});
