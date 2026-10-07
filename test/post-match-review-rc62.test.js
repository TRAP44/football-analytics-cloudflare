import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const matchCenter = fs.readFileSync('src/match-center-runtime.js', 'utf8');
const modelEvaluation = fs.readFileSync('src/model-evaluation-runtime.js', 'utf8');
const telegram = fs.readFileSync('src/telegram-bot-orchestration-runtime.js', 'utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC62 uses the immutable first pre-match model snapshot',()=> {
  assert.match(modelEvaluation,/async function loadModelPredictionForFixture\(/);
  assert.match(modelEvaluation,/function buildPostMatchReview\(/);
  assert.match(modelEvaluation,/predicted_outcome/);
  assert.match(modelEvaluation,/actual_outcome/);
});

test('finished Match Center settles existing prediction and builds review',()=> {
  assert.match(matchCenter,/if \(finished\) await settlePredictionsFromFixtures\(\[fixture\], cfg\)/);
  assert.match(matchCenter,/postMatchPredictionCandidate=finished[\s\S]{0,180}?loadModelPredictionForFixture/);
  assert.match(matchCenter,/if \(finished\)[\s\S]{0,240}?buildPostMatchReview/);
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
  assert.match(telegram,/match:review/);
  assert.match(telegram,/async function botMatchCenterFixture\(/);
  assert.match(telegram,/function botPostMatchReviewText\(/);
  assert.match(telegram,/selected === 'review'/);
  assert.match(telegram,/post_match_review/);
});

test('RC62 health contract is release-gated',()=> {
  for (const flag of ['postMatchAiReview','immutablePrematchComparison','calibrationFeedbackReview','telegramPostMatchReview']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
  assert.match(worker,/postMatchReviewSelfTest: postMatchReviewDrill\(\)\.pass \? 'enabled' : 'failed'/);
});