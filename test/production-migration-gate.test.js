import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkProductionMigration, expectedProductionMigration } from '../scripts/verify-production-migrations.js';

const contract=JSON.parse(fs.readFileSync('release-contract.json','utf8'));
const name='supabase_migration_v6_29_13';
const auth={contract,token:'unit-test-token',projectRef:'abcdefghijklmnopqrst'};

test('required migration derives from the checked-in release contract',()=>{
  assert.equal(expectedProductionMigration(contract),name);
  assert.equal(contract.latestMigration,'supabase/migrations/'+name+'.sql');
});

test('production migration gate accepts exact applied migration via read-only Management API',async()=>{
  const result=await checkProductionMigration({...auth,fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/migrations');
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer unit-test-token');
    return {ok:true,status:200,json:async()=>[{name,version:'20261008131139'}]};
  }});
  assert.equal(result.ok,true);
  assert.equal(result.enforced,true);
});

test('production migration gate blocks a missing required version',async()=>{
  const result=await checkProductionMigration({...auth,fetchImpl:async()=>({
    ok:true,status:200,json:async()=>[{name:'supabase_migration_v6_29_12',version:'20261007131400'}],
  })});
  assert.equal(result.ok,false);
  assert.equal(result.enforced,true);
  assert.match(result.reason,/missing/);
});

test('production migration gate fails closed on errors and invalid API payloads',async()=>{
  const mocks=[
    async()=>({ok:false,status:401}),
    async()=>({ok:false,status:429}),
    async()=>({ok:true,status:200,json:async()=>({migrations:[]})}),
    async()=>({ok:true,status:200,json:async()=>[{name}]}),
    async()=>{throw new Error('network failure with sensitive context');},
  ];
  for(const fetchImpl of mocks){
    const result=await checkProductionMigration({...auth,fetchImpl});
    assert.equal(result.ok,false);
    assert.equal(result.enforced,true);
    assert.doesNotMatch(result.reason,/unit-test-token|sensitive context/);
  }
});

test('strict gate blocks missing credentials; optional mode warns without claiming enforcement',async()=>{
  const optional=await checkProductionMigration({contract});
  assert.equal(optional.ok,true);
  assert.equal(optional.enforced,false);
  const strict=await checkProductionMigration({contract,required:true});
  assert.equal(strict.ok,false);
  let calls=0;
  const partial=await checkProductionMigration({
    contract,token:'token-only',required:true,
    fetchImpl:async()=>{calls++;return {};},
  });
  assert.equal(partial.ok,false);
  assert.equal(calls,0);
});

test('gate rejects unsafe ref and bad contract before any outbound request',async()=>{
  await assert.rejects(()=>checkProductionMigration({contract:{latestMigration:'../unsafe.sql'}}),/invalid latestMigration/);
  let calls=0;
  const result=await checkProductionMigration({...auth,projectRef:'../../bad',fetchImpl:async()=>{calls++;return {};}});
  assert.equal(result.ok,false);
  assert.equal(calls,0);
});

test('production deployment performs the migration check before changing Cloudflare',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
  const gate=workflow.indexOf('name: Verify production Supabase migration history');
  assert.ok(gate>0 && workflow.indexOf('name: Deploy Worker')>gate);
  assert.match(workflow,/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(workflow,/SUPABASE_PROJECT_REF: \$\{\{ vars\.SUPABASE_PROJECT_REF \}\}/);
  assert.match(workflow,/SUPABASE_MIGRATION_GATE_REQUIRED: \$\{\{ vars\.SUPABASE_MIGRATION_GATE_REQUIRED \}\}/);
  assert.match(workflow,/run: node scripts\/verify-production-migrations\.js/);
});

test('manual migration verification workflow uses production-scoped secrets and always enforces the gate',()=>{
  const workflow=fs.readFileSync('.github/workflows/verify-production-migration.yml','utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/environment: production/);
  assert.match(workflow,/permissions:\s*\n\s*contents: read/);
  assert.match(workflow,/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(workflow,/SUPABASE_PROJECT_REF: \$\{\{ vars\.SUPABASE_PROJECT_REF \}\}/);
  assert.match(workflow,/SUPABASE_MIGRATION_GATE_REQUIRED: 'true'/);
  assert.match(workflow,/run: node scripts\/verify-production-migrations\.js/);
  assert.doesNotMatch(workflow,/wrangler deploy|wrangler versions deploy|apply_migration|migration up/);
});
