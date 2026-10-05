import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicHealthRuntime } from '../src/public-health.js';

const worker=fs.readFileSync('src/worker.js','utf8');

test('public health routes use the minimized public health runtime',()=>{
  const start=worker.indexOf("if (url.pathname === '/health/live')");
  const end=worker.indexOf("if (request.method === 'GET' && url.pathname === '/api/app-manifest')",start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/publicHealthRuntime\.liveSnapshot\(\)/);
  assert.match(block,/publicHealthRuntime\.readinessSnapshot\(cfg\)/);
  assert.match(block,/publicHealthRuntime\.healthSnapshot\(cfg\)/);
  assert.doesNotMatch(block,/currentReleaseIdentity|EXPECTED_SCHEMA_FINGERPRINT|cloudflareVersionId/);
});

test('public live and readiness preserve version/release candidate without deployment internals',async()=>{
  const runtime=createPublicHealthRuntime({
    version:'6.120.0-rc144',
    releaseCandidate:'RC144',
    computeReadiness:async()=>({
      ok:true,
      status:'ready',
      version:'6.120.0-rc144',
      releaseCandidate:'RC144',
      deployment:{deploySha:'a'.repeat(40),cloudflareVersionId:'private-detail'},
      checks:{
        supabase:{ok:true,status:'ok'},
        schema:{ok:true,status:'ok',fingerprint:'hidden'},
        backendSecurity:{ok:true,status:'ok'},
        telegramConfigured:true,
      },
    }),
  });

  const live=runtime.liveSnapshot();
  assert.equal(live.version,'6.120.0-rc144');
  assert.equal(live.releaseCandidate,'RC144');
  assert.equal('deployment' in live,false);

  const ready=await runtime.readinessSnapshot({});
  assert.equal(ready.version,'6.120.0-rc144');
  assert.equal(ready.releaseCandidate,'RC144');
  assert.equal('deployment' in ready,false);
  assert.equal('fingerprint' in ready.checks.schema,false);
});
