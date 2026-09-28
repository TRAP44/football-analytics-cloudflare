import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createUserRemindersService } from '../src/user-reminders.js';

function runtime(overrides = {}) {
  const memory={reminders:new Map()};
  const rpcCalls=[];
  const fetchCalls=[];
  const preferences={reminderMinutes:30,kickoffNotification:true};
  const service=createUserRemindersService({
    memory,
    hasSupabase:overrides.hasSupabase || (()=>false),
    supaSelectMany:overrides.supaSelectMany || (async()=>[]),
    supaRpc:overrides.supaRpc || (async(_cfg,name,args,timeout)=>{
      rpcCalls.push({name,args,timeout});
      return {
        allowed:true,
        item:{
          telegram_id:args.p_telegram_id,
          fixture_id:args.p_fixture_id,
          home_name:args.p_home_name,
          away_name:args.p_away_name,
          league_name:args.p_league_name,
          fixture_date:args.p_fixture_date,
          remind_before_minutes:args.p_remind_before_minutes,
          kickoff_notify:args.p_kickoff_notify,
          enabled:true,
        },
      };
    }),
    fetchWithTimeout:overrides.fetchWithTimeout || (async(url,init,timeout,source)=>{
      fetchCalls.push({url:String(url),init,timeout,source});
      return {ok:true,status:204};
    }),
    supaHeaders:overrides.supaHeaders || ((_cfg,extra)=>({...extra,'x-test':'1'})),
    getPreferences:overrides.getPreferences || (async()=>preferences),
  });
  return {memory,rpcCalls,fetchCalls,service};
}

test('reminders service preserves in-memory add/read/remove semantics', async () => {
  const {memory,service}=runtime();
  const cfg={};
  const future=new Date(Date.now()+2*60*60_000).toISOString();
  const added=await service.addReminder(7,{
    fixtureId:101,
    homeName:' Home ',
    awayName:' Away ',
    leagueName:' League ',
    fixtureDate:future,
  },cfg);
  assert.equal(added.telegram_id,7);
  assert.equal(added.fixture_id,101);
  assert.equal(added.home_name,'Home');
  assert.equal(added.away_name,'Away');
  assert.equal(added.remind_before_minutes,30);
  assert.equal(added.kickoff_notify,true);
  assert.equal((await service.getReminders(7,cfg)).length,1);
  await service.removeReminder(7,101,cfg);
  assert.deepEqual(await service.getReminders(7,cfg),[]);
  assert.equal(memory.reminders.get(7).length,0);
});

test('reminders service preserves preference defaults and explicit overrides', async () => {
  const {service}=runtime({
    getPreferences:async()=>({reminderMinutes:60,kickoffNotification:false}),
  });
  const future=new Date(Date.now()+2*60*60_000).toISOString();
  const fromPrefs=await service.addReminder(9,{
    fixtureId:201,homeName:'A',awayName:'B',fixtureDate:future,
  },{});
  assert.equal(fromPrefs.remind_before_minutes,60);
  assert.equal(fromPrefs.kickoff_notify,false);

  const explicit=await service.addReminder(9,{
    fixtureId:202,homeName:'C',awayName:'D',fixtureDate:future,
    reminderMinutes:15,kickoffNotify:true,
  },{});
  assert.equal(explicit.remind_before_minutes,15);
  assert.equal(explicit.kickoff_notify,true);
});

test('reminders service preserves guarded Supabase RPC contract', async () => {
  const {rpcCalls,service}=runtime({hasSupabase:()=>true});
  const future=new Date(Date.now()+2*60*60_000).toISOString();
  const row=await service.addReminder(11,{
    fixtureId:55,homeName:'Home',awayName:'Away',leagueName:'Cup',fixtureDate:future,
  },{supabaseUrl:'https://db.test'});
  assert.equal(row.fixture_id,55);
  assert.equal(rpcCalls.length,1);
  assert.equal(rpcCalls[0].name,'save_match_reminder_guarded');
  assert.equal(rpcCalls[0].args.p_telegram_id,11);
  assert.equal(rpcCalls[0].args.p_fixture_id,55);
  assert.equal(rpcCalls[0].args.p_limit,50);
  assert.equal(rpcCalls[0].timeout,4000);
});

test('reminders service preserves active 50-item fallback cap', async () => {
  const {memory,service}=runtime();
  const userId=13;
  memory.reminders.set(userId,Array.from({length:50},(_,i)=>({
    telegram_id:userId,
    fixture_id:i+1,
    home_name:'Home',
    away_name:'Away',
    fixture_date:new Date(Date.now()+(i+2)*60*60_000).toISOString(),
    enabled:true,
  })));
  await assert.rejects(
    ()=>service.addReminder(userId,{
      fixtureId:999,homeName:'X',awayName:'Y',fixtureDate:new Date(Date.now()+4*60*60_000).toISOString(),
    },{}),
    error=>error?.code==='REMINDERS_LIMIT',
  );
  assert.equal(memory.reminders.get(userId).length,50);
});

test('reminders service surfaces Supabase read failures instead of false empty state', async () => {
  const {service}=runtime({
    hasSupabase:()=>true,
    supaSelectMany:async()=>{ throw new Error('Supabase reminders unavailable'); },
  });
  await assert.rejects(
    ()=>service.getReminders(15,{supabaseUrl:'https://db.test'}),
    /Supabase reminders unavailable/,
  );
});

test('reminders service preserves Supabase delete request shape', async () => {
  const {fetchCalls,service}=runtime({hasSupabase:()=>true});
  await service.removeReminder(15,77,{supabaseUrl:'https://db.test'});
  assert.equal(fetchCalls.length,1);
  const call=fetchCalls[0];
  assert.match(call.url,/\/rest\/v1\/match_reminders/);
  assert.match(call.url,/telegram_id=eq\.15/);
  assert.match(call.url,/fixture_id=eq\.77/);
  assert.equal(call.init.method,'DELETE');
  assert.equal(call.init.headers.Prefer,'return=minimal');
  assert.equal(call.timeout,7000);
  assert.equal(call.source,'Supabase reminders');
});

test('worker delegates reminder CRUD storage boundary to extracted service', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/import \{ createUserRemindersService \} from '\.\/user-reminders\.js'/);
  assert.match(worker,/createUserRemindersService\(\{/);
  assert.match(worker,/getPreferences,/);
  assert.doesNotMatch(worker,/async function getReminders\(userId, cfg\)/);
  assert.doesNotMatch(worker,/async function addReminder\(userId, input, cfg\)/);
  assert.doesNotMatch(worker,/async function removeReminder\(userId, fixtureId, cfg\)/);
  assert.match(worker,/await getReminders\(user\.id, cfg\)/);
  assert.match(worker,/await addReminder\(user\.id/);
  assert.match(worker,/await removeReminder\(user\.id/);

  // Reminder delivery orchestration is delegated to its service while the
  // shared Telegram transport remains injected from the composition root.
  assert.match(worker,/import \{ createReminderDeliveryService \} from '\.\/reminder-delivery-service\.js'/);
  assert.match(worker,/createReminderDeliveryService\(\{/);
  assert.match(worker,/sendTelegramMessage,/);
  assert.doesNotMatch(worker,/async function processDueReminders\(cfg\)/);
  assert.match(worker,/import \{ createReminderDeliveryStore \} from '\.\/reminder-delivery-store\.js'/);
  assert.match(worker,/createReminderDeliveryStore\(\{/);
  assert.doesNotMatch(worker,/async function claimReminderDelivery\(row, kind, cfg\)/);
});
