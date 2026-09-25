import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { annotateLineupReliability, assessMatchLineups } from '../src/lineup-quality.js';

function side(count, offset = 0) {
  return { startXI: Array.from({ length: count }, (_, i) => ({ id: offset + i + 1, name: `P ${offset + i + 1}` })) };
}

test('RC138 marks a non-empty incomplete XI as semantic partial data', () => {
  const quality = assessMatchLineups({ home: side(11), away: side(10, 100) });
  const meta = annotateLineupReliability({ feature:'lineups', state:'available', available:true, usable:true, observed:true, source:'network' }, quality);
  assert.equal(meta.state, 'partial_data');
  assert.equal(meta.transportState, 'available');
  assert.equal(meta.semanticState, 'partial');
  assert.equal(meta.available, false);
  assert.equal(meta.usable, false);
  assert.equal(meta.confirmed, false);
  assert.equal(meta.partial, true);
  assert.equal(meta.reason, 'lineup_incomplete');
});

test('RC138 keeps a complete 11v11 lineup available', () => {
  const quality = assessMatchLineups({ home: side(11), away: side(11, 100) });
  const meta = annotateLineupReliability({ feature:'lineups', state:'available', available:true, usable:true, observed:true, source:'embedded' }, quality);
  assert.equal(meta.state, 'available');
  assert.equal(meta.semanticState, 'confirmed');
  assert.equal(meta.available, true);
  assert.equal(meta.confirmed, true);
  assert.equal(meta.partial, false);
});

test('RC138 preserves provider failure semantics when no lineup was published', () => {
  const quality = assessMatchLineups({});
  const meta = annotateLineupReliability({ feature:'lineups', state:'rate_limited', available:false, usable:false, observed:false, degraded:true, reason:'rate_limited' }, quality);
  assert.equal(meta.state, 'rate_limited');
  assert.equal(meta.semanticState, 'unavailable');
  assert.equal(meta.available, false);
  assert.equal(meta.degraded, true);
  assert.equal(meta.reason, 'rate_limited');
});

const worker = fs.readFileSync('src/worker.js', 'utf8');

test('RC138 applies semantic lineup quality before provider reliability and completeness', () => {
  assert.match(worker, /const lineupMeta=annotateLineupReliability\(lineupResult\.meta, lineupQuality\)/);
  assert.match(worker, /lineups: lineupMeta/);
  assert.match(worker, /lineupQuality\.bothConfirmed && 'lineups'/);
  assert.match(worker, /h2hRows\.length, lineupQuality\.bothConfirmed, web\.answer/);
  assert.match(worker, /byFeature\.lineups\?\.partial \? 75 : 80/);
  assert.match(worker, /lineupsPartial: lineupQuality\.partialSides > 0/);
});
