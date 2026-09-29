import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('src/worker.js','utf8');
const router = fs.readFileSync('src/router.js','utf8');
const gateway = fs.readFileSync('src/api-football-gateway.js','utf8');
const secondary = fs.readFileSync('src/providers/provider-request.js','utf8');
const admin = fs.readFileSync('public/modules/admin-provider.js','utf8');
const app = fs.readFileSync('public/app.js','utf8');
const html = fs.readFileSync('public/admin.html','utf8');
const smoke = fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('provider observability is wired to both primary and secondary football transports', () => {
  assert.match(worker, /createProviderObservabilityRuntime/);
  assert.match(worker, /createApiFootballGateway\(\{[\s\S]*?observeProviderRequest/);
  assert.match(worker, /createProviderRequestBoundary\(\{[\s\S]*?observeProviderRequest/);
  assert.match(gateway, /observeProviderRequest\(\{/);
  assert.match(secondary, /observeProviderRequest\(\{/);
});

test('provider SLO persists one aggregate window through production monitoring', () => {
  assert.match(worker, /async function flushProviderSloWindow/);
  assert.match(worker, /code: 'PROVIDER_SLO_WINDOW'/);
  assert.match(worker, /event_type: 'slo_window'/);
  assert.match(worker, /const providerSloFlush = options\.record !== false/);
  assert.match(worker, /restoreProviderObservabilityWindow\(snapshot\)/);
  assert.match(worker, /providerSloPersistenceErrors/);
});

test('admin provider endpoint and diagnostics expose 24 hour provider SLO', () => {
  assert.match(router, /providerObservability: await providerSloReport\(cfg, 24\)/);
  assert.match(worker, /providerSloReport\(cfg,24\)/);
  assert.match(worker, /providerObservability,/);
  assert.match(app, /providerObservability: null/);
  assert.match(admin, /state\.providerObservability/);
});

test('admin UI renders SLO state, success, retry and latency without changing public match UI', () => {
  for (const id of ['providerSloState','providerSloSuccess','providerSloRetry','providerSloLatency','providerSloNote']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(admin, /SLO · 24 часа|sloLabels/);
  assert.match(admin, /successRatePct/);
  assert.match(admin, /retryRatePct/);
  assert.match(admin, /avgAttemptLatencyMs/);
});

test('provider SLO is release-gated and production-smoke checked', () => {
  assert.match(worker, /providerSloObservability: 'enabled'/);
  assert.match(worker, /providerSloSelfTest: providerSloSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(smoke, /'providerSloObservability'/);
  assert.match(smoke, /'providerSloSelfTest'/);
});

test('provider SLO remains observational and does not add automatic rollback controls', () => {
  const start = worker.indexOf('async function flushProviderSloWindow');
  const end = worker.indexOf('async function readOpsEventsRange', start);
  assert.ok(start >= 0 && end > start);
  const block = worker.slice(start, end);
  assert.doesNotMatch(block, /rollback|runtimeControls|apiFootball\(/i);
});
