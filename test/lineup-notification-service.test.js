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

test('lineup scheduler ignores coerced fixture IDs and only accepts boolean confirmed snapshots', async () => {
  const rows=[
    {...row(1,100),fixture_id:true},
    {...row(2,200),fixture_id:'200'},
    {...row(3,300),fixture_id:[300]},
  ];
  const {service,probes,deliveries}=runtime({
    rows,
    snapshots:{
      200:{confirmed:'true'},
      300:{confirmed:true},
    },
  });
  const result=await service.processLineupNotifications({botToken:'token'});
  assert.deepEqual(probes,[200]);
  assert.equal(deliveries.length,0);
  assert.equal(result.confirmed,0);
});

test('lineup scheduler falls back from malformed fixture cap instead of disabling work', async () => {
  const rows=[row(1,101),row(2,102),row(3,103),row(4,104),row(5,105)];
  const {service,probes}=runtime({
    rows,
    snapshots:{101:{confirmed:false},102:{confirmed:false},103:{confirmed:false},104:{confirmed:false},105:{confirmed:false}},
    maxFixturesPerRun:Infinity,
  });
  const result=await service.processLineupNotifications({botToken:'token'});
  assert.deepEqual(probes,[101,102,103,104]);
  assert.equal(result.fixturesChecked,4);
  assert.equal(result.truncated,true);
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

test('lineup scheduler fails soft when runtime controls are unavailable', async () => {
  const events=[];
  const service=createLineupNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>{ throw new Error('controls unavailable'); },
    supaSelectPaged:async()=>{ throw new Error('should not read reminders'); },
    loadLineupSnapshot:async()=>({confirmed:true}),
    deliverClaimedReminder:async()=>({state:'sent'}),
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  });
  const result=await service.processLineupNotifications({botToken:'token'});
  assert.equal(result.ok,false);
  assert.equal(result.failed,1);
  assert.equal(result.fixturesChecked,0);
  assert.equal(events.at(-1)?.code,'LINEUP_NOTIFICATION_RUNTIME_CONTROLS_FAILED');
});

test('lineup scheduler fails soft when recipient filtering is unavailable', async () => {
  const events=[];
  const service=createLineupNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
    supaSelectPaged:async()=>({rows:[row(1,100)],truncated:false}),
    loadLineupSnapshot:async()=>{ throw new Error('should not probe lineup'); },
    deliverClaimedReminder:async()=>{ throw new Error('should not deliver'); },
    filterNotificationRecipients:async()=>{ throw new Error('preferences unavailable'); },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  });
  const result=await service.processLineupNotifications({botToken:'token'});
  assert.equal(result.ok,false);
  assert.equal(result.failed,1);
  assert.equal(result.fixturesChecked,0);
  assert.equal(events.at(-1)?.code,'LINEUP_NOTIFICATION_AUDIENCE_FAILED');
});

test('lineup scheduler observability failures do not abort remaining fixture probes', async () => {
  const service=createLineupNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
    supaSelectPaged:async()=>({rows:[row(1,100),row(2,200)],truncated:false}),
    loadLineupSnapshot:async(fixtureId)=>{
      if (fixtureId===100) throw new Error('lineup unavailable');
      return {confirmed:true};
    },
    deliverClaimedReminder:async()=>({state:'sent'}),
    recordOpsEvent:async()=>{ throw new Error('ops unavailable'); },
  });
  const result=await service.processLineupNotifications({botToken:'token'});
  assert.equal(result.failed,1);
  assert.equal(result.confirmed,1);
  assert.equal(result.sent,1);
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
