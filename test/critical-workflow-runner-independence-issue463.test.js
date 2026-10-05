import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const quality = fs.readFileSync('.github/workflows/quality.yml', 'utf8');
const codeql = fs.readFileSync('.github/workflows/codeql.yml', 'utf8');
const audit = fs.readFileSync('.github/workflows/privileged-access-audit.yml', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const monitor = fs.readFileSync('.github/workflows/external-production-monitor.yml', 'utf8');
const diagnostics = fs.readFileSync('.github/workflows/external-production-monitor-diagnostics.yml', 'utf8');
const recovery = fs.readFileSync('docs/runner-recovery.md', 'utf8');

test('issue #463 critical CI, security, deploy and monitor jobs are independent of the local runner', () => {
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

test('issue #463 keeps self-hosted execution optional and diagnostic-only', () => {
  assert.match(diagnostics, /runs-on: \[self-hosted, Linux, X64\]/);
  assert.match(diagnostics, /workflows: \["External Production Monitor"\]/);
  assert.match(recovery, /secondary diagnostic signal only/i);
  assert.match(recovery, /must not block Quality/i);
});

test('issue #463 preserves database and production fail-closed gates after runner migration', () => {
  assert.match(quality, /supabase@\$SUPABASE_CLI_VERSION/);
  assert.match(quality, /docker version/);
  assert.match(quality, /scripts\/supabase-concurrency-gate\.js/);
  assert.match(quality, /scripts\/supabase-ci-contract\.sql/);

  assert.match(deploy, /environment: production/);
  assert.match(deploy, /verify-main-pr-provenance\.js/);
  assert.match(deploy, /verify-production-release-postcondition\.js/);
  assert.match(deploy, /Automatic rollback after failed production verification/);
  assert.match(deploy, /post-deploy-smoke\.js/);
  assert.doesNotMatch(monitor, /CLOUDFLARE_API_TOKEN|SUPABASE_SECRET_KEY|TELEGRAM_BOT_TOKEN/);
});
