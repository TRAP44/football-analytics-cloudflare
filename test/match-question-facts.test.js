import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMatchQuestionFacts,directMatchQuestionTopic} from '../src/match-question-facts.js';
import {buildMatchQuestionPresets} from '../src/match-question-presets.js';

const match={fixtureId:7,home:{name:'Chelsea'},away:{name:'Everton'},referee:'A. Ref',venue:'Stamford Bridge',city:'London'};
const form={overall:{sample:5,wins:2,draws:1,losses:2}};
test('questions include ordinary facts even without a probability lead or a strong form signal',()=>{
  const facts=buildMatchQuestionFacts({match,recentForm:{home:form,away:form},absences:{home:[{name:'Palmer'}],away:[{player:{name:'Pickford'}}]}});
  for(const id of ['referee','venue','form_home','form_away','absences_home','absences_away'])assert.ok(facts.some(f=>f.id===id),id);
  assert.match(facts.find(f=>f.id==='absences_home').text,/Palmer/);
  assert.equal(buildMatchQuestionFacts({match,recentForm:{home:{overall:{sample:5,wins:9,draws:0,losses:0}}}}).some(f=>f.id==='form_home'),false);
  assert.equal(buildMatchQuestionFacts({match:{...match,referee:'unknown'}}).some(f=>f.id==='referee'),false);
  assert.equal(buildMatchQuestionFacts({match,absences:{home:[]}}).some(f=>f.id==='absences_home'),false,'unknown empty absences never mean no injuries');
});
test('preset form compares both ordinary records and why omits quality counters',()=>{
  const result=buildMatchQuestionPresets({match,probabilities:{home:50,draw:25,away:25},confidence:{score:80},recentForm:{home:form,away:form}});
  assert.equal(result.presets.form.items.length,2);
  assert.ok(result.presets.form.items.every(item=>/побед — 2/.test(item.text)));
  assert.doesNotMatch(result.presets.why.items.map(item=>item.text).join(' '),/из 100|блоков/);
});
test('direct intent is narrow and never mistakes broadcast or compound questions for a venue/name lookup',()=>{
  for(const q of ['Кто главный судья ?', 'Как зовут арбитра?', 'Кто будет судить матч?', 'Главный судья?'])assert.equal(directMatchQuestionTopic(q),'referee',q);
  for(const q of ['Где проходит матч?', 'На каком стадионе играют?'])assert.equal(directMatchQuestionTopic(q),'venue',q);
  for(const q of ['Где смотреть трансляцию?', 'Кто судья и кто в форме?', 'Насколько строгий судья?', 'Какой стиль у судьи?', 'Кто боковой судья?', 'Кто заменил главного судью?'])assert.equal(directMatchQuestionTopic(q),null,q);
});

test('risk preset excludes neutral referee, venue and average form facts',()=>{
  const result=buildMatchQuestionPresets({match,recentForm:{home:form,away:form}});
  assert.ok(result.presets.risk.items.every(item=>!['referee','venue','form_home','form_away'].includes(item.id)));
  const sparse=buildMatchQuestionPresets({match:{...match,status:'FT'}});
  assert.equal(sparse.presets.risk.answer,'not_in_data');
});
