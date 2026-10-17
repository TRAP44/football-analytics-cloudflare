import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisTiming} from '../src/analysis-timing.js';

test('analysis timing measures disjoint phases and emits only once for slow requests',()=>{
  let at=0;const trace=createAnalysisTiming({now:()=>at});
  at=100;trace.enter('access');at=500;trace.enter('fixture');at=2000;trace.enter('persistence');at=2500;
  const result=trace.finish();
  assert.equal(result.durationMs,2500);
  assert.deepEqual(result.meta,{cacheMs:100,accessMs:400,fixtureMs:1500,providersMs:0,enrichmentMs:0,persistenceMs:500,settlementMs:0});
  assert.equal(trace.finish(),null);
});

test('fast, invalid clocks and backwards samples cannot create bogus timing events',()=>{
  assert.equal(createAnalysisTiming({now:()=>0}).finish(),null);
  assert.equal(createAnalysisTiming({now:()=>NaN}).finish(),null);
  assert.equal(createAnalysisTiming({now:()=>{throw new Error('clock');}}).finish(),null);
  let at=100;const trace=createAnalysisTiming({now:()=>at});at=0;trace.enter('fixture');at=2200;
  assert.equal(trace.finish().durationMs,2100);
});
