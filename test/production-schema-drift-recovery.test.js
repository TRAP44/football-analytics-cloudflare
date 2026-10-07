import test from 'node:test';
import assert from 'node:assert/strict';

import {
  expectedSchemaFingerprintFromWorker,
  verifySchemaDriftRecoverySnapshot,
} from '../scripts/verify-schema-drift-recovery.js';

const actual='4e7b6afc69b45ab3e5eecc4685d75c73';
const stale='6a7f0fe444f49a2a52c4603e952ee9ea';

function payload(overrides={}) {
  return {
    ok:false,
    status:'not_ready',
    checks:{
      supabase:{ok:true,status:'ok'},
      schema:{
        ok:false,
        status:'drift',
        fingerprint:actual,
        expectedFingerprint:stale,
        primaryExpectedFingerprint:stale,
      },
      backendSecurity:{ok:true,status:'ok'},
      telegramConfigured:true,
      recentSupabaseAuthFailures:0,
    },
    ...overrides,
  };
}

test('schema drift recovery accepts only a stale Worker whose live DB matches the candidate fingerprint',()=>{
  const result=verifySchemaDriftRecoverySnapshot(503,payload(),actual);
  assert.equal(result.ok,true);
  assert.equal(result.actualFingerprint,actual);
  assert.equal(result.staleExpectedFingerprint,stale);
});

test('schema drift recovery fails closed for unrelated readiness failures',()=>{
  assert.throws(
    ()=>verifySchemaDriftRecoverySnapshot(503,payload({
      checks:{...payload().checks,supabase:{ok:false,status:'http_503'}},
    }),actual),
    /Supabase connectivity/,
  );
  assert.throws(
    ()=>verifySchemaDriftRecoverySnapshot(503,payload({
      checks:{...payload().checks,backendSecurity:{ok:false,status:'violations'}},
    }),actual),
    /backend security/,
  );
  assert.throws(
    ()=>verifySchemaDriftRecoverySnapshot(503,payload({
      checks:{...payload().checks,telegramConfigured:false},
    }),actual),
    /Telegram/,
  );
  assert.throws(
    ()=>verifySchemaDriftRecoverySnapshot(503,payload({
      checks:{...payload().checks,recentSupabaseAuthFailures:1},
    }),actual),
    /auth failures/,
  );
});

test('schema drift recovery requires the database fingerprint to match the candidate release',()=>{
  assert.throws(
    ()=>verifySchemaDriftRecoverySnapshot(503,payload(),'289d4be4a3546443d48ff5f0b8bd6dcb'),
    /does not match the candidate release/,
  );
  assert.throws(
    ()=>verifySchemaDriftRecoverySnapshot(200,payload(),actual),
    /HTTP 503/,
  );
});

test('candidate fingerprint is resolved from one canonical worker constant',()=>{
  assert.equal(
    expectedSchemaFingerprintFromWorker(`const EXPECTED_SCHEMA_FINGERPRINT = '${actual}';`),
    actual,
  );
  assert.throws(
    ()=>expectedSchemaFingerprintFromWorker('const OTHER = 1;'),
    /Unable to resolve/,
  );
});
