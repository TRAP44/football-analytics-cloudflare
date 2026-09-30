import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const deploy = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const monitor = fs.readFileSync('.github/workflows/external-production-monitor.yml', 'utf8');

test('no-op deploy keeps the canonical production URL available for smoke verification', () => {
  const monitorUrl = /PRODUCTION_URL:\s*"([^"]+)"/.exec(monitor)?.[1] || '';
  const deployUrl = /PRODUCTION_URL:\s*"([^"]+)"/.exec(deploy)?.[1] || '';

  assert.ok(monitorUrl, 'external monitor must declare canonical production URL');
  assert.equal(deployUrl, monitorUrl);
  assert.match(deploy, /SMOKE_URL="\$\{CONFIGURED_URL:-\$\{DEPLOYMENT_URL:-\$PRODUCTION_URL\}\}"/);
});

test('no-op deploy skips Worker mutation but still verifies the active runtime SHA', () => {
  assert.match(deploy, /echo "active_sha=\$ACTIVE_SHA" >> "\$GITHUB_OUTPUT"/);
  assert.match(deploy, /echo "changed=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(deploy, /Deploy Worker[\s\S]*if: steps\.production_changes\.outputs\.changed == 'true'/);
  assert.match(deploy, /ACTIVE_RUNTIME_SHA: \$\{\{ steps\.production_changes\.outputs\.active_sha \}\}/);
  assert.match(deploy, /if \[\[ "\$RUNTIME_CHANGED" != "true" \]\]; then[\s\S]*EXPECTED_RUNTIME_SHA="\$ACTIVE_RUNTIME_SHA"/);
  assert.match(deploy, /post-deploy-smoke\.js "\$SMOKE_URL" "\$RELEASE_VERSION" "\$EXPECTED_RUNTIME_SHA"/);
});
