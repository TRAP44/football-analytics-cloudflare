import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFixtureAbsences } from '../src/availability.js';

test('RC134 classifies suspension even when provider type is generic', () => {
  const data = normalizeFixtureAbsences([
    {
      team: { id: 1 },
      player: { id: 10, name: 'A Player', type: 'Missing Fixture', reason: 'Suspended 3 matches' },
    },
  ], { homeId: 1, awayId: 2 });

  assert.equal(data.home.length, 1);
  assert.equal(data.home[0].category, 'suspension');
  assert.equal(data.home[0].status, 'reported_out');
  assert.equal(data.summary.home.suspension, 1);
});

test('RC134 distinguishes injuries, illness and doubtful wording', () => {
  const data = normalizeFixtureAbsences([
    { team:{id:1}, player:{id:11,name:'Injured',type:'Injury',reason:'Hamstring strain'} },
    { team:{id:1}, player:{id:12,name:'Ill',type:'Missing Fixture',reason:'Viral illness'} },
    { team:{id:2}, player:{id:13,name:'Doubt',type:'Injury',reason:'Doubtful - late fitness test'} },
  ], { homeId:1, awayId:2 });

  assert.equal(data.home[0].category, 'injury');
  assert.equal(data.home[1].category, 'illness');
  assert.equal(data.away[0].status, 'doubtful');
  assert.equal(data.summary.away.doubtful, 1);
});

test('RC134 deduplicates repeated provider rows for one player', () => {
  const data = normalizeFixtureAbsences([
    { team:{id:1}, player:{id:20,name:'Same Player',type:'Injury',reason:'Knee injury'} },
    { team:{id:1}, player:{id:20,name:'Same Player',type:'Missing Fixture',reason:'Knee injury'} },
  ], { homeId:1, awayId:2 });

  assert.equal(data.home.length, 1);
  assert.equal(data.home[0].duplicateCount, 2);
  assert.equal(data.summary.home.total, 1);
});

test('RC134 removes stale absence when exact player appears in published lineup', () => {
  const data = normalizeFixtureAbsences([
    { team:{id:1}, player:{id:30,name:'Recovered Player',type:'Injury',reason:'Ankle injury'} },
    { team:{id:1}, player:{id:31,name:'Still Out',type:'Suspension',reason:'Suspended'} },
  ], {
    homeId:1,
    awayId:2,
    lineups:{
      home:{
        startXI:[{id:30,name:'Recovered Player'}],
        substitutes:[],
      },
      away:null,
    },
  });

  assert.deepEqual(data.home.map(x=>x.name), ['Still Out']);
  assert.equal(data.resolvedByLineup.home.length, 1);
  assert.equal(data.resolvedByLineup.home[0].reconciliationReason, 'listed_in_published_lineup');
  assert.equal(data.summary.resolvedByLineup, 1);
});

test('RC134 can reconcile by normalized player name when provider id is absent', () => {
  const data = normalizeFixtureAbsences([
    { team:{id:2}, player:{name:'José Álvarez',type:'Injury',reason:'Muscle injury'} },
  ], {
    homeId:1,
    awayId:2,
    lineups:{
      away:{
        startXI:[],
        substitutes:[{id:99,name:'Jose Alvarez'}],
      },
    },
  });

  assert.equal(data.away.length, 0);
  assert.equal(data.resolvedByLineup.away.length, 1);
});
