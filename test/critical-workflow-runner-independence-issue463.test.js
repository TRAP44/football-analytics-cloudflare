import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const quality = fs.readFileSync('.github/workflows/quality.yml', 'utf8');
const codeql = fs.readFileSync('.github/workflows/codeql.yml', 'utf8');
const audit = fs.readFileSync('.github/workflows/privileged-access-audit.yml', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const monitor = fs.readFileSync('.github/workflows/external-production-monitor.yml', 'utf8');
const diagnostics = fs.readFileSync('.github/workflows/external-production-monitor-diagnostics.yml', 'utf8');
const runbook = fs.readFileSync('docs/runner-recovery.md', 'utf8');

test('issue #463 removes the local runner from every critical execution path', () => {
  for (const [name, source] of [
    ['Quality', quality],
    ['CodeQL', codeql],
    ['Privileged Access Audit', audit],
    ['Deploy Production', deploy],
    ['External Production Monitor', monitor],
  ]) {
    assert.match(source, /runs-on: ubuntu-latest/, name);
    assert.doesNotMatch(source, /runs-on:\s*\[self-hosted, Linux, X64\]/, name);
  }
  assert.equal((quality.match(/runs-on: ubuntu-latest/g) || []).length, 2);
});

test('issue #463 preserves full database and release gates on hosted runners', () => {
  assert.match(quality, /docker version/);
  assert.match(quality, /psql --version/);
  assert.match(quality, /supabase@\$SUPABASE_CLI_VERSION/);
  assert.match(quality, /supabase-concurrency-gate\.js/);
  assert.match(quality, /supabase-ci-contract\.sql/);

  assert.match(deploy, /environment: production/);
  assert.match(deploy, /verify-main-pr-provenance\.js/);
  assert.match(deploy, /verify-production-release-postcondition\.js/);
  assert.match(deploy, /Automatic rollback after failed production verification/);
  assert.match(deploy, /post-deploy-smoke\.js/);
});

test('issue #463 keeps self-hosted execution optional and diagnostic-only', () => {
  assert.match(diagnostics, /runs-on: \[self-hosted, Linux, X64\]/);
  assert.match(diagnostics, /workflows: \["External Production Monitor"\]/);
  assert.match(runbook, /secondary diagnostic signal only/i);
  assert.match(runbook, /must not block/i);
  assert.doesNotMatch(monitor, /CLOUDFLARE_API_TOKEN|SUPABASE_SECRET_KEY|TELEGRAM_BOT_TOKEN/);
});
