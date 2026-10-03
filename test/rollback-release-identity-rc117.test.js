import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyRollbackTarget } from '../scripts/verify-rollback-target.js';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');

function stampedVersion(overrides = {}) {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    annotations: {
      'workers/message': 'release=6.101.0-rc109 sha=297985dc7faf3f222e046844726f2f747b097e6e',
    },
    ...overrides,
  };
}

test('RC117 accepts a stamped rollback target only when release identity matches', () => {
  const result = verifyRollbackTarget(
    stampedVersion(),
    '6.101.0-rc109',
    '11111111-2222-3333-4444-555555555555',
    false
  );
  assert.equal(result.mode, 'stamped');
  assert.equal(result.releaseVersion, '6.101.0-rc109');
  assert.equal(result.deploySha, '297985dc7faf3f222e046844726f2f747b097e6e');
});


test('Issue #409 rejects malformed rollback Cloudflare version identifiers', () => {
  const malformed={...stampedVersion(),id:'not-a-version-id'};
  assert.throws(
    () => verifyRollbackTarget(
      malformed,
      '6.101.0-rc109',
      'not-a-version-id',
      false,
    ),
    /RELEASE_IDENTITY_CLOUDFLARE_VERSION_ID_INVALID/,
  );
});

test('RC117 rejects a stamped rollback target when expected version is wrong', () => {
  assert.throws(
    () => verifyRollbackTarget(
      stampedVersion(),
      '6.100.0-rc108',
      '11111111-2222-3333-4444-555555555555',
      false
    ),
    /release identity mismatch/
  );
});

test('RC117 rejects a resolved Cloudflare version different from the requested id', () => {
  assert.throws(
    () => verifyRollbackTarget(
      stampedVersion(),
      '6.101.0-rc109',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      false
    ),
    /instead of requested/
  );
});

test('RC117 blocks legacy targets by default and requires an explicit override', () => {
  const legacy = {
    id: '11111111-2222-3333-4444-555555555555',
    annotations: { 'workers/message': 'RC109 historical deployment' },
  };
  assert.throws(
    () => verifyRollbackTarget(legacy, '6.101.0-rc109', legacy.id, false),
    /allow_legacy_unverified=true/
  );
  assert.throws(
    () => verifyRollbackTarget(legacy, '6.101.0-rc109', legacy.id, true),
    /requires exact confirmation/
  );
  assert.deepEqual(
    verifyRollbackTarget(
      legacy,
      '6.101.0-rc109',
      legacy.id,
      true,
      `LEGACY-UNVERIFIED:6.101.0-rc109:${legacy.id}`
    ),
    { mode: 'legacy-unverified', releaseVersion: null, deploySha: null }
  );
});

test('RC117 identity verification runs after Cloudflare lookup and before rollback mutation', () => {
  assert.match(workflow, /allow_legacy_unverified:[\s\S]*default: false[\s\S]*type: boolean/);
  const lookup = workflow.indexOf('- name: RC115 verify rollback target exists');
  const identity = workflow.indexOf('- name: RC117 verify rollback release identity');
  const rollback = workflow.indexOf('npx wrangler rollback "$VERSION_ID" --yes');
  assert.ok(lookup >= 0);
  assert.ok(identity > lookup);
  assert.ok(rollback > identity);
  assert.match(
    workflow,
    /node scripts\/verify-rollback-target\.js "\$RUNNER_TEMP\/rollback-version\.json" "\$EXPECTED_VERSION" "\$VERSION_ID" "\$ALLOW_LEGACY_UNVERIFIED"/
  );
});
