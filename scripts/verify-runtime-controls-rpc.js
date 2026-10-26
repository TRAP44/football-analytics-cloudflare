// Exercises the real application save path without changing any feature flag.
// A successful proof adds one explicitly attributed audit revision.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRuntimeControlsRuntime} from '../src/runtime-controls.js';
import {applyRuntimeMigration} from './apply-runtime-controls.js';

const fields=['maintenance_mode','analysis_enabled','search_enabled','live_enabled','reminders_enabled','expanded_data_enabled','auto_settlement_recovery_enabled','ai_enabled'];
const camel={maintenance_mode:'maintenanceMode',analysis_enabled:'analysisEnabled',search_enabled:'searchEnabled',live_enabled:'liveEnabled',reminders_enabled:'remindersEnabled',expanded_data_enabled:'expandedDataEnabled',auto_settlement_recovery_enabled:'autoSettlementRecoveryEnabled',ai_enabled:'aiEnabled'};
const fail=()=>{throw new Error('RUNTIME_RPC_PROOF_UNCONFIRMED');};
export async function verifyRuntimeControlsRpc({origin,key,actorId,fetchImpl=fetch}={}){
  let url;try{url=new URL(origin);}catch{fail();}
  if(!((url.protocol==='https:'&&url.hostname==='nlmvhkjkpgzzlfavaohk.supabase.co')
    ||(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))
    ||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!key||!Number.isSafeInteger(actorId)||actorId<1)fail();
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  const request=(path,init={})=>fetchImpl(url.origin+'/rest/v1/'+path,{...init,headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  const read=async(path)=>{const response=await request(path);if(!response.ok)fail();return response.json();};
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
  const result=await runtime.saveRuntimeControls({supabaseUrl:url.origin},{id:actorId},
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

if(import.meta.url===(process.argv[1]?pathToFileURL(process.argv[1]).href:'')){
  try{
    // Reuses exact-main/provenance/strict schema checks before this bounded write.
    const state=await applyRuntimeMigration({env:{...process.env,RUNTIME_MIGRATION_MODE:'preflight'}});
    if(state.status!=='already_applied')fail();
    const actorId=Number(String(process.env.ADMIN_TELEGRAM_IDS||'').split(/[,\s]+/).filter(Boolean)[0]);
    const report=await verifyRuntimeControlsRpc({origin:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,actorId});
    console.log(JSON.stringify(report));
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Runtime RPC verified: unchanged flags, audited revision ${report.revision}.\n`);
  }catch{console.error('RUNTIME_RPC_PROOF_UNCONFIRMED');process.exitCode=1;}
}
