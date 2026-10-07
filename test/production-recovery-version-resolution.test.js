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
