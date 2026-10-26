import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeControlsRuntime} from '../src/runtime-controls.js';
import {verifyRuntimeControlsRpc} from '../scripts/verify-runtime-controls-rpc.js';

const row={id:'global',revision:7,maintenance_mode:false,analysis_enabled:true,search_enabled:true,live_enabled:true,reminders_enabled:true,expanded_data_enabled:true,auto_settlement_recovery_enabled:true,ai_enabled:true,message:'',updated_at:'2026-10-26T00:00:00.000Z',updated_by:1};
const input={expectedRevision:7,maintenanceMode:false,analysisEnabled:true,searchEnabled:true,liveEnabled:true,remindersEnabled:true,expandedDataEnabled:true,autoSettlementRecoveryEnabled:true,aiEnabled:false,message:'',reason:'Проверка',action:'update',updated_by:999,p_actor_id:999};
function harness(response){
  const calls=[];const memory={};
  const api=createRuntimeControlsRuntime({memory,DEFAULT_RUNTIME_CONTROLS:{...input,revision:1},RUNTIME_CONTROLS_CACHE_MS:0,SUPABASE_SCHEMA_GUIDANCE:'schema',APP_VERSION:'test',
    hasSupabase:()=>true,supaSelectOne:async()=>({...row}),supaSelectMany:async()=>[],supaInsertIgnore:async()=>{throw Error('baseline is transactional');},
    fetchWithTimeout:async(url,init)=>{calls.push({url:String(url),init});if(String(url).includes('/runtime_control_history'))return Response.json([]);return response(init);},
    supaHeaders:()=>({apikey:'test'}),recordOpsEvent:async()=>{},redactOpsString:()=>'',json:()=>{},isAdminUser:()=>false});
  return {api,calls,memory,save:(actor={id:440})=>api.saveRuntimeControls({supabaseUrl:'https://db.invalid'},actor,input)};
}
test('application uses only RPC, trusted actor and server revision, preserves auto recovery',async()=>{
  const h=harness(init=>{const args=JSON.parse(init.body);assert.equal(args.p_actor_id,440);assert.equal(args.p_expected_revision,7);assert.equal(args.p_source_revision,null);
    assert.equal(args.p_controls.auto_settlement_recovery_enabled,true);assert.equal(args.p_controls.ai_enabled,false);
    assert.equal(args.p_controls.revision,undefined);return Response.json([{...row,...args.p_controls,revision:8,updated_by:440}]);});
  const result=await h.save();assert.equal(result.error,undefined);assert.equal(h.memory.runtimeControls.value.revision,8);
  const write=h.calls.find(call=>call.init?.method==='POST');assert.ok(write.url.endsWith('/rpc/commit_runtime_controls_v2'));
  assert.equal(h.calls.filter(call=>call.init?.method==='PATCH').length,0);
});
test('no trusted actor prevents a mutation',async()=>{
  const h=harness(()=>{throw Error('must not write');});assert.equal((await h.save({id:null})).status,403);
  assert.equal(h.calls.filter(call=>call.init?.method==='POST').length,0);
});
test('unknown commit never retries or publishes unconfirmed state',async()=>{
  for(const response of [()=>{throw Error('timeout');},()=>new Response('',{status:408}),()=>new Response('',{status:503}),()=>new Response('broken'),()=>Response.json({revision:8}),()=>Response.json([row,row])]){
    const h=harness(response);const result=await h.save();assert.equal(result.code,'RUNTIME_CONTROLS_WRITE_UNCONFIRMED');assert.equal(result.status,503);
    assert.equal(h.calls.filter(call=>call.init?.method==='POST').length,1);assert.equal(h.memory.runtimeControls.value.revision,7);
  }
});
test('missing RPC and stale CAS fail without a PATCH fallback',async()=>{
  for(const [response,code] of [[()=>new Response('',{status:404}),'RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED'],[()=>Response.json([]),'RUNTIME_CONTROLS_CONFLICT']]){
    const h=harness(response);assert.equal((await h.save()).code,code);assert.equal(h.calls.filter(call=>call.init?.method==='POST').length,1);
    assert.equal(h.calls.filter(call=>call.init?.method==='PATCH').length,0);
  }
});
test('HTTP proof exercises the actual save path with unchanged flags and confirms its audit',async()=>{
  for(const key of ['sb_secret_local_only','eyJlocal.legacy.synthetic']){
  let current={...row};let args;let posts=0;
  const result=await verifyRuntimeControlsRpc({origin:key.startsWith('sb_')?'http://127.0.0.1:54321/':'http://127.0.0.1:54321',key,actorId:440,fetchImpl:async(url,init)=>{
    assert.equal(init.headers.apikey,key);assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers.authorization,undefined);
    if(init.method==='POST'){
      posts++;args=JSON.parse(init.body);current={...current,...args.p_controls,revision:current.revision+1,updated_by:args.p_actor_id};return Response.json([current]);
    }
    if(String(url).includes('/runtime_control_history?revision='))return Response.json([{changed_by:440,snapshot:{revision:8,maintenanceMode:false,analysisEnabled:true,searchEnabled:true,liveEnabled:true,remindersEnabled:true,expandedDataEnabled:true,autoSettlementRecoveryEnabled:true,aiEnabled:true,message:''}}]);
    if(String(url).includes('/runtime_control_history'))return Response.json([]);
    return Response.json([current]);
  }});
  assert.equal(posts,1);assert.equal(result.verified,true);assert.equal(result.featureFlagsUnchanged,true);assert.equal(args.p_controls.auto_settlement_recovery_enabled,true);
  }
});

test('proof rejects foreign, altered-port and file-controlled URL destinations before HTTP',async()=>{
  for(const origin of ['https://foreign.invalid','https://nlmvhkjkpgzzlfavaohk.supabase.co:1234','http://127.0.0.1:9000','http://127.0.0.1:54321/redirect']){
    let calls=0;await assert.rejects(verifyRuntimeControlsRpc({origin,key:'local',actorId:440,fetchImpl:()=>{calls++;}}));assert.equal(calls,0);
  }
});
