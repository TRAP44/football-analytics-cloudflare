import test from 'node:test';
import assert from 'node:assert/strict';
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
