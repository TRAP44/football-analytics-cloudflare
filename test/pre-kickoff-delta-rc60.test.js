import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');
const playbook=fs.readFileSync('PRE_KICKOFF_DELTA_RC60.md','utf8');

test('RC60 builds a deterministic delta between old and refreshed analysis',()=> {
  assert.match(worker,/function analysisRecheckDelta\(/);
  assert.match(worker,/AI-сигнал изменился/);
  assert.match(worker,/Math\.abs\(maxProb\.delta\)>=3/);
  assert.match(worker,/Math\.abs\(maxMarket\.delta\)>=2\.5/);
  assert.match(worker,/Появились стартовые составы/);
  assert.match(worker,/Назначен судья/);
});

test('materiality and stable states are explicit',()=> {
  assert.match(worker,/const material=items\.some\(x=>x\.importance==='high'\)/);
  assert.match(worker,/const stable=items\.length===0/);
  assert.match(worker,/Значимых изменений после перепроверки не найдено/);
  assert.match(worker,/После перепроверки есть значимые изменения/);
});

test('delta drill covers signal probability lineups and market',()=> {
  assert.match(worker,/function analysisDeltaDrill\(/);
  assert.match(worker,/betSignal:\{code:'skip',label:'Пропустить ставку'\}/);
  assert.match(worker,/betSignal:\{code:'home',label:'П1'\}/);
  for (const code of ['signal','probability','lineups','market']) assert.match(worker,new RegExp(`delta\\.codes\\.includes\\('${code}'\\)`));
});

test('recheck response and analytics expose delta without query text',()=> {
  assert.match(worker,/const recheckDelta=needsFreshnessRecheck \? analysisRecheckDelta\(staleBefore,payload\) : null/);
  assert.match(worker,/delta:recheckDelta/);
  const event=/eventName:'analysis_recheck'.*metadata:\{free:freeRecheck,reason:previousFreshness\?\.reasonCode \|\| 'age_window',material:Boolean\(recheckDelta\?\.material\),stable:Boolean\(recheckDelta\?\.stable\),changeCount:Number\(recheckDelta\?\.items\?\.length \|\| 0\),codes:\(recheckDelta\?\.codes \|\| \[\]\)\.slice\(0,6\)\}/s;
  assert.match(worker,event);
  assert.doesNotMatch(event.source,/query|rawText/);
});

test('Telegram and Mini App explain what changed after recheck',()=> {
  assert.match(worker,/Что изменилось после перепроверки/);
  assert.match(worker,/\(delta\.items \|\| \[\]\)\.slice\(0,3\)/);
  assert.match(app,/class=\"analysis-delta/);
  assert.match(app,/Прогноз стабилен/);
  assert.match(app,/item\.before && item\.after/);
  assert.match(css,/\.analysis-delta\.material/);
});

test('launch funnel separates material and stable rechecks',()=> {
  assert.match(worker,/const recheckMaterial=recheckRows\.filter/);
  assert.match(worker,/const recheckStable=recheckRows\.filter/);
  assert.match(worker,/material:recheckMaterial,stable:recheckStable/);
  assert.match(app,/rechecks\.material/);
  assert.match(app,/rechecks\.stable/);
});

test('RC60 release gate exposes delta contracts',()=> {
  for (const flag of ['preKickoffChangeDetection','analysisDeltaSummary','recheckMateriality','telegramRecheckDelta']) {
    assert.ok(worker.includes(`${flag}: 'enabled'`), `missing ${flag}`);
  }
  assert.match(worker,/analysisDeltaSelfTest: analysisDeltaDrill\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(playbook,/material \/ stable/);
});