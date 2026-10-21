// Fixed, main-only production migration. No SQL/path/project inputs and no
// automatic replay after an unknown write result. Artifacts contain no data.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateSupabaseMigrationContract} from './verify-supabase-contract.js';
import {selectMergedPullRequest} from './verify-main-pr-provenance.js';
const REPOSITORY='TRAP44/football-analytics-cloudflare';
const PROJECT='nlmvhkjkpgzzlfavaohk';
const MIGRATION='supabase/migrations/supabase_migration_v6_29_18.sql';
const MIGRATION_NAME='supabase_migration_v6_29_18';
export const RECOVERY_STATE_SQL=`select public.backend_schema_contract_v2()->>'fingerprint' as fingerprint,
  public.backend_schema_fingerprint()->>'fingerprint' as legacy_fingerprint,
  coalesce((public.backend_security_contract()->>'ok')::boolean,false) as security_ok,
  to_regclass('public.scheduled_job_claim_receipts') is not null as receipts,
  to_regprocedure('public.claim_scheduled_job_owned(text,text,timestamp with time zone,uuid,integer,integer)') is not null as owned_claim,
  to_regprocedure('public.write_analysis_cache_versioned(text,bigint,jsonb,timestamp with time zone,text,timestamp with time zone,text,timestamp with time zone)') is not null as versioned_cache`;
const fail=code=>{throw Object.assign(new Error(code),{code});};

export async function applyDurableRecovery({env=process.env,fetchImpl=fetch,root=process.cwd(),now=()=>Date.now()}={}){
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
  const state=async()=>{
    const rows=await supabase('database/query/read-only',{method:'POST',body:{query:RECOVERY_STATE_SQL}});
    const data=Array.isArray(rows)?rows:rows?.result;
    if(!Array.isArray(data)||data.length!==1)fail('RECOVERY_STATE_INVALID');
    return data[0];
  };
  const hasMigration=rows=>Array.isArray(rows)&&rows.some(row=>row?.name===MIGRATION_NAME);
  const complete=value=>[contract.databaseContract.fingerprint,contract.databaseContract.freshInstallFingerprint].includes(value?.fingerprint)
    &&value.security_ok===true&&value.receipts===true&&value.owned_claim===true&&value.versioned_cache===true;
  const beforeHistory=await history(),before=await state();
  if(hasMigration(beforeHistory)){
    if(!complete(before))fail('RECOVERY_APPLIED_STATE_MISMATCH');
    return {...report,applied:true,status:'already_applied',fingerprint:before.fingerprint};
  }
  if(!Array.isArray(beforeHistory)||!beforeHistory.some(row=>row?.name==='supabase_migration_v6_29_17'))fail('RECOVERY_PREDECESSOR_MISSING');
  if(before.security_ok!==true||![contract.databaseContract.baseFingerprint,'0169ec29ea39da9d085040ed825057a6'].includes(before.fingerprint))fail('RECOVERY_BASE_STATE_MISMATCH');
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
  // The official apply API executes and records one named migration. The SQL
  // is fixed and hash-checked by the repository manifest above, not user input.
  const sql=fs.readFileSync(`${root}/${MIGRATION}`,'utf8');
  const assertion=`\ndo $recovery$ begin if public.backend_schema_contract_v2()->>'fingerprint' not in ('${contract.databaseContract.fingerprint}','${contract.databaseContract.freshInstallFingerprint}') then raise exception 'Recovery contract mismatch'; end if; end $recovery$;`;
  if((await github('branches/main'))?.commit?.sha!==env.GITHUB_SHA)fail('RECOVERY_STALE_MAIN');
  let applyError;
  try{
    await supabase('database/migrations',{method:'POST',timeout:30000,body:{name:MIGRATION_NAME,query:"set local lock_timeout='3s';set local statement_timeout='20s';\n"+sql+assertion}});
    report.productionChanged=true;
  }catch(error){applyError=error;}
  // No write retry. A lost HTTP response is settled by read-only proof.
  const afterHistory=await history(),after=await state();
  if(!hasMigration(afterHistory)||!complete(after))throw applyError||Object.assign(new Error('RECOVERY_VERIFICATION_FAILED'),{code:'RECOVERY_VERIFICATION_FAILED'});
  return {...report,applied:true,productionChanged:true,status:applyError?'application_confirmed_after_lost_response':'applied',fingerprint:after.fingerprint};
}

if(import.meta.url===(process.argv[1]?pathToFileURL(process.argv[1]).href:'')){
  try{
    const report=await applyDurableRecovery();
    console.log(JSON.stringify(report));
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Durable Supabase recovery: ${report.status}; applied=${report.applied}; backup verified=${report.backupVerified}.\n`);
  }catch(error){console.error(/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'RECOVERY_FAILED');process.exitCode=1;}
}
