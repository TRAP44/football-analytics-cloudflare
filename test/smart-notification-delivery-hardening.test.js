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

function supabaseRuntime({ finalizeResult={updated:true}, finalizeThrows=false, beginResult={started:true,reason:'sending'} } = {}) {
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
        return {updated:true};
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

test('v6.26 migration adds pre-send CAS, permanent ambiguous-send suppression and bounded attempts',()=>{
  const sql=fs.readFileSync('supabase/migrations/supabase_migration_v6_26.sql','utf8');
  assert.match(sql,/status in \('claimed','sending','sent','retry_pending','unknown','terminal_failed'\)/);
  assert.match(sql,/create or replace function public\.begin_smart_notification_delivery_send/);
  assert.match(sql,/status = 'claimed'[\s\S]*claimed_at = p_claimed_at[\s\S]*for update/);
  assert.match(sql,/v_attempts > v_max_attempts/);
  assert.match(sql,/set status = 'sending'/);
  assert.match(sql,/status in \('claimed','sending'\)/);
  assert.match(sql,/begin_smart_notification_delivery_send'[\s\S]*activate_pass_entitlement/);
});
