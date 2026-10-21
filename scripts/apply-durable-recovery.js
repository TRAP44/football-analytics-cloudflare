// Fixed, main-only production migration. No SQL/path/project inputs and no
// automatic replay after an unknown write result. Artifacts contain no data.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {validateSupabaseMigrationContract} from './verify-supabase-contract.js';
import {selectMergedPullRequest} from './verify-main-pr-provenance.js';
const REPOSITORY='TRAP44/football-analytics-cloudflare';
const PROJECT='nlmvhkjkpgzzlfavaohk';
const MIGRATION='supabase/migrations/supabase_migration_v6_29_19.sql';
const MIGRATION_NAME='supabase_migration_v6_29_19';
const REMINDER_PREVIOUS_HASH='acbc9eaa061b283c2047682bc26847f8';
const REMINDER_SOURCE_HASH='58165410c124d6a50deb0804cd114aef';
export const RECOVERY_STATE_SQL=`select public.backend_schema_contract_v2()->>'fingerprint' as fingerprint,
  public.backend_schema_fingerprint()->>'fingerprint' as legacy_fingerprint,
  coalesce((public.backend_security_contract()->>'ok')::boolean,false) as security_ok,
  pg_catalog.to_regclass('public.scheduled_job_claim_receipts') is not null as receipts,
  pg_catalog.to_regprocedure('public.claim_scheduled_job_owned(text,text,timestamp with time zone,uuid,integer,integer)') is not null as owned_claim,
  pg_catalog.to_regprocedure('public.write_analysis_cache_versioned(text,bigint,jsonb,timestamp with time zone,text,timestamp with time zone,text,timestamp with time zone)') is not null as versioned_cache,
  pg_catalog.md5((select prosrc from pg_catalog.pg_proc where oid='public.resolve_match_reminder_fixture(bigint)'::regprocedure))='${REMINDER_SOURCE_HASH}' as reminder_dates_fixed,
  pg_catalog.md5((select prosrc from pg_catalog.pg_proc where oid='public.resolve_match_reminder_fixture(bigint)'::regprocedure))='${REMINDER_PREVIOUS_HASH}' as reminder_dates_previous`;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const runPsql=promisify(execFile);

// Fixed callers below alone select the read-only proof or guarded migration.
async function runRecoveryPostgres({databaseUrl,signal,run=runPsql,query,write=false}={}){
  let url;
  try{url=new URL(databaseUrl);}catch{fail('RECOVERY_DATABASE_CONNECTION_INVALID');}
  if(!['postgres:','postgresql:'].includes(url.protocol)
    || !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    || url.port!=='5432'||decodeURIComponent(url.username)!==`postgres.${PROJECT}`
    || url.pathname!=='/postgres'||!url.password||url.hash
    || [...url.searchParams.keys()].some(key=>key!=='sslmode'))fail('RECOVERY_DATABASE_CONNECTION_INVALID');
  const trustDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'matchradar-recovery-trust-'));
  try{
    // Pinned public Supabase CA, alongside OS roots. No runtime CA download and
    // no relaxation of hostname verification for the hosted session pooler.
    const trustFile=path.join(trustDirectory,'roots.pem');
    fs.writeFileSync(trustFile,fs.readFileSync('/etc/ssl/certs/ca-certificates.crt','utf8')+'\n'
      +fs.readFileSync(new URL('../supabase/certs/supabase-prod-ca-2021.crt',import.meta.url),'utf8'),{mode:0o600});
    const childEnv={PATH:process.env.PATH,LANG:'C.UTF-8',
      PGHOST:url.hostname,PGPORT:'5432',PGUSER:`postgres.${PROJECT}`,PGDATABASE:'postgres',
      PGPASSWORD:decodeURIComponent(url.password),PGPASSFILE:'/dev/null',PGSERVICEFILE:'/dev/null',
      PGSSLMODE:'verify-full',PGSSLROOTCERT:trustFile,
      PGCONNECT_TIMEOUT:'5',PGAPPNAME:write?'matchradar-recovery-migration':'matchradar-recovery-readonly'};
    let stdout;
    try{({stdout}=await run('psql',['-X','--no-psqlrc','--no-align','--tuples-only','--quiet','--set','ON_ERROR_STOP=1','--command',query],
      {env:childEnv,signal,timeout:write?30000:12000,killSignal:'SIGKILL',maxBuffer:65536,encoding:'utf8'}));}
    catch(error){
      const detail=String(error?.stderr||'');
      const reason=error?.code==='ENOENT'?'CLIENT_MISSING'
        :/does not match (?:the )?host|host name.*does not match/i.test(detail)?'TLS_HOSTNAME_FAILED'
        :/root certificate file|could not read root certificate/i.test(detail)?'TLS_ROOT_FAILED'
        :/certificate verify failed|certificate verification failed|self.signed certificate|unable to get.*issuer/i.test(detail)?'TLS_CA_FAILED'
        :/certificate|SSL error|TLS/i.test(detail)?'TLS_FAILED'
        :/password authentication failed|SASL authentication failed/i.test(detail)?'AUTH_FAILED'
        :/Recovery base contract mismatch/i.test(detail)?'BASE_STATE_MISMATCH'
        :/Recovery contract mismatch/i.test(detail)?'CONTRACT_MISMATCH'
        :/Recovery migration already recorded/i.test(detail)?'ALREADY_RECORDED'
        :/Recovery migration history mismatch/i.test(detail)?'HISTORY_MISMATCH'
        :/permission denied|must be owner/i.test(detail)?'PERMISSION_DENIED'
        :/does not exist/i.test(detail)?'OBJECT_MISSING'
        :/timeout|timed out/i.test(detail)?'TIMEOUT':'READ_FAILED';
      fail('RECOVERY_DATABASE_'+reason);
    }
    return stdout;
  }finally{fs.rmSync(trustDirectory,{recursive:true,force:true});}
}

// The Management read-only role cannot execute service-only contract functions.
export async function readRecoveryState(options={}){
  const query=`begin read only; set local role service_role; set local statement_timeout=5000; set local lock_timeout=1000; select pg_catalog.row_to_json(recovery_state) from (${RECOVERY_STATE_SQL}) recovery_state; commit;`;
  const stdout=await runRecoveryPostgres({...options,query,write:false});
  try{
    const value=JSON.parse(stdout.trim());
    if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  }catch{}
  fail('RECOVERY_STATE_INVALID');
}

export async function applyRecoveryMigration({databaseUrl,signal,run=runPsql,root=process.cwd()}={}){
  const {releaseContract:contract,latestMigration}=validateSupabaseMigrationContract(root);
  const db=contract.databaseContract;
  if(latestMigration!==MIGRATION||![db.fingerprint,db.freshInstallFingerprint,db.baseFingerprint].every(value=>/^[0-9a-f]{32}$/.test(value)))fail('RECOVERY_CONTRACT_INVALID');
  const sql=fs.readFileSync(`${root}/${MIGRATION}`,'utf8'),quote='$matchradar_v19_source$';
  if(sql.includes(quote))fail('RECOVERY_MIGRATION_QUOTING_INVALID');
  // The checked-in migration and its standard Supabase history row commit
  // together. The lock and base check also fence a delayed duplicate caller.
  const query=`begin; set local lock_timeout='3s'; set local statement_timeout='20s';
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('matchradar:schema-migration'),pg_catalog.hashtext('${MIGRATION_NAME}'));
set local role service_role;
do $base$ begin if (public.backend_schema_contract_v2()->>'fingerprint' in ('${db.fingerprint}','${db.freshInstallFingerprint}')) is not true or (select reminder_dates_previous from (${RECOVERY_STATE_SQL}) checked) is not true then raise exception 'Recovery base contract mismatch'; end if; end $base$;
reset role;
do $history$ begin if not exists(select 1 from supabase_migrations.schema_migrations where name='supabase_migration_v6_29_18') then raise exception 'Recovery migration history mismatch'; end if; if exists(select 1 from supabase_migrations.schema_migrations where name='${MIGRATION_NAME}') then raise exception 'Recovery migration already recorded'; end if; end $history$;
${sql}
set local role service_role;
do $proof$ begin if (public.backend_schema_contract_v2()->>'fingerprint' in ('${db.fingerprint}','${db.freshInstallFingerprint}')) is not true or coalesce((public.backend_security_contract()->>'ok')::boolean,false) is not true or (select reminder_dates_fixed from (${RECOVERY_STATE_SQL}) checked) is not true then raise exception 'Recovery contract mismatch'; end if; end $proof$;
reset role;
insert into supabase_migrations.schema_migrations(version,name,statements)
values(pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC','YYYYMMDDHH24MISS'),'${MIGRATION_NAME}',array[${quote}${sql}${quote}]);
commit;`;
  try{await runRecoveryPostgres({databaseUrl,signal,run,query,write:true});}
  catch(error){throw Object.assign(new Error('RECOVERY_WRITE_UNCONFIRMED'),{code:'RECOVERY_WRITE_UNCONFIRMED',reason:/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'RECOVERY_DATABASE_WRITE_UNKNOWN'});}
}

export async function applyDurableRecovery({env=process.env,fetchImpl=fetch,root=process.cwd(),now=()=>Date.now(),readState=readRecoveryState,applyMigration=applyRecoveryMigration}={}){
  if(env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_REF!=='refs/heads/main'||! /^[0-9a-f]{40}$/.test(env.GITHUB_SHA||''))fail('RECOVERY_MAIN_REQUIRED');
  if(env.SUPABASE_PROJECT_REF!==PROJECT)fail('RECOVERY_PROJECT_MISMATCH');
  const mode=env.RECOVERY_MODE||'preflight';
  if(!['preflight','apply'].includes(mode))fail('RECOVERY_MODE_INVALID');
  if(!env.SUPABASE_ACCESS_TOKEN||!env.GITHUB_TOKEN)fail('RECOVERY_CREDENTIALS_MISSING');
  const {releaseContract:contract,latestMigration}=validateSupabaseMigrationContract(root);
  if(latestMigration!==MIGRATION)fail('RECOVERY_MIGRATION_MISMATCH');
  if(![contract.databaseContract.fingerprint,contract.databaseContract.freshInstallFingerprint,contract.databaseContract.baseFingerprint].every(value=>/^[0-9a-f]{32}$/.test(value)))fail('RECOVERY_CONTRACT_INVALID');
  const report={mode,sourceSha:env.GITHUB_SHA,productionChanged:false,applied:false,backupVerified:false};
  const overall=AbortSignal.timeout(90000);
  async function call(url,{management=false,method='GET',body,timeout=15000}={}){
    const signal=AbortSignal.any([overall,AbortSignal.timeout(timeout)]);
    const headers={Accept:'application/json',Authorization:`Bearer ${management?env.SUPABASE_ACCESS_TOKEN:env.GITHUB_TOKEN}`};
    if(body)headers['Content-Type']='application/json';
    let currentReader;
    async function bounded(work){
      let abort;
      const cancelled=new Promise((_,reject)=>{abort=()=>{try{Promise.resolve(currentReader?.cancel()).catch(()=>{});}catch{}reject(Object.assign(new Error('RECOVERY_REQUEST_UNKNOWN'),{code:'RECOVERY_REQUEST_UNKNOWN'}));};signal.addEventListener('abort',abort,{once:true});});
      try{signal.throwIfAborted();return await Promise.race([work(),cancelled]);}finally{signal.removeEventListener('abort',abort);}
    }
    let response;
    try{response=await bounded(async()=>{const value=await fetchImpl(url,{method,redirect:'error',headers,signal,...(body?{body:JSON.stringify(body)}:{})});if(signal.aborted){try{await Promise.resolve(value.body?.cancel?.()).catch(()=>{});}catch{}fail('RECOVERY_REQUEST_UNKNOWN');}return value;});}
    catch{fail('RECOVERY_REQUEST_UNKNOWN');}
    if(!response.ok){try{await Promise.resolve(response.body?.cancel?.()).catch(()=>{});}catch{}fail(`RECOVERY_HTTP_${Number.isInteger(response.status)?response.status:0}`);}
    const read=async()=>{
      const reader=response.body?.getReader();currentReader=reader;if(!reader)return null;
      const chunks=[];let size=0;
      try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)fail('RECOVERY_RESPONSE_LIMIT');chunks.push(value);}}
      finally{if(signal.aborted||size>1048576)await reader.cancel().catch(()=>{});}
      signal.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
      if(!size)return null;
      try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('RECOVERY_RESPONSE_INVALID');}
    };
    return bounded(read);
  }
  const github=path=>call(`https://api.github.com/repos/${REPOSITORY}/${path}`);
  const supabase=(path,options={})=>call(`https://api.supabase.com/v1/projects/${PROJECT}/${path}`,{...options,management:true});
  const main=await github('branches/main');
  if(main?.commit?.sha!==env.GITHUB_SHA)fail('RECOVERY_STALE_MAIN');
  const pulls=await github(`commits/${env.GITHUB_SHA}/pulls`);
  if(!selectMergedPullRequest(pulls,'main',REPOSITORY))fail('RECOVERY_MERGED_PR_REQUIRED');
  const history=()=>supabase('database/migrations');
  const state=()=>readState({databaseUrl:env.SUPABASE_DB_URL,signal:overall});
  const hasMigration=rows=>Array.isArray(rows)&&rows.some(row=>row?.name===MIGRATION_NAME);
  const complete=value=>[contract.databaseContract.fingerprint,contract.databaseContract.freshInstallFingerprint].includes(value?.fingerprint)
    &&value.security_ok===true&&value.receipts===true&&value.owned_claim===true&&value.versioned_cache===true&&value.reminder_dates_fixed===true;
  const beforeHistory=await history(),before=await state();
  if(hasMigration(beforeHistory)){
    if(!complete(before))fail('RECOVERY_APPLIED_STATE_MISMATCH');
    return {...report,applied:true,status:'already_applied',fingerprint:before.fingerprint};
  }
  if(!Array.isArray(beforeHistory)||!beforeHistory.some(row=>row?.name==='supabase_migration_v6_29_18'))fail('RECOVERY_PREDECESSOR_MISSING');
  if(before.security_ok!==true||before.reminder_dates_previous!==true||![contract.databaseContract.fingerprint,contract.databaseContract.freshInstallFingerprint].includes(before.fingerprint))fail('RECOVERY_BASE_STATE_MISMATCH');
  if(mode==='preflight')return {...report,status:'ready_for_backup_and_apply',fingerprint:before.fingerprint};
  const backupId=String(env.RECOVERY_BACKUP_RUN_ID||'');
  if(!/^[1-9][0-9]{0,15}$/.test(backupId))fail('RECOVERY_BACKUP_REQUIRED');
  const backup=await github(`actions/runs/${backupId}`),created=Date.parse(backup?.created_at);
  if(backup?.path!=='.github/workflows/backup-supabase.yml'||backup?.head_branch!=='main'||backup?.head_sha!==env.GITHUB_SHA
    ||backup?.status!=='completed'||backup?.conclusion!=='success'||!Number.isFinite(created)
    ||now()-created>7200000||created>now()+60000)fail('RECOVERY_BACKUP_INVALID');
  const jobs=await github(`actions/runs/${backupId}/jobs?per_page=100`);
  if(!['backup','Isolated restore drill'].every(name=>jobs?.jobs?.some(job=>job.name===name&&job.conclusion==='success')))fail('RECOVERY_BACKUP_RESTORE_REQUIRED');
  const artifacts=await github(`actions/runs/${backupId}/artifacts?per_page=100`);
  if(!artifacts?.artifacts?.some(a=>a.name===`supabase-production-backup-${backupId}`&&a.expired===false&&a.size_in_bytes>0))fail('RECOVERY_BACKUP_ARTIFACT_MISSING');
  report.backupVerified=true;
  if((await github('branches/main'))?.commit?.sha!==env.GITHUB_SHA)fail('RECOVERY_STALE_MAIN');
  let applyError;
  try{
    await applyMigration({databaseUrl:env.SUPABASE_DB_URL,signal:overall,root});
    report.productionChanged=true;
  }catch(error){applyError=error;}
  // No write retry. A lost write response is settled by read-only proof.
  const afterHistory=await history(),after=await state();
  if(!hasMigration(afterHistory)||!complete(after))throw applyError||Object.assign(new Error('RECOVERY_VERIFICATION_FAILED'),{code:'RECOVERY_VERIFICATION_FAILED'});
  return {...report,applied:true,productionChanged:true,status:applyError?'application_confirmed_after_lost_response':'applied',fingerprint:after.fingerprint};
}

if(import.meta.url===(process.argv[1]?pathToFileURL(process.argv[1]).href:'')){
  try{
    const report=await applyDurableRecovery();
    console.log(JSON.stringify(report));
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Durable Supabase recovery: ${report.status}; applied=${report.applied}; backup verified=${report.backupVerified}.\n`);
  }catch(error){const code=/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'RECOVERY_FAILED';console.error(code+(/^[A-Z0-9_]+$/.test(error?.reason||'')?' '+error.reason:''));process.exitCode=1;}
}
