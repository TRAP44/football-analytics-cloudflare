import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportantChangeNotificationService } from '../src/important-change-notification-service.js';

function reminder(userId, fixtureId, minutes = 60) {
  return {
    telegram_id:userId,
    fixture_id:fixtureId,
    home_name:'Home',
    away_name:'Away',
    league_name:'League',
    fixture_date:new Date(Date.now() + minutes * 60_000).toISOString(),
    important_change_notified_at:null,
  };
}

function snapshots({ home = [40, 46], draw = [30, 28], away = [30, 26] } = {}) {
  const now=Date.now();
  return [
    {at:new Date(now).toISOString(),homeProb:home[1],drawProb:draw[1],awayProb:away[1]},
    {at:new Date(now-45*60_000).toISOString(),homeProb:home[0],drawProb:draw[0],awayProb:away[0]},
  ];
}

function runtime({ rows = [], byFixture = {}, thresholdPp = 5 } = {}) {
  const reads=[];
  const deliveries=[];
  const service=createImportantChangeNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
    supaSelectPaged:async()=>({rows,truncated:false}),
    getOddsSnapshots:async(fixtureId)=>{
      reads.push(fixtureId);
      return byFixture[fixtureId] || [];
    },
    deliverClaimedReminder:async(row,kind,text)=>{
      deliveries.push({row,kind,text});
      return {state:'sent'};
    },
    recordOpsEvent:async()=>{},
    thresholdPp,
  });
  return {service,reads,deliveries};
}

test('important-change detector requires two valid snapshots and a 5pp move', () => {
  const {service}=runtime();
  assert.equal(service.movementFromSnapshots([]).significant,false);
  assert.equal(service.movementFromSnapshots(snapshots({home:[40,44],draw:[30,29],away:[30,27]})).significant,false);
  const movement=service.movementFromSnapshots(snapshots());
  assert.equal(movement.significant,true);
  assert.deepEqual(movement.strongest,{side:'home',delta:6});
});

test('scheduler reads stored odds once per fixture and fans out through atomic claims', async () => {
  const rows=[reminder(1,100),reminder(2,100),reminder(3,200)];
  const {service,reads,deliveries}=runtime({
    rows,
    byFixture:{
      100:snapshots(),
      200:snapshots({home:[40,42],draw:[30,30],away:[30,28]}),
    },
  });
  const result=await service.processImportantChangeNotifications({botToken:'token'});
  assert.deepEqual(reads,[100,200]);
  assert.equal(deliveries.length,2);
  assert.ok(deliveries.every(item=>item.kind==='important_change'));
  assert.ok(deliveries.every(item=>item.text.includes('Важное изменение перед матчем')));
  assert.equal(result.significant,1);
  assert.equal(result.sent,2);
});

test('scheduler does not generate provider work and skips already notified recipients', async () => {
  const already={...reminder(1,100),important_change_notified_at:new Date().toISOString()};
  const {service,reads,deliveries}=runtime({
    rows:[already,reminder(2,100)],
    byFixture:{100:snapshots()},
  });
  const result=await service.processImportantChangeNotifications({botToken:'token'});
  assert.deepEqual(reads,[100]);
  assert.equal(deliveries.length,1);
  assert.equal(deliveries[0].row.telegram_id,2);
  assert.equal(result.checked,2);
});

test('message is informational and labels the strongest market-probability move', () => {
  const {service}=runtime();
  const movement=service.movementFromSnapshots(snapshots());
  const text=service.changeMessage(reminder(1,100),movement);
  assert.match(text,/Home/);
  assert.match(text,/\+6\.0 п\.п\./);
  assert.match(text,/не гарантия результата/i);
});
