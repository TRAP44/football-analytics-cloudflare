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
  });
  return {store,calls,events};
}

test('reminder delivery status preserves public state mapping', () => {
  const {store}=runtime();
  assert.equal(store.reminderDeliveryStatus({}),'scheduled');
  assert.equal(store.reminderDeliveryStatus({delivery_last_error:'x'}),'retry_pending');
  assert.equal(store.reminderDeliveryStatus({delivery_last_error:'telegram_delivery_sending'}),'delivery_unknown');
  assert.equal(store.reminderDeliveryStatus({delivery_last_error:'telegram_delivery_unknown'}),'delivery_unknown');
  assert.equal(store.reminderDeliveryStatus({notified_at:'2026-01-01'}),'prematch_sent');
  assert.equal(store.reminderDeliveryStatus({kickoff_notified_at:'2026-01-01'}),'kickoff_sent');
  assert.equal(store.reminderDeliveryStatus({lineup_notified_at:'2026-01-01'}),'lineup_sent');
});

test('claim preserves atomic Supabase PATCH filters and attempt increment', async () => {
  const {store,calls}=runtime({responses:[{ok:true,status:200,json:[{fixture_id:77}]}]});
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
      {ok:true,status:200,json:[{fixture_id:77}]},
      {ok:true,status:204,json:null},
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
  assert.equal(calls[1].init.headers.Prefer,'return=minimal');
});

test('finish kickoff preserves claim identity and marks prematch sent when needed', async () => {
  const {store,calls}=runtime({responses:[{ok:true,status:204,json:null}]});
  const claimAt='2026-09-27T18:00:00.000Z';
  await store.finishReminderDelivery({telegram_id:7,fixture_id:88,notified_at:null},'kickoff',claimAt,{supabaseUrl:'https://db.test'});
  assert.equal(calls.length,1);
  const call=calls[0];
  assert.match(call.url,/telegram_id=eq\.7/);
  assert.match(call.url,/fixture_id=eq\.88/);
  assert.match(call.url,/kickoff_claimed_at=eq\.2026-09-27T18%3A00%3A00\.000Z/);
  assert.equal(call.init.headers.Prefer,'return=minimal');
  const body=JSON.parse(call.init.body);
  assert.ok(body.kickoff_notified_at);
  assert.equal(body.kickoff_claimed_at,null);
  assert.equal(body.notified_at,body.kickoff_notified_at);
  assert.equal(body.delivery_last_error,null);
  assert.equal(body.delivery_retry_after,null);
});

test('release preserves retry and disable semantics', async () => {
  const {store,calls}=runtime({responses:[{ok:true,status:204,json:null}]});
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
});

test('stale claim recovery clears registered claim columns and records an ops event', async () => {
  const {store,calls,events}=runtime({
    responses:[
      {ok:true,status:200,json:[{fixture_id:1},{fixture_id:2}]},
      {ok:true,status:200,json:[{fixture_id:3}]},
      {ok:true,status:200,json:[]},
      {ok:true,status:200,json:[]},
    ],
  });
  const result=await store.clearStaleReminderClaims({supabaseUrl:'https://db.test'});
  assert.deepEqual(result,{prematch:2,kickoff:1,lineup:0,important_change:0,failed:0});
  assert.equal(calls.length,4);
  assert.match(calls[0].url,/prematch_claimed_at=lt\./);
  assert.match(calls[1].url,/kickoff_claimed_at=lt\./);
  assert.match(calls[2].url,/lineup_claimed_at=lt\./);
  assert.match(calls[3].url,/important_change_claimed_at=lt\./);
  assert.match(calls[0].url,/or=%28delivery_last_error\.is\.null%2Cdelivery_last_error\.eq\.delivery_claimed%29/);
  assert.match(calls[1].url,/or=%28delivery_last_error\.is\.null%2Cdelivery_last_error\.eq\.delivery_claimed%29/);
  assert.equal(events.length,1);
  assert.equal(events[0].code,'REMINDER_STALE_CLAIMS');
  assert.deepEqual(events[0].meta,{prematch:2,kickoff:1,lineup:0,important_change:0});
});

test('stale claim cleanup surfaces partial failures instead of silently returning zero', async () => {
  const {store,events}=runtime({
    responses:[
      {ok:false,status:503,json:null},
      {ok:true,status:200,json:[{fixture_id:3}]},
      {ok:true,status:200,json:[]},
    ],
  });
  const result=await store.clearStaleReminderClaims({supabaseUrl:'https://db.test'});
  assert.deepEqual(result,{prematch:0,kickoff:1,lineup:0,important_change:0,failed:1});
  assert.equal(events.some(event=>event.code==='REMINDER_STALE_CLAIM_CLEANUP_FAILED'),true);
  assert.equal(events.find(event=>event.code==='REMINDER_STALE_CLAIM_CLEANUP_FAILED').meta.failed,1);
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
