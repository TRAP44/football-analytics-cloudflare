import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisController } from '../public/modules/analysis-controller.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function baseState() {
  return {
    profile: { quota: { remaining: 3 } },
    provider: null,
    runtimeStatus: null,
    currentCenter: null,
    analysisBackView: 'matchesView',
    analysisActionPending: false,
    analysisRequestSeq: 0,
    remindersLoaded: false,
    favoritesLoaded: false,
  };
}

function makeController(overrides = {}) {
  const state = overrides.state || baseState();
  const calls = [];
  let view = overrides.view || 'matchesView';

  const controller = createAnalysisController({
    state,
    documentRef: {},
    activeViewId: () => view,
    showView: (id, options) => { calls.push(['view', id, options]); view = id; },
    api: overrides.api || (async url => {
      if (url.startsWith('/api/entitlements?')) return { entitlement: { source: 'free' } };
      if (url === '/api/analyze') return { match: { fixtureId: 7 }, quota: { remaining: 2 } };
      throw new Error('unexpected api ' + url);
    }),
    runtimeAllows: overrides.runtimeAllows || (() => true),
    stopLiveRefresh: () => calls.push(['stop-live']),
    hideQuotaPaywall: () => calls.push(['hide-paywall']),
    showQuotaPaywallForFixture: fixtureId => calls.push(['show-paywall', fixtureId]),
    syncAnalysisBusyUi: () => calls.push(['busy', state.analysisActionPending]),
    renderJourneyState: (...args) => calls.push(['journey', ...args]),
    renderAnalysis: data => calls.push(['render-analysis', data]),
    renderMatchCenter: data => calls.push(['render-center', data]),
    rememberHistoryAnalysis: data => calls.push(['history', data]),
    renderProfile: () => calls.push(['profile']),
    renderProvider: () => calls.push(['provider']),
    renderDiscoveryHome: () => calls.push(['discovery']),
    renderGlobalSearch: () => calls.push(['search']),
    loadHistory: (...args) => { calls.push(['load-history', ...args]); return Promise.resolve(); },
    loadReminders: (...args) => { calls.push(['load-reminders', ...args]); return Promise.resolve(); },
    loadFavorites: (...args) => { calls.push(['load-favorites', ...args]); return Promise.resolve(); },
    buildAnalysisAccessUsage: args => ({ fixtureId: args.fixtureId, source: args.entitlementBefore?.entitlement?.source || 'none' }),
    refreshPassAccess: fixtureId => { calls.push(['pass-refresh', fixtureId]); return Promise.resolve(); },
    isAdmin: overrides.isAdmin || (() => false),
    sendProductAction: (...args) => calls.push(['product', ...args]),
    sendOperationTiming: (...args) => calls.push(['timing', ...args]),
    sendActionError: (...args) => calls.push(['error', ...args]),
    apiErrorCategory: overrides.apiErrorCategory || (() => 'error'),
    toast: message => calls.push(['toast', message]),
    performanceNow: () => 100,
  });

  return { controller, state, calls, setView: id => { view = id; } };
}

test('analysis controller keeps analysis single-flight', async () => {
  const state = baseState();
  state.analysisActionPending = true;
  let apiCalls = 0;
  const { controller, calls } = makeController({
    state,
    api: async () => { apiCalls += 1; return {}; },
  });

  await controller.analyzeMatch(7, null);

  assert.equal(apiCalls, 0);
  assert.ok(calls.some(row => row[0] === 'toast' && /уже выполняется/.test(row[1])));
});

test('invalid fixture ids fail before navigation, busy UI or network work', async () => {
  for (const fixtureId of [0,-1,1.5,Number.NaN,'bad']) {
    const state=baseState();
    let apiCalls=0;
    const {controller,calls}=makeController({
      state,
      view:'teamView',
      api:async()=>{ apiCalls+=1; return {}; },
    });

    await controller.analyzeMatch(fixtureId,null);

    assert.equal(apiCalls,0,String(fixtureId));
    assert.equal(state.analysisRequestSeq,0,String(fixtureId));
    assert.equal(state.analysisActionPending,false,String(fixtureId));
    assert.equal(state.analysisBackView,'matchesView',String(fixtureId));
    assert.equal(calls.some(row=>row[0]==='stop-live'),false,String(fixtureId));
    assert.equal(calls.some(row=>row[0]==='busy'),false,String(fixtureId));
    assert.equal(calls.some(row=>row[0]==='view'),false,String(fixtureId));
    assert.ok(calls.some(row=>row[0]==='toast' && /определить матч/.test(row[1])),String(fixtureId));
  }
});

test('runtime-disabled analysis exits before request without mutating navigation coordination', async () => {
  const state = baseState();
  state.runtimeStatus = { message: 'AI временно выключен' };
  let apiCalls = 0;
  const { controller, calls } = makeController({
    state,
    view: 'teamView',
    runtimeAllows: key => key !== 'analysisEnabled',
    api: async () => { apiCalls += 1; return {}; },
  });

  await controller.analyzeMatch(7, null);

  assert.equal(apiCalls, 0);
  assert.equal(state.analysisBackView, 'matchesView');
  assert.equal(state.analysisRequestSeq, 0);
  assert.equal(state.analysisActionPending, false);
  assert.equal(calls.some(row => row[0] === 'stop-live'), false);
  assert.equal(calls.some(row => row[0] === 'view'), false);
  assert.ok(calls.some(row => row[0] === 'toast' && row[1] === 'AI временно выключен'));
});

test('successful analysis owns request, access snapshots, telemetry and secondary refresh lifecycle', async () => {
  const state = baseState();
  const apiCalls = [];
  const { controller, calls } = makeController({
    state,
    api: async (url, options) => {
      apiCalls.push([url, options]);
      if (url.startsWith('/api/entitlements?')) return { entitlement: { source: 'pass' } };
      if (url === '/api/analyze') {
        return {
          match: { fixtureId: 7 },
          quota: { remaining: 1 },
          provider: { visibility: 'admin', name: 'fixture-source' },
        };
      }
      throw new Error('unexpected api ' + url);
    },
    isAdmin: () => true,
  });

  const button = { textContent: 'Разобрать' };
  await controller.analyzeMatch(7, button, { newsImpactAction: 'RECHECK' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(apiCalls.filter(([url]) => url.startsWith('/api/entitlements?')).length, 2);
  const analyzeCall = apiCalls.find(([url]) => url === '/api/analyze');
  assert.ok(analyzeCall);
  const body = JSON.parse(analyzeCall[1].body);
  assert.equal(body.fixtureId, 7);
  assert.equal(body.origin, 'miniapp');
  assert.equal(body.newsImpactAction, 'recheck');
  assert.equal(state.analysisActionPending, false);
  assert.equal(state.profile.quota.remaining, 1);
  assert.equal(state.provider.name, 'fixture-source');
  assert.equal(button.textContent, 'Разобрать');
  assert.ok(calls.some(row => row[0] === 'render-analysis'));
  assert.ok(calls.some(row => row[0] === 'history'));
  assert.ok(calls.some(row => row[0] === 'product' && row[1] === 'ai_start'));
  assert.ok(calls.some(row => row[0] === 'product' && row[1] === 'ai_complete'));
  assert.ok(calls.some(row => row[0] === 'timing' && row[1] === 'ai'));
  assert.ok(calls.some(row => row[0] === 'pass-refresh' && row[1] === 7));
  assert.ok(calls.some(row => row[0] === 'load-history' && row[1] === false));
  assert.ok(calls.some(row => row[0] === 'load-reminders'));
  assert.ok(calls.some(row => row[0] === 'load-favorites'));
});

test('stale analysis response cannot reclaim the analysis view', async () => {
  const pending = deferred();
  const state = baseState();
  const { controller, calls, setView } = makeController({
    state,
    api: async url => {
      if (url.startsWith('/api/entitlements?')) return { entitlement: { source: 'free' } };
      if (url === '/api/analyze') return pending.promise;
      throw new Error('unexpected api ' + url);
    },
  });

  const task = controller.analyzeMatch(7, null);
  await new Promise(resolve => setImmediate(resolve));
  state.analysisRequestSeq += 1;
  setView('matchesView');
  pending.resolve({ match: { fixtureId: 7 } });
  await task;

  assert.equal(calls.some(row => row[0] === 'render-analysis'), false);
  assert.ok(calls.some(row => row[0] === 'history'));
  assert.equal(calls.filter(row => row[0] === 'view' && row[1] === 'analysisView').length, 1);
});

test('provider failure restores previous Match Center snapshot fail-soft', async () => {
  const state = baseState();
  state.currentCenter = { mode: 'upcoming', match: { fixtureId: 7 } };
  const { controller, calls } = makeController({
    state,
    view: 'analysisView',
    api: async url => {
      if (url.startsWith('/api/entitlements?')) return null;
      if (url === '/api/analyze') throw Object.assign(new Error('provider down'), { status: 503 });
      return null;
    },
    apiErrorCategory: () => 'provider',
  });

  await controller.analyzeMatch(7, null);

  assert.equal(state.currentCenter.match.fixtureId, 7);
  assert.ok(calls.some(row => row[0] === 'render-center'));
  assert.ok(calls.some(row => row[0] === 'error' && row[1] === 'ai'));
  assert.equal(calls.some(row => row[0] === 'journey' && row[1] === 'error'), false);
});

test('quota exhaustion shows paywall only for the explicit quota code', async () => {
  const state = baseState();
  const quotaError = Object.assign(new Error('quota'), {
    status: 429,
    payload: {
      code: 'ANALYSIS_QUOTA_EXHAUSTED',
      quota: { used:3, limit:3, left:0 },
    },
  });
  const { controller, calls } = makeController({
    state,
    api: async url => {
      if (url.startsWith('/api/entitlements?')) return null;
      if (url === '/api/analyze') throw quotaError;
      return null;
    },
    apiErrorCategory: () => 'quota',
  });

  await controller.analyzeMatch(11, null);

  assert.ok(calls.some(row => row[0] === 'show-paywall' && row[1] === 11));
  assert.ok(calls.some(row => row[0] === 'toast' && /закончились/.test(row[1])));
  assert.ok(calls.some(row => row[0] === 'journey' && row[1] === 'error'));
});
test('analysis warming and provider throttling never masquerade as quota exhaustion', async () => {
  for (const scenario of [
    {
      error:Object.assign(new Error('Матч уже рассчитывается.'),{
        status:429,
        payload:{code:'ANALYSIS_WARMING',retryAfter:5,quota:{used:1,limit:3,left:2}},
      }),
      category:'rate_limit',
      toast:/уже рассчитывается/,
    },
    {
      error:Object.assign(new Error('provider limited'),{
        status:429,
        payload:{code:'FOOTBALL_RATE_LIMIT',retryAfter:12},
      }),
      category:'rate_limit',
      toast:/~12 сек/,
    },
  ]) {
    const state=baseState();
    const {controller,calls}=makeController({
      state,
      view:'matchesView',
      api:async url=>{
        if (url.startsWith('/api/entitlements?')) return null;
        if (url==='/api/analyze') throw scenario.error;
        return null;
      },
      apiErrorCategory:()=>scenario.category,
    });

    await controller.analyzeMatch(15,null);

    assert.equal(calls.some(row=>row[0]==='show-paywall'),false);
    assert.ok(calls.some(row=>row[0]==='toast' && scenario.toast.test(String(row[1]))));
    assert.ok(calls.some(row=>row[0]==='view' && row[1]==='matchesView' && row[2]?.restore===true));
  }
});

test('analysis backend emits distinct 429 codes for quota exhaustion and warming', () => {
  const source=readRepoFile('src/analysis-runtime.js');

  assert.match(
    source,
    /code:'ANALYSIS_QUOTA_EXHAUSTED'[\s\S]*?429,'quota_exhausted'/,
  );
  assert.match(
    source,
    /code:'ANALYSIS_WARMING'[\s\S]*?429,'analysis_warming'/,
  );
});


test('app keeps only a lazy analysis delegate while controller owns analyze network/recovery lifecycle', () => {
  const app = readRepoFile('public/app.js');
  const module = readRepoFile('public/modules/analysis-controller.js');

  assert.match(app, /import\('\.\/modules\/analysis-controller\.js'\)/);
  assert.match(app, /async function ensureAnalysisController\(\)/);
  assert.match(app, /async function analyzeMatch\(fixtureId, btn, options = \{\}\)[\s\S]*?ensureAnalysisController\(\)/);
  assert.doesNotMatch(app, /await api\('\/api\/analyze'/);
  assert.doesNotMatch(app, /async function loadAnalysisAccessSnapshot\(/);
  assert.match(module, /async function loadAnalysisAccessSnapshot\(/);
  assert.match(module, /await api\('\/api\/analyze'/);
  assert.match(module, /const ownsAnalysisView = requestSeq === state\.analysisRequestSeq/);
  assert.match(module, /showPaywall\(fixtureId\)/);
});
