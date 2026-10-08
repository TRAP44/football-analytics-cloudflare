// Read-only production migration check via Supabase Management API.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const MIGRATION=/^supabase\/migrations\/(supabase_migration_v\d+(?:_\d+)+)\.sql$/;
const REF=/^[a-z0-9]{20}$/;

export function expectedProductionMigration(contract) {
  const value=contract && typeof contract==='object' ? contract.latestMigration : null;
  const match=typeof value==='string' ? value.match(MIGRATION) : null;
  if(!match) throw new Error('Release contract has an invalid latestMigration path.');
  return match[1];
}

export async function checkProductionMigration({contract,token='',projectRef='',required=false,fetchImpl=fetch}={}) {
  const expected=expectedProductionMigration(contract);
  const hasToken=typeof token==='string' && token.trim().length>0;
  const hasRef=typeof projectRef==='string' && projectRef.trim().length>0;
  if(!hasToken && !hasRef) {
    return {
      ok:!required,enforced:false,expected,
      reason:required?'Management API credentials are required.':'Management API credentials are not configured.',
    };
  }
  if(!hasToken || !hasRef) return {ok:false,enforced:false,expected,reason:'Incomplete Management API credentials.'};
  const ref=projectRef.trim();
  if(!REF.test(ref)) return {ok:false,enforced:false,expected,reason:'Invalid Supabase project ref.'};
  if(typeof fetchImpl!=='function') return {ok:false,enforced:true,expected,reason:'Management API transport unavailable.'};
  try {
    const response=await fetchImpl('https://api.supabase.com/v1/projects/'+ref+'/database/migrations',{
      method:'GET',redirect:'error',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(15000),
    });
    if(response?.ok!==true || response?.status!==200) {
      const status=Number.isSafeInteger(response?.status)?response.status:0;
      return {ok:false,enforced:true,expected,reason:'Management API HTTP '+status+'.'};
    }
    const rows=await response.json();
    if(!Array.isArray(rows) || rows.some(row=>!row || typeof row.name!=='string' || typeof row.version!=='string')) {
      return {ok:false,enforced:true,expected,reason:'Invalid migration history response.'};
    }
    const applied=rows.some(row=>row.name===expected);
    return {
      ok:applied,enforced:true,expected,
      reason:applied?'Required migration is recorded.':'Required production migration is missing.',
    };
  } catch {
    return {ok:false,enforced:true,expected,reason:'Management API request failed.'};
  }
}

export async function main(env=process.env) {
  const contract=JSON.parse(fs.readFileSync('release-contract.json','utf8'));
  const result=await checkProductionMigration({
    contract,token:env.SUPABASE_ACCESS_TOKEN,projectRef:env.SUPABASE_PROJECT_REF,
    required:env.SUPABASE_MIGRATION_GATE_REQUIRED==='true',
  });
  const status=result.ok?(result.enforced?'PASS':'NOT ENFORCED'):'BLOCKED';
  const line='Production Supabase migration: '+status+' — '+result.expected+'. '+result.reason;
  process.stdout.write(line+'\n');
  if(!result.ok) process.exitCode=1;
  return result;
}

const invoked=process.argv[1]?pathToFileURL(process.argv[1]).href:'';
if(import.meta.url===invoked) await main();
