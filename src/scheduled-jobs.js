// Scheduled/background task orchestration boundary.
// Owns cron task planning, dependency ordering and generic failure observation only.
// Business task implementations remain injected by the composition root.

export function createScheduledJobsRuntime({
  settleBacktestDaily,
  processDueReminders,
  processPostMatchReturns,
  runProductionMonitor,
  processDailyDigests,
  cleanupOpsEvents,
  cleanupRateWindows,
  cleanupGrowthEvents,
  cleanupIntegrityData,
  runSettlementWatchdog,
  runSettlementFinalityVerification,
  recordOpsEvent,
} = {}) {
  function normalizedScheduledAt(controller) {
    const value = Number(controller?.scheduledTime || Date.now());
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : new Date();
  }

  function explicitTaskFailure(value) {
    if (!value || typeof value !== 'object' || value.ok !== false) return '';
    return String(value.error || value.reason || 'Scheduled task reported ok=false').slice(0, 500);
  }

  function buildScheduledTaskPlan(cfg, scheduledAt) {
    const backtestTask = Promise.resolve().then(() => settleBacktestDaily(cfg));
    const remindersTask = Promise.resolve().then(() => processDueReminders(cfg));
    const tasks = [
      ['reminders', remindersTask],
      ['backtest', backtestTask],
      ['post_match_return', backtestTask.then(() => processPostMatchReturns(cfg))],
    ];

    if (scheduledAt.getUTCMinutes() % 15 === 0) {
      // Preserve the existing load-smoothing contract: deep production checks
      // begin only after the latency-sensitive reminder read has settled.
      const monitorAfterReminders = remindersTask
        .catch(() => null)
        .then(() => runProductionMonitor(cfg, scheduledAt));
      tasks.push(['production_monitor', monitorAfterReminders]);
    }

    if (scheduledAt.getUTCHours() === 7 && scheduledAt.getUTCMinutes() < 10) {
      tasks.push(['daily_digest', Promise.resolve().then(() => processDailyDigests(cfg, scheduledAt))]);
    }

    if (scheduledAt.getUTCHours() === 3 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['ops_cleanup', Promise.resolve().then(() => cleanupOpsEvents(cfg))]);
      tasks.push(['rate_window_cleanup', Promise.resolve().then(() => cleanupRateWindows(cfg))]);
      tasks.push(['growth_cleanup', Promise.resolve().then(() => cleanupGrowthEvents(cfg))]);
      tasks.push(['integrity_cleanup', Promise.resolve().then(() => cleanupIntegrityData(cfg))]);
    }

    if (scheduledAt.getUTCHours() === 4 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['settlement_watchdog', backtestTask.then(() => runSettlementWatchdog(cfg))]);
    }

    if (scheduledAt.getUTCHours() === 5 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['settlement_finality', backtestTask.then(() => runSettlementFinalityVerification(cfg))]);
    }

    return tasks;
  }

  async function observeScheduledTasks(cfg, tasks) {
    const results = await Promise.allSettled(tasks.map(([, promise]) => promise));
    for (let i = 0; i < results.length; i += 1) {
      const task = tasks[i]?.[0] || 'unknown';
      const result = results[i];

      if (result.status === 'rejected') {
        await recordOpsEvent(cfg, {
          severity: 'error',
          source: 'cron',
          eventType: 'scheduled_task',
          code: 'CRON_TASK',
          message: result.reason?.message || result.reason,
          meta: { task, disposition: 'rejected' },
        }).catch(() => null);
        continue;
      }

      const reportedFailure = explicitTaskFailure(result.value);
      if (reportedFailure) {
        await recordOpsEvent(cfg, {
          severity: 'error',
          source: 'cron',
          eventType: 'scheduled_task',
          code: 'CRON_TASK',
          message: reportedFailure,
          meta: { task, disposition: 'reported_failure' },
        }).catch(() => null);
      }
    }
    return results;
  }

  function handleScheduled(controller, cfg, ctx) {
    const scheduledAt = normalizedScheduledAt(controller);
    const tasks = buildScheduledTaskPlan(cfg, scheduledAt);
    const execution = observeScheduledTasks(cfg, tasks);

    if (typeof ctx?.waitUntil === 'function') {
      ctx.waitUntil(execution);
      return undefined;
    }
    return execution;
  }

  return Object.freeze({
    normalizedScheduledAt,
    explicitTaskFailure,
    buildScheduledTaskPlan,
    observeScheduledTasks,
    handleScheduled,
  });
}
