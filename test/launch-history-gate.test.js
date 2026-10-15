import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Глубокая ссылка action=analysis: если история не подтверждена этим запросом,
// новый анализ не запускается (он мог бы потратить лимит) — открывается штаб матча.
const app = fs.readFileSync('public/app.js', 'utf8');
function block(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, startMarker);
  return app.slice(start, end);
}
const launchSource = block('async function openLaunchFixture(', '\nfunction applyLaunchIntent');
const loadSource = block('let historyLoadInFlight = null;', '\nasync function openHistoryAnalysis');

function harness({ historyResult = true, historyRow = null } = {}) {
  const calls = [];
  const deps = {
    state: {},
    canonicalLaunchFixtureId: value => Number(value) || null,
    openMatchCenter: id => calls.push(['center', id]),
    analyzeMatch: id => calls.push(['analyze', id]),
    openHistoryAnalysis: id => calls.push(['history', id]),
    analysisHistoryForFixture: () => historyRow,
    loadHistory: async () => historyResult,
    loadFavorites: async () => {},
    loadReminders: async () => {},
    toast: message => calls.push(['toast', message]),
  };
  const openLaunchFixture = new Function(...Object.keys(deps), `${launchSource}\nreturn openLaunchFixture;`)(...Object.values(deps));
  return { openLaunchFixture, calls };
}

test('unverified history opens the match center instead of spending an analysis', async () => {
  for (const historyResult of [false, null]) {
    const { openLaunchFixture, calls } = harness({ historyResult });
    await openLaunchFixture(77, 'analysis');
    assert.deepEqual(calls.map(call => call[0]), ['toast', 'center']);
    assert.equal(calls[1][1], 77);
  }
});

test('verified history without the fixture still starts a new analysis', async () => {
  const { openLaunchFixture, calls } = harness({ historyResult: true });
  await openLaunchFixture(77, 'analysis');
  assert.deepEqual(calls, [['analyze', 77]]);
});

test('fixture already in history opens the saved analysis', async () => {
  const { openLaunchFixture, calls } = harness({ historyResult: false, historyRow: { fixtureId: 77 } });
  await openLaunchFixture(77, 'analysis');
  assert.deepEqual(calls, [['history', 77]]);
});

function realLoadHistory(apiImpl) {
  const state = { historyLoading: false, historyRevision: 0, historyLoadError: '', historyLoaded: false, history: [] };
  const deps = {
    state,
    api: apiImpl,
    collectionItems: data => data?.items || [],
    renderHistory: () => {},
    renderMatches: () => {},
    rerenderOpenMatchCenter: () => {},
    uiErrorMessage: (_error, fallback) => fallback,
    sendActionError: () => {},
  };
  const loadHistory = new Function(...Object.keys(deps), `${loadSource}\nreturn loadHistory;`)(...Object.values(deps));
  return { loadHistory, state };
}

test('loadHistory reports its own outcome, shares an in-flight request and survives revision races', async () => {
  const ok = realLoadHistory(async () => ({ items: [{ fixtureId: 1 }] }));
  assert.equal(await ok.loadHistory(false), true);

  const failing = realLoadHistory(async () => { throw Object.assign(new Error('503'), { status: 503 }); });
  assert.equal(await failing.loadHistory(false), false);

  let release;
  const slow = realLoadHistory(() => new Promise((_resolve, reject) => { release = () => reject(new Error('down')); }));
  const first = slow.loadHistory(false);
  const second = slow.loadHistory(false);
  slow.state.historyRevision += 1; // пользователь успел завершить другой анализ
  release();
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(slow.state.historyLoadError, '', 'the shared error field stays empty in this race — the gate must not rely on it');
});

test('history-unavailable recheck explains itself and hides the recheck button', () => {
  const source = block('function analysisFreshnessHtml(', '\nfunction ');
  const render = new Function('escapeHtml', 'publicText', `${source}\nreturn analysisFreshnessHtml;`)(value => String(value ?? ''), value => String(value ?? ''));
  const freshness = { label: 'Анализ устарел', state: 'recheck', needsRecheck: true, ageMinutes: 240 };
  const blocked = render(freshness, { requested: true, performed: false, reasonCode: 'history_unavailable' });
  assert.match(blocked, /Обновление временно недоступно/);
  assert.match(blocked, /лимит не списан/);
  assert.doesNotMatch(blocked, /analysisRecheckBtn/);
  const normal = render(freshness, {});
  assert.match(normal, /analysisRecheckBtn/);
  assert.doesNotMatch(normal, /временно недоступна/);

  const controller = fs.readFileSync('public/modules/analysis-controller.js', 'utf8');
  assert.match(controller, /if \(ownsAnalysisView\) toastSafe\(safeRead\(data,'warning'\)\);/);
});
