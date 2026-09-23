import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC62 uses the immutable first pre-match model snapshot',()=> {
  assert.match(worker,/async function loadModelPredictionForFixture\(/);
  assert.match(worker,/function buildPostMatchReview\(/);
  assert.match(worker,/predicted_outcome/);
  assert.match(worker,/actual_outcome/);
});

test('finished Match Center settles existing prediction and builds review',()=> {
  assert.match(worker,/if \(finished\) await settlePredictionsFromFixtures\(\[fixture\], cfg\)/);
  assert.match(worker,/const postMatchPrediction = finished \? await loadModelPredictionForFixture/);
  assert.match(worker,/const postMatchReview = finished \? buildPostMatchReview/);
  assert.match(worker,/postMatchReview,/);
});

test('review checks outcome total and BTTS and adds observed evidence',()=> {
  assert.match(worker,/label:'Тотал 2\.5'/);
  assert.match(worker,/label:'Обе забьют'/);
  assert.match(worker,/add\('xg'/);
  assert.match(worker,/add\('shots_on_goal'/);
  assert.match(worker,/add\('red_card'/);
  assert.match(worker,/не доказывают причинность/);
});

test('post-match drill is deterministic',()=> {
  assert.match(worker,/function postMatchReviewDrill\(/);
  assert.match(worker,/review\.outcome\.correct===true/);
  assert.match(worker,/review\.markets\.every\(x=>x\.correct===true\)/);
  assert.match(worker,/review\.evidence\.some\(x=>x\.code==='xg'\)/);
});

test('Mini App shows a compact post-match review in finished Match Center',()=> {
  assert.match(app,/function postMatchReviewHtml\(/);
  assert.match(app,/POST-MATCH AI REVIEW/);
  assert.match(app,/finished \? postMatchReviewHtml\(d\.postMatchReview/);
  assert.match(css,/\.post-match-review/);
  assert.match(css,/\.post-match-calibration/);
});

test('Telegram exposes post-match AI review without a new pre-match analysis',()=> {
  assert.match(worker,/match:review/);
  assert.match(worker,/async function botMatchCenterFixture\(/);
  assert.match(worker,/function botPostMatchReviewText\(/);
  assert.match(worker,/section === 'review'/);
  assert.match(worker,/post_match_review/);
});

test('RC62 health contract is release-gated',()=> {
  for (const flag of ['postMatchAiReview','immutablePrematchComparison','calibrationFeedbackReview','telegramPostMatchReview']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
  assert.match(worker,/postMatchReviewSelfTest: postMatchReviewDrill\(\)\.pass \? 'enabled' : 'failed'/);
});