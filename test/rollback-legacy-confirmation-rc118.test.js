import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyRollbackTarget } from '../scripts/verify-rollback-target.js';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');
const legacyId = '11111111-2222-3333-4444-555555555555';
const expectedVersion = '6.101.0-rc109';
const legacy = {
  id: legacyId,
  annotations: { 'workers/message': 'Historical deployment before RC116 identity stamps' },
};

test('RC118 accepts a legacy override only with exact target-bound acknowledgement', () => {
  const confirmation = `LEGACY-UNVERIFIED:${expectedVersion}:${legacyId}`;
  assert.deepEqual(
    verifyRollbackTarget(legacy, expectedVersion, legacyId, true, confirmation),
    { mode: 'legacy-unverified', releaseVersion: null, deploySha: null }
  );
});

test('RC118 fails closed when legacy acknowledgement is missing or bound to another target', () => {
  assert.throws(
    () => verifyRollbackTarget(legacy, expectedVersion, legacyId, true, ''),
    /requires exact confirmation/
  );
  assert.throws(
    () => verifyRollbackTarget(
      legacy,
      expectedVersion,
      legacyId,
      true,
      `LEGACY-UNVERIFIED:${expectedVersion}:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`
    ),
    /requires exact confirmation/
  );
  assert.throws(
    () => verifyRollbackTarget(
      legacy,
      expectedVersion,
      legacyId,
      true,
      `LEGACY-UNVERIFIED:6.100.0-rc108:${legacyId}`
    ),
    /requires exact confirmation/
  );
});

test('RC118 does not add a legacy acknowledgement requirement to stamped targets', () => {
  const stamped = {
    id: legacyId,
    annotations: {
      'workers/message': 'release=6.101.0-rc109 sha=d09f24590822816a32f036670c457c7544be8860',
    },
  };
  const result = verifyRollbackTarget(stamped, expectedVersion, legacyId, true, '');
  assert.equal(result.mode, 'stamped');
  assert.equal(result.deploySha, 'd09f24590822816a32f036670c457c7544be8860');
});

test('RC118 workflow keeps legacy acknowledgement default-off and passes it before rollback mutation', () => {
  assert.match(
    workflow,
    /legacy_confirm:[\s\S]*LEGACY-UNVERIFIED:<expected_version>:<version_id>[\s\S]*default: ""[\s\S]*type: string/
  );
  assert.match(workflow, /LEGACY_CONFIRM: \$\{\{ inputs\.legacy_confirm \}\}/);
  assert.match(
    workflow,
    /verify-rollback-target\.js "\$RUNNER_TEMP\/rollback-version\.json" "\$EXPECTED_VERSION" "\$VERSION_ID" "\$ALLOW_LEGACY_UNVERIFIED" "\$LEGACY_CONFIRM"/
  );
  const identity = workflow.indexOf('- name: RC117 verify rollback release identity');
  const rollback = workflow.indexOf('npx wrangler rollback "$VERSION_ID" --yes');
  assert.ok(identity >= 0);
  assert.ok(rollback > identity);
});
