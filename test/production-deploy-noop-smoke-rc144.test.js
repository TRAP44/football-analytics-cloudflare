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


test('no-op detection resolves the exact immutable version serving production traffic', () => {
  assert.match(deploy, /ACTIVE_VERSION_ID="\$\(node scripts\/verify-production-release-postcondition\.js "\$DEPLOYMENT_STATUS_JSON" --print-active-version-id\)"/);
  assert.match(deploy, /npx wrangler versions view "\$ACTIVE_VERSION_ID" --json > "\$VERSIONS_JSON"/);
  assert.match(deploy, /--print-active-rollback-target 2>"\$IDENTITY_ERROR"/);
  assert.match(deploy, /echo "previous_version_id=\$ACTIVE_VERSION_ID" >> "\$GITHUB_OUTPUT"/);
  assert.match(deploy, /echo "rollback_ready=false" >> "\$GITHUB_OUTPUT"[\s\S]*exit 1/);
});

test('no-op is permitted only for matching release, reachable ancestry and identical runtime artifacts', () => {
  assert.match(deploy, /if \[\[ "\$ACTIVE_RELEASE" != "\$RELEASE_VERSION" \]\]; then[\s\S]*echo "changed=true"/);
  assert.match(deploy, /elif ! git cat-file -e "\$\{ACTIVE_SHA\}\^\{commit\}" 2>\/dev\/null; then[\s\S]*echo "changed=true"/);
  assert.match(deploy, /elif ! git merge-base --is-ancestor "\$ACTIVE_SHA" "\$DEPLOY_SHA"; then[\s\S]*echo "changed=true"/);
  assert.match(deploy, /elif git diff --quiet "\$ACTIVE_SHA" "\$DEPLOY_SHA" -- src public wrangler\.jsonc package\.json package-lock\.json; then\s+echo "changed=false"/);
});

test('no-op does not upload or mutate Worker versions when the active runtime is unchanged', () => {
  assert.match(deploy, /name: Preflight previous-known-good rollback target[\s\S]*?if: steps\.production_changes\.outputs\.changed == 'true'/);
  assert.match(deploy, /name: Promote schema-drift recovery candidate[\s\S]*?if: steps\.production_changes\.outputs\.changed == 'true'/);
  assert.match(deploy, /name: RC120 verify active production release identity[\s\S]*?if: steps\.production_changes\.outputs\.changed == 'true'/);
  assert.match(deploy, /name: Automatic rollback after failed production verification[\s\S]*?steps\.production_changes\.outputs\.changed == 'true'/);
});

test('no-op smoke pins the verified active Cloudflare Version ID alongside SHA', () => {
  assert.match(deploy, /ACTIVE_RUNTIME_VERSION_ID: \$\{\{ steps\.production_changes\.outputs\.previous_version_id \}\}/);
  assert.match(deploy, /VERIFIED_VERSION_ID: \$\{\{ steps\.release_identity\.outputs\.active_version_id \}\}/);
  assert.match(deploy, /EXPECTED_VERSION_ID="\$VERIFIED_VERSION_ID"/);
  assert.match(deploy, /if \[\[ "\$RUNTIME_CHANGED" != "true" \]\]; then\s+EXPECTED_RUNTIME_SHA="\$ACTIVE_RUNTIME_SHA"\s+EXPECTED_VERSION_ID="\$ACTIVE_RUNTIME_VERSION_ID"/);
  assert.match(deploy, /if \[\[ ! "\$EXPECTED_VERSION_ID" =~ \^\[0-9a-fA-F-\]\{36\}\$ \]\]; then[\s\S]*exit 1/);
  assert.match(deploy, /post-deploy-smoke\.js "\$SMOKE_URL" "\$RELEASE_VERSION" "\$EXPECTED_RUNTIME_SHA" "\$EXPECTED_VERSION_ID"/);
  assert.match(deploy, /node scripts\/bottom-nav-render-smoke\.js "\$SMOKE_URL"/);
});
