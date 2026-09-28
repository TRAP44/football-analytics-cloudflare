import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const workflow = fs.readFileSync('.github/workflows/backup-supabase.yml', 'utf8');
const runbook = fs.readFileSync('docs/SUPABASE_BACKUP_RUNBOOK_RU.md', 'utf8');

test('Supabase backup workflow is read-only, pinned, encrypted and fail-closed', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron: "17 2 \* \* 0"/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.match(workflow, /BACKUP_ENCRYPTION_PASSPHRASE: \$\{\{ secrets\.BACKUP_ENCRYPTION_PASSPHRASE \}\}/);
  assert.match(workflow, /SUPABASE_CLI_VERSION: "2\.118\.0"/);
  assert.match(workflow, /\.pooler\.supabase\.com:5432/);
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
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
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
