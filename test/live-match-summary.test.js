import test from 'node:test';
import assert from 'node:assert/strict';
import {composeLiveMatchSummary} from '../src/live-match-summary.js';
import {createLiveMatchIntelligenceRuntime} from '../src/live-match-intelligence-runtime.js';
const runtime=createLiveMatchIntelligenceRuntime({numericValue:Number});
const fixture={score:{home:0,away:1},elapsed:60,status:'2H',homeName:'Chelsea',awayName:'Everton',statistics:{items:[{key:'expected_goals',home:1.8,away:.3},{key:'Total Shots',home:15,away:4},{key:'Shots on Goal',home:6,away:1}]},events:[{minute:55,type:'goal',side:'away'}]};
test('summary combines score mismatch, quantitative evidence and current events',()=>{
  const result=runtime.buildSmartMatchInsights(fixture);
  assert.equal(result.insights[0].type,'score_mismatch');
  assert.ok(result.summary.includes('Everton ведёт 0:1'));
  assert.ok(result.summary.includes('Chelsea создаёт более качественные моменты по xG: 1.80 — 0.30.'));
  assert.ok(result.summary.includes('Голы за последние 15 минут — 0:1.'));
  assert.notEqual(result.summary,result.insights[0].text);
  assert.equal(result.summary.includes('индексу давления'),false,'correlated attack signals are not repeated');
});
test('red card context survives and the same fixture gets a new assessment with new data',()=>{
  const before=runtime.buildSmartMatchInsights(fixture);
  const after=runtime.buildSmartMatchInsights({...fixture,score:{home:1,away:1},statistics:{items:[{key:'expected_goals',home:.2,away:2.1},{key:'Red Cards',home:1,away:0}]},events:[{minute:58,type:'goal',side:'home'}]});
  assert.notEqual(before.summary,after.summary);
  assert.ok(after.summary.includes('Everton'));
  assert.ok(after.summary.includes('0.20 — 2.10'));
  assert.ok(after.summary.includes('Chelsea играет в меньшинстве'));
  assert.equal(after.summary.includes('Chelsea создаёт более качественные'),false);
});
test('event-only output stays cautious; sparse payload invents no advantage or score',()=>{
  const events=runtime.buildSmartMatchInsights({elapsed:60,events:[{minute:55,type:'goal',side:'home'}],homeName:'Chelsea',awayName:'Everton'});
  assert.ok(events.summary.includes('Голы за последние 15 минут — 1:0.'));
  assert.ok(events.summary.includes('Убедительного преимущества по игре эти данные не подтверждают.'));
  const empty=runtime.buildSmartMatchInsights({elapsed:60});
  assert.equal(empty.available,false);
  assert.equal(empty.summary.includes('0:0'),false);
});
test('summary preserves proper names, limits facts and skips duplicate types/text',()=>{
  const summary=composeLiveMatchSummary([{type:'chance_quality',side:'home',text:'Chelsea создаёт моменты.'},{type:'pressure',text:'Повторное давление.'},{type:'possession',text:'Повторное владение.'},{type:'recent_phase',text:'Последний гол.'},{type:'recent_phase',text:'Последний гол.'},{type:'goalkeeper',text:'Вратарь спасает.'},{type:'player',text:'Лишний четвёртый факт.'}]);
  assert.equal(summary,'Chelsea создаёт моменты. Последний гол. Вратарь спасает.');
  assert.equal(composeLiveMatchSummary(null),'');
  assert.equal(composeLiveMatchSummary([{type:'player',text:''}]),'');
});


test('mismatch and red-card summaries also deduplicate correlated attack support',()=>{
  for(const type of ['score_mismatch','discipline']){
    const result=composeLiveMatchSummary([{type,side:'home',text:'Главный вывод.'},{type:'pressure',side:'home',text:'Давление по совокупности метрик.'},{type:'possession',side:'home',text:'Повторное владение.'},{type:'territory',side:'home',text:'Повторные угловые.'}]);
    assert.equal(result,'Главный вывод. Давление по совокупности метрик.');
  }
});
