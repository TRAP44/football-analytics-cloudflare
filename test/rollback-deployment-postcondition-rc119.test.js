import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyRollbackDeployment } from '../scripts/verify-rollback-deployment.js';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');
const targetId = '11111111-2222-3333-4444-555555555555';
const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function deployment(versions) {
  return {
    id: '99999999-8888-7777-6666-555555555555',
    strategy: 'percentage',
    versions,
  };
}

test('RC119 accepts only the requested version at 100 percent production traffic', () => {
  assert.deepEqual(
    verifyRollbackDeployment(deployment([{ version_id: targetId, percentage: 100 }]), targetId),
    {
      ok: true,
      deploymentId: '99999999-8888-7777-6666-555555555555',
      versionId: targetId,
      percentage: 100,
    }
  );
});

test('RC119 rejects split traffic even when the rollback target is present', () => {
  assert.throws(
    () => verifyRollbackDeployment(
      deployment([
        { version_id: targetId, percentage: 90 },
        { version_id: otherId, percentage: 10 },
      ]),
      targetId
    ),
    /must serve 100%/
  );
});

test('RC119 rejects a different active version and malformed traffic totals', () => {
  assert.throws(
    () => verifyRollbackDeployment(deployment([{ version_id: otherId, percentage: 100 }]), targetId),
    /is not serving production traffic/
  );
  assert.throws(
    () => verifyRollbackDeployment(
      deployment([
        { version_id: targetId, percentage: 99 },
        { version_id: otherId, percentage: 0 },
      ]),
      targetId
    ),
    /must total 100%/
  );
});

test('RC119 exact deployment verification runs after rollback and before application smoke', () => {
  assert.match(workflow, /RC119 verify exact rollback deployment target/);
  assert.match(workflow, /npx wrangler deployments status --json > "\$DEPLOYMENT_STATUS_JSON"/);
  assert.match(
    workflow,
    /node scripts\/verify-rollback-deployment\.js "\$DEPLOYMENT_STATUS_JSON" "\$VERSION_ID"/
  );
  assert.match(workflow, /for attempt in 1 2 3 4 5; do/);
  assert.match(workflow, /Cloudflare did not confirm 100% production traffic on rollback target \$VERSION_ID/);

  const rollback = workflow.indexOf('npx wrangler rollback "$VERSION_ID" --yes');
  const postcondition = workflow.indexOf('- name: RC119 verify exact rollback deployment target');
  const smoke = workflow.indexOf('node scripts/rollback-smoke.js "$ROLLBACK_URL" "$EXPECTED_VERSION"');
  assert.ok(rollback >= 0);
  assert.ok(postcondition > rollback);
  assert.ok(smoke > postcondition);
});
