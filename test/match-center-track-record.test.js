import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { matchCenterTrackRecordHtml } from '../public/modules/match-center-view.js';

const app=fs.readFileSync('public/app.js','utf8');
const view=fs.readFileSync('public/modules/match-center-view.js','utf8');
const escapeHtml=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

const record=(sample,extra={})=>({available:true,periodDays:180,sample,...extra});

test('track record strip shows only verified counters from the protocol payload',()=>{
  const html=matchCenterTrackRecordHtml({aiTrackRecordLoaded:true,aiTrackRecord:record({verified:42,matched:23,missed:19,state:'forming',label:'Выборка формируется'})},escapeHtml);
  assert.match(html,/Основной исход совпал в <strong>23<\/strong> из <strong>42<\/strong> проверенных матчей/);
  assert.match(html,/За 180 дней, только прогнозы, сделанные до матча/);
  assert.match(html,/Выборка формируется/);
  assert.match(html,/aria-label="Совпало 23, не совпало 19"/);
  assert.match(html,/data-center-track-record/);
  // Никакого «процента побед» и ставочных терминов.
  assert.doesNotMatch(html,/%|ставк|коэфф|прибыл|доход/i);
});

test('small samples are flagged and counters cannot exceed the verified total',()=>{
  const html=matchCenterTrackRecordHtml({aiTrackRecordLoaded:true,aiTrackRecord:record({verified:5,matched:9,missed:9,state:'early',label:'Малая выборка'})},escapeHtml);
  assert.match(html,/совпал в <strong>5<\/strong> из <strong>5<\/strong>/);
  assert.match(html,/aria-label="Совпало 5, не совпало 0"/);
  assert.match(html,/mr-ai-proof-sample early/);
  assert.match(html,/Выборка пока маленькая/);
});

test('missing, malformed or empty protocol never invents numbers',()=>{
  assert.equal(matchCenterTrackRecordHtml({aiTrackRecordLoaded:false,aiTrackRecord:null},escapeHtml),'');
  assert.equal(matchCenterTrackRecordHtml({},escapeHtml),'');
  const forming=matchCenterTrackRecordHtml({aiTrackRecordLoaded:true,aiTrackRecord:{available:false}},escapeHtml);
  assert.match(forming,/ещё формируется/);
  assert.doesNotMatch(forming,/<strong>\d/);
  const zero=matchCenterTrackRecordHtml({aiTrackRecordLoaded:true,aiTrackRecord:record({verified:0,matched:0,missed:0})},escapeHtml);
  assert.match(zero,/ещё нет матчей с подтверждённым итогом/);
  const junk=matchCenterTrackRecordHtml({aiTrackRecordLoaded:true,aiTrackRecord:record({verified:'abc',matched:-3,missed:1.5,label:'<img src=x onerror=alert(1)>'},{periodDays:-1})},escapeHtml);
  assert.match(junk,/ещё нет матчей/);
  assert.doesNotMatch(junk,/<img/);
  const escaped=matchCenterTrackRecordHtml({aiTrackRecordLoaded:true,aiTrackRecord:record({verified:3,matched:1,missed:2,label:'<b>x</b>'},{periodDays:'90'})},escapeHtml);
  assert.match(escaped,/&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(escaped,/За 90 дней/);
});

test('AI tab places the strip right after the verdict card and links to the full history',()=>{
  const center=block(view,'export function renderMatchCenterView','// end renderMatchCenterView');
  const card=center.indexOf('${aiCardBody}');
  const strip=center.indexOf('${matchCenterTrackRecordHtml(state, escapeHtml)}');
  const narrative=center.indexOf('${matchChangeNarrativeHtml(d, m)}');
  assert.ok(card>0 && strip>card && narrative>strip);
  assert.ok(strip<center.indexOf('data-center-panel="summary"'));
  assert.match(center,/\[data-center-track-record\]'\)\?\.addEventListener\('click', \(\) => \$\('navHistory'\)\?\.click\(\)\)/);
});

test('Match Center loads the public protocol lazily and rerenders when it arrives',()=>{
  const render=block(app,'function renderMatchCenter(d) {','\nasync function openMatchCenter');
  assert.match(render,/if \(!state\.aiTrackRecordLoaded && !state\.aiTrackRecordLoading && !state\.aiTrackRecordError\) void loadAiTrackRecord\(\);/);
  const load=block(app,'async function loadAiTrackRecord','\nlet aiTrackRecordRenderer');
  assert.match(load.slice(load.indexOf('finally')),/rerenderOpenMatchCenter\(\);/);
  assert.match(load,/\/api\/ai-track-record\?days=180/);
});
