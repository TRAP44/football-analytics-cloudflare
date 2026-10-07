import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('production release keeps merged-PR provenance gate enabled',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
  assert.match(workflow,/verify-main-pr-provenance\.js/);
  assert.match(workflow,/DEPLOY_SHA/);
});
