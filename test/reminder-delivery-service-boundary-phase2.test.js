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
    supaSelectPaged:overrides.supaSelectPaged || (async(...args)=>{
      calls.selects.push(args);
      return { rows: overrides.rows || [], truncated: Boolean(overrides.truncated) };
    }),
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
    filterNotificationRecipients:overrides.filterNotificationRecipients,
    deliveryConcurrency:overrides.deliveryConcurrency,
    maxDeliveriesPerRun:overrides.maxDeliveriesPerRun,
    audienceBatchSize:overrides.audienceBatchSize,
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

test('successful Telegram send with finish failure is held fail-closed for reconciliation and never released', async () => {
  const finishError=new Error('Reminder delivery claim was lost during finish.');
  finishError.code='REMINDER_DELIVERY_CLAIM_LOST';
  finishError.claimLost=true;

  const {service,calls,events}=runtime({
    finishReminderDelivery:async()=>{ throw finishError; },
  });

  const result=await service.deliverClaimedReminder(
    {telegram_id:16,fixture_id:78},
    'prematch',
    'text',
    {botToken:'token'},
  );

  assert.equal(result.state,'sent_unconfirmed');
  assert.equal(result.persistenceFailed,true);
  assert.equal(result.holdFailed,false);
  assert.equal(calls.messages.length,1);
  assert.equal(calls.unknownHolds.length,1);
  assert.equal(calls.releases.length,0);
  assert.equal(events.some(event=>event.code==='REMINDER_SENT_PREMATCH'),false);
  assert.equal(events.some(event=>event.code==='REMINDER_SENT_PERSISTENCE_AMBIGUOUS'),true);
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
    assert.equal(summary.ok,true);
    assert.equal(summary.checked,3);
    assert.equal(summary.candidates,2);
    assert.equal(summary.eligible,2);
    assert.equal(summary.sent,1);
    assert.equal(summary.kickoffSent,1);
    assert.equal(summary.failed,0);
    assert.equal(summary.unknown,0);
    assert.equal(summary.ambiguous,0);
    assert.equal(summary.rateLimited,0);
    assert.equal(summary.claimed,0);
    assert.equal(summary.deferred,0);
    assert.equal(summary.staleClaims,0);
    assert.equal(summary.staleCleanupFailed,0);
    assert.equal(summary.truncated,false);
    assert.equal(summary.backlog,false);
    assert.equal(summary.concurrency,4);
    assert.equal(summary.maxDeliveriesPerRun,240);
    assert.equal(calls.messages.length,2);
    assert.equal(calls.messages[0][0],1);
    assert.equal(calls.messages[0][1],'🔴 Матч начинается\n\nAlpha — Beta\nLeague\n\nОткройте приложение: центр матча появится, когда источник данных обновит статус.');
    assert.equal(calls.messages[1][0],2);
    assert.equal(calls.messages[1][1],'⚽ Скоро матч\n\nGamma — Delta\nСтарт примерно через 30 мин.\n\nОткройте приложение для свежего предматчевого анализа.');
    assert.equal(calls.selects.length,1);
    assert.equal(calls.selects[0][1],'match_reminders');
    assert.deepEqual(calls.selects[0][2],{
      enabled:'eq.true',
      and:'(fixture_date.gte.2026-09-27T11:52:00.000Z,fixture_date.lte.2026-09-27T13:05:00.000Z)',
    });
    assert.deepEqual(calls.selects[0][3],{
      pageSize:250,
      maxRows:2000,
      order:'fixture_date.asc,fixture_id.asc,telegram_id.asc',
    });
    assert.equal(events.at(-1).code,'REMINDER_RUN_OK');
  } finally {
    Date.now=originalNow;
  }
});

test('scheduler surfaces pagination truncation and stale cleanup degradation', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const runtimeState=runtime({
      rows:[],
      truncated:true,
      clearStaleReminderClaims:async()=>({prematch:0,kickoff:0,failed:1}),
    });
    const summary=await runtimeState.service.processDueReminders({botToken:'token'});
    assert.equal(summary.ok,false);
    assert.equal(summary.checked,0);
    assert.equal(summary.failed,0);
    assert.equal(summary.staleCleanupFailed,1);
    assert.equal(summary.truncated,true);
    assert.equal(summary.backlog,true);
    assert.equal(runtimeState.events.some(event=>event.code==='REMINDER_SCHEDULER_TRUNCATED'),true);
    assert.equal(runtimeState.events.at(-1).code,'REMINDER_RUN_TRUNCATED');
  } finally {
    Date.now=originalNow;
  }
});

test('scheduler preserves disabled and read-failure summaries', async () => {
  const disabled=runtime({loadRuntimeControls:async()=>({value:{remindersEnabled:false}})});
  const disabledSummary=await disabled.service.processDueReminders({botToken:'token'});
  assert.equal(disabledSummary.ok,true);
  assert.equal(disabledSummary.disabled,true);
  assert.equal(disabledSummary.checked,0);

  const failed=runtime({
    clearStaleReminderClaims:async()=>({prematch:2,kickoff:1}),
    supaSelectPaged:async()=>{ throw new Error('read failed'); },
  });
  const failedSummary=await failed.service.processDueReminders({botToken:'token'});
  assert.equal(failedSummary.ok,false);
  assert.equal(failedSummary.failed,1);
  assert.equal(failedSummary.staleClaims,3);
  assert.equal(failedSummary.reason,'reminder_read_failed');
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


test('scheduler outcome contract marks partial delivery and unknown states as ok=false', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const row={
      telegram_id:7,
      fixture_id:707,
      fixture_date:new Date(now+30*60_000).toISOString(),
      home_name:'A',
      away_name:'B',
      kickoff_notify:true,
      remind_before_minutes:30,
    };
    const failed=runtime({
      rows:[row],
      sendTelegramMessage:async()=>({ok:false,status:503,outcome:'confirmed_failure',errorCode:503,description:'down',retryAfter:0}),
    });
    const failedSummary=await failed.service.processDueReminders({botToken:'token'});
    assert.equal(failedSummary.ok,false);
    assert.equal(failedSummary.failed,1);

    const unknown=runtime({
      rows:[row],
      sendTelegramMessage:async()=>({ok:false,status:0,outcome:'unknown',errorCode:0,description:'ambiguous',retryAfter:0}),
    });
    const unknownSummary=await unknown.service.processDueReminders({botToken:'token'});
    assert.equal(unknownSummary.ok,false);
    assert.equal(unknownSummary.unknown,1);
  } finally {
    Date.now=originalNow;
  }
});


test('Issue #408 runtime-control failure becomes a controlled result and ops event', async () => {
  const rt=runtime({
    loadRuntimeControls:async()=>{ throw new Error('runtime controls unavailable'); },
  });
  const summary=await rt.service.processDueReminders({botToken:'token'});
  assert.equal(summary.ok,false);
  assert.equal(summary.failed,1);
  assert.equal(summary.dependencyFailures,1);
  assert.equal(summary.reason,'runtime_controls_unavailable');
  assert.equal(rt.calls.messages.length,0);
  assert.equal(rt.events.some(event=>event.code==='REMINDER_RUNTIME_CONTROLS_FAILED'),true);
});

test('Issue #408 preferences lookup failure is isolated per audience batch and other batches still deliver', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const rows=[1,2,3,4].map(id=>({
      telegram_id:id,
      fixture_id:800+id,
      fixture_date:new Date(now+30*60_000).toISOString(),
      home_name:`H${id}`,
      away_name:`A${id}`,
      kickoff_notify:true,
      remind_before_minutes:30,
    }));
    let audienceCall=0;
    const rt=runtime({
      rows,
      audienceBatchSize:2,
      filterNotificationRecipients:async batch=>{
        audienceCall+=1;
        if (audienceCall===1) throw new Error('preferences lookup failed');
        return {rows:batch,blockedByPreference:0,blockedByEntitlement:0};
      },
    });

    const summary=await rt.service.processDueReminders({botToken:'token'});
    assert.equal(summary.ok,false);
    assert.equal(summary.dependencyFailures,1);
    assert.equal(summary.sent,2);
    assert.equal(rt.calls.messages.length,2);
    assert.equal(
      rt.events.some(event=>event.code==='REMINDER_AUDIENCE_BATCH_FAILED' && event.message==='preferences lookup failed'),
      true,
    );
    assert.equal(rt.events.at(-1).code,'REMINDER_RUN_WITH_DEPENDENCY_FAILURES');
  } finally {
    Date.now=originalNow;
  }
});


test('Issue #408 audience lookup failure is isolated per batch and later batches still deliver', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const rows=[1,2].map(id=>({
      telegram_id:20+id,
      fixture_id:850+id,
      fixture_date:new Date(now+30*60_000).toISOString(),
      home_name:`AudienceH${id}`,
      away_name:`AudienceA${id}`,
      kickoff_notify:true,
      remind_before_minutes:30,
    }));
    let audienceCall=0;
    const rt=runtime({
      rows,
      audienceBatchSize:1,
      filterNotificationRecipients:async batch=>{
        audienceCall+=1;
        if (audienceCall===1) throw new Error('audience lookup failed');
        return {rows:batch,blockedByPreference:0,blockedByEntitlement:0};
      },
    });

    const summary=await rt.service.processDueReminders({botToken:'token'});
    assert.equal(summary.ok,false);
    assert.equal(summary.dependencyFailures,1);
    assert.equal(summary.sent,1);
    assert.equal(rt.calls.messages.length,1);
    assert.equal(
      rt.events.some(event=>event.code==='REMINDER_AUDIENCE_BATCH_FAILED' && event.message==='audience lookup failed'),
      true,
    );
    assert.equal(rt.events.at(-1).code,'REMINDER_RUN_WITH_DEPENDENCY_FAILURES');
  } finally {
    Date.now=originalNow;
  }
});

test('Issue #408 one failed reminder does not block the next reminder', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const rows=[1,2].map(id=>({
      telegram_id:40+id,
      fixture_id:880+id,
      fixture_date:new Date(now+30*60_000).toISOString(),
      home_name:`FailureH${id}`,
      away_name:`FailureA${id}`,
      kickoff_notify:true,
      remind_before_minutes:30,
    }));
    let claimAttempts=0;
    const rt=runtime({
      rows,
      deliveryConcurrency:1,
      claimReminderDelivery:async(row,kind,cfg)=>{
        rt.calls.claims.push({row,kind,cfg});
        claimAttempts+=1;
        if (claimAttempts===1) throw new Error('claim persistence unavailable');
        return {claimed:true,claimAt:'2026-09-27T12:00:00.000Z'};
      },
    });

    const summary=await rt.service.processDueReminders({botToken:'token'});
    assert.equal(summary.ok,false);
    assert.equal(summary.failed,1);
    assert.equal(summary.sent,1);
    assert.equal(rt.calls.claims.length,2);
    assert.equal(rt.calls.messages.length,1);
    assert.equal(rt.calls.messages[0][0],42);
    assert.equal(
      rt.events.some(event=>event.code==='REMINDER_DELIVERY_EXCEPTION' && event.message==='claim persistence unavailable'),
      true,
    );
    assert.equal(rt.events.at(-1).code,'REMINDER_RUN_WITH_FAILURES');
  } finally {
    Date.now=originalNow;
  }
});

test('Issue #408 read-after-write reconciliation reports a confirmed sent reminder as sent', async () => {
  const rt=runtime({
    finishReminderDelivery:async()=>({finalized:true,reconciled:true}),
  });
  const result=await rt.service.deliverClaimedReminder(
    {telegram_id:55,fixture_id:505},
    'prematch',
    'text',
    {botToken:'token'},
  );
  assert.equal(result.state,'sent');
  assert.equal(result.reconciled,true);
  assert.equal(rt.events.some(event=>event.code==='REMINDER_FINISH_RECONCILED'),true);
  assert.equal(rt.events.some(event=>event.code==='REMINDER_SENT_PREMATCH'),true);
});

test('Issue #408 large backlog is capped per run and deferred without claiming excess rows', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const rows=Array.from({length:12},(_,index)=>({
      telegram_id:index+1,
      fixture_id:900+index,
      fixture_date:new Date(now+30*60_000).toISOString(),
      home_name:'A',
      away_name:'B',
      kickoff_notify:true,
      remind_before_minutes:30,
    }));
    const rt=runtime({rows,maxDeliveriesPerRun:5,deliveryConcurrency:2});
    const summary=await rt.service.processDueReminders({botToken:'token'});
    assert.equal(summary.sent,5);
    assert.equal(summary.deferred,7);
    assert.equal(summary.backlog,true);
    assert.equal(summary.ok,false);
    assert.equal(rt.calls.claims.length,5);
    assert.equal(rt.events.at(-1).code,'REMINDER_RUN_BACKLOG_DEFERRED');
  } finally {
    Date.now=originalNow;
  }
});

test('Issue #408 delivery concurrency is bounded', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const rows=Array.from({length:8},(_,index)=>({
      telegram_id:index+1,
      fixture_id:1000+index,
      fixture_date:new Date(now+30*60_000).toISOString(),
      home_name:'A',
      away_name:'B',
      kickoff_notify:true,
      remind_before_minutes:30,
    }));
    let active=0;
    let maxActive=0;
    const rt=runtime({
      rows,
      deliveryConcurrency:3,
      sendTelegramMessage:async(...args)=>{
        rt.calls.messages.push(args);
        active+=1;
        maxActive=Math.max(maxActive,active);
        await new Promise(resolve=>setTimeout(resolve,5));
        active-=1;
        return {ok:true,status:200,outcome:'sent',errorCode:0,description:'',retryAfter:0};
      },
    });
    const summary=await rt.service.processDueReminders({botToken:'token'});
    assert.equal(summary.sent,8);
    assert.ok(maxActive<=3);
    assert.ok(maxActive>=2);
  } finally {
    Date.now=originalNow;
  }
});

test('Issue #408 Telegram 429 stops scheduling new work and preserves retry_after release', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const rows=Array.from({length:10},(_,index)=>({
      telegram_id:index+1,
      fixture_id:1100+index,
      fixture_date:new Date(now+30*60_000).toISOString(),
      home_name:'A',
      away_name:'B',
      kickoff_notify:true,
      remind_before_minutes:30,
    }));
    let sends=0;
    const rt=runtime({
      rows,
      deliveryConcurrency:2,
      sendTelegramMessage:async(...args)=>{
        rt.calls.messages.push(args);
        sends+=1;
        if (sends===1) {
          return {ok:false,status:429,outcome:'confirmed_failure',errorCode:429,description:'Too Many Requests',retryAfter:30};
        }
        await new Promise(resolve=>setTimeout(resolve,5));
        return {ok:true,status:200,outcome:'sent',errorCode:0,description:'',retryAfter:0};
      },
    });

    const summary=await rt.service.processDueReminders({botToken:'token'});
    assert.equal(summary.rateLimited,1);
    assert.ok(summary.deferred>0);
    assert.equal(summary.ok,false);
    assert.ok(rt.calls.messages.length<=2);
    const limitedRelease=rt.calls.releases.find(item=>Number(item.options?.retryAfter||0)===30);
    assert.ok(limitedRelease);
    assert.equal(rt.events.some(event=>event.code==='REMINDER_RATE_LIMITED'),true);
    assert.equal(rt.events.at(-1).code,'REMINDER_RUN_RATE_LIMITED');
  } finally {
    Date.now=originalNow;
  }
});

test('Issue #408 sent persistence ambiguity is counted without blind resend', async () => {
  const originalNow=Date.now;
  const now=Date.parse('2026-09-27T12:00:00.000Z');
  Date.now=()=>now;
  try {
    const row={
      telegram_id:77,
      fixture_id:1200,
      fixture_date:new Date(now+30*60_000).toISOString(),
      home_name:'A',
      away_name:'B',
      kickoff_notify:true,
      remind_before_minutes:30,
    };
    const rt=runtime({
      rows:[row],
      finishReminderDelivery:async()=>{ throw new Error('finish unavailable'); },
    });
    const summary=await rt.service.processDueReminders({botToken:'token'});
    assert.equal(summary.ambiguous,1);
    assert.equal(summary.sent,0);
    assert.equal(summary.ok,false);
    assert.equal(rt.calls.unknownHolds.length,1);
    assert.equal(rt.calls.releases.length,0);
    assert.equal(rt.events.at(-1).code,'REMINDER_RUN_WITH_PERSISTENCE_AMBIGUITY');
  } finally {
    Date.now=originalNow;
  }
});
