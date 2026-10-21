import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyDurableRecovery} from '../scripts/apply-durable-recovery.js';
const contract=JSON.parse(fs.readFileSync('release-contract.json','utf8'));
const sha='a'.repeat(40),repository='TRAP44/football-analytics-cloudflare',now=Date.now();
const env={GITHUB_REPOSITORY:repository,GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,SUPABASE_PROJECT_REF:'nlmvhkjkpgzzlfavaohk',GITHUB_TOKEN:'local-github',SUPABASE_ACCESS_TOKEN:'local-supabase',RECOVERY_MODE:'preflight',RECOVERY_BACKUP_RUN_ID:'1234'};
function fixture(options={}){
  let applied=options.applied===true,writes=0;const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,method:init.method,body:init.body});
    if(url.includes('api.github.com')){
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
    if(url.endsWith('/database/query/read-only'))return Response.json([{fingerprint:applied?contract.databaseContract.fingerprint:contract.databaseContract.baseFingerprint,legacy_fingerprint:contract.databaseContract.legacyFingerprint,security_ok:options.badSecurity!==true,receipts:applied,owned_claim:applied,versioned_cache:applied}]);
    throw Error('Unexpected fixed endpoint');
  };
  return {run:overrides=>applyDurableRecovery({env:{...env,...overrides},fetchImpl,now:()=>now}),calls,writes:()=>writes};
}

test('preflight reads current main, provenance and fixed project state without a production mutation',async()=>{
  const h=fixture(),r=await h.run();assert.equal(r.productionChanged,false);assert.equal(r.status,'ready_for_backup_and_apply');assert.equal(h.writes(),0);
  assert.ok(h.calls.filter(x=>x.method==='POST').every(x=>x.url.endsWith('/database/query/read-only')));
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
  assert.match(workflow,/options: \[preflight, apply\]/);assert.doesNotMatch(workflow,/pull_request_target|query:\s*\$\{\{|SUPABASE_DB_URL/);
});
