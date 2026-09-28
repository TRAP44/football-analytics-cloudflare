import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveActiveProductionReleaseIdentity, verifyProductionReleasePostcondition } from '../scripts/verify-production-release-postcondition.js';

const workflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const activeId = '11111111-2222-3333-4444-555555555555';
const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const release = '6.101.0-rc109';
const sha = 'd021ee7cce9afbd8077ce7e35124f10695c56491';

function deployment(versions) {
  return {
    id: '99999999-8888-7777-6666-555555555555',
    strategy: 'percentage',
    versions,
  };
}

function version(id, message) {
  return {
    id,
    annotations: { 'workers/message': message },
    metadata: { created_on: '2026-09-24T11:47:00.000Z', source: 'wrangler' },
  };
}

test('RC120 accepts one active 100 percent version with exact release and commit identity', () => {
  const result = verifyProductionReleasePostcondition(
    deployment([{ version_id: activeId, percentage: 100 }]),
    [version(activeId, `release=${release} sha=${sha}`)],
    release,
    sha
  );
  assert.equal(result.versionId, activeId);
  assert.equal(result.release, release);
  assert.equal(result.sha, sha);
});

test('RC120 rejects split production traffic', () => {
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([
        { version_id: activeId, percentage: 90 },
        { version_id: otherId, percentage: 10 },
      ]),
      [version(activeId, `release=${release} sha=${sha}`)],
      release,
      sha
    ),
    /one version at 100% traffic/
  );
});

test('RC120 rejects a mismatched or missing active version identity stamp', () => {
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [version(activeId, `release=6.100.0-rc108 sha=${sha}`)],
      release,
      sha
    ),
    /release identity mismatch/
  );
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [version(otherId, `release=${release} sha=${sha}`)],
      release,
      sha
    ),
    /missing from the recent Cloudflare versions list/
  );
});

test('RC120 control-plane identity verification runs after deploy and before HTTP smoke', () => {
  assert.match(workflow, /RC120 verify active production release identity/);
  assert.match(workflow, /npx wrangler deployments status --json > "\$DEPLOYMENT_STATUS_JSON"/);
  assert.match(workflow, /npx wrangler versions list --json > "\$VERSIONS_JSON"/);
  assert.match(
    workflow,
    /verify-production-release-postcondition\.js "\$DEPLOYMENT_STATUS_JSON" "\$VERSIONS_JSON" "\$RELEASE_VERSION" "\$DEPLOY_SHA"/
  );
  const deploy = workflow.indexOf('command: deploy --keep-vars');
  const postcondition = workflow.indexOf('- name: RC120 verify active production release identity');
  const smoke = workflow.indexOf('node scripts/post-deploy-smoke.js');
  assert.ok(deploy >= 0);
  assert.ok(postcondition > deploy);
  assert.ok(smoke > postcondition);
});


test('RC120 exposes the active production release identity for cumulative runtime diff checks', () => {
  const result = resolveActiveProductionReleaseIdentity(
    deployment([{ version_id: activeId, percentage: 100 }]),
    [version(activeId, `release=${release} sha=${sha}`)],
  );
  assert.equal(result.versionId, activeId);
  assert.equal(result.release, release);
  assert.equal(result.sha, sha);

  assert.throws(
    () => resolveActiveProductionReleaseIdentity(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [version(activeId, 'malformed-message')],
    ),
    /release identity mismatch/,
  );
});
