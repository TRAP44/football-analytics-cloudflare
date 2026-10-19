import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createLiveMatchIntelligenceRuntime} from '../src/live-match-intelligence-runtime.js';
const app=fs.readFileSync('public/app.js','utf8');
const code=app.slice(app.indexOf('function smartInsightsHeroHtml('),app.indexOf('function smartInsightsFullHtml('));
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const render=vm.runInNewContext(code+';smartInsightsHeroHtml',{publicText:value=>String(value),escapeHtml:esc});
const signal={available:true,headline:'Последние 15 минут',summary:'Голы за последние 15 минут — 1:1.',dataScore:14,dataLabel:'Базовое покрытие',insights:[{side:'balanced',importance:'medium',icon:'⏱️'}]};
test('balanced screenshot keeps facts without coverage percentage, generic focus or importance badge',()=>{
  const html=render(signal,{});
  assert.ok(html.includes('AI-анализ матча'));
  assert.ok(html.includes('Голы за последние 15 минут — 1:1.'));
  for(const token of ['14%','Базовое покрытие','smart-story-focus','smart-story-team','Заметный сигнал','⏱️'])assert.equal(html.includes(token),false,token);
});
test('named team is shown only for a concrete side and all content is escaped',()=>{
  for(const side of ['home','away']){
    const html=render({...signal,headline:'<title>',summary:'<summary>',insights:[{side}]},{[side]:{name:'Club <name>'}});
    assert.ok(html.includes('smart-story-team'));
    assert.ok(html.includes('Club &lt;name&gt;'));
    assert.ok(html.includes('&lt;title&gt;'));
    assert.ok(html.includes('&lt;summary&gt;'));
  }
  for(const side of ['balanced','neutral','home'])assert.equal(render({...signal,insights:[{side}]},{}).includes('smart-story-team'),false);
  assert.equal(render({...signal,available:false},{}),'');
  assert.equal(render({...signal,summary:''},{}),'');
});
test('last15 goal text describes the window in home-away order, not total score or activity',()=>{
  const runtime=createLiveMatchIntelligenceRuntime({numericValue:Number});
  const result=runtime.recentEventSummary([{minute:10,type:'goal',side:'home'},{minute:52,type:'goal',side:'home'},{minute:55,type:'goal',side:'away'},{minute:58,type:'goal',detail:'Missed Penalty',side:'home'}],60,'Home','Away');
  assert.equal(result.leader,'balanced');
  assert.equal(result.text,'Голы за последние 15 минут — 1:1.');
  const away=runtime.recentEventSummary([{minute:55,type:'goal',side:'away'}],60,'Home','Away');
  assert.equal(away.text,'Голы за последние 15 минут — 0:1.');
});
