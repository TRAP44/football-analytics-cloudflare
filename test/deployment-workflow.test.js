import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const deploy = fs.readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../.github/workflows/rollback-production.yml', import.meta.url), 'utf8');
const quality = fs.readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('production deploy follows successful Quality on main', () => {
  assert.match(deploy, /workflow_run:[\s\S]*workflows: \[Quality\][\s\S]*branches: \[main\]/);
  assert.match(deploy, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(deploy, /ref: \$\{\{ env\.DEPLOY_SHA \}\}/);
});

test('production deploy is pinned, preserves remote vars and runs smoke checks', () => {
  assert.match(deploy, /cloudflare\/wrangler-action@953926a2e2182532811c01a25e53647d93bf07c0/);
  assert.match(deploy, /wranglerVersion: "4\.141\.0"/);
  assert.match(deploy, /deploy --keep-vars/);
  assert.match(deploy, /scripts\/post-deploy-smoke\.js/);
  assert.doesNotMatch(deploy, /cloudflare\/wrangler-action@v\d/);
});

test('missing credentials fail closed without exposing values', () => {
  assert.match(deploy, /Cloudflare deploy blocked/);
  assert.match(deploy, /exit 1/);
  assert.doesNotMatch(deploy, /steps\.credentials\.outputs\.available/);
  assert.doesNotMatch(deploy, /echo[^\n]*\$CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/);
});

test('rollback requires exact target confirmation and verifies restored production', () => {
  assert.match(rollback, /version_id:/);
  assert.match(rollback, /expected_version:/);
  assert.match(rollback, /inputs\.confirm == format\('ROLLBACK:\{0\}:\{1\}', inputs\.expected_version, inputs\.version_id\)/);
  assert.match(rollback, /npx wrangler rollback "\$VERSION_ID" --yes/);
  assert.match(rollback, /CLOUDFLARE_WORKER_URL/);
  assert.match(rollback, /scripts\/rollback-smoke\.js "\$ROLLBACK_URL" "\$EXPECTED_VERSION"/);
});

test('quality verifies a dry-run Worker bundle with pinned GitHub actions', () => {
  assert.match(quality, /npm run verify:worker/);
  assert.match(quality, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(quality, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
});

test('all health probes run through the Worker instead of the SPA fallback', () => {
  assert.match(wrangler, /"run_worker_first"\s*:\s*\[[^\]]*"\/health"[^\]]*"\/health\/\*"/);
});


test('production change detection compares current main with the active Cloudflare SHA', () => {
  assert.match(deploy, /id: production_changes/);
  assert.match(deploy, /verify-production-release-postcondition\.js "\$DEPLOYMENT_STATUS_JSON" "\$VERSIONS_JSON" --print-active-rollback-target/);
  assert.match(deploy, /git merge-base --is-ancestor "\$ACTIVE_SHA" "\$DEPLOY_SHA"/);
  assert.match(deploy, /git diff --quiet "\$ACTIVE_SHA" "\$DEPLOY_SHA" -- src public wrangler\.jsonc package\.json package-lock\.json/);
  assert.doesNotMatch(deploy, /BASE_SHA="\$\(git rev-parse "\$DEPLOY_SHA\^"\)"/);

  const credentials = deploy.indexOf('- name: Check Cloudflare credentials');
  const detection = deploy.indexOf('- name: Detect pending production artifact changes');
  const cloudflareDeploy = deploy.indexOf('- name: Deploy Worker');
  assert.ok(credentials >= 0 && detection > credentials && cloudflareDeploy > detection);

  for (const step of [
    'Deploy Worker',
    'RC120 verify active production release identity',
  ]) {
    const start = deploy.indexOf(`- name: ${step}`);
    assert.ok(start >= 0, step);
    const block = deploy.slice(start, start + 260);
    assert.match(block, /if: steps\.production_changes\.outputs\.changed == 'true'/, step);
  }

  const verification = deploy.indexOf('- name: Verify production deployment');
  assert.ok(verification >= 0);
  const verificationBlock = deploy.slice(verification, verification + 1500);
  assert.doesNotMatch(verificationBlock, /if: steps\.production_changes\.outputs\.changed == 'true'/);
  assert.match(verificationBlock, /ACTIVE_RUNTIME_SHA: \$\{\{ steps\.production_changes\.outputs\.active_sha \}\}/);
  assert.match(verificationBlock, /if \[\[ "\$RUNTIME_CHANGED" != "true" \]\]; then[\s\S]*EXPECTED_RUNTIME_SHA="\$ACTIVE_RUNTIME_SHA"/);
  assert.match(verificationBlock, /post-deploy-smoke\.js "\$SMOKE_URL" "\$RELEASE_VERSION" "\$EXPECTED_RUNTIME_SHA"/);
});


test('unreadable active Cloudflare identity blocks production before mutation', () => {
  assert.match(deploy, /### Safe production deployment blocked/);
  assert.match(deploy, /automatic rollback target cannot be proven/);
  assert.match(deploy, /echo "rollback_ready=false" >> "\$GITHUB_OUTPUT"/);

  const detection = deploy.indexOf('- name: Detect pending production artifact changes');
  const rollbackPreflight = deploy.indexOf('- name: Preflight previous-known-good rollback target');
  const cloudflareDeploy = deploy.indexOf('- name: Deploy Worker');
  assert.ok(detection >= 0 && rollbackPreflight > detection && cloudflareDeploy > rollbackPreflight);

  const detectionBlock = deploy.slice(detection, rollbackPreflight);
  assert.match(detectionBlock, /exit 1/);
  assert.doesNotMatch(detectionBlock, /Active production identity unavailable/);
  assert.doesNotMatch(detectionBlock, /RC120 will validate the new identity after deploy/);
});


test('production verification waits for bounded Cloudflare activation convergence', () => {
  const start = deploy.indexOf('- name: RC120 verify active production release identity');
  assert.ok(start >= 0);
  const block = deploy.slice(start, start + 1800);
  assert.match(block, /for attempt in 1 2 3 4 5 6 7 8 9 10; do/);
  assert.match(block, /if \[\[ "\$attempt" -lt 10 \]\]; then[\s\S]*sleep 6/);
  assert.match(block, /Cloudflare did not confirm the expected production release identity/);
});

test('unchanged runtime is smoke-verified without a duplicate deploy', () => {
  const deployWorker = deploy.indexOf('- name: Deploy Worker');
  const verify = deploy.indexOf('- name: Verify production deployment');
  assert.ok(deployWorker >= 0 && verify > deployWorker);
  const workerBlock = deploy.slice(deployWorker, deployWorker + 500);
  const rollback = deploy.indexOf('- name: Automatic rollback after failed production verification');
  assert.ok(rollback > verify);
  const verifyBlock = deploy.slice(verify, rollback);
  assert.match(workerBlock, /if: steps\.production_changes\.outputs\.changed == 'true'/);
  assert.doesNotMatch(verifyBlock, /^\s*if:/m);
  assert.match(verifyBlock, /RUNTIME_CHANGED: \$\{\{ steps\.production_changes\.outputs\.changed \}\}/);
  assert.match(verifyBlock, /EXPECTED_RUNTIME_SHA="\$ACTIVE_RUNTIME_SHA"/);
});
