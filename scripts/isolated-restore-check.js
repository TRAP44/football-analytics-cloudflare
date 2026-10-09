import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireDbUrl } from './supabase-concurrency-gate.js';

const source=requireDbUrl();
const restored=new URL(source);
const name='isolated_restore_'+randomUUID().replaceAll('-','');
restored.pathname='/'+name;
const target=restored.toString();
const directory=mkdtempSync(join(tmpdir(),'matchradar-restore-'));
const dump=join(directory,'local.dump');
const container=process.env.ISOLATED_PG_CONTAINER || '';
if (container && !/^supabase_db_[a-z0-9_-]+$/.test(container)) throw new Error('Invalid disposable Supabase container name.');
function run(binary,args,options={}) {
  try {
    const output=execFileSync(binary,args,{encoding:'utf8',timeout:120000,maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe'],...options});
    return typeof output==='string' ? output.trim() : output;
  }
  catch (error) {
    const detail=String(error.stderr || '').replace(/postgres(?:ql)?:\/\/[^\s'"]+/g,'[redacted database URL]').slice(0,1200);
    throw new Error(`Disposable restore check failed at ${binary}: ${detail || 'connection details suppressed'}`);
  }
}
function query(url,sql) {
  if (container && url===target) return run('docker',['exec',container,'psql','-U','supabase_admin','-d',name,'-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql]);
  return run('psql',[url,'-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql]);
}
function applyRestoreSql(path) {
  if (container) return run('docker',['exec','-i',container,'psql','-U','supabase_admin','-d',name,'-X','-v','ON_ERROR_STOP=1'],{input:readFileSync(path),stdio:['pipe','pipe','pipe']});
  return run('psql',[target,'-X','-v','ON_ERROR_STOP=1','-f',path]);
}
const fixtureUser=900000000437;
let created=false;
try {
  query(source,`select public.consume_analysis_quota(${fixtureUser},date '2099-10-09',5);`);
  assert.equal(query(source,`select analyses from public.usage_daily where telegram_id=${fixtureUser} and usage_date=date '2099-10-09';`),'1');
  const before=query(source,'select public.backend_schema_contract_v2()::text;');
  const count=query(source,'select count(*) from public.users;');
  if (container) {
    const bytes=run('docker',['exec',container,'pg_dump','-U','postgres','-d',decodeURIComponent(new URL(source).pathname.slice(1)),'--format=custom','--schema=public','--schema=private','--no-owner'],{encoding:null});
    writeFileSync(dump,bytes);
  } else {
    run('pg_dump',['--dbname='+source,'--format=custom','--schema=public','--schema=private','--no-owner','--file='+dump]);
  }
  run('createdb',['--maintenance-db='+source,name]);created=true;
  if (container) {
    run('docker',['exec','-i',container,'pg_restore','-U','supabase_admin','-d',name,'--no-owner','--clean','--if-exists','--single-transaction','--exit-on-error'],{input:readFileSync(dump),stdio:['pipe','pipe','pipe']});
  } else {
    run('pg_restore',['--dbname='+target,'--no-owner','--clean','--if-exists','--single-transaction','--exit-on-error',dump]);
  }
  applyRestoreSql('scripts/apply-supabase-restore-hardening.sql');
  applyRestoreSql('scripts/verify-supabase-restore.sql');
  const {checkedAt:sourceCheckedAt,...expectedContract}=JSON.parse(before);
  const {checkedAt:restoredCheckedAt,...restoredContract}=JSON.parse(query(target,'select public.backend_schema_contract_v2()::text;'));
  assert.ok(Number.isFinite(Date.parse(sourceCheckedAt)));
  assert.ok(Number.isFinite(Date.parse(restoredCheckedAt)));
  assert.deepEqual(restoredContract,expectedContract); // checkedAt is generated per query, not part of schema identity.
  assert.equal(query(target,'select count(*) from public.users;'),count);
  assert.equal(query(target,`select analyses from public.usage_daily where telegram_id=${fixtureUser} and usage_date=date '2099-10-09';`),'1');
  console.log('Disposable backup/restore: schema fingerprint, users count and security acceptance passed. No production database accessed.');
} finally {
  query(source,`delete from public.usage_daily where telegram_id=${fixtureUser}; delete from public.users where telegram_id=${fixtureUser};`);
  if (created) run('dropdb',['--maintenance-db='+source,'--if-exists',name]);
  rmSync(directory,{recursive:true,force:true});
}
