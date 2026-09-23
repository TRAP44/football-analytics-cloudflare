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
  assert.match(deploy, /cloudflare\/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0/);
  assert.match(deploy, /wranglerVersion: "4\.136\.1"/);
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

test('rollback requires explicit target confirmation and verifies restored production', () => {
  assert.match(rollback, /version_id:/);
  assert.match(rollback, /expected_version:/);
  assert.match(rollback, /if: inputs\.confirm == 'ROLLBACK'/);
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
