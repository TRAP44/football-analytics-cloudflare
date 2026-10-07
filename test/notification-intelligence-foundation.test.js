import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMINDER_DELIVERY_KINDS,
  reminderDeliveryKindConfig,
  createReminderDeliveryStore,
} from '../src/reminder-delivery-store.js';

const EXPECTED_KINDS={
  prematch:{
    claimColumn:'prematch_claimed_at',
    doneColumn:'notified_at',
    attemptsColumn:'prematch_attempts',
  },
  kickoff:{
    claimColumn:'kickoff_claimed_at',
    doneColumn:'kickoff_notified_at',
    attemptsColumn:'kickoff_attempts',
  },
  lineup:{
    claimColumn:'lineup_claimed_at',
    doneColumn:'lineup_notified_at',
    attemptsColumn:'lineup_attempts',
  },
  important_change:{
    claimColumn:'important_change_claimed_at',
    doneColumn:'important_change_notified_at',
    attemptsColumn:'important_change_attempts',
  },
};

function runtime(){
  const calls=[];
  const store=createReminderDeliveryStore({
    hasSupabase:()=>true,
    fetchWithTimeout:async(url,init)=>{
      const body=JSON.parse(init.body);
      calls.push({url:String(url),init,body});
      return {
        ok:true,
        status:200,
        async json(){
          return [{telegram_id:7,fixture_id:99,...body}];
        },
      };
    },
    supaHeaders:(_cfg,extra)=>extra,
    recordOpsEvent:async()=>{},
    redactOpsString:value=>typeof value==='string' ? value : '',
    now:()=>Date.parse('2026-09-29T20:00:00.000Z'),
  });
  return {store,calls};
}

test('notification delivery kind registry preserves all four persistence contracts',()=>{
  assert.deepEqual(Object.keys(REMINDER_DELIVERY_KINDS),Object.keys(EXPECTED_KINDS));
  assert.equal(Object.isFrozen(REMINDER_DELIVERY_KINDS),true);

  for(const [kind,expected] of Object.entries(EXPECTED_KINDS)){
    assert.deepEqual(reminderDeliveryKindConfig(kind),expected);
    assert.equal(Object.isFrozen(REMINDER_DELIVERY_KINDS[kind]),true);
  }
});

test('unknown, inherited and normalization-dependent delivery kinds fail closed',()=>{
  for(const kind of ['final','__proto__','constructor','toString','hasOwnProperty',' lineup ','']){
    assert.throws(
      ()=>reminderDeliveryKindConfig(kind),
      /Unsupported reminder delivery kind:/,
      kind,
    );
  }

  assert.throws(
    ()=>reminderDeliveryKindConfig(new String('lineup')),
    /Unsupported reminder delivery kind: unknown/,
  );
  assert.throws(
    ()=>reminderDeliveryKindConfig(null),
    /Unsupported reminder delivery kind: unknown/,
  );
});

test('unsupported prototype keys cannot reach persistence',async()=>{
  const {store,calls}=runtime();
  await assert.rejects(
    store.claimReminderDelivery(
      {telegram_id:7,fixture_id:99},
      '__proto__',
      {supabaseUrl:'https://example.supabase.co'},
    ),
    /Unsupported reminder delivery kind: __proto__/,
  );
  assert.equal(calls.length,0);
});

test('claim uses each registry contract without changing delivery semantics',async()=>{
  const {store,calls}=runtime();
  const cfg={supabaseUrl:'https://example.supabase.co'};
  const row={
    telegram_id:7,
    fixture_id:99,
    prematch_attempts:2,
    kickoff_attempts:3,
    lineup_attempts:4,
    important_change_attempts:5,
  };

  for(const [index,[kind,config]] of Object.entries(EXPECTED_KINDS).entries()){
    const result=await store.claimReminderDelivery(row,kind,cfg);
    assert.equal(result.claimed,true);

    const call=calls[index];
    assert.ok(call);
    assert.match(call.url,new RegExp(`${config.doneColumn}=is\\.null`));
    assert.match(call.url,new RegExp(`${config.claimColumn}=is\\.null`));
    assert.equal(call.body[config.attemptsColumn],row[config.attemptsColumn]+1);
    assert.equal(call.body[config.claimColumn],'2026-09-29T20:00:00.000Z');
    assert.equal(call.body.delivery_last_error,'delivery_claimed');
  }

  assert.equal(calls.length,4);
});
