import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runRollbackSmoke } from '../scripts/rollback-smoke.js';
import { createProductionMonitorRuntime } from '../src/production-monitor-runtime.js';

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('RC103 verifies exact rollback version and private Supabase probe', async () => {
  const fetchImpl = async url => {
    if (url.pathname === '/health') {
      return response(200, {
        ok: true,
        version: '6.94.0-rc102',
        releaseCandidate: 'RC102',
        devMode: false,
      });
    }
    if (url.pathname === '/health/supabase') return response(404, { ok: false });
    if (url.pathname === '/api/app-manifest' || url.pathname === '/api/public-status') {
      return response(200, { version: '6.94.0-rc102', releaseCandidate: 'RC102' });
    }
    if (['/api/me','/api/release-readiness','/api/calibration-control','/api/launch-funnel'].includes(url.pathname)) {
      return response(401);
    }
    return response(404);
  };
  const result = await runRollbackSmoke('https://example.com', '6.94.0-rc102', {
    fetchImpl, retries: 1, retryDelayMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.version, '6.94.0-rc102');
});

test('RC103 rejects a rollback that restored the wrong version', async () => {
  const fetchImpl = async url => {
    if (url.pathname === '/health') {
      return response(200, {
        ok: true,
        version: '6.95.0-rc103',
        releaseCandidate: 'RC103',
        devMode: false,
      });
    }
    return response(404);
  };
  await assert.rejects(
    runRollbackSmoke('https://example.com', '6.94.0-rc102', { fetchImpl, retries: 1, retryDelayMs: 0 }),
    /Expected 6\.94\.0-rc102/
  );
});

test('RC103 rejects public technical Supabase health', async () => {
  const fetchImpl = async url => {
    if (url.pathname === '/health') {
      return response(200, {
        ok: true,
        version: '6.94.0-rc102',
        releaseCandidate: 'RC102',
        devMode: false,
      });
    }
    if (url.pathname === '/health/supabase') return response(200, { ok: true });
    return response(404);
  };
  await assert.rejects(
    runRollbackSmoke('https://example.com', '6.94.0-rc102', { fetchImpl, retries: 1, retryDelayMs: 0 }),
    /must not be public/
  );
});


test('RC103 schedules a read-only production monitor every 15 minutes', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const monitor=fs.readFileSync('src/production-monitor-runtime.js','utf8');
  const scheduled=fs.readFileSync('src/scheduled-jobs.js','utf8');
  assert.match(worker,/createProductionMonitorRuntime/);
  assert.match(monitor,/async function runProductionMonitor\(/);
  assert.match(scheduled,/scheduledAt\.getUTCMinutes\(\) % 15 === 0/);
  assert.match(monitor,/consumesFootballApi: false/);
  assert.match(monitor,/autoRollback: false/);
  assert.match(monitor,/source: 'monitor'/);
  assert.match(monitor,/eventType: 'production_monitor'/);
});

test('RC103 production readiness declares checks before any push', () => {
  const worker=fs.readFileSync('src/release-readiness-runtime.js','utf8');
  const start=worker.indexOf('async function apiProductionReadiness');
  const end=worker.indexOf('\n  function rcCheck',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  const declaration=block.indexOf('const checks = [');
  const firstPush=block.indexOf('checks.push(');
  assert.ok(declaration>=0);
  assert.ok(firstPush<0 || firstPush>declaration, 'checks.push must never run before const checks');
});

test('RC103 exposes protected monitor route and health contracts', () => {
  const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/router.js','utf8')+'\n'+fs.readFileSync('src/production-monitor-runtime.js','utf8');
  assert.match(worker,/pathname === '\/api\/production-monitor'/);
  assert.match(worker,/function productionMonitorSelfTest\(\)/);
  assert.match(worker,/getProductionMonitorRuntime\(\)\.productionMonitorSelfTest/);
  assert.match(worker,/const APP_VERSION = '6\.120\.0-rc144'/);
});

test('RC103 rollback workflow validates target and verifies restored production', () => {
  const workflow=fs.readFileSync('.github/workflows/rollback-production.yml','utf8');
  assert.match(workflow,/expected_version:/);
  assert.match(workflow,/Rollback preflight/);
  assert.match(workflow,/npx wrangler rollback "\$VERSION_ID"/);
  assert.match(workflow,/node scripts\/rollback-smoke\.js "\$ROLLBACK_URL" "\$EXPECTED_VERSION"/);
  assert.match(workflow,/CLOUDFLARE_WORKER_URL/);
});



test('RC103 monitoring never treats truthy non-boolean Supabase responses as healthy',()=>{
  const classify=createProductionMonitorRuntime({}).productionMonitorState;
  const healthy={supabaseOk:true,schemaOk:true,schemaStatus:'ok'};
  assert.equal(classify(healthy).state,'healthy');
  for(const supabaseOk of ['false','true',1,{},null]) {
    assert.equal(classify({...healthy,supabaseOk}).state,'incident');
  }
  assert.equal(classify(null).state,'incident');
});

test('RC103 handles unknown and contradictory schema status without false healthy reports',()=>{
  const classify=createProductionMonitorRuntime({}).productionMonitorState;
  assert.equal(classify({supabaseOk:true,schemaOk:false,schemaStatus:'drift'}).state,'incident');
  assert.equal(classify({supabaseOk:true,schemaOk:false,schemaStatus:'unavailable'}).state,'watch');
  assert.equal(classify({supabaseOk:true,schemaOk:false,schemaStatus:'ok'}).state,'watch');
  assert.equal(classify({supabaseOk:true,schemaOk:true,schemaStatus:'invalid'}).state,'watch');
});

test('RC103 rejects coerced persistent monitoring state and untrusted auth failure counts',()=>{
  const classify=createProductionMonitorRuntime({}).productionMonitorState;
  const healthy={supabaseOk:true,schemaOk:true,schemaStatus:'ok'};
  for(const persistent of ['false',null,0]) {
    assert.equal(classify({...healthy,persistent}).state,'watch');
  }
  for(const supabaseAuthFailures of ['0','1',NaN,-1,{},Infinity]) {
    assert.equal(classify({...healthy,supabaseAuthFailures}).state,'watch');
  }
  assert.equal(classify({...healthy,supabaseAuthFailures:1}).state,'incident');
});

test('RC103 cron keeps monitoring read-only and explicit rollback only in release workflow',()=>{
  const monitor=fs.readFileSync('src/production-monitor-runtime.js','utf8');
  const workflow=fs.readFileSync('.github/workflows/rollback-production.yml','utf8');
  assert.match(monitor,/consumesFootballApi: false/);
  assert.match(monitor,/changesRuntimeControls: false/);
  assert.match(monitor,/autoRollback: false/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/Rollback preflight/);
});
