import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_DIGEST_POLICY,
  estimateDigestOrchestration,
  isDailyDigestExecutionWindow,
  planDailyDigestRecipients,
  runBoundedDailyDigest,
} from '../src/daily-digest-delivery.js';

const DATE = '2026-09-29';

function rows(count) {
  return Array.from({ length: count }, (_, index) => ({
    telegram_id: index + 1,
    chat_id: 10000 + index,
    enabled: true,
    hour_utc: 7,
    last_sent_date: null,
    delivery_claim_date: null,
  }));
}

function virtualClock() {
  let value = 0;
  return {
    now: () => value,
    sleep: async ms => { value += Math.max(0, Number(ms || 0)); },
    value: () => value,
  };
}

function statefulDelivery(seed) {
  const state = new Map(seed.map(row => [row.telegram_id, { ...row }]));
  const sent = [];
  const news = [];
  return {
    state,
    sent,
    news,
    snapshot: () => [...state.values()].sort((a, b) => a.telegram_id - b.telegram_id),
    claim: async (row, date) => {
      const current = state.get(row.telegram_id);
      if (!current || current.last_sent_date === date || current.delivery_claim_date === date) return false;
      current.delivery_claim_date = date;
      return true;
    },
    complete: async (row, date) => {
      const current = state.get(row.telegram_id);
      current.last_sent_date = date;
      current.delivery_claim_date = null;
      return true;
    },
    sendDigest: async row => { sent.push(row.telegram_id); },
    sendNews: async row => { news.push(row.telegram_id); },
  };
}

function options(plan, delivery, overrides = {}) {
  const clock = overrides.clock || virtualClock();
  return {
    plan,
    date: DATE,
    claim: delivery.claim,
    complete: delivery.complete,
    sendDigest: delivery.sendDigest,
    sendNews: delivery.sendNews,
    now: clock.now,
    sleep: clock.sleep,
    minSendIntervalMs: 1,
    concurrency: 4,
    executionBudgetMs: 60000,
    ...overrides,
    clock: undefined,
  };
}

test('A. small run processes every subscriber and keeps one main delivery per subscriber/date', async () => {
  const source = rows(8);
  const delivery = statefulDelivery(source);
  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 100 });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(result.eligible, 8);
  assert.equal(result.claimed, 8);
  assert.equal(result.sent, 8);
  assert.equal(result.failed, 0);
  assert.equal(result.remaining, 0);
  assert.deepEqual(delivery.sent, [1,2,3,4,5,6,7,8]);
  assert.equal(new Set(delivery.sent).size, 8);
});

test('B. multi-page plan processes all rows when the execution budget permits it', async () => {
  const source = rows(1200);
  const delivery = statefulDelivery(source);
  const plan = planDailyDigestRecipients(source, { date: DATE, pageSize: 500, maxRecipients: 2000 });
  const result = await runBoundedDailyDigest(options(plan, delivery, { maxRecipients: 2000, concurrency: 4 }));

  assert.equal(plan.pages, 3);
  assert.equal(result.sent, 1200);
  assert.equal(result.remaining, 0);
});

test('C. bounded execution stops at the configured recipient cap and reports deferred backlog', async () => {
  const source = rows(5);
  const delivery = statefulDelivery(source);
  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 2 });
  const result = await runBoundedDailyDigest(options(plan, delivery, { maxRecipients: 2 }));

  assert.equal(result.sent, 2);
  assert.equal(result.deferred, 3);
  assert.equal(result.remaining, 3);
  assert.equal(result.backlog, 3);
});

test('D/E. continuation advances through persistent completion state without starving later subscribers', async () => {
  const delivery = statefulDelivery(rows(7));

  for (let invocation = 0; invocation < 4; invocation += 1) {
    const plan = planDailyDigestRecipients(delivery.snapshot(), { date: DATE, maxRecipients: 2 });
    await runBoundedDailyDigest(options(plan, delivery, { maxRecipients: 2 }));
  }

  assert.deepEqual(delivery.sent, [1,2,3,4,5,6,7]);
  assert.equal(new Set(delivery.sent).size, 7);
  const finalPlan = planDailyDigestRecipients(delivery.snapshot(), { date: DATE, maxRecipients: 2 });
  assert.equal(finalPlan.pending.length, 0);
  assert.equal(finalPlan.eligible, 0);
});

test('F. duplicate cron executions share claims and never create duplicate main deliveries', async () => {
  const source = rows(20);
  const delivery = statefulDelivery(source);
  const planA = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 20 });
  const planB = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 20 });
  const a = virtualClock();
  const b = virtualClock();

  const [first, second] = await Promise.all([
    runBoundedDailyDigest(options(planA, delivery, { clock: a, now: a.now, sleep: a.sleep, maxRecipients: 20 })),
    runBoundedDailyDigest(options(planB, delivery, { clock: b, now: b.now, sleep: b.sleep, maxRecipients: 20 })),
  ]);

  assert.equal(delivery.sent.length, 20);
  assert.equal(new Set(delivery.sent).size, 20);
  assert.ok(first.duplicate + second.duplicate >= 20);
});

test('G. one recipient failure does not block the rest and its persistent claim suppresses unsafe replay', async () => {
  const source = rows(4);
  const delivery = statefulDelivery(source);
  delivery.sendDigest = async row => {
    if (row.telegram_id === 2) {
      const error = new Error('network outcome unknown');
      error.code = 'TELEGRAM_NETWORK';
      throw error;
    }
    delivery.sent.push(row.telegram_id);
  };

  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 10 });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(result.sent, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.ambiguous, 1);
  assert.deepEqual(delivery.sent, [1,3,4]);
  const next = planDailyDigestRecipients(delivery.snapshot(), { date: DATE, maxRecipients: 10 });
  assert.equal(next.pending.length, 0);
  assert.equal(next.duplicate, 1);
});

test('H. Telegram 429 honors retry_after once and never enters an uncontrolled retry loop', async () => {
  const source = rows(1);
  const delivery = statefulDelivery(source);
  const clock = virtualClock();
  let calls = 0;
  delivery.sendDigest = async row => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Too Many Requests');
      error.code = 'TELEGRAM_RATE_LIMIT';
      error.status = 429;
      error.retryAfter = 2;
      throw error;
    }
    delivery.sent.push(row.telegram_id);
  };

  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 1 });
  const result = await runBoundedDailyDigest(options(plan, delivery, {
    clock,
    now: clock.now,
    sleep: clock.sleep,
    concurrency: 1,
  }));

  assert.equal(calls, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.rateLimited, 1);
  assert.equal(result.retries, 1);
  assert.ok(result.durationMs >= 2000);
});

test('I. global scan cap remains observable and is never reported as a complete scan', () => {
  const source = rows(DAILY_DIGEST_POLICY.scanCap);
  const plan = planDailyDigestRecipients(source, {
    date: DATE,
    pageSize: DAILY_DIGEST_POLICY.pageSize,
    truncated: true,
  });

  assert.equal(plan.scanned, 10000);
  assert.equal(plan.pages, 20);
  assert.equal(plan.truncated, true);
  assert.equal(plan.remaining, 9000);
});

test('J. empty run is a clean no-op', async () => {
  const delivery = statefulDelivery([]);
  const plan = planDailyDigestRecipients([], { date: DATE });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(result.scanned, 0);
  assert.equal(result.eligible, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.remaining, 0);
});

test('daily digest continuation window uses every five-minute cron slot during 07 UTC only', () => {
  assert.equal(isDailyDigestExecutionWindow(new Date('2026-09-29T07:00:00Z')), true);
  assert.equal(isDailyDigestExecutionWindow(new Date('2026-09-29T07:55:00Z')), true);
  assert.equal(isDailyDigestExecutionWindow(new Date('2026-09-29T06:55:00Z')), false);
  assert.equal(isDailyDigestExecutionWindow(new Date('2026-09-29T08:00:00Z')), false);
});

test('controlled performance model covers 100 / 1k / 5k / 10k recipients', () => {
  const samples = [100, 1000, 5000, 10000].map(count => estimateDigestOrchestration(count));
  assert.deepEqual(samples.map(x => x.recipients), [100, 1000, 5000, 10000]);
  assert.deepEqual(samples.map(x => x.oldMinimumMs), [4000, 49000, 249000, 499000]);
  assert.deepEqual(samples.map(x => x.runs), [1, 1, 5, 10]);
  assert.deepEqual(samples.map(x => x.activeMsPerRun), [10000, 100000, 100000, 100000]);
  assert.deepEqual(samples.map(x => x.completionWindowMs), [10000, 100000, 1300000, 2800000]);
});
