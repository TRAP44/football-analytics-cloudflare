import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activeProductionVersion, resolveActiveProductionReleaseIdentity, verifyProductionReleasePostcondition } from '../scripts/verify-production-release-postcondition.js';

const workflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const activeId = '11111111-2222-3333-4444-555555555555';
const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const release = '6.101.0-rc109';
const sha = 'd021ee7cce9afbd8077ce7e35124f10695c56491';

function deployment(versions) {
  return {
    id: '99999999-8888-7777-6666-555555555555',
    strategy: 'percentage',
    versions,
  };
}

function version(id, message, tag = sha) {
  return {
    id,
    annotations: { 'workers/message': message, 'workers/tag': tag },
    metadata: { created_on: '2026-09-24T11:47:00.000Z', source: 'wrangler' },
  };
}

test('RC120 accepts one active 100 percent version with exact release and commit identity', () => {
  const result = verifyProductionReleasePostcondition(
    deployment([{ version_id: activeId, percentage: 100 }]),
    [version(activeId, `release=${release} sha=${sha}`)],
    release,
    sha
  );
  assert.equal(result.versionId, activeId);
  assert.equal(result.release, release);
  assert.equal(result.sha, sha);
  assert.equal(result.timestamp, '2026-09-24T11:47:00.000Z');
});


test('Issue #409 rejects malformed Cloudflare version IDs in the control-plane verifier', () => {
  const malformedId='not-a-version-id';
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([{ version_id: malformedId, percentage: 100 }]),
      [version(malformedId, `release=${release} sha=${sha}`)],
      release,
      sha,
    ),
    /RELEASE_IDENTITY_CLOUDFLARE_VERSION_ID_INVALID/,
  );
});

test('Issue #409 rejects non-canonical and implausible future control-plane timestamps', () => {
  const nonCanonical={
    ...version(activeId, `release=${release} sha=${sha}`),
    metadata:{created_on:'0',source:'wrangler'},
  };
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [nonCanonical],
      release,
      sha,
    ),
    /RELEASE_IDENTITY_CLOUDFLARE_VERSION_TIMESTAMP_INVALID_FORMAT/,
  );

  const future={
    ...version(activeId, `release=${release} sha=${sha}`),
    metadata:{created_on:'2099-01-01T00:00:00.000Z',source:'wrangler'},
  };
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [future],
      release,
      sha,
    ),
    /RELEASE_IDENTITY_CLOUDFLARE_VERSION_TIMESTAMP_FUTURE_SKEW/,
  );
});

test('RC120 rejects a Cloudflare version tag that is not the deploy SHA', () => {
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [version(activeId, `release=${release} sha=${sha}`, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')],
      release,
      sha
    ),
    /version tag does not match deploy SHA/
  );
});

test('RC120 rejects split production traffic', () => {
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([
        { version_id: activeId, percentage: 90 },
        { version_id: otherId, percentage: 10 },
      ]),
      [version(activeId, `release=${release} sha=${sha}`)],
      release,
      sha
    ),
    /one version at 100% traffic/
  );
});

test('RC120 rejects an ambiguous versions list with duplicate active version IDs', () => {
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [
        version(activeId, `release=${release} sha=${sha}`),
        version(activeId, `release=${release} sha=${sha}`),
      ],
      release,
      sha
    ),
    /appears multiple times/
  );
});

test('RC120 rejects a mismatched or missing active version identity stamp', () => {
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [version(activeId, `release=6.100.0-rc108 sha=${sha}`)],
      release,
      sha
    ),
    /release identity mismatch/
  );
  assert.throws(
    () => verifyProductionReleasePostcondition(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [version(otherId, `release=${release} sha=${sha}`)],
      release,
      sha
    ),
    /missing from the recent Cloudflare versions list/
  );
});

test('RC120 control-plane identity verification runs after deploy and before HTTP smoke', () => {
  assert.match(workflow, /RC120 verify active production release identity/);
  assert.match(workflow, /npx wrangler deployments status --json > "\$DEPLOYMENT_STATUS_JSON"/);
  assert.match(workflow, /npx wrangler versions list --json > "\$VERSIONS_JSON"/);
  assert.match(
    workflow,
    /verify-production-release-postcondition\.js "\$DEPLOYMENT_STATUS_JSON" "\$VERSIONS_JSON" "\$RELEASE_VERSION" "\$DEPLOY_SHA"/
  );
  const deploy = workflow.indexOf('command: deploy --keep-vars');
  const postcondition = workflow.indexOf('- name: RC120 verify active production release identity');
  const smoke = workflow.indexOf('node scripts/post-deploy-smoke.js', postcondition);
  assert.ok(deploy >= 0);
  assert.ok(postcondition > deploy);
  assert.ok(smoke > postcondition);
});


test('RC120 exposes the active production release identity for cumulative runtime diff checks', () => {
  const result = resolveActiveProductionReleaseIdentity(
    deployment([{ version_id: activeId, percentage: 100 }]),
    [version(activeId, `release=${release} sha=${sha}`)],
  );
  assert.equal(result.versionId, activeId);
  assert.equal(result.release, release);
  assert.equal(result.sha, sha);

  assert.throws(
    () => resolveActiveProductionReleaseIdentity(
      deployment([{ version_id: activeId, percentage: 100 }]),
      [version(activeId, 'malformed-message')],
    ),
    /release identity mismatch/,
  );
});


test('Active production resolves from a pinned Cloudflare version view outside the recent ten', () => {
  const traffic = deployment([{ version_id: activeId, percentage: 100 }]);
  const exact = version(activeId, `release=${release} sha=${sha}`);
  assert.equal(activeProductionVersion(traffic), activeId);
  const result = verifyProductionReleasePostcondition(traffic, exact, release, sha);
  assert.equal(result.versionId, activeId);
  assert.equal(result.sha, sha);
  assert.throws(
    () => verifyProductionReleasePostcondition(traffic, version(otherId, `release=${release} sha=${sha}`), release, sha),
    /missing from the recent Cloudflare versions list/,
  );
  assert.throws(
    () => activeProductionVersion(deployment([
      { version_id: activeId, percentage: 80 },
      { version_id: otherId, percentage: 20 },
    ])),
    /one version at 100% traffic/,
  );
});

test('Production gate pins the active version and keeps rollback preflight mandatory', () => {
  const start = workflow.indexOf('- name: Detect pending production artifact changes');
  const end = workflow.indexOf('- name: Preflight previous-known-good rollback target');
  const detection = workflow.slice(start, end);
  assert.match(detection, /--print-active-version-id/);
  assert.match(detection, /wrangler versions view "\$ACTIVE_VERSION_ID" --json/);
  assert.doesNotMatch(detection, /wrangler versions list --json/);
  assert.match(detection, /--print-active-rollback-target/);
  assert.match(detection, /Safe production deployment blocked/);
});



test('RC120 fails closed for missing or inconsistent Cloudflare traffic allocations',()=>{
  for(const bad of [
    null,
    {},
    deployment([]),
    deployment([{version_id:activeId,percentage:'100'}]),
    deployment([{version_id:activeId,percentage:-1}]),
    deployment([{version_id:activeId,percentage:101}]),
    deployment([{version_id:activeId,percentage:99}]),
    deployment([{version_id:'',percentage:100}]),
  ]) {
    assert.throws(()=>activeProductionVersion(bad));
  }
  assert.equal(activeProductionVersion(deployment([
    {version_id:activeId,percentage:100},
    {version_id:otherId,percentage:0},
  ])),activeId);
});

test('RC120 rejects missing Cloudflare annotations and malformed release metadata',()=>{
  const traffic=deployment([{version_id:activeId,percentage:100}]);
  const good=version(activeId,'release='+release+' sha='+sha);
  for(const item of [
    {...good,annotations:{}},
    {...good,annotations:{'workers/message':'release='+release+' sha=invalid','workers/tag':sha}},
    {...good,annotations:{'workers/message':'release='+release+' sha='+sha,'workers/tag':''}},
    {...good,annotations:{'workers/message':'release='+release+' sha='+sha,'workers/tag':'not-a-sha'}},
    {...good,metadata:{created_on:'not-a-timestamp'}},
  ]) {
    assert.throws(()=>resolveActiveProductionReleaseIdentity(traffic,[item]));
  }
});

test('RC120 rejects wrong expected release and SHA before accepting the deployment',()=>{
  const traffic=deployment([{version_id:activeId,percentage:100}]);
  const versions=[version(activeId,'release='+release+' sha='+sha)];
  assert.throws(
    ()=>verifyProductionReleasePostcondition(traffic,versions,'bad-version',sha),
    /Expected production release has an invalid format/,
  );
  assert.throws(
    ()=>verifyProductionReleasePostcondition(traffic,versions,release,'bad-sha'),
    /Expected deploy SHA must be a 40-character/,
  );
  assert.throws(
    ()=>verifyProductionReleasePostcondition(traffic,versions,'6.102.0-rc110',sha),
    /release identity mismatch/,
  );
  assert.throws(
    ()=>verifyProductionReleasePostcondition(traffic,versions,release,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    /release identity mismatch/,
  );
});

test('RC120 rejects malformed or ambiguous active version detail collections',()=>{
  const traffic=deployment([{version_id:activeId,percentage:100}]);
  const current=version(activeId,'release='+release+' sha='+sha);
  for(const bad of [null,{},[null],['bad-detail'],[current,current]]) {
    assert.throws(()=>resolveActiveProductionReleaseIdentity(traffic,bad));
  }
});



test('RC120 rejects arbitrarily small production traffic on a second active version',()=>{
  const tiny=1e-10;
  assert.throws(()=>activeProductionVersion(deployment([
    {version_id:activeId,percentage:100-tiny},
    {version_id:otherId,percentage:tiny},
  ])),/one version at 100% traffic|total 100%/);
  assert.throws(()=>activeProductionVersion(deployment([{version_id:activeId,percentage:100-1e-10}])),/total 100%/);
});

test('RC120 rejects duplicate and invalid Cloudflare version IDs even on zero-traffic rows',()=>{
  for(const versions of [
    [{version_id:activeId,percentage:100},{version_id:activeId,percentage:0}],
    [{version_id:activeId,percentage:100},{version_id:activeId.toUpperCase(),percentage:0}],
    [{version_id:activeId,percentage:100},{version_id:'not-a-uuid',percentage:0}],
    [{version_id:{toString:()=>activeId},percentage:100}],
  ]) assert.throws(()=>activeProductionVersion(deployment(versions)),/duplicate version IDs|invalid version_id/);
  assert.equal(activeProductionVersion(deployment([{version_id:activeId,percentage:100}])),activeId);
});

test('RC120 rejects annotation objects that impersonate a valid release message or SHA tag',()=>{
  const message='release='+release+' sha='+sha;
  const traffic=deployment([{version_id:activeId,percentage:100}]);
  for(const annotations of [
    {'workers/message':{toString:()=>message},'workers/tag':sha},
    {'workers/message':message,'workers/tag':{toString:()=>sha}},
  ]) assert.throws(()=>resolveActiveProductionReleaseIdentity(traffic,[{
    ...version(activeId,message),annotations,
  }]),/release identity mismatch|version tag does not match deploy SHA/);
});

test('RC120 refuses coerced expected release and SHA inputs before validating active production',()=>{
  const traffic=deployment([{version_id:activeId,percentage:100}]);
  const versions=[version(activeId,'release='+release+' sha='+sha)];
  for(const expected of [
    {release:{toString:()=>release},sha},
    {release,sha:{toString:()=>sha}},
    {release:[release],sha},
    {release,sha:[sha]},
  ]) assert.throws(()=>verifyProductionReleasePostcondition(traffic,versions,expected.release,expected.sha),
    /invalid format|40-character Git commit SHA/);
});
