import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const workflow = fs.readFileSync('.github/workflows/backup-supabase.yml', 'utf8');
const runbook = fs.readFileSync('docs/SUPABASE_BACKUP_RUNBOOK_RU.md', 'utf8');

test('Supabase backup workflow is read-only, pinned, private-artifact oriented and fail-closed', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron: "17 2 \* \* 0"/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.match(workflow, /SUPABASE_CLI_VERSION: "2\.117\.0"/);
  assert.match(workflow, /\.pooler\.supabase\.com:5432/);
  assert.match(workflow, /db dump[\s\S]*--role-only/);
  assert.match(workflow, /db dump[\s\S]*schema\.sql/);
  assert.match(workflow, /db dump[\s\S]*--use-copy[\s\S]*--data-only/);
  assert.match(workflow, /sha256sum roles\.sql schema\.sql data\.sql manifest\.txt/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /retention-days: 30/);
  assert.doesNotMatch(workflow, /db (reset|push)/);
  assert.doesNotMatch(workflow, /apply_migration/);
});

test('Supabase backup runbook requires manual backup before production migrations and guarded restore', () => {
  assert.match(runbook, /перед каждой production migration/i);
  assert.match(runbook, /Session pooler/);
  assert.match(runbook, /SUPABASE_DB_URL/);
  assert.match(runbook, /не восстанавливается автоматически/i);
  assert.match(runbook, /Supabase Storage/i);
});
