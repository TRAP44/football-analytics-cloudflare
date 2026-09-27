import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserAuthRuntime } from '../src/auth-user.js';

function createRuntime(overrides = {}) {
  const memory={users:new Map(),userSyncAt:new Map()};
  const validationCalls=[];
  const telemetry=[];
  const ops=[];
  const deps={
    memory,
    validateTelegramInitData:async(_data,_token,maxAge)=>{
      validationCalls.push(maxAge);
      return {id:42,username:'user'};
    },
    developmentTelegramId:999999999,
    hasSupabase:()=>false,
    supaUpsert:async()=>{},
    supaSelectOne:async()=>null,
    withSingleFlight:async(_key,fn)=>await fn(),
    pruneMemoryState:()=>{},
    bumpTelemetry:key=>telemetry.push(key),
    recordOpsEvent:async(_cfg,event)=>{ops.push(event);},
    ...overrides,
  };
  return {api:createUserAuthRuntime(deps),memory,validationCalls,telemetry,ops};
}

function request(path='/',method='GET',initData='signed') {
  return new Request('https://example.test'+path,{
    method,
    headers:{'x-telegram-init-data':initData},
  });
}

test('Phase 2 auth boundary preserves Telegram initData freshness windows',async()=>{
  const normal=createRuntime();
  await normal.api.getRequestUser(request('/api/matches','GET'),{botToken:'token',devMode:false});
  assert.equal(normal.validationCalls[0],24*60*60);

  const mutation=createRuntime();
  await mutation.api.getRequestUser(request('/api/favorites','POST'),{botToken:'token',devMode:false});
  assert.equal(mutation.validationCalls[0],2*60*60);

  const admin=createRuntime();
  await admin.api.getRequestUser(request('/api/diagnostics','GET'),{botToken:'token',devMode:false});
  assert.equal(admin.validationCalls[0],15*60);
});

test('Phase 2 auth boundary preserves validated and development identity semantics',async()=>{
  const valid=createRuntime();
  const user=await valid.api.getRequestUser(request(),{botToken:'token',devMode:false});
  assert.equal(user.id,42);
  assert.equal(user.__telegramValidated,true);

  const dev=createRuntime({validateTelegramInitData:async()=>null});
  const devUser=await dev.api.getRequestUser(request(),{botToken:'token',devMode:true});
  assert.equal(devUser.id,999999999);
  assert.equal(devUser.__developmentIdentity,true);
  assert.equal(devUser.__telegramValidated,false);
});

test('Phase 2 auth boundary keeps user persistence fail-soft after valid Telegram auth',async()=>{
  const rt=createRuntime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{throw new Error('db down');},
  });
  const user=await rt.api.getRequestUser(request(),{botToken:'token',devMode:false});
  assert.equal(user.id,42);
  assert.deepEqual(rt.telemetry,['supabaseErrors']);
  assert.equal(rt.ops[0].code,'USER_SYNC_DEGRADED');
});

test('Phase 2 auth boundary keeps local user storage and record fallback shape',async()=>{
  const rt=createRuntime();
  await rt.api.upsertUser({id:7,username:'seven'}, {});
  const row=await rt.api.getUserRecord(7,{});
  assert.equal(row.telegram_id,7);
  assert.equal(row.username,'seven');
  assert.equal(row.plan,'FREE');
});
