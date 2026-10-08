import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPostMatchReturnRuntime } from '../src/post-match-return-runtime.js';

const postMatchReturn=readFileSync(new URL('../src/post-match-return-runtime.js',import.meta.url),'utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('post-match return reads recent history through bounded pagination instead of a 300-row single page',()=>{
  const load=block(postMatchReturn,'async function loadPostMatchReturnCandidates','async function loadPostMatchReturnPredictions');
  assert.match(load,/supaSelectPaged\(cfg,'analysis_history'/);
  assert.match(load,/pageSize:500/);
  assert.match(load,/maxRows:5000/);
  assert.match(load,/order:'fixture_date\.desc'/);
  assert.doesNotMatch(load,/supaSelectMany\(cfg,'analysis_history'.*limit:300/);
});

test('post-match return surfaces history truncation in ops and scheduler summary',()=>{
  assert.match(postMatchReturn,/RETURN_HISTORY_TRUNCATED/);
  assert.match(postMatchReturn,/candidatePage\.truncated/);
  assert.match(postMatchReturn,/cap:5000/);
  assert.match(postMatchReturn,/truncated:Boolean\(candidatePage\.truncated\)/);
});



function postMatchPagingRuntime({hasSupabase=true,selectPaged,selectMany}={}){
  return createPostMatchReturnRuntime({
    hasSupabase:()=>hasSupabase,
    supaSelectPaged:selectPaged|| (async()=>({rows:[],truncated:false})),
    supaSelectMany:selectMany|| (async()=>[]),
  });
}

test('history paging keeps its 5000-row budget and newest-first order',async()=>{
  const calls=[];
  const service=postMatchPagingRuntime({selectPaged:async (...args)=>{
    calls.push(args);
    return {rows:[],truncated:true};
  }});
  const now=Date.parse('2026-10-08T12:00:00Z');
  const page=await service.loadPostMatchReturnCandidates({},now);
  assert.deepEqual(page,{rows:[],truncated:true});
  assert.equal(calls.length,1);
  assert.equal(calls[0][1],'analysis_history');
  assert.deepEqual(calls[0][3],{pageSize:500,maxRows:5000,order:'fixture_date.desc'});
  assert.equal(calls[0][2].fixture_date,'gte.2026-10-07T18:00:00.000Z');
});

test('pagination excludes rows with missing fixture identity, invalid kickoff or a future match',async()=>{
  const now=Date.parse('2026-10-08T12:00:00Z');
  const service=postMatchPagingRuntime({selectPaged:async()=>({
    rows:[
      {telegram_id:42,fixture_id:77,fixture_date:'2026-10-08T10:00:00Z'},
      {telegram_id:42,fixture_id:78,fixture_date:'2026-10-08T11:00:00Z'},
      {telegram_id:0,fixture_id:79,fixture_date:'2026-10-08T09:00:00Z'},
      {telegram_id:42,fixture_id:0,fixture_date:'2026-10-08T09:00:00Z'},
      {telegram_id:42,fixture_id:80,fixture_date:'not-a-date'},
    ],truncated:false,
  })});
  const result=await service.loadPostMatchReturnCandidates({},now);
  assert.deepEqual(result.rows.map(row=>row.fixture_id),[77]);
  assert.equal(result.truncated,false);
});

test('pagination with no Supabase skips all history reads',async()=>{
  let called=0;
  const service=postMatchPagingRuntime({
    hasSupabase:false,
    selectPaged:async()=>{called++;return {rows:[]};},
  });
  assert.deepEqual(await service.loadPostMatchReturnCandidates({},Date.now()),{rows:[],truncated:false});
  assert.equal(called,0);
});

test('prediction lookup deduplicates IDs and caps each database batch at sixty',async()=>{
  const calls=[];
  const service=postMatchPagingRuntime({selectMany:async(...args)=>{
    calls.push(args);
    return [{fixture_id:calls.length}];
  }});
  const ids=[...Array.from({length:121},(_,i)=>i+1),1,0,-1,true,'invalid'];
  const results=await service.loadPostMatchReturnPredictions(ids,{});
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(args=>args[3].limit),[65,65,6]);
  assert.equal(calls[0][1],'model_predictions');
  assert.match(calls[0][2].fixture_id,/^in\.\(1,2,3,/);
  assert.deepEqual(results.map(x=>x.fixture_id),[1,2,3]);
});
