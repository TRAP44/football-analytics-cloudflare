import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readRecoveryDatabaseEvidence,
  verifySanitizedSchemaDriftRecovery,
  verifySchemaDriftRecovery,
} from '../scripts/verify-schema-drift-recovery.js';

const current='f3d899ff05789e6cfb257abe011872d2';
const previous='4e7b6afc69b45ab3e5eecc4685d75c73';
const oldSource="const EXPECTED_SCHEMA_FINGERPRINT = '"+previous+"';";
const publicReady={
  ok:false,status:'not_ready',
  checks:{
    supabase:{ok:true,status:'ok'},
    schema:{ok:false,status:'drift'},
    backendSecurity:{ok:true,status:'ok'},
    telegramConfigured:true,
  },
};

function databaseProof(overrides={}) {
  return {
    ok:true,
    connectivity:{ok:true,status:'ok'},
    backendSecurity:{ok:true,status:'ok'},
    schemaContractVersion:2,
    schema:{
      ok:true,status:'ok',contractVersion:2,
      fingerprint:{ok:true,fingerprint:current,expected:current},
    },
    recentSupabaseAuthFailures:{available:true,count:0,windowMinutes:5},
    ...overrides,
  };
}

function mockDatabaseFetch(proof=databaseProof()) {
  return async (url,init)=>{
    assert.equal(url,'https://api.supabase.com/v1/projects/nlmvhkjkpgzzlfavaohk/database/query');
    assert.equal(init.method,'POST');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,'Bearer protected-management-token');
    const body=JSON.parse(init.body);
    assert.equal(body.read_only,true);
    assert.equal(body.query,"select public.backend_readiness_contract_v2('"+current+"', 5) as readiness");
    return {ok:true,status:201,json:async()=>[{readiness:proof}]};
  };
}

test('sanitized /health/ready plus authenticated DB proof authorizes only matching candidate schema',async()=>{
  const result=await verifySchemaDriftRecovery('https://matchradar.example/',current,{
    previousWorkerSource:oldSource,
    token:'protected-management-token',
    projectRef:'nlmvhkjkpgzzlfavaohk',
    fetchImpl:async (url,init)=>{
      assert.equal(new URL(url).pathname,'/health/ready');
      assert.equal(init.method,'GET');
      return {status:503,json:async()=>publicReady};
    },
    databaseFetchImpl:mockDatabaseFetch(),
  });
  assert.equal(result.ok,true);
  assert.equal(result.actualFingerprint,current);
  assert.equal(result.staleExpectedFingerprint,previous);
  assert.equal(Object.isFrozen(result),true);
  // Crucially, sensitive data never appears in the public response.
  assert.equal('recentSupabaseAuthFailures' in publicReady.checks,false);
  assert.equal('fingerprint' in publicReady.checks.schema,false);
});

test('private recovery proof fails closed for auth failures, schema mismatches and security incidents',async()=>{
  const bad=[
    databaseProof({recentSupabaseAuthFailures:{available:true,count:1,windowMinutes:5}}),
    databaseProof({backendSecurity:{ok:false,status:'violations'}}),
    databaseProof({connectivity:{ok:false,status:'http_401'}}),
    databaseProof({schema:{...databaseProof().schema,fingerprint:{ok:true,fingerprint:previous,expected:current}}}),
    databaseProof({schemaContractVersion:3}),
  ];
  for(const proof of bad){
    await assert.rejects(
      readRecoveryDatabaseEvidence({
        token:'protected-management-token',projectRef:'nlmvhkjkpgzzlfavaohk',
        expectedFingerprint:current,fetchImpl:mockDatabaseFetch(proof),
      }),
      /checks are not healthy/,
    );
  }
});

test('private recovery rejects missing credentials, malformed API responses and non-503 public status',async()=>{
  await assert.rejects(readRecoveryDatabaseEvidence({
    token:'',projectRef:'nlmvhkjkpgzzlfavaohk',expectedFingerprint:current,
    fetchImpl:mockDatabaseFetch(),
  }),/credentials|evidence is required/);
  await assert.rejects(readRecoveryDatabaseEvidence({
    token:'protected-management-token',projectRef:'nlmvhkjkpgzzlfavaohk',
    expectedFingerprint:current,fetchImpl:async()=>({ok:false,status:403}),
  }),/verification failed/);
  await assert.rejects(readRecoveryDatabaseEvidence({
    token:'protected-management-token',projectRef:'nlmvhkjkpgzzlfavaohk',
    expectedFingerprint:current,fetchImpl:async()=>({ok:true,status:201,json:async()=>({})}),
  }),/malformed/);
  await assert.rejects(verifySchemaDriftRecovery('https://matchradar.example/',current,{
    previousWorkerSource:oldSource,
    token:'protected-management-token',projectRef:'nlmvhkjkpgzzlfavaohk',
    fetchImpl:async()=>({status:200,json:async()=>({...publicReady,ok:true,status:'ready'})}),
    databaseFetchImpl:mockDatabaseFetch(),
  }),/HTTP 503/);
});

test('private proof may not override stale or suspicious public readiness',()=>{
  const evidence={fingerprint:current,authFailures:0};
  for(const checks of [
    {...publicReady.checks,supabase:{ok:false,status:'http_401'}},
    {...publicReady.checks,backendSecurity:{ok:false,status:'violations'}},
    {...publicReady.checks,schema:{ok:true,status:'ok'}},
    {...publicReady.checks,telegramConfigured:false},
  ]) assert.throws(()=>verifySanitizedSchemaDriftRecovery(
    503,{...publicReady,checks},current,oldSource,evidence,
  ));
  assert.throws(()=>verifySanitizedSchemaDriftRecovery(
    503,publicReady,current,"const EXPECTED_SCHEMA_FINGERPRINT = '"+current+"';",evidence,
  ),/stale schema fingerprint/);
  assert.throws(()=>verifySanitizedSchemaDriftRecovery(
    503,publicReady,current,oldSource,{fingerprint:previous,authFailures:0},
  ),/mismatched/);
});
