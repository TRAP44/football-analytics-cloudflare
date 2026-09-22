import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase_migration_v6_11.sql', import.meta.url), 'utf8').toLowerCase();
const defaultsSql = fs.readFileSync(new URL('../supabase_migration_v6_11_1.sql', import.meta.url), 'utf8').toLowerCase();
const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

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

test('Worker blocks both release gates when the security contract fails', () => {
  assert.match(worker, /async function readBackendSecurityContract/);
  assert.match(worker, /supaRpc\(cfg, 'backend_default_acl_contract'\)/);
  assert.equal((worker.match(/'backend_security_contract'/g) || []).length >= 3, true);
  assert.match(worker, /backendSecurity\.ok \? 'pass' : 'fail'/);
});
