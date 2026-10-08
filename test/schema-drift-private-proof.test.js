import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  verifyPublicSchemaDriftEligibility,
  verifySchemaDriftRecovery,
} from '../scripts/verify-schema-drift-recovery.js';

const current='f3d899ff05789e6cfb257abe011872d2';
const status={
  ok:false,status:'not_ready',
  checks:{
    supabase:{ok:true,status:'ok'},
    schema:{ok:false,status:'drift'},
    backendSecurity:{ok:true,status:'ok'},
    telegramConfigured:true,
  },
};

test('public schema drift permits preview checks, never production promotion',()=>{
  const snapshot=verifyPublicSchemaDriftEligibility(503,status,current);
  assert.deepEqual(snapshot,{
    ok:true,phase:'preview_only',expectedFingerprint:current,
  });
  assert.equal(Object.isFrozen(snapshot),true);
  assert.equal('recentSupabaseAuthFailures' in status.checks,false);
  assert.equal('fingerprint' in status.checks.schema,false);
});

test('public recovery rejects every unhealthy signal before uploading a candidate',()=>{
  const c=status.checks;
  for (const checks of [
    {...c,supabase:{ok:false,status:'http_401'}},
    {...c,supabase:{ok:true,status:'unavailable'}},
    {...c,backendSecurity:{ok:false,status:'violations'}},
    {...c,backendSecurity:{ok:true,status:'unknown'}},
    {...c,telegramConfigured:false},
    {...c,telegramConfigured:'true'},
    {...c,schema:{ok:false,status:'mixed'}},
    {...c,schema:{ok:true,status:'ok'}},
    {...c,schema:{ok:false,status:'unavailable'}},
  ]) assert.throws(()=>verifyPublicSchemaDriftEligibility(
    503,{...status,checks},current,
  ));
  assert.throws(()=>verifyPublicSchemaDriftEligibility(200,status,current),/HTTP 503/);
  assert.throws(()=>verifyPublicSchemaDriftEligibility(503,{...status,ok:true},current),/HTTP 503/);
  assert.throws(()=>verifyPublicSchemaDriftEligibility(503,status,'not a fingerprint'),/invalid/);
});

test('public recovery refuses unexpected private detail disclosure',()=>{
  for(const changes of [
    {schema:{ok:false,status:'drift',fingerprint:current}},
    {schema:{ok:false,status:'drift',expectedFingerprint:current}},
    {recentSupabaseAuthFailures:0},
  ]) {
    const checks={...status.checks,...changes};
    assert.throws(()=>verifyPublicSchemaDriftEligibility(
      503,{...status,checks},current,
    ),/private details/);
  }
});

test('actual 503 sanitized health selects only preview recovery',async()=>{
  const result=await verifySchemaDriftRecovery('https://example.com',current,{
    fetchImpl:async(url,init)=>{
      assert.equal(new URL(url).pathname,'/health/ready');
      assert.equal(init.method,'GET');
      return {status:503,json:async()=>status};
    },
  });
  assert.equal(result.phase,'preview_only');
  assert.equal(result.ok,true);
});

test('workflow proves rollback metadata then immutable preview smoke before switching any traffic',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/deploy-production.yml',import.meta.url),'utf8');
  const smoke=readFileSync(new URL('../scripts/post-deploy-smoke.js',import.meta.url),'utf8');
  const identify=workflow.indexOf('node scripts/verify-rollback-target.js "$RUNNER_TEMP/automatic-rollback-target.json"');
  const eligible=workflow.indexOf('node scripts/verify-schema-drift-recovery.js "$SMOKE_URL"');
  const upload=workflow.indexOf('npx wrangler versions upload --keep-vars --preview-alias');
  const candidate=workflow.indexOf('node scripts/post-deploy-smoke.js "$RECOVERY_URL"');
  const mobile=workflow.indexOf('node scripts/bottom-nav-render-smoke.js "$RECOVERY_URL"');
  const promote=workflow.indexOf('npx wrangler versions deploy "$RECOVERY_VERSION_ID@100%"');
  assert.ok(identify>=0 && identify<eligible && eligible<upload && upload<candidate
    && candidate<mobile && mobile<promote);
  assert.ok(workflow.includes('if: steps.production_changes.outputs.changed == \'true\' && steps.rollback_preflight.outputs.recovery_mode == \'true\''));
  assert.ok(smoke.includes("Readiness schema fingerprint failed."));
  assert.ok(smoke.includes("Health endpoint is not healthy."));
  assert.ok(smoke.includes("Health endpoint must embed a passing readiness snapshot."));
  assert.ok(smoke.includes('/api/me'));
});
