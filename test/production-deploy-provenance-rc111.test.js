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
