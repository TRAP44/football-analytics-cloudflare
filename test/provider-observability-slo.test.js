import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProviderObservabilityRuntime,
  providerSloState,
  DEFAULT_PROVIDER_SLO_POLICY,
  providerSloWindowsFromBuckets,
} from '../src/provider-observability.js';

function runtime(start = Date.parse('2026-09-28T12:00:00.000Z')) {
  const memory = {};
  let nowMs = start;
  const api = createProviderObservabilityRuntime({
    memory,
    now: () => nowMs,
  });
  return {
    api,
    memory,
    advance(ms) { nowMs += ms; },
  };
}

test('provider SLO counts retry recovery as one successful logical request', () => {
  const rt = runtime();
  rt.api.observeProviderRequest({
    provider:'api-football',
    operation:'/fixtures',
    outcome:'retrying',
    errorType:'UPSTREAM_TIMEOUT',
    latencyMs:1000,
    attempt:1,
  });
  rt.api.observeProviderRequest({
    provider:'api-football',
    operation:'/fixtures',
    outcome:'success',
    latencyMs:120,
    attempt:2,
  });

  const snapshot = rt.api.currentWindow();
  assert.equal(snapshot.totals.attempts, 2);
  assert.equal(snapshot.totals.requests, 1);
  assert.equal(snapshot.totals.successes, 1);
  assert.equal(snapshot.totals.failures, 0);
  assert.equal(snapshot.totals.retries, 1);
  assert.equal(snapshot.totals.timeouts, 0);
  assert.equal(snapshot.totals.avgAttemptLatencyMs, 560);
});

test('provider SLO keeps small samples in collecting state', () => {
  const rt = runtime();
  for (let i = 0; i < 4; i += 1) {
    rt.api.observeProviderRequest({
      provider:'OpenLigaDB',
      operation:'standings',
      outcome:'success',
      latencyMs:80,
    });
  }
  const report = rt.api.summarizeWindows([], { hours:24, includeCurrent:true });
  assert.equal(report.overall.requests, 4);
  assert.equal(report.overall.state, 'collecting');
  assert.match(report.overall.label, /4\/10/);
});

test('provider SLO marks sustained failures as incident', () => {
  const rt = runtime();
  for (let i = 0; i < 8; i += 1) {
    rt.api.observeProviderRequest({ provider:'api-football', operation:'/odds', outcome:'success', latencyMs:100 });
  }
  for (let i = 0; i < 2; i += 1) {
    rt.api.observeProviderRequest({
      provider:'api-football',
      operation:'/odds',
      outcome:'failed',
      errorType:'UPSTREAM_TIMEOUT',
      latencyMs:6000,
    });
  }
  const report = rt.api.summarizeWindows([], { hours:24, includeCurrent:true });
  assert.equal(report.overall.requests, 10);
  assert.equal(report.overall.successRatePct, 80);
  assert.equal(report.overall.timeoutRatePct, 20);
  assert.equal(report.overall.state, 'incident');
});

test('provider SLO aggregates persisted windows by provider and operation', () => {
  const rt = runtime();
  const rows = [
    {
      metadata:{
        windowStartedAt:'2026-09-28T10:00:00.000Z',
        windowEndedAt:'2026-09-28T10:15:00.000Z',
        series:[
          { provider:'api-football', operation:'/fixtures', attempts:6, requests:5, successes:5, failures:0, retries:1, timeouts:0, networkErrors:0, rateLimits:0, httpErrors:0, invalidResponses:0, latencySumMs:900, latencySamples:6, maxLatencyMs:300 },
          { provider:'OpenLigaDB', operation:'standings', attempts:5, requests:5, successes:5, failures:0, retries:0, timeouts:0, networkErrors:0, rateLimits:0, httpErrors:0, invalidResponses:0, latencySumMs:500, latencySamples:5, maxLatencyMs:140 },
        ],
      },
    },
  ];
  const report = rt.api.summarizeWindows(rows, { hours:24, includeCurrent:false });
  assert.equal(report.windowCount, 1);
  assert.equal(report.overall.requests, 10);
  assert.equal(report.overall.successes, 10);
  assert.equal(report.providers.length, 2);
  assert.equal(report.operations.length, 2);
  assert.equal(report.overall.state, 'healthy');
});

test('provider SLO rotation and restore are lossless', () => {
  const rt = runtime();
  rt.api.observeProviderRequest({ provider:'The Odds API', operation:'odds', outcome:'success', latencyMs:90 });
  const rotated = rt.api.rotateWindow();
  assert.equal(rotated.totals.requests, 1);
  assert.equal(rt.api.currentWindow().totals.requests, 0);

  rt.api.observeProviderRequest({ provider:'api-football', operation:'/fixtures', outcome:'success', latencyMs:70 });
  rt.api.restoreWindow(rotated);
  const restored = rt.api.currentWindow();
  assert.equal(restored.totals.requests, 2);
  assert.equal(restored.totals.successes, 2);
  assert.equal(restored.series.length, 2);
});

test('provider SLO policy exposes stable operational thresholds', () => {
  assert.equal(DEFAULT_PROVIDER_SLO_POLICY.minSample, 10);
  assert.equal(DEFAULT_PROVIDER_SLO_POLICY.successRatePct, 98);
  assert.equal(DEFAULT_PROVIDER_SLO_POLICY.timeoutRatePct, 2);
  assert.equal(DEFAULT_PROVIDER_SLO_POLICY.rateLimitRatePct, 2);
  assert.equal(DEFAULT_PROVIDER_SLO_POLICY.retryRatePct, 10);
  assert.equal(DEFAULT_PROVIDER_SLO_POLICY.avgAttemptLatencyMs, 2500);

  assert.equal(providerSloState({ requests:10, successRatePct:100, timeoutRatePct:0, rateLimitRatePct:0, retryRatePct:0, avgAttemptLatencyMs:100 }).state, 'healthy');
});


test('distributed provider buckets combine cross-isolate traffic into one canonical window', () => {
  const now=Date.parse('2026-09-28T12:20:00.000Z');
  const rows=[
    {
      bucket_started_at:'2026-09-28T12:00:00.000Z',
      provider:'api-football',
      operation:'/fixtures',
      attempts:8,
      requests:6,
      successes:5,
      failures:1,
      retries:2,
      timeouts:1,
      network_errors:0,
      rate_limits:0,
      http_errors:0,
      invalid_responses:0,
      latency_sum_ms:2400,
      latency_samples:8,
      max_latency_ms:800,
      updated_at:'2026-09-28T12:12:00.000Z',
    },
  ];
  const windows=providerSloWindowsFromBuckets(rows,{hours:1,nowMs:now,includeOpen:false});
  assert.equal(windows.length,1);
  assert.equal(windows[0].metadata.windowId,'provider-slo:2026-09-28T12:00:00.000Z');
  assert.equal(windows[0].metadata.totals.requests,6);
  assert.equal(windows[0].metadata.totals.attempts,8);
  assert.equal(windows[0].metadata.series.length,1);
});

test('requested hours excludes older distributed buckets and duplicate snapshots do not double count', () => {
  const now=Date.parse('2026-09-28T12:20:00.000Z');
  const base={
    provider:'api-football',
    operation:'/fixtures',
    attempts:2,
    requests:2,
    successes:2,
    failures:0,
    retries:0,
    timeouts:0,
    network_errors:0,
    rate_limits:0,
    http_errors:0,
    invalid_responses:0,
    latency_sum_ms:200,
    latency_samples:2,
    max_latency_ms:120,
  };
  const rows=[
    {...base,bucket_started_at:'2026-09-28T10:00:00.000Z',updated_at:'2026-09-28T10:05:00.000Z'},
    {...base,bucket_started_at:'2026-09-28T12:00:00.000Z',requests:1,successes:1,attempts:1,updated_at:'2026-09-28T12:02:00.000Z'},
    {...base,bucket_started_at:'2026-09-28T12:00:00.000Z',requests:3,successes:3,attempts:3,latencySamples:3,latencySumMs:300,updated_at:'2026-09-28T12:10:00.000Z'},
  ];
  const windows=providerSloWindowsFromBuckets(rows,{hours:1,nowMs:now,includeOpen:false});
  assert.equal(windows.length,1);
  assert.equal(windows[0].metadata.totals.requests,3);
});

test('summarizeWindows enforces the requested hours boundary', () => {
  const rt=runtime(Date.parse('2026-09-28T12:20:00.000Z'));
  const row=(start,end,requests)=>({
    metadata:{
      windowId:'provider-slo:'+start,
      windowStartedAt:start,
      windowEndedAt:end,
      series:[{provider:'api-football',operation:'/fixtures',attempts:requests,requests,successes:requests,failures:0,retries:0,timeouts:0,rateLimits:0,latencySumMs:requests*100,latencySamples:requests,maxLatencyMs:100}],
    },
  });
  const report=rt.api.summarizeWindows([
    row('2026-09-28T10:00:00.000Z','2026-09-28T10:15:00.000Z',20),
    row('2026-09-28T12:00:00.000Z','2026-09-28T12:15:00.000Z',5),
  ],{hours:1,includeCurrent:false});
  assert.equal(report.hours,1);
  assert.equal(report.windowCount,1);
  assert.equal(report.overall.requests,5);
});


test('distributed provider aggregation clamps retention to seven days', () => {
  const now=Date.parse('2026-09-28T12:20:00.000Z');
  const row=(bucketStartedAt)=>({
    bucket_started_at:bucketStartedAt,
    provider:'api-football',
    operation:'/fixtures',
    attempts:1,
    requests:1,
    successes:1,
    failures:0,
    retries:0,
    timeouts:0,
    network_errors:0,
    rate_limits:0,
    http_errors:0,
    invalid_responses:0,
    latency_sum_ms:100,
    latency_samples:1,
    max_latency_ms:100,
    updated_at:bucketStartedAt,
  });
  const windows=providerSloWindowsFromBuckets([
    row('2026-09-20T12:00:00.000Z'),
    row('2026-09-28T12:00:00.000Z'),
  ],{hours:999,nowMs:now,includeOpen:false});
  assert.equal(windows.length,1);
  assert.equal(windows[0].metadata.windowId,'provider-slo:2026-09-28T12:00:00.000Z');
});
