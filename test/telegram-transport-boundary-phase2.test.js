import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramWebhookHandler } from '../src/telegram-transport.js';
import { markTelegramWebhookEffect, markTelegramWebhookMutation } from '../src/telegram-webhook-retry.js';

const responseJson = (body, status = 200) => ({ body, status });
const requestFor = (secret, update) => ({
  headers: { get: name => name === 'x-telegram-bot-api-secret-token' ? secret : '' },
  async json() { return update; },
});

function deps(overrides = {}) {
  return {
    json: responseJson,
    constantTimeEqual: (a,b) => a === b,
    claimTelegramUpdate: () => ({ key:'u:1', duplicate:false }),
    claimTelegramUpdatePersistent: async () => ({ claimed:true, duplicate:false }),
    completeTelegramUpdate: () => {},
    completeTelegramUpdatePersistent: async () => true,
    releaseTelegramUpdate: () => {},
    releaseTelegramUpdatePersistent: async () => true,
    enforceTelegramBurst: () => null,
    telegramApi: async () => ({}),
    processTelegramUpdate: async () => responseJson({ ok:true }),
    ...overrides,
  };
}

test('Telegram webhook rejects a wrong secret before processing update', async () => {
  let processed=false;
  const handler=createTelegramWebhookHandler(deps({processTelegramUpdate:async()=>{processed=true;}}));
  const result=await handler(requestFor('wrong',{update_id:1}),{webhookSecret:'right'});
  assert.equal(result.status,403);
  assert.equal(processed,false);
});

test('duplicate Telegram update returns compatibility response without processing', async () => {
  let processed=false;
  const handler=createTelegramWebhookHandler(deps({
    claimTelegramUpdate:()=>({key:'u:1',duplicate:true}),
    processTelegramUpdate:async()=>{processed=true;},
  }));
  const result=await handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'});
  assert.deepEqual(result.body,{ok:true,deduped:true});
  assert.equal(processed,false);
});

test('persistent duplicate keeps persistent compatibility marker', async () => {
  const handler=createTelegramWebhookHandler(deps({
    claimTelegramUpdatePersistent:async()=>({claimed:false,duplicate:true}),
  }));
  const result=await handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'});
  assert.deepEqual(result.body,{ok:true,deduped:true,persistent:true});
});

test('successful processing completes both memory and persistent claims', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    completeTelegramUpdate:key=>events.push(['memory',key]),
    completeTelegramUpdatePersistent:async(_cfg,key)=>events.push(['persistent',key]),
  }));
  const result=await handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'});
  assert.equal(result.status,200);
  assert.deepEqual(events,[['memory','u:1'],['persistent','u:1']]);
});

test('transient processing failure before side effects releases both claims for retry', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    processTelegramUpdate:async()=>{
      const error=new Error('network');
      error.code='TELEGRAM_NETWORK';
      throw error;
    },
    releaseTelegramUpdate:key=>events.push(['memory-release',key]),
    releaseTelegramUpdatePersistent:async(_cfg,key)=>events.push(['persistent-release',key]),
  }));
  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'}),
    error => error?.telegramWebhookRetry === true,
  );
  assert.deepEqual(events,[['memory-release','u:1'],['persistent-release','u:1']]);
});

test('permanent processing failure completes claims instead of inviting duplicate side effects', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    processTelegramUpdate:async()=>{throw new Error('bad request');},
    completeTelegramUpdate:key=>events.push(['memory-complete',key]),
    completeTelegramUpdatePersistent:async(_cfg,key)=>events.push(['persistent-complete',key]),
  }));
  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'}),
    error => error?.telegramWebhookRetry === false,
  );
  assert.deepEqual(events,[['memory-complete','u:1'],['persistent-complete','u:1']]);
});

test('transient failure after a successful Telegram effect completes claims and suppresses retry', async () => {
  const events=[];
  const cfg={webhookSecret:'secret'};
  const handler=createTelegramWebhookHandler(deps({
    processTelegramUpdate:async(_request,activeCfg)=>{
      markTelegramWebhookEffect(activeCfg,'sendMessage');
      const error=new Error('timeout');
      error.code='TELEGRAM_TIMEOUT';
      throw error;
    },
    completeTelegramUpdate:key=>events.push(['memory-complete',key]),
    completeTelegramUpdatePersistent:async(_cfg,key)=>events.push(['persistent-complete',key]),
  }));
  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),cfg),
    error => error?.telegramWebhookRetry === false
      && error?.telegramWebhookDisposition?.successfulEffects === 1,
  );
  assert.deepEqual(events,[['memory-complete','u:1'],['persistent-complete','u:1']]);
});

test('transient failure after a mutation completes claims and suppresses retry', async () => {
  const events=[];
  const cfg={webhookSecret:'secret'};
  const handler=createTelegramWebhookHandler(deps({
    processTelegramUpdate:async(_request,activeCfg)=>{
      markTelegramWebhookMutation(activeCfg,'digest_subscription');
      const error=new Error('upstream');
      error.code='TELEGRAM_UPSTREAM';
      throw error;
    },
    completeTelegramUpdate:key=>events.push(['memory-complete',key]),
    completeTelegramUpdatePersistent:async(_cfg,key)=>events.push(['persistent-complete',key]),
  }));
  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),cfg),
    error => error?.telegramWebhookRetry === false
      && error?.telegramWebhookDisposition?.unsafeMutations === 1,
  );
  assert.deepEqual(events,[['memory-complete','u:1'],['persistent-complete','u:1']]);
});
