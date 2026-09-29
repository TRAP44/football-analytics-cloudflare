import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');

test('health payload declares releaseCandidate only once',()=>{
  const start=worker.indexOf("if (url.pathname === '/health' || url.pathname === '/api/health')");
  const end=worker.indexOf("if (request.method === 'POST' && url.pathname === '/telegram/webhook'",start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  const matches=block.match(/releaseCandidate\s*:\s*RC_NAME/g) || [];
  assert.equal(matches.length,1);
});

test('readiness and live health still expose the canonical release identity',()=>{
  assert.match(worker,/version:APP_VERSION,\s*releaseCandidate:RC_NAME,\s*deployment:currentReleaseIdentity\(cfg\)/);
  assert.match(worker,/version:\s*APP_VERSION,\s*releaseCandidate:\s*RC_NAME,\s*deployment:\s*currentReleaseIdentity\(cfg\)/);
});
