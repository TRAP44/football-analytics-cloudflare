// Fixed v20 rollout only. Existing strict TLS/project subprocess boundary is shared.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateSupabaseMigrationContract} from './verify-supabase-contract.js';
import {selectMergedPullRequest} from './verify-main-pr-provenance.js';
import {runRecoveryPostgres} from './apply-durable-recovery.js';
const REPOSITORY='TRAP44/football-analytics-cloudflare';
const PROJECT='nlmvhkjkpgzzlfavaohk';
const MIGRATION='supabase/migrations/supabase_migration_v6_29_20.sql';
const MIGRATION_NAME='supabase_migration_v6_29_20';
const PREVIOUS_FINGERPRINTS=['ecd2e855833b78694bef24223878eb19','809a9b16fd55a19b3756f207da28c817'];
const REVIEWED_SOURCE_MD5='1b1f30c9f1b8c0b51bd85aea62359507';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export const RUNTIME_MIGRATION_STATE_SQL=`select public.backend_schema_contract_v2()->>'fingerprint' as fingerprint,
  coalesce((public.backend_security_contract()->>'ok')::boolean,false) as security_ok,
  (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.commit_runtime_controls_v2(integer,jsonb,text,text,text,bigint,integer)')) as runtime_source,
  case when pg_catalog.to_regprocedure('public.commit_runtime_controls_v2(integer,jsonb,text,text,text,bigint,integer)') is null then false else
    pg_catalog.has_function_privilege('service_role','public.commit_runtime_controls_v2(integer,jsonb,text,text,text,bigint,integer)','execute')
    and not pg_catalog.has_function_privilege('anon','public.commit_runtime_controls_v2(integer,jsonb,text,text,text,bigint,integer)','execute')
    and not pg_catalog.has_function_privilege('authenticated','public.commit_runtime_controls_v2(integer,jsonb,text,text,text,bigint,integer)','execute') end as runtime_grants_ok`;
export async function readRuntimeMigrationState(options={}){
  const query=`begin read only; set local role service_role; set local statement_timeout=5000; set local lock_timeout=1000; select pg_catalog.row_to_json(runtime_state) from (${RUNTIME_MIGRATION_STATE_SQL}) runtime_state; commit;`;
  const stdout=await runRecoveryPostgres({...options,query,write:false});
  try{const result=JSON.parse(stdout.trim());if(result&&typeof result==='object'&&!Array.isArray(result))return result;}catch{}
  fail('RUNTIME_MIGRATION_STATE_INVALID');
}
export async function applyRuntimeSql({databaseUrl,signal,run,root=process.cwd()}={}){
  const {releaseContract:contract,latestMigration}=validateSupabaseMigrationContract(root);
  if(latestMigration!==MIGRATION)fail('RUNTIME_MIGRATION_CONTRACT_INVALID');
  const reviewed=JSON.parse(fs.readFileSync(`${root}/test-support/runtime-controls-v20-contract.json`,'utf8'));
  const sql=fs.readFileSync(`${root}/${MIGRATION}`,'utf8');
  if(createHash('sha256').update(sql).digest('hex')!==reviewed.sqlSha256||reviewed.sourceMd5!==REVIEWED_SOURCE_MD5)fail('RUNTIME_MIGRATION_SOURCE_MISMATCH');
  const db=contract.databaseContract,quote='$matchradar_v20_source$';
  if(sql.includes(quote)||db.fingerprint!==reviewed.productionFingerprint||db.freshInstallFingerprint!==reviewed.freshFingerprint)fail('RUNTIME_MIGRATION_CONTRACT_INVALID');
  const query=`begin; set local lock_timeout='3s'; set local statement_timeout='20s';
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('matchradar:schema-migration'),pg_catalog.hashtext('${MIGRATION_NAME}'));
set local role service_role;
do $base$ begin if (public.backend_schema_contract_v2()->>'fingerprint' in ('${PREVIOUS_FINGERPRINTS.join("','")}')) is not true
  or coalesce((public.backend_security_contract()->>'ok')::boolean,false) is not true then raise exception 'Runtime base contract mismatch'; end if; end $base$;
reset role;
do $history$ begin if not exists(select 1 from supabase_migrations.schema_migrations where name='supabase_migration_v6_29_19') then raise exception 'Runtime predecessor missing'; end if;
  if exists(select 1 from supabase_migrations.schema_migrations where name='${MIGRATION_NAME}') then raise exception 'Runtime migration already recorded'; end if; end $history$;
${sql}
set local role service_role;
do $proof$ begin if (public.backend_schema_contract_v2()->>'fingerprint' in ('${db.fingerprint}','${db.freshInstallFingerprint}')) is not true
  or coalesce((public.backend_security_contract()->>'ok')::boolean,false) is not true
  or (select runtime_source='${REVIEWED_SOURCE_MD5}' and runtime_grants_ok from (${RUNTIME_MIGRATION_STATE_SQL}) checked) is not true then raise exception 'Runtime contract mismatch'; end if; end $proof$;
reset role;
insert into supabase_migrations.schema_migrations(version,name,statements)
values(pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC','YYYYMMDDHH24MISS'),'${MIGRATION_NAME}',array[${quote}${sql}${quote}]);
commit;`;
  try{await runRecoveryPostgres({databaseUrl,signal,run,query,write:true});}
  catch(error){throw Object.assign(new Error('RUNTIME_MIGRATION_WRITE_UNCONFIRMED'),{code:'RUNTIME_MIGRATION_WRITE_UNCONFIRMED',reason:/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'RUNTIME_MIGRATION_WRITE_UNKNOWN'});}
}
export async function applyRuntimeMigration({env=process.env,fetchImpl=fetch,root=process.cwd(),now=()=>Date.now(),readState=readRuntimeMigrationState,applyMigration=applyRuntimeSql}={}){
  if(env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_REF!=='refs/heads/main'||! /^[0-9a-f]{40}$/.test(env.GITHUB_SHA||''))fail('RUNTIME_MIGRATION_MAIN_REQUIRED');
  if(env.SUPABASE_PROJECT_REF!==PROJECT)fail('RUNTIME_MIGRATION_PROJECT_MISMATCH');
  const mode=env.RUNTIME_MIGRATION_MODE||'preflight';
  if(!['preflight','apply'].includes(mode))fail('RUNTIME_MIGRATION_MODE_INVALID');
  if(!env.SUPABASE_ACCESS_TOKEN||!env.GITHUB_TOKEN)fail('RUNTIME_MIGRATION_CREDENTIALS_MISSING');
  const {releaseContract:contract,latestMigration}=validateSupabaseMigrationContract(root);
  if(latestMigration!==MIGRATION)fail('RUNTIME_MIGRATION_MIGRATION_MISMATCH');
  if(![contract.databaseContract.fingerprint,contract.databaseContract.freshInstallFingerprint,contract.databaseContract.baseFingerprint].every(value=>/^[0-9a-f]{32}$/.test(value)))fail('RUNTIME_MIGRATION_CONTRACT_INVALID');
  const report={mode,sourceSha:env.GITHUB_SHA,productionChanged:false,applied:false,backupVerified:false};
  const overall=AbortSignal.timeout(90000);
  async function call(url,{management=false,method='GET',body,timeout=15000}={}){
    const signal=AbortSignal.any([overall,AbortSignal.timeout(timeout)]);
    const headers={Accept:'application/json',Authorization:`Bearer ${management?env.SUPABASE_ACCESS_TOKEN:env.GITHUB_TOKEN}`};
    if(body)headers['Content-Type']='application/json';
    let currentReader;
    async function bounded(work){
      let abort;
      const cancelled=new Promise((_,reject)=>{abort=()=>{try{Promise.resolve(currentReader?.cancel()).catch(()=>{});}catch{}reject(Object.assign(new Error('RUNTIME_MIGRATION_REQUEST_UNKNOWN'),{code:'RUNTIME_MIGRATION_REQUEST_UNKNOWN'}));};signal.addEventListener('abort',abort,{once:true});});
      try{signal.throwIfAborted();return await Promise.race([work(),cancelled]);}finally{signal.removeEventListener('abort',abort);}
    }
    let response;
    try{response=await bounded(async()=>{const value=await fetchImpl(url,{method,redirect:'error',headers,signal,...(body?{body:JSON.stringify(body)}:{})});if(signal.aborted){try{await Promise.resolve(value.body?.cancel?.()).catch(()=>{});}catch{}fail('RUNTIME_MIGRATION_REQUEST_UNKNOWN');}return value;});}
    catch{fail('RUNTIME_MIGRATION_REQUEST_UNKNOWN');}
    if(!response.ok){try{await Promise.resolve(response.body?.cancel?.()).catch(()=>{});}catch{}fail(`RUNTIME_MIGRATION_HTTP_${Number.isInteger(response.status)?response.status:0}`);}
    const read=async()=>{
      const reader=response.body?.getReader();currentReader=reader;if(!reader)return null;
      const chunks=[];let size=0;
      try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)fail('RUNTIME_MIGRATION_RESPONSE_LIMIT');chunks.push(value);}}
      finally{if(signal.aborted||size>1048576)await reader.cancel().catch(()=>{});}
      signal.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
      if(!size)return null;
      try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('RUNTIME_MIGRATION_RESPONSE_INVALID');}
    };
    return bounded(read);
  }
  const github=path=>call(`https://api.github.com/repos/${REPOSITORY}/${path}`);
  const supabase=(path,options={})=>call(`https://api.supabase.com/v1/projects/${PROJECT}/${path}`,{...options,management:true});
  const main=await github('branches/main');
  if(main?.commit?.sha!==env.GITHUB_SHA)fail('RUNTIME_MIGRATION_STALE_MAIN');
  const pulls=await github(`commits/${env.GITHUB_SHA}/pulls`);
  if(!selectMergedPullRequest(pulls,'main',REPOSITORY))fail('RUNTIME_MIGRATION_MERGED_PR_REQUIRED');
  const history=()=>supabase('database/migrations');
  const state=()=>readState({databaseUrl:env.SUPABASE_DB_URL,signal:overall});
  const hasMigration=rows=>Array.isArray(rows)&&rows.some(row=>row?.name===MIGRATION_NAME);
  const complete=value=>[contract.databaseContract.fingerprint,contract.databaseContract.freshInstallFingerprint].includes(value?.fingerprint)
    &&value.security_ok===true&&value.runtime_source===REVIEWED_SOURCE_MD5&&value.runtime_grants_ok===true;
  const beforeHistory=await history(),before=await state();
  if(hasMigration(beforeHistory)){
    if(!complete(before))fail('RUNTIME_MIGRATION_APPLIED_STATE_MISMATCH');
    return {...report,applied:true,status:'already_applied',fingerprint:before.fingerprint};
  }
  if(!Array.isArray(beforeHistory)||!beforeHistory.some(row=>row?.name==='supabase_migration_v6_29_19'))fail('RUNTIME_MIGRATION_PREDECESSOR_MISSING');
  if(before.security_ok!==true||!PREVIOUS_FINGERPRINTS.includes(before.fingerprint)||before.runtime_source!==null)fail('RUNTIME_MIGRATION_BASE_STATE_MISMATCH');
  if(mode==='preflight')return {...report,status:'ready_for_backup_and_apply',fingerprint:before.fingerprint};
  const backupId=String(env.RUNTIME_MIGRATION_BACKUP_RUN_ID||'');
  if(!/^[1-9][0-9]{0,15}$/.test(backupId))fail('RUNTIME_MIGRATION_BACKUP_REQUIRED');
  const backup=await github(`actions/runs/${backupId}`),created=Date.parse(backup?.created_at);
  if(backup?.path!=='.github/workflows/backup-supabase.yml'||backup?.head_branch!=='main'||backup?.head_sha!==env.GITHUB_SHA
    ||backup?.status!=='completed'||backup?.conclusion!=='success'||!Number.isFinite(created)
    ||now()-created>7200000||created>now()+60000)fail('RUNTIME_MIGRATION_BACKUP_INVALID');
  const jobs=await github(`actions/runs/${backupId}/jobs?per_page=100`);
  if(!['backup','Isolated restore drill'].every(name=>jobs?.jobs?.some(job=>job.name===name&&job.conclusion==='success')))fail('RUNTIME_MIGRATION_BACKUP_RESTORE_REQUIRED');
  const artifacts=await github(`actions/runs/${backupId}/artifacts?per_page=100`);
  if(!artifacts?.artifacts?.some(a=>a.name===`supabase-production-backup-${backupId}`&&a.expired===false&&a.size_in_bytes>0))fail('RUNTIME_MIGRATION_BACKUP_ARTIFACT_MISSING');
  report.backupVerified=true;
  if((await github('branches/main'))?.commit?.sha!==env.GITHUB_SHA)fail('RUNTIME_MIGRATION_STALE_MAIN');
  let applyError;
  try{
    await applyMigration({databaseUrl:env.SUPABASE_DB_URL,signal:overall,root});
    report.productionChanged=true;
  }catch(error){applyError=error;}
  // No write retry. A lost write response is settled by read-only proof.
  const afterHistory=await history(),after=await state();
  if(!hasMigration(afterHistory)||!complete(after))throw applyError||Object.assign(new Error('RUNTIME_MIGRATION_VERIFICATION_FAILED'),{code:'RUNTIME_MIGRATION_VERIFICATION_FAILED'});
  return {...report,applied:true,productionChanged:true,status:applyError?'application_confirmed_after_lost_response':'applied',fingerprint:after.fingerprint};
}

if(import.meta.url===(process.argv[1]?pathToFileURL(process.argv[1]).href:'')){
  try{const report=await applyRuntimeMigration();console.log(JSON.stringify(report));
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Runtime controls migration: ${report.status}; backup verified=${report.backupVerified}.\n`);
  }catch(error){const code=/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'RUNTIME_MIGRATION_FAILED';console.error(code+(/^[A-Z0-9_]+$/.test(error?.reason||'')?' '+error.reason:''));process.exitCode=1;}
}
