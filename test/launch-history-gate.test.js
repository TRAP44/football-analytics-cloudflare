import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Глубокая ссылка action=analysis: если история не загрузилась, новый анализ
// не запускается (он мог бы потратить лимит) — открывается штаб матча.
const app = fs.readFileSync('public/app.js', 'utf8');
const start = app.indexOf('async function openLaunchFixture(');
const end = app.indexOf('\nfunction applyLaunchIntent', start);
assert.ok(start >= 0 && end > start);
const source = app.slice(start, end);

function harness({ historyLoadError = '', historyRow = null } = {}) {
  const calls = [];
  const state = { historyLoadError: '' };
  const deps = {
    state,
    canonicalLaunchFixtureId: value => Number(value) || null,
    openMatchCenter: id => calls.push(['center', id]),
    analyzeMatch: id => calls.push(['analyze', id]),
    openHistoryAnalysis: id => calls.push(['history', id]),
    analysisHistoryForFixture: () => historyRow,
    loadHistory: async () => { state.historyLoadError = historyLoadError; },
    loadFavorites: async () => {},
    loadReminders: async () => {},
    toast: message => calls.push(['toast', message]),
  };
  const openLaunchFixture = new Function(...Object.keys(deps), `${source}\nreturn openLaunchFixture;`)(...Object.values(deps));
  return { openLaunchFixture, calls };
}

test('history failure opens the match center instead of spending an analysis', async () => {
  const { openLaunchFixture, calls } = harness({ historyLoadError: 'История анализов временно недоступна.' });
  await openLaunchFixture(77, 'analysis');
  assert.deepEqual(calls.map(call => call[0]), ['toast', 'center']);
  assert.equal(calls[1][1], 77);
});

test('loaded history without the fixture still starts a new analysis', async () => {
  const { openLaunchFixture, calls } = harness();
  await openLaunchFixture(77, 'analysis');
  assert.deepEqual(calls, [['analyze', 77]]);
});

test('fixture already in history opens the saved analysis', async () => {
  const { openLaunchFixture, calls } = harness({ historyRow: { fixtureId: 77 } });
  await openLaunchFixture(77, 'analysis');
  assert.deepEqual(calls, [['history', 77]]);
});
