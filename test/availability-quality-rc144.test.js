import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateAvailabilityReliability,
  assessFixtureAvailabilityQuality,
  sanitizeAvailabilityRows,
} from '../src/availability.js';

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
    homeId:1, awayId:2, injuriesMeta:trustedMeta, mode:'upcoming',
  });

  assert.equal(quality.state, 'verified');
  assert.equal(quality.acceptedCount, 2);
  assert.equal(quality.rejectedCount, 0);
  assert.equal(quality.confidenceBearing, true);
  assert.equal(sanitizeAvailabilityRows(rows, quality).length, 2);
});

test('RC144 removes rows with unknown team or missing player identity', () => {
  const rows = [
    { team:{id:999}, player:{id:10,name:'Wrong Team',type:'Injury'} },
    { team:{id:1}, player:{name:'',type:'Injury'} },
    { team:{id:1}, player:{id:11,name:'Valid Player',type:'Injury'} },
  ];
  const quality = assessFixtureAvailabilityQuality(rows, {
    homeId:1, awayId:2, injuriesMeta:trustedMeta,
  });

  assert.equal(quality.state, 'sanitized');
  assert.equal(quality.acceptedCount, 1);
  assert.equal(quality.rejectedCount, 2);
  assert.ok(quality.issues.some(issue => issue.code === 'team_mismatch'));
  assert.ok(quality.issues.some(issue => issue.code === 'player_identity_missing'));
  assert.deepEqual(sanitizeAvailabilityRows(rows, quality).map(row => row.player.id), [11]);
});

test('RC144 fail-closes one player reported for both teams', () => {
  const rows = [
    { team:{id:1}, player:{id:77,name:'Conflict Player',type:'Injury'} },
    { team:{id:2}, player:{id:77,name:'Conflict Player',type:'Missing Fixture'} },
  ];
  const quality = assessFixtureAvailabilityQuality(rows, {
    homeId:1, awayId:2, injuriesMeta:trustedMeta,
  });

  assert.equal(quality.state, 'invalid');
  assert.equal(quality.acceptedCount, 0);
  assert.equal(quality.rejectedCount, 2);
  assert.equal(quality.crossTeamConflictCount, 1);
  assert.ok(quality.issues.some(issue => issue.code === 'cross_team_player_conflict'));
  assert.deepEqual(sanitizeAvailabilityRows(rows, quality), []);
});

test('RC144 excludes stale or unverified injury feeds from analytics', () => {
  const rows = [{ team:{id:1}, player:{id:10,name:'Home Player',type:'Injury'} }];
  const staleMeta = {
    ...trustedMeta,
    stale:true,
    confidenceBearing:false,
    freshnessState:'stale',
  };
  const quality = assessFixtureAvailabilityQuality(rows, {
    homeId:1, awayId:2, injuriesMeta:staleMeta,
  });
  const annotated = annotateAvailabilityReliability(staleMeta, quality);

  assert.equal(quality.state, 'source_untrusted');
  assert.equal(quality.confidenceBearing, false);
  assert.deepEqual(sanitizeAvailabilityRows(rows, quality), []);
  assert.equal(annotated.available, false);
  assert.equal(annotated.usable, false);
  assert.equal(annotated.confidenceBearing, false);
});

const worker = fs.readFileSync('src/worker.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const smoke = fs.readFileSync('scripts/post-deploy-smoke.js', 'utf8');

test('RC144 gates Match Center and prematch availability before absence analytics', () => {
  assert.match(worker, /assessFixtureAvailabilityQuality\(injuryRows,/);
  assert.match(worker, /const trustedInjuryRows = sanitizeAvailabilityRows\(injuryRows, availabilityQuality\)/);
  assert.match(worker, /assessFixtureAvailabilityQuality\(injuries,/);
  assert.match(worker, /const trustedInjuries = sanitizeAvailabilityRows\(injuries, availabilityQuality\)/);
  assert.match(worker, /const baseAbsences = formatAbsences\(trustedInjuries, homeId, awayId, lineups\)/);
  assert.match(worker, /availabilityQuality,/);
});

test('RC144 exposes availability quality through UI and release contracts', () => {
  assert.match(worker, /match-center:\$\{fixtureId\}:v16-availability-quality-rc144/);
  assert.match(worker, /fixture:\$\{fixtureId\}:v15-availability-quality-rc144/);
  assert.match(worker, /analysisVersion: '4\.15\.0-availability-quality'/);
  assert.match(worker, /availabilitySemanticQualityGuard: 'enabled'/);
  assert.match(app, /function availabilityQualityHintHtml/);
  assert.match(app, /availabilityQualityHintHtml\(d\.availabilityQuality\)/);
  assert.match(smoke, /'availabilitySemanticQualityGuard'/);
});

test('Issue #406 resolves mixed ID/name aliases without double-counting one absence', async () => {
  const { normalizeFixtureAbsences } = await import('../src/availability.js');
  const data=normalizeFixtureAbsences([
    {team:{id:1},player:{id:44,name:'José Álvarez',type:'Injury'}},
    {team:{id:1},player:{name:'Jose Alvarez',type:'Missing Fixture'}},
  ],{homeId:1,awayId:2});
  assert.equal(data.home.length,1);
  assert.equal(data.home[0].id,44);
  assert.equal(data.home[0].duplicateCount,2);
});

test('Issue #406 does not reconcile same-name players when both known IDs conflict', async () => {
  const { normalizeFixtureAbsences } = await import('../src/availability.js');
  const data=normalizeFixtureAbsences([
    {team:{id:1},player:{id:10,name:'Alex Silva',type:'Injury'}},
  ],{
    homeId:1,awayId:2,
    lineups:{home:{startXI:[{id:20,name:'Alex Silva'}],substitutes:[]}},
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
  const quality=assessFixtureAvailabilityQuality(rows,{homeId:1,awayId:2,injuriesMeta:trustedMeta});
  assert.equal(quality.acceptedCount,2);
  assert.equal(quality.rejectedCount,1);
  assert.equal(quality.ambiguousIdentityCount,1);
  assert.ok(quality.issues.some(issue=>issue.code==='player_identity_ambiguous'));
});
