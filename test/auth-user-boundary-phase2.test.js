import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserAuthRuntime } from '../src/auth-user.js';
import { MAX_TELEGRAM_INIT_DATA_LENGTH } from '../src/security-gate.js';
import { adminSensitivePathInventory, requiresAdminAuthorizationPath } from '../src/security-route-registry.js';

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

function request(path='/',method='GET',initData='signed',origin='https://example.test') {
  return new Request(origin+path,{
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
  const devUser=await dev.api.getRequestUser(request('/','GET','signed','http://localhost:8787'),{botToken:'token',devMode:true});
  assert.equal(devUser.id,999999999);
  assert.equal(devUser.__developmentIdentity,true);
  assert.equal(devUser.__telegramValidated,false);
});

test('Phase 2 auth boundary requires strict boolean dev mode and a valid development id',async()=>{
  const stringFalse=createRuntime({validateTelegramInitData:async()=>null});
  assert.equal(
    await stringFalse.api.getRequestUser(
      request('/','GET','','http://localhost:8787'),
      {botToken:'token',devMode:'false'},
    ),
    null,
  );

  const invalidDevId=createRuntime({
    validateTelegramInitData:async()=>null,
    developmentTelegramId:0,
  });
  assert.equal(
    await invalidDevId.api.getRequestUser(
      request('/','GET','','http://localhost:8787'),
      {botToken:'token',devMode:true},
    ),
    null,
  );
});

test('Phase 2 auth boundary rejects malformed Telegram validator identities',async()=>{
  for (const id of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'not-a-user']) {
    const rt=createRuntime({validateTelegramInitData:async()=>({id,username:'bad'})});
    assert.equal(
      await rt.api.getRequestUser(request(),{botToken:'token',devMode:false}),
      null,
      String(id),
    );
  }
});

test('Phase 2 auth boundary fails closed when Telegram validation throws',async()=>{
  const rt=createRuntime({
    validateTelegramInitData:async()=>{
      throw new Error('validator unavailable');
    },
  });

  assert.equal(
    await rt.api.getRequestUser(request(),{botToken:'token',devMode:false}),
    null,
  );
  assert.equal(rt.memory.users.size,0);
});

test('Phase 2 local development may recover from validator failure only on localhost',async()=>{
  const local=createRuntime({
    validateTelegramInitData:async()=>{ throw new Error('validator unavailable'); },
  });
  const localUser=await local.api.getRequestUser(
    request('/','GET','signed','http://localhost:8787'),
    {botToken:'token',devMode:true},
  );
  assert.equal(localUser.id,999999999);
  assert.equal(localUser.__developmentIdentity,true);
  assert.equal(localUser.__telegramValidated,false);

  const remote=createRuntime({
    validateTelegramInitData:async()=>{ throw new Error('validator unavailable'); },
  });
  assert.equal(
    await remote.api.getRequestUser(
      request('/','GET','signed','https://example.test'),
      {botToken:'token',devMode:true},
    ),
    null,
  );
});

test('Phase 2 auth boundary rejects malformed request URL and header access before validation',async()=>{
  let validations=0;
  const rt=createRuntime({
    validateTelegramInitData:async()=>{
      validations+=1;
      return {id:42};
    },
  });

  const malformedUrl={
    url:'not a valid URL',
    method:'GET',
    headers:{get:()=> 'signed'},
  };
  assert.equal(
    await rt.api.getRequestUser(malformedUrl,{botToken:'token',devMode:false}),
    null,
  );

  const brokenHeaders={
    url:'https://example.test/',
    method:'GET',
    headers:{get:()=>{ throw new Error('headers unavailable'); }},
  };
  assert.equal(
    await rt.api.getRequestUser(brokenHeaders,{botToken:'token',devMode:false}),
    null,
  );
  assert.equal(validations,0);
});

test('Phase 2 auth boundary rejects oversized initData before invoking HMAC validation',async()=>{
  let validations=0;
  const rt=createRuntime({
    validateTelegramInitData:async()=>{
      validations+=1;
      return {id:42};
    },
  });
  const oversized='x'.repeat(MAX_TELEGRAM_INIT_DATA_LENGTH+1);

  assert.equal(
    await rt.api.getRequestUser(
      request('/','GET',oversized),
      {botToken:'token',devMode:false},
    ),
    null,
  );
  assert.equal(validations,0);
});

test('Phase 2 auth boundary clones frozen signed user data instead of mutating validator output',async()=>{
  const signed=Object.freeze({
    id:42,
    username:'frozen-user',
    first_name:'Frozen',
  });
  const rt=createRuntime({
    validateTelegramInitData:async()=>signed,
  });

  const user=await rt.api.getRequestUser(
    request(),
    {botToken:'token',devMode:false},
  );

  assert.notEqual(user,signed);
  assert.equal(user.id,42);
  assert.equal(user.username,'frozen-user');
  assert.equal(user.__telegramValidated,true);
  assert.equal(Object.prototype.hasOwnProperty.call(signed,'__telegramValidated'),false);
});

test('Phase 2 auth boundary never creates synthetic admin identity on remote hosts',async()=>{
  const remote=createRuntime({validateTelegramInitData:async()=>null});
  const user=await remote.api.getRequestUser(request('/api/diagnostics','GET',''),{botToken:'token',devMode:true});
  assert.equal(user,null);
});

test('Phase 2 auth boundary applies 15-minute freshness from the authoritative route registry',async()=>{
  const routes=adminSensitivePathInventory();
  const paths=routes.map(route=>route.path);
  for (const required of [
    '/api/provider',
    '/api/runtime-controls',
    '/api/admin/billing/refund',
    '/api/diagnostics',
    '/api/post-deploy-regression-response',
    '/api/recovery-incident-ack',
    '/api/model-remediation',
    '/api/media-publisher-link',
  ]) {
    if (required.startsWith('/api/admin/')) {
      assert.equal(requiresAdminAuthorizationPath(required),true,required);
    } else {
      assert.ok(paths.includes(required),required);
    }
  }

  for (const route of routes) {
    const rt=createRuntime();
    await rt.api.getRequestUser(request(route.path,'GET'),{botToken:'token',devMode:false});
    assert.equal(rt.validationCalls[0],15*60,route.path);
  }

  for (const path of ['/api/admin/billing/refund','/api/provider/budget','/api/runtime-controls/rollback']) {
    const rt=createRuntime();
    await rt.api.getRequestUser(request(path,'POST'),{botToken:'token',devMode:false});
    assert.equal(rt.validationCalls[0],15*60,path);
  }

  for (const nearMiss of ['/api/providerish','/api/adminish/test','/api/runtime-controls-extra','/api/post-deploy-regression-response-extra']) {
    const rt=createRuntime();
    await rt.api.getRequestUser(request(nearMiss,'GET'),{botToken:'token',devMode:false});
    assert.equal(rt.validationCalls[0],24*60*60,nearMiss);
  }
});

test('privileged Telegram freshness accepts 900 seconds and rejects 901 seconds',async()=>{
  let ageSeconds=900;
  const rt=createRuntime({
    validateTelegramInitData:async(_data,_token,maxAge)=>ageSeconds<=maxAge ? {id:42,username:'user'} : null,
  });
  assert.equal((await rt.api.getRequestUser(request('/api/post-deploy-regression-response','GET'),{botToken:'token',devMode:false}))?.id,42);

  ageSeconds=901;
  assert.equal(await rt.api.getRequestUser(request('/api/post-deploy-regression-response','GET'),{botToken:'token',devMode:false}),null);
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

test('Phase 2 auth boundary keeps validated auth fail-soft when ops logging throws synchronously',async()=>{
  const rt=createRuntime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{throw new Error('db down');},
    recordOpsEvent:()=>{throw new Error('ops down');},
  });
  const user=await rt.api.getRequestUser(request(),{botToken:'token',devMode:false});
  assert.equal(user.id,42);
  assert.equal(user.__telegramValidated,true);
});

test('Phase 2 user persistence rejects invalid ids and record lookup fails closed',async()=>{
  const rt=createRuntime();
  await assert.rejects(()=>rt.api.upsertUser({id:0},{}),/valid Telegram user id/);
  assert.equal(await rt.api.getUserRecord(0,{}),null);
  assert.equal(await rt.api.getUserRecord('not-a-user',{}),null);
});


test('Phase 2 getUserRecord propagates configured storage failures but never fabricates identity',async()=>{
  const rt=createRuntime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>{ throw new Error('db read down'); },
  });

  await assert.rejects(
    ()=>rt.api.getUserRecord(42,{}),
    /db read down/,
  );
  assert.equal(await rt.api.getUserRecord(0,{}),null);
});

test('Phase 2 auth boundary keeps local user storage and record fallback shape',async()=>{
  const rt=createRuntime();
  await rt.api.upsertUser({id:7,username:'seven'}, {});
  const row=await rt.api.getUserRecord(7,{});
  assert.equal(row.telegram_id,7);
  assert.equal(row.username,'seven');
  assert.equal(row.plan,'FREE');
});
