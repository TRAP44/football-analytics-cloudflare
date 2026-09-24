import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');

test('RC122 verifies rollback traffic and release identity after mutation', () => {
  assert.match(workflow, /RC122 verify exact rollback release postcondition/);
  assert.match(workflow, /wrangler deployments status --json/);
  assert.match(workflow, /wrangler versions view \"\$VERSION_ID\" --json/);
  assert.match(workflow, /verify-rollback-deployment\.js \"\$DEPLOYMENT_STATUS_JSON\" \"\$VERSION_ID\"/);
  assert.match(workflow, /verify-rollback-target\.js \"\$ROLLBACK_VERSION_JSON\" \"\$EXPECTED_VERSION\" \"\$VERSION_ID\"/);
});

test('RC122 remains fail closed and preserves restored-runtime smoke', () => {
  assert.match(workflow, /verified=false/);
  assert.match(workflow, /if \[\[ \"\$verified\" != \"true\" \]\]; then/);
  assert.match(workflow, /exact rollback release identity and 100% traffic/);
  assert.match(workflow, /rollback-smoke\.js \"\$ROLLBACK_URL\" \"\$EXPECTED_VERSION\"/);
});
