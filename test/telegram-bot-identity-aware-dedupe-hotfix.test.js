import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTelegramWebhookHandler } from '../src/telegram-transport.js';
import {
  primaryTelegramBotStableIdentity,
  primaryTelegramUpdateDedupeKey,
} from '../src/telegram-primary-identity.js';

const identityModule = fs.readFileSync('src/telegram-primary-identity.js','utf8');
const worker = fs.readFileSync('src/worker.js','utf8');
const transport = fs.readFileSync('src/telegram-transport.js','utf8');

const TOKEN_A = '111111111:raw-secret-primary-a';
const TOKEN_B = '222222222:raw-secret-primary-b';
const TOKEN_B_ROTATED = '222222222:rotated-primary-secret';

test('bot A and bot B may claim the same Telegram update_id in separate identity namespaces', () => {
  const keyA = primaryTelegramUpdateDedupeKey(TOKEN_A,{update_id:123});
  const keyB = primaryTelegramUpdateDedupeKey(TOKEN_B,{update_id:123});

  assert.equal(primaryTelegramBotStableIdentity(TOKEN_A),'id-111111111');
  assert.equal(primaryTelegramBotStableIdentity(TOKEN_B),'id-222222222');
  assert.equal(keyA,'b:id-111111111:u:123');
  assert.equal(keyB,'b:id-222222222:u:123');
  assert.notEqual(keyA,keyB);
});

test('token rotation for the same Telegram bot keeps the stable dedupe identity', () => {
  assert.equal(
    primaryTelegramUpdateDedupeKey(TOKEN_B,{update_id:123}),
    primaryTelegramUpdateDedupeKey(TOKEN_B_ROTATED,{update_id:123}),
  );
});

test('callback and message fallback keys are identity-aware and never contain the raw token', () => {
  const callbackKey = primaryTelegramUpdateDedupeKey(TOKEN_B,{callback_query:{id:'callback-123'}});
  const messageKey = primaryTelegramUpdateDedupeKey(TOKEN_B,{message:{chat:{id:77},message_id:88}});

  assert.equal(callbackKey,'b:id-222222222:c:callback-123');
  assert.equal(messageKey,'b:id-222222222:m:77:88');
  for (const key of [callbackKey,messageKey,primaryTelegramUpdateDedupeKey(TOKEN_B,{update_id:123})]) {
    assert.equal(key.includes(TOKEN_B),false);
    assert.equal(key.includes('raw-secret-primary-b'),false);
  }
});

function createIsolate(sharedLedger, processCounter) {
  const local = new Map();

  const deps = {
    claimTelegramUpdate(update,cfg) {
      const key = primaryTelegramUpdateDedupeKey(cfg.botToken,update);
      if (!key) return {key:'',duplicate:false};
      if (local.has(key)) return {key,duplicate:true};
      local.set(key,{state:'processing'});
      return {key,duplicate:false};
    },
    async claimTelegramUpdatePersistent(_cfg,key) {
      if (!key) return {persistent:false,claimed:true,duplicate:false,status:'fallback'};
      if (sharedLedger.has(key)) return {persistent:true,claimed:false,duplicate:true,status:'duplicate'};
      sharedLedger.set(key,'processing');
      return {persistent:true,claimed:true,duplicate:false,status:'claimed'};
    },
    completeTelegramUpdate(key) {
      if (key) local.set(key,{state:'done'});
    },
    async completeTelegramUpdatePersistent(_cfg,key) {
      if (key) sharedLedger.set(key,'done');
      return true;
    },
    releaseTelegramUpdate(key) {
      if (key) local.delete(key);
    },
    async releaseTelegramUpdatePersistent(_cfg,key) {
      if (key) sharedLedger.delete(key);
      return true;
    },
    constantTimeEqual(a,b) {
      return String(a)===String(b);
    },
    enforceTelegramBurst() {
      return null;
    },
    json(data,status=200) {
      return new Response(JSON.stringify(data),{
        status,
        headers:{'content-type':'application/json'},
      });
    },
    async processTelegramUpdate() {
      processCounter.count += 1;
      return new Response(JSON.stringify({ok:true,processed:true}),{
        status:200,
        headers:{'content-type':'application/json'},
      });
    },
    async telegramApi() {
      return true;
    },
  };

  return createTelegramWebhookHandler(deps);
}

function webhookRequest(update) {
  return new Request('https://example.test/telegram/webhook',{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-telegram-bot-api-secret-token':'webhook-secret',
    },
    body:JSON.stringify(update),
  });
}

test('legacy keys do not block a migrated bot and persistent dedupe still works across Worker isolates', async () => {
  const sharedLedger = new Map([['u:123','done']]);
  const processCounter = {count:0};

  const isolateA = createIsolate(sharedLedger,processCounter);
  const responseA = await isolateA(webhookRequest({update_id:123,message:{chat:{id:1},message_id:1,text:'/start'}}),{
    botToken:TOKEN_A,
    webhookSecret:'webhook-secret',
  });
  assert.equal(responseA.status,200);
  assert.equal(processCounter.count,1);
  assert.equal(sharedLedger.get('b:id-111111111:u:123'),'done');

  const isolateB = createIsolate(sharedLedger,processCounter);
  const responseB = await isolateB(webhookRequest({update_id:123,message:{chat:{id:2},message_id:1,text:'/start'}}),{
    botToken:TOKEN_B,
    webhookSecret:'webhook-secret',
  });
  assert.equal(responseB.status,200);
  assert.equal(processCounter.count,2);
  assert.equal(sharedLedger.get('b:id-222222222:u:123'),'done');

  const freshIsolateB = createIsolate(sharedLedger,processCounter);
  const duplicateResponse = await freshIsolateB(webhookRequest({update_id:123,message:{chat:{id:2},message_id:1,text:'/start'}}),{
    botToken:TOKEN_B,
    webhookSecret:'webhook-secret',
  });
  const duplicateBody = await duplicateResponse.json();
  assert.equal(duplicateBody.deduped,true);
  assert.equal(duplicateBody.persistent,true);
  assert.equal(processCounter.count,2);
});

test('dedupe implementation does not log or persist the raw primary bot token', () => {
  assert.doesNotMatch(identityModule,/console\.(?:log|info|warn|error)/);
  assert.match(worker,/claimTelegramUpdate\(update,cfg\)/);
  assert.doesNotMatch(worker,/telegramUpdateDedupeKey\([^)]*cfg\.botToken\.slice/);
});
