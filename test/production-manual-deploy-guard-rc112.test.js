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



test('RC112 routes manual production launches through the same immutable SHA checkout and production lock',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/group: cloudflare-production\s+cancel-in-progress: false/);
  assert.match(workflow,/environment: production/);
  assert.match(workflow,/DEPLOY_SHA: \$\{\{ github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
  assert.match(workflow,/ref: \$\{\{ env\.DEPLOY_SHA \}\}/);
  assert.match(workflow,/persist-credentials: false/);
});

test('RC112 rejects a manually selected stale SHA if production-relevant files changed',()=>{
  assert.match(workflow,/if \[\[ "\$DEPLOY_SHA" != "\$CURRENT_MAIN_SHA" \]\]; then/);
  assert.match(workflow,/git diff --name-only "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/if \(\( \$\{#UNSAFE_MAIN_DRIFT\[@\]\} > 0 \)\); then\s+if \[\[ "\$\{GITHUB_EVENT_NAME\}" == "workflow_dispatch" \]\]; then/);
  assert.match(workflow,/Manual deploy requires current main when production-relevant drift exists\.[\s\S]*exit 1/);
});

test('RC112 enforces release provenance before credentials, deployment and smoke checks',()=>{
  const gates=[
    'RC110 guard against stale production deploy',
    'P1 gate: verify production deploy provenance',
    'Install pinned dependencies',
    'Re-verify release artifact',
    'Check Cloudflare credentials',
    'Detect pending production artifact changes',
    'Verify production deployment',
  ];
  let previous=-1;
  for(const gate of gates) {
    const offset=workflow.indexOf(gate);
    assert.ok(offset>previous,'The manual production gate is missing or out of order: '+gate);
    previous=offset;
  }
  assert.match(workflow,/Production deploy blocked: \$DEPLOY_SHA has neither merged-PR provenance nor an exact successful Quality run/);
});

test('RC112 keeps mandatory quality and safety checks for manually dispatched deployments',()=>{
  for(const check of [
    'npm ci',
    'npm audit --audit-level=high',
    'npm run security:dependencies',
    'npm run security:scan',
    'npm run security:privileged',
    'npm run lint',
    'npm run check',
    'npm run test:release',
    'npm run verify:release',
    'npm run verify:worker',
  ]) {
    assert.ok(workflow.includes(check),'Missing manual-deploy release gate: '+check);
  }
  assert.match(workflow,/if \[\[ -z "\$CLOUDFLARE_API_TOKEN" \|\| -z "\$CLOUDFLARE_ACCOUNT_ID" \]\]; then[\s\S]*exit 1/);
});



test('RC112 manual dispatch strictly requires the exact current main SHA even for test-only drift',()=>{
  const start=workflow.indexOf('- name: RC110 guard against stale production deploy');
  const end=workflow.indexOf('- name: Use Node.js 22',start);
  assert.ok(start>=0 && end>start);
  const block=workflow.slice(start,end);
  assert.match(block,/if \[\[ "\$\{GITHUB_EVENT_NAME\}" == "workflow_dispatch" && "\$DEPLOY_SHA" != "\$CURRENT_MAIN_SHA" \]\]; then/);
  assert.match(block,/Manual deploy requires the exact current main SHA, including test\/docs drift/);
  const checkoutGuard=block.indexOf('[[ "$DEPLOY_SHA" != "$VERIFIED_SHA" ]]');
  const manualGuard=block.indexOf('[[ "\${GITHUB_EVENT_NAME}" == "workflow_dispatch" && "$DEPLOY_SHA" != "$CURRENT_MAIN_SHA" ]]');
  const diff=block.indexOf('git diff --name-only "$DEPLOY_SHA" "$CURRENT_MAIN_SHA"');
  assert.ok(checkoutGuard>=0 && manualGuard>checkoutGuard && diff>manualGuard);
  assert.match(block.slice(manualGuard,diff),/exit 1/);
});

test('RC112 retains the snapshot-drift allowance only for successful workflow-run provenance',()=>{
  const start=workflow.indexOf('- name: RC110 guard against stale production deploy');
  const end=workflow.indexOf('- name: Use Node.js 22',start);
  const block=workflow.slice(start,end);
  assert.match(block,/Test-only main drift accepted/);
  assert.match(block,/Verified release snapshot accepted/);
  assert.match(block,/if \[\[ "\$\{GITHUB_EVENT_NAME\}" == "workflow_dispatch" \]\]; then[\s\S]*Manual deploy requires current main when production-relevant drift exists/);
});

test('RC112 manually dispatched build must run all verification before Cloudflare credentials',()=>{
  const provenance=workflow.indexOf('P1 gate: verify production deploy provenance');
  const review=workflow.indexOf('- name: Re-verify release artifact');
  const credentials=workflow.indexOf('- name: Check Cloudflare credentials');
  const mutation=workflow.indexOf('- name: Deploy Worker');
  assert.ok(provenance>=0 && review>provenance && credentials>review && mutation>credentials);
  for(const name of ['npm run security:scan','npm run security:privileged','npm run test:release','npm run verify:release','npm run verify:worker']){
    assert.ok(workflow.slice(review,credentials).includes(name),name);
  }
});

test('RC112 denies stale checkout before generating any release artifacts or rollback targets',()=>{
  const guard=workflow.indexOf('Manual deploy requires the exact current main SHA, including test/docs drift');
  const build=workflow.indexOf('npm ci');
  const rollback=workflow.indexOf('- name: Preflight previous-known-good rollback target');
  const publish=workflow.indexOf('- name: Deploy Worker');
  assert.ok(guard>0 && build>guard && rollback>build && publish>rollback);
});
