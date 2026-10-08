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

test('persistent duplicate keeps persistent compatibility marker without completing another isolate claim', async () => {
  let persistentCompletes=0;
  const handler=createTelegramWebhookHandler(deps({
    claimTelegramUpdatePersistent:async()=>({claimed:false,duplicate:true,persistent:true}),
    completeTelegramUpdatePersistent:async()=>{ persistentCompletes+=1; return true; },
  }));
  const result=await handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'});
  assert.deepEqual(result.body,{ok:true,deduped:true,persistent:true});
  assert.equal(persistentCompletes,0);
});

test('successful processing completes both memory and persistent claims', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    completeTelegramUpdate:key=>events.push(['memory',key]),
    completeTelegramUpdatePersistent:async(_cfg,key)=>{ events.push(['persistent',key]); return true; },
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


test('Telegram transport rejects malformed dependency bags at construction time', () => {
  assert.throws(
    () => createTelegramWebhookHandler(null),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelegramWebhookHandler([]),
    /dependencies are required/,
  );
});

test('persistent claim exceptions release only the local claim because durable ownership is unknown', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    claimTelegramUpdatePersistent:async()=>{ throw new Error('rpc timeout'); },
    releaseTelegramUpdate:key=>events.push(['memory-release',key]),
    releaseTelegramUpdatePersistent:async(_cfg,key)=>{
      events.push(['persistent-release',key]);
      return true;
    },
  }));

  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),{
      webhookSecret:'secret',
      telegramWebhookAttempt:{
        active:true,
        successfulEffects:5,
        unsafeMutations:3,
      },
    }),
    error=>error?.telegramWebhookRetry===true
      && error?.telegramWebhookDisposition?.successfulEffects===0
      && error?.telegramWebhookDisposition?.unsafeMutations===0,
  );
  assert.deepEqual(events,[['memory-release','u:1']]);
});

test('malformed persistent claim fails closed before update processing', async () => {
  let processed=0;
  let localReleased=0;
  const handler=createTelegramWebhookHandler(deps({
    claimTelegramUpdatePersistent:async()=>({claimed:'yes',duplicate:false}),
    processTelegramUpdate:async()=>{ processed+=1; return responseJson({ok:true}); },
    releaseTelegramUpdate:()=>{ localReleased+=1; },
  }));

  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'}),
    error=>error?.code==='TELEGRAM_DEDUPE_UNAVAILABLE'
      && error?.telegramWebhookRetry===true,
  );
  assert.equal(processed,0);
  assert.equal(localReleased,1);
});

test('invalid processor response is retryable before side effects and releases owned claims', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    processTelegramUpdate:async()=>undefined,
    releaseTelegramUpdate:key=>events.push(['memory-release',key]),
    releaseTelegramUpdatePersistent:async(_cfg,key)=>{
      events.push(['persistent-release',key]);
      return true;
    },
  }));

  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'}),
    error=>error?.code==='TELEGRAM_UPSTREAM'
      && error?.telegramWebhookRetry===true,
  );
  assert.deepEqual(events,[['memory-release','u:1'],['persistent-release','u:1']]);
});

test('failed durable completion after successful processing keeps dedupe claims in place for retry absorption', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    claimTelegramUpdatePersistent:async()=>({persistent:true,claimed:true,duplicate:false}),
    completeTelegramUpdate:key=>events.push(['memory-complete',key]),
    completeTelegramUpdatePersistent:async(_cfg,key)=>{
      events.push(['persistent-complete',key]);
      return false;
    },
    releaseTelegramUpdate:key=>events.push(['memory-release',key]),
    releaseTelegramUpdatePersistent:async(_cfg,key)=>{
      events.push(['persistent-release',key]);
      return true;
    },
  }));

  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'}),
    error=>error?.code==='TELEGRAM_DEDUPE_UNAVAILABLE'
      && error?.telegramWebhookRetry===true,
  );
  assert.deepEqual(events,[
    ['memory-complete','u:1'],
    ['persistent-complete','u:1'],
  ]);
});

test('failed durable completion after a Telegram effect suppresses retry and still keeps claims', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    claimTelegramUpdatePersistent:async()=>({persistent:true,claimed:true,duplicate:false}),
    processTelegramUpdate:async(_request,activeCfg)=>{
      markTelegramWebhookEffect(activeCfg,'sendMessage');
      return responseJson({ok:true});
    },
    completeTelegramUpdate:key=>events.push(['memory-complete',key]),
    completeTelegramUpdatePersistent:async(_cfg,key)=>{
      events.push(['persistent-complete',key]);
      return false;
    },
    releaseTelegramUpdate:key=>events.push(['memory-release',key]),
    releaseTelegramUpdatePersistent:async(_cfg,key)=>{
      events.push(['persistent-release',key]);
      return true;
    },
  }));

  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'}),
    error=>error?.code==='TELEGRAM_DEDUPE_UNAVAILABLE'
      && error?.telegramWebhookRetry===false
      && error?.telegramWebhookDisposition?.successfulEffects===1,
  );
  assert.deepEqual(events,[
    ['memory-complete','u:1'],
    ['persistent-complete','u:1'],
  ]);
});

test('real Request bodies are bounded before Telegram update parsing', async () => {
  let claimed=0;
  const handler=createTelegramWebhookHandler(deps({
    claimTelegramUpdate:()=>{
      claimed+=1;
      return {key:'u:1',duplicate:false};
    },
  }));
  const request=new Request('https://example.test/telegram/webhook',{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-telegram-bot-api-secret-token':'secret',
      'content-length':'1048577',
    },
    body:'{}',
  });

  const result=await handler(request,{webhookSecret:'secret'});
  assert.equal(result.status,413);
  assert.deepEqual(result.body,{ok:false,error:'update_too_large'});
  assert.equal(claimed,0);
});


test('invalid processor response after an unsafe mutation suppresses replay', async () => {
  const events=[];
  const handler=createTelegramWebhookHandler(deps({
    processTelegramUpdate:async(_request,activeCfg)=>{
      markTelegramWebhookMutation(activeCfg,'favorite_toggle');
      return undefined;
    },
    completeTelegramUpdate:key=>events.push(['memory-complete',key]),
    completeTelegramUpdatePersistent:async(_cfg,key)=>{
      events.push(['persistent-complete',key]);
      return true;
    },
    releaseTelegramUpdate:key=>events.push(['memory-release',key]),
    releaseTelegramUpdatePersistent:async(_cfg,key)=>{
      events.push(['persistent-release',key]);
      return true;
    },
  }));

  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'}),
    error=>error?.code==='TELEGRAM_UPSTREAM'
      && error?.telegramWebhookRetry===false
      && error?.telegramWebhookDisposition?.unsafeMutations===1,
  );
  assert.deepEqual(events,[
    ['memory-complete','u:1'],
    ['persistent-complete','u:1'],
  ]);
});

test('burst guard failures retry before processing and release owned claims', async () => {
  const events=[];
  let processed=0;
  const handler=createTelegramWebhookHandler(deps({
    enforceTelegramBurst:()=>{ throw new Error('burst storage failed'); },
    processTelegramUpdate:async()=>{
      processed+=1;
      return responseJson({ok:true});
    },
    releaseTelegramUpdate:key=>events.push(['memory-release',key]),
    releaseTelegramUpdatePersistent:async(_cfg,key)=>{
      events.push(['persistent-release',key]);
      return true;
    },
  }));

  await assert.rejects(
    handler(requestFor('secret',{update_id:1}),{webhookSecret:'secret'}),
    error=>error?.code==='TELEGRAM_UPSTREAM'
      && error?.telegramWebhookRetry===true,
  );
  assert.equal(processed,0);
  assert.deepEqual(events,[
    ['memory-release','u:1'],
    ['persistent-release','u:1'],
  ]);
});

test('throttled updates fail closed when their durable completion marker cannot be written', async () => {
  let callbackAnswers=0;
  const handler=createTelegramWebhookHandler(deps({
    enforceTelegramBurst:()=>({blocked:true,retryAfter:4}),
    completeTelegramUpdatePersistent:async()=>false,
    telegramApi:async()=>{
      callbackAnswers+=1;
      return {};
    },
  }));

  await assert.rejects(
    handler(
      requestFor('secret',{update_id:1,callback_query:{id:'cb-1'}}),
      {webhookSecret:'secret'},
    ),
    error=>error?.code==='TELEGRAM_DEDUPE_UNAVAILABLE'
      && error?.telegramWebhookRetry===true,
  );
  assert.equal(callbackAnswers,0);
});
