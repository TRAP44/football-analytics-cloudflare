import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC107 adds a distributed per-user lease independent of fixture ID',()=>{
  assert.match(worker,/const USER_ANALYSIS_LEASE_TTL_SECONDS = 120/);
  assert.match(worker,/function userAnalysisLeaseKey\(userId\)/);
  assert.match(worker,/analysis:user-lease:\$\{Number\(userId \|\| 0\)\}:v1/);
  assert.match(worker,/maxConcurrentFreshAnalysesPerUser:1/);
  assert.match(worker,/resolution=ignore-duplicates,return=representation/);
});

test('RC107 claims the fixture lock before the user lease and releases both',()=>{
  const start=worker.indexOf('async function apiAnalyze');
  const end=worker.indexOf('\nasync function publicServiceStatus',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  const fixtureClaim=block.indexOf('claimDistributedAnalysisLock(fixtureId,cfg)');
  const userClaim=block.indexOf('claimUserAnalysisLease(user.id,fixtureId,cfg)');
  const usage=block.indexOf('await incrementUsage(user.id, cfg)');
  assert.ok(fixtureClaim>=0 && userClaim>fixtureClaim);
  assert.ok(usage>userClaim, 'daily usage mutation must stay inside the per-user compute lease');
  assert.match(block,/await releaseUserAnalysisLease\(userAnalysisLease,cfg\)/);
  assert.match(block,/await releaseDistributedAnalysisLock\(analysisLock,cfg\)/);
});

test('RC107 returns a recoverable busy response instead of starting a second fresh analysis',()=>{
  assert.match(worker,/code:'ANALYSIS_USER_BUSY'/);
  assert.match(worker,/retryAfter:8/);
  assert.match(worker,/analysis_user_busy/);
  assert.match(app,/\['ANALYSIS_USER_BUSY','ANALYSIS_WARMING','BURST_GUARD'\]/);
  assert.match(app,/toast\(e\.message\)/);
});

test('RC107 retains public burst limits alongside the distributed lease',()=>{
  assert.match(worker,/p === '\/api\/analyze', limit: 3, windowMs: 30000/);
  assert.match(worker,/p === '\/api\/search', limit: 10, windowMs: 10000/);
  assert.match(worker,/function publicAdmissionSelfTest\(\)/);
  assert.match(worker,/analysisBurst:Number\(analysis\?\.limit \|\| 0\)/);
  assert.match(worker,/searchBurst:Number\(search\?\.limit \|\| 0\)/);
});

test('RC107 exposes admission safety in diagnostics release gate and health',()=>{
  assert.match(worker,/userAnalysisAdmission:/);
  assert.match(worker,/releaseCheck\('public_multi_user_admission_selftest'/);
  assert.match(worker,/multiUserAnalysisAdmission: 'enabled'/);
  assert.match(worker,/multiUserAnalysisAdmissionSelfTest: publicAdmissionSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(worker,/multiUserAnalysisAdmission: true/);
});

test('RC107 requires no Supabase schema migration',()=>{
  const files=fs.readdirSync('supabase/migrations');
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|rc107/i.test(x)));
});
