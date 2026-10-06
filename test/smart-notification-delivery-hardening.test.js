import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSmartNotificationDeliveryService } from '../src/smart-notification-delivery.js';

function input() {
  return {
    row:{ telegram_id:42, fixture_id:420 },
    eventType:'match.goal',
    category:'match',
    text:'Goal',
    dedupeKey:'v1:420:match.goal:55',
  };
}

function supabaseRuntime({ finalizeResult={updated:true,reason:'finalized'}, finalizeThrows=false, beginResult={started:true,reason:'sending'} } = {}) {
  let sends=0;
  let claims=0;
  const events=[];
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>true,
    supaRpc:async(_cfg,name)=>{
      if (name==='claim_smart_notification_delivery') {
        claims += 1;
        return claims===1
          ? {allowed:true,reason:'created',claimAt:'2026-10-03T12:00:00.000Z',attempts:1}
          : {allowed:false,reason:'duplicate'};
      }
      if (name==='begin_smart_notification_delivery_send') return beginResult;
      if (name==='finalize_smart_notification_delivery') {
        if (finalizeThrows) throw new Error('db unavailable');
        return finalizeResult;
      }
      throw new Error('unexpected rpc '+name);
    },
    sendTelegramMessage:async()=>{
      sends += 1;
      return {ok:true,status:200,outcome:'sent'};
    },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  });
  return {service,events,get sends(){return sends;}};
}

test('delivery binds category and dedupe key to the actual event identity',async()=>{
  let sends=0;
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>false,
    supaRpc:async()=>{throw new Error('unexpected rpc');},
    sendTelegramMessage:async()=>{sends+=1;return {ok:true,status:200,outcome:'sent'};},
  });

  for(const bad of [
    {...input(),category:'players'},
    {...input(),dedupeKey:'v1:421:match.goal:55'},
    {...input(),dedupeKey:'v1:420:player.goal:55'},
    {...input(),eventType:'player.goal',category:'players',dedupeKey:'v1:420:match.goal:55'},
  ]){
    assert.equal((await service.deliverSmartNotification(bad,{})).state,'invalid');
  }
  assert.equal(sends,0);
});

test('contradictory Telegram success is treated as unknown outcome',async()=>{
  let finalizedStatus='';
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>true,
    supaRpc:async(_cfg,name,args)=>{
      if(name==='claim_smart_notification_delivery') {
        return {allowed:true,reason:'created',claimAt:'2026-10-03T12:00:00.000Z'};
      }
      if(name==='begin_smart_notification_delivery_send') return {started:true,reason:'sending'};
      if(name==='finalize_smart_notification_delivery') {
        finalizedStatus=args.p_status;
        return {updated:true,reason:'finalized'};
      }
      throw new Error('unexpected rpc '+name);
    },
    sendTelegramMessage:async()=>({
      ok:true,
      status:200,
      errorCode:500,
      outcome:'confirmed_failure',
    }),
  });
  const result=await service.deliverSmartNotification(input(),{});
  assert.equal(result.state,'unknown');
  assert.equal(finalizedStatus,'unknown');
});

test('delivery rejects JavaScript coercion before claim or Telegram side effects',async()=>{
  let rpcCalls=0;
  let sends=0;
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>true,
    supaRpc:async()=>{rpcCalls+=1;return {};},
    sendTelegramMessage:async()=>{sends+=1;return {ok:true,status:200,outcome:'sent'};},
  });

  for(const bad of [
    {...input(),row:{telegram_id:true,fixture_id:420}},
    {...input(),row:{telegram_id:[42],fixture_id:420}},
    {...input(),row:{telegram_id:42,fixture_id:{value:420}}},
    {...input(),eventType:{toString:()=> 'match.goal'}},
    {...input(),category:['match']},
    {...input(),dedupeKey:{toString:()=> 'v1:420:match.goal:55'}},
    {...input(),text:{toString:()=> 'Goal'}},
    {...input(),cooldownSeconds:true},
  ]){
    assert.equal((await service.deliverSmartNotification(bad,{})).state,'invalid');
  }
  assert.equal(rpcCalls,0);
  assert.equal(sends,0);
});

test('truthy non-boolean Supabase availability fails closed before send',async()=>{
  let rpcCalls=0;
  let sends=0;
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=> 'true',
    supaRpc:async()=>{rpcCalls+=1;return {};},
    sendTelegramMessage:async()=>{sends+=1;return {ok:true,status:200,outcome:'sent'};},
  });
  assert.equal((await service.deliverSmartNotification(input(),{})).state,'persistence_ambiguous');
  assert.equal(rpcCalls,0);
  assert.equal(sends,0);
});

test('persistent claim requires strict allowed flag, reason and claim timestamp',async()=>{
  for(const claim of [
    {allowed:'true',reason:'created',claimAt:'2026-10-03T12:00:00.000Z'},
    {allowed:true,reason:'unknown',claimAt:'2026-10-03T12:00:00.000Z'},
    {allowed:true,reason:'created',claimAt:{toString:()=> '2026-10-03T12:00:00.000Z'}},
    {allowed:true,reason:'created',claimAt:'not-a-time'},
  ]){
    let sends=0;
    const service=createSmartNotificationDeliveryService({
      memory:{},
      hasSupabase:()=>true,
      supaRpc:async(_cfg,name)=>{
        if(name==='claim_smart_notification_delivery') return claim;
        throw new Error('must not reach '+name);
      },
      sendTelegramMessage:async()=>{sends+=1;return {ok:true,status:200,outcome:'sent'};},
    });
    assert.equal((await service.deliverSmartNotification(input(),{})).state,'persistence_ambiguous');
    assert.equal(sends,0);
  }
});

test('pre-send RPC requires strict started confirmation',async()=>{
  let sends=0;
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>true,
    supaRpc:async(_cfg,name)=>{
      if(name==='claim_smart_notification_delivery') {
        return {allowed:true,reason:'created',claimAt:'2026-10-03T12:00:00.000Z'};
      }
      if(name==='begin_smart_notification_delivery_send') {
        return {started:'true',reason:'sending'};
      }
      throw new Error('unexpected rpc '+name);
    },
    sendTelegramMessage:async()=>{sends+=1;return {ok:true,status:200,outcome:'sent'};},
  });
  assert.equal((await service.deliverSmartNotification(input(),{})).state,'persistence_ambiguous');
  assert.equal(sends,0);
});

test('finalize requires updated true and finalized reason',async()=>{
  const runtime=supabaseRuntime({finalizeResult:{updated:true}});
  assert.equal((await runtime.service.deliverSmartNotification(input(),{})).state,'sent_unconfirmed');
  assert.equal(runtime.sends,1);
});

test('truthy Telegram ok is ambiguous and never becomes automatic retry',async()=>{
  let finalizedStatus='';
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>true,
    supaRpc:async(_cfg,name,args)=>{
      if(name==='claim_smart_notification_delivery') {
        return {allowed:true,reason:'created',claimAt:'2026-10-03T12:00:00.000Z'};
      }
      if(name==='begin_smart_notification_delivery_send') return {started:true,reason:'sending'};
      if(name==='finalize_smart_notification_delivery') {
        finalizedStatus=args.p_status;
        return {updated:true,reason:'finalized'};
      }
      throw new Error('unexpected rpc '+name);
    },
    sendTelegramMessage:async()=>({ok:'true',status:200}),
  });
  const result=await service.deliverSmartNotification(input(),{});
  assert.equal(result.state,'unknown');
  assert.equal(finalizedStatus,'unknown');
});

test('malformed Telegram result is finalized unknown rather than retry_pending',async()=>{
  let finalizedStatus='';
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>true,
    supaRpc:async(_cfg,name,args)=>{
      if(name==='claim_smart_notification_delivery') {
        return {allowed:true,reason:'created',claimAt:'2026-10-03T12:00:00.000Z'};
      }
      if(name==='begin_smart_notification_delivery_send') return {started:true,reason:'sending'};
      if(name==='finalize_smart_notification_delivery') {
        finalizedStatus=args.p_status;
        return {updated:true,reason:'finalized'};
      }
      throw new Error('unexpected rpc '+name);
    },
    sendTelegramMessage:async()=>({}),
  });
  assert.equal((await service.deliverSmartNotification(input(),{})).state,'unknown');
  assert.equal(finalizedStatus,'unknown');
});

test('confirmed Telegram retry_after is bounded to database contract',async()=>{
  let retryAfter=0;
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>true,
    supaRpc:async(_cfg,name,args)=>{
      if(name==='claim_smart_notification_delivery') {
        return {allowed:true,reason:'created',claimAt:'2026-10-03T12:00:00.000Z'};
      }
      if(name==='begin_smart_notification_delivery_send') return {started:true,reason:'sending'};
      if(name==='finalize_smart_notification_delivery') {
        retryAfter=args.p_retry_after_seconds;
        return {updated:true,reason:'finalized'};
      }
      throw new Error('unexpected rpc '+name);
    },
    sendTelegramMessage:async()=>({
      ok:false,
      outcome:'confirmed_failure',
      status:429,
      errorCode:429,
      retryAfter:'999999',
      description:'Too Many Requests',
    }),
  });
  assert.equal((await service.deliverSmartNotification(input(),{})).state,'retry_pending');
  assert.equal(retryAfter,86400);
});

test('observability failure never changes delivery result',async()=>{
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>false,
    supaRpc:async()=>{throw new Error('unexpected rpc');},
    sendTelegramMessage:async()=>({ok:true,status:200,outcome:'sent'}),
    recordOpsEvent:()=>{throw new Error('ops unavailable');},
  });
  assert.equal((await service.deliverSmartNotification(input(),{})).state,'sent');
});

test('successful Telegram send with finalize updated:false is not reported as safely finalized or resent', async()=>{
  const runtime=supabaseRuntime({finalizeResult:{updated:false}});
  assert.equal((await runtime.service.deliverSmartNotification(input(),{})).state,'sent_unconfirmed');
  assert.equal((await runtime.service.deliverSmartNotification(input(),{})).state,'duplicate');
  assert.equal(runtime.sends,1);
  assert.ok(runtime.events.some(event=>event.code==='SMART_NOTIFICATION_SENT_PERSISTENCE_AMBIGUOUS'));
});

test('successful Telegram send with finalize exception remains resend-suppressed', async()=>{
  const runtime=supabaseRuntime({finalizeThrows:true});
  assert.equal((await runtime.service.deliverSmartNotification(input(),{})).state,'sent_unconfirmed');
  assert.equal((await runtime.service.deliverSmartNotification(input(),{})).state,'duplicate');
  assert.equal(runtime.sends,1);
});

test('delivery never reaches Telegram when pre-send ownership transition is not confirmed', async()=>{
  const runtime=supabaseRuntime({beginResult:{started:false,reason:'claim_lost'}});
  assert.equal((await runtime.service.deliverSmartNotification(input(),{})).state,'persistence_ambiguous');
  assert.equal(runtime.sends,0);
  assert.ok(runtime.events.some(event=>event.code==='SMART_NOTIFICATION_SEND_NOT_STARTED'));
});

test('maximum-attempt guard stops delivery before Telegram', async()=>{
  const runtime=supabaseRuntime({beginResult:{started:false,reason:'max_retries'}});
  assert.equal((await runtime.service.deliverSmartNotification(input(),{})).state,'failed');
  assert.equal(runtime.sends,0);
  assert.ok(runtime.events.some(event=>event.code==='SMART_NOTIFICATION_MAX_RETRIES'));
});

test('memory retry state with malformed retry timestamp fails closed',async()=>{
  const memory={smartNotificationDeliveries:new Map([[
    '42:v1:420:match.goal:55',
    {
      userId:42,
      fixtureId:420,
      eventType:'match.goal',
      category:'match',
      dedupeKey:'v1:420:match.goal:55',
      status:'retry_pending',
      attempts:1,
      claimedAt:'2026-10-03T12:00:00.000Z',
      retryAt:{toString:()=> '2026-10-03T12:01:00.000Z'},
      createdAt:'2026-10-03T12:00:00.000Z',
      updatedAt:'2026-10-03T12:00:00.000Z',
    },
  ]])};
  let sends=0;
  const service=createSmartNotificationDeliveryService({
    memory,
    hasSupabase:()=>false,
    supaRpc:async()=>{throw new Error('unexpected rpc');},
    sendTelegramMessage:async()=>{sends+=1;return {ok:true,status:200,outcome:'sent'};},
    now:()=>Date.parse('2026-10-03T12:10:00.000Z'),
  });
  assert.equal((await service.deliverSmartNotification(input(),{})).state,'persistence_ambiguous');
  assert.equal(sends,0);
});

test('transport exception is treated as unknown outcome instead of confirmed retryable failure', async()=>{
  let finalizedStatus='';
  let sends=0;
  const service=createSmartNotificationDeliveryService({
    memory:{},
    hasSupabase:()=>true,
    supaRpc:async(_cfg,name,args)=>{
      if (name==='claim_smart_notification_delivery') return {allowed:true,reason:'created',claimAt:'2026-10-03T12:00:00.000Z',attempts:1};
      if (name==='begin_smart_notification_delivery_send') return {started:true,reason:'sending'};
      if (name==='finalize_smart_notification_delivery') {
        finalizedStatus=args.p_status;
        return {updated:true,reason:'finalized'};
      }
      throw new Error('unexpected rpc '+name);
    },
    sendTelegramMessage:async()=>{
      sends += 1;
      throw new Error('socket reset after write');
    },
    recordOpsEvent:async()=>{},
  });
  assert.equal((await service.deliverSmartNotification(input(),{})).state,'unknown');
  assert.equal(sends,1);
  assert.equal(finalizedStatus,'unknown');
});

test('delivery constructor validates required boundary dependencies',()=>{
  assert.throws(()=>createSmartNotificationDeliveryService({}),/hasSupabase is required/);
  assert.throws(()=>createSmartNotificationDeliveryService({
    hasSupabase:()=>false,
  }),/supaRpc is required/);
  assert.throws(()=>createSmartNotificationDeliveryService({
    hasSupabase:()=>false,
    supaRpc:async()=>{},
  }),/sendTelegramMessage is required/);
  assert.throws(()=>createSmartNotificationDeliveryService({
    memory:[],
    hasSupabase:()=>false,
    supaRpc:async()=>{},
    sendTelegramMessage:async()=>({}),
  }),/memory must be a plain object/);
});

test('v6.25.1 migration adds pre-send CAS, permanent ambiguous-send suppression and bounded attempts',()=>{
  const sql=fs.readFileSync('supabase/migrations/supabase_migration_v6_25_1.sql','utf8');
  assert.match(sql,/status in \('claimed','sending','sent','retry_pending','unknown','terminal_failed'\)/);
  assert.match(sql,/create or replace function public\.begin_smart_notification_delivery_send/);
  assert.match(sql,/status = 'claimed'[\s\S]*claimed_at = p_claimed_at[\s\S]*for update/);
  assert.match(sql,/v_attempts > v_max_attempts/);
  assert.match(sql,/set status = 'sending'/);
  assert.match(sql,/status in \('claimed','sending'\)/);
  assert.match(sql,/begin_smart_notification_delivery_send'[\s\S]*activate_pass_entitlement/);
});
