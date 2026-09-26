import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramWebhookHandler } from '../src/telegram-transport.js';

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

test('processing failure releases both claims and preserves thrown error', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    processTelegramUpdate:async()=>{throw new Error('boom');},
    releaseTelegramUpdate:key=>events.push(['memory',key]),
    releaseTelegramUpdatePersistent:async(_cfg,key)=>events.push(['persistent',key]),
  }));
  await assert.rejects(handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'}),/boom/);
  assert.deepEqual(events,[['memory','u:1'],['persistent','u:1']]);
});
