import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_21.sql', 'utf8');
const contractV2Sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_27_2.sql', 'utf8');
const compatibilitySql = fs.readFileSync('supabase/migrations/supabase_migration_v6_27_3.sql', 'utf8');
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

test('Issue #438 adds a complete versioned database contract without mutating the historical rollout contract', () => {
  const v2Only = contractV2Sql.split('-- Freeze the historical v1 fingerprint')[0];
  assert.match(v2Only, /create or replace function public\.backend_schema_contract_v2\(\)/);
  assert.match(v2Only, /create or replace function public\.backend_readiness_contract_v2\(/);
  assert.match(v2Only, /from information_schema\.columns c[\s\S]*where c\.table_schema = 'public'/);
  assert.match(v2Only, /from pg_constraint pc/);
  assert.match(v2Only, /from pg_indexes/);
  assert.match(v2Only, /from pg_proc p/);
  assert.match(v2Only, /from pg_policies p/);
  assert.match(v2Only, /from pg_trigger t/);
  assert.match(v2Only, /has_table_privilege/);
  assert.match(v2Only, /has_sequence_privilege/);
  assert.match(v2Only, /has_function_privilege/);
  assert.doesNotMatch(v2Only, /table_name\s+not\s+in/i);
  assert.doesNotMatch(v2Only, /proname\s+not\s+in/i);
  assert.match(contractV2Sql, /backend_schema_contract_v2'[\s\S]*backend_readiness_contract_v2'/);
  assert.match(compatibilitySql, /legacy schema fingerprint compatibility repair/i);
});

test('release contract and Worker require database contract v2 on schema v6.28', () => {
  assert.equal(releaseContract.productionSchema, '6.28');
  assert.equal(releaseContract.latestMigration, 'supabase/migrations/supabase_migration_v6_28.sql');
  assert.equal(releaseContract.databaseContract.version, 2);
  assert.equal(releaseContract.databaseContract.rpc, 'backend_readiness_contract_v2');
  assert.equal(releaseContract.databaseContract.fingerprint, '6a7f0fe444f49a2a52c4603e952ee9ea');
  assert.equal(releaseContract.databaseContract.freshInstallFingerprint, '8b3e6ec749079296e6746d3db8ae3d2e');
  assert.deepEqual(releaseContract.databaseContract.compatibleFingerprints, [
    releaseContract.databaseContract.fingerprint,
    releaseContract.databaseContract.freshInstallFingerprint,
  ]);
  assert.equal(releaseContract.databaseContract.legacyFingerprint, 'c2c22ec25aacfcf1b9938b0850cebf49');
  assert.equal(releaseContract.databaseContract.freshInstallLegacyFingerprint, 'e025ecf4559a4d7518250b4124ff26c8');
  assert.match(worker, /миграции до v6\.28/);
  assert.match(worker, /EXPECTED_SCHEMA_CONTRACT_VERSION = 2/);
  assert.match(worker, /EXPECTED_SCHEMA_FINGERPRINT = '6a7f0fe444f49a2a52c4603e952ee9ea'/);
  assert.match(worker, /FRESH_INSTALL_SCHEMA_FINGERPRINT = '8b3e6ec749079296e6746d3db8ae3d2e'/);
  assert.match(worker, /expectedFingerprints: COMPATIBLE_SCHEMA_FINGERPRINTS/);
  assert.match(worker, /readinessRpc: 'backend_readiness_contract_v2'/);
  assert.match(worker, /readCompositeReadiness\(cfg,5\)/);
});
