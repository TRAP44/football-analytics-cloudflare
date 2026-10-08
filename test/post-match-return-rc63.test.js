import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPostMatchReturnRuntime } from '../src/post-match-return-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const returns=fs.readFileSync('src/post-match-return-runtime.js','utf8');
const telegram=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
const scheduled=fs.readFileSync('src/scheduled-jobs.js','utf8');

test('RC63 selects only analyzed matches old enough to be finished',()=> {
  assert.match(returns,/function postMatchReturnEligibility\(/);
  assert.match(returns,/POST_MATCH_RETURN_MIN_DELAY_MINUTES = 105/);
  assert.match(returns,/POST_MATCH_RETURN_MAX_AGE_HOURS = 18/);
  assert.match(returns,/status \|\| ''\)==='settled'/);
});

test('return message compares pre-match model with final fact',()=> {
  assert.match(returns,/function postMatchReturnMessage\(/);
  assert.match(returns,/Матч завершён · MatchRadar AI/);
  assert.match(returns,/Исход модели/);
  assert.match(returns,/Открыть итог AI/);
  assert.match(returns,/match:return_review:/);
});

test('delivery is persistent, deduped and can recover stale claims',()=> {
  assert.match(returns,/function postMatchReturnDeliveryKey\(/);
  assert.match(returns,/async function claimPostMatchReturnDelivery\(/);
  assert.match(returns,/resolution=ignore-duplicates,return=representation/);
  assert.match(returns,/prior\?\.payload\?\.state==='claimed'/);
  assert.match(returns,/async function finishPostMatchReturnClaim\(/);
});

test('return loop protects provider quota and user attention',()=> {
  assert.match(returns,/POST_MATCH_RETURN_COOLDOWN_MINUTES = 30/);
  assert.match(returns,/freeQuotaHealthy\(15,2\)/);
  assert.match(returns,/postmatch:return:disabled/);
  assert.match(returns,/postmatch:return:cooldown/);
  assert.match(returns,/sentUsers\.has\(userId\)/);
});

test('Telegram supports return open and reversible opt-out',()=> {
  assert.match(telegram,/postmatch:return:off/);
  assert.match(telegram,/postmatch:return:on/);
  assert.match(telegram,/match:return_review/);
  assert.match(telegram,/post_match_return_open/);
  assert.match(returns,/post_match_return_sent/);
});

test('cron chains return loop after settlement task',()=> {
  assert.match(scheduled,/const postMatchPrerequisite = dailyDigestTask/);
  assert.match(scheduled,/\['post_match_return', postMatchPrerequisite\.then\(\(\) => run\('post_match_return', \(\) => processPostMatchReturns\(cfg\)\)\)\]/);
});

test('RC63 deterministic drill remains wired through the current modular runtime',()=> {
  assert.match(returns,/function postMatchReturnDrill\(/);
  assert.match(worker,/function postMatchReturnDrill\(\.\.\.args\) \{ return getPostMatchReturnRuntime\(\)\.postMatchReturnDrill\(\.\.\.args\); \}/);
  assert.match(worker,/function processPostMatchReturns\(\.\.\.args\) \{ return getPostMatchReturnRuntime\(\)\.processPostMatchReturns\(\.\.\.args\); \}/);
  assert.match(worker,/const APP_VERSION = '6\.120\.0-rc144'/);
  assert.match(worker,/const RC_NAME = 'RC144'/);
});



test('RC63 return requires a true settled result with non-missing final score',()=>{
  const eligibility=createPostMatchReturnRuntime({}).postMatchReturnEligibility;
  const now=Date.parse('2026-10-08T12:00:00Z');
  const history={telegram_id:42,fixture_id:77,fixture_date:'2026-10-08T09:00:00Z'};
  for(const goals of [
    {actual_home_goals:null,actual_away_goals:null},
    {actual_home_goals:undefined,actual_away_goals:0},
    {actual_home_goals:'',actual_away_goals:0},
    {actual_home_goals:true,actual_away_goals:0},
    {actual_home_goals:-1,actual_away_goals:0},
    {actual_home_goals:1.5,actual_away_goals:0},
  ]){
    const state=eligibility(history,{status:'settled',...goals},now);
    assert.equal(state.eligible,false);
    assert.equal(state.reason,'not_settled');
  }
  assert.equal(eligibility(history,{status:'settled',actual_home_goals:0,actual_away_goals:0},now).eligible,true);
});

test('RC63 return does not coerce boolean, array or unsafe identifiers into Telegram recipients',()=>{
  const eligibility=createPostMatchReturnRuntime({}).postMatchReturnEligibility;
  const now=Date.parse('2026-10-08T12:00:00Z');
  const match={telegram_id:42,fixture_id:77,fixture_date:'2026-10-08T09:00:00Z'};
  const prediction={status:'settled',actual_home_goals:'2',actual_away_goals:'0'};
  for(const id of [true,false,[42],-1,0,1.5,'4e1','9007199254740992',{}]){
    assert.equal(eligibility({...match,telegram_id:id},prediction,now).reason,'identity');
    assert.equal(eligibility({...match,fixture_id:id},prediction,now).reason,'identity');
  }
  const valid=eligibility({...match,telegram_id:'042',fixture_id:'077'},prediction,now);
  assert.equal(valid.eligible,true);
  assert.equal(valid.userId,42);
  assert.equal(valid.fixtureId,77);
});

test('RC63 exact kickoff-age limits include the boundary but reject early and expired matches',()=>{
  const eligibility=createPostMatchReturnRuntime({}).postMatchReturnEligibility;
  const now=Date.parse('2026-10-08T12:00:00Z');
  const match={telegram_id:42,fixture_id:77};
  const prediction={status:'settled',actual_home_goals:1,actual_away_goals:0};
  const status=fixtureDate=>eligibility({...match,fixture_date:fixtureDate},prediction,now);
  assert.equal(status('2026-10-08T10:15:00Z').eligible,true);
  assert.equal(status('2026-10-08T10:15:01Z').reason,'too_early');
  assert.equal(status('2026-10-07T18:00:00Z').eligible,true);
  assert.equal(status('2026-10-07T17:59:59Z').reason,'too_old');
});

test('RC63 return filtering and prediction lookup reject invalid collection entries before downstream jobs',async()=>{
  const now=Date.parse('2026-10-08T12:00:00Z');
  let predictionQueries=0;
  const runtime=createPostMatchReturnRuntime({
    hasSupabase:()=>true,
    supaSelectPaged:async()=>({rows:[
      {telegram_id:true,fixture_id:77,fixture_date:'2026-10-08T09:00:00Z'},
      {telegram_id:42,fixture_id:'77',fixture_date:'2026-10-08T09:00:00Z'},
      null,
    ],truncated:false}),
    supaSelectMany:async()=>{predictionQueries++;return [];},
  });
  const result=await runtime.loadPostMatchReturnCandidates({},now);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].telegram_id,42);
  await runtime.loadPostMatchReturnPredictions([true,[],{},0],{});
  assert.equal(predictionQueries,0);
});
