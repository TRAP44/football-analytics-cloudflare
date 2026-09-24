import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const styles=fs.readFileSync('public/styles.css','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');

test('RC131 adds one at-a-glance cockpit without making new data requests',()=>{
  assert.match(app,/function matchCockpitHtml\(d = \{\}\)/);
  assert.match(app,/МАТЧ ЗА 15 СЕКУНД/);
  assert.match(app,/Текущая форма/);
  assert.match(app,/Дома \/ в гостях/);
  assert.match(app,/Положение в таблице/);
  assert.match(app,/Потери состава/);
  assert.match(app,/Стартовые составы/);
  assert.match(app,/Очные встречи/);
  assert.match(app,/Коэффициенты П1 \/ Н \/ П2/);
  assert.match(app,/Качество оценки/);
  const start=app.indexOf('function matchCockpitHtml');
  const end=app.indexOf('function renderAnalysis',start);
  const cockpit=app.slice(start,end);
  assert.doesNotMatch(cockpit,/\bapi\s*\(/);
  assert.doesNotMatch(cockpit,/fetch\s*\(/);
});

test('RC131 never turns unavailable injury data into a false zero-loss claim',()=>{
  assert.match(app,/const injuryConfirmed=Boolean\(injuriesMeta\.available\)/);
  assert.match(app,/injuryConfirmed[\s\S]{0,180}'Не подтверждены'/);
  assert.match(app,/пустой ответ — это не означает «потерь нет»/);
  assert.match(app,/Данные о потерях сейчас не подтверждены/);
});

test('RC131 reuses existing normalized comparison, lineup, H2H and market data',()=>{
  assert.match(app,/const tableMetric=metric\('table_rank'\)/);
  assert.match(app,/const venueMetric=metric\('venue_ppg'\)/);
  assert.match(app,/d\.lineupImpact\?\.homeConfirmed/);
  assert.match(app,/const h2h=d\.h2h \|\| \{\}/);
  assert.match(app,/const market=d\.market \|\| null/);
  assert.match(app,/d\.dataProvenance\?\.features\?\.odds\?\.provider/);
});

test('RC131 cockpit cards navigate to the detailed tabs instead of duplicating screens',()=>{
  assert.match(app,/data-cockpit-tab=/);
  assert.match(app,/querySelectorAll\('\[data-cockpit-tab\]'\)/);
  assert.match(app,/setAnalysisTab\(btn\.dataset\.cockpitTab \|\| 'overview', true\)/);
});

test('RC131 cockpit is responsive and uses the existing visual tokens',()=>{
  assert.match(styles,/\.match-cockpit-grid\{display:grid/);
  assert.match(styles,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles,/@media \(max-width:560px\)[\s\S]*\.match-cockpit-grid\{grid-template-columns:1fr\}/);
  assert.match(styles,/var\(--accent\)/);
  assert.match(styles,/var\(--line\)/);
});

test('RC131 is part of the release health contract',()=>{
  assert.match(worker,/matchAtAGlanceCockpit: 'enabled'/);
  assert.match(worker,/const APP_VERSION = '6\.107\.0-rc131'/);
  assert.match(worker,/const RC_NAME = 'RC131'/);
});
