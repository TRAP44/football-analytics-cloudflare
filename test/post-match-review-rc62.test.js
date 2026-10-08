import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createModelEvaluationRuntime } from '../src/model-evaluation-runtime.js';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const matchCenter = fs.readFileSync('src/match-center-runtime.js', 'utf8');
const modelEvaluation = fs.readFileSync('src/model-evaluation-runtime.js', 'utf8');
const telegram = fs.readFileSync('src/telegram-bot-orchestration-runtime.js', 'utf8');
const telegramUpdates = fs.readFileSync('src/telegram-update-orchestration.js', 'utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC62 uses the immutable first pre-match model snapshot',()=> {
  assert.match(modelEvaluation,/async function loadModelPredictionForFixture\(/);
  assert.match(modelEvaluation,/function buildPostMatchReview\(/);
  assert.match(modelEvaluation,/predicted_outcome/);
  assert.match(modelEvaluation,/actual_outcome/);
});

test('finished Match Center settles existing prediction and builds review',()=> {
  assert.match(matchCenter,/if \(finished\) \{[\s\S]{0,120}?optionalAsync\(settlePredictionsFromFixtures,\[fixture\],cfg\)/);
  assert.match(matchCenter,/postMatchPredictionCandidate=finished[\s\S]{0,260}?loadModelPredictionForFixture/);
  assert.match(matchCenter,/if \(finished\) \{[\s\S]{0,420}?buildPostMatchReview/);
  assert.match(matchCenter,/postMatchReview,/);
});

test('review checks outcome total and BTTS and adds observed evidence',()=> {
  assert.match(modelEvaluation,/label:'Тотал 2\.5'/);
  assert.match(modelEvaluation,/label:'Обе забьют'/);
  assert.match(modelEvaluation,/add\('xg'/);
  assert.match(modelEvaluation,/add\('shots_on_goal'/);
  assert.match(modelEvaluation,/add\('red_card'/);
  assert.match(modelEvaluation,/не доказывают причинность/);
});

test('post-match drill is deterministic',()=> {
  assert.match(modelEvaluation,/function postMatchReviewDrill\(/);
  assert.match(modelEvaluation,/review\.outcome\.correct===true/);
  assert.match(modelEvaluation,/review\.markets\.every\(x=>x\.correct===true\)/);
  assert.match(modelEvaluation,/review\.evidence\.some\(x=>x\.code==='xg'\)/);
});

test('Mini App shows a compact post-match review in finished Match Center',()=> {
  assert.match(app,/function postMatchReviewHtml\(/);
  assert.match(app,/POST-MATCH AI REVIEW/);
  assert.match(app,/finished \? postMatchReviewHtml\(d\.postMatchReview/);
  assert.match(css,/\.post-match-review/);
  assert.match(css,/\.post-match-calibration/);
});

test('Telegram exposes post-match AI review without a new pre-match analysis',()=> {
  assert.match(telegramUpdates,/match:\(menu\|verdict\|referee\|squads\|market\|refresh\|review\)/);
  assert.match(telegram,/async function botMatchCenterFixture\(/);
  assert.match(telegram,/function botPostMatchReviewText\(/);
  assert.match(telegram,/selected === 'review'/);
  assert.match(telegram,/post_match_review/);
});

test('RC62 review contract remains wired through the current modular runtime',()=> {
  assert.match(worker,/function buildPostMatchReview\(\.\.\.args\) \{ return getModelEvaluationRuntime\(\)\.buildPostMatchReview\(\.\.\.args\); \}/);
  assert.match(worker,/function postMatchReviewDrill\(\.\.\.args\) \{ return getModelEvaluationRuntime\(\)\.postMatchReviewDrill\(\.\.\.args\); \}/);
  assert.match(matchCenter,/buildPostMatchReview/);
  assert.match(telegram,/botPostMatchReviewText/);
  assert.match(worker,/const APP_VERSION = '6\.120\.0-rc144'/);
});


function reviewHarness(){
  const create=createModelEvaluationRuntime({
    regulationScore:()=>null,
    actualOutcomeFromGoals:(home,away)=>home>away?'home':home<away?'away':'draw',
    hasSupabase:()=>false,
    memory:{modelPredictions:new Map()},
  });
  const prediction={fixture_id:7,predicted_outcome:'home',home_prob:55,
    actual_home_goals:null,actual_away_goals:null,
    over25_prob:null,btts_prob:null,brier_score:null,confidence_score:null};
  return {create,prediction};
}

test('RC62 never fabricates a nil-nil result from missing settled goals',()=>{
  const {create,prediction}=reviewHarness();
  const review=create.buildPostMatchReview({prediction,fixture:null});
  assert.equal(review.available,false);
  assert.equal(review.state,'awaiting_result');
  assert.match(review.summary,/итог матча ещё не подтверждён/);
});

test('RC62 uses legitimate zero goals but rejects coerced booleans or negative scores',()=>{
  const {create,prediction}=reviewHarness();
  const valid=create.buildPostMatchReview({prediction:{...prediction,actual_home_goals:0,actual_away_goals:'0'},fixture:null});
  assert.equal(valid.available,true);
  assert.deepEqual(valid.score,{home:0,away:0});
  for(const goals of [
    {actual_home_goals:true,actual_away_goals:0},
    {actual_home_goals:'',actual_away_goals:0},
    {actual_home_goals:-1,actual_away_goals:0},
    {actual_home_goals:1.5,actual_away_goals:0},
  ]){
    const result=create.buildPostMatchReview({prediction:{...prediction,...goals},fixture:null});
    assert.equal(result.state,'awaiting_result');
  }
});

test('RC62 never invents market predictions or Brier/confidence metrics when absent',()=>{
  const {create,prediction}=reviewHarness();
  const review=create.buildPostMatchReview({
    prediction:{...prediction,actual_home_goals:1,actual_away_goals:0},
    fixture:null,
  });
  assert.equal(review.available,true);
  assert.equal(review.markets.length,0);
  assert.equal(review.quality.brier,null);
  assert.equal(review.quality.confidence,null);
  assert.equal(review.outcome.correct,true);
});

test('RC62 keeps genuine zero probabilities and quality metrics rather than dropping them',()=>{
  const {create,prediction}=reviewHarness();
  const result=create.buildPostMatchReview({
    prediction:{...prediction,actual_home_goals:1,actual_away_goals:0,
      over25_prob:0,btts_prob:0,brier_score:0,confidence_score:0},
    fixture:null,
  });
  assert.equal(result.markets.length,2);
  assert.equal(result.markets[0].probability,0);
  assert.equal(result.markets[1].probability,0);
  assert.equal(result.quality.brier,0);
  assert.equal(result.quality.confidence,0);
});
