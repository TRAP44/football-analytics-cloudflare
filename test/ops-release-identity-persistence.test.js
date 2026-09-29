import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');

test('ops events reserve authoritative release identity before metadata truncation',()=>{
  const start=worker.indexOf('async function recordOpsEventTask');
  const end=worker.indexOf('async function cleanupRateWindows',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(
    block,
    /safeOpsMetadata\(\{ \.\.\.currentReleaseIdentity\(cfg\), \.\.\.\(event\.meta \|\| \{\}\), \.\.\.currentReleaseIdentity\(cfg\) \}\)/
  );
});

test('ops metadata sanitizer does not classify deployment identity keys as sensitive',()=>{
  const start=worker.indexOf('function sensitiveOpsMetadataKey');
  const end=worker.indexOf('function sanitizeOpsMetadataValue',start);
  const block=worker.slice(start,end);
  for(const key of ['deploySha','cloudflareVersionId','cloudflareVersionTag','cloudflareVersionTimestamp']){
    const match=/return \/([^/]+)\/i/.exec(block);
    assert.ok(match);
    const re=new RegExp(match[1],'i');
    assert.equal(re.test(key),false,key);
  }
});
