import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_21.sql', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const releaseContract = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));

test('v6.21 migration is additive, service-role-only and preserves existing security RPCs', () => {
  assert.match(sql, /create or replace function public\.backend_readiness_contract\(/);
  assert.match(sql, /select public\.backend_security_contract\(\) into v_security/);
  assert.match(sql, /select public\.backend_default_acl_contract\(\) into v_default_acl/);
  assert.match(sql, /select public\.backend_schema_fingerprint\(\) into v_fingerprint/);
  assert.match(sql, /select public\.personal_write_guard_contract\(\) into v_personal_write_guards/);
  assert.match(sql, /select public\.provider_incident_alert_delivery_contract\(\) into v_incident_alert_delivery/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /revoke execute on function public\.backend_readiness_contract\(text,integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.backend_readiness_contract\(text,integer\) to service_role/);
  assert.doesNotMatch(sql, /\bdrop\s+(table|function|column|schema|policy)\b/i);
  assert.doesNotMatch(sql, /alter\s+table[\s\S]*\b(drop|rename)\b/i);
});

test('composite RPC preserves the minimum schema and auth-failure contracts', () => {
  for (const id of [
    'users_acquisition',
    'analysis_history_ai',
    'calibration_transitions',
    'digest_subscriptions',
    'referee_history',
    'growth_events',
    'telegram_update_claims',
    'provider_rate_windows',
    'cache_provenance',
    'odds_provenance',
    'model_provenance',
    'provider_incident_alert_delivery',
  ]) {
    assert.match(sql, new RegExp(id));
  }
  assert.match(sql, /HTTP 401\|PGRST303\|invalid\.\*jwt\|invalid\.\*api\.\?key/);
  assert.match(sql, /order by e\.created_at desc[\s\S]*limit 100/);
  assert.match(sql, /'failureReasons', v_failure_reasons/);
  assert.match(sql, /'connectivity'/);
  assert.match(sql, /'backendSecurity'/);
  assert.match(sql, /'defaultAcl'/);
  assert.match(sql, /'fingerprint'/);
});

test('v6.21 keeps the pre-deploy fingerprint stable by excluding only the new operational RPC', () => {
  assert.match(sql, /'backend_readiness_contract'/);
  assert.match(sql, /create or replace function public\.backend_schema_fingerprint\(\)/);
  assert.match(sql, /'provider_incident_alert_delivery_contract',[\s\S]*'backend_readiness_contract'/);
});

test('release contract and worker target schema v6.23', () => {
  assert.equal(releaseContract.productionSchema, '6.23');
  assert.equal(releaseContract.latestMigration, 'supabase/migrations/supabase_migration_v6_23.sql');
  assert.match(worker, /миграции до v6\.23/);
  assert.match(worker, /createCompositeReadinessRuntime/);
  assert.match(worker, /readCompositeReadiness\(cfg,5\)/);
});
