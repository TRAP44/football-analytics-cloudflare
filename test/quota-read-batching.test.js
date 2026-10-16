import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuotaUsageRuntime} from '../src/quota-usage-runtime.js';
const cfg={supabaseUrl:'https://local.test',supabaseKey:'dummy-local',limits:{FREE:3,PRO:20,PREMIUM:100}};
function runtime(overrides={}){
 return createQuotaUsageRuntime({memory:{usage:new Map()},bumpTelemetry:()=>{},durableAnalysisUsageHeaders:()=>({}),getUserRecord:async()=>null,hasSupabase:()=>true,recordOpsEvent:async()=>{},redactOpsString:String,supaRpc:async()=>{throw new Error('read must not reserve quota');},supaSelectOne:async()=>{throw new Error('unexpected single read');},todayUtc:()=> '2026-10-16',...overrides});
}
const ids=params=>params.telegram_id.slice(4,-1).split(',').map(Number);

test('1000 quota callers use ten fresh bounded reads, preserve user usage and wait for DB',async()=>{
 const calls=[],gates=[];let completed=0;
 const rt=runtime({supaSelectMany:async(_cfg,table,params,options)=>{
  calls.push({table,params,options});await new Promise(resolve=>gates.push(resolve));
  return ids(params).map(id=>({telegram_id:id,plan:id%2?'PRO':'FREE',usage_daily:[{analyses:id%3}]}));
 }});
 const pending=Array.from({length:1000},(_,i)=>rt.getQuota(i+1,{...cfg}).then(result=>{completed++;return result;}));
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls.length,10);assert.equal(completed,0);assert.ok(calls.every(call=>ids(call.params).length<=100));
 gates.forEach(resolve=>resolve());const results=await Promise.all(pending);
 assert.deepEqual(results[0],{plan:'PRO',used:1,limit:20,left:19});
 assert.deepEqual(results[1],{plan:'FREE',used:2,limit:3,left:1});
 assert.equal(completed,1000);
});

test('no subscription/usage cache: a subsequent read sees plan changes and each caller uses its own limits',async()=>{
 let plan='PRO',calls=0;
 const rt=runtime({supaSelectMany:async(_cfg,_table,params)=>{calls++;return ids(params).map(id=>({telegram_id:id,plan,usage_daily:[]}));}});
 const [one,two]=await Promise.all([rt.getQuota(1,cfg),rt.getQuota(1,{...cfg,limits:{...cfg.limits,PRO:7}})]);
 assert.equal(one.limit,20);assert.equal(two.limit,7);assert.equal(calls,1);
 plan='FREE';assert.equal((await rt.getQuota(1,cfg)).limit,3);assert.equal(calls,2);
});

test('quota reads separate project/key and UTC usage dates across midnight',async()=>{
 let date='2026-10-16';const calls=[];
 const rt=runtime({todayUtc:()=>date,supaSelectMany:async(config,_table,params)=>{
  calls.push({url:config.supabaseUrl,key:config.supabaseKey,date:params['usage_daily.usage_date']});
  return ids(params).map(id=>({telegram_id:id,plan:'FREE',usage_daily:[{analyses:params['usage_daily.usage_date'].endsWith('16')?2:0}]}));
 }});
 const first=rt.getQuota(1,cfg);date='2026-10-17';
 const results=await Promise.all([first,rt.getQuota(1,cfg),rt.getQuota(2,{...cfg,supabaseKey:'other-key'}),rt.getQuota(3,{...cfg,supabaseUrl:'https://other.test'})]);
 assert.equal(calls.length,4);assert.equal(results[0].used,2);assert.equal(results[1].used,0);
 assert.equal(new Set(calls.map(call=>JSON.stringify(call))).size,4);
});

test('batch read failure retries individual snapshots and propagates unconfirmed single failures',async()=>{
 const singles=[];
 const rt=runtime({supaSelectMany:async()=>{throw new Error('batch unavailable');},supaSelectOne:async(_cfg,_table,params)=>{
  const id=Number(params.telegram_id.slice(3));singles.push(id);
  if(id===2)throw new Error('snapshot unavailable');
  return {plan:'PRO',subscription_until:'2000-01-01T00:00:00Z',usage_daily:[{analyses:1}]};
 }});
 const results=await Promise.allSettled([rt.getQuota(1,cfg),rt.getQuota(2,cfg)]);
 assert.deepEqual(singles,[1,2]);assert.equal(results[0].value.plan,'FREE');assert.equal(results[0].value.used,1);
 assert.equal(results[1].status,'rejected');assert.match(results[1].reason.message,/snapshot unavailable/);
});

test('unexpected batch user falls back instead of treating the caller as an absent FREE user',async()=>{
 let singles=0;
 const rt=runtime({supaSelectMany:async()=>[{telegram_id:999,plan:'FREE'}],supaSelectOne:async()=>{singles++;return{plan:'PRO',usage_daily:[{analyses:3}]};}});
 assert.deepEqual(await rt.getQuota(7,cfg),{plan:'PRO',used:3,limit:20,left:17});assert.equal(singles,1);
});
