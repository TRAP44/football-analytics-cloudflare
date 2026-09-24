import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');

test('RC113 rollback pins workflow execution to the dispatch SHA on main', () => {
  assert.match(workflow, /ROLLBACK_WORKFLOW_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /ref: \$\{\{ env\.ROLLBACK_WORKFLOW_SHA \}\}/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /RC113 verify rollback workflow provenance/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /Rollback must be dispatched from main/);
});

test('RC113 rollback fails closed when checked out or current main provenance drifts', () => {
  assert.match(workflow, /git fetch --no-tags origin main/);
  assert.match(workflow, /CURRENT_MAIN_SHA="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /VERIFIED_SHA="\$\(git rev-parse HEAD\)"/);
  assert.match(workflow, /\[\[ "\$ROLLBACK_WORKFLOW_SHA" != "\$VERIFIED_SHA" \]\]/);
  assert.match(workflow, /\[\[ "\$ROLLBACK_WORKFLOW_SHA" != "\$CURRENT_MAIN_SHA" \]\]/);
  assert.match(workflow, /Stale rollback workflow blocked/);
  assert.match(workflow, /Re-dispatch rollback from the current main revision/);
});

test('RC113 preserves explicit rollback confirmation and existing production safety gates', () => {
  assert.match(workflow, /if: inputs\.confirm == 'ROLLBACK'/);
  assert.match(workflow, /group: cloudflare-production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /Rollback preflight/);
  assert.match(workflow, /scripts\/rollback-smoke\.js/);
});
