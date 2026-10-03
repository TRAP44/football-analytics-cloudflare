import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELEASE_IDENTITY_CODES,
  releaseIdentityComplete,
  runtimeReleaseIdentity,
  validateReleaseIdentity,
} from '../src/release-identity.js';

const sha='df5bd3bdf56bb84a8a38b9ef8bb65236f7cd11be';
const versionId='4894ec8e-25b5-4be3-b85a-44773b6e78e9';
const timestamp='2026-09-29T12:36:17.000Z';

function validIdentity(overrides = {}) {
  return {
    appVersion:'6.120.0-rc144',
    releaseCandidate:'RC144',
    deploySha:sha,
    cloudflareVersionId:versionId,
    cloudflareVersionTag:sha,
    cloudflareVersionTimestamp:timestamp,
    ...overrides,
  };
}

test('runtime release identity binds Cloudflare version metadata to git SHA tag',()=>{
  const identity=runtimeReleaseIdentity({
    id:versionId,
    tag:sha,
    timestamp,
  },{appVersion:'6.120.0-rc144',releaseCandidate:'RC144'});

  assert.deepEqual(identity,validIdentity());
  assert.equal(releaseIdentityComplete(identity),true);
  assert.deepEqual(validateReleaseIdentity(identity),{
    ok:true,
    code:RELEASE_IDENTITY_CODES.VALID,
    field:null,
    timestampMs:Date.parse(timestamp),
  });
});

test('runtime release identity does not invent deploy SHA from a non-SHA tag',()=>{
  const identity=runtimeReleaseIdentity({
    id:'version-id',
    tag:'manual-test',
    timestamp:'not-a-date',
  },{appVersion:'6.120.0-rc144',releaseCandidate:'RC144'});
  assert.equal(identity.deploySha,null);
  assert.equal(identity.cloudflareVersionTag,'manual-test');
  assert.equal(identity.cloudflareVersionTimestamp,null);
  assert.equal(releaseIdentityComplete(identity),false);
});

test('runtime release identity safely represents missing local version metadata',()=>{
  const identity=runtimeReleaseIdentity(null,{appVersion:'6.120.0-rc144',releaseCandidate:'RC144'});
  assert.equal(identity.appVersion,'6.120.0-rc144');
  assert.equal(identity.releaseCandidate,'RC144');
  assert.equal(identity.deploySha,null);
  assert.equal(identity.cloudflareVersionId,null);
  assert.equal(releaseIdentityComplete(identity),false);
});

test('Issue #409 rejects non-canonical timestamp shortcuts instead of normalizing Date.parse input',()=>{
  for(const shortcut of ['0','2026-09-29','09/29/2026 12:36:17']){
    const identity=runtimeReleaseIdentity({
      id:versionId,
      tag:sha,
      timestamp:shortcut,
    },{appVersion:'6.120.0-rc144',releaseCandidate:'RC144'});
    assert.equal(identity.cloudflareVersionTimestamp,null,shortcut);
    assert.equal(releaseIdentityComplete(identity),false,shortcut);
  }

  const validation=validateReleaseIdentity(validIdentity({cloudflareVersionTimestamp:'0'}),{
    nowMs:Date.parse('2026-09-29T12:40:00.000Z'),
  });
  assert.equal(validation.ok,false);
  assert.equal(validation.code,RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_INVALID_FORMAT);
});

test('Issue #409 rejects canonical timestamps beyond the allowed future skew',()=>{
  const validation=validateReleaseIdentity(validIdentity({
    cloudflareVersionTimestamp:'2099-01-01T00:00:00.000Z',
  }),{
    nowMs:Date.parse('2026-09-29T12:40:00.000Z'),
    maxFutureSkewMs:10*60_000,
  });
  assert.equal(validation.ok,false);
  assert.equal(validation.code,RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_FUTURE_SKEW);
  assert.equal(releaseIdentityComplete(validIdentity({
    cloudflareVersionTimestamp:'2099-01-01T00:00:00.000Z',
  }),{
    nowMs:Date.parse('2026-09-29T12:40:00.000Z'),
  }),false);
});

test('Issue #409 rejects timestamps before the explicit sane lower bound',()=>{
  const validation=validateReleaseIdentity(validIdentity({
    cloudflareVersionTimestamp:'2019-12-31T23:59:59.999Z',
  }),{
    nowMs:Date.parse('2026-09-29T12:40:00.000Z'),
  });
  assert.equal(validation.ok,false);
  assert.equal(validation.code,RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_BEFORE_MINIMUM);
});

test('Issue #409 rejects malformed Cloudflare version identifiers with an explicit code',()=>{
  const validation=validateReleaseIdentity(validIdentity({
    cloudflareVersionId:'version-id',
  }));
  assert.equal(validation.ok,false);
  assert.equal(validation.code,RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_ID_INVALID);
  assert.equal(validation.field,'cloudflareVersionId');
});

test('Issue #409 requires production app version and release candidate fields',()=>{
  const missingVersion=validateReleaseIdentity(validIdentity({appVersion:''}));
  assert.equal(missingVersion.ok,false);
  assert.equal(missingVersion.code,RELEASE_IDENTITY_CODES.APP_VERSION_REQUIRED);

  const missingCandidate=validateReleaseIdentity(validIdentity({releaseCandidate:''}));
  assert.equal(missingCandidate.ok,false);
  assert.equal(missingCandidate.code,RELEASE_IDENTITY_CODES.RELEASE_CANDIDATE_REQUIRED);
});

test('Issue #409 validates release identifiers and requires the RC number to agree',()=>{
  const malformedVersion=validateReleaseIdentity(validIdentity({appVersion:'release-144'}));
  assert.equal(malformedVersion.code,RELEASE_IDENTITY_CODES.APP_VERSION_INVALID);

  const malformedCandidate=validateReleaseIdentity(validIdentity({releaseCandidate:'144'}));
  assert.equal(malformedCandidate.code,RELEASE_IDENTITY_CODES.RELEASE_CANDIDATE_INVALID);

  const mismatch=validateReleaseIdentity(validIdentity({releaseCandidate:'RC143'}));
  assert.equal(mismatch.code,RELEASE_IDENTITY_CODES.RELEASE_CANDIDATE_MISMATCH);
});

test('Issue #409 valid production identity remains backward-compatible',()=>{
  const identity=validIdentity();
  const validation=validateReleaseIdentity(identity,{
    nowMs:Date.parse('2026-10-04T12:00:00.000Z'),
  });
  assert.equal(validation.ok,true);
  assert.equal(validation.code,RELEASE_IDENTITY_CODES.VALID);
  assert.equal(releaseIdentityComplete(identity,{
    nowMs:Date.parse('2026-10-04T12:00:00.000Z'),
  }),true);
});
