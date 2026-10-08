import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  RELEASE_IDENTITY_CODES,
  cloudflareVersionIdValid,
  runtimeReleaseIdentity,
  validateReleaseIdentity,
  releaseIdentityComplete,
} from '../src/release-identity.js';

const workflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const verifier = fs.readFileSync('scripts/verify-release.js', 'utf8');

test('RC116 defines one production release identity for deployment and smoke', () => {
  assert.match(workflow, /RELEASE_VERSION: "6\.120\.0-rc144"/);
  assert.match(
    workflow,
    /command: deploy --keep-vars --tag "\$\{\{ env\.DEPLOY_SHA \}\}" --message "release=\$\{\{ env\.RELEASE_VERSION \}\} sha=\$\{\{ env\.DEPLOY_SHA \}\}"/
  );
  assert.match(workflow, /EXPECTED_RUNTIME_SHA="\$DEPLOY_SHA"/);
  assert.match(workflow, /EXPECTED_RUNTIME_SHA="\$ACTIVE_RUNTIME_SHA"/);
  assert.match(
    workflow,
    /post-deploy-smoke\.js "\$SMOKE_URL" "\$RELEASE_VERSION" "\$EXPECTED_RUNTIME_SHA"/
  );
});

test('RC116 Cloudflare version metadata is machine-readable and commit-bound', () => {
  const deployCommand = workflow.match(/command: deploy[^\n]+/)?.[0] || '';
  assert.match(deployCommand, /release=\$\{\{ env\.RELEASE_VERSION \}\}/);
  assert.match(deployCommand, /sha=\$\{\{ env\.DEPLOY_SHA \}\}/);
  assert.match(deployCommand, /--tag "\$\{\{ env\.DEPLOY_SHA \}\}"/);
  assert.doesNotMatch(deployCommand, /--message "RC109 /);
});

test('RC116 release verifier locks the identity contract', () => {
  assert.match(verifier, /Production deploy must pin the verified release-contract runtime version/);
  assert.match(verifier, /Production deploy message must bind release version and deploy SHA/);
  assert.match(verifier, /Production smoke must verify the same release identity used for deployment/);
});



test('RC116 production release version matches package and release contract',()=>{
  const contract=JSON.parse(fs.readFileSync('release-contract.json','utf8'));
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  assert.equal(contract.applicationVersion,pkg.version);
  assert.equal(contract.runtimeVersion.split('-rc')[0],pkg.version);
  assert.match(contract.runtimeVersion,/^\d+\.\d+\.\d+-rc\d+$/);
  assert.ok(workflow.includes('RELEASE_VERSION: "'+contract.runtimeVersion+'"'));
});

test('RC116 post-deploy verification binds both the active SHA and Cloudflare version ID',()=>{
  assert.match(workflow,/ACTIVE_RUNTIME_VERSION_ID: \$\{\{ steps\.production_changes\.outputs\.previous_version_id \}\}/);
  assert.match(workflow,/VERIFIED_VERSION_ID: \$\{\{ steps\.release_identity\.outputs\.active_version_id \}\}/);
  assert.match(workflow,/EXPECTED_RUNTIME_SHA="\$DEPLOY_SHA"\s+EXPECTED_VERSION_ID="\$VERIFIED_VERSION_ID"/);
  assert.match(workflow,/EXPECTED_RUNTIME_SHA="\$ACTIVE_RUNTIME_SHA"\s+EXPECTED_VERSION_ID="\$ACTIVE_RUNTIME_VERSION_ID"/);
  assert.match(workflow,/post-deploy-smoke\.js "\$SMOKE_URL" "\$RELEASE_VERSION" "\$EXPECTED_RUNTIME_SHA" "\$EXPECTED_VERSION_ID"/);
  assert.match(workflow,/if \[\[ ! "\$EXPECTED_VERSION_ID" =~ \^\[0-9a-fA-F-\]\{36\}\$ \]\]; then/);
});

test('RC116 release control-plane verification precedes runtime acceptance',()=>{
  assert.match(workflow,/node scripts\/verify-production-release-postcondition\.js "\$DEPLOYMENT_STATUS_JSON" "\$VERSIONS_JSON" "\$RELEASE_VERSION" "\$DEPLOY_SHA"/);
  assert.match(workflow,/if \[\[ "\$verified" != "true" \]\]; then[\s\S]*Cloudflare did not confirm the expected production release identity/);
  assert.match(workflow,/echo "active_version_id=\$ACTIVE_VERSION_ID" >> "\$GITHUB_OUTPUT"/);
  assert.ok(workflow.indexOf('RC120 verify active production release identity')
    < workflow.indexOf('Verify production deployment'));
});

test('RC116 recovery candidate is immutably bound to the same release identity',()=>{
  assert.match(workflow,/npx wrangler versions upload --keep-vars --preview-alias "\$RECOVERY_ALIAS" --tag "\$DEPLOY_SHA" --message "release=\$RELEASE_VERSION sha=\$DEPLOY_SHA"/);
  assert.match(workflow,/post-deploy-smoke\.js "\$RECOVERY_URL" "\$RELEASE_VERSION" "\$DEPLOY_SHA" "\$RECOVERY_VERSION_ID"/);
});



test('RC116 release identity accepts a complete immutable Cloudflare stamp',()=>{
  const sha='a'.repeat(40);
  const versionId='11111111-2222-4333-8444-555555555555';
  const input={
    appVersion:'6.120.0-rc144',releaseCandidate:'RC144',deploySha:sha,
    cloudflareVersionId:versionId,cloudflareVersionTag:sha,
    cloudflareVersionTimestamp:'2026-10-07T18:00:00.000Z',
  };
  const actual=validateReleaseIdentity(input,{nowMs:Date.parse('2026-10-08T11:00:00Z')});
  assert.equal(actual.ok,true);
  assert.equal(actual.code,RELEASE_IDENTITY_CODES.VALID);
  assert.equal(cloudflareVersionIdValid(versionId),true);
  assert.equal(releaseIdentityComplete(input,{nowMs:Date.parse('2026-10-08T11:00:00Z')}),true);
});

test('RC116 release identity rejects inconsistent release candidate, SHA and Cloudflare ID',()=>{
  const sha='a'.repeat(40);
  const base={
    appVersion:'6.120.0-rc144',releaseCandidate:'RC144',deploySha:sha,
    cloudflareVersionId:'11111111-2222-4333-8444-555555555555',
    cloudflareVersionTag:sha,cloudflareVersionTimestamp:'2026-10-07T18:00:00Z',
  };
  const code=patch=>validateReleaseIdentity({...base,...patch}).code;
  assert.equal(code({releaseCandidate:'RC143'}),RELEASE_IDENTITY_CODES.RELEASE_CANDIDATE_MISMATCH);
  assert.equal(code({deploySha:'bad'}),RELEASE_IDENTITY_CODES.DEPLOY_SHA_INVALID);
  assert.equal(code({cloudflareVersionTag:'b'.repeat(40)}),RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TAG_MISMATCH);
  assert.equal(code({cloudflareVersionId:'not-a-uuid'}),RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_ID_INVALID);
});

test('RC116 rejects impossible, too old and future-dated Cloudflare timestamps',()=>{
  const base={
    appVersion:'6.120.0-rc144',releaseCandidate:'RC144',deploySha:'a'.repeat(40),
    cloudflareVersionId:'11111111-2222-4333-8444-555555555555',
    cloudflareVersionTag:'a'.repeat(40),
  };
  const options={nowMs:Date.parse('2026-10-08T11:00:00Z')};
  const code=timestamp=>validateReleaseIdentity({
    ...base,cloudflareVersionTimestamp:timestamp,
  },options).code;
  for(const invalid of ['2026-02-30T10:00:00Z','not-a-date','2026-10-08T11:00:00+03:00']){
    assert.equal(code(invalid),RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_INVALID_FORMAT);
  }
  assert.equal(code('2019-01-01T00:00:00Z'),RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_BEFORE_MINIMUM);
  assert.equal(code('2026-10-09T11:00:00Z'),RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_FUTURE_SKEW);
});

test('RC116 release identity rejects coercive fake metadata objects and builds a canonical runtime identity',()=>{
  const sha='a'.repeat(40);
  const stamp={
    id:'11111111-2222-4333-8444-555555555555',
    tag:sha,
    timestamp:'2026-10-07T18:00:00Z',
  };
  const base=runtimeReleaseIdentity(stamp,{
    appVersion:'6.120.0-rc144',releaseCandidate:'RC144',
  });
  assert.equal(validateReleaseIdentity(base).ok,true);
  for(const key of ['id','tag','timestamp']){
    const forged={...stamp,[key]:{toString:()=>stamp[key]}};
    const result=runtimeReleaseIdentity(forged,{
      appVersion:'6.120.0-rc144',releaseCandidate:'RC144',
    });
    assert.equal(validateReleaseIdentity(result).ok,false,key);
  }
});
