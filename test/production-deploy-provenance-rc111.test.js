import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');

test('RC111 verifies the checked-out revision is exactly DEPLOY_SHA',()=>{
  assert.match(workflow,/RC111 verify deployment provenance/);
  assert.match(workflow,/VERIFIED_SHA="\$\(git rev-parse HEAD\)"/);
  assert.match(workflow,/\[\[ "\$DEPLOY_SHA" != "\$VERIFIED_SHA" \]\]/);
  assert.match(workflow,/Production provenance check failed/);
  assert.match(workflow,/does not match checked-out revision/);
});

test('RC111 retains the current-main race guard before deploy',()=>{
  assert.match(workflow,/CURRENT_MAIN_SHA="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow,/\[\[ "\$DEPLOY_SHA" != "\$CURRENT_MAIN_SHA" \]\]/);
  assert.match(workflow,/Stale production deploy blocked/);
  assert.match(workflow,/Checked-out SHA and current main both match deploy SHA/);
});


test('RC111 deploys a verified merged-PR snapshot even when newer runtime main changes are pending',()=>{
  assert.match(workflow,/git merge-base --is-ancestor "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/git diff --name-only "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/test\/\*\|docs\/\*\|\*\.md/);
  assert.match(workflow,/Verified release snapshot accepted/);
  assert.match(workflow,/newer unverified production-relevant main changes remain pending/);
  assert.match(workflow,/UNSAFE_MAIN_DRIFT/);
});

test('RC111 keeps manual production deploy pinned to current main when runtime drift exists',()=>{
  assert.match(workflow,/GITHUB_EVENT_NAME.*workflow_dispatch/);
  assert.match(workflow,/Manual deploy requires current main when production-relevant drift exists/);
  assert.match(workflow,/Stale production deploy blocked/);
});


test('production deploy requires merged-PR provenance for the exact deploy SHA',()=>{
  assert.match(workflow,/verify-main-pr-provenance\.js "\$GITHUB_REPOSITORY" "\$DEPLOY_SHA" main/);
  assert.match(workflow,/P1 gate: require merged PR provenance for production deploy/);
});


test('current release snapshot remains explicitly PR-gated',()=>{
  assert.match(workflow,/P1 gate: require merged PR provenance for production deploy/);
  assert.match(workflow,/verify-main-pr-provenance\.js "\$GITHUB_REPOSITORY" "\$DEPLOY_SHA" main/);
});
