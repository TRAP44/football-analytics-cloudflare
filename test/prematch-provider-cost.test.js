import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('actual analysis composition measures cold and cached requests through an isolated relay',()=>{
  const report=JSON.parse(execFileSync(process.execPath,['scripts/measure-prematch-provider-cost.js'],{encoding:'utf8',timeout:30000}));
  assert.equal(report.isolated,true);
  assert.deepEqual(report.results.map(({leadMinutes,mode,status,providerRequests})=>({leadMinutes,mode,status,providerRequests})),[
    {leadMinutes:120,mode:'cold',status:200,providerRequests:9},
    {leadMinutes:120,mode:'cached',status:200,providerRequests:0},
    {leadMinutes:60,mode:'cold',status:200,providerRequests:10},
    {leadMinutes:60,mode:'cached',status:200,providerRequests:0},
  ]);
  assert.equal(report.results[2].requests.filter(x=>x.endpoint==='/fixtures/lineups').length,1);
  assert.equal(report.results[0].requests.filter(x=>x.endpoint==='/fixtures/lineups').length,0);
  assert.ok(report.results.filter(x=>x.mode==='cached').every(x=>x.cached===true));
});

test('actual lineup refresh includes the new confirmed XI, preserves first prediction and repeats without provider work',()=>{
  const report=JSON.parse(execFileSync(process.execPath,['scripts/measure-prematch-provider-cost.js','--lineup-refresh'],{encoding:'utf8',timeout:30000}));
  const refresh=report.results.find(x=>x.mode==='lineup-refresh');
  const repeat=report.results.find(x=>x.mode==='lineup-repeat');
  assert.equal(refresh.status,200);
  assert.equal(refresh.lineupsConfirmed,true);
  assert.equal(refresh.completedLineupRefresh,true);
  assert.equal(refresh.firstPredictionUnchanged,true);
  assert.equal(refresh.providerRequests,4);
  assert.equal(repeat.providerRequests,0);
  assert.equal(repeat.cached,true);
  assert.ok(refresh.predictionWrites.length>=2);
  assert.ok(refresh.predictionWrites.every(x=>x.method==='POST' && x.prefer.includes('resolution=ignore-duplicates') && x.conflict==='fixture_id'));
});
