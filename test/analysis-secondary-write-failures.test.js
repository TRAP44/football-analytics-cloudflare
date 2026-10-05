import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');

test('odds snapshot persistence failure is reported through critical write ops', () => {
  assert.match(
    worker,
    /saveOddsSnapshot\(fixtureId, analysisMarket, cfg\)\.catch\(async error => \{[\s\S]*code:'ODDS_SNAPSHOT_WRITE_FAILED'[\s\S]*recordCriticalWriteFailure/,
  );
});

test('referee history persistence failure is reported through critical write ops', () => {
  assert.match(
    worker,
    /saveRefereeMatchHistory\([\s\S]*\)\.catch\(async error => \{[\s\S]*code:'REFEREE_HISTORY_WRITE_FAILED'[\s\S]*recordCriticalWriteFailure/,
  );
});
