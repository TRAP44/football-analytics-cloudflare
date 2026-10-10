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
  assert.match(center,/historyUnknown \? 'Не удалось проверить сохранённые разборы'/);
});

test('Match Center loads history itself and rerenders the open center when it arrives',()=>{
  const render=block(app,'function renderMatchCenter(d) {','\nasync function openMatchCenter');
  assert.match(render,/if \(!state\.historyLoaded && !state\.historyLoading && !state\.historyLoadError\) void loadHistory\(false\);/);
  const load=block(app,'async function loadHistory','async function openHistoryAnalysis');
  const fin=load.slice(load.indexOf('} finally {'));
  assert.match(fin,/state\.currentCenter && !state\.currentAnalysis && activeViewId\(\) === 'analysisView'\) renderMatchCenter\(state\.currentCenter\)/);
});
