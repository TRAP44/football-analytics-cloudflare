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



test('schema recovery requires HTTP 503 as a number and fingerprint as a string',()=>{
  assert.throws(()=>verifySchemaDriftRecoverySnapshot('503',payload(),actual),/HTTP 503/);
  assert.throws(()=>verifySchemaDriftRecoverySnapshot(true,payload(),actual),/HTTP 503/);
  assert.throws(()=>verifySchemaDriftRecoverySnapshot(503,payload(),{toString:()=>actual}),/fingerprint is invalid/);
  assert.throws(()=>verifySchemaDriftRecoverySnapshot(503,payload(),[actual]),/fingerprint is invalid/);
});

test('schema recovery does not accept spoofed fingerprint objects from readiness',()=>{
  for(const key of ['fingerprint','expectedFingerprint','primaryExpectedFingerprint']){
    const item={...payload().checks.schema};
    item[key]={toString:()=>item[key]};
    assert.throws(
      ()=>verifySchemaDriftRecoverySnapshot(503,payload({checks:{...payload().checks,schema:item}}),actual),
      /fingerprint|schema expectations/i,
      key,
    );
  }
});

test('schema recovery rejects contradictory, unavailable or non-drift readiness',()=>{
  const existing=payload().checks;
  for(const schema of [
    {...existing.schema,status:'unavailable'},
    {...existing.schema,status:'mixed'},
    {...existing.schema,ok:true},
    {...existing.schema,expectedFingerprint:actual},
    {...existing.schema,primaryExpectedFingerprint:'f'.repeat(32)},
  ]) assert.throws(
    ()=>verifySchemaDriftRecoverySnapshot(503,payload({checks:{...existing,schema}}),actual),
    /schema drift|stale schema fingerprint|schema expectations/i,
  );
  assert.throws(()=>verifySchemaDriftRecoverySnapshot(200,payload(),actual),/HTTP 503/);
  assert.throws(()=>verifySchemaDriftRecoverySnapshot(503,payload({ok:true}),actual),/not_ready/);
});

test('schema recovery canonicalizes string fingerprint case and freezes its result',()=>{
  const source=payload();
  source.checks.schema.fingerprint=actual.toUpperCase();
  source.checks.schema.expectedFingerprint=stale.toUpperCase();
  source.checks.schema.primaryExpectedFingerprint=stale.toUpperCase();
  const prior=JSON.stringify(source);
  const result=verifySchemaDriftRecoverySnapshot(503,source,actual.toUpperCase());
  assert.equal(result.ok,true);
  assert.equal(result.actualFingerprint,actual);
  assert.equal(result.staleExpectedFingerprint,stale);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(JSON.stringify(source),prior);
});
