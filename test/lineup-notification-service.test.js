import test from 'node:test';
import assert from 'node:assert/strict';
import { createLineupNotificationService } from '../src/lineup-notification-service.js';

function row(userId, fixtureId, minutes = 45) {
  return {
    telegram_id:userId,
    fixture_id:fixtureId,
    home_name:'Home',
    away_name:'Away',
    league_name:'League',
    fixture_date:new Date(Date.now() + minutes * 60_000).toISOString(),
    enabled:true,
    lineup_notified_at:null,
  };
}

function runtime({ rows = [], snapshots = {}, maxFixturesPerRun = 4 } = {}) {
  const probes=[];
  const deliveries=[];
  const events=[];
  const service=createLineupNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
    supaSelectPaged:async()=>({rows,truncated:false}),
    loadLineupSnapshot:async(fixtureId)=>{
      probes.push(fixtureId);
      return snapshots[fixtureId] || {confirmed:false};
    },
    deliverClaimedReminder:async(reminder,kind,text)=>{
      deliveries.push({reminder,kind,text});
      return {state:'sent'};
    },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
    maxFixturesPerRun,
  });
  return {service,probes,deliveries,events};
}

test('lineup notifications probe each unique fixture once and fan out through lineup claims', async () => {
  const rows=[row(1,100),row(2,100),row(3,200)];
  const {service,probes,deliveries}=runtime({
    rows,
    snapshots:{100:{confirmed:true},200:{confirmed:false}},
  });
  const result=await service.processLineupNotifications({botToken:'token'});
  assert.deepEqual(probes,[100,200]);
  assert.equal(deliveries.length,2);
  assert.ok(deliveries.every(item=>item.kind==='lineup'));
  assert.ok(deliveries.every(item=>item.text.includes('Составы опубликованы')));
  assert.equal(result.confirmed,1);
  assert.equal(result.sent,2);
});

test('lineup scheduler skips already notified rows and groups remaining recipients', async () => {
  const already={...row(1,100),lineup_notified_at:new Date().toISOString()};
  const {service,probes,deliveries}=runtime({
    rows:[already,row(2,100)],
    snapshots:{100:{confirmed:true}},
  });
  const result=await service.processLineupNotifications({botToken:'token'});
  assert.deepEqual(probes,[100]);
  assert.equal(deliveries.length,1);
  assert.equal(deliveries[0].reminder.telegram_id,2);
  assert.equal(result.checked,2);
});

test('lineup scheduler caps unique fixture probes per cron run', async () => {
  const rows=[row(1,101),row(2,102),row(3,103)];
  const {service,probes}=runtime({
    rows,
    snapshots:{101:{confirmed:false},102:{confirmed:false},103:{confirmed:false}},
    maxFixturesPerRun:2,
  });
  const result=await service.processLineupNotifications({botToken:'token'});
  assert.deepEqual(probes,[101,102]);
  assert.equal(result.fixturesChecked,2);
  assert.equal(result.truncated,true);
  assert.equal(result.ok,false);
});

test('lineup scheduler is disabled with reminder runtime control', async () => {
  let reads=0;
  const service=createLineupNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({value:{remindersEnabled:false}}),
    supaSelectPaged:async()=>{ reads++; return {rows:[]}; },
    loadLineupSnapshot:async()=>({confirmed:true}),
    deliverClaimedReminder:async()=>({state:'sent'}),
    recordOpsEvent:async()=>{},
  });
  const result=await service.processLineupNotifications({botToken:'token'});
  assert.equal(result.disabled,true);
  assert.equal(reads,0);
});
