import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveMatchHeadquarters,renderMatchHeadquarters} from '../public/modules/match-headquarters.js';
const verified={confidenceBearing:true,stale:false,provenanceState:'verified'};
function live(){return {mode:'live',match:{status:'2H'},generatedAt:'2026-10-10T12:30:00Z',
 availability:{events:true,statistics:true,lineups:true,lineupsConfirmed:true},
 dataFreshness:{events:verified,statistics:verified,lineups:verified},
 events:[{minute:65,label:'Гол'}],statistics:{items:[{key:'Shots on Goal',home:0,away:3}]}};}
test('headquarters follows preparation, live and final phases',()=>{
 for(const [mode,phase] of ['upcoming','live','finished'].entries()) {
  const name=['upcoming','live','finished'][mode];
  assert.equal(deriveMatchHeadquarters({mode:name}).phase,mode);
  assert.equal((renderMatchHeadquarters({mode:name}).match(/aria-current="step"/g)||[]).length,1);
 }
 assert.equal(deriveMatchHeadquarters({mode:'unexpected'}).phase,-1);
});
test('headquarters uses verified events, numeric zero and confirmed lineups',()=>{
 const model=deriveMatchHeadquarters(live());
 assert.deepEqual(model.cards.map(card=>card.value),['65′ · Гол','0 — 3','Оба состава подтверждены']);
});
test('headquarters excludes stale or unverified facts and malformed metrics',()=>{
 const data=live();data.dataFreshness={events:{...verified,stale:true},statistics:verified,lineups:{...verified,provenanceState:'unknown'}};
 data.statistics.items[0].home=true;
 const model=deriveMatchHeadquarters(data);
 assert.equal(model.stale,true);
 assert.deepEqual(model.cards.map(card=>card.value),['Нет подтверждённых событий','Нет подтверждённой статистики','Нет подтверждённых составов']);
});
test('cancelled or postponed matches do not claim a normal current stage',()=>{
 const model=deriveMatchHeadquarters({mode:'upcoming',match:{status:'CANC'}});
 assert.equal(model.title,'Матч отменён');assert.equal(model.phase,-1);
 assert.equal(model.cards[0].value,'Матч отменён');
 assert.equal(deriveMatchHeadquarters({match:{status:'toString'}}).interruption,'');
});
test('headquarters escapes provider content and handles missing timestamp',()=>{
 const data=live();data.events[0].label='<img src=x onerror=alert(1)>';
 const html=renderMatchHeadquarters(data);
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
 assert.ok(renderMatchHeadquarters(null).includes('Время формирования сводки неизвестно'));
 assert.equal(deriveMatchHeadquarters({generatedAt:'invalid'}).generatedAt,null);
});
