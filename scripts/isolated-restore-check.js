import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
function run(binary,args) {
  try {return execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();}
  catch {throw new Error(`Disposable restore check failed at ${binary}; connection details suppressed.`);}
}
function query(url,sql) {return run('psql',[url,'-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql]);}
const fixtureUser=900000000437;
let created=false;
try {
  query(source,`select public.consume_analysis_quota(${fixtureUser},date '2099-10-09',5);`);
  assert.equal(query(source,`select analyses from public.usage_daily where telegram_id=${fixtureUser} and usage_date=date '2099-10-09';`),'1');
  const before=query(source,'select public.backend_schema_contract_v2()::text;');
  const count=query(source,'select count(*) from public.users;');
  run('pg_dump',['--dbname='+source,'--format=custom','--no-owner','--no-acl','--file='+dump]);
  run('createdb',['--maintenance-db='+source,name]);created=true;
  run('pg_restore',['--dbname='+target,'--no-owner','--no-acl','--exit-on-error',dump]);
  run('psql',[target,'-X','-v','ON_ERROR_STOP=1','-f','scripts/apply-supabase-restore-hardening.sql']);
  run('psql',[target,'-X','-v','ON_ERROR_STOP=1','-f','scripts/verify-supabase-restore.sql']);
  assert.deepEqual(JSON.parse(query(target,'select public.backend_schema_contract_v2()::text;')),JSON.parse(before));
  assert.equal(query(target,'select count(*) from public.users;'),count);
  assert.equal(query(target,`select analyses from public.usage_daily where telegram_id=${fixtureUser} and usage_date=date '2099-10-09';`),'1');
  console.log('Disposable backup/restore: schema fingerprint, users count and security acceptance passed. No production database accessed.');
} finally {
  query(source,`delete from public.usage_daily where telegram_id=${fixtureUser}; delete from public.users where telegram_id=${fixtureUser};`);
  if (created) run('dropdb',['--maintenance-db='+source,'--if-exists',name]);
  rmSync(directory,{recursive:true,force:true});
}
