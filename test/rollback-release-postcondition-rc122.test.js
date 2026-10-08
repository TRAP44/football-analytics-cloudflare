import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');

test('RC122 verifies rollback traffic and release identity after mutation', () => {
  assert.match(workflow, /RC122 verify rollback release identity/);
  assert.match(workflow, /wrangler deployments status --json/);
  assert.match(workflow, /wrangler versions view \"\$VERSION_ID\" --json/);
  assert.match(workflow, /verify-rollback-deployment\.js \"\$DEPLOYMENT_STATUS_JSON\" \"\$VERSION_ID\"/);
  assert.match(workflow, /verify-rollback-target\.js \"\$ROLLBACK_VERSION_JSON\" \"\$EXPECTED_VERSION\" \"\$VERSION_ID\"/);
});

test('RC122 remains fail closed and preserves restored-runtime smoke', () => {
  assert.match(workflow, /verified=false/);
  assert.match(workflow, /if \[\[ \"\$verified\" != \"true\" \]\]; then/);
  assert.match(workflow, /100% production traffic on rollback target \$VERSION_ID or its exact release identity/);
  assert.match(workflow, /rollback-smoke\.js \"\$ROLLBACK_URL\" \"\$EXPECTED_VERSION\"/);
});

test('RC122 combines traffic and identity verification in one fail-closed retry loop',()=>{
  const start=workflow.indexOf('- name: RC119 verify exact rollback deployment target');
  const end=workflow.indexOf('- name: Verify restored production',start);
  assert.ok(start>=0&&end>start);
  const gate=workflow.slice(start,end);
  const traffic=gate.indexOf('node scripts/verify-rollback-deployment.js');
  const identity=gate.indexOf('node scripts/verify-rollback-target.js');
  const success=gate.indexOf('verified=true');
  const failure=gate.indexOf('if [[ "$verified" != "true" ]]; then');
  assert.ok(traffic>=0&&identity>traffic&&success>identity&&failure>success);
  assert.match(gate,/set -euo pipefail/);
  assert.match(gate,/exit 1/);
});
