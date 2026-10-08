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
