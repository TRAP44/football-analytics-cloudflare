import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelemetryOpsRuntime } from '../src/telemetry-ops-runtime.js';

function buildRuntime(overrides={}) {
  const memory={
    telemetry:{},
    opsEvents:[],
  };
  const calls={
    local:[],
    rpc:[],
    fetch:[],
    waitUntil:[],
  };
  const api=createTelemetryOpsRuntime({
    MAX_MEMORY_OPS_EVENTS:3,
    currentReleaseIdentity:()=>({
      deploySha:'release-sha',
      cloudflareVersionId:'version-1',
    }),
    fetchWithTimeout:async(url,init)=>{
      calls.fetch.push({url:String(url),init});
      return {ok:true,status:201};
    },
    hasSupabase:()=>false,
    memory,
    observeProviderRequestLocal:event=>{
      calls.local.push(event);
      return true;
    },
    supaHeaders:()=>({
      apikey:'server-secret',
      'content-type':'application/json',
    }),
    supaRpc:async(...args)=>{
      calls.rpc.push(args);
      return {ok:true,bucketStartedAt:'2026-10-07T12:00:00.000Z'};
    },
    ...overrides,
  });
  return {api,memory,calls};
}

test('telemetry ops runtime rejects malformed dependency bags', () => {
  assert.throws(
    () => createTelemetryOpsRuntime(null),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelemetryOpsRuntime([]),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelemetryOpsRuntime({memory:{}}),
    /requires currentReleaseIdentity/,
  );
});

test('telemetry counters reject malformed keys and numeric coercion', () => {
  const {api,memory}=buildRuntime();

  assert.equal(api.bumpTelemetry('apiRequests',2),true);
  assert.equal(memory.telemetry.apiRequests,2);

  assert.equal(api.bumpTelemetry('__proto__',1),false);
  assert.equal(api.bumpTelemetry('bad key',1),false);
  assert.equal(api.bumpTelemetry('apiRequests',true),false);
  assert.equal(api.bumpTelemetry('apiRequests',Infinity),false);
  assert.equal(api.bumpTelemetry('apiRequests','3'),true);
  assert.equal(memory.telemetry.apiRequests,5);

  memory.telemetry.apiErrors='broken';
  assert.equal(api.bumpTelemetry('apiErrors',1),true);
  assert.equal(memory.telemetry.apiErrors,1);
});

test('ops redaction removes Telegram bearer Supabase and API credentials', () => {
  const {api}=buildRuntime();
  const telegramCredential='111111111:' + 'abcdefghijklmnopqrstuvwxyz_' + 'secret';
  const supabaseCredential='sb_' + 'secret_' + 'super_private_key';
  const text=[
    'bot' + telegramCredential,
    telegramCredential,
    'Bearer eyJhbGciOiJIUzI1NiJ9.secret',
    'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop',
    'SUPABASE_SERVICE_ROLE_KEY=service-role-secret',
    supabaseCredential,
    'x-apisports-key=football-secret',
    'apikey: another-secret',
    'https://example.test/path?token=url-secret&x=1',
  ].join(' | ');

  const redacted=api.redactOpsString(text,1000);
  assert.doesNotMatch(redacted,/abcdefghijklmnopqrstuvwxyz_secret/);
  assert.doesNotMatch(redacted,/eyJhbGciOiJIUzI1NiJ9\.secret/);
  assert.doesNotMatch(redacted,/eyJabcdefghijk\.abcdefghijklmnop\.abcdefghijklmnop/);
  assert.doesNotMatch(redacted,/service-role-secret|super_private_key/);
  assert.doesNotMatch(redacted,/football-secret|another-secret|url-secret/);
  assert.match(redacted,/\[redacted\]/);

  const hostile={toString(){throw new Error('do not stringify');}};
  assert.equal(api.redactOpsString(hostile),'');
});

test('ops metadata sanitizer fails closed on sensitive prototype and hostile values', () => {
  const {api}=buildRuntime();

  const cyclic={safe:'ok',telegramId:123};
  cyclic.self=cyclic;
  const meta=api.safeOpsMetadata({
    safe:'value',
    userId:7,
    apiKey:'secret',
    email:'private@example.test',
    phone:'+37100000000',
    sessionId:'private-session',
    nested:{
      password:'secret',
      keep:'yes',
      nan:NaN,
      inf:Infinity,
    },
    list:[1,true,'safe',{chatId:8,keep:'nested'}],
    cyclic,
    constructor:'blocked',
    prototype:'blocked',
  });

  assert.equal(meta.safe,'value');
  assert.equal('userId' in meta,false);
  assert.equal('apiKey' in meta,false);
  assert.equal('email' in meta,false);
  assert.equal('phone' in meta,false);
  assert.equal('sessionId' in meta,false);
  assert.equal(meta.nested.keep,'yes');
  assert.equal('password' in meta.nested,false);
  assert.equal('nan' in meta.nested,false);
  assert.equal('inf' in meta.nested,false);
  assert.deepEqual(meta.list.slice(0,3),[1,true,'safe']);
  assert.deepEqual(meta.list[3],{keep:'nested'});
  assert.equal(Object.prototype.hasOwnProperty.call(meta,'constructor'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(meta,'prototype'),false);

  const proxy=new Proxy({},{
    ownKeys(){throw new Error('proxy trap');},
  });
  assert.deepEqual(api.safeOpsMetadata(proxy),{});
});

test('provider observation rejects malformed outcomes before local or persistent writes', async () => {
  const {api,calls}=buildRuntime({
    hasSupabase:()=>true,
  });

  const result=await api.observeProviderRequest({
    provider:'api-football',
    operation:'/fixtures',
    outcome:'unknown',
    latencyMs:100,
  },{supabaseUrl:'https://project.supabase.co'});

  assert.deepEqual(result,{
    ok:false,
    persistent:false,
    reason:'invalid_observation',
  });
  assert.equal(calls.local.length,0);
  assert.equal(calls.rpc.length,0);
});

test('provider observation normalizes boundaries to the persistent SQL contract', async () => {
  const {api,calls}=buildRuntime({
    hasSupabase:()=>true,
  });

  const result=await api.observeProviderRequest({
    provider:{name:'unsafe'},
    operation:['unsafe'],
    outcome:'SUCCESS',
    errorType:'PROVIDER_TIMEOUT',
    latencyMs:999999,
  },{supabaseUrl:'https://project.supabase.co'});

  assert.equal(result.ok,true);
  assert.equal(result.persistent,true);
  assert.equal(result.bucketStartedAt,'2026-10-07T12:00:00.000Z');
  assert.equal(calls.local.length,1);
  assert.deepEqual(calls.local[0],{
    provider:'provider',
    operation:'unknown',
    outcome:'success',
    errorType:'PROVIDER_TIMEOUT',
    latencyMs:120000,
  });

  const params=calls.rpc[0][2];
  assert.equal(params.p_provider,'provider');
  assert.equal(params.p_operation,'unknown');
  assert.equal(params.p_outcome,'success');
  assert.equal(params.p_latency_ms,120000);
});

test('provider persistence failures are redacted and never throw into product flow', async () => {
  const {api,memory}=buildRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>{
      throw new Error('Bearer raw-secret bot111111111:abcdefghijklmnopqrstuvwxyz_secret');
    },
  });

  const result=await api.observeProviderRequest({
    provider:'api-football',
    operation:'/fixtures',
    outcome:'failed',
    latencyMs:10,
  },{supabaseUrl:'https://project.supabase.co'});

  assert.equal(result.ok,false);
  assert.equal(result.persistent,false);
  assert.doesNotMatch(result.reason,/raw-secret|abcdefghijklmnopqrstuvwxyz_secret/);
  assert.equal(memory.telemetry.providerSloPersistenceErrors,1);
});

test('ops events preserve authoritative release identity and strip sensitive metadata', async () => {
  const {api,memory}=buildRuntime();
  const row=await api.recordOpsEventTask({},{
    severity:'WARNING',
    source:'runtime',
    eventType:'boundary',
    meta:{
      deploySha:'attacker-value',
      cloudflareVersionId:'attacker-version',
      telegramId:123,
      nested:{authorization:'Bearer secret',safe:'ok'},
    },
  });

  assert.equal(row.severity,'warning');
  assert.equal(row.metadata.deploySha,'release-sha');
  assert.equal(row.metadata.cloudflareVersionId,'version-1');
  assert.equal('telegramId' in row.metadata,false);
  assert.deepEqual(row.metadata.nested,{safe:'ok'});
  assert.equal(memory.opsEvents.length,1);
});

test('ops event memory store repairs malformed storage and bounds retained rows', async () => {
  const {api,memory}=buildRuntime();
  memory.opsEvents='broken';

  await api.recordOpsEventTask({},{
    eventType:'one',
    transitionKey:'transition-a',
  });
  await api.recordOpsEventTask({},{
    eventType:'two',
    transitionKey:'transition-b',
  });
  await api.recordOpsEventTask({},{
    eventType:'three',
    transitionKey:'transition-c',
  });
  await api.recordOpsEventTask({},{
    eventType:'four',
    transitionKey:'transition-d',
  });

  assert.ok(Array.isArray(memory.opsEvents));
  assert.equal(memory.opsEvents.length,3);
  assert.deepEqual(
    memory.opsEvents.map(row=>row.transition_key),
    ['transition-d','transition-c','transition-b'],
  );
});

test('transition occurrence counters fail closed on corrupted prior values', async () => {
  const {api,memory}=buildRuntime();
  memory.opsEvents.push({
    transition_key:'same-transition',
    occurrence_count:'broken',
    metadata:{occurrenceCount:'broken'},
  });

  const row=await api.recordOpsEventTask({},{
    eventType:'repeat',
    transitionKey:'same-transition',
  });

  assert.equal(row.occurrence_count,2);
  assert.equal(memory.opsEvents[0].occurrence_count,2);
  assert.equal(row.metadata.occurrenceCount,2);
});

test('recordOpsEvent absorbs waitUntil and persistence failures', async () => {
  const {api,memory}=buildRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>({ok:false}),
    fetchWithTimeout:async()=>{throw new Error('database offline');},
  });
  const cfg={
    supabaseUrl:'https://project.supabase.co',
    waitUntil(){throw new Error('waitUntil failed');},
  };

  const row=await api.recordOpsEvent(cfg,{
    eventType:'persistence_failure',
    transitionKey:'transition-failure',
  });

  assert.equal(row._persistenceStatus,'failed');
  assert.equal(memory.telemetry.opsWaitUntilErrors,1);
  assert.equal(memory.telemetry.opsPersistenceErrors,1);
});

test('fallback ops persistence rejects insecure or credentialed Supabase URLs', async () => {
  let fetches=0;
  const {api}=buildRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>({ok:false}),
    fetchWithTimeout:async()=>{
      fetches+=1;
      return {ok:true,status:201};
    },
  });

  const httpRow=await api.recordOpsEventTask(
    {supabaseUrl:'http://project.supabase.co'},
    {eventType:'http-url',transitionKey:'http-transition'},
  );
  assert.equal(httpRow._persistenceStatus,'failed');

  const credentialRow=await api.recordOpsEventTask(
    {supabaseUrl:'https://user:pass@project.supabase.co'},
    {eventType:'credential-url',transitionKey:'credential-transition'},
  );
  assert.equal(credentialRow._persistenceStatus,'failed');
  assert.equal(fetches,0);
});

test('ops status duration and transition values reject coercion and remain bounded', async () => {
  const {api}=buildRuntime();

  const row=await api.recordOpsEventTask({},{
    status:true,
    durationMs:Infinity,
    transitionKey:'x'.repeat(5000),
    source:'s'.repeat(5000),
    eventType:'e'.repeat(5000),
  });

  assert.equal(row.status,null);
  assert.equal(row.duration_ms,null);
  assert.equal(row.transition_key,null);
  assert.equal(row.source,'worker');
  assert.equal(row.event_type,'runtime');
});
