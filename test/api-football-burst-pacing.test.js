import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiFootballGateway } from '../src/api-football-gateway.js';

const BURST_BODY = { errors: { rateLimit: 'Too many requests. You have exceeded the limit of requests per minute of your subscription.' }, response: [] };
const OK_BODY = { errors: [], response: [{ fixture: { id: 1 } }] };

function runtime({ provider, bodies, edge = false }) {
  const memory = { provider: { minuteLimit: 300, minuteRemaining: 299, dailyRemaining: 7000, ...provider } };
  const sleeps = [];
  const cooldowns = [];
  let fetches = 0;
  const queue = [...bodies];
  const gateway = createApiFootballGateway({
    memory,
    providerPlanLimits: { FREE: { minute: 10 }, PRO: { minute: 300 }, UNKNOWN: { minute: 10 } },
    providerBudgetFloors: { FREE: { minuteReserve: 2 }, PRO: { minuteReserve: 20 }, UNKNOWN: { minuteReserve: 2 } },
    hasSupabase: () => false,
    supaRpc: async () => ({ allowed: true }),
    bumpTelemetry: () => {},
    observeProviderRequest: () => {},
    recordOpsEvent: async () => {},
    loadSharedProviderState: async () => {},
    phase5ProviderUsage: () => {},
    persistSharedProviderCooldown: async (_cfg, seconds, reason) => { cooldowns.push({ seconds, reason }); },
    fetchWithTimeout: async () => {
      fetches += 1;
      const body = queue.length > 1 ? queue.shift() : queue[0];
      const headers = edge ? {} : { 'x-ratelimit-limit': '300', 'x-ratelimit-remaining': '299' };
      return new Response(JSON.stringify(body), { status: 200, headers });
    },
    updateProviderFromHeaders: () => {},
    persistSharedProviderQuota: async () => {},
    providerQuotaEvidence: () => {},
    providerSnapshot: () => ({ cooldownActive: false }),
    withSingleFlight: async (_key, fn) => fn(),
    sleepMs: async ms => { sleeps.push(ms); },
  });
  return { gateway, memory, sleeps, cooldowns, fetches: () => fetches };
}

const cfg = { apiFootballKey: 'test-key' };

test('PRO per-second burst rejection is retried once without a shared cooldown', async () => {
  const { gateway, sleeps, cooldowns, fetches } = runtime({ provider: { plan: 'PRO' }, bodies: [BURST_BODY, OK_BODY] });
  const rows = await gateway.apiFootball('/fixtures', { date: '2026-10-10' }, cfg);
  assert.equal(rows.length, 1);
  assert.equal(fetches(), 2);
  assert.deepEqual(cooldowns, []);
  assert.ok(sleeps.includes(1500));
});

test('a repeated burst rejection falls back to the normal cooldown', async () => {
  const { gateway, cooldowns, fetches } = runtime({ provider: { plan: 'PRO' }, bodies: [BURST_BODY] });
  await assert.rejects(
    () => gateway.apiFootball('/fixtures', { date: '2026-10-10' }, cfg),
    error => error?.code === 'FOOTBALL_RATE_LIMIT' && error?.burst !== true,
  );
  assert.equal(fetches(), 2);
  assert.deepEqual(cooldowns.map(item => item.seconds), [65]);
});

test('FREE plan keeps the minute-long cooldown on rate-limit rejections', async () => {
  const { gateway, cooldowns, fetches } = runtime({ provider: { plan: 'FREE', minuteLimit: 10, minuteRemaining: 8 }, bodies: [BURST_BODY] });
  await assert.rejects(
    () => gateway.apiFootball('/fixtures', { date: '2026-10-10' }, cfg),
    error => error?.code === 'FOOTBALL_RATE_LIMIT',
  );
  assert.equal(fetches(), 1);
  assert.deepEqual(cooldowns.map(item => item.seconds), [65]);
});

test('PRO with an exhausted minute quota is not treated as a burst', async () => {
  const { gateway, cooldowns, fetches } = runtime({ provider: { plan: 'PRO', minuteRemaining: 2 }, bodies: [BURST_BODY] });
  await assert.rejects(() => gateway.apiFootball('/fixtures', { date: '2026-10-10' }, cfg), error => error?.code === 'FOOTBALL_RATE_LIMIT');
  assert.equal(fetches(), 1);
  assert.deepEqual(cooldowns.map(item => item.seconds), [65]);
});

test('paid-plan requests are paced below the provider per-second limit', async () => {
  const { gateway, sleeps } = runtime({ provider: { plan: 'PRO' }, bodies: [OK_BODY] });
  await Promise.all([1, 2, 3, 4].map(id => gateway.apiFootball('/fixtures', { id }, cfg)));
  const waits = sleeps.filter(ms => ms > 0 && ms < 1500);
  assert.equal(waits.length, 3);
  assert.ok(waits[0] > 0 && waits[2] > waits[0], 'later requests wait longer than earlier ones');
});

test('header-less (edge) rejections are retried with growing pauses before a short cooldown', async () => {
  const { gateway, sleeps, cooldowns, fetches } = runtime({ provider: { plan: 'PRO' }, bodies: [BURST_BODY], edge: true });
  await assert.rejects(
    () => gateway.apiFootball('/fixtures', { date: '2026-10-10' }, cfg),
    error => error?.code === 'FOOTBALL_RATE_LIMIT',
  );
  assert.equal(fetches(), 4);
  assert.ok([1500, 2000, 3500].every(ms => sleeps.includes(ms)));
  assert.deepEqual(cooldowns.map(item => item.seconds), [30]);
});

test('an edge rejection followed by a success returns data without any cooldown', async () => {
  const { gateway, cooldowns, fetches } = runtime({ provider: { plan: 'PRO' }, bodies: [BURST_BODY, BURST_BODY, OK_BODY], edge: true });
  const rows = await gateway.apiFootball('/fixtures', { date: '2026-10-10' }, cfg);
  assert.equal(rows.length, 1);
  assert.equal(fetches(), 3);
  assert.deepEqual(cooldowns, []);
});
