import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReminderDeliveryStore } from '../src/reminder-delivery-store.js';

function runtime(overrides = {}) {
  const calls=[];
  const events=[];
  const responses=[...(overrides.responses || [])];
  const store=createReminderDeliveryStore({
    hasSupabase:overrides.hasSupabase || (()=>true),
    fetchWithTimeout:overrides.fetchWithTimeout || (async(url,init,timeout,source)=>{
      calls.push({url:String(url),init,timeout,source});
      const next=responses.shift() || {ok:true,status:200,json:[]};
      return {
        ok:next.ok,
        status:next.status,
        async json(){ return next.json; },
      };
    }),
    supaHeaders:overrides.supaHeaders || ((_cfg,extra)=>({...extra,'x-test':'1'})),
    recordOpsEvent:overrides.recordOpsEvent || (async(_cfg,event)=>{events.push(event);}),
    redactOpsString:overrides.redactOpsString || ((value,limit)=>String(value || '').slice(0,limit)),
    now:overrides.now || (()=>Date.parse('2026-09-27T18:00:05.000Z')),
  });
  return {store,calls,events};
}

test('reminder delivery status rejects coercion and malformed timestamps',()=>{
  const {store}=runtime();
  assert.equal(store.reminderDeliveryStatus({notified_at:true}),'scheduled');
  assert.equal(store.reminderDeliveryStatus({notified_at:'not-a-date'}),'scheduled');
  assert.equal(store.reminderDeliveryStatus({delivery_last_error:true}),'scheduled');
});

test('reminder delivery status preserves public state mapping with deterministic timestamps', () => {
  const {store}=runtime();
  assert.equal(store.reminderDeliveryStatus({}),'scheduled');
  assert.equal(store.reminderDeliveryStatus({delivery_last_error:'x'}),'retry_pending');
  assert.equal(store.reminderDeliveryStatus({delivery_last_error:'telegram_delivery_sending'}),'delivery_unknown');
  assert.equal(store.reminderDeliveryStatus({delivery_last_error:'telegram_delivery_unknown'}),'delivery_unknown');
  assert.equal(store.reminderDeliveryStatus({notified_at:'2026-01-01'}),'scheduled');
  assert.equal(store.reminderDeliveryStatus({notified_at:'2026-01-01T00:00:00'}),'scheduled');
  assert.equal(store.reminderDeliveryStatus({notified_at:'2026-01-01T00:00:00Z'}),'prematch_sent');
  assert.equal(store.reminderDeliveryStatus({kickoff_notified_at:'2026-01-01T00:00:00+03:00'}),'kickoff_sent');
  assert.equal(store.reminderDeliveryStatus({lineup_notified_at:'2026-01-01T00:00:00Z'}),'lineup_sent');
});

test('store rejects coercible reminder identity and attempt counters before network mutation',async()=>{
  const {store,calls}=runtime();
  await assert.rejects(
    store.claimReminderDelivery({telegram_id:true,fixture_id:77},'prematch',{supabaseUrl:'https://db.test'}),
    error=>error?.code==='REMINDER_DELIVERY_IDENTITY_INVALID',
  );
  await assert.rejects(
    store.claimReminderDelivery({telegram_id:15,fixture_id:77,prematch_attempts:true},'prematch',{supabaseUrl:'https://db.test'}),
    error=>error?.code==='REMINDER_DELIVERY_ATTEMPTS_INVALID',
  );
  assert.equal(calls.length,0);
});

test('store requires strict Supabase availability and confirmed HTTP success',async()=>{
  const truthy=runtime({hasSupabase:()=> 'true'});
  const claim=await truthy.store.claimReminderDelivery(
    {telegram_id:15,fixture_id:77},
    'prematch',
    {},
  );
  assert.equal(claim.claimed,true);
  assert.equal(truthy.calls.length,0);

  const response=runtime({responses:[{ok:'true',status:200,json:[{telegram_id:15,fixture_id:77}]}]});
  await assert.rejects(
    response.store.claimReminderDelivery(
      {telegram_id:15,fixture_id:77},
      'prematch',
      {supabaseUrl:'https://db.test'},
    ),
    /Supabase reminder claim: HTTP 200/,
  );
});

test('claim requires returned claim marker instead of trusting a single matching row',async()=>{
  const rt=runtime({responses:[{
    ok:true,
    status:200,
    json:[{telegram_id:15,fixture_id:77}],
  }]});
  await assert.rejects(
    rt.store.claimReminderDelivery(
      {telegram_id:15,fixture_id:77},
      'prematch',
      {supabaseUrl:'https://db.test'},
    ),
    error=>error?.code==='REMINDER_DELIVERY_CLAIM_MISMATCH',
  );
});

test('claim requires returned ownership identity and claim marker',async()=>{
  const mismatch=runtime({responses:[{
    ok:true,
    status:200,
    json:[{
      telegram_id:16,
      fixture_id:77,
      prematch_claimed_at:'2026-09-27T18:00:05.000Z',
    }],
  }]});
  await assert.rejects(
    mismatch.store.claimReminderDelivery(
      {telegram_id:15,fixture_id:77},
      'prematch',
      {supabaseUrl:'https://db.test'},
    ),
    error=>error?.code==='REMINDER_DELIVERY_IDENTITY_MISMATCH',
  );
});

test('claim preserves atomic Supabase PATCH filters and attempt increment', async () => {
  const {store,calls}=runtime({responses:[{ok:true,status:200,json:[{telegram_id:15,fixture_id:77,prematch_claimed_at:'2026-09-27T18:00:05.000Z'}]}]});
  const row={telegram_id:15,fixture_id:77,prematch_attempts:2};
  const result=await store.claimReminderDelivery(row,'prematch',{supabaseUrl:'https://db.test'});
  assert.equal(result.claimed,true);
  assert.ok(result.claimAt);
  assert.equal(calls.length,1);
  const call=calls[0];
  assert.match(call.url,/\/rest\/v1\/match_reminders/);
  assert.match(call.url,/telegram_id=eq\.15/);
  assert.match(call.url,/fixture_id=eq\.77/);
  assert.match(call.url,/enabled=eq\.true/);
  assert.match(call.url,/notified_at=is\.null/);
  assert.match(call.url,/prematch_claimed_at=is\.null/);
  assert.equal(call.init.method,'PATCH');
  assert.equal(call.init.headers.Prefer,'return=representation');
  const body=JSON.parse(call.init.body);
  assert.equal(body.prematch_attempts,3);
  assert.equal(body.delivery_last_error,'delivery_claimed');
  assert.equal(body.prematch_claimed_at,result.claimAt);
  assert.equal(call.timeout,7000);
  assert.equal(call.source,'Supabase reminder claim');
});

test('sending and unknown states preserve the claim for at-most-once delivery', async () => {
  const {store,calls}=runtime({
    responses:[
      {ok:true,status:200,json:[{telegram_id:15,fixture_id:77,prematch_claimed_at:'2026-09-27T18:00:00.000Z'}]},
      {ok:true,status:200,json:[{telegram_id:15,fixture_id:77,prematch_claimed_at:'2026-09-27T18:00:00.000Z'}]},
    ],
  });
  const row={telegram_id:15,fixture_id:77};
  const claimAt='2026-09-27T18:00:00.000Z';
  await store.markReminderDeliverySending(row,'prematch',claimAt,{supabaseUrl:'https://db.test'});
  await store.holdReminderDeliveryUnknown(row,'prematch',claimAt,{supabaseUrl:'https://db.test'});

  const sending=JSON.parse(calls[0].init.body);
  assert.equal(sending.delivery_last_error,'telegram_delivery_sending');
  assert.equal(sending.delivery_retry_after,null);
  assert.match(calls[0].url,/prematch_claimed_at=eq\.2026-09-27T18%3A00%3A00\.000Z/);
  assert.equal(calls[0].init.headers.Prefer,'return=representation');

  const unknown=JSON.parse(calls[1].init.body);
  assert.equal(unknown.delivery_last_error,'telegram_delivery_unknown');
  assert.equal(unknown.delivery_retry_after,null);
  assert.equal(Object.hasOwn(unknown,'prematch_claimed_at'),false);
  assert.equal(calls[1].init.headers.Prefer,'return=representation');
});

test('finish kickoff preserves claim identity and marks prematch sent when needed', async () => {
  const {store,calls}=runtime({responses:[{ok:true,status:200,json:[{telegram_id:7,fixture_id:88,kickoff_notified_at:'2026-09-27T18:00:05.000Z',kickoff_claimed_at:null,notified_at:'2026-09-27T18:00:05.000Z'}]}]});
  const claimAt='2026-09-27T18:00:00.000Z';
  await store.finishReminderDelivery({telegram_id:7,fixture_id:88,notified_at:null},'kickoff',claimAt,{supabaseUrl:'https://db.test'});
  assert.equal(calls.length,1);
  const call=calls[0];
  assert.match(call.url,/telegram_id=eq\.7/);
  assert.match(call.url,/fixture_id=eq\.88/);
  assert.match(call.url,/kickoff_claimed_at=eq\.2026-09-27T18%3A00%3A00\.000Z/);
  assert.equal(call.init.headers.Prefer,'return=representation');
  const body=JSON.parse(call.init.body);
  assert.ok(body.kickoff_notified_at);
  assert.equal(body.kickoff_claimed_at,null);
  assert.equal(body.notified_at,body.kickoff_notified_at);
  assert.equal(body.delivery_last_error,null);
  assert.equal(body.delivery_retry_after,null);
});

test('finish refuses a single malformed row that does not confirm sent state',async()=>{
  const {store}=runtime({responses:[{
    ok:true,
    status:200,
    json:[{
      telegram_id:7,
      fixture_id:88,
      notified_at:null,
      prematch_claimed_at:null,
    }],
  }]});
  await assert.rejects(
    store.finishReminderDelivery(
      {telegram_id:7,fixture_id:88},
      'prematch',
      '2026-09-27T18:00:00.000Z',
      {supabaseUrl:'https://db.test'},
    ),
    error=>error?.code==='REMINDER_DELIVERY_FINISH_UNCONFIRMED',
  );
});

test('reconciliation ignores a row with mismatched identity or malformed done timestamp',async()=>{
  const {store}=runtime({
    responses:[
      {ok:false,status:503,json:null},
      {ok:true,status:200,json:[{
        telegram_id:999,
        fixture_id:88,
        notified_at:'2026-09-27T18:00:05.000Z',
      }]},
    ],
  });
  await assert.rejects(
    store.finishReminderDelivery(
      {telegram_id:7,fixture_id:88},
      'prematch',
      '2026-09-27T18:00:00.000Z',
      {supabaseUrl:'https://db.test'},
    ),
    /Supabase reminder finish: HTTP 503/,
  );
});

test('Issue #408 finish reconciles a lost write response by reading committed sent state', async () => {
  const doneAt='2026-09-27T18:00:05.000Z';
  const {store,calls}=runtime({
    responses:[
      {ok:false,status:503,json:null},
      {ok:true,status:200,json:[{
        telegram_id:7,
        fixture_id:88,
        prematch_claimed_at:null,
        notified_at:doneAt,
        delivery_last_error:null,
        delivery_last_success_at:doneAt,
      }]},
    ],
  });
  const result=await store.finishReminderDelivery(
    {telegram_id:7,fixture_id:88},
    'prematch',
    '2026-09-27T18:00:00.000Z',
    {supabaseUrl:'https://db.test'},
  );
  assert.deepEqual(result,{finalized:true,reconciled:true,doneAt});
  assert.equal(calls.length,2);
  assert.equal(calls[0].init.method,'PATCH');
  assert.equal(calls[1].init.method,'GET');
  assert.match(calls[1].url,/select=/);
  assert.match(calls[1].url,/notified_at/);
});

test('Issue #408 finish remains fail-closed when reconciliation cannot confirm sent state', async () => {
  const {store}=runtime({
    responses:[
      {ok:false,status:503,json:null},
      {ok:true,status:200,json:[{
        telegram_id:7,
        fixture_id:88,
        prematch_claimed_at:'2026-09-27T18:00:00.000Z',
        notified_at:null,
        delivery_last_error:'telegram_delivery_sending',
      }]},
    ],
  });
  await assert.rejects(
    store.finishReminderDelivery(
      {telegram_id:7,fixture_id:88},
      'prematch',
      '2026-09-27T18:00:00.000Z',
      {supabaseUrl:'https://db.test'},
    ),
    /Supabase reminder finish: HTTP 503/,
  );
});

test('release retry and disable options reject coercion and bound retry_after',async()=>{
  const {store,calls}=runtime({
    responses:[{ok:true,status:200,json:[{telegram_id:9,fixture_id:99,prematch_claimed_at:null}]}],
  });
  await store.releaseReminderClaim(
    {telegram_id:9,fixture_id:99},
    'prematch',
    '2026-09-27T18:00:00.000Z',
    'failed',
    {supabaseUrl:'https://db.test'},
    {disable:'true',retryAfter:999999999},
  );
  const body=JSON.parse(calls[0].init.body);
  assert.equal(Object.hasOwn(body,'enabled'),false);
  assert.equal(body.delivery_retry_after,'2026-10-04T18:00:05.000Z');
});

test('release preserves retry and disable semantics', async () => {
  const {store,calls}=runtime({responses:[{ok:true,status:200,json:[{telegram_id:9,fixture_id:99,prematch_claimed_at:null}]}]});
  await store.releaseReminderClaim(
    {telegram_id:9,fixture_id:99},
    'prematch',
    '2026-09-27T18:00:00.000Z',
    'x'.repeat(300),
    {supabaseUrl:'https://db.test'},
    {disable:true,disableReason:'telegram_forbidden',retryAfter:30},
  );
  const body=JSON.parse(calls[0].init.body);
  assert.equal(body.prematch_claimed_at,null);
  assert.equal(body.delivery_last_error.length,240);
  assert.ok(body.delivery_last_attempt_at);
  assert.ok(body.delivery_retry_after);
  assert.equal(body.enabled,false);
  assert.equal(body.delivery_disabled_reason,'telegram_forbidden');
  assert.equal(calls[0].init.headers.Prefer,'return=representation');
});

test('finish, unknown hold and release reject a lost claim instead of reporting success', async () => {
  const {store}=runtime({
    responses:[
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
    ],
  });
  const row={telegram_id:31,fixture_id:310};
  const claimAt='2026-09-27T18:00:00.000Z';
  const lostClaim=error=>error?.code==='REMINDER_DELIVERY_CLAIM_LOST' && error?.claimLost===true;

  await assert.rejects(
    store.finishReminderDelivery(row,'prematch',claimAt,{supabaseUrl:'https://db.test'}),
    lostClaim,
  );
  await assert.rejects(
    store.holdReminderDeliveryUnknown(row,'prematch',claimAt,{supabaseUrl:'https://db.test'}),
    lostClaim,
  );
  await assert.rejects(
    store.releaseReminderClaim(row,'prematch',claimAt,'send failed',{supabaseUrl:'https://db.test'}),
    lostClaim,
  );
});

test('stale claim recovery clears claim-only rows and reconciles stale sending rows fail-closed', async () => {
  const {store,calls,events}=runtime({
    responses:[
      {ok:true,status:200,json:[{fixture_id:1},{fixture_id:2}]},
      {ok:true,status:200,json:[{fixture_id:10}]},
      {ok:true,status:200,json:[{fixture_id:3}]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
    ],
  });
  const result=await store.clearStaleReminderClaims({supabaseUrl:'https://db.test'});
  assert.deepEqual(result,{prematch:2,kickoff:1,lineup:0,important_change:0,failed:0});
  assert.equal(calls.length,8);

  assert.match(calls[0].url,/prematch_claimed_at=lt\./);
  assert.match(calls[0].url,/or=%28delivery_last_error\.is\.null%2Cdelivery_last_error\.eq\.delivery_claimed%29/);
  assert.match(calls[1].url,/prematch_claimed_at=lt\./);
  assert.match(calls[1].url,/notified_at=is\.null/);
  assert.match(calls[1].url,/delivery_last_error=eq\.telegram_delivery_sending/);
  const reconciledBody=JSON.parse(calls[1].init.body);
  assert.equal(reconciledBody.delivery_last_error,'telegram_delivery_unknown');
  assert.equal(Object.hasOwn(reconciledBody,'prematch_claimed_at'),false);

  assert.match(calls[2].url,/kickoff_claimed_at=lt\./);
  assert.match(calls[4].url,/lineup_claimed_at=lt\./);
  assert.match(calls[6].url,/important_change_claimed_at=lt\./);

  assert.equal(events.some(event=>event.code==='REMINDER_STALE_CLAIMS'),true);
  assert.equal(events.some(event=>event.code==='REMINDER_STALE_SENDING_RECONCILED'),true);
  assert.deepEqual(
    events.find(event=>event.code==='REMINDER_STALE_SENDING_RECONCILED').meta,
    {total:1,prematch:1,kickoff:0,lineup:0,important_change:0},
  );
});

test('stale claim cleanup surfaces partial clear or reconciliation failures instead of silently returning zero', async () => {
  const {store,events}=runtime({
    responses:[
      {ok:false,status:503,json:null},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[{fixture_id:3}]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
    ],
  });
  const result=await store.clearStaleReminderClaims({supabaseUrl:'https://db.test'});
  assert.deepEqual(result,{prematch:0,kickoff:1,lineup:0,important_change:0,failed:1});
  assert.equal(events.some(event=>event.code==='REMINDER_STALE_CLAIM_CLEANUP_FAILED'),true);
  assert.equal(events.find(event=>event.code==='REMINDER_STALE_CLAIM_CLEANUP_FAILED').meta.failed,1);
});

test('strict false-positive Supabase detection keeps fallback side-effect free',async()=>{
  const {store,calls}=runtime({hasSupabase:()=> 'true'});
  const claim=await store.claimReminderDelivery({},'prematch',{});
  assert.equal(claim.claimed,true);
  await store.markReminderDeliverySending({},'prematch',claim.claimAt,{});
  await store.holdReminderDeliveryUnknown({},'prematch',claim.claimAt,{});
  assert.equal(await store.readReminderDeliveryState({},'prematch',{}),null);
  const finish=await store.finishReminderDelivery({},'prematch',claim.claimAt,{});
  assert.equal(finish.finalized,true);
  await store.releaseReminderClaim({},'prematch',claim.claimAt,'x',{});
  assert.equal(calls.length,0);
});

test('non-Supabase fallback preserves no-op lifecycle semantics', async () => {
  const {store,calls}=runtime({hasSupabase:()=>false});
  assert.deepEqual(await store.clearStaleReminderClaims({}),{prematch:0,kickoff:0,lineup:0,important_change:0,failed:0});
  const claim=await store.claimReminderDelivery({},'prematch',{});
  assert.equal(claim.claimed,true);
  assert.ok(claim.claimAt);
  await store.markReminderDeliverySending({},'prematch',claim.claimAt,{});
  await store.holdReminderDeliveryUnknown({},'prematch',claim.claimAt,{});
  await store.finishReminderDelivery({},'prematch',claim.claimAt,{});
  await store.releaseReminderClaim({},'prematch',claim.claimAt,'x',{});
  assert.equal(calls.length,0);
});

test('worker delegates delivery persistence to the store boundary', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/import \{ createReminderDeliveryStore \} from '\.\/reminder-delivery-store\.js'/);
  assert.match(worker,/createReminderDeliveryStore\(\{/);
  assert.doesNotMatch(worker,/async function clearStaleReminderClaims\(cfg\)/);
  assert.doesNotMatch(worker,/async function claimReminderDelivery\(row, kind, cfg\)/);
  assert.doesNotMatch(worker,/async function finishReminderDelivery\(row, kind, claimAt, cfg\)/);
  assert.doesNotMatch(worker,/async function releaseReminderClaim\(row, kind, claimAt, errorMessage, cfg/);
});
