import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRegressionWindow, postDeployRegressionReport, summarizeRegressionEvents } from '../src/post-deploy-regression.js';

const start='2026-09-29T13:00:00.000Z';
const identity={deploySha:'a'.repeat(40),cloudflareVersionTimestamp:start};
const row=(at,overrides={})=>({
  created_at:at,
  severity:'info',
  source:'worker',
  event_type:'test',
  code:'OK',
  message:'ok',
  duration_ms:100,
  ...overrides,
});

test('post-deploy regression keeps 15/30/60 windows collecting until mature',()=>{
  const report=postDeployRegressionReport([],identity,{nowMs:Date.parse('2026-09-29T13:10:00Z')});
  assert.equal(report.state,'collecting');
  assert.deepEqual(report.windows.map(x=>x.phase),['collecting','collecting','collecting']);
  assert.equal(report.windows[0].elapsedMinutes,10);
});

test('post-deploy regression compares equal pre/post windows after maturity',()=>{
  const items=[
    row('2026-09-29T12:50:00Z',{severity:'error',code:'OLD_ERROR'}),
    row('2026-09-29T13:05:00Z',{severity:'error',code:'NEW_ERROR'}),
  ];
  const report=postDeployRegressionReport(items,identity,{nowMs:Date.parse('2026-09-29T13:16:00Z')});
  assert.equal(report.windows[0].phase,'complete');
  assert.equal(report.windows[0].baseline.errors,1);
  assert.equal(report.windows[0].post.errors,1);
  assert.equal(report.windows[0].state,'healthy');
});

test('new auth failure after deploy is an incident regression',()=>{
  const items=[
    row('2026-09-29T13:05:00Z',{severity:'error',source:'cache',message:'Supabase analysis_cache HTTP 401 PGRST303'}),
  ];
  const report=postDeployRegressionReport(items,identity,{nowMs:Date.parse('2026-09-29T13:16:00Z')});
  assert.equal(report.windows[0].state,'incident');
  assert.equal(report.windows[0].signals[0].code,'auth_failures_increased');
});

test('provider and Telegram regression need material deltas, not one noisy event',()=>{
  const baseline=summarizeRegressionEvents([]);
  const one=summarizeRegressionEvents([
    row('2026-09-29T13:01:00Z',{severity:'error',source:'provider',code:'PROVIDER_ERROR'}),
  ]);
  assert.equal(compareRegressionWindow(one,baseline).state,'healthy');

  const material=summarizeRegressionEvents([
    row('2026-09-29T13:01:00Z',{severity:'error',source:'provider',code:'PROVIDER_ERROR'}),
    row('2026-09-29T13:02:00Z',{severity:'error',source:'provider',code:'PROVIDER_ERROR'}),
    row('2026-09-29T13:03:00Z',{severity:'error',source:'telegram',code:'TELEGRAM_SEND_FAILED'}),
    row('2026-09-29T13:04:00Z',{severity:'error',source:'telegram',code:'TELEGRAM_SEND_FAILED'}),
  ]);
  const compared=compareRegressionWindow(material,baseline);
  assert.equal(compared.state,'watch');
  assert.ok(compared.signals.some(x=>x.code==='provider_failure_regression'));
  assert.ok(compared.signals.some(x=>x.code==='telegram_failure_regression'));
});

test('p95 latency regression needs enough samples and a material increase',()=>{
  const baseline=summarizeRegressionEvents(Array.from({length:5},(_,i)=>row(`2026-09-29T12:5${i}:00Z`,{duration_ms:100})));
  const post=summarizeRegressionEvents(Array.from({length:5},(_,i)=>row(`2026-09-29T13:0${i}:00Z`,{duration_ms:500})));
  const compared=compareRegressionWindow(post,baseline);
  assert.equal(compared.state,'watch');
  assert.ok(compared.signals.some(x=>x.code==='latency_p95_regression'));
});

test('report remains unavailable without a trustworthy deployment timestamp',()=>{
  const report=postDeployRegressionReport([],{deploySha:'a'.repeat(40)},{nowMs:Date.parse('2026-09-29T13:16:00Z')});
  assert.equal(report.state,'unavailable');
  assert.equal(report.reason,'deployment_timestamp_unavailable');
});
