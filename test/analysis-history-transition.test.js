import { userDataDependencies } from '../test-support/runtime-deps.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUserDataApiRuntime } from '../src/user-data-api-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function json(payload,status=200) {
  return new Response(JSON.stringify(payload),{
    status,
    headers:{'content-type':'application/json'},
  });
}

function createUserDataRuntime({
  history = [{fixture_id:42}],
  fresh = null,
  stale = null,
  analysisFreshness = () => ({reasonCode:'fresh'}),
  recordOpsEvent = async () => {},
} = {}) {
  return createUserDataApiRuntime(userDataDependencies({
    analysisFreshness,
    analysisResponsePayload:(payload,meta)=>({...payload,...meta}),
    getCache:async()=>fresh,
    getHistory:async()=>history,
    getQuota:async()=>({plan:'FREE',used:1,limit:3,left:2}),
    getStaleCache:async()=>stale,
    json,
    recordOpsEvent,
  }));
}

const app = readRepoFile('public/app.js');
const historyRenderer = readRepoFile('public/modules/history-renderer.js');
const matchCenterController = readRepoFile('public/modules/match-center-controller.js');
const analysisController = readRepoFile('public/modules/analysis-controller.js');
const userDataApiSource = readRepoFile('src/user-data-api-runtime.js');

test('renderAnalysis owns currentAnalysis assignment so a new fixture resets the active tab', () => {
  const render = app.match(/function renderAnalysis\(d\)[\s\S]*?state\.currentAnalysis = d;/);
  assert.ok(render, 'renderAnalysis must own currentAnalysis assignment');
  assert.match(render[0], /previousFixture/);
  assert.match(render[0], /previousFixture !== nextFixture/);

  const analyze = app.match(/async function analyzeMatch\(fixtureId, btn, options = \{\}\)[\s\S]*?\n}\n\nfunction historyItemFromAnalysis/);
  assert.ok(analyze, 'analyzeMatch delegate must exist');
  assert.doesNotMatch(analyze[0], /state\.currentAnalysis = data/);

  const historyOpen = app.match(/async function openHistoryAnalysis\(fixtureId, btn\)[\s\S]*?\n}\n\nlet historyRenderer/);
  assert.ok(historyOpen, 'openHistoryAnalysis must exist');
  assert.doesNotMatch(historyOpen[0], /state\.currentAnalysis = data/);
});

test('local history accepts only canonical positive fixture identities', () => {
  const block = app.match(/function historyItemFromAnalysis\(data = \{\}\)[\s\S]*?\n}\n\nfunction rememberHistoryAnalysis/);
  assert.ok(block, 'history item builder must exist');
  assert.match(
    block[0],
    /const fixtureId = positiveEntityId\(match\.fixtureId\)/,
  );
  assert.match(block[0], /if \(!fixtureId\) return null/);
  assert.doesNotMatch(block[0], /Number\(match\.fixtureId\)/);
});

test('completed analysis is shown before conditional secondary synchronization starts', () => {
  const start = analysisController.indexOf('async function analyzeMatch');
  const end = analysisController.indexOf('return Object.freeze', start);
  assert.ok(start >= 0 && end > start, 'analysis controller must own analyzeMatch');
  const analyze = analysisController.slice(start, end);

  const renderIndex = analyze.indexOf('if (ownsAnalysisView) safeCall(renderResult,data)');
  const secondaryIndex = analyze.indexOf('const secondaryTasks=[');
  assert.ok(renderIndex >= 0 && secondaryIndex > renderIndex);

  assert.match(analyze, /if \(safeRead\(state,'remindersLoaded'\)!==true\)[\s\S]*?secondaryTasks\.push\([\s\S]*?refreshReminders\(\)/);
  assert.match(analyze, /if \(safeRead\(state,'favoritesLoaded'\)!==true\)[\s\S]*?secondaryTasks\.push\([\s\S]*?refreshFavorites\(\)/);
  assert.match(analyze, /void Promise\.allSettled\(secondaryTasks\)/);
});

test('pending AI analysis cannot reclaim navigation after the user leaves or opens another match', () => {
  assert.match(app, /analysisRequestSeq:\s*0/);
  assert.match(analysisController, /const requestSeq=currentSeq\+1;\s*state\.analysisRequestSeq=requestSeq/);
  assert.match(
    analysisController,
    /const ownsAnalysisView=\s*requestSeq===safeRead\(state,'analysisRequestSeq'\)[\s\S]*?currentView\(\)==='analysisView'/,
  );
  assert.match(analysisController, /if \(ownsAnalysisView\) safeCall\(renderResult,data\)/);
  assert.match(
    analysisController,
    /if \(\s*requestSeq!==safeRead\(state,'analysisRequestSeq'\)\s*\|\| currentView\(\)!=='analysisView'\s*\) return/,
  );

  assert.match(
    matchCenterController,
    /async function openMatchCenter\(fixtureId,button\)[\s\S]*?if \(safeRead\(state,'analysisActionPending'\)===true\)[\s\S]*?state\.analysisRequestSeq=\s*Number\.isSafeInteger\(seq\) && seq>=0 \? seq\+1 : 1/,
  );
  assert.match(
    app,
    /from === 'analysisView' && to !== 'analysisView' && state\.analysisActionPending[\s\S]*?state\.analysisRequestSeq \+= 1/,
  );
});

test('history gets an immediate local row and stale GET responses cannot overwrite it', () => {
  assert.match(app, /historyRevision:\s*0/);
  assert.match(app, /function rememberHistoryAnalysis\(data\)/);
  assert.match(app, /state\.historyRevision \+= 1/);

  const load = app.match(/async function loadHistory\(showLoader = true\)[\s\S]*?\n}\n\nasync function openHistoryAnalysis/);
  assert.ok(load, 'loadHistory must exist');
  assert.match(load[0], /const revisionAtStart = state\.historyRevision/);
  assert.match(load[0], /if \(revisionAtStart !== state\.historyRevision\) return/);
});

test('history open rejects invalid fixture ids before navigation or request sequencing', () => {
  const open = app.match(/async function openHistoryAnalysis\(fixtureId, btn\)[\s\S]*?\n}\n\nlet historyRenderer/);
  assert.ok(open, 'openHistoryAnalysis must exist');

  const guardIndex = open[0].indexOf('positiveEntityId(fixtureId)');
  const sourceViewIndex = open[0].indexOf('const sourceView = activeViewId()');
  const sequenceIndex = open[0].indexOf('++state.historyOpenRequestSeq');

  assert.ok(guardIndex >= 0);
  assert.ok(sourceViewIndex > guardIndex);
  assert.ok(sequenceIndex > guardIndex);
  assert.match(open[0], /if \(!id\)/);
  assert.match(open[0], /toast\('Не удалось определить матч из истории\.'\)/);
  assert.match(open[0], /history-analysis\?fixtureId=\$\{id\}/);
});

test('history open requests cannot hijack navigation after a newer click or manual view change', () => {
  assert.match(app, /historyOpenRequestSeq:\s*0/);
  assert.match(app, /const seq = \+\+state\.historyOpenRequestSeq/);
  assert.match(app, /seq !== state\.historyOpenRequestSeq/);
  assert.match(app, /from === 'historyView' && to !== 'historyView' && !options\.fromHistoryOpen/);
  assert.match(app, /showView\('analysisView', \{ fromHistoryOpen: true \}\)/);
});

test('history fallback opens Match Center only for a 404 history snapshot miss', () => {
  const open = app.match(/async function openHistoryAnalysis\(fixtureId, btn\)[\s\S]*?\n}\n\nlet historyRenderer/);
  assert.ok(open);
  assert.match(open[0], /if \(Number\(error\?\.status \|\| 0\) === 404\)/);
  assert.match(open[0], /requestMatchCenter\(id, \{\}, \{ timeoutMs: 9000 \}\)/);
  assert.match(open[0], /Сохранённый полный анализ уже недоступен — открыт центр матча/);
});

test('history renderer distinguishes loading, first-load failure, stale data and stale empty states', () => {
  assert.match(app, /historyLoading:\s*false/);
  assert.match(app, /historyLoadError:\s*''/);
  assert.match(historyRenderer, /Загружаю историю/);
  assert.match(historyRenderer, /История временно недоступна/);
  assert.match(historyRenderer, /Показана последняя загруженная история/);
  assert.match(historyRenderer, /Последняя загруженная история была пустой/);
});

test('history analysis API rejects invalid fixture ids and fixtures absent from user history', async () => {
  const runtime = createUserDataRuntime();

  const invalid = await runtime.apiHistoryAnalysis(
    new Request('https://app.test/api/history-analysis?fixtureId=-1'),
    {},
    {id:123},
  );
  assert.equal(invalid.status,400);

  const absentRuntime = createUserDataRuntime({history:[{fixture_id:99}]});
  const absent = await absentRuntime.apiHistoryAnalysis(
    new Request('https://app.test/api/history-analysis?fixtureId=42'),
    {},
    {id:123},
  );
  assert.equal(absent.status,404);
  assert.equal((await absent.json()).code,'HISTORY_ANALYSIS_NOT_FOUND');
});

test('history analysis API rejects a cache payload whose internal fixture identity does not match', async () => {
  const events=[];
  const runtime = createUserDataRuntime({
    fresh:{
      match:{fixtureId:777},
      generatedAt:'2026-10-01T12:00:00Z',
    },
    recordOpsEvent:async (_cfg,event)=>events.push(event),
  });

  const response = await runtime.apiHistoryAnalysis(
    new Request('https://app.test/api/history-analysis?fixtureId=42'),
    {},
    {id:123},
  );
  const payload = await response.json();

  assert.equal(response.status,409);
  assert.equal(payload.code,'HISTORY_ANALYSIS_IDENTITY_MISMATCH');
  assert.equal(events.length,1);
  assert.equal(events[0].eventType,'history_analysis_cache_rejected');
  assert.deepEqual(events[0].meta,{fixtureId:42,payloadFixtureId:777});
});

test('history analysis API reopens a verified cache snapshot read-only without spending a new analysis', async () => {
  const runtime = createUserDataRuntime({
    fresh:{
      match:{fixtureId:42,home:{name:'Home'},away:{name:'Away'}},
      generatedAt:'2026-10-01T12:00:00Z',
    },
  });

  const response = await runtime.apiHistoryAnalysis(
    new Request('https://app.test/api/history-analysis?fixtureId=42'),
    {},
    {id:123},
  );
  const payload = await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.cached,true);
  assert.equal(payload.stale,false);
  assert.equal(payload.historyReadOnly,true);
  assert.deepEqual(payload.recheck,{
    requested:false,
    performed:false,
    free:false,
    reasonCode:'fresh',
  });
  assert.deepEqual(payload.quota,{plan:'FREE',used:1,limit:3,left:2});
});

test('history reopen remains available if freshness diagnostics throw', async () => {
  const runtime = createUserDataRuntime({
    fresh:{
      match:{fixtureId:42},
      generatedAt:'2026-10-01T12:00:00Z',
    },
    analysisFreshness:()=>{ throw new Error('freshness unavailable'); },
  });

  const response = await runtime.apiHistoryAnalysis(
    new Request('https://app.test/api/history-analysis?fixtureId=42'),
    {},
    {id:123},
  );
  const payload = await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.historyReadOnly,true);
  assert.equal(payload.recheck.reasonCode,'history_snapshot');
});

test('backend source keeps history identity validation adjacent to cached payload reuse', () => {
  assert.match(
    userDataApiSource,
    /const payloadFixtureId=positiveId\(plainObject\(payload\?\.match\)\?\.fixtureId\)[\s\S]*?HISTORY_ANALYSIS_IDENTITY_MISMATCH/,
  );
  assert.match(
    userDataApiSource,
    /analysisResponsePayload\(payload,\{cached:true,stale:!fresh,historyReadOnly:true/,
  );
});


test('history reads the same cache generation that AI writes', async () => {
  const writer = readRepoFile('src/analysis-runtime.js');
  const generation = writer.match(/fixture:\$\{fixtureId\}:([^`]+)/)?.[1];
  assert.ok(generation);
  const keys = [];
  const runtime = createUserDataApiRuntime(userDataDependencies({
    getHistory: async () => [{fixture_id:42}],
    getCache: async key => { keys.push(key); return {match:{fixtureId:42}}; },
    getQuota: async () => ({left:2}),
    analysisFreshness: () => ({reasonCode:'fresh'}),
    analysisResponsePayload: (payload, meta) => ({...payload,...meta}),
    json,
  }));
  const response = await runtime.apiHistoryAnalysis(
    new Request('https://app.test/api/history-analysis?fixtureId=42'), {}, {id:123},
  );
  assert.equal(response.status,200);
  assert.deepEqual(keys,[`fixture:42:${generation}`]);
  for (const owner of ['telegram-bot-ui-runtime','match-center-runtime','publisher-runtime']) {
    const source = readRepoFile(`src/${owner}.js`);
    const generations = [...source.matchAll(/fixture:\$\{[^}]+\}:([^`]+)/g)].map(match=>match[1]);
    assert.ok(generations.length,owner);
    assert.ok(generations.every(value=>value===generation),owner);
  }
});
