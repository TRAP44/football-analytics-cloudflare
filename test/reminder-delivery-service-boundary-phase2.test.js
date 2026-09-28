import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReminderDeliveryService } from '../src/reminder-delivery-service.js';

function runtime(overrides = {}) {
  const calls={messages:[],claims:[],sending:[],unknownHolds:[],finishes:[],releases:[],selects:[]};
  const events=[];
  const service=createReminderDeliveryService({
    hasSupabase:overrides.hasSupabase || (()=>true),
    loadRuntimeControls:overrides.loadRuntimeControls || (async()=>({value:{remindersEnabled:true}})),
    clearStaleReminderClaims:overrides.clearStaleReminderClaims || (async()=>({prematch:0,kickoff:0})),
    supaSelectMany:overrides.supaSelectMany || (async(...args)=>{calls.selects.push(args); return overrides.rows || [];}),
    recordOpsEvent:overrides.recordOpsEvent || (async(_cfg,event)=>{events.push(event);}),
    sendTelegramMessage:overrides.sendTelegramMessage || (async(...args)=>{
      calls.messages.push(args);
      return {ok:true,status:200,outcome:'sent',errorCode:0,description:'',retryAfter:0};
    }),
    claimReminderDelivery:overrides.claimReminderDelivery || (async(row,kind,cfg)=>{
      calls.claims.push({row,kind,cfg});
      return {claimed:true,claimAt:'2026-09-27T12:00:00.000Z'};
    }),
    markReminderDeliverySending:overrides.markReminderDeliverySending || (async(row,kind,claimAt,cfg)=>{
      calls.sending.push({row,kind,claimAt,cfg});
    }),
    holdReminderDeliveryUnknown:overrides.holdReminderDeliveryUnknown || (async(row,kind,claimAt,cfg)=>{
      calls.unknownHolds.push({row,kind,claimAt,cfg});
    }),
    finishReminderDelivery:overrides.finishReminderDelivery || (async(row,kind,claimAt,cfg)=>{
      calls.finishes.push({row,kind,claimAt,cfg});
    }),
    releaseReminderClaim:overrides.releaseReminderClaim || (async(row,kind,claimAt,errorMessage,cfg,options)=>{
      calls.releases.push({row,kind,claimAt,errorMessage,cfg,options});
    }),
  });
  return {service,calls,events};
}

test('delivery success preserves claim, finish and ops semantics', async () => {
  const {service,calls,events}=runtime();
  const row={telegram_id:15,fixture_id:77};
  const cfg={botToken:'token'};
  const result=await service.deliverClaimedReminder(row,'prematch','text',cfg);
  assert.equal(result.state,'sent');
  assert.equal(calls.claims.length,1);
  assert.deepEqual(calls.messages[0],[15,'text',cfg]);
  assert.equal(calls.sending.length,1);
  assert.equal(calls.finishes.length,1);
  assert.equal(calls.releases.length,0);
  assert.equal(events.length,1);
  assert.equal(events[0].code,'REMINDER_SENT_PREMATCH');
  assert.equal(events[0].endpoint,'cron:reminders');
  assert.deepEqual(events[0].meta,{
    fixtureId:77,
    kind:'prematch',
    telegramStatus:200,
    telegramErrorCode:null,
    retryAfter:null,
    telegramOutcome:'sent',
  });
});

test('403 delivery preserves disable and release semantics', async () => {
  const {service,calls,events}=runtime({
    sendTelegramMessage:async(...args)=>{
      calls.messages.push(args);
      return {ok:false,status:403,outcome:'confirmed_failure',errorCode:403,description:'Forbidden',retryAfter:30};
    },
  });
  const row={telegram_id:9,fixture_id:99};
  const result=await service.deliverClaimedReminder(row,'kickoff','text',{botToken:'token'});
  assert.equal(result.state,'disabled');
  assert.equal(calls.finishes.length,0);
  assert.equal(calls.releases.length,1);
  assert.equal(calls.releases[0].kind,'kickoff');
  assert.equal(calls.releases[0].errorMessage,'Forbidden');
  assert.deepEqual(calls.releases[0].options,{
    disable:true,
    disableReason:'telegram_forbidden',
    retryAfter:30,
  });
  assert.equal(events[0].code,'REMINDER_FORBIDDEN');
  assert.equal(events[0].severity,'warning');
  assert.equal(events[0].meta.telegramOutcome,'confirmed_failure');
});

test('unknown Telegram outcome stays claimed and is never released for blind retry', async () => {
  const {service,calls,events}=runtime({
    sendTelegramMessage:async(...args)=>{
      calls.messages.push(args);
      return {ok:false,status:0,outcome:'unknown',errorCode:0,description:'Telegram sendMessage timeout',retryAfter:0};
    },
  });
  const row={telegram_id:22,fixture_id:222};
  const result=await service.deliverClaimedReminder(row,'prematch','text',{botToken:'token'});
  assert.equal(result.state,'unknown');
  assert.equal(result.persistenceFailed,false);
  assert.equal(calls.sending.length,1);
  assert.equal(calls.unknownHolds.length,1);
  assert.equal(calls.releases.length,0);
  assert.equal(calls.finishes.length,0);
  assert.equal(events.at(-1).code,'REMINDER_DELIVERY_UNKNOWN');
  assert.equal(events.at(-1).meta.telegramOutcome,'unknown');
});

test('unknown hold persistence failure still keeps the sending claim fail closed', async () => {
  const {service,calls,events}=runtime({
    sendTelegramMessage:async(...args)=>{
      calls.messages.push(args);
      return {ok:false,status:0,outcome:'unknown',errorCode:0,description:'network ambiguous',retryAfter:0};
    },
    holdReminderDeliveryUnknown:async()=>{ throw new Error('hold write failed'); },
  });
  const result=await service.deliverClaimedReminder({telegram_id:23,fixture_id:223},'kickoff','text',{botToken:'token'});
  assert.equal(result.state,'unknown');
  assert.equal(result.persistenceFailed,true);
  assert.equal(calls.releases.length,0);
  assert.equal(events.some(event=>event.code==='REMINDER_UNKNOWN_HOLD_FAILED'),true);
  assert.equal(events.some(event=>event.code==='REMINDER_DELIVERY_UNKNOWN'),true);
});

test('an already claimed reminder is not sent again', async () => {
  const {service,calls}=runtime({
    claimReminderDelivery:async(row,kind,cfg)=>{
      calls.claims.push({row,kind,cfg});
      return {claimed:false,claimAt:'2026-09-27T12:00:00.000Z'};
    },
  });
  const result=await service.deliverClaimedReminder({telegram_id:1,fixture_id:2},'prematch','text',{botToken:'token'});
  assert.deepEqual(result,{state:'already_claimed'});
  assert.equal(calls.messages.length,0);
  assert.equal(calls.finishes.length,0);
  assert.equal(calls.releases.length,0);
});

test('scheduler preserves kickoff, prematch and retry-window behavior', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const rows=[
      {
        telegram_id:1,
        fixture_id:101,
        fixture_date:new Date(now+2*60_000).toISOString(),
        home_name:'Alpha',
        away_name:'Beta',
        league_name:'League',
        kickoff_notify:true,
        remind_before_minutes:30,
      },
      {
        telegram_id:2,
        fixture_id:102,
        fixture_date:new Date(now+30*60_000).toISOString(),
        home_name:'Gamma',
        away_name:'Delta',
        league_name:'',
        kickoff_notify:true,
        remind_before_minutes:30,
      },
      {
        telegram_id:3,
        fixture_id:103,
        fixture_date:new Date(now+30*60_000).toISOString(),
        home_name:'Retry',
        away_name:'Later',
        kickoff_notify:true,
        remind_before_minutes:30,
        delivery_retry_after:new Date(now+60*60_000).toISOString(),
      },
    ];
    const {service,calls,events}=runtime({rows});
    const summary=await service.processDueReminders({botToken:'token'});
    assert.deepEqual(summary,{checked:3,sent:1,kickoffSent:1,failed:0,unknown:0,claimed:0,staleClaims:0});
    assert.equal(calls.messages.length,2);
    assert.equal(calls.messages[0][0],1);
    assert.equal(calls.messages[0][1],'🔴 Матч начинается\n\nAlpha — Beta\nLeague\n\nОткройте приложение: центр матча появится, когда источник данных обновит статус.');
    assert.equal(calls.messages[1][0],2);
    assert.equal(calls.messages[1][1],'⚽ Скоро матч\n\nGamma — Delta\nСтарт примерно через 30 мин.\n\nОткройте приложение для свежего предматчевого анализа.');
    assert.equal(calls.selects.length,1);
    assert.equal(calls.selects[0][1],'match_reminders');
    assert.deepEqual(calls.selects[0][2],{
      enabled:'eq.true',
      fixture_date:'gte.2026-09-27T11:52:00.000Z',
    });
    assert.deepEqual(calls.selects[0][3],{limit:250,order:'fixture_date.asc'});
    assert.equal(events.at(-1).code,'REMINDER_RUN_OK');
  } finally {
    Date.now=originalNow;
  }
});

test('scheduler preserves disabled and read-failure summaries', async () => {
  const disabled=runtime({loadRuntimeControls:async()=>({value:{remindersEnabled:false}})});
  assert.deepEqual(
    await disabled.service.processDueReminders({botToken:'token'}),
    {checked:0,sent:0,kickoffSent:0,failed:0,unknown:0,claimed:0,staleClaims:0,disabled:true},
  );

  const failed=runtime({
    clearStaleReminderClaims:async()=>({prematch:2,kickoff:1}),
    supaSelectMany:async()=>{ throw new Error('read failed'); },
  });
  assert.deepEqual(
    await failed.service.processDueReminders({botToken:'token'}),
    {checked:0,sent:0,kickoffSent:0,failed:1,unknown:0,claimed:0,staleClaims:3},
  );
  assert.equal(failed.events[0].code,'REMINDER_SCHEDULER_READ_FAILED');
});

test('worker delegates reminder delivery orchestration while keeping Telegram transport in the composition root', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/import \{ createReminderDeliveryService \} from '\.\/reminder-delivery-service\.js'/);
  assert.match(worker,/createReminderDeliveryService\(\{/);
  assert.match(worker,/sendTelegramMessage,/);
  assert.doesNotMatch(worker,/async function recordReminderDelivery\(/);
  assert.doesNotMatch(worker,/async function deliverClaimedReminder\(/);
  assert.doesNotMatch(worker,/async function processDueReminders\(cfg\)/);
  assert.match(worker,/async function sendTelegramMessage\(/);
});
