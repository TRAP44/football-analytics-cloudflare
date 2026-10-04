import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramDedupeRuntime } from '../src/telegram-dedupe.js';
import { createTelegramWebhookHandler } from '../src/telegram-transport.js';
import {
  beginTelegramWebhookAttempt,
  classifyTelegramWebhookFailure,
  markTelegramWebhookEffect,
} from '../src/telegram-webhook-retry.js';

function runtime({ hasSupabase = true, supaRpc = async () => { throw new Error('offline'); } } = {}) {
  const telemetry = [];
  const memory = {
    telegramUpdateDedupe: new Map(),
    telegramBurst: new Map(),
  };
  const api = createTelegramDedupeRuntime({
    memory,
    pruneMemoryState: () => {},
    bumpTelemetry: key => telemetry.push(key),
    hasSupabase: () => hasSupabase,
    supaRpc,
    redactOpsString: value => String(value || '').slice(0, 160),
  });
  return { api, memory, telemetry };
}

test('Issue #434 classifies billing, mutation, callback side effects and harmless reads', () => {
  const { api } = runtime();
  assert.deepEqual(
    api.telegramUpdateDedupeRisk({pre_checkout_query:{id:'q'}}),
    {kind:'billing',highRisk:true},
  );
  assert.deepEqual(
    api.telegramUpdateDedupeRisk({callback_query:{data:'digest:on'}}),
    {kind:'idempotent_mutation',highRisk:true},
  );
  assert.deepEqual(
    api.telegramUpdateDedupeRisk({callback_query:{data:'match:review:44'}}),
    {kind:'external_side_effect',highRisk:true},
  );
  assert.deepEqual(
    api.telegramUpdateDedupeRisk({message:{text:'/today'}}),
    {kind:'read_only',highRisk:false},
  );
});

test('Issue #434 two independent isolates both fail closed for the same high-risk update during dedupe outage', async () => {
  const update={update_id:43401,callback_query:{id:'cb-434',data:'favorite:toggle:10:20'}};
  const cfg={botToken:'111111111:test-secret'};
  const first=runtime();
  const second=runtime();

  const localA=first.api.claimTelegramUpdate(update,cfg);
  const localB=second.api.claimTelegramUpdate(update,cfg);
  assert.equal(localA.duplicate,false);
  assert.equal(localB.duplicate,false);

  const [persistentA,persistentB]=await Promise.all([
    first.api.claimTelegramUpdatePersistent(cfg,localA.key,update),
    second.api.claimTelegramUpdatePersistent(cfg,localB.key,update),
  ]);

  for (const result of [persistentA,persistentB]) {
    assert.equal(result.claimed,false);
    assert.equal(result.duplicate,false);
    assert.equal(result.status,'fail_closed');
    assert.equal(result.retry,true);
    assert.equal(result.risk,'idempotent_mutation');
  }
  assert.ok(first.telemetry.includes('telegramPersistentDedupeUnavailable'));
  assert.ok(first.telemetry.includes('telegramDedupeFailClosedHighRisk'));
});

test('Issue #434 harmless read-only updates keep bounded local fallback during persistent outage', async () => {
  const update={update_id:43402,message:{chat:{id:1},message_id:2,text:'/today'}};
  const cfg={botToken:'111111111:test-secret'};
  const first=runtime();
  const second=runtime();
  const a=first.api.claimTelegramUpdate(update,cfg);
  const b=second.api.claimTelegramUpdate(update,cfg);

  assert.deepEqual(
    await first.api.claimTelegramUpdatePersistent(cfg,a.key,update),
    {persistent:false,claimed:true,duplicate:false,status:'fallback'},
  );
  assert.deepEqual(
    await second.api.claimTelegramUpdatePersistent(cfg,b.key,update),
    {persistent:false,claimed:true,duplicate:false,status:'fallback'},
  );
  assert.ok(first.telemetry.includes('telegramDedupeSafeFallbacks'));
});

test('Issue #434 transport retries before processing a high-risk update and releases local claim', async () => {
  let processed=0;
  let released='';
  const handler=createTelegramWebhookHandler({
    claimTelegramUpdate:()=>({key:'b:id-111111111:u:43403',duplicate:false}),
    claimTelegramUpdatePersistent:async ()=>({
      persistent:false,
      claimed:false,
      duplicate:false,
      status:'fail_closed',
      retry:true,
      retryAfter:3,
      risk:'billing',
    }),
    completeTelegramUpdate:()=>{},
    completeTelegramUpdatePersistent:async()=>true,
    constantTimeEqual:(a,b)=>a===b,
    enforceTelegramBurst:()=>null,
    json:(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers}),
    processTelegramUpdate:async()=>{ processed+=1; return new Response('{}'); },
    releaseTelegramUpdate:key=>{ released=key; },
    releaseTelegramUpdatePersistent:async()=>true,
    telegramApi:async()=>true,
  });
  const request=new Request('https://example.test/telegram/webhook',{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-telegram-bot-api-secret-token':'secret',
    },
    body:JSON.stringify({update_id:43403,message:{successful_payment:{telegram_payment_charge_id:'x'}}}),
  });

  await assert.rejects(
    ()=>handler(request,{webhookSecret:'secret'}),
    error=>{
      assert.equal(error.code,'TELEGRAM_DEDUPE_UNAVAILABLE');
      assert.equal(error.telegramWebhookRetry,true);
      assert.equal(error.telegramWebhookDisposition.retry,true);
      assert.equal(error.telegramWebhookDisposition.dedupeRisk,'billing');
      return true;
    },
  );
  assert.equal(processed,0);
  assert.equal(released,'b:id-111111111:u:43403');
});

test('Issue #434 dedupe retry stays suppressed if a side effect has already happened', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  markTelegramWebhookEffect(cfg,'sendMessage');
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('dedupe unavailable'),{
      code:'TELEGRAM_DEDUPE_UNAVAILABLE',
      telegramWebhookRetrySafe:true,
    }),
    cfg,
  );
  assert.equal(result.transient,true);
  assert.equal(result.retry,false);
  assert.equal(result.successfulEffects,1);
});
