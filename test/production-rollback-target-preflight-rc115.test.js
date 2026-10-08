import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyRollbackTarget } from '../scripts/verify-rollback-target.js';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');

test('RC115 verifies the Cloudflare rollback target before mutation', () => {
  assert.match(workflow, /RC115 verify rollback target exists/);
  assert.match(workflow, /npx wrangler versions view "\$VERSION_ID" --json > "\$RUNNER_TEMP\/rollback-version\.json"/);
  assert.match(workflow, /RC115 rollback target preflight passed/);
  assert.match(workflow, /Cloudflare resolved rollback target version ID \$VERSION_ID before any rollback mutation/);
});

test('RC115 target lookup runs after local preflight and before destructive rollback', () => {
  const localPreflight = workflow.indexOf('- name: Rollback preflight');
  const targetPreflight = workflow.indexOf('- name: RC115 verify rollback target exists');
  const rollback = workflow.indexOf('npx wrangler rollback "$VERSION_ID" --yes');
  assert.ok(localPreflight >= 0);
  assert.ok(targetPreflight > localPreflight);
  assert.ok(rollback > targetPreflight);
});

test('RC115 preserves target-bound confirmation, provenance and post-rollback smoke', () => {
  assert.match(workflow, /inputs\.confirm == format\('ROLLBACK:\{0\}:\{1\}', inputs\.expected_version, inputs\.version_id\)/);
  assert.match(workflow, /RC113 verify rollback workflow provenance/);
  assert.match(workflow, /scripts\/rollback-smoke\.js "\$ROLLBACK_URL" "\$EXPECTED_VERSION"/);
});



const rc115VersionId='11111111-2222-4333-8444-555555555555';
const rc115Sha='a'.repeat(40);
const rc115Release='6.120.0-rc144';
function rc115Stamped(overrides={}) {
  return {
    id:rc115VersionId,
    annotations:{
      'workers/message':'release='+rc115Release+' sha='+rc115Sha,
      'workers/tag':rc115Sha,
    },
    metadata:{created_on:'2026-10-07T18:00:00.000Z'},
    ...overrides,
  };
}

test('RC115 rejects release and tag objects impersonating a valid rollback stamp',()=>{
  assert.throws(
    ()=>verifyRollbackTarget(rc115Stamped(),{toString:()=>rc115Release},rc115VersionId),
    /Expected rollback release/,
  );
  const stamp=rc115Stamped();
  stamp.annotations['workers/tag']={toString:()=>rc115Sha};
  assert.throws(
    ()=>verifyRollbackTarget(stamp,rc115Release,rc115VersionId),
    /CLOUDFLARE_VERSION_TAG_REQUIRED/,
  );
  assert.throws(
    ()=>verifyRollbackTarget(rc115Stamped(),rc115Release,rc115VersionId,false,'',{toString:()=>rc115Sha}),
    /40-character Git commit SHA/,
  );
});

test('RC115 legacy override cannot be enabled by object coercion',()=>{
  const legacy=rc115Stamped({annotations:{}});
  const confirmation='LEGACY-UNVERIFIED:'+rc115Release+':'+rc115VersionId;
  assert.throws(
    ()=>verifyRollbackTarget(legacy,rc115Release,rc115VersionId,{toString:()=>'true'},confirmation),
    /no RC116 release identity metadata/,
  );
  assert.equal(verifyRollbackTarget(legacy,rc115Release,rc115VersionId,'true',confirmation).mode,'legacy-unverified');
  assert.throws(
    ()=>verifyRollbackTarget(legacy,rc115Release,rc115VersionId,true,'wrong'),
    /exact confirmation/,
  );
});

test('RC115 verified stamped target enforces exact version, SHA and cloudflare ID',()=>{
  const good=verifyRollbackTarget(rc115Stamped(),rc115Release,rc115VersionId,false,'',rc115Sha);
  assert.equal(good.mode,'stamped');
  assert.equal(good.releaseVersion,rc115Release);
  assert.equal(good.deploySha,rc115Sha);
  assert.throws(
    ()=>verifyRollbackTarget(rc115Stamped(),rc115Release,rc115VersionId,false,'','b'.repeat(40)),
    /deploy SHA mismatch/,
  );
  assert.throws(
    ()=>verifyRollbackTarget(rc115Stamped(),rc115Release,'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    /instead of requested/,
  );
});

test('RC115 requires successful version view and validated identity before destructive rollback',()=>{
  const verify=workflow.slice(workflow.indexOf('- name: RC115 verify rollback target exists'),
    workflow.indexOf('- name: Roll back Worker'));
  assert.match(verify,/set -euo pipefail/);
  assert.match(verify,/npx wrangler versions view "\$VERSION_ID" --json > "\$RUNNER_TEMP\/rollback-version\.json"/);
  assert.match(verify,/node scripts\/verify-rollback-target\.js "\$RUNNER_TEMP\/rollback-version\.json"/);
  assert.doesNotMatch(verify,/npx wrangler rollback/);
  const post=workflow.slice(workflow.indexOf('- name: RC119 verify exact rollback deployment target'));
  assert.match(post,/verify-rollback-target\.js "\$ROLLBACK_VERSION_JSON"/);
});



test('RC115 rejects no-op target lookup errors before any rollback mutation',()=>{
  const workflowPart=workflow.slice(
    workflow.indexOf('- name: RC115 verify rollback target exists'),
    workflow.indexOf('- name: Roll back Worker'),
  );
  assert.match(workflowPart,/set -euo pipefail/);
  assert.match(workflowPart,/npx wrangler versions view "\$VERSION_ID" --json/);
  assert.match(workflowPart,/node scripts\/verify-rollback-target\.js/);
  assert.doesNotMatch(workflowPart,/npx wrangler rollback/);
});

test('RC115 stamped rollback target denies stale or impossible timestamps',()=>{
  for(const stamp of [
    {created_on:'2018-01-01T00:00:00Z'},
    {created_on:'2099-01-01T00:00:00Z'},
    {created_on:'invalid'},
  ]){
    assert.throws(
      ()=>verifyRollbackTarget(rc115Stamped({metadata:stamp}),rc115Release,rc115VersionId),
      /validation failed/,
    );
  }
});

test('RC115 refuses ambiguous metadata even with an explicit legacy override',()=>{
  const stamp=rc115Stamped();
  const invalid={...stamp,annotations:{...stamp.annotations,'workers/tag':'b'.repeat(40)}};
  const confirmation='LEGACY-UNVERIFIED:'+rc115Release+':'+rc115VersionId;
  assert.throws(
    ()=>verifyRollbackTarget(invalid,rc115Release,rc115VersionId,true,confirmation),
    /CLOUDFLARE_VERSION_TAG_MISMATCH/,
  );
});

test('RC115 requires exact release and immutable deploy SHA on stamped rollback target',()=>{
  const stamp=rc115Stamped();
  assert.equal(verifyRollbackTarget(stamp,rc115Release,rc115VersionId,false,'',rc115Sha).mode,'stamped');
  assert.throws(
    ()=>verifyRollbackTarget(stamp,'6.119.0-rc143',rc115VersionId,false,'',rc115Sha),
    /release identity mismatch/,
  );
  assert.throws(
    ()=>verifyRollbackTarget(stamp,rc115Release,rc115VersionId,false,'','b'.repeat(40)),
    /deploy SHA mismatch/,
  );
});
