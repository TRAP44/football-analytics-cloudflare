import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient } from '../src/supabase-client.js';
import { createTelegramDigestRuntime } from '../src/telegram-digest-runtime.js';
import {
  DAILY_DIGEST_POLICY,
  assessDailyDigestRun,
  planDailyDigestRecipients,
  runBoundedDailyDigest,
} from '../src/daily-digest-delivery.js';

function response({ok=true,status=200,json=[]}={}) {
  return {
    ok,
    status,
    headers:{get(){return null;}},
    async json(){return json;},
    async text(){return '';},
  };
}

function pagedClient(dataset,calls=[]) {
  return createSupabaseClient({
    fetchWithTimeout:async url=>{
      const parsed=new URL(String(url));
      const offset=Number(parsed.searchParams.get('offset') || 0);
      const limit=Number(parsed.searchParams.get('limit') || 20);
      calls.push({
        offset,
        limit,
        order:parsed.searchParams.get('order'),
        enabled:parsed.searchParams.get('enabled'),
      });
      return response({json:dataset.slice(offset,offset+limit)});
    },
  });
}

function digestHarness({
  supaSelectPaged=async()=>({rows:[],truncated:false}),
  hasSupabase=()=>true,
}={}) {
  const ops=[];
  const memory={botDigestSubscriptions:new Map()};
  const noop=()=>{};
  const asyncNoop=async()=>{};
  const runtime=createTelegramDigestRuntime({
    DAILY_DIGEST_POLICY,
    SMART_NOTIFICATION_POLICY:{},
    apiFootball:async()=>[],
    assessDailyDigestRun,
    botMatchButtonText:()=>'', 
    bumpTelemetry:noop,
    currentMorningFootballNews:async()=>({items:[]}),
    filterSmartNotificationRecipients:async()=>({rows:[]}),
    footballBotKeyboard:()=>({}),
    freeQuotaHealthy:()=>true,
    getAnalysisTimelineSnapshots:async()=>[],
    getCache:async()=>null,
    getFavorites:async()=>[],
    getStaleCache:async()=>null,
    hasSupabase,
    isFootballRateLimitError:()=>false,
    isLiveStatus:()=>false,
    isYouthReserveMatch:()=>false,
    loadProviderFixturesForDate:async()=>[],
    markTelegramWebhookMutation:noop,
    matchInterestScore:()=>0,
    memory,
    morningNewsText:()=>'', 
    newsConversionKeyboard:()=>null,
    normalizeBotFixtureCard:value=>value,
    normalizeCompetition:()=>({}),
    planDailyDigestRecipients,
    radarStrongSignalState:()=>null,
    recordOpsEvent:async(_cfg,event)=>{ops.push(event); return event;},
    rememberBotFixtureCards:asyncNoop,
    runBoundedDailyDigest,
    setCache:asyncNoop,
    sleepMs:asyncNoop,
    supaPatch:asyncNoop,
    supaRpc:async()=>false,
    supaSelectOne:async()=>null,
    supaSelectPaged,
    supaUpsert:asyncNoop,
    telegramApi:async()=>({ok:true,status:200}),
    telegramHtmlEscape:value=>String(value ?? ''),
    todayUtc:()=> '2026-10-07',
  });
  return {runtime,ops,memory};
}

const cfg={
  supabaseUrl:'https://example.supabase.co',
  supabaseKey:'sb_secret_example',
  botToken:'123456:TEST',
};

test('Supabase pagination never exceeds maxRows when pageSize is larger than the cap',async()=>{
  const calls=[];
  const dataset=[{id:1},{id:2},{id:3}];
  const client=pagedClient(dataset,calls);

  const page=await client.supaSelectPaged(
    cfg,
    'items',
    {},
    {pageSize:500,maxRows:2,order:'id.asc'},
  );

  assert.deepEqual(page,{
    rows:[{id:1},{id:2}],
    truncated:true,
  });
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{
    offset:0,
    limit:3,
    order:'id.asc',
    enabled:null,
  });
});

test('reaching exactly maxRows is not reported as truncated when no next row exists',async()=>{
  const calls=[];
  const client=pagedClient([{id:1},{id:2}],calls);

  const page=await client.supaSelectPaged(
    cfg,
    'items',
    {},
    {pageSize:500,maxRows:2,order:'id.asc'},
  );

  assert.deepEqual(page,{
    rows:[{id:1},{id:2}],
    truncated:false,
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].limit,3);
});

test('multi-page selection uses stable offsets/order and detects a row beyond the cap',async()=>{
  const calls=[];
  const client=pagedClient(
    Array.from({length:5},(_,index)=>({id:index+1})),
    calls,
  );

  const page=await client.supaSelectPaged(
    cfg,
    'items',
    {enabled:'eq.true'},
    {pageSize:2,maxRows:4,order:'id.asc'},
  );

  assert.deepEqual(page,{
    rows:[{id:1},{id:2},{id:3},{id:4}],
    truncated:true,
  });
  assert.deepEqual(calls,[
    {offset:0,limit:2,order:'id.asc',enabled:'eq.true'},
    {offset:2,limit:3,order:'id.asc',enabled:'eq.true'},
  ]);
});

test('1000-row pages use a one-row probe without returning data beyond the cap',async()=>{
  const exactCalls=[];
  const exactDataset=Array.from({length:1000},(_,index)=>({id:index+1}));
  const exact=await pagedClient(exactDataset,exactCalls).supaSelectPaged(
    cfg,
    'items',
    {},
    {pageSize:1000,maxRows:1000,order:'id.asc'},
  );

  assert.equal(exact.rows.length,1000);
  assert.equal(exact.truncated,false);
  assert.deepEqual(exactCalls.map(({offset,limit})=>({offset,limit})),[
    {offset:0,limit:1000},
    {offset:1000,limit:1},
  ]);

  const overflowCalls=[];
  const overflowDataset=Array.from({length:1001},(_,index)=>({id:index+1}));
  const overflow=await pagedClient(overflowDataset,overflowCalls).supaSelectPaged(
    cfg,
    'items',
    {},
    {pageSize:1000,maxRows:1000,order:'id.asc'},
  );

  assert.equal(overflow.rows.length,1000);
  assert.equal(overflow.truncated,true);
  assert.equal(overflow.rows.at(-1).id,1000);
  assert.deepEqual(overflowCalls.map(({offset,limit})=>({offset,limit})),[
    {offset:0,limit:1000},
    {offset:1000,limit:1},
  ]);
});

test('digest subscription loader uses policy pagination and filters malformed identities',async()=>{
  const calls=[];
  const {runtime}=digestHarness({
    supaSelectPaged:async(...args)=>{
      calls.push(args);
      return {
        rows:[
          {telegram_id:42,chat_id:42,enabled:true},
          {telegram_id:'43',chat_id:'-100123',enabled:true},
          {telegram_id:true,chat_id:1,enabled:true},
          {telegram_id:44,chat_id:false,enabled:true},
          {telegram_id:0,chat_id:1,enabled:true},
        ],
        truncated:false,
      };
    },
  });

  const result=await runtime.loadBotDigestSubscriptions(cfg);

  assert.deepEqual(result,{
    rows:[
      {telegram_id:42,chat_id:42,enabled:true},
      {telegram_id:'43',chat_id:'-100123',enabled:true},
    ],
    truncated:false,
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0][1],'bot_digest_subscriptions');
  assert.deepEqual(calls[0][2],{enabled:'eq.true'});
  assert.deepEqual(calls[0][3],{
    pageSize:DAILY_DIGEST_POLICY.pageSize,
    maxRows:DAILY_DIGEST_POLICY.scanCap,
    order:'telegram_id.asc',
  });
});

test('digest subscription loader fails closed on malformed pagination contracts',async()=>{
  const malformedPages=[
    null,
    [],
    {},
    {rows:{},truncated:false},
    {rows:[],truncated:'false'},
    {rows:Array.from({length:DAILY_DIGEST_POLICY.scanCap+1},()=>({telegram_id:1,chat_id:1})),truncated:true},
  ];

  for (const page of malformedPages) {
    const {runtime}=digestHarness({
      supaSelectPaged:async()=>page,
    });
    await assert.rejects(
      runtime.loadBotDigestSubscriptions(cfg),
      /pagination returned an invalid result/,
      JSON.stringify(page)?.slice(0,80),
    );
  }
});

test('truncated subscription scans are surfaced by the real digest cron path',async()=>{
  const {runtime,ops}=digestHarness({
    supaSelectPaged:async()=>({rows:[],truncated:true}),
  });

  const summary=await runtime.processDailyDigests(
    cfg,
    new Date('2026-10-07T07:50:00.000Z'),
  );

  assert.equal(summary.scanned,0);
  assert.equal(summary.truncated,true);
  assert.equal(summary.sent,0);

  const truncation=ops.find(event=>event.code==='DIGEST_SUBSCRIPTIONS_TRUNCATED');
  assert.ok(truncation);
  assert.equal(truncation.severity,'warning');
  assert.equal(truncation.meta.cap,DAILY_DIGEST_POLICY.scanCap);
  assert.equal(truncation.meta.pages,0);

  const run=ops.find(event=>event.code==='DAILY_DIGEST_RUN_TRUNCATED');
  assert.ok(run);
  assert.equal(run.severity,'warning');
  assert.equal(run.meta.truncated,true);
});

test('local digest subscriptions remain bounded to valid enabled Telegram identities',async()=>{
  const {runtime,memory}=digestHarness({hasSupabase:()=>false});
  memory.botDigestSubscriptions.set(1,{telegram_id:1,chat_id:1,enabled:true});
  memory.botDigestSubscriptions.set(2,{telegram_id:2,chat_id:-1002,enabled:true});
  memory.botDigestSubscriptions.set(3,{telegram_id:3,chat_id:3,enabled:false});
  memory.botDigestSubscriptions.set(4,{telegram_id:true,chat_id:4,enabled:true});
  memory.botDigestSubscriptions.set(5,{telegram_id:5,chat_id:false,enabled:true});

  const result=await runtime.loadBotDigestSubscriptions({botToken:'123456:TEST'});

  assert.deepEqual(result,{
    rows:[
      {telegram_id:1,chat_id:1,enabled:true},
      {telegram_id:2,chat_id:-1002,enabled:true},
    ],
    truncated:false,
  });
});
