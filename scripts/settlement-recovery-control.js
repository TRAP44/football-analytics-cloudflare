// Fixed main-only operational mutation. PostgREST data-modifying CTEs cannot
// update tables with DO ALSO audit rules; plain SQL inside this transaction can.
import {pathToFileURL} from 'node:url';
import {runRecoveryPostgres} from './apply-durable-recovery.js';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const REPOSITORY='TRAP44/football-analytics-cloudflare';
const reportSql=`select pg_catalog.json_build_object('enabled',r.auto_settlement_recovery_enabled,'revision',r.revision,'maintenanceMode',r.maintenance_mode,
  'securityOk',coalesce((public.backend_security_contract()->>'ok')::boolean,false),
  'audited',exists(select 1 from public.runtime_control_history h where h.revision=r.revision
    and h.snapshot->>'revision'=r.revision::text and h.snapshot->>'autoSettlementRecoveryEnabled'=r.auto_settlement_recovery_enabled::text))
  from public.runtime_controls r where r.id='global'`;
export function settlementControlSql(enabled){
  if(typeof enabled!=='boolean')fail('SETTLEMENT_CONTROL_MODE');
  const reason=Buffer.from(enabled?'Включена ограниченная сверка результатов по поручению владельца':'Отключена ограниченная сверка результатов по поручению владельца').toString('hex');
  return `begin; set local lock_timeout='3s'; set local statement_timeout='15s'; set local role service_role;
select pg_catalog.set_config('request.headers','{"x-runtime-action":"update","x-runtime-reason-hex":"${reason}","x-runtime-app-version":"settlement-recovery-workflow"}',true);
do $settlement_control$
declare previous public.runtime_controls%rowtype;
begin
  if coalesce((public.backend_security_contract()->>'ok')::boolean,false) is not true then raise exception 'Settlement security contract unavailable'; end if;
  select * into strict previous from public.runtime_controls where id='global' for update;
  if ${enabled} and previous.maintenance_mode then raise exception 'Settlement control paused'; end if;
  insert into public.runtime_control_history(revision,action,reason,snapshot,app_version,changed_by,source_revision,created_at)
    values(previous.revision,'baseline','Базовое состояние перед настройкой сверки',pg_catalog.jsonb_build_object(
      'maintenanceMode',previous.maintenance_mode,'analysisEnabled',previous.analysis_enabled,'searchEnabled',previous.search_enabled,
      'liveEnabled',previous.live_enabled,'remindersEnabled',previous.reminders_enabled,'expandedDataEnabled',previous.expanded_data_enabled,
      'autoSettlementRecoveryEnabled',previous.auto_settlement_recovery_enabled,'aiEnabled',previous.ai_enabled,'message',previous.message,
      'revision',previous.revision,'updatedAt',previous.updated_at),'settlement-recovery-workflow',null,null,coalesce(previous.updated_at,now()))
    on conflict(revision) do nothing;
  if previous.auto_settlement_recovery_enabled is distinct from ${enabled} then
    if previous.revision>=2147483647 then raise exception 'Settlement revision exhausted'; end if;
    update public.runtime_controls set auto_settlement_recovery_enabled=${enabled},revision=previous.revision+1,updated_at=now(),updated_by=null
      where id='global' and revision=previous.revision;
    if not found then raise exception 'Settlement revision conflict'; end if;
    if not exists(select 1 from public.runtime_control_history where revision=previous.revision+1
      and snapshot->>'autoSettlementRecoveryEnabled'='${enabled}') then raise exception 'Settlement audit unconfirmed'; end if;
  end if;
end $settlement_control$;
commit;`;
}
export async function configureSettlementRecovery({mode,env=process.env,runPostgres=runRecoveryPostgres}={}){
  if(!['enable','disable'].includes(mode))fail('SETTLEMENT_CONTROL_MODE');
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REPOSITORY!==REPOSITORY)fail('SETTLEMENT_CONTROL_PROTECTED_RUNNER');
  const enabled=mode==='enable',options={databaseUrl:env.SUPABASE_DB_URL,signal:AbortSignal.timeout(45000)};
  let writeUnconfirmed=false;
  // Never replay an unknown write. An independent read confirms current state.
  try{await runPostgres({...options,query:settlementControlSql(enabled),write:true});}catch{writeUnconfirmed=true;}
  let state;
  try{state=JSON.parse((await runPostgres({...options,write:false,query:`begin read only; set local role service_role; set local statement_timeout='5s'; ${reportSql}; commit;`})).trim());}catch{fail('SETTLEMENT_CONTROL_READBACK');}
  if(state?.enabled!==enabled||state.securityOk!==true||state.audited!==true||(enabled && state.maintenanceMode!==false)||!Number.isSafeInteger(state.revision)||state.revision<1)fail(writeUnconfirmed?'SETTLEMENT_CONTROL_WRITE_UNCONFIRMED':'SETTLEMENT_CONTROL_READBACK');
  return {ok:true,enabled,revision:state.revision,...(writeUnconfirmed?{confirmedAfterUnknownWrite:true}:{})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await configureSettlementRecovery({mode:process.env.SETTLEMENT_AUTOMATION})));}
  catch(error){console.error(/^[A-Z_]+$/.test(error?.code||'')?error.code:'SETTLEMENT_CONTROL_FAILED');process.exitCode=1;}
}
