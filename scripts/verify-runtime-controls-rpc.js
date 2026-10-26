// Exercises the real application save path without changing any feature flag.
// A successful proof adds one explicitly attributed audit revision.
import {pathToFileURL} from 'node:url';
import {createRuntimeControlsRuntime} from '../src/runtime-controls.js';
import {createSupabaseClient} from '../src/supabase-client.js';
import {selectMergedPullRequest} from './verify-main-pr-provenance.js';

const fields=['maintenance_mode','analysis_enabled','search_enabled','live_enabled','reminders_enabled','expanded_data_enabled','auto_settlement_recovery_enabled','ai_enabled'];
const camel={maintenance_mode:'maintenanceMode',analysis_enabled:'analysisEnabled',search_enabled:'searchEnabled',live_enabled:'liveEnabled',reminders_enabled:'remindersEnabled',expanded_data_enabled:'expandedDataEnabled',auto_settlement_recovery_enabled:'autoSettlementRecoveryEnabled',ai_enabled:'aiEnabled'};
const fail=()=>{throw new Error('RUNTIME_RPC_PROOF_UNCONFIRMED');};
export async function verifyRuntimeControlsRpc({origin,key,actorId,fetchImpl=fetch}={}){
  // Construct destinations from literals, never from a status file or env URL.
  const base=(origin==='https://nlmvhkjkpgzzlfavaohk.supabase.co'||origin==='https://nlmvhkjkpgzzlfavaohk.supabase.co/')?'https://nlmvhkjkpgzzlfavaohk.supabase.co'
    :(origin==='http://127.0.0.1:54321'||origin==='http://127.0.0.1:54321/')?'http://127.0.0.1:54321':null;
  if(!base||!key||!Number.isSafeInteger(actorId)||actorId<1)fail();
  const headers=createSupabaseClient({fetchWithTimeout:fetchImpl}).supaHeaders({supabaseUrl:base,supabaseKey:key});
  const request=(path,init={})=>fetchImpl(base+'/rest/v1/'+path,{...init,headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  const read=async(path)=>{const response=await request(path);if(!response.ok)fail();return response.json();};
  // The application credentials can prove the schema directly; no deployment
  // credentials need to cross into the background-jobs environment.
  const schemaResponse=await request('rpc/backend_schema_contract_v2',{method:'POST',body:'{}'});
  if(!schemaResponse.ok)fail();
  const schema=await schemaResponse.json();
  if(schema?.version!==2||schema?.ok!==true||!['ef7b0db33b20c122b9382f3c9b1dd7c7','28942368323a2aaa693987bc0225da34'].includes(schema.fingerprint)
    ||schema.runtimeMutationFingerprint!=='d23f93e48ea4d578a5f031f4ee352bfd')fail();
  const securityResponse=await request('rpc/backend_security_contract',{method:'POST',body:'{}'});
  if(!securityResponse.ok||(await securityResponse.json())?.ok!==true)fail();
  const rows=await read('runtime_controls?id=eq.global&select=*');
  if(!Array.isArray(rows)||rows.length!==1)fail();
  const before=rows[0];
  if(before.maintenance_mode!==false||fields.some(field=>typeof before[field]!=='boolean')||typeof before.message!=='string')fail();
  const defaults=Object.fromEntries(fields.map(field=>[camel[field],before[field]]));
  const runtime=createRuntimeControlsRuntime({memory:{},DEFAULT_RUNTIME_CONTROLS:{...defaults,message:'',revision:1,updatedAt:null},
    RUNTIME_CONTROLS_CACHE_MS:0,SUPABASE_SCHEMA_GUIDANCE:'schema not ready',APP_VERSION:'runtime-rpc-proof',hasSupabase:()=>true,
    supaSelectOne:async()=>{const current=await read('runtime_controls?id=eq.global&select=*');return current.length===1?current[0]:null;},
    supaSelectMany:async()=>[],supaInsertIgnore:async()=>{throw new Error('APP_BASELINE_WRITE_FORBIDDEN');},
    fetchWithTimeout:(target,init)=>fetchImpl(target,{...init,redirect:'error',signal:AbortSignal.timeout(10000)}),
    supaHeaders:()=>headers,recordOpsEvent:async()=>{},redactOpsString:()=>'',json:()=>{},isAdminUser:()=>false});
  const result=await runtime.saveRuntimeControls({supabaseUrl:base},{id:actorId},
    {...defaults,message:before.message,expectedRevision:before.revision,action:'update',reason:'Проверка атомарного сохранения без изменения функций'});
  if(result.error)fail();
  const afterRows=await read('runtime_controls?id=eq.global&select=*');
  const after=afterRows?.[0];
  if(afterRows.length!==1||after.revision!==before.revision+1||after.updated_by!==actorId
    ||[...fields,'message'].some(field=>after[field]!==before[field]))fail();
  const audits=await read('runtime_control_history?revision=eq.'+after.revision+'&select=*');
  if(audits.length!==1||audits[0].changed_by!==actorId||audits[0].snapshot?.revision!==after.revision
    ||fields.some(field=>audits[0].snapshot?.[camel[field]]!==after[field])||audits[0].snapshot.message!==after.message)fail();
  return {verified:true,featureFlagsUnchanged:true,auditConfirmed:true,revision:after.revision};
}

export async function verifyRuntimeProofMain({env=process.env,fetchImpl=fetch}={}){
  const repository='TRAP44/football-analytics-cloudflare';
  if(env.GITHUB_REPOSITORY!==repository||env.GITHUB_REF!=='refs/heads/main'||! /^[0-9a-f]{40}$/.test(env.GITHUB_SHA||'')||!env.GITHUB_TOKEN)fail();
  const get=async path=>{
    const response=await fetchImpl(`https://api.github.com/repos/TRAP44/football-analytics-cloudflare/${path}`,{method:'GET',redirect:'error',headers:{Accept:'application/json',Authorization:`Bearer ${env.GITHUB_TOKEN}`},signal:AbortSignal.timeout(10000)});
    if(!response.ok)fail();return response.json();
  };
  if((await get('branches/main'))?.commit?.sha!==env.GITHUB_SHA)fail();
  if(!selectMergedPullRequest(await get(`commits/${env.GITHUB_SHA}/pulls`),'main',repository))fail();
}

if(import.meta.url===(process.argv[1]?pathToFileURL(process.argv[1]).href:'')){
  try{
    await verifyRuntimeProofMain();
    const actorId=Number(String(process.env.ADMIN_TELEGRAM_IDS||'').split(/[,\s]+/).filter(Boolean)[0]);
    const report=await verifyRuntimeControlsRpc({origin:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,actorId});
    console.log(JSON.stringify(report));
  }catch{console.error('RUNTIME_RPC_PROOF_UNCONFIRMED');process.exitCode=1;}
}
