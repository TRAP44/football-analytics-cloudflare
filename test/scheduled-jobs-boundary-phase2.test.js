import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledJobsRuntime } from '../src/scheduled-jobs.js';

function runtime(overrides = {}) {
  const calls = [];
  const events = [];
  const deps = {
    settleBacktestDaily: async () => { calls.push('backtest'); return { ok: true }; },
    processDueReminders: async () => { calls.push('reminders'); return { checked: 0, failed: 0 }; },
    processPostMatchReturns: async () => { calls.push('post_match_return'); return { checked: 0, failed: 0 }; },
    runProductionMonitor: async () => { calls.push('production_monitor'); return { ok: true }; },
    processDailyDigests: async () => { calls.push('daily_digest'); return { sent: 0 }; },
    cleanupOpsEvents: async () => { calls.push('ops_cleanup'); return { ok: true }; },
    cleanupRateWindows: async () => { calls.push('rate_window_cleanup'); return { ok: true }; },
    cleanupGrowthEvents: async () => { calls.push('growth_cleanup'); return { ok: true }; },
    cleanupIntegrityData: async () => { calls.push('integrity_cleanup'); return { ok: true }; },
    runSettlementWatchdog: async () => { calls.push('settlement_watchdog'); return { ok: true }; },
    runSettlementFinalityVerification: async () => { calls.push('settlement_finality'); return { ok: true }; },
    recordOpsEvent: async (_cfg, event) => { events.push(event); },
    ...overrides,
  };
  return { api: createScheduledJobsRuntime(deps), calls, events };
}

test('scheduled boundary preserves the base task graph and post-match dependency on backtest', async () => {
  let releaseBacktest;
  const backtest = new Promise(resolve => { releaseBacktest = resolve; });
  let postMatchStarted = false;
  const rt = runtime({
    settleBacktestDaily: () => backtest,
    processPostMatchReturns: async () => {
      postMatchStarted = true;
      return { checked: 0, failed: 0 };
    },
  });

  const tasks = rt.api.buildScheduledTaskPlan({}, new Date('2026-09-28T12:05:00.000Z'));
  assert.deepEqual(tasks.map(([name]) => name), ['reminders', 'backtest', 'post_match_return']);
  await Promise.resolve();
  assert.equal(postMatchStarted, false);

  releaseBacktest({ ok: true });
  await rt.api.observeScheduledTasks({}, tasks);
  assert.equal(postMatchStarted, true);
});

test('scheduled boundary preserves time-gated cron task cadence', async () => {
  const cases = [
    ['2026-09-28T03:05:00.000Z', ['reminders','backtest','post_match_return','ops_cleanup','rate_window_cleanup','growth_cleanup','integrity_cleanup']],
    ['2026-09-28T04:05:00.000Z', ['reminders','backtest','post_match_return','settlement_watchdog']],
    ['2026-09-28T05:05:00.000Z', ['reminders','backtest','post_match_return','settlement_finality']],
    ['2026-09-28T07:05:00.000Z', ['reminders','backtest','post_match_return','daily_digest']],
    ['2026-09-28T12:15:00.000Z', ['reminders','backtest','post_match_return','production_monitor']],
  ];

  for (const [iso, expected] of cases) {
    const rt = runtime();
    const tasks = rt.api.buildScheduledTaskPlan({}, new Date(iso));
    assert.deepEqual(tasks.map(([name]) => name), expected, iso);
    await rt.api.observeScheduledTasks({}, tasks);
  }
});

test('production monitor still waits for reminders to settle before starting', async () => {
  let releaseReminders;
  const reminders = new Promise((_, reject) => { releaseReminders = reject; });
  let monitorStarted = false;
  const rt = runtime({
    processDueReminders: () => reminders,
    runProductionMonitor: async () => {
      monitorStarted = true;
      return { ok: true };
    },
  });

  const tasks = rt.api.buildScheduledTaskPlan({}, new Date('2026-09-28T12:15:00.000Z'));
  await Promise.resolve();
  assert.equal(monitorStarted, false);
  releaseReminders(new Error('reminder read failed'));
  await rt.api.observeScheduledTasks({}, tasks);
  assert.equal(monitorStarted, true);
});

test('cron observer records rejected and explicit ok=false task results without treating skips as failures', async () => {
  const rt = runtime();
  const tasks = [
    ['reported_cleanup_failure', Promise.resolve({ ok: false, error: 'database unavailable' })],
    ['normal_skip', Promise.resolve({ skipped: true })],
    ['rejected_task', Promise.reject(new Error('network failed'))],
  ];

  const results = await rt.api.observeScheduledTasks({}, tasks);
  assert.equal(results.length, 3);
  assert.equal(rt.events.length, 2);

  assert.deepEqual(rt.events.map(event => [event.code, event.meta.task, event.meta.disposition]), [
    ['CRON_TASK', 'reported_cleanup_failure', 'reported_failure'],
    ['CRON_TASK', 'rejected_task', 'rejected'],
  ]);
  assert.equal(rt.events[0].severity, 'error');
  assert.equal(rt.events[0].message, 'database unavailable');
  assert.equal(rt.events[1].message, 'network failed');
});

test('scheduled handler registers execution with waitUntil and does not create a second execution path', async () => {
  const rt = runtime();
  const registered = [];
  const result = rt.api.handleScheduled(
    { scheduledTime: Date.parse('2026-09-28T12:05:00.000Z') },
    {},
    { waitUntil: promise => registered.push(promise) },
  );

  assert.equal(result, undefined);
  assert.equal(registered.length, 1);
  await registered[0];
});

test('worker delegates scheduled orchestration and integrity cleanup reports partial failures', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.match(worker, /import \{ createScheduledJobsRuntime \} from '\.\/scheduled-jobs\.js';/);
  assert.match(worker, /const \{ handleScheduled \} = createScheduledJobsRuntime\(\{/);
  assert.match(worker, /return handleScheduled\(controller, cfg, ctx\);/);
  assert.doesNotMatch(worker, /Promise\.allSettled\(tasks\.map\(\(\[, promise\]\) => promise\)\)/);
  assert.match(worker, /failedTables\.push\(\{/);
  assert.match(worker, /Integrity cleanup failed for:/);
});
