import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const historyRenderer = fs.readFileSync('public/modules/history-renderer.js', 'utf8');
const matchCenterController = fs.readFileSync('public/modules/match-center-controller.js', 'utf8');
const analysisController = fs.readFileSync('public/modules/analysis-controller.js', 'utf8');

test('renderAnalysis owns currentAnalysis assignment so a new fixture resets the active tab', () => {
  const render = app.match(/function renderAnalysis\(d\)[\s\S]*?state\.currentAnalysis = d;/);
  assert.ok(render, 'renderAnalysis must own currentAnalysis assignment');
  assert.match(render[0], /previousFixture/);
  assert.match(render[0], /previousFixture !== nextFixture/);

  const analyze = app.match(/async function analyzeMatch\(fixtureId, btn, options = \{\}\)[\s\S]*?\n}\n\nfunction historyItemFromAnalysis/);
  assert.ok(analyze, 'analyzeMatch must exist');
  assert.doesNotMatch(analyze[0], /state\.currentAnalysis = data/);

  const historyOpen = app.match(/async function openHistoryAnalysis\(fixtureId, btn\)[\s\S]*?\n}\n\nlet historyRenderer/);
  assert.ok(historyOpen, 'openHistoryAnalysis must exist');
  assert.doesNotMatch(historyOpen[0], /state\.currentAnalysis = data/);
});

test('a completed analysis is shown before conditional secondary synchronization starts', () => {
  const start = analysisController.indexOf('async function analyzeMatch');
  const end = analysisController.indexOf('return Object.freeze', start);
  assert.ok(start >= 0 && end > start, 'analysis controller must own analyzeMatch');
  const analyze = analysisController.slice(start, end);
  const showIndex = analyze.indexOf("showView('analysisView')");
  const secondaryIndex = analyze.indexOf('const secondaryTasks = [refreshHistory(false)]');
  assert.ok(showIndex >= 0 && secondaryIndex > showIndex, 'analysis screen must be shown before secondary refresh starts');
  assert.match(analyze, /if \(!state\.remindersLoaded\) secondaryTasks\.push\(refreshReminders\(\)\)/);
  assert.match(analyze, /if \(!state\.favoritesLoaded\) secondaryTasks\.push\(refreshFavorites\(\)\)/);
  assert.doesNotMatch(analyze, /await Promise\.all\(\[refreshHistory\(false\), refreshReminders\(\)\]\)/);
});

test('pending AI analysis cannot reclaim navigation after the user leaves or opens another match', () => {
  assert.match(app, /analysisRequestSeq:\s*0/);
  assert.match(analysisController, /const requestSeq = \+\+state\.analysisRequestSeq/);
  assert.match(analysisController, /const ownsAnalysisView = requestSeq === state\.analysisRequestSeq[\s\S]*?activeViewId\(\) === 'analysisView'/);
  assert.match(analysisController, /if \(ownsAnalysisView\) renderResult\(data\)/);
  assert.match(analysisController, /if \(ownsAnalysisView\) showView\('analysisView'\)/);
  assert.match(analysisController, /if \(requestSeq !== state\.analysisRequestSeq \|\| activeViewId\(\) !== 'analysisView'\) return/);

  assert.match(app, /async function openMatchCenter\(fixtureId, btn\)[\s\S]*?ensureMatchCenterController\(\)/);
  assert.match(matchCenterController, /async function openMatchCenter\(fixtureId, button\)[\s\S]*?if \(state\.analysisActionPending\) state\.analysisRequestSeq \+= 1/);

  assert.match(app, /from === 'analysisView' && to !== 'analysisView' && state\.analysisActionPending[\s\S]*?state\.analysisRequestSeq \+= 1/);
});

test('history gets an immediate local row and stale GET responses cannot overwrite it', () => {
  assert.match(app, /historyRevision:\s*0/);
  assert.match(app, /function rememberHistoryAnalysis\(data\)/);
  assert.match(app, /state\.historyRevision \+= 1/);
  const load = app.match(/async function loadHistory\(showLoader = true\)[\s\S]*?\n}\n\nasync function openHistoryAnalysis/);
  assert.ok(load, 'loadHistory must exist');
  assert.match(load[0], /const revisionAtStart = state\.historyRevision/);
  assert.match(load[0], /revisionAtStart !== state\.historyRevision/);
});

test('history open requests cannot hijack navigation after a newer click or manual view change', () => {
  assert.match(app, /historyOpenRequestSeq:\s*0/);
  assert.match(app, /const seq = \+\+state\.historyOpenRequestSeq/);
  assert.match(app, /seq !== state\.historyOpenRequestSeq/);
  assert.match(app, /from === 'historyView' && to !== 'historyView' && !options\.fromHistoryOpen/);
  assert.match(app, /showView\('analysisView', \{ fromHistoryOpen: true \}\)/);
});

test('history distinguishes loading, first-load failure, stale data and stale empty states', () => {
  assert.match(app, /historyLoading:\s*false/);
  assert.match(app, /historyLoadError:\s*''/);
  assert.match(historyRenderer, /Загружаю историю/);
  assert.match(historyRenderer, /История временно недоступна/);
  assert.match(historyRenderer, /Показана последняя загруженная история/);
  assert.match(historyRenderer, /Последняя загруженная история была пустой/);
});

test('RC28 health exposes history transition contracts', () => {
  assert.match(worker, /analysisHistoryTransition:\s*'enabled'/);
  assert.match(worker, /historyStaleGuard:\s*'enabled'/);
  assert.match(worker, /immediateAnalysisHandoff:\s*'enabled'/);
});
