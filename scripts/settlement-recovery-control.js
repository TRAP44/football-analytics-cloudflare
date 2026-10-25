// Main-only protected workflow; reuse the audited CAS runtime-control mutation.
import {pathToFileURL} from 'node:url';
import {createRuntimeControlsRuntime} from '../src/runtime-controls.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
export async function configureSettlementRecovery({mode,env=process.env,fetchImpl=fetch}={}) {
  if (!['enable','disable'].includes(mode)) fail('SETTLEMENT_CONTROL_MODE');
  if (env.GITHUB_ACTIONS!=='true' || env.GITHUB_REF!=='refs/heads/main' || env.GITHUB_EVENT_NAME!=='workflow_dispatch') fail('SETTLEMENT_CONTROL_PROTECTED_RUNNER');
  let origin;try{origin=new URL(env.SUPABASE_URL);}catch{fail('SETTLEMENT_CONTROL_CONFIGURATION');}
  const key=env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || origin.protocol!=='https:' || !/^[a-z0-9]+\.supabase\.co$/.test(origin.hostname) || origin.pathname!=='/' || origin.search || origin.hash || origin.username || origin.password) fail('SETTLEMENT_CONTROL_CONFIGURATION');
  const cfg={supabaseUrl:origin.origin};
  const headers=extra=>({apikey:key,'Content-Type':'application/json',...extra});
  const request=(url,init={})=>fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(7000)});
  const allowedTables=new Set(['runtime_controls','runtime_control_history']);
  async function select(_cfg,table,filter={},options={}) {
    if (!allowedTables.has(table)) fail('SETTLEMENT_CONTROL_TABLE');
    const url=new URL('/rest/v1/'+table,origin);
    url.search=new URLSearchParams({select:'*',...filter,limit:String(options.limit || 1),...(options.order?{order:options.order}:{})});
    const response=await request(url,{headers:headers()});
    if (!response.ok) fail('SETTLEMENT_CONTROL_READ');
    const rows=await response.json();
    if (!Array.isArray(rows) || rows.length>Number(options.limit || 1)) fail('SETTLEMENT_CONTROL_READ');
    return rows;
  }
  const runtime=createRuntimeControlsRuntime({
    memory:{},DEFAULT_RUNTIME_CONTROLS:{},RUNTIME_CONTROLS_CACHE_MS:1,APP_VERSION:'settlement-recovery-workflow',
    hasSupabase:()=>true,supaSelectOne:async(...args)=>(await select(...args))[0] || null,supaSelectMany:select,
    supaHeaders:(_cfg,extra)=>headers(extra),fetchWithTimeout:request,
    supaInsertIgnore:async(_cfg,table,row)=>{
      if(table!=='runtime_control_history')fail('SETTLEMENT_CONTROL_TABLE');
      const url=new URL('/rest/v1/runtime_control_history?on_conflict=revision',origin);
      const response=await request(url,{method:'POST',headers:headers({Prefer:'resolution=ignore-duplicates'}),body:JSON.stringify(row)});
      if(!response.ok)fail('SETTLEMENT_CONTROL_BASELINE');
      await response.body?.cancel();
    },
    // The existing mutation writes the transactional runtime history. No ops row
    // with raw database errors is emitted by this operational script.
    recordOpsEvent:async()=>{},redactOpsString:()=>'',json:()=>{throw Error('Unused HTTP adapter');},isAdminUser:()=>false,
  });
  const before=await runtime.loadRuntimeControls(cfg,{force:true});
  if (!before.schemaReady || before.source!=='supabase' || before.value.controlPlaneFailClosed) fail('SETTLEMENT_CONTROL_UNVERIFIED');
  if (mode==='enable' && before.value.maintenanceMode) fail('SETTLEMENT_CONTROL_PAUSED');
  const enabled=mode==='enable';
  if (before.value.autoSettlementRecoveryEnabled===enabled) return {ok:true,enabled,changed:false,revision:before.value.revision};
  const result=await runtime.saveRuntimeControls(cfg,null,{
    ...before.value,expectedRevision:before.value.revision,autoSettlementRecoveryEnabled:enabled,
    reason:enabled?'Включена ограниченная автоматическая сверка старых результатов по поручению владельца':'Отключена автоматическая сверка результатов из защищённого workflow',
  });
  if (result.error) fail(result.code || 'SETTLEMENT_CONTROL_WRITE_UNCONFIRMED');
  const after=await runtime.loadRuntimeControls(cfg,{force:true});
  if (after.source!=='supabase' || !after.schemaReady || after.value.autoSettlementRecoveryEnabled!==enabled || after.value.revision!==before.value.revision+1) fail('SETTLEMENT_CONTROL_READBACK');
  for (const name of ['maintenanceMode','analysisEnabled','searchEnabled','liveEnabled','remindersEnabled','expandedDataEnabled','aiEnabled','message']) {
    if (after.value[name]!==before.value[name]) fail('SETTLEMENT_CONTROL_UNEXPECTED_CHANGE');
  }
  return {ok:true,enabled,changed:true,revision:after.value.revision};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify(await configureSettlementRecovery({mode:process.env.SETTLEMENT_AUTOMATION})));}
  catch(error){console.error(/^[A-Z_]+$/.test(error?.code || '')?error.code:'SETTLEMENT_CONTROL_FAILED');process.exitCode=1;}
}
