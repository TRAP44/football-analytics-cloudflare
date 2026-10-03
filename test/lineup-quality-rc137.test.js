import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessLineupQuality, assessMatchLineups } from '../src/lineup-quality.js';

function player(id, name, grid = '') {
  return { id, name, grid };
}

test('RC137 confirms only an exact unique starting XI', () => {
  const full = assessLineupQuality({
    formation: '4-3-3',
    coach: 'Coach',
    startXI: Array.from({ length: 11 }, (_, i) => player(i + 1, `Player ${i + 1}`, `${Math.floor(i / 4) + 1}:${(i % 4) + 1}`)),
    substitutes: [player(20, 'Bench')],
  });
  assert.equal(full.confirmed, true);
  assert.equal(full.state, 'confirmed');
  assert.equal(full.uniqueStartCount, 11);
  assert.equal(full.startCount, 11);
});

test('RC137 keeps incomplete or duplicated XI fail-safe', () => {
  const partial = assessLineupQuality({
    startXI: Array.from({ length: 10 }, (_, i) => player(i + 1, `Player ${i + 1}`)),
  });
  assert.equal(partial.confirmed, false);
  assert.equal(partial.state, 'partial');

  const duplicated = assessLineupQuality({
    startXI: [
      ...Array.from({ length: 10 }, (_, i) => player(i + 1, `Player ${i + 1}`)),
      player(10, 'Player 10'),
    ],
  });
  assert.equal(duplicated.confirmed, false);
  assert.equal(duplicated.duplicateStartCount, 1);
  assert.match(duplicated.warnings.join(' '), /дубли/);
});

test('RC137 match summary requires both teams to pass the same guard', () => {
  const full = { startXI: Array.from({ length: 11 }, (_, i) => player(i + 1, `H ${i + 1}`)) };
  const partial = { startXI: Array.from({ length: 10 }, (_, i) => player(100 + i, `A ${i + 1}`)) };
  const quality = assessMatchLineups({ home: full, away: partial });
  assert.equal(quality.home.confirmed, true);
  assert.equal(quality.away.confirmed, false);
  assert.equal(quality.bothConfirmed, false);
  assert.equal(quality.partialSides, 1);
});

const worker = fs.readFileSync('src/worker.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const runtime = fs.readFileSync('public/modules/app-runtime.js', 'utf8');
const smoke = fs.readFileSync('scripts/post-deploy-smoke.js', 'utf8');

test('RC137 uses lineup quality in Match Center and AI quality gate', () => {
  assert.match(worker, /lineup\.quality = assessLineupQuality\(lineup\)/);
  assert.match(worker, /const lineupQuality=assessMatchLineups\(lineups\)/);
  assert.match(worker, /homeConfirmed=Boolean\(lineupQuality\.home\.confirmed\)/);
  assert.match(worker, /awayConfirmed=Boolean\(lineupQuality\.away\.confirmed\)/);
  assert.match(worker, /lineupQuality,/);
  assert.match(worker, /lineupQualityGuard: 'enabled'/);
  assert.match(worker, /analysisVersion: '4\.15\.0-availability-quality'/);
  assert.match(worker, /fixture:\$\{fixtureId\}:v15-availability-quality-rc144/);
});

test('RC137 frontend and Telegram no longer treat a 10-player XI as confirmed', () => {
  assert.match(app, /function lineupQualityLabel\(lineup\)/);
  assert.match(app, /Неполный состав/);
  assert.match(app, /lineup\?\.quality\?\.confirmed === true/);
  assert.doesNotMatch(app, /Number\(d\.lineups\?\.home\?\.startXI\?\.length \|\| 0\)>=10/);
  assert.doesNotMatch(worker, /const homeConfirmed=Number\(lineups\?\.home\?\.startXI\?\.length \|\| 0\)>=10/);
});

test('RC137 is part of the release health contract', () => {
  assert.match(worker, /const APP_VERSION = '6\.120\.0-rc144'/);
  assert.match(worker, /const RC_NAME = 'RC144'/);
  assert.match(runtime, /const CLIENT_VERSION = '6\.120\.0-rc144'/);
  assert.match(smoke, /'lineupQualityGuard'/);
});

test('Issue #406 detects alias overlap across XI and substitutes', () => {
  const lineup={
    startXI:Array.from({length:11},(_,i)=>player(i+1,i===0?'José Álvarez':`Player ${i+1}`)),
    substitutes:[{name:'Jose Alvarez'}],
  };
  const quality=assessLineupQuality(lineup);
  assert.equal(quality.confirmed,false);
  assert.equal(quality.starterSubstituteOverlapCount,1);
  assert.match(quality.warnings.join(' '),/одновременно указан/i);
});

test('Issue #406 keeps same-name players distinct when both have different known IDs', () => {
  const lineup={
    startXI:[
      player(1,'Alex Silva'),
      player(2,'Alex Silva'),
      ...Array.from({length:9},(_,i)=>player(i+3,`P ${i+3}`)),
    ],
  };
  const quality=assessLineupQuality(lineup);
  assert.equal(quality.uniqueStartCount,11);
  assert.equal(quality.duplicateStartCount,0);
  assert.equal(quality.confirmed,true);
});

test('Issue #406 fails closed on malformed substitute identity and malformed grid', () => {
  const lineup={
    startXI:Array.from({length:11},(_,i)=>player(i+1,`P ${i+1}`,i===0?'bad-grid':'')),
    substitutes:[{}],
  };
  const quality=assessLineupQuality(lineup);
  assert.equal(quality.confirmed,false);
  assert.equal(quality.invalidGridCount,1);
  assert.equal(quality.invalidSubstituteIdentityCount,1);
});

test('Issue #406 fails closed when one player row carries conflicting known IDs', () => {
  const lineup={
    startXI:[
      {id:1,playerId:999,name:'Conflicted'},
      ...Array.from({length:10},(_,i)=>player(i+2,`P ${i+2}`)),
    ],
  };
  const quality=assessLineupQuality(lineup);
  assert.equal(quality.confirmed,false);
  assert.equal(quality.conflictingIdentityCount,1);
  assert.equal(quality.invalidStarterIdentityCount,1);
});
