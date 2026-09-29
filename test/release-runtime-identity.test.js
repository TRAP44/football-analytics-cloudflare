import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseIdentityComplete, runtimeReleaseIdentity } from '../src/release-identity.js';

const sha='df5bd3bdf56bb84a8a38b9ef8bb65236f7cd11be';

test('runtime release identity binds Cloudflare version metadata to git SHA tag',()=>{
  const identity=runtimeReleaseIdentity({
    id:'4894ec8e-25b5-4be3-b85a-44773b6e78e9',
    tag:sha,
    timestamp:'2026-09-29T12:36:17.000Z',
  },{appVersion:'6.120.0-rc144',releaseCandidate:'RC144'});

  assert.deepEqual(identity,{
    appVersion:'6.120.0-rc144',
    releaseCandidate:'RC144',
    deploySha:sha,
    cloudflareVersionId:'4894ec8e-25b5-4be3-b85a-44773b6e78e9',
    cloudflareVersionTag:sha,
    cloudflareVersionTimestamp:'2026-09-29T12:36:17.000Z',
  });
  assert.equal(releaseIdentityComplete(identity),true);
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
