import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');

test('RC114 binds rollback confirmation to both expected version and version id', () => {
  assert.match(workflow, /Type ROLLBACK:<expected_version>:<version_id> to confirm the exact rollback target/);
  assert.match(
    workflow,
    /inputs\.confirm == format\('ROLLBACK:\{0\}:\{1\}', inputs\.expected_version, inputs\.version_id\)/
  );
  assert.doesNotMatch(workflow, /if: inputs\.confirm == 'ROLLBACK'/);
});

test('RC114 preserves fail-closed rollback provenance and target validation', () => {
  assert.match(workflow, /RC113 verify rollback workflow provenance/);
  assert.match(workflow, /Rollback must be dispatched from main/);
  assert.match(workflow, /Stale rollback workflow blocked/);
  assert.match(workflow, /expected_version must look like 6\.94\.0-rc102/);
  assert.match(workflow, /version_id format is invalid/);
});

test('RC114 records exact-target confirmation before the destructive rollback command', () => {
  const confirmationIndex = workflow.indexOf('RC114 rollback target confirmation verified');
  const rollbackIndex = workflow.indexOf('npx wrangler rollback "$VERSION_ID" --yes');
  assert.ok(confirmationIndex >= 0);
  assert.ok(rollbackIndex > confirmationIndex);
  assert.match(workflow, /Operator confirmation is bound to expected version \$EXPECTED_VERSION and version ID \$VERSION_ID/);
  assert.match(workflow, /scripts\/rollback-smoke\.js "\$ROLLBACK_URL" "\$EXPECTED_VERSION"/);
});
