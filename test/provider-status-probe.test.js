import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ensureProviderSnapshot, providerSnapshotNeedsProbe, quotaFromStatusBody } from '../src/provider-status-probe.js';
import { createPrematchPredictionJob } from '../src/prematch-prediction-job.js';
import { createInPlayTimelineJob } from '../src/in-play-timeline-job.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const inferPlan = limit => (limit >= 7500 ? 'PRO' : limit > 0 ? 'FREE' : 'UNKNOWN');

test('probe is needed when the plan is unknown or a FREE snapshot is stale', () => {
  assert.equal(providerSnapshotNeedsProbe({}, NOW), true, 'expired shared snapshot');
  assert.equal(providerSnapshotNeedsProbe({ plan: 'UNKNOWN' }, NOW), true);
  assert.equal(providerSnapshotNeedsProbe({ plan: 'PRO' }, NOW), false);
  assert.equal(providerSnapshotNeedsProbe({ plan: 'FREE', updatedAt: new Date(NOW - 60_000).toISOString() }, NOW), false);
  assert.equal(providerSnapshotNeedsProbe({ plan: 'FREE', updatedAt: new Date(NOW - 45 * 60_000).toISOString() }, NOW), true);
  assert.equal(providerSnapshotNeedsProbe({ plan: 'FREE', updatedAt: '2026-10-11T23:59:00.000Z' }, Date.parse('2026-10-12T00:05:00.000Z')), true, 'new UTC day');
  assert.equal(providerSnapshotNeedsProbe({ plan: 'UNKNOWN', cooldownActive: true }, NOW), false, 'no probe during a cooldown');
  assert.equal(providerSnapshotNeedsProbe(null, NOW), true);
});

test('/status body gives the plan and the daily remainder', () => {
  assert.deepEqual(quotaFromStatusBody({ requests: { current: 7, limit_day: 7500 } }, inferPlan), { plan: 'PRO', dailyLimit: 7500, dailyRemaining: 7493 });
  assert.deepEqual(quotaFromStatusBody({ requests: { current: 120, limit_day: 100 } }, inferPlan), { plan: 'FREE', dailyLimit: 100, dailyRemaining: 0 });
  assert.equal(quotaFromStatusBody({ requests: { current: 1, limit_day: 0 } }, inferPlan), null);
  assert.equal(quotaFromStatusBody({ requests: { current: '1', limit_day: 'x' } }, inferPlan), null);
  assert.equal(quotaFromStatusBody({ requests: { current: true, limit_day: 7500 } }, inferPlan), null);
  assert.equal(quotaFromStatusBody(null, inferPlan), null);
  assert.equal(quotaFromStatusBody({ requests: { current: 1, limit_day: 7500 } }), null, 'no plan resolver');
});

test('ensureProviderSnapshot loads the shared state first and probes only when needed', async () => {
  const calls = [];
  let snapshot = {};
  const deps = {
    cfg: {},
    loadSharedProviderState: async () => { calls.push('load'); },
    providerSnapshot: () => snapshot,
    probeProviderStatus: async () => { calls.push('probe'); snapshot = { plan: 'PRO' }; },
    nowMs: NOW,
  };
  assert.deepEqual(await ensureProviderSnapshot(deps), { probed: true, ok: true });
  assert.deepEqual(calls, ['load', 'probe']);
  assert.deepEqual(await ensureProviderSnapshot(deps), { probed: false });
  assert.deepEqual(calls, ['load', 'probe', 'load']);
  // Ошибки загрузки и запроса не останавливают задание.
  snapshot = {};
  const failing = await ensureProviderSnapshot({ ...deps, loadSharedProviderState: async () => { throw new Error('db'); }, probeProviderStatus: async () => { throw new Error('net'); } });
  assert.deepEqual(failing, { probed: true, ok: false });
  assert.deepEqual(await ensureProviderSnapshot({ ...deps, probeProviderStatus: undefined }), { probed: false });
});

test('prematch job: an expired snapshot no longer blocks the run forever', async () => {
  const make = probe => {
    let snapshot = {};
    return createPrematchPredictionJob({
      analyzeFixtureForSystem: async () => new Response('{}'),
      clock: () => NOW,
      getCache: async () => null,
      getStaleCache: async () => null,
      hasSupabase: () => true,
      loadSharedProviderState: async () => {},
      probeProviderStatus: probe ? async () => { snapshot = { plan: 'PRO' }; } : undefined,
      providerSnapshot: () => snapshot,
      supaRpc: async () => ({ allowed: true }),
      supaSelectMany: async () => [],
    });
  };
  assert.equal((await make(false).processPrematchPredictions({}, new Date(NOW))).reason, 'provider_daily_reserve');
  // После /status тариф известен, задание идёт дальше (ленты в кеше нет — дальше этого не идёт).
  assert.equal((await make(true).processPrematchPredictions({}, new Date(NOW))).reason, 'feed_not_cached');
});

test('in-play job: after the probe the live feed may be fetched from the provider', async () => {
  const run = async probe => {
    let snapshot = {};
    const network = [];
    const job = createInPlayTimelineJob({
      clock: () => NOW,
      getCache: async () => null,
      getModelProbabilities: async () => ({}),
      hasSupabase: () => true,
      loadProviderFixturesForDate: async (date, _cfg, options) => { network.push({ date, network: options?.allowNetwork }); return []; },
      probeProviderStatus: probe ? async () => { snapshot = { plan: 'PRO' }; } : undefined,
      providerSnapshot: () => snapshot,
      supaInsertIgnore: async () => {},
      supaSelectMany: async () => [],
    });
    await job.processInPlayTimeline({}, new Date(NOW));
    return network;
  };
  assert.ok((await run(false)).every(call => call.network !== true), 'unknown plan: no provider requests');
  assert.ok((await run(true)).some(call => call.network === true), 'plan confirmed by /status: feed is fetched');
});

test('worker wires the /status probe into both background jobs', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.equal(worker.match(/probeProviderStatus: \(\.\.\.args\) => probeProviderStatus\(\.\.\.args\)/g)?.length, 2);
  assert.match(worker, /apiFootball\('\/status', \{\}, cfg, \{ responseType: 'any', transportRetries: 0, timeoutMs: 5000 \}\)/);
  assert.match(worker, /memory\.providerStatusProbeAt/);
  assert.match(worker, /quotaFromStatusBody\(body, inferFootballPlan\)/);
});
