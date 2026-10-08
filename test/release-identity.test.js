import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELEASE_IDENTITY_CODES,
  cloudflareVersionIdValid,
  releaseIdentityComplete,
  runtimeReleaseIdentity,
  validateReleaseIdentity,
} from '../src/release-identity.js';

const sha='51e52bae716e0469e95bc4f1523bebaac413317f';
const versionId='11111111-2222-3333-4444-555555555555';
const timestamp='2026-10-06T07:00:00.000Z';

function identity(overrides={}) {
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

test('runtime release identity accepts only canonical string metadata',()=>{
  const result=runtimeReleaseIdentity({
    id:versionId,
    tag:sha.toUpperCase(),
    timestamp,
  },{
    appVersion:'6.120.0-rc144',
    releaseCandidate:'RC144',
  });
  assert.equal(result.deploySha,sha);
  assert.equal(result.cloudflareVersionTag,sha.toUpperCase());
  assert.equal(result.cloudflareVersionTimestamp,timestamp);

  const malformed=runtimeReleaseIdentity({
    id:{toString:()=>versionId},
    tag:[sha],
    timestamp:{toString:()=>timestamp},
  },{
    appVersion:{toString:()=> '6.120.0-rc144'},
    releaseCandidate:['RC144'],
  });
  assert.deepEqual(malformed,{
    appVersion:'',
    releaseCandidate:'',
    deploySha:null,
    cloudflareVersionId:null,
    cloudflareVersionTag:null,
    cloudflareVersionTimestamp:null,
  });
});

test('Cloudflare version identifier validation rejects coercion',()=>{
  assert.equal(cloudflareVersionIdValid(versionId),true);
  assert.equal(cloudflareVersionIdValid(versionId.toUpperCase()),true);
  assert.equal(cloudflareVersionIdValid({toString:()=>versionId}),false);
  assert.equal(cloudflareVersionIdValid([versionId]),false);
});

test('release identity rejects non-canonical version strings and object coercion',()=>{
  assert.equal(
    validateReleaseIdentity(identity({appVersion:'6.120.0-RC144'})).code,
    RELEASE_IDENTITY_CODES.APP_VERSION_INVALID,
  );
  assert.equal(
    validateReleaseIdentity(identity({deploySha:{toString:()=>sha}})).code,
    RELEASE_IDENTITY_CODES.DEPLOY_SHA_REQUIRED,
  );
  assert.equal(
    validateReleaseIdentity(identity({cloudflareVersionTag:[sha]})).code,
    RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TAG_REQUIRED,
  );
});

test('release identity requires matching release candidate and deploy tag',()=>{
  assert.equal(
    validateReleaseIdentity(identity({releaseCandidate:'RC143'})).code,
    RELEASE_IDENTITY_CODES.RELEASE_CANDIDATE_MISMATCH,
  );
  assert.equal(
    validateReleaseIdentity(identity({cloudflareVersionTag:'a'.repeat(40)})).code,
    RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TAG_MISMATCH,
  );
});

test('release identity validates real UTC calendar timestamps',()=>{
  assert.equal(
    validateReleaseIdentity(identity({cloudflareVersionTimestamp:'2026-02-30T07:00:00.000Z'})).code,
    RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_INVALID_FORMAT,
  );
  assert.equal(
    validateReleaseIdentity(identity({cloudflareVersionTimestamp:{toString:()=>timestamp}})).code,
    RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_REQUIRED,
  );
});

test('release identity option coercion cannot weaken timestamp policy',()=>{
  const old=identity({cloudflareVersionTimestamp:'2019-12-31T23:59:59.000Z'});
  assert.equal(
    validateReleaseIdentity(old,{
      nowMs:Date.parse('2026-10-06T07:10:00.000Z'),
      minTimestampMs:false,
    }).code,
    RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_BEFORE_MINIMUM,
  );

  const future=identity({cloudflareVersionTimestamp:'2026-10-06T07:20:01.000Z'});
  assert.equal(
    validateReleaseIdentity(future,{
      nowMs:Date.parse('2026-10-06T07:10:00.000Z'),
      maxFutureSkewMs:[999999999],
    }).code,
    RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_FUTURE_SKEW,
  );
});

test('valid numeric-string timing options remain compatible',()=>{
  const result=validateReleaseIdentity(identity(),{
    nowMs:String(Date.parse('2026-10-06T07:05:00.000Z')),
    minTimestampMs:String(Date.parse('2020-01-01T00:00:00.000Z')),
    maxFutureSkewMs:'600000',
  });
  assert.equal(result.ok,true);
  assert.equal(result.code,RELEASE_IDENTITY_CODES.VALID);
  assert.equal(releaseIdentityComplete(identity(),{nowMs:Date.parse('2026-10-06T07:05:00.000Z')}),true);
});

test('release identity validates malformed SHA and explicit field errors',()=>{
  const cases=[
    [{deploySha:'z'.repeat(40)},RELEASE_IDENTITY_CODES.DEPLOY_SHA_INVALID,'deploySha'],
    [{cloudflareVersionId:'not-uuid'},RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_ID_INVALID,'cloudflareVersionId'],
    [{cloudflareVersionTag:'x'.repeat(40)},RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TAG_INVALID,'cloudflareVersionTag'],
    [{releaseCandidate:'RC0144'},RELEASE_IDENTITY_CODES.RELEASE_CANDIDATE_MISMATCH,'releaseCandidate'],
  ];
  for(const [changes,code,field] of cases){
    const result=validateReleaseIdentity(identity(changes),{
      nowMs:Date.parse('2026-10-06T07:05:00.000Z'),
    });
    assert.equal(result.ok,false,field);
    assert.equal(result.code,code,field);
    assert.equal(result.field,field);
  }
});
