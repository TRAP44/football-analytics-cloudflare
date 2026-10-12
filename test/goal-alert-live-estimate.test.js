import test from 'node:test';
import assert from 'node:assert/strict';
import { inPlayEstimateLine } from '../src/smart-notification-service.js';

const row = { home_name: 'Спартак', away_name: 'Зенит' };
const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const estimate = { home: 76.6, draw: 17.3, away: 6.1, minute: 61, capturedAt: '2026-10-12T17:57:00.000Z', score: { home: 1, away: 0 } };
const goal = { type: 'Goal', detail: 'Normal Goal' };

test('a fresh estimate that already counts the goal is added to the alert', () => {
  assert.equal(
    inPlayEstimateLine(row, estimate, [goal], NOW),
    '📊 Оценка модели сейчас (1:0, 61′): Спартак 77% · Ничья 17% · Зенит 6%',
  );
});

test('no line when the estimate is stale, before the goal or broken', () => {
  assert.equal(inPlayEstimateLine(row, estimate, [goal, goal], NOW), '', 'estimate still at 1:0 after a second goal');
  assert.equal(inPlayEstimateLine(row, { ...estimate, capturedAt: '2026-10-12T17:40:00.000Z' }, [goal], NOW), '', 'older than 10 minutes');
  assert.equal(inPlayEstimateLine(row, { ...estimate, home: 90 }, [goal], NOW), '', 'sum is not 100');
  assert.equal(inPlayEstimateLine(row, { ...estimate, score: null }, [goal], NOW), '');
  assert.equal(inPlayEstimateLine(row, null, [goal], NOW), '');
  // Незабитый пенальти — не гол.
  assert.equal(inPlayEstimateLine(row, { ...estimate, score: { home: 0, away: 0 } }, [{ type: 'Goal', detail: 'Missed Penalty' }], NOW).startsWith('📊'), true);
});

test('a red-card alert needs an estimate that already counts the dismissal for the same team', () => {
  const red = { type: 'Card', detail: 'Red Card', teamId: 20 };
  const teams = { home: 10, away: 20 };
  const before = { ...estimate, teams, reds: { home: 0, away: 0, source: 'events' } };
  const after = { ...estimate, teams, reds: { home: 0, away: 1, source: 'events' } };
  const wrongSide = { ...estimate, teams, reds: { home: 1, away: 0, source: 'events' } };
  assert.equal(inPlayEstimateLine(row, before, [goal, red], NOW), '', 'estimate made before the red card');
  assert.equal(inPlayEstimateLine(row, { ...after, reds: null }, [goal, red], NOW), '', 'reds unknown');
  assert.equal(inPlayEstimateLine(row, after, [goal, red], NOW).startsWith('📊'), true);
  assert.equal(inPlayEstimateLine(row, wrongSide, [goal, red], NOW), '', 'dismissal applied to the other side');
  assert.equal(inPlayEstimateLine(row, { ...after, teams: null }, [goal, red], NOW), '', 'team ids unknown');
  assert.equal(inPlayEstimateLine(row, after, [goal, { ...red, teamId: 99 }], NOW), '', 'card of an unknown team');
  assert.equal(inPlayEstimateLine(row, after, [goal], NOW), '', 'estimate counts a red card the alert does not see');
  assert.equal(inPlayEstimateLine(row, { ...estimate, reds: { home: 'x', away: 0 } }, [goal], NOW), '');
});

test('the alert asks for the estimate once per fixture and only when there is a goal or red card', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync('src/smart-notification-service.js', 'utf8');
  assert.match(source, /snapshotEvents\.some\(event => matchEventType\(event\)\)/);
  assert.match(source, /text: matchEventMessage\(row, event, basicType, inPlayEstimateLine\(row, estimate, snapshotEvents\)\)/);
  const wiring = fs.readFileSync('src/service-wiring-runtime.js', 'utf8');
  assert.match(wiring, /loadLatestInPlayEstimate: getLatestInPlayEstimate/);
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.match(worker, /reds: row\.provenance && typeof row\.provenance === 'object' \? row\.provenance\.reds : null/);
  assert.match(worker, /teams: row\.provenance && typeof row\.provenance === 'object' \? row\.provenance\.teams : null/);
});
