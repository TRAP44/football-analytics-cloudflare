import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveFormIntelligence,renderFormIntelligence} from '../public/modules/form-intelligence.js';

const payload=()=>({
  match:{home:{name:'Ливерпуль'},away:{name:'Арсенал'}},
  recentForm:{
    home:{overall:{sample:5,ppg:2.4},venue:{sample:4,ppg:2.75}},
    away:{overall:{sample:5,ppg:1.6},venue:{sample:4,ppg:1.25}},
  },
});

test('Intelligence 2.0 form displays observed sample counts and separate venue sample',()=>{
  const model=deriveFormIntelligence(payload());
  assert.deepEqual(model.overall,{home:2.4,away:1.6,homeSample:5,awaySample:5,delta:0.8});
  assert.deepEqual(model.venue,{home:2.75,away:1.25,homeSample:4,awaySample:4,delta:1.5});
  const html=renderFormIntelligence(payload());
  assert.match(html,/ФОРМА КОМАНД/);
  assert.match(html,/Общая форма/);
  assert.match(html,/Хозяева дома \/ гости на выезде/);
  assert.match(html,/2\.40/);
  assert.match(html,/1\.60/);
  assert.match(html,/Матчей в выборке: 5/);
  assert.match(html,/Матчей в выборке: 4/);
  assert.match(html,/width:80\.00%/);
  assert.match(html,/width:53\.33%/);
  assert.match(html,/Это не вероятность победы/);
});

test('Intelligence 2.0 form refuses invented samples, out-of-range PPG and stale analyses',()=>{
  assert.equal(renderFormIntelligence({}),'');
  const stale={...payload(),stale:true};
  assert.equal(deriveFormIntelligence(stale),null);
  assert.equal(renderFormIntelligence(stale),'');
  const low=payload();
  low.recentForm.home.overall.sample=2;
  assert.equal(renderFormIntelligence(low),'');
  const invalid=payload();
  invalid.recentForm.home.overall.ppg=3.4;
  assert.equal(renderFormIntelligence(invalid),'');
  const coerced=payload();
  coerced.recentForm.home.overall.sample='abc';
  assert.equal(renderFormIntelligence(coerced),'');
});

test('missing venue does not suppress honest overall comparison',()=>{
  const data=payload();
  data.recentForm.away.venue.sample=1;
  const html=renderFormIntelligence(data);
  assert.match(html,/Общая форма/);
  assert.doesNotMatch(html,/form-intel-pair-title"><strong>Хозяева дома/);
  assert.match(html,/Для сравнения дома и в гостях пока недостаточно матчей/);
});

test('all team names are HTML escaped and layout wired after analysis hero',()=>{
  const data=payload();
  data.match.home.name='<script>alert(1)</script>';
  const html=renderFormIntelligence(data);
  assert.equal(html.includes('<script>'),false);
  assert.match(html,/&lt;script&gt;/);
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/styles/public-shell.css',import.meta.url),'utf8');
  assert.match(app,/import \{ renderFormIntelligence \} from '\.\/modules\/form-intelligence\.js'/);
  assert.match(app,/renderFormIntelligence\(d\)/);
  assert.match(css,/\.form-intel-panel/);
  assert.match(css,/@media\(max-width:360px\)/);
});
