import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');

test('RC110 accepts verified release snapshots while keeping stale ancestry and manual guards',()=>{
  assert.match(workflow,/fetch-depth: 0/);
  assert.match(workflow,/RC110 guard against stale production deploy/);
  assert.match(workflow,/git fetch --no-tags origin main/);
  assert.match(workflow,/CURRENT_MAIN_SHA="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow,/\[\[ "\$DEPLOY_SHA" != "\$CURRENT_MAIN_SHA" \]\]/);
  assert.match(workflow,/git merge-base --is-ancestor "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/git diff --name-only "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/Test-only main drift accepted/);
  assert.match(workflow,/Verified release snapshot accepted/);
  assert.match(workflow,/newer unverified production-relevant main changes remain pending/);
  assert.match(workflow,/Manual deploy requires current main when production-relevant drift exists/);
  assert.match(workflow,/Stale production deploy blocked/);
  assert.match(workflow,/exit 1/);
});

test('RC110 keeps serialized production deployment and verified SHA checkout',()=>{
  assert.match(workflow,/group: cloudflare-production/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/ref: \$\{\{ env\.DEPLOY_SHA \}\}/);
  assert.match(workflow,/Deploy SHA matches current main/);
});



test('RC110 only accepts completed successful Quality workflow runs for automatic deploy',()=>{
  assert.match(workflow,/workflow_run:\s+workflows: \[Quality\]\s+types: \[completed\]\s+branches: \[main\]/);
  assert.match(workflow,/github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow,/DEPLOY_SHA: \$\{\{ github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
  assert.match(workflow,/ref: \$\{\{ env\.DEPLOY_SHA \}\}/);
  assert.match(workflow,/persist-credentials: false/);
});

test('RC110 blocks stale SHA when it is outside current main ancestry',()=>{
  assert.match(workflow,/if ! git merge-base --is-ancestor "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"; then\s+echo "### Stale production deploy blocked"/);
  assert.match(workflow,/Verified revision \$DEPLOY_SHA is not an ancestor of current main/);
  assert.match(workflow,/git fetch --no-tags origin main/);
});

test('RC110 compares entire SHA drift and recognizes only explicitly safe test/docs changes',()=>{
  assert.match(workflow,/mapfile -t MAIN_DRIFT_FILES < <\(git diff --name-only "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"\)/);
  assert.match(workflow,/test\/\*\|docs\/\*\|\*\.md\|\.github\/workflows\/cleanup-merged-branches\.yml\|\.github\/workflows\/repository-maintenance\.yml/);
  assert.match(workflow,/UNSAFE_MAIN_DRIFT\+=\("\$path"\)/);
  assert.match(workflow,/if \(\( \$\{#UNSAFE_MAIN_DRIFT\[@\]\} > 0 \)\); then/);
  assert.match(workflow,/Test-only main drift accepted/);
});

test('RC110 allows verified workflow snapshots with pending changes, but rejects stale manual deployments',()=>{
  assert.match(workflow,/if \[\[ "\$\{GITHUB_EVENT_NAME\}" == "workflow_dispatch" \]\]; then[\s\S]*Manual deploy requires current main when production-relevant drift exists/);
  assert.match(workflow,/Manual deploy requires current main when production-relevant drift exists\.[\s\S]*exit 1/);
  assert.match(workflow,/Verified release snapshot accepted/);
  assert.match(workflow,/Deploying merged-PR revision \$DEPLOY_SHA while newer unverified production-relevant main changes remain pending/);
});

test('RC110 serializes production changes without cancelling already queued deployments',()=>{
  assert.match(workflow,/concurrency:\s+group: cloudflare-production\s+cancel-in-progress: false/);
  assert.match(workflow,/environment: production/);
  assert.match(workflow,/id: production_changes/);
  assert.match(workflow,/if: steps\.production_changes\.outputs\.changed == 'true'/);
});
