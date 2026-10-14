import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

test('isolated HTTP harness exercises signed production-mode handlers and shares the cold feed lookup',()=>{
  const report=JSON.parse(execFileSync(process.execPath,['scripts/isolated-launch-capacity-check.js'],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024}));
  assert.equal(report.target.dailyUsers,1000);
  assert.equal(report.target.peakClients,100);
  assert.equal(report.httpPeak,100);
  assert.equal(report.stats.externalBlocked,0);
  assert.equal(report.stats.modelLookups,1);
  assert.equal(report.stats.dbByOperation['GET /rest/v1/runtime_controls'],1);
  assert.equal(report.rows[0].httpStatus[200],1000);
  assert.equal(report.rows[1].httpStatus[200],100);
  const wf=fs.readFileSync('.github/workflows/isolated-load-resilience.yml','utf8');
  assert.match(wf,/node scripts\/isolated-launch-capacity-check\.js --full/);
  assert.match(wf,/node scripts\/isolated-postgres-burst-check\.js/);
});
