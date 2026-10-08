import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { verifyRollbackTarget } from '../scripts/verify-rollback-target.js';
import { activeProductionVersion } from '../scripts/verify-production-release-postcondition.js';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/deploy-production.yml', import.meta.url),
  'utf8',
);
const postcondition = fs.readFileSync(
  new URL('../scripts/verify-production-release-postcondition.js', import.meta.url),
  'utf8',
);

const previousId = '11111111-2222-3333-4444-555555555555';
const previousRelease = '6.120.0-rc144';
const previousSha = 'a'.repeat(40);

function stampedVersion({
  id = previousId,
  release = previousRelease,
  sha = previousSha,
} = {}) {
  return {
    id,
    metadata: {
      created_on: '2026-10-07T18:00:00.000Z',
    },
    annotations: {
      'workers/message': `release=${release} sha=${sha}`,
      'workers/tag': sha,
    },
  };
}

test('Issue #432 active identity CLI can emit exact automatic rollback target', () => {
  assert.match(postcondition, /--print-active-rollback-target/);
  assert.match(postcondition, /active\.versionId.*active\.release.*active\.sha/s);
});

test('Issue #432 binds a stamped rollback target to exact release, version ID and deploy SHA', () => {
  const result = verifyRollbackTarget(
    stampedVersion(),
    previousRelease,
    previousId,
    false,
    '',
    previousSha,
  );
  assert.equal(result.mode, 'stamped');
  assert.equal(result.releaseVersion, previousRelease);
  assert.equal(result.deploySha, previousSha);

  assert.throws(
    () => verifyRollbackTarget(
      stampedVersion(),
      previousRelease,
      previousId,
      false,
      '',
      'b'.repeat(40),
    ),
    /deploy SHA mismatch/,
  );
});

test('Issue #432 pins and preflights previous-known-good target before deploy', () => {
  const detect = workflow.indexOf('- name: Detect pending production artifact changes');
  const preflight = workflow.indexOf('- name: Preflight previous-known-good rollback target');
  const deploy = workflow.indexOf('- name: Deploy Worker');
  assert.ok(detect >= 0 && preflight > detect && deploy > preflight);

  const detectionBlock = workflow.slice(detect, preflight);
  assert.match(detectionBlock, /--print-active-rollback-target/);
  assert.match(detectionBlock, /previous_version_id=\$ACTIVE_VERSION_ID/);
  assert.match(detectionBlock, /previous_release=\$ACTIVE_RELEASE/);
  assert.match(detectionBlock, /previous_sha=\$ACTIVE_SHA/);
  assert.match(detectionBlock, /rollback_ready=true/);
  assert.match(detectionBlock, /Safe production deployment blocked/);
  assert.match(detectionBlock, /exit 1/);

  const preflightBlock = workflow.slice(preflight, deploy);
  assert.match(preflightBlock, /wrangler versions view "\$PREVIOUS_VERSION_ID"/);
  assert.match(
    preflightBlock,
    /verify-rollback-target\.js[^\n]*"\$PREVIOUS_RELEASE"[^\n]*"\$PREVIOUS_VERSION_ID" false "" "\$PREVIOUS_SHA"/,
  );
  assert.match(preflightBlock, /rollback-smoke\.js "\$SMOKE_URL" "\$PREVIOUS_RELEASE"/);
});

test('Issue #432 automatically rolls back only after a successful deploy and failed verification', () => {
  const rollback = workflow.indexOf('- name: Automatic rollback after failed production verification');
  assert.ok(rollback >= 0);
  const block = workflow.slice(rollback);

  assert.match(
    block,
    /failure\(\).*steps\.production_changes\.outputs\.changed == 'true'.*steps\.deploy\.outcome == 'success'/,
  );
  assert.match(block, /npx wrangler rollback "\$PREVIOUS_VERSION_ID" --yes/);
  assert.match(block, /verify-rollback-deployment\.js "\$DEPLOYMENT_STATUS_JSON" "\$PREVIOUS_VERSION_ID"/);
  assert.match(
    block,
    /verify-rollback-target\.js[^\n]*"\$PREVIOUS_RELEASE"[^\n]*"\$PREVIOUS_VERSION_ID" false "" "\$PREVIOUS_SHA"/,
  );
  assert.match(block, /rollback-smoke\.js "\$ROLLBACK_URL" "\$PREVIOUS_RELEASE"/);
  assert.match(block, /100% traffic/);
});

test('Issue #432 no-op runtime path cannot trigger automatic rollback', () => {
  const rollback = workflow.indexOf('- name: Automatic rollback after failed production verification');
  const block = workflow.slice(rollback, rollback + 900);
  assert.match(block, /steps\.production_changes\.outputs\.changed == 'true'/);
  assert.match(block, /steps\.deploy\.outcome == 'success'/);
});



test('rollback target validation rejects mismatched version tag, SHA or future timestamp',()=>{
  for(const version of [
    stampedVersion({sha:'b'.repeat(40)}),
    {...stampedVersion(),annotations:{'workers/message':'release='+previousRelease+' sha='+previousSha,'workers/tag':'b'.repeat(40)}},
    {...stampedVersion(),metadata:{created_on:'2035-10-07T18:00:00.000Z'}},
  ]){
    assert.throws(
      ()=>verifyRollbackTarget(version,previousRelease,previousId,false,'',previousSha),
      /rollback|Rollback|identity|deploy SHA/i,
    );
  }
});

test('legacy rollback override remains denied unless exact separate confirmation is provided',()=>{
  const unstamped={id:previousId,metadata:{created_on:'2026-10-07T18:00:00.000Z'},annotations:{}};
  assert.throws(()=>verifyRollbackTarget(unstamped,previousRelease,previousId),/no RC116 release identity metadata/);
  assert.throws(()=>verifyRollbackTarget(unstamped,previousRelease,previousId,true,''),/exact confirmation/);
  assert.throws(()=>verifyRollbackTarget(unstamped,previousRelease,previousId,true,'LEGACY-UNVERIFIED:wrong'),/exact confirmation/);
  const confirmed=verifyRollbackTarget(unstamped,previousRelease,previousId,true,
    'LEGACY-UNVERIFIED:'+previousRelease+':'+previousId);
  assert.equal(confirmed.mode,'legacy-unverified');
});

test('rollback postcondition rejects split traffic and invalid percentage representation',()=>{
  assert.equal(activeProductionVersion({versions:[{version_id:previousId,percentage:100}]}),previousId);
  for(const versions of [
    [{version_id:previousId,percentage:99},{version_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',percentage:1}],
    [{version_id:previousId,percentage:'100'}],
    [{version_id:previousId,percentage:101}],
    [],
  ]){
    assert.throws(()=>activeProductionVersion({versions}),/version|traffic|percentage/i);
  }
});

test('automatic rollback revalidates the target before restoring and confirms 100 percent traffic afterward',()=>{
  const index=workflow.indexOf('- name: Automatic rollback after failed production verification');
  assert.ok(index>=0);
  const block=workflow.slice(index);
  const check=block.indexOf('verify-rollback-target.js');
  const restore=block.indexOf('npx wrangler rollback "$PREVIOUS_VERSION_ID" --yes');
  const post=block.indexOf('verify-rollback-deployment.js');
  const smoke=block.indexOf('node scripts/rollback-smoke.js');
  assert.ok(check>=0 && restore>check && post>restore && smoke>post);
  assert.match(block,/failure\(\) && steps\.production_changes\.outputs\.changed == 'true' && steps\.deploy\.outcome == 'success'/);
  assert.match(block,/if \[\[ -z "\$PREVIOUS_VERSION_ID" \|\| -z "\$PREVIOUS_RELEASE"/);
  assert.match(block,/100% traffic/);
});
