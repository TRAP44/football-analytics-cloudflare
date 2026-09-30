import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/router.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const aiTrackRecordRenderer=fs.readFileSync('public/modules/ai-track-record-renderer.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC64 exposes a non-admin public track-record endpoint',()=> {
  assert.match(worker,/async function apiAiTrackRecord\(/);
  assert.match(worker,/url\.pathname === '\/api\/ai-track-record'/);
  assert.doesNotMatch(worker,/url\.pathname === '\/api\/ai-track-record'[\s\S]{0,120}adminForbidden/);
});

test('track record uses only verified immutable model rows',()=> {
  assert.match(worker,/function buildPublicAiTrackRecord\(/);
  assert.match(worker,/verifiedSettledRows\(settledRows,pendingRows\)/);
  assert.match(worker,/immutablePrematch:true/);
  assert.match(worker,/verifiedOnly:true/);
});

test('public trust UX reports counts and Brier without a win-rate metric',()=> {
  assert.match(worker,/matched,/);
  assert.match(worker,/missed,/);
  assert.match(worker,/avgBrier/);
  assert.match(worker,/profitabilityMetric:false/);
  assert.match(worker,/не равно доходности ставки/);
  assert.match(aiTrackRecordRenderer,/Здесь нет рекламного «процента побед»/);
  assert.doesNotMatch(app,/Винрейт/);
});

test('small samples are explicitly labeled',()=> {
  assert.match(worker,/if \(n<20\) return \{code:'early',label:'Малая выборка'/);
  assert.match(worker,/if \(n<50\) return \{code:'forming',label:'Выборка формируется'/);
  assert.match(worker,/code:'informative'/);
});

test('History view separates global model record from personal history',()=> {
  assert.match(html,/id="aiTrackRecord"/);
  assert.match(html,/Ваши анализы/);
  assert.match(aiTrackRecordRenderer,/function renderAiTrackRecord\(/);
  assert.match(app,/\/api\/ai-track-record\?days=180/);
  assert.match(css,/\.ai-track-card/);
});

test('Telegram exposes Protocol AI and links back to History',()=> {
  assert.match(worker,/📈 Протокол AI/);
  assert.match(worker,/function botAiTrackRecordText\(/);
  assert.match(worker,/async function sendBotAiTrackRecord\(/);
  assert.match(worker,/\/track/);
  assert.match(worker,/view:'history'/);
});

test('RC64 deterministic self-test and health contract are present',()=> {
  assert.match(worker,/function publicAiTrackRecordDrill\(/);
  assert.match(worker,/aiTrackRecordSelfTest: publicAiTrackRecordDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['publicAiTrackRecord','verifiedTrackRecordOnly','smallSampleTrustGuard','noWinRateTrustUx','telegramAiTrackRecord']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});