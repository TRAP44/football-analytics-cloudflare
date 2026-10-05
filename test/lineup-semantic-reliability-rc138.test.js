import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { annotateLineupReliability, assessMatchLineups } from '../src/lineup-quality.js';

function side(count, offset = 0) {
  return { startXI: Array.from({ length: count }, (_, i) => ({ id: offset + i + 1, name: `P ${offset + i + 1}` })) };
}

function sourceMeta(overrides = {}) {
  return {
    feature:'lineups',
    provider:'api-football',
    source:'network',
    state:'available',
    freshness:'fresh',
    available:true,
    usable:true,
    observed:true,
    ...overrides,
  };
}

test('RC138 marks a non-empty incomplete XI as semantic partial data', () => {
  const quality = assessMatchLineups({ home: side(11), away: side(10, 100) });
  const meta = annotateLineupReliability(sourceMeta(), quality);
  assert.equal(meta.state, 'partial_data');
  assert.equal(meta.transportState, 'available');
  assert.equal(meta.semanticState, 'partial');
  assert.equal(meta.available, false);
  assert.equal(meta.usable, false);
  assert.equal(meta.confirmed, false);
  assert.equal(meta.partial, true);
  assert.equal(meta.reason, 'lineup_incomplete');
});

test('RC138 keeps a complete 11v11 lineup available from a fresh attributed source', () => {
  const quality = assessMatchLineups({ home: side(11), away: side(11, 100) });
  const meta = annotateLineupReliability(sourceMeta({ source:'embedded' }), quality);
  assert.equal(meta.state, 'available');
  assert.equal(meta.semanticState, 'confirmed');
  assert.equal(meta.freshnessState, 'fresh');
  assert.equal(meta.provenanceState, 'verified');
  assert.equal(meta.available, true);
  assert.equal(meta.confirmed, true);
  assert.equal(meta.partial, false);
  assert.equal(quality.bothConfirmed, true);
});

test('RC138 preserves provider failure semantics when no lineup was published', () => {
  const quality = assessMatchLineups({});
  const meta = annotateLineupReliability(sourceMeta({
    state:'rate_limited',
    available:false,
    usable:false,
    observed:false,
    degraded:true,
    reason:'rate_limited',
  }), quality);
  assert.equal(meta.state, 'rate_limited');
  assert.equal(meta.semanticState, 'unavailable');
  assert.equal(meta.available, false);
  assert.equal(meta.degraded, true);
  assert.equal(meta.reason, 'rate_limited');
});

test('RC138 hardening rejects stale 11v11 data as a confidence-bearing signal', () => {
  const quality = assessMatchLineups({ home: side(11), away: side(11, 100) });
  const meta = annotateLineupReliability(sourceMeta({
    state:'stale',
    source:'stale-cache',
    freshness:'stale',
  }), quality);
  assert.equal(meta.state, 'stale_data');
  assert.equal(meta.semanticState, 'confirmed');
  assert.equal(meta.freshnessState, 'stale');
  assert.equal(meta.available, false);
  assert.equal(meta.usable, false);
  assert.equal(meta.confirmed, false);
  assert.equal(meta.structurallyConfirmed, true);
  assert.equal(meta.reason, 'lineup_stale');
  assert.equal(quality.structuralBothConfirmed, true);
  assert.equal(quality.bothConfirmed, false);
  assert.equal(quality.home.confirmed, false);
  assert.equal(quality.away.confirmed, false);
});

test('RC138 honors explicit stale boolean and rejects truthy string transport flags', () => {
  const staleQuality=assessMatchLineups({home:side(11),away:side(11,100)});
  const staleMeta=annotateLineupReliability(sourceMeta({
    stale:true,
    state:'available',
    freshness:'fresh',
  }),staleQuality);
  assert.equal(staleMeta.state,'stale_data');
  assert.equal(staleMeta.confirmed,false);
  assert.equal(staleQuality.bothConfirmed,false);

  const stringQuality=assessMatchLineups({home:side(11),away:side(11,100)});
  const stringMeta=annotateLineupReliability(sourceMeta({
    available:'false',
    usable:'false',
    observed:'false',
  }),stringQuality);
  assert.equal(stringMeta.confirmed,true);
  assert.equal(stringMeta.available,false);
  assert.equal(stringMeta.usable,false);
  assert.equal(stringMeta.confidenceBearing,false);
});

test('RC138 reliability downgrade can be safely re-evaluated with fresh trusted metadata', () => {
  const quality=assessMatchLineups({home:side(11),away:side(11,100)});
  const stale=annotateLineupReliability(sourceMeta({
    stale:true,
    source:'stale-cache',
    freshness:'stale',
  }),quality);
  assert.equal(stale.confirmed,false);
  assert.equal(quality.bothConfirmed,false);
  assert.equal(quality.structuralBothConfirmed,true);

  const fresh=annotateLineupReliability(sourceMeta(),quality);
  assert.equal(fresh.confirmed,true);
  assert.equal(fresh.confidenceBearing,true);
  assert.equal(quality.bothConfirmed,true);
  assert.equal(quality.home.confirmed,true);
  assert.equal(quality.away.confirmed,true);
});

test('RC138 hardening rejects complete XI without provider provenance', () => {
  const quality = assessMatchLineups({ home: side(11), away: side(11, 100) });
  const meta = annotateLineupReliability(sourceMeta({ provider:'unknown' }), quality);
  assert.equal(meta.state, 'unverified_source');
  assert.equal(meta.provenanceState, 'unknown');
  assert.equal(meta.available, false);
  assert.equal(meta.confirmed, false);
  assert.equal(meta.reason, 'lineup_provenance_missing');
  assert.equal(quality.bothConfirmed, false);
});

test('RC138 hardening accepts non-stale cached XI when provenance is preserved', () => {
  const quality = assessMatchLineups({ home: side(11), away: side(11, 100) });
  const meta = annotateLineupReliability(sourceMeta({
    source:'cache',
    freshness:'cached',
  }), quality);
  assert.equal(meta.freshnessState, 'cached');
  assert.equal(meta.provenanceState, 'verified');
  assert.equal(meta.available, true);
  assert.equal(meta.confirmed, true);
  assert.equal(quality.bothConfirmed, true);
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
