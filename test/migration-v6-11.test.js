import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createRouteSecurityRuntime } from '../src/route-security-runtime.js';

const sql = fs.readFileSync(new URL('../supabase/migrations/supabase_migration_v6_11.sql', import.meta.url), 'utf8').toLowerCase();
const defaultsSql = fs.readFileSync(new URL('../supabase/migrations/supabase_migration_v6_11_1.sql', import.meta.url), 'utf8').toLowerCase();
const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const routeSecurity = fs.readFileSync(new URL('../src/route-security-runtime.js', import.meta.url), 'utf8');

function securityRuntime(results={}) {
  return createRouteSecurityRuntime({
    TELEGRAM_BURST_POLICIES:{},
    accountRatePolicies:[],
    bumpTelemetry(){},
    cloudflareEdgePolicies:[],
    distributedAnalysisLockPolicy(){ return {}; },
    distributedPreAuthPolicies:[],
    hasSupabase(){ return true; },
    json(value){ return value; },
    memory:{
      routeBurst:new Map(),
      inflight:new Map(),
      userSyncAt:new Map(),
      cache:new Map(),
      telemetry:{},
    },
    privilegedLocalRatePolicy(){ return null; },
    pruneMemoryState(){},
    redactOpsString(value,limit=160){ return String(value ?? '').slice(0,limit); },
    async supaRpc(_cfg,name){
      return results[name] ?? {ok:true,checked_at:'2026-10-07T00:00:00Z'};
    },
  });
}

test('RC19 removes direct browser-role access to backend objects', () => {
  assert.match(sql, /revoke all privileges on all tables in schema public from public, anon, authenticated/);
  assert.match(sql, /revoke all privileges on all sequences in schema public from public, anon, authenticated/);
  assert.match(sql, /revoke execute on all functions in schema public from public, anon, authenticated/);
  assert.match(sql, /revoke create on schema public from public, anon, authenticated/);
});

test('RC19 locks future objects with safe default privileges', () => {
  assert.match(sql, /alter default privileges in schema public\s+revoke all privileges on tables from public, anon, authenticated/);
  assert.match(sql, /alter default privileges in schema public\s+revoke all privileges on sequences from public, anon, authenticated/);
  assert.match(sql, /alter default privileges in schema public\s+revoke execute on functions from public, anon, authenticated/);
  assert.match(defaultsSql, /with application_owners as/);
  assert.match(defaultsSql, /join application_owners owners on owners\.owner_oid = d\.defaclrole/);
});

test('RC19 security contract is invoker-only and service-role-only', () => {
  assert.match(sql, /create or replace function public\.backend_security_contract\(\)/);
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /security definer/);
  assert.match(sql, /revoke all on function public\.backend_security_contract\(\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.backend_security_contract\(\) to service_role/);
  assert.match(defaultsSql, /create or replace function public\.backend_default_acl_contract\(\)/);
  assert.match(defaultsSql, /security invoker/);
  assert.doesNotMatch(defaultsSql, /security definer/);
  assert.match(defaultsSql, /grant execute on function public\.backend_default_acl_contract\(\) to service_role/);
});

test('backend security runtime requires both database contracts to pass', async () => {
  const healthy=await securityRuntime().readBackendSecurityContract({});
  assert.equal(healthy.ok,true);
  assert.equal(healthy.status,'ok');

  const violation=await securityRuntime({
    backend_security_contract:{ok:true},
    backend_default_acl_contract:{ok:false,default_acl_violations:['unsafe default']},
  }).readBackendSecurityContract({});
  assert.equal(violation.ok,false);
  assert.equal(violation.status,'violations');
  assert.deepEqual(violation.defaultAclViolations,['unsafe default']);

  assert.match(routeSecurity,/supaRpc\(cfg, 'backend_security_contract'\)/);
  assert.match(routeSecurity,/supaRpc\(cfg, 'backend_default_acl_contract'\)/);
  assert.match(worker,/function readBackendSecurityContract\(\.\.\.args\).*getRouteSecurityRuntime\(\)\.readBackendSecurityContract/s);
  assert.match(worker,/createRouteSecurityRuntime/);
});
