import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveUploadedWorkerVersion } from '../scripts/resolve-uploaded-worker-version.js';

const id='11111111-2222-4333-8444-555555555555';
const release='6.120.0-rc144';
const sha='a'.repeat(40);

function version(overrides={}) {
  return {
    id,
    annotations:{
      'workers/message':`release=${release} sha=${sha}`,
      'workers/tag':sha,
    },
    metadata:{created_on:'2026-10-07T19:30:00.000Z',source:'wrangler'},
    ...overrides,
  };
}

test('recovery candidate resolver binds the uploaded version to release and SHA',()=>{
  const result=resolveUploadedWorkerVersion([version()],release,sha);
  assert.equal(result.versionId,id);
  assert.equal(result.release,release);
  assert.equal(result.sha,sha);
});

test('recovery candidate resolver rejects missing, duplicate or mismatched candidates',()=>{
  assert.throws(()=>resolveUploadedWorkerVersion([],release,sha),/found 0/);
  assert.throws(()=>resolveUploadedWorkerVersion([version(),version()],release,sha),/found 2/);
  assert.throws(
    ()=>resolveUploadedWorkerVersion([version({annotations:{'workers/message':`release=${release} sha=${'b'.repeat(40)}`,'workers/tag':'b'.repeat(40)}})],release,sha),
    /found 0/,
  );
});



test('recovery resolver rejects coerced release and SHA inputs before inspecting versions',()=>{
  for(const badRelease of [{toString:()=>release},42,true,['6.120.0-rc144']]){
    assert.throws(()=>resolveUploadedWorkerVersion([version()],badRelease,sha),/invalid format/);
  }
  for(const badSha of [{toString:()=>sha},true,123,['a'.repeat(40)]]){
    assert.throws(()=>resolveUploadedWorkerVersion([version()],release,badSha),/40-character Git commit SHA/);
  }
});

test('recovery resolver refuses spoofed annotations that coerce into a matching release identity',()=>{
  const expectedMessage='release='+release+' sha='+sha;
  for(const annotations of [
    {'workers/message':{toString:()=>expectedMessage},'workers/tag':sha},
    {'workers/message':expectedMessage,'workers/tag':{toString:()=>sha}},
  ]){
    assert.throws(
      ()=>resolveUploadedWorkerVersion([version({annotations})],release,sha),
      /found 0/,
    );
  }
});

test('recovery resolver rejects malformed version IDs and impossible release timestamps',()=>{
  for(const altered of [
    {id:{toString:()=>id}},
    {id:'not-a-version-id'},
    {metadata:{created_on:'2035-10-07T19:30:00.000Z',source:'wrangler'}},
    {metadata:{created_on:'yesterday',source:'wrangler'}},
  ]){
    assert.throws(
      ()=>resolveUploadedWorkerVersion([version(altered)],release,sha),
      /invalid|validation failed/i,
    );
  }
});

test('recovery resolver normalizes SHA identity and freezes its verified result',()=>{
  const uppercase=sha.toUpperCase();
  const result=resolveUploadedWorkerVersion([version()],release,uppercase);
  assert.equal(result.sha,sha);
  assert.equal(result.release,release);
  assert.equal(result.versionId,id);
  assert.equal(Object.isFrozen(result),true);
  assert.match(result.timestamp,/^\d{4}-\d{2}-\d{2}T/);
});
