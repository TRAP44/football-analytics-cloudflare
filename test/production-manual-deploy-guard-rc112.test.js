import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');

test('RC112 explicitly guards manual production deployment',()=>{
  assert.match(workflow,/RC112 manual production deploy guard/);
  assert.match(workflow,/GITHUB_EVENT_NAME/);
  assert.match(workflow,/workflow_dispatch/);
  assert.match(workflow,/Manual deploy is allowed only for the current main revision/);
  assert.match(workflow,/manual deploy target confirmed as current main/);
});

test('RC112 manual path retains provenance and current-main checks',()=>{
  assert.match(workflow,/DEPLOY_SHA/);
  assert.match(workflow,/VERIFIED_SHA/);
  assert.match(workflow,/CURRENT_MAIN_SHA/);
  assert.match(workflow,/\[\[ "\$DEPLOY_SHA" != "\$VERIFIED_SHA" \]\]/);
  assert.match(workflow,/\[\[ "\$DEPLOY_SHA" != "\$CURRENT_MAIN_SHA" \]\]/);
  assert.match(workflow,/npm run verify:release/);
  assert.match(workflow,/post-deploy-smoke\.js/);
});
