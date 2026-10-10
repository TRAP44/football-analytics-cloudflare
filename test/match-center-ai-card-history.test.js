import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const view=fs.readFileSync('public/modules/match-center-view.js','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

test('AI card does not claim a missing analysis while history is still loading',()=>{
  const center=block(view,'export function renderMatchCenterView','// end renderMatchCenterView');
  assert.match(center,/const historyPending = !history && !state\.historyLoaded && !state\.historyLoadError;/);
  const pending=center.indexOf('historyPending\n    ?');
  const absent=center.indexOf('AI ещё не разбирал этот матч');
  const analyze=center.indexOf('id="centerAnalyzeBtn"');
  assert.ok(pending>=0 && pending<absent && absent<analyze);
  const pendingBranch=center.slice(pending,center.indexOf(': history',pending));
  assert.doesNotMatch(pendingBranch,/centerAnalyzeBtn/);
  const unknown=center.indexOf(': historyUnknown\n    ?');
  const unknownBranch=center.slice(unknown,center.indexOf(': upcoming',unknown));
  assert.ok(unknown>pending);
  assert.match(unknownBranch,/Не удалось проверить сохранённые разборы/);
  assert.match(unknownBranch,/centerHistoryRetryBtn/);
  assert.doesNotMatch(unknownBranch,/centerAnalyzeBtn/);
  assert.match(center,/\$\('centerHistoryRetryBtn'\)\?\.addEventListener\('click'[\s\S]*?void loadHistory\(false\)/);
});

test('Match Center loads history itself and rerenders the open center when it arrives',()=>{
  const render=block(app,'function renderMatchCenter(d) {','\nasync function openMatchCenter');
  assert.match(render,/if \(!state\.historyLoaded && !state\.historyLoading && !state\.historyLoadError\) void loadHistory\(false\);/);
  const load=block(app,'async function loadHistory','async function openHistoryAnalysis');
  const fin=load.slice(load.indexOf('} finally {'));
  assert.match(fin,/state\.currentCenter && !state\.currentAnalysis && activeViewId\(\) === 'analysisView'\) renderMatchCenter\(state\.currentCenter\)/);
});

// Поведенческая проверка загрузчика: исходник функции исполняется с подменённым import().
function loadExtrasLoader(fakeImport) {
  const source=block(app,'async function ensureMatchCenterExtras()','\nasync function loadProfile');
  const factory=new Function('fakeImport',`
    let matchCenterExtras=null; let matchCenterExtrasPromise=null;
    ${source.replace(/\bimport\(/g,'fakeImport(')}
    return { ensureMatchCenterExtras, extras: () => matchCenterExtras };
  `);
  return factory(fakeImport);
}

test('an optional Match Center chunk failing does not block the core view',async()=>{
  const view=()=>'view';
  const loader=loadExtrasLoader(async url=>{
    if (url.includes('match-center-view.js')) return { renderMatchCenterView:view };
    if (url.includes('match-pulse.js')) throw new Error('chunk failed');
    if (url.includes('ai-timeline.js')) return { renderAiTimelineCompact:()=>'c', renderAiTimelineDetails:()=>'d' };
    return { renderMatchHeadquarters:()=>'hq' };
  });
  const extras=await loader.ensureMatchCenterExtras();
  assert.equal(extras.renderMatchCenterView,view);
  assert.equal(extras.renderMatchPulse,undefined);
  assert.equal(typeof extras.renderAiTimelineCompact,'function');
  assert.equal(typeof extras.renderMatchHeadquarters,'function');
});

test('a failed core Match Center view is retried on the next call',async()=>{
  let fail=true;
  const loader=loadExtrasLoader(async url=>{
    if (url.includes('match-center-view.js')) {
      if (fail) throw new Error('core failed');
      return { renderMatchCenterView:()=>'view' };
    }
    return {};
  });
  await assert.rejects(loader.ensureMatchCenterExtras(),/core failed/);
  assert.equal(loader.extras(),null);
  fail=false;
  const extras=await loader.ensureMatchCenterExtras();
  assert.equal(typeof extras.renderMatchCenterView,'function');
});

test('sticky Match Center tabs stay below the sticky top bar',()=>{
  const css=fs.readFileSync('public/styles/premium-ui.css','utf8');
  const rule=block(css,'body.miniapp-public-shell .mr-hq-tabs-wrap {','}');
  assert.match(rule,/top: max\(62px, env\(safe-area-inset-top\)\)/);
  assert.match(rule,/z-index: 14/);
  assert.doesNotMatch(rule,/top: 0;/);
});

test('AI card headline never shows saved betting-style signal labels',()=>{
  const center=block(view,'export function renderMatchCenterView','// end renderMatchCenterView');
  assert.doesNotMatch(center,/history\.aiSignalLabel|history\.aiOutcome|history\.aiRisk/);
  assert.match(center,/<h2 id="mrAiCardTitle">AI уже разобрал этот матч<\/h2>/);
  const card=block(center,'const aiCardBody = historyPending','$(\'analysis\').innerHTML');
  for (const token of ['ТБ 2.5','Обе забьют','П1','коэффициент','ставк']) assert.ok(!card.includes(token),token);
});
