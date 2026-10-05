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

test('report rejects malformed deployment identity, clock and impossible deployment timestamps',()=>{
  assert.equal(
    postDeployRegressionReport([],{
      deploySha:'not-a-sha',
      cloudflareVersionTimestamp:start,
    },{nowMs:Date.parse('2026-09-29T13:10:00Z')}).reason,
    'deployment_identity_unavailable',
  );

  assert.equal(
    postDeployRegressionReport([],{
      deploySha:'a'.repeat(40),
      cloudflareVersionTimestamp:'2026-02-30T13:00:00.000Z',
    },{nowMs:Date.parse('2026-09-29T13:10:00Z')}).reason,
    'deployment_timestamp_unavailable',
  );

  assert.equal(
    postDeployRegressionReport([],identity,{nowMs:true}).reason,
    'monitor_clock_unavailable',
  );
  assert.equal(
    postDeployRegressionReport([],identity,{nowMs:-1}).reason,
    'monitor_clock_unavailable',
  );
});

test('window normalization rejects coercion, fractions, duplicates and out-of-range values',()=>{
  const report=postDeployRegressionReport([],identity,{
    nowMs:Date.parse('2026-09-29T16:10:00Z'),
    windowsMinutes:[true,'15','15',2.5,0,181,'30'],
  });
  assert.deepEqual(report.windows.map(item=>item.minutes),[15,30]);

  const fallback=postDeployRegressionReport([],identity,{
    nowMs:Date.parse('2026-09-29T16:10:00Z'),
    windowsMinutes:[true,0,181,'2.5'],
  });
  assert.deepEqual(fallback.windows.map(item=>item.minutes),[15,30,60]);
});

test('event summarization rejects coerced durations and detects auth failures from code or message',()=>{
  const summary=summarizeRegressionEvents([
    row('2026-09-29T13:01:00Z',{duration_ms:true}),
    row('2026-09-29T13:02:00Z',{duration_ms:'125.5'}),
    row('2026-09-29T13:03:00Z',{duration_ms:[200]}),
    row('2026-09-29T13:04:00Z',{code:'PGRST303',message:'request failed',duration_ms:null}),
    null,
  ]);
  assert.equal(summary.events,4);
  assert.equal(summary.latency.samples,1);
  assert.equal(summary.latency.avgMs,126);
  assert.equal(summary.authFailures,1);
});

test('comparison fails safely on malformed summaries instead of throwing or coercing booleans',()=>{
  const compared=compareRegressionWindow({
    severity:{critical:true},
    errors:true,
    authFailures:[5],
    providerFailures:'2',
    telegramFailures:'2',
    clientErrors:'3',
    latency:{samples:true,p95Ms:'900'},
  },null);
  assert.equal(compared.state,'watch');
  assert.ok(compared.signals.some(item=>item.code==='provider_failure_regression'));
  assert.ok(compared.signals.some(item=>item.code==='telegram_failure_regression'));
  assert.ok(compared.signals.some(item=>item.code==='client_error_regression'));
  assert.equal(compared.signals.some(item=>item.code==='critical_introduced'),false);
  assert.equal(compared.signals.some(item=>item.code==='auth_failures_increased'),false);
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
  assert.equal(report.deploySha,'a'.repeat(40));
  assert.equal(report.completedWindows,0);
});
