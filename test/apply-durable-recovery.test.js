import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyDurableRecovery,readRecoveryState,RECOVERY_STATE_SQL} from '../scripts/apply-durable-recovery.js';
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
      if(init.method==='POST'){
        writes++;
        const body=JSON.parse(init.body);assert.equal(body.name,'supabase_migration_v6_29_18');
        assert.match(body.query,/claim_scheduled_job_owned/);assert.match(body.query,/statement_timeout='20s'/);assert.match(body.query,/Recovery contract mismatch/);
        if(options.denied)return new Response('private upstream details',{status:403});
        applied=true;if(options.lostResponse)throw new TypeError('private network detail');return new Response(null,{status:200});
      }
      return Response.json([{name:'supabase_migration_v6_29_17'},...(applied?[{name:'supabase_migration_v6_29_18'}]:[])]);
    }
    throw Error('Unexpected fixed endpoint');
  };
  return {run:overrides=>applyDurableRecovery({env:{...env,...overrides},fetchImpl,now:()=>now,readState:async()=>({fingerprint:applied?contract.databaseContract.fingerprint:contract.databaseContract.baseFingerprint,legacy_fingerprint:contract.databaseContract.legacyFingerprint,security_ok:options.badSecurity!==true,receipts:applied,owned_claim:applied,versioned_cache:applied})}),calls,writes:()=>writes};
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

test('unknown migration HTTP result is confirmed by reads and is never replayed',async()=>{
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
  await assert.rejects(h.run({RECOVERY_MODE:'apply'}),e=>{assert.equal(e.code,'RECOVERY_HTTP_403');assert.doesNotMatch(e.message,/private/);return true;});
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
      assert.equal(options.env.PGSSLMODE,'verify-full');assert.equal(options.env.PGSSLROOTCERT,'/etc/ssl/certs/ca-certificates.crt');
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
