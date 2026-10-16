import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseClient} from '../src/supabase-client.js';
import {createCommonInfrastructureRuntime} from '../src/common-infrastructure-runtime.js';
import {enforceDistributedAccountRateLimit} from '../src/account-rate-limit.js';

test('the claim deadline aborts response body reading after fetch headers have arrived',async t=>{
 let bodyAborted=false,signal;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  signal=init.signal;
  return {ok:true,json:()=>new Promise((_,reject)=>{
   signal.addEventListener('abort',()=>{bodyAborted=true;reject(signal.reason);},{once:true});
  })};
 });
 const infrastructure=createCommonInfrastructureRuntime({bumpTelemetry:()=>{}});
 const client=createSupabaseClient({fetchWithTimeout:infrastructure.fetchWithTimeout});
 await assert.rejects(client.supaRpc({supabaseUrl:'https://local.test',supabaseKey:'dummy'},'claim_provider_request',{p_bucket_key:'preauth:body',p_limit:1,p_window_seconds:60},600),{code:'UPSTREAM_TIMEOUT'});
 assert.equal(signal.aborted,true);assert.equal(bodyAborted,true);
});

test('local admission overflow cannot bypass the distributed account limiter',async()=>{
 for(const code of ['RATE_CLAIM_ADMISSION_FULL','RATE_CLAIM_BUCKET_FULL']){
  const telemetry=[];
  const result=await enforceDistributedAccountRateLimit({
   request:new Request('https://local.test/api/analyze',{method:'POST'}),user:{id:17},cfg:{},memory:{},hasSupabase:()=>true,
   supaRpc:async()=>{throw Object.assign(new Error('queue full'),{code});},bumpTelemetry:key=>telemetry.push(key),json:(body,status,headers)=>({body,status,headers}),
  });
  assert.equal(result.status,503);assert.equal(result.body.code,'ACCOUNT_RATE_GUARD_BUSY');assert.equal(result.headers['retry-after'],'1');
  assert.ok(telemetry.includes('distributedBurstAdmissionBlocks'));assert.ok(!telemetry.includes('distributedBurstFallbacks'));
 }
});
