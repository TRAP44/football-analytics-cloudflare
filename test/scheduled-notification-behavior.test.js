import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledJobsRuntime } from '../src/scheduled-jobs.js';

function makeRuntime(overrides = {}) {
  const calls = [];
  const ops = [];
  const ok = async name => { calls.push(name); return { ok: true }; };

  const runtime = createScheduledJobsRuntime({
    settleBacktestDaily: () => ok('backtest'),
    processDueReminders: () => ok('reminders'),
    processLineupNotifications: () => ok('lineup_notifications'),
    processImportantChangeNotifications: () => ok('important_change_notifications'),
    processSmartNotifications: () => ok('smart_notifications'),
    processPostMatchReturns: () => ok('post_match_return'),
    runProductionMonitor: () => ok('production_monitor'),
    processDailyDigests: () => ok('daily_digest'),
    cleanupOpsEvents: () => ok('ops_cleanup'),
    cleanupRateWindows: () => ok('rate_window_cleanup'),
    cleanupScheduledJobLeases: () => ok('scheduled_lease_cleanup'),
    cleanupGrowthEvents: () => ok('growth_cleanup'),
    cleanupIntegrityData: () => ok('integrity_cleanup'),
    runSettlementWatchdog: () => ok('settlement_watchdog'),
    runSettlementFinalityVerification: () => ok('settlement_finality'),
    recordOpsEvent: async (cfg, event) => {
      ops.push(event);
      return { ok: true };
    },
    ...overrides,
  });

  return { runtime, calls, ops };
}

test('scheduled notification chain executes real reminder and notification tasks', async () => {
  const { runtime, calls } = makeRuntime();
  const controller = { scheduledTime: Date.parse('2026-10-05T12:07:00.000Z') };

  const results = await runtime.executeScheduledRun(controller, {});

  assert.ok(results.some(result => result.task === 'reminders' && result.status === 'ok'));
  assert.ok(results.some(result => result.task === 'lineup_notifications' && result.status === 'ok'));
  assert.ok(results.some(result => result.task === 'important_change_notifications' && result.status === 'ok'));
  assert.ok(results.some(result => result.task === 'smart_notifications' && result.status === 'ok'));

  const reminderIndex = calls.indexOf('reminders');
  const lineupIndex = calls.indexOf('lineup_notifications');
  const importantIndex = calls.indexOf('important_change_notifications');
  const smartIndex = calls.indexOf('smart_notifications');

  assert.ok(reminderIndex >= 0);
  assert.ok(lineupIndex > reminderIndex);
  assert.ok(importantIndex > lineupIndex);
  assert.ok(smartIndex > importantIndex);
});

test('one notification provider failure is isolated and emitted as a failed scheduled task event', async () => {
  const { runtime, calls, ops } = makeRuntime({
    processImportantChangeNotifications: async () => {
      calls.push('important_change_notifications');
      throw new Error('provider unavailable');
    },
  });
  const controller = { scheduledTime: Date.parse('2026-10-05T12:07:00.000Z') };

  const results = await runtime.executeScheduledRun(controller, {});

  const failed = results.find(result => result.task === 'important_change_notifications');
  assert.equal(failed?.status, 'failed');
  assert.match(failed?.reason || '', /provider unavailable/);

  assert.ok(calls.includes('smart_notifications'), 'later notification work must continue after an isolated failure');
  assert.ok(ops.some(event =>
    event.code === 'CRON_TASK_FAILED'
    && event.meta?.task === 'important_change_notifications'
    && event.meta?.disposition === 'failed'
  ));
});

test('degraded reminder delivery is surfaced as degraded without aborting later notifications', async () => {
  const { runtime, calls, ops } = makeRuntime({
    processDueReminders: async () => {
      calls.push('reminders');
      return { failed: 2, sent: 8 };
    },
  });
  const controller = { scheduledTime: Date.parse('2026-10-05T12:07:00.000Z') };

  const results = await runtime.executeScheduledRun(controller, {});

  const reminders = results.find(result => result.task === 'reminders');
  assert.equal(reminders?.status, 'degraded');
  assert.equal(reminders?.reason, 'partial_failures:2');
  assert.ok(calls.includes('lineup_notifications'));
  assert.ok(calls.includes('important_change_notifications'));
  assert.ok(calls.includes('smart_notifications'));
  assert.ok(ops.some(event =>
    event.code === 'CRON_TASK_DEGRADED'
    && event.meta?.task === 'reminders'
  ));
});
