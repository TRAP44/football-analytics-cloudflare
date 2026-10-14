import test from 'node:test';
import assert from 'node:assert/strict';
import {prematchLineupEvent,analysisIncludesLineupEvent,completedPrematchLineupRefresh} from '../src/prematch-lineup-event.js';

const now=Date.parse('2026-10-14T12:00:00Z');
const match={fixtureId:77,homeId:40,awayId:50,kickoff:now+60*60000};
const snapshot=()=>({fixtureId:77,feature:'lineups',provider:'api-football',fetchedAt:new Date(now).toISOString(),
  data:[40,50].map((teamId,side)=>({team:{id:teamId},formation:'4-3-3',
    startXI:Array.from({length:11},(_,i)=>({player:{id:1000+side*100+i,name:`P${side}-${i}`}})),substitutes:[]}))});

test('lineup event accepts two confirmed distinct teams and ignores row/player order',()=>{
  const value=snapshot();
  const event=prematchLineupEvent(value,match,now);
  assert.ok(event);
  value.data.reverse();value.data[0].startXI.reverse();
  assert.equal(prematchLineupEvent(value,match,now).fingerprint,event.fingerprint);
});
test('lineup event rejects partial, duplicate, overlapping and foreign XIs',()=>{
  const mutations=[value=>value.data.pop(),value=>value.data[0].startXI.pop(),
    value=>value.data[0].startXI[1]=value.data[0].startXI[0],
    value=>value.data[1].startXI[0]=value.data[0].startXI[0],
    value=>value.data[1].team.id=999,
    value=>value.data[0].substitutes=Array(41).fill({player:{id:9999}}),
    value=>value.data[0].startXI.push({player:{id:9999}}),
    value=>value.data[0].startXI[0].player.id=true];
  for(const mutate of mutations){const value=snapshot();mutate(value);assert.equal(prematchLineupEvent(value,match,now),null);}
});
test('lineup event requires current authoritative source and a real pre-start window',()=>{
  for(const extra of [{fixtureId:78},{feature:'other'},{provider:'other'},{stale:true},{fetchedAt:'bad'},
    {fetchedAt:new Date(now-301000).toISOString()},{fetchedAt:new Date(now+1000).toISOString()}]) {
    assert.equal(prematchLineupEvent({...snapshot(),...extra},match,now),null);
  }
  for(const extra of [{live:true},{finished:true},{status:'FT'},{kickoff:now+19*60000},{kickoff:now+91*60000},{awayId:40}]) {
    assert.equal(prematchLineupEvent(snapshot(),{...match,...extra},now),null);
  }
});
test('an existing analysis only consumes the event with the matching trusted roster',()=>{
  const source=snapshot(),event=prematchLineupEvent(source,match,now);
  const analysis={match:{fixtureId:77,home:{id:40},away:{id:50}},
    lineups:Object.fromEntries(source.data.map((row,i)=>[i?'away':'home',{formation:row.formation,startXI:row.startXI.map(x=>x.player),substitutes:[]}])),
    dataProvenance:{features:{lineups:{confidenceBearing:true}}}};
  assert.equal(analysisIncludesLineupEvent(analysis,event),true);
  analysis.dataProvenance.features.lineups.stale=true;
  assert.equal(analysisIncludesLineupEvent(analysis,event),false);
  analysis.dataProvenance.features.lineups.stale=false;analysis.lineups.home.startXI.pop();
  assert.equal(analysisIncludesLineupEvent(analysis,event),false);
  assert.equal(completedPrematchLineupRefresh({fixtureId:77,phase:'lineups',fingerprint:event.fingerprint,computedAt:new Date(now).toISOString()},77),true);
  assert.equal(completedPrematchLineupRefresh({fixtureId:77,phase:'lineups',fingerprint:event.fingerprint,computedAt:'bad'},77),false);
});
