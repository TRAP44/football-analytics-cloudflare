import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyRollbackTarget } from '../scripts/verify-rollback-target.js';

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
  assert.match(workflow, /if: \$\{\{ inputs\.confirm == /);
  assert.match(workflow, /group: cloudflare-production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /Rollback preflight/);
  assert.match(workflow, /scripts\/rollback-smoke\.js/);
});



test('RC113 validates current main before installing dependencies or contacting Cloudflare',()=>{
  const checkout=workflow.indexOf('- name: Checkout verified rollback workflow revision');
  const provenance=workflow.indexOf('- name: RC113 verify rollback workflow provenance');
  const install=workflow.indexOf('- name: Install pinned dependencies');
  const preflight=workflow.indexOf('- name: Rollback preflight');
  const mutation=workflow.indexOf('- name: Roll back Worker');
  assert.ok(checkout>=0 && provenance>checkout && install>provenance && preflight>install && mutation>preflight);
  const guard=workflow.slice(provenance,install);
  assert.match(guard,/GITHUB_REF.*refs\/heads\/main/);
  assert.match(guard,/ROLLBACK_WORKFLOW_SHA.*VERIFIED_SHA/);
  assert.match(guard,/ROLLBACK_WORKFLOW_SHA.*CURRENT_MAIN_SHA/);
  assert.match(guard,/Stale rollback workflow blocked[\s\S]*exit 1/);
});

test('RC113 retains an immutable checkout with no persisted repository credentials',()=>{
  const section=workflow.slice(
    workflow.indexOf('- name: Checkout verified rollback workflow revision'),
    workflow.indexOf('- name: RC113 verify rollback workflow provenance'),
  );
  assert.match(section,/ref: \$\{\{ env\.ROLLBACK_WORKFLOW_SHA \}\}/);
  assert.match(section,/fetch-depth: 0/);
  assert.match(section,/persist-credentials: false/);
  assert.doesNotMatch(section,/ref: main/);
});

test('RC113 rollback target identity must be checked before mutation and again after cutover',()=>{
  const confirmation=workflow.indexOf('RC114 rollback target confirmation verified');
  const target=workflow.indexOf('- name: RC115 verify rollback target exists');
  const stamp=workflow.indexOf('- name: RC117 verify rollback release identity');
  const rollback=workflow.indexOf('- name: Roll back Worker');
  const post=workflow.indexOf('- name: RC119 verify exact rollback deployment target');
  const smoke=workflow.indexOf('- name: Verify restored production');
  assert.ok(confirmation>=0 && target>confirmation && stamp>target && rollback>stamp && post>rollback && smoke>post);
  const after=workflow.slice(post,smoke);
  assert.match(after,/verify-rollback-deployment\.js "\$DEPLOYMENT_STATUS_JSON" "\$VERSION_ID"/);
  assert.match(after,/verify-rollback-target\.js "\$ROLLBACK_VERSION_JSON" "\$EXPECTED_VERSION" "\$VERSION_ID"/);
  assert.match(after,/if \[\[ "\$verified" != "true" \]\]; then[\s\S]*exit 1/);
});

test('RC113 destructive rollback remains serialized and requires exact-target operator approval',()=>{
  assert.match(workflow,/group: cloudflare-production\s+cancel-in-progress: false/);
  assert.match(workflow,/environment: production/);
  assert.match(workflow,/if: \$\{\{ inputs\.confirm == format\('ROLLBACK:\{0\}:\{1\}', inputs\.expected_version, inputs\.version_id\) \}\}/);
  assert.match(workflow,/npx wrangler rollback "\$VERSION_ID" --yes --message/);
  assert.doesNotMatch(workflow,/pull_request:\s*/);
});



test('RC113 rollback target validates version UUIDs independently of letter case',()=>{
  const candidate={
    id:'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
    annotations:{
      'workers/message':'release=6.120.0-rc144 sha='+'a'.repeat(40),
      'workers/tag':'a'.repeat(40),
    },
    metadata:{created_on:'2026-10-07T18:00:00Z'},
  };
  const result=verifyRollbackTarget(
    candidate,'6.120.0-rc144',candidate.id.toLowerCase(),false,'','a'.repeat(40));
  assert.equal(result.mode,'stamped');
  assert.equal(result.deploySha,'a'.repeat(40));
});

test('RC113 rollback metadata refuses same-shape but different Cloudflare target identity',()=>{
  const candidate={
    id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    annotations:{
      'workers/message':'release=6.120.0-rc144 sha='+'a'.repeat(40),
      'workers/tag':'a'.repeat(40),
    },
    metadata:{created_on:'2026-10-07T18:00:00Z'},
  };
  assert.throws(()=>verifyRollbackTarget(
    candidate,'6.120.0-rc144','bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  ),/instead of requested/);
});

test('RC113 rollback protects against forged annotations even with exact target ID',()=>{
  const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const stamp='release=6.120.0-rc144 sha='+'a'.repeat(40);
  for(const annotations of [
    {'workers/message':{toString:()=>stamp},'workers/tag':'a'.repeat(40)},
    {'workers/message':stamp,'workers/tag':{toString:()=> 'a'.repeat(40)}},
  ]){
    assert.throws(()=>verifyRollbackTarget({
      id,annotations,metadata:{created_on:'2026-10-07T18:00:00Z'},
    },'6.120.0-rc144',id),/no RC116 release identity metadata|validation failed/);
  }
});

test('RC113 ensures rollback must be checked on current main before mutation',()=>{
  const checkout=workflow.indexOf('- name: Checkout verified rollback workflow revision');
  const provenance=workflow.indexOf('- name: RC113 verify rollback workflow provenance');
  const preflight=workflow.indexOf('- name: Rollback preflight');
  const cutover=workflow.indexOf('- name: Roll back Worker');
  assert.ok(checkout>=0 && provenance>checkout && preflight>provenance && cutover>preflight);
  assert.match(workflow.slice(provenance,preflight),/\$ROLLBACK_WORKFLOW_SHA" != "\$CURRENT_MAIN_SHA"/);
});
