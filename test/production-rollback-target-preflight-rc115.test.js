import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');

test('RC115 verifies the Cloudflare rollback target before mutation', () => {
  assert.match(workflow, /RC115 verify rollback target exists/);
  assert.match(workflow, /npx wrangler versions view "\$VERSION_ID" --json > "\$RUNNER_TEMP\/rollback-version\.json"/);
  assert.match(workflow, /RC115 rollback target preflight passed/);
  assert.match(workflow, /Cloudflare resolved rollback target version ID \$VERSION_ID before any rollback mutation/);
});

test('RC115 target lookup runs after local preflight and before destructive rollback', () => {
  const localPreflight = workflow.indexOf('- name: Rollback preflight');
  const targetPreflight = workflow.indexOf('- name: RC115 verify rollback target exists');
  const rollback = workflow.indexOf('npx wrangler rollback "$VERSION_ID" --yes');
  assert.ok(localPreflight >= 0);
  assert.ok(targetPreflight > localPreflight);
  assert.ok(rollback > targetPreflight);
});

test('RC115 preserves target-bound confirmation, provenance and post-rollback smoke', () => {
  assert.match(workflow, /inputs\.confirm == format\('ROLLBACK:\{0\}:\{1\}', inputs\.expected_version, inputs\.version_id\)/);
  assert.match(workflow, /RC113 verify rollback workflow provenance/);
  assert.match(workflow, /scripts\/rollback-smoke\.js "\$ROLLBACK_URL" "\$EXPECTED_VERSION"/);
});
