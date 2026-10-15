import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuotaUsageRuntime} from '../src/quota-usage-runtime.js';

const cfg={limits:{FREE:3,PRO:20,PREMIUM:100}};
function runtime(row){
  const reads=[];let recordReads=0;
  const api=createQuotaUsageRuntime({memory:{usage:new Map()},hasSupabase:()=>true,
    getUserRecord:async()=>{recordReads++;throw new Error('separate user read forbidden');},
    supaSelectOne:async(_cfg,table,params)=>{reads.push({table,params});if(row instanceof Error)throw row;return typeof row==='function'?row():row;},
    supaRpc:async()=>{throw new Error('quota snapshot must not mutate');},todayUtc:()=> '2026-10-15',
    bumpTelemetry:()=>{},durableAnalysisUsageHeaders:()=>({}),recordOpsEvent:async()=>{},redactOpsString:String});
  return {api,reads,get recordReads(){return recordReads;}};
}
test('quota snapshot reads live plan and only current-day usage in one joined REST request',async()=>{
  const r=runtime({plan:'PRO',subscription_until:new Date(Date.now()+3600000).toISOString(),usage_daily:[{analyses:7}]});
  assert.deepEqual(await r.api.getQuota(42,cfg),{plan:'PRO',used:7,limit:20,left:13});
  assert.equal(r.recordReads,0);
  assert.deepEqual(r.reads,[{table:'users',params:{telegram_id:'eq.42',select:'plan,subscription_until,usage_daily(analyses)','usage_daily.usage_date':'eq.2026-10-15','usage_daily.limit':'1'}}]);
});
test('joined quota snapshot preserves expiry, empty usage, invalid-user and read-failure behavior',async()=>{
  const expired=runtime({plan:'PREMIUM',subscription_until:'2000-01-01T00:00:00Z',usage_daily:[{analyses:5}]});
  assert.deepEqual(await expired.api.getQuota(42,cfg),{plan:'FREE',used:5,limit:3,left:0});
  const empty=runtime({plan:'FREE',usage_daily:[]});
  assert.deepEqual(await empty.api.getQuota(42,cfg),{plan:'FREE',used:0,limit:3,left:3});
  const missing=runtime(null);
  assert.deepEqual(await missing.api.getQuota(42,cfg),{plan:'FREE',used:0,limit:3,left:3});
  const invalid=runtime(null);
  assert.deepEqual(await invalid.api.getQuota('invalid',cfg),{plan:'FREE',used:0,limit:0,left:0});
  assert.equal(invalid.reads.length,0);
  await assert.rejects(()=>runtime(new Error('simulated DB outage')).api.getQuota(42,cfg),/simulated DB outage/);
});

test('joined snapshot rereads current subscription and usage after a plan change; no cross-request cache',async()=>{
  let current={plan:'PRO',subscription_until:new Date(Date.now()+3600000).toISOString(),usage_daily:[{analyses:2}]};
  const r=runtime(()=>current);
  assert.equal((await r.api.getQuota(42,cfg)).plan,'PRO');
  current={plan:'FREE',subscription_until:null,usage_daily:[{analyses:3}]};
  assert.deepEqual(await r.api.getQuota(42,cfg),{plan:'FREE',used:3,limit:3,left:0});
  assert.equal(r.reads.length,2);
});
