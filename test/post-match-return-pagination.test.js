import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('post-match return reads recent history through bounded pagination instead of a 300-row single page',()=>{
  const load=block(worker,'async function loadPostMatchReturnCandidates','async function loadPostMatchReturnPredictions');
  assert.match(load,/supaSelectPaged\(cfg,'analysis_history'/);
  assert.match(load,/pageSize:500/);
  assert.match(load,/maxRows:5000/);
  assert.match(load,/order:'fixture_date\.desc'/);
  assert.doesNotMatch(load,/supaSelectMany\(cfg,'analysis_history'.*limit:300/);
});

test('post-match return surfaces history truncation in ops and scheduler summary',()=>{
  const process=block(worker,'async function processPostMatchReturns','async function sendTelegramMessage');
  assert.match(process,/RETURN_HISTORY_TRUNCATED/);
  assert.match(process,/candidatePage\.truncated/);
  assert.match(process,/cap:5000/);
  assert.match(process,/truncated:Boolean\(candidatePage\.truncated\)/);
});
