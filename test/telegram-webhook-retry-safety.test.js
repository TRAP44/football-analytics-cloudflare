import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  beginTelegramWebhookAttempt,
  classifyTelegramWebhookFailure,
  endTelegramWebhookAttempt,
  markTelegramWebhookEffect,
  markTelegramWebhookMutation,
} from '../src/telegram-webhook-retry.js';

test('retry classifier allows only transient failures before any side effect', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  const error=Object.assign(new Error('network'),{code:'TELEGRAM_NETWORK'});
  assert.deepEqual(
    classifyTelegramWebhookFailure(error,cfg),
    {
      retry:true,
      transient:true,
      retrySafe:false,
      code:'TELEGRAM_NETWORK',
      retryAfter:0,
      successfulEffects:0,
      unsafeMutations:0,
      lastEffect:'',
      lastMutation:'',
    },
  );
  endTelegramWebhookAttempt(cfg);
});

test('successful Telegram effects suppress webhook retries', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  assert.equal(markTelegramWebhookEffect(cfg,'sendMessage'),true);
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('timeout'),{code:'TELEGRAM_TIMEOUT',retryAfter:7}),
    cfg,
  );
  assert.equal(result.retry,false);
  assert.equal(result.transient,true);
  assert.equal(result.successfulEffects,1);
  assert.equal(result.retryAfter,7);
  assert.equal(result.lastEffect,'sendMessage');
});

test('unsafe user mutations suppress webhook retries', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  assert.equal(markTelegramWebhookMutation(cfg,'billing_payment'),true);
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('upstream'),{code:'TELEGRAM_UPSTREAM'}),
    cfg,
  );
  assert.equal(result.retry,false);
  assert.equal(result.unsafeMutations,1);
  assert.equal(result.lastMutation,'billing_payment');
});

test('explicit retry-safe reconciliation can retry after idempotent internal mutations', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  assert.equal(markTelegramWebhookMutation(cfg,'billing_refund'),true);
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('supabase unavailable'),{
      code:'BILLING_REFUND_RECONCILIATION',
      telegramWebhookRetrySafe:true,
    }),
    cfg,
  );
  assert.equal(result.retry,true);
  assert.equal(result.transient,false);
  assert.equal(result.retrySafe,true);
  assert.equal(result.unsafeMutations,1);
  assert.equal(result.lastMutation,'billing_refund');
});


test('arbitrary errors cannot self-authorize retry-safe replay', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  markTelegramWebhookMutation(cfg,'favorite_toggle');

  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('custom failure'),{
      code:'CUSTOM_RETRY_ME',
      telegramWebhookRetrySafe:true,
    }),
    cfg,
  );
  assert.equal(result.retrySafe,false);
  assert.equal(result.retry,false);
  assert.equal(result.unsafeMutations,1);
});

test('dedupe unavailability remains explicitly retry-safe before processing begins', () => {
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('dedupe offline'),{
      code:'TELEGRAM_DEDUPE_UNAVAILABLE',
      telegramWebhookRetrySafe:true,
      retryAfter:3,
    }),
    {},
  );
  assert.equal(result.retrySafe,true);
  assert.equal(result.retry,true);
  assert.equal(result.retryAfter,3);
});

test('retry-safe reconciliation still cannot retry after an external Telegram side effect', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  markTelegramWebhookEffect(cfg,'sendMessage');
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('reconcile'),{
      code:'BILLING_REFUND_RECONCILIATION',
      telegramWebhookRetrySafe:true,
    }),
    cfg,
  );
  assert.equal(result.retry,false);
  assert.equal(result.retrySafe,true);
  assert.equal(result.successfulEffects,1);
});

test('permanent Telegram rejection never retries even without side effects', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('bad request'),{code:'TELEGRAM_REJECTED'}),
    cfg,
  );
  assert.equal(result.retry,false);
  assert.equal(result.transient,false);
});


test('worker tracks only side-effecting Telegram API methods for retry suppression', () => {
  const worker = fs.readFileSync('src/worker.js','utf8');
  assert.match(worker, /!\/\^get\[A-Z\]\//);
  assert.match(worker, /markTelegramWebhookEffect\(cfg, method\)/);
});


test('nested webhook attempt initialization never erases already recorded effects', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  assert.equal(markTelegramWebhookEffect(cfg,'sendMessage'),true);
  beginTelegramWebhookAttempt(cfg);

  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('timeout'),{code:'TELEGRAM_TIMEOUT'}),
    cfg,
  );
  assert.equal(result.retry,false);
  assert.equal(result.successfulEffects,1);
  assert.equal(result.lastEffect,'sendMessage');
});

test('public retry state tampering cannot erase the internal side-effect ledger', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  markTelegramWebhookEffect(cfg,'sendMessage');

  cfg.telegramWebhookAttempt={
    active:true,
    successfulEffects:0,
    unsafeMutations:0,
    lastEffect:'',
    lastMutation:'',
  };

  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('network'),{code:'TELEGRAM_NETWORK'}),
    cfg,
  );
  assert.equal(result.retry,false);
  assert.equal(result.successfulEffects,1);
  assert.equal(result.lastEffect,'sendMessage');
});

test('frozen public retry state does not prevent mutation tracking', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  Object.freeze(cfg.telegramWebhookAttempt);

  assert.equal(markTelegramWebhookMutation(cfg,'favorite_toggle'),true);
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('upstream'),{code:'TELEGRAM_UPSTREAM'}),
    cfg,
  );
  assert.equal(result.retry,false);
  assert.equal(result.unsafeMutations,1);
  assert.equal(result.lastMutation,'favorite_toggle');
});

test('frozen config still tracks side effects through the internal WeakMap ledger', () => {
  const cfg=Object.freeze({});
  assert.ok(beginTelegramWebhookAttempt(cfg));
  assert.equal(markTelegramWebhookEffect(cfg,'sendMessage'),true);

  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('timeout'),{code:'TELEGRAM_TIMEOUT'}),
    cfg,
  );
  assert.equal(result.retry,false);
  assert.equal(result.successfulEffects,1);
});

test('malformed externally supplied attempt state fails closed', () => {
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('network'),{code:'TELEGRAM_NETWORK'}),
    {telegramWebhookAttempt:'corrupted'},
  );
  assert.equal(result.retry,false);
  assert.ok(result.successfulEffects>0);
  assert.ok(result.unsafeMutations>0);
});

test('retry-safe flag cannot override corrupted attempt counters', () => {
  const cfg={
    telegramWebhookAttempt:{
      active:true,
      successfulEffects:'broken',
      unsafeMutations:0,
      lastEffect:'',
      lastMutation:'',
    },
  };
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('reconcile'),{
      code:'BILLING_REFUND_RECONCILIATION',
      telegramWebhookRetrySafe:true,
    }),
    cfg,
  );
  assert.equal(result.retrySafe,true);
  assert.equal(result.retry,false);
});

test('retry classifier tolerates hostile error property getters', () => {
  const error={};
  Object.defineProperty(error,'code',{get(){throw new Error('code getter');}});
  Object.defineProperty(error,'retryAfter',{get(){throw new Error('retry getter');}});
  Object.defineProperty(error,'telegramWebhookRetrySafe',{get(){throw new Error('safe getter');}});

  const result=classifyTelegramWebhookFailure(error,{});
  assert.equal(result.retry,false);
  assert.equal(result.transient,false);
  assert.equal(result.retrySafe,false);
  assert.equal(result.code,'TELEGRAM_WEBHOOK_FAILURE');
  assert.equal(result.retryAfter,0);
});

test('labels and retry-after values are bounded before observability output', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  markTelegramWebhookEffect(cfg,'sendMessage\nspoofed');

  const capped=classifyTelegramWebhookFailure(
    Object.assign(new Error('rate limit'),{
      code:'TELEGRAM_RATE_LIMIT',
      retryAfter:999999,
    }),
    cfg,
  );
  assert.equal(capped.retry,false);
  assert.equal(capped.lastEffect,'');
  assert.equal(capped.retryAfter,86400);

  const clean={};
  beginTelegramWebhookAttempt(clean);
  const oversized=classifyTelegramWebhookFailure(
    Object.assign(new Error('rate limit'),{
      code:'TELEGRAM_RATE_LIMIT',
      retryAfter:'9'.repeat(1000),
    }),
    clean,
  );
  assert.equal(oversized.retry,true);
  assert.equal(oversized.retryAfter,0);
});

test('ending a webhook attempt is idempotent and blocks later markers and retries', () => {
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  const first=endTelegramWebhookAttempt(cfg);
  const second=endTelegramWebhookAttempt(cfg);

  assert.equal(first.active,false);
  assert.equal(second.active,false);
  assert.equal(markTelegramWebhookEffect(cfg,'sendMessage'),false);
  assert.equal(markTelegramWebhookMutation(cfg,'favorite_toggle'),false);

  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('timeout'),{code:'TELEGRAM_TIMEOUT'}),
    cfg,
  );
  assert.equal(result.retry,false);
});

test('forged public attempt state cannot authorize a webhook retry', () => {
  const cfg={
    telegramWebhookAttempt:{
      active:true,
      startedAt:Date.now(),
      successfulEffects:0,
      unsafeMutations:0,
      lastEffect:'',
      lastMutation:'',
    },
  };

  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('network'),{code:'TELEGRAM_NETWORK'}),
    cfg,
  );
  assert.equal(result.retry,false);
  assert.equal(result.transient,true);
});

test('a retry-safe error cannot override an already completed Telegram side effect',()=>{
  const cfg={};
  beginTelegramWebhookAttempt(cfg);
  markTelegramWebhookEffect(cfg,'sendMessage');
  const result=classifyTelegramWebhookFailure(
    Object.assign(new Error('refund reconciliation'),{
      code:'BILLING_REFUND_RECONCILIATION',
      telegramWebhookRetrySafe:true,
      retryAfter:5,
    }),
    cfg,
  );
  assert.equal(result.retrySafe,true);
  assert.equal(result.retry,false);
  assert.equal(result.successfulEffects,1);
  assert.equal(result.retryAfter,5);
  endTelegramWebhookAttempt(cfg);
});
