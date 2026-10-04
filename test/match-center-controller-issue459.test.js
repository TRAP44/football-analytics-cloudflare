import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMatchCenterController } from '../public/modules/match-center-controller.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function baseState() {
  return {
    currentCenter: null,
    currentCenterTab: 'summary',
    analysisBackView: 'matchesView',
    analysisActionPending: false,
    analysisRequestSeq: 0,
    clientPerf: { deduped: 0 },
  };
}

function makeController(overrides = {}) {
  const state = overrides.state || baseState();
  const documentRef = overrides.documentRef || { hidden: false };
  const elements = new Map([['liveRefreshText', { textContent: '' }]]);
  const calls = [];
  const timers = [];
  const cleared = [];
  let view = overrides.view || 'matchesView';

  const controller = createMatchCenterController({
    state,
    documentRef,
    elementById: id => elements.get(id) || null,
    activeViewId: () => view,
    showView: (id, options) => { calls.push(['view', id, options]); view = id; },
    api: overrides.api || (async () => ({ mode: 'upcoming', match: { fixtureId: 7 } })),
    runtimeAllows: overrides.runtimeAllows || (() => true),
    ensureMatchCenterExtras: overrides.ensureMatchCenterExtras || (async () => { calls.push(['extras']); }),
    renderMatchCenter: overrides.renderMatchCenter || (data => { state.currentCenter = data; calls.push(['render', data]); }),
    renderJourneyState: (...args) => calls.push(['journey', ...args]),
    sendProductAction: (...args) => calls.push(['product', ...args]),
    sendMatchDataCoverage: (...args) => calls.push(['coverage', ...args]),
    sendOperationTiming: (...args) => calls.push(['timing', ...args]),
    sendActionError: (...args) => calls.push(['error', ...args]),
    apiErrorCategory: overrides.apiErrorCategory || (() => 'error'),
    friendlyErrorMessage: overrides.friendlyErrorMessage || (() => 'friendly'),
    toast: message => calls.push(['toast', message]),
    performanceNow: () => 123,
    setTimer: (fn, ms) => {
      const handle = timers.length + 1;
      timers.push({ handle, fn, ms });
      return handle;
    },
    clearTimer: handle => cleared.push(handle),
  });

  return {
    controller,
    state,
    documentRef,
    elements,
    calls,
    timers,
    cleared,
    setView: value => { view = value; },
  };
}

test('Match Center controller deduplicates concurrent requests for the same fixture', async () => {
  const pending = deferred();
  let apiCalls = 0;
  const { controller, state } = makeController({
    api: async url => {
      apiCalls += 1;
      assert.equal(url, '/api/match-center?fixtureId=7');
      return pending.promise;
    },
  });

  const first = controller.requestMatchCenter(7);
  const second = controller.requestMatchCenter(7);
  pending.resolve({ mode: 'upcoming', match: { fixtureId: 7 } });

  const [a, b] = await Promise.all([first, second]);
  assert.equal(apiCalls, 1);
  assert.equal(state.clientPerf.deduped, 1);
  assert.equal(a.match.fixtureId, 7);
  assert.equal(b.match.fixtureId, 7);
});

test('newer Match Center request suppresses stale response from an older fixture', async () => {
  const first = deferred();
  const second = deferred();
  const { controller } = makeController({
    api: async url => url.includes('fixtureId=1') ? first.promise : second.promise,
  });

  const oldRequest = controller.requestMatchCenter(1);
  const newRequest = controller.requestMatchCenter(2);

  first.resolve({ mode: 'upcoming', match: { fixtureId: 1 } });
  second.resolve({ mode: 'live', match: { fixtureId: 2 } });

  assert.equal(await oldRequest, null);
  assert.equal((await newRequest).match.fixtureId, 2);
});

test('live refresh remains disabled when runtime control blocks LIVE', () => {
  const state = baseState();
  state.currentCenter = { mode: 'live', refreshSeconds: 20, match: { fixtureId: 9 } };
  const { controller, elements, timers } = makeController({
    state,
    view: 'analysisView',
    runtimeAllows: key => key !== 'liveEnabled',
  });

  controller.startLiveRefresh(9);

  assert.equal(controller.isLiveRefreshActive(), false);
  assert.equal(timers.length, 0);
  assert.match(elements.get('liveRefreshText').textContent, /приостановлено/);
});

test('visibility lifecycle suspends and resumes an active live refresh without shared app timer state', () => {
  const state = baseState();
  state.currentCenter = { mode: 'live', refreshSeconds: 30, match: { fixtureId: 12 } };
  const { controller, timers, cleared } = makeController({ state, view: 'analysisView' });

  controller.startLiveRefresh(12);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 30000);
  assert.equal(controller.isLiveRefreshActive(), true);

  assert.equal(controller.suspendLiveRefresh(), true);
  assert.deepEqual(cleared, [1]);
  assert.equal(controller.isLiveRefreshActive(), true);

  assert.equal(controller.resumeLiveRefresh(), true);
  assert.equal(timers.length, 2);

  controller.deactivateLiveRefresh();
  assert.equal(controller.isLiveRefreshActive(), false);
});

test('openMatchCenter owns loading, rendering and telemetry lifecycle', async () => {
  const button = { disabled: false, textContent: 'Открыть' };
  const { controller, state, calls } = makeController({
    api: async () => ({ mode: 'live', refreshSeconds: 60, match: { fixtureId: 7 } }),
  });

  await controller.openMatchCenter(7, button);

  assert.equal(state.analysisBackView, 'matchesView');
  assert.equal(state.currentCenter.match.fixtureId, 7);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Открыть');
  assert.ok(calls.some(row => row[0] === 'journey' && row[1] === 'loading'));
  assert.ok(calls.some(row => row[0] === 'product' && row[1] === 'match_open'));
  assert.ok(calls.some(row => row[0] === 'product' && row[1] === 'live_open'));
  assert.ok(calls.some(row => row[0] === 'coverage'));
  assert.ok(calls.some(row => row[0] === 'timing' && row[1] === 'match'));
});

test('provider failure keeps a reusable Match Center snapshot and fails soft', async () => {
  const state = baseState();
  state.currentCenter = { mode: 'upcoming', match: { fixtureId: 15 } };
  const { controller, calls } = makeController({
    state,
    view: 'analysisView',
    api: async () => { throw Object.assign(new Error('provider down'), { status: 503 }); },
    apiErrorCategory: () => 'provider',
    friendlyErrorMessage: () => 'Источник временно недоступен',
  });

  await controller.openMatchCenter(15, null);

  assert.ok(calls.filter(row => row[0] === 'render').length >= 1);
  assert.ok(calls.some(row => row[0] === 'toast' && /Источник/.test(row[1])));
  assert.equal(calls.some(row => row[0] === 'journey' && row[1] === 'error'), false);
});

test('app composition root wires Match Center controller and no longer owns its mutable timer/inflight implementation', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const module = fs.readFileSync(new URL('../public/modules/match-center-controller.js', import.meta.url), 'utf8');

  assert.match(app, /import\('\.\/modules\/match-center-controller\.js'\)/);
  assert.match(app, /async function ensureMatchCenterController\(\)/);
  assert.match(app, /suspendLiveRefresh\(\)/);
  assert.match(app, /resumeLiveRefresh\(\)/);
  assert.doesNotMatch(app, /matchCenterInFlight:/);
  assert.doesNotMatch(app, /matchCenterRequestSeq:/);
  assert.doesNotMatch(app, /liveRefreshTimer:/);
  assert.doesNotMatch(app, /liveRefreshWasActive:/);
  assert.match(app, /async function requestMatchCenter\(fixtureId, extraParams = \{\}, options = \{\}\)[\s\S]*?ensureMatchCenterController\(\)/);
  assert.match(app, /async function openMatchCenter\(fixtureId, btn\)[\s\S]*?ensureMatchCenterController\(\)/);
  assert.doesNotMatch(app, /function scheduleLiveRefresh\(/);
  assert.match(module, /\/api\/match-center\?/);
  assert.match(module, /function scheduleLiveRefresh\(/);
  assert.match(module, /async function openMatchCenter\(/);
});
