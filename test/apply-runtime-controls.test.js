import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditWorkflow} from '../scripts/privileged-access-audit.js';
import {applyRuntimeMigration,applyRuntimeSql} from '../scripts/apply-runtime-controls.js';
const contract=JSON.parse(fs.readFileSync('release-contract.json','utf8'));
const sha='a'.repeat(40),repository='TRAP44/football-analytics-cloudflare',now=Date.now();
const env={GITHUB_REPOSITORY:repository,GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,SUPABASE_PROJECT_REF:'nlmvhkjkpgzzlfavaohk',GITHUB_TOKEN:'local-github',SUPABASE_ACCESS_TOKEN:'local-supabase',RUNTIME_MIGRATION_MODE:'preflight',RUNTIME_MIGRATION_BACKUP_RUN_ID:'1234'};
function fixture(options={}){
  let applied=options.applied===true,writes=0;const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,method:init.method,body:init.body});
    if(new URL(url).origin==='https://api.github.com'){
      if(url.endsWith('/branches/main'))return Response.json({commit:{sha:options.stale?'b'.repeat(40):sha}});
      if(url.endsWith('/pulls'))return Response.json([{number:999,state:'closed',merged_at:new Date(now-10000).toISOString(),base:{ref:'main',repo:{full_name:repository}}}]);
      if(url.endsWith('/actions/runs/1234'))return Response.json({path:'.github/workflows/backup-supabase.yml',head_branch:'main',head_sha:sha,status:'completed',conclusion:options.badBackup?'failure':'success',created_at:new Date(now-60000).toISOString()});
      if(url.includes('/jobs?'))return Response.json({jobs:[{name:'backup',conclusion:'success'},{name:'Isolated restore drill',conclusion:options.badRestore?'failure':'success'}]});
      if(url.includes('/artifacts?'))return Response.json({artifacts:[{name:'supabase-production-backup-1234',expired:false,size_in_bytes:options.noArtifact?0:1024}]});
    }
    if(url.endsWith('/database/migrations')){
      assert.equal(init.method,'GET','Management API remains read-only');
      return Response.json([{name:'supabase_migration_v6_29_19'},...(applied?[{name:'supabase_migration_v6_29_20'}]:[])]);
    }
    throw Error('Unexpected fixed endpoint');
  };
  return {run:overrides=>applyRuntimeMigration({env:{...env,...overrides},fetchImpl,now:()=>now,applyMigration:async()=>{writes++;if(options.denied)throw Object.assign(Error('fixed'),{code:'RUNTIME_MIGRATION_WRITE_UNCONFIRMED'});applied=true;if(options.lostResponse)throw Object.assign(Error('unknown'),{code:'RUNTIME_MIGRATION_WRITE_UNCONFIRMED'});},readState:async()=>({fingerprint:applied?contract.databaseContract.fingerprint:'ecd2e855833b78694bef24223878eb19',security_ok:options.badSecurity!==true,runtime_source:applied?'1b1f30c9f1b8c0b51bd85aea62359507':null,runtime_grants_ok:applied})}),calls,writes:()=>writes};
}

test('preflight reads current main, provenance and fixed project state without a production mutation',async()=>{
  const h=fixture(),r=await h.run();assert.equal(r.productionChanged,false);assert.equal(r.status,'ready_for_backup_and_apply');assert.equal(h.writes(),0);
  assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
});

test('apply requires exact main backup with successful isolated restore and encrypted artifact',async()=>{
  for(const key of ['badBackup','badRestore','noArtifact']){
    const h=fixture({[key]:true});await assert.rejects(h.run({RUNTIME_MIGRATION_MODE:'apply'}));assert.equal(h.writes(),0);
  }
  const h=fixture(),r=await h.run({RUNTIME_MIGRATION_MODE:'apply'});assert.equal(r.applied,true);assert.equal(r.backupVerified,true);assert.equal(h.writes(),1);
});

test('unknown migration response is confirmed by reads and is never replayed',async()=>{
  const h=fixture({lostResponse:true}),r=await h.run({RUNTIME_MIGRATION_MODE:'apply'});
  assert.equal(r.status,'application_confirmed_after_lost_response');assert.equal(r.applied,true);assert.equal(h.writes(),1);
});

test('already applied migration with exact contract requires no further production write',async()=>{
  const h=fixture({applied:true}),r=await h.run({RUNTIME_MIGRATION_MODE:'apply',RUNTIME_MIGRATION_BACKUP_RUN_ID:''});
  assert.equal(r.status,'already_applied');assert.equal(r.productionChanged,false);assert.equal(h.writes(),0);
});

test('foreign branch/project/mode, stale main and invalid security stop before migration writes',async()=>{
  for(const change of [{GITHUB_REF:'refs/heads/feature'},{SUPABASE_PROJECT_REF:'a'.repeat(20)},{RUNTIME_MIGRATION_MODE:'arbitrary'}]){
    const h=fixture();await assert.rejects(h.run(change));assert.equal(h.calls.length,0);
  }
  for(const options of [{stale:true},{badSecurity:true}]){
    const h=fixture(options);await assert.rejects(h.run({RUNTIME_MIGRATION_MODE:'apply'}));assert.equal(h.writes(),0);
  }
});

test('missing write permission stays a precise failure and never leaks the upstream response',async()=>{
  const h=fixture({denied:true});
  await assert.rejects(h.run({RUNTIME_MIGRATION_MODE:'apply'}),e=>{assert.equal(e.code,'RUNTIME_MIGRATION_WRITE_UNCONFIRMED');assert.doesNotMatch(e.message,/private/);return true;});
  assert.equal(h.writes(),1);
});

test('production apply workflow exposes only mode/backup input and main-only protected credentials',()=>{
  const workflow=fs.readFileSync('.github/workflows/apply-runtime-controls.yml','utf8');
  assert.match(workflow,/if: github\.ref == 'refs\/heads\/main'/);assert.match(workflow,/environment: production/);
  assert.match(workflow,/SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.match(workflow,/options: \[preflight, apply, verify-rpc\]/);assert.doesNotMatch(workflow,/pull_request_target|query:\s*\$\{\{/);
});


test('fixed PostgreSQL migration and its history row are one bounded transaction with guarded role transitions',async()=>{
  await applyRuntimeSql({databaseUrl:'postgresql://postgres.nlmvhkjkpgzzlfavaohk:local@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',run:async(command,args,options)=>{
    assert.equal(command,'psql');const query=args.at(-1);
    assert.match(query,/^begin; set local lock_timeout='3s'; set local statement_timeout='20s';/);
    const base=query.indexOf('Runtime base contract mismatch'),ddl=query.indexOf('create or replace function public.commit_runtime_controls_v2'),proof=query.indexOf('Runtime contract mismatch'),ledger=query.indexOf('insert into supabase_migrations.schema_migrations');
    assert.ok(base>0&&ddl>base&&proof>ddl&&ledger>proof);
    assert.match(query,/pg_advisory_xact_lock/);assert.match(query,/set local role service_role/);assert.match(query,/reset role/);
    assert.match(query,/Runtime migration already recorded/);
    assert.match(query,/runtime_source=/);assert.match(query,/runtime_grants_ok/);assert.match(query,/\) is not true/,'body and schema guards reject NULL');
    assert.match(query,/version,name,statements/);assert.match(query,/array\[\$matchradar_v20_source\$/);assert.match(query,/commit;$/);
    assert.equal(options.timeout,30000);assert.equal(options.killSignal,'SIGKILL');assert.equal(options.env.PGSSLMODE,'verify-full');
    assert.equal(options.env.PGAPPNAME,'matchradar-recovery-migration');assert.doesNotMatch(JSON.stringify(args),/postgresql:\/\/|PGPASSWORD/);
    return {stdout:''};
  }});
});

test('an unknown PostgreSQL write outcome is never reported as an unchanged database',async()=>{
  await assert.rejects(applyRuntimeSql({databaseUrl:'postgresql://postgres.nlmvhkjkpgzzlfavaohk:local@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',run:async()=>{throw Error('private lost connection');}}),{code:'RUNTIME_MIGRATION_WRITE_UNCONFIRMED'});
});

test('runtime workflow permits only reviewed credentials inside protected production',()=>{
  const file='.github/workflows/apply-runtime-controls.yml',workflow=fs.readFileSync(file,'utf8');
  assert.deepEqual(auditWorkflow(file,workflow),[]);
  assert.ok(auditWorkflow(file,workflow.replace('    environment: production','')).some(f=>f.type==='secret_environment_missing'));
  assert.ok(auditWorkflow(file,workflow.replace('secrets.ADMIN_TELEGRAM_IDS','secrets.TELEGRAM_BOT_TOKEN')).some(f=>f.type==='unexpected_secret_reference'));
  assert.match(workflow,/secrets\.SUPABASE_SECRET_KEY \|\| secrets\.SUPABASE_SERVICE_ROLE_KEY/);
});
