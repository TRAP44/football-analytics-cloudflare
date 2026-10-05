import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const workflow = fs.readFileSync('.github/workflows/backup-supabase.yml', 'utf8');
const runbook = fs.readFileSync('docs/SUPABASE_BACKUP_RUNBOOK_RU.md', 'utf8');
const restoreSql = fs.readFileSync('scripts/verify-supabase-restore.sql', 'utf8');
const restoreHardeningSql = fs.readFileSync('scripts/apply-supabase-restore-hardening.sql', 'utf8');

test('Supabase backup workflow is read-only, pinned, encrypted and fail-closed', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron: "17 2 \* \* 0"/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.match(workflow, /BACKUP_ENCRYPTION_PASSPHRASE: \$\{\{ secrets\.BACKUP_ENCRYPTION_PASSPHRASE \}\}/);
  assert.match(workflow, /SUPABASE_CLI_VERSION: "2\.118\.0"/);
  assert.match(workflow, /DB_HOST=.*u\.hostname/);
  assert.match(workflow, /\^\[a-z0-9-\]\+\\\.pooler\\\.supabase\\\.com\$/);
  assert.match(workflow, /DB_PORT.*5432/);
  assert.match(workflow, /DB_USER/);
  assert.match(workflow, /postgres\.\$SUPABASE_PROJECT_REF/);
  assert.match(workflow, /db dump[\s\S]*--role-only/);
  assert.match(workflow, /db dump[\s\S]*schema\.sql/);
  assert.match(workflow, /db dump[\s\S]*--use-copy[\s\S]*--data-only/);
  assert.match(workflow, /-x "storage\.buckets_vectors"/);
  assert.match(workflow, /-x "storage\.vector_indexes"/);
  assert.match(workflow, /sha256sum roles\.sql schema\.sql data\.sql manifest\.txt/);
  assert.match(workflow, /openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000/);
  assert.match(workflow, /openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000/);
  assert.match(workflow, /cmp "\$ARCHIVE" "\$VERIFY_ARCHIVE"/);
  assert.match(workflow, /rm -f "\$VERIFY_ARCHIVE" "\$ARCHIVE"/);
  assert.match(workflow, /rm -rf "\$BACKUP_DIR"/);
  assert.match(workflow, /steps\.package\.outputs\.encrypted/);
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(workflow, /retention-days: 30/);
  assert.doesNotMatch(workflow, /steps\.package\.outputs\.archive/);
  assert.doesNotMatch(workflow, /db (reset|push)/);
  assert.doesNotMatch(workflow, /apply_migration/);
});

test('Supabase backup runbook requires manual backup before production migrations and guarded restore', () => {
  assert.match(runbook, /перед каждой production migration/i);
  assert.match(runbook, /Session pooler/);
  assert.match(runbook, /SUPABASE_DB_URL/);
  assert.match(runbook, /BACKUP_ENCRYPTION_PASSPHRASE/);
  assert.match(runbook, /test decrypt/i);
  assert.match(runbook, /не восстанавливается автоматически/i);
  assert.match(runbook, /Supabase Storage/i);
});


test('Supabase restore drill is isolated, measurable and preserves least privilege', () => {
  assert.match(workflow, /push:[\s\S]*branches: \[main\]/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /restore_drill:/);
  assert.match(workflow, /needs: backup/);
  assert.equal((workflow.match(/runs-on: \[self-hosted, Linux, X64\]/g) || []).length,2);
  assert.match(workflow, /actions\/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0/);
  assert.doesNotMatch(workflow, /gh run download/);
  assert.match(workflow, /supabase@\$SUPABASE_CLI_VERSION" start/);
  assert.match(workflow, /apply-supabase-restore-hardening\.sql/);
  assert.match(workflow, /verify-supabase-restore\.sql/);
  assert.match(workflow, /BACKUP_AGE_SECONDS/);
  assert.match(workflow, /RESTORE_SECONDS/);
  assert.match(workflow, /rowCountParityVerified/);
  assert.match(workflow, /productionDatabaseWritten": false/);

  const restoreJob = workflow.slice(workflow.indexOf('  restore_drill:'));
  assert.doesNotMatch(restoreJob, /SUPABASE_DB_URL:/);
  assert.doesNotMatch(restoreJob, /--db-url/);
  assert.doesNotMatch(restoreJob, /db (push|reset)/);

  assert.match(restoreSql, /row level security|RLS/i);
  assert.match(restoreSql, /has_table_privilege\('anon'/);
  assert.match(restoreSql, /has_table_privilege\('authenticated'/);
  assert.match(restoreSql, /has_table_privilege\('service_role'/);
  assert.match(restoreSql, /user_entitlements/);
  assert.match(restoreSql, /backend_schema_fingerprint/);
  assert.match(restoreSql, /backend_security_contract/);
  assert.match(restoreSql, /backend_default_acl_contract/);
  assert.match(restoreSql, /end\s+\$\$;/);

  assert.match(restoreHardeningSql, /revoke create on schema public from public, anon, authenticated/i);
  assert.match(restoreHardeningSql, /revoke all privileges on all tables in schema public from public, anon, authenticated/i);
  assert.match(restoreHardeningSql, /alter default privileges in schema public/i);
  assert.match(restoreHardeningSql, /grant select, insert, update, delete on all tables in schema public to service_role/i);

  assert.match(runbook, /Изолированный restore drill/i);
  assert.match(runbook, /Observed backup freshness/i);
  assert.match(runbook, /Measured restore time/i);
  assert.match(runbook, /ACL hardening/i);
  assert.match(runbook, /production backup не восстанавливается автоматически/i);
});
