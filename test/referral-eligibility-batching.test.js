import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferralRewardsRuntime} from '../src/referral-rewards-runtime.js';
const cfg={supabaseUrl:'https://local.test',supabaseKey:'dummy-local'};
function harness(read, rpc=async()=>({granted:false,reason:'already_granted'})){
 const reads=[],grants=[],messages=[];
 const rt=createReferralRewardsRuntime({ensureReferralCode:async()=>'',hasSupabase:()=>true,json:x=>x,memory:{},supaPatch:async()=>{},telegramBotUsername:async()=>'',recordOpsEvent:async()=>{},recordGrowthEvent:async()=>{},telegramApi:async(...args)=>messages.push(args),
 supaSelectMany:async(...args)=>{reads.push(args);return read(...args);},supaRpc:async(...args)=>{grants.push(args);return rpc(...args);}});
 return{rt,reads,grants,messages};
}
const requested=filters=>filters.event_key.slice(4,-1).split(',').map(key=>Number(key.split(':')[1]));
test('1000 non-referrals use ten bounded fresh reads without reward RPCs',async()=>{
 const h=harness(async()=>[]);
 const result=await Promise.all(Array.from({length:1000},(_,i)=>h.rt.grantReferralRewards(i+1,cfg)));
 assert.equal(h.reads.length,10);assert.equal(h.grants.length,0);
 assert.ok(result.every(row=>row.reason==='not_referred'));
 for(const [,table,filters,options] of h.reads){assert.equal(table,'growth_events');assert.equal(filters.event_name,'eq.referred_first_open');assert.ok(requested(filters).length<=100);assert.equal(options.limit,100);}
});
test('only actual referrals reach atomic RPC, preserving cap, event and notification',async()=>{
 const h=harness(async(_cfg,_table,filters)=>requested(filters).filter(id=>id===2).map(id=>({telegram_id:id,event_key:`referral_attribution:${id}`})),async()=>({granted:true,referrerGranted:true,referrerId:77}));
 const result=await Promise.all([h.rt.grantReferralRewards(1,cfg),h.rt.grantReferralRewards(2,cfg)]);
 assert.equal(result[0].reason,'not_referred');assert.equal(result[1].granted,true);
 assert.equal(h.grants.length,1);assert.deepEqual(h.grants[0].slice(1),['grant_referral_rewards',{p_referred_telegram_id:2,p_monthly_cap:10}]);assert.equal(h.messages.length,1);
});
test('unconfirmed or malformed attribution reads fall back once to atomic RPC',async()=>{
 for(const read of [async()=>{throw new Error('offline');},async()=>null,async()=>[{telegram_id:999,event_key:'referral_attribution:999'}],async()=>[{telegram_id:1,event_key:'wrong'}],async()=>[{telegram_id:1,event_key:'referral_attribution:1'},{telegram_id:1,event_key:'referral_attribution:1'}]]){
  const h=harness(read);await h.rt.grantReferralRewards(1,cfg);assert.equal(h.grants.length,1);
 }
});
test('failed grant remains retryable, no blind replay within a call',async()=>{
 const h=harness(async()=>{throw new Error('offline');},async()=>{throw new Error('unknown outcome');});
 assert.equal((await h.rt.grantReferralRewards(1,cfg)).reason,'rpc_failed');assert.equal(h.grants.length,1);
 assert.equal((await h.rt.grantReferralRewards(1,cfg)).reason,'rpc_failed');assert.equal(h.grants.length,2);
});
test('connection identities do not mix; unknown identity keeps original RPC path',async()=>{
 const h=harness(async()=>[]);
 await Promise.all([h.rt.grantReferralRewards(1,cfg),h.rt.grantReferralRewards(2,{...cfg,supabaseKey:'other'}),h.rt.grantReferralRewards(3,{...cfg,supabaseUrl:'https://other.test'}),h.rt.grantReferralRewards(4,{})]);
 assert.equal(h.reads.length,3);assert.equal(h.grants.length,1);assert.equal(h.grants[0][2].p_referred_telegram_id,4);
});
