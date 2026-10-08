import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(
  new URL('../supabase/migrations/supabase_migration_v6_29_12.sql',import.meta.url),
  'utf8',
).toLowerCase();

test('v6.29.12 normalizes current service_role table and sequence privileges',()=>{
  assert.match(sql,/revoke all privileges on all tables in schema public from service_role/);
  assert.match(sql,/grant select, insert, update, delete on all tables in schema public to service_role/);
  assert.match(sql,/revoke all privileges on all sequences in schema public from service_role/);
  assert.match(sql,/grant usage, select on all sequences in schema public to service_role/);
});

test('v6.29.12 hardens postgres default privileges for future objects',()=>{
  assert.match(sql,/alter default privileges for role postgres in schema public[\s\S]*revoke all privileges on tables from service_role/);
  assert.match(sql,/alter default privileges for role postgres in schema public[\s\S]*grant select, insert, update, delete on tables to service_role/);
  assert.match(sql,/alter default privileges for role postgres in schema public[\s\S]*revoke all privileges on sequences from service_role/);
  assert.match(sql,/alter default privileges for role postgres in schema public[\s\S]*grant usage, select on sequences to service_role/);
});

test('v6.29.12 release gates fail closed on forbidden service_role privileges',()=>{
  assert.match(sql,/r\.rolname = 'service_role'/);
  assert.match(sql,/acl\.privilege_type not in \('select', 'insert', 'update', 'delete'\)/);
  assert.match(sql,/acl\.privilege_type not in \('usage', 'select'\)/);
  assert.match(sql,/backend_security_contract\(\)/);
  assert.match(sql,/backend_default_acl_contract\(\)/);
  assert.match(sql,/raise exception 'v6\.29\.12 backend security contract failed:/);
  assert.match(sql,/raise exception 'v6\.29\.12 default acl contract failed:/);
});

test('least-privilege migration refuses broad future grants to service_role',()=>{
  assert.doesNotMatch(sql,/\bgrant all privileges on all tables in schema public to service_role/i);
  assert.doesNotMatch(sql,/\bgrant all privileges on all sequences in schema public to service_role/i);
  assert.match(sql,/grant select, insert, update, delete on all tables in schema public to service_role/);
  assert.match(sql,/grant usage, select on all sequences in schema public to service_role/);
});
