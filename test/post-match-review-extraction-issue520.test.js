import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostMatchReviewRuntime } from '../src/post-match-review.js';

const regulationScore=fixture=>fixture?.score?.fulltime || null;
const actualOutcomeFromGoals=(home,away)=>home>away?'home':away>home?'away':'draw';
const {buildPostMatchReview,postMatchReviewDrill}=createPostMatchReviewRuntime({
  regulationScore,
  actualOutcomeFromGoals,
});

test('post-match review returns no_snapshot without immutable prediction',()=>{
  const review=buildPostMatchReview({
    prediction:null,
    fixture:{score:{fulltime:{home:1,away:0}}},
    statistics:{items:[]},
    events:[],
    homeName:'Home',
    awayName:'Away',
  });
  assert.equal(review.available,false);
  assert.equal(review.state,'no_snapshot');
  assert.deepEqual(review.markets,[]);
  assert.equal(review.calibration.included,false);
});

test('post-match review builds reviewed outcome, markets and evidence',()=>{
  const review=buildPostMatchReview({
    prediction:{
      fixture_id:7,
      status:'settled',
      predicted_outcome:'home',
      home_prob:56,
      draw_prob:25,
      away_prob:19,
      brier_score:0.1114,
      over25_prob:62,
      btts_prob:55,
      confidence_score:71,
      completeness_score:8,
      completeness_max:10,
      settlement_verification_state:'confirmed',
    },
    fixture:{score:{fulltime:{home:2,away:1}}},
    statistics:{items:[
      {key:'expected_goals',home:1.9,away:0.8},
      {key:'Shots on Goal',home:6,away:2},
    ]},
    events:[{type:'Goal',minute:12}],
    homeName:'Home',
    awayName:'Away',
  });

  assert.equal(review.available,true);
  assert.equal(review.state,'reviewed');
  assert.equal(review.outcome.correct,true);
  assert.equal(review.outcome.predictedLabel,'П1');
  assert.equal(review.outcome.actualLabel,'П1');
  assert.equal(review.quality.brier,0.111);
  assert.equal(review.quality.completeness,80);
  assert.equal(review.calibration.included,true);
  assert.equal(review.markets.length,2);
  assert.equal(review.markets.every(item=>item.correct===true),true);
  assert.equal(review.evidence.some(item=>item.code==='xg'),true);
});

test('post-match review drill stays green after extraction',()=>{
  assert.deepEqual(postMatchReviewDrill(),{pass:true,cases:4});
});
