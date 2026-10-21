import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {X509Certificate} from 'node:crypto';
import {applyDurableRecovery,readRecoveryState,RECOVERY_STATE_SQL,applyRecoveryMigration} from '../scripts/apply-durable-recovery.js';
const contract=JSON.parse(fs.readFileSync('release-contract.json','utf8'));
const sha='a'.repeat(40),repository='TRAP44/football-analytics-cloudflare',now=Date.now();
const env={GITHUB_REPOSITORY:repository,GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,SUPABASE_PROJECT_REF:'nlmvhkjkpgzzlfavaohk',GITHUB_TOKEN:'local-github',SUPABASE_ACCESS_TOKEN:'local-supabase',RECOVERY_MODE:'preflight',RECOVERY_BACKUP_RUN_ID:'1234'};
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
      return Response.json([{name:'supabase_migration_v6_29_17'},...(applied?[{name:'supabase_migration_v6_29_18'}]:[])]);
    }
    throw Error('Unexpected fixed endpoint');
  };
  return {run:overrides=>applyDurableRecovery({env:{...env,...overrides},fetchImpl,now:()=>now,applyMigration:async()=>{writes++;if(options.denied)throw Object.assign(Error('fixed'),{code:'RECOVERY_WRITE_UNCONFIRMED'});applied=true;if(options.lostResponse)throw Object.assign(Error('unknown'),{code:'RECOVERY_WRITE_UNCONFIRMED'});},readState:async()=>({fingerprint:applied?contract.databaseContract.fingerprint:contract.databaseContract.baseFingerprint,legacy_fingerprint:contract.databaseContract.legacyFingerprint,security_ok:options.badSecurity!==true,receipts:applied,owned_claim:applied,versioned_cache:applied})}),calls,writes:()=>writes};
}

test('preflight reads current main, provenance and fixed project state without a production mutation',async()=>{
  const h=fixture(),r=await h.run();assert.equal(r.productionChanged,false);assert.equal(r.status,'ready_for_backup_and_apply');assert.equal(h.writes(),0);
  assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
});

test('apply requires exact main backup with successful isolated restore and encrypted artifact',async()=>{
  for(const key of ['badBackup','badRestore','noArtifact']){
    const h=fixture({[key]:true});await assert.rejects(h.run({RECOVERY_MODE:'apply'}));assert.equal(h.writes(),0);
  }
  const h=fixture(),r=await h.run({RECOVERY_MODE:'apply'});assert.equal(r.applied,true);assert.equal(r.backupVerified,true);assert.equal(h.writes(),1);
});

test('unknown migration response is confirmed by reads and is never replayed',async()=>{
  const h=fixture({lostResponse:true}),r=await h.run({RECOVERY_MODE:'apply'});
  assert.equal(r.status,'application_confirmed_after_lost_response');assert.equal(r.applied,true);assert.equal(h.writes(),1);
});

test('already applied migration with exact contract requires no further production write',async()=>{
  const h=fixture({applied:true}),r=await h.run({RECOVERY_MODE:'apply',RECOVERY_BACKUP_RUN_ID:''});
  assert.equal(r.status,'already_applied');assert.equal(r.productionChanged,false);assert.equal(h.writes(),0);
});

test('foreign branch/project/mode, stale main and invalid security stop before migration writes',async()=>{
  for(const change of [{GITHUB_REF:'refs/heads/feature'},{SUPABASE_PROJECT_REF:'a'.repeat(20)},{RECOVERY_MODE:'arbitrary'}]){
    const h=fixture();await assert.rejects(h.run(change));assert.equal(h.calls.length,0);
  }
  for(const options of [{stale:true},{badSecurity:true}]){
    const h=fixture(options);await assert.rejects(h.run({RECOVERY_MODE:'apply'}));assert.equal(h.writes(),0);
  }
});

test('missing write permission stays a precise failure and never leaks the upstream response',async()=>{
  const h=fixture({denied:true});
  await assert.rejects(h.run({RECOVERY_MODE:'apply'}),e=>{assert.equal(e.code,'RECOVERY_WRITE_UNCONFIRMED');assert.doesNotMatch(e.message,/private/);return true;});
  assert.equal(h.writes(),1);
});

test('production apply workflow exposes only mode/backup input and main-only protected credentials',()=>{
  const workflow=fs.readFileSync('.github/workflows/apply-durable-recovery.yml','utf8');
  assert.match(workflow,/if: github\.ref == 'refs\/heads\/main'/);assert.match(workflow,/environment: production/);
  assert.match(workflow,/SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.match(workflow,/options: \[preflight, apply\]/);assert.doesNotMatch(workflow,/pull_request_target|query:\s*\$\{\{/);
});


test('fixed state query qualifies catalog functions and contains only contract reads',()=>{
  assert.doesNotMatch(RECOVERY_STATE_SQL,/(?<![\w.])to_reg(?:class|procedure)\(/);
  assert.match(RECOVERY_STATE_SQL,/pg_catalog\.to_regclass\(/);
  assert.match(RECOVERY_STATE_SQL,/pg_catalog\.to_regprocedure\(/);
});

test('database contract proof uses existing project connection with isolated TLS-verified read-only psql',async()=>{
  const signal=new AbortController().signal;
  const result=await readRecoveryState({databaseUrl:'postgresql://postgres.nlmvhkjkpgzzlfavaohk:local%21@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=disable',signal,
    run:async(command,args,options)=>{
      assert.equal(command,'psql');assert.doesNotMatch(JSON.stringify(args),/local!|postgresql:\/\//);
      assert.ok(args.includes('-X'));assert.ok(args.includes('ON_ERROR_STOP=1'));
      assert.match(args.at(-1),/^begin read only; set local role service_role; set local statement_timeout=5000; set local lock_timeout=1000; select/);
      assert.match(args.at(-1),/commit;$/);
      assert.equal(options.env.PGSSLMODE,'verify-full');assert.match(options.env.PGSSLROOTCERT,/matchradar-recovery-trust-.*roots\.pem$/);
      const trust=fs.readFileSync(options.env.PGSSLROOTCERT,'utf8');
      assert.ok(trust.startsWith(fs.readFileSync('/etc/ssl/certs/ca-certificates.crt','utf8')));
      assert.ok(trust.includes(fs.readFileSync('supabase/certs/supabase-prod-ca-2021.crt','utf8')));
      assert.equal(options.env.PGUSER,'postgres.nlmvhkjkpgzzlfavaohk');assert.equal(options.env.PGPASSWORD,'local!');
      assert.equal(options.env.PGHOSTADDR,undefined);assert.equal(options.env.PGSERVICE,undefined);assert.equal(options.env.PGOPTIONS,undefined);
      assert.equal(options.env.SUPABASE_ACCESS_TOKEN,undefined);assert.equal(options.env.PGPASSFILE,'/dev/null');
      assert.equal(options.signal,signal);assert.equal(options.timeout,12000);assert.equal(options.killSignal,'SIGKILL');assert.equal(options.maxBuffer,65536);
      return {stdout:'{"security_ok":true}\n'};
    }});
  assert.equal(result.security_ok,true);
});

test('connection target, child failures and malformed state are rejected without secret or stderr disclosure',async()=>{
  const valid='postgresql://postgres.nlmvhkjkpgzzlfavaohk:local@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
  for(const url of [undefined,'invalid',valid.replace(':5432',':6543'),valid.replace('postgres.nlmvhkjkpgzzlfavaohk','postgres.other'),valid.replace('/postgres','/other'),valid+'?options=write',valid.replace('aws-1-eu-west-1.pooler.supabase.com','example.com')]){
    let called=false;
    await assert.rejects(readRecoveryState({databaseUrl:url,run:async()=>{called=true;}}),{code:'RECOVERY_DATABASE_CONNECTION_INVALID'});
    assert.equal(called,false);
  }
  await assert.rejects(readRecoveryState({databaseUrl:valid,run:async()=>{throw Error('private-password-stderr');}}),e=>e.code==='RECOVERY_DATABASE_READ_FAILED'&&!e.message.includes('private'));
  await assert.rejects(readRecoveryState({databaseUrl:valid,run:async()=>({stdout:'[]'})}),{code:'RECOVERY_STATE_INVALID'});
});


test('pinned public Supabase CA is the official unexpired 2021 root and temporary bundles are removed',async()=>{
  const pem=fs.readFileSync('supabase/certs/supabase-prod-ca-2021.crt','utf8'),certificate=new X509Certificate(pem);
  assert.equal(certificate.ca,true);assert.match(certificate.subject,/Supabase Root 2021 CA/);
  assert.equal(certificate.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.ok(Date.parse(certificate.validTo)>Date.now());
  const databaseUrl='postgresql://postgres.nlmvhkjkpgzzlfavaohk:local@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
  for(const failure of [false,true]){
    let filename;
    const result=readRecoveryState({databaseUrl,run:async(_c,_a,options)=>{
      filename=options.env.PGSSLROOTCERT;assert.ok(fs.existsSync(filename));
      if(failure)throw Object.assign(Error('private detail'),{stderr:'certificate verify failed: private-server'});
      return {stdout:'{"security_ok":true}'};
    }});
    if(failure)await assert.rejects(result,{code:'RECOVERY_DATABASE_TLS_CA_FAILED'});else await result;
    assert.equal(fs.existsSync(filename),false);
  }
});


test('fixed PostgreSQL migration and its history row are one bounded transaction with guarded role transitions',async()=>{
  await applyRecoveryMigration({databaseUrl:'postgresql://postgres.nlmvhkjkpgzzlfavaohk:local@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',run:async(command,args,options)=>{
    assert.equal(command,'psql');const query=args.at(-1);
    assert.match(query,/^begin; set local lock_timeout='3s'; set local statement_timeout='20s';/);
    const base=query.indexOf('Recovery base contract mismatch'),ddl=query.indexOf('create table if not exists public.scheduled_job_claim_receipts'),proof=query.indexOf('Recovery contract mismatch'),ledger=query.indexOf('insert into supabase_migrations.schema_migrations');
    assert.ok(base>0&&ddl>base&&proof>ddl&&ledger>proof);
    assert.match(query,/pg_advisory_xact_lock/);assert.match(query,/set local role service_role/);assert.match(query,/reset role/);
    assert.match(query,/Recovery migration already recorded/);
    assert.equal((query.match(/\)\) is not true/g)||[]).length,2,'both schema guards reject NULL as unknown');
    assert.match(query,/version,name,statements/);assert.match(query,/array\[\$matchradar_v18_source\$/);assert.match(query,/commit;$/);
    assert.equal(options.timeout,30000);assert.equal(options.killSignal,'SIGKILL');assert.equal(options.env.PGSSLMODE,'verify-full');
    assert.equal(options.env.PGAPPNAME,'matchradar-recovery-migration');assert.doesNotMatch(JSON.stringify(args),/postgresql:\/\/|PGPASSWORD/);
    return {stdout:''};
  }});
});

test('an unknown PostgreSQL write outcome is never reported as an unchanged database',async()=>{
  await assert.rejects(applyRecoveryMigration({databaseUrl:'postgresql://postgres.nlmvhkjkpgzzlfavaohk:local@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',run:async()=>{throw Error('private lost connection');}}),{code:'RECOVERY_WRITE_UNCONFIRMED'});
});
