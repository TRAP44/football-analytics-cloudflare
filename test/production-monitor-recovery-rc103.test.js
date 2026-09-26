import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runRollbackSmoke } from '../scripts/rollback-smoke.js';

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
  const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/router.js','utf8');
  assert.match(worker,/async function runProductionMonitor\(/);
  assert.match(worker,/scheduledAt\.getUTCMinutes\(\) % 15 === 0/);
  assert.match(worker,/consumesFootballApi: false/);
  assert.match(worker,/autoRollback: false/);
  assert.match(worker,/source: 'monitor'/);
  assert.match(worker,/eventType: 'production_monitor'/);
});

test('RC103 production readiness declares checks before any push', () => {
  const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/router.js','utf8');
  const start=worker.indexOf('async function apiProductionReadiness');
  const end=worker.indexOf('\nfunction rcCheck',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  const declaration=block.indexOf('const checks = [');
  const firstPush=block.indexOf('checks.push(');
  assert.ok(declaration>=0);
  assert.ok(firstPush<0 || firstPush>declaration, 'checks.push must never run before const checks');
});

test('RC103 exposes protected monitor route and health contracts', () => {
  const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/router.js','utf8');
  assert.match(worker,/url\.pathname === '\/api\/production-monitor'/);
  assert.match(worker,/productionMonitor: 'enabled'/);
  assert.match(worker,/productionMonitorSelfTest: productionMonitorSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(worker,/rollbackVerification: 'enabled'/);
});

test('RC103 rollback workflow validates target and verifies restored production', () => {
  const workflow=fs.readFileSync('.github/workflows/rollback-production.yml','utf8');
  assert.match(workflow,/expected_version:/);
  assert.match(workflow,/Rollback preflight/);
  assert.match(workflow,/npx wrangler rollback "\$VERSION_ID"/);
  assert.match(workflow,/node scripts\/rollback-smoke\.js "\$ROLLBACK_URL" "\$EXPECTED_VERSION"/);
  assert.match(workflow,/CLOUDFLARE_WORKER_URL/);
});
