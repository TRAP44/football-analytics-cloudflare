import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');

test('RC110 blocks stale runtime drift but permits test-only main drift',()=>{
  assert.match(workflow,/fetch-depth: 0/);
  assert.match(workflow,/RC110 guard against stale production deploy/);
  assert.match(workflow,/git fetch --no-tags origin main/);
  assert.match(workflow,/CURRENT_MAIN_SHA="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow,/\[\[ "\$DEPLOY_SHA" != "\$CURRENT_MAIN_SHA" \]\]/);
  assert.match(workflow,/git merge-base --is-ancestor "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/git diff --name-only "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/Test-only main drift accepted/);
  assert.match(workflow,/production-relevant changes/);
  assert.match(workflow,/Stale production deploy blocked/);
  assert.match(workflow,/exit 1/);
});

test('RC110 keeps serialized production deployment and verified SHA checkout',()=>{
  assert.match(workflow,/group: cloudflare-production/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/ref: \$\{\{ env\.DEPLOY_SHA \}\}/);
  assert.match(workflow,/Deploy SHA matches current main/);
});
