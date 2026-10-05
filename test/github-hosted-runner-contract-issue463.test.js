import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const criticalWorkflows = [
  '.github/workflows/quality.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/privileged-access-audit.yml',
  '.github/workflows/deploy-production.yml',
  '.github/workflows/external-production-monitor.yml',
  '.github/workflows/external-production-monitor-diagnostics.yml',
  '.github/workflows/backup-supabase.yml',
];

test('critical CI, deploy and monitoring workflows do not depend on self-hosted runners', () => {
  for (const path of criticalWorkflows) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /runs-on:\s*\[[^\]]*self-hosted/i, path);
    assert.match(source, /runs-on:\s*ubuntu-latest/, path);
  }
});

test('database integration prepares psql when GitHub-hosted image lacks it', () => {
  const quality = readFileSync('.github/workflows/quality.yml', 'utf8');
  assert.match(quality, /Ensure PostgreSQL client/);
  assert.match(quality, /postgresql-client/);
});
