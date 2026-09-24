import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyRollbackTargetIdentity } from '../scripts/verify-rollback-target-identity.js';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');
const sha = '0123456789abcdef0123456789abcdef01234567';

test('RC117 accepts an exact Cloudflare release identity stamp', () => {
  const identity = verifyRollbackTargetIdentity(
    { annotations: { 'workers/message': `release=6.101.0-rc109 sha=${sha}` } },
    '6.101.0-rc109'
  );

  assert.equal(identity.release, '6.101.0-rc109');
  assert.equal(identity.sha, sha);
});

test('RC117 finds workers/message in nested Wrangler JSON payloads', () => {
  const identity = verifyRollbackTargetIdentity(
    { result: { metadata: { annotations: { 'workers/message': `release=6.101.0-rc109 sha=${sha}` } } } },
    '6.101.0-rc109'
  );

  assert.equal(identity.sha, sha);
});

test('RC117 fails closed for a mismatched release or malformed commit identity', () => {
  assert.throws(
    () => verifyRollbackTargetIdentity(
      { annotations: { 'workers/message': `release=6.100.0-rc108 sha=${sha}` } },
      '6.101.0-rc109'
    ),
    /identity mismatch/
  );

  assert.throws(
    () => verifyRollbackTargetIdentity(
      { annotations: { 'workers/message': 'release=6.101.0-rc109 sha=deadbeef' } },
      '6.101.0-rc109'
    ),
    /identity mismatch/
  );
});

test('RC117 identity verification runs after existence preflight and before rollback mutation', () => {
  assert.match(workflow, /RC117 verify rollback target release identity/);
  assert.match(workflow, /npx wrangler versions view "\$VERSION_ID" --json > "\$TARGET_VERSION_JSON"/);
  assert.match(
    workflow,
    /node scripts\/verify-rollback-target-identity\.js "\$TARGET_VERSION_JSON" "\$EXPECTED_VERSION" "\$VERSION_ID"/
  );

  const existencePreflight = workflow.indexOf('- name: RC115 verify rollback target exists');
  const identityPreflight = workflow.indexOf('- name: RC117 verify rollback target release identity');
  const rollback = workflow.indexOf('npx wrangler rollback "$VERSION_ID" --yes');

  assert.ok(existencePreflight >= 0);
  assert.ok(identityPreflight > existencePreflight);
  assert.ok(rollback > identityPreflight);
});
