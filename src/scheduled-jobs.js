import { isDailyDigestExecutionWindow } from './daily-digest-delivery.js';

const GLOBAL_CRON_LEASE_SECONDS = 12 * 60;
const GLOBAL_CRON_RETENTION_SECONDS = 2 * 24 * 60 * 60;
const DAILY_TASK_LEASE_SECONDS = 10 * 60;
const DAILY_TASK_RETENTION_SECONDS = 4 * 24 * 60 * 60;

function shortReason(value, fallback='') {
  const text=String(value ?? fallback ?? '').trim();
  return text.slice(0,500);
}

export function normalizeScheduledTaskResult(task, value) {
  if (value?.__scheduledTaskResult === true) return value;

  const raw=value && typeof value==='object' ? value : {};
  const state=String(raw.status || raw.state || '').toLowerCase();
  const failedCount=Number(raw.failed || 0);

  let status='success';
  if (
    raw.ok===false
    || raw.failed===true
    || ['failed','failure','error'].includes(state)
  ) status='failed';
  else if (
    raw.degraded===true
    || state==='degraded'
    || (Number.isFinite(failedCount) && failedCount>0)
  ) status='degraded';
  else if (
    raw.skipped===true
    || typeof raw.skipped==='string'
    || state==='skipped'
  ) status='skipped';

  const reason=shortReason(
    raw.error
      || raw.reason
      || (typeof raw.skipped==='string' ? raw.skipped : '')
      || (status==='degraded' ? `partial_failures:${failedCount}` : ''),
    status,
  );

  return Object.freeze({
    __scheduledTaskResult:true,
    task:String(task || 'unknown'),
    ok:status!=='failed',
    status,
    reason,
    value,
  });
}

export function scheduledRunKey(scheduledAt) {
  return `cron:${new Date(scheduledAt).toISOString()}`;
}

export function dailyScheduledTaskKey(task, scheduledAt) {
  return `daily:${String(task || 'task')}:${new Date(scheduledAt).toISOString().slice(0,10)}`;
}

export function createScheduledJobsRuntime({
  settleBacktestDaily,
  processDueReminders,
  processLineupNotifications,
  processImportantChangeNotifications,
  processSmartNotifications,
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
  claimScheduledJob,
  completeScheduledJob,
  releaseScheduledJob,
} = {}) {
  function normalizedScheduledAt(controller) {
    const value = Number(controller?.scheduledTime || Date.now());
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : new Date();
  }

  function explicitTaskFailure(value) {
    const result=normalizeScheduledTaskResult('scheduled_task',value);
    return result.status==='failed' ? result.reason : '';
  }

  async function runTask(task, runner) {
    try {
      return normalizeScheduledTaskResult(task, await runner());
    } catch (error) {
      return normalizeScheduledTaskResult(task,{
        ok:false,
        status:'failed',
        error:error?.message || error,
      });
    }
  }

  async function runDailyTaskOnce(task, runner, cfg, scheduledAt) {
    if (typeof claimScheduledJob!=='function') return await runTask(task,runner);

    const claim=await claimScheduledJob(cfg,{
      jobKey:dailyScheduledTaskKey(task,scheduledAt),
      groupKey:`daily:${task}`,
      scheduledAt,
      leaseSeconds:DAILY_TASK_LEASE_SECONDS,
      retentionSeconds:DAILY_TASK_RETENTION_SECONDS,
    });

    if (!claim?.claimed) {
      return normalizeScheduledTaskResult(task,{
        skipped:claim?.reason || 'daily_task_not_claimed',
        lease:claim || null,
      });
    }

    const result=await runTask(task,runner);
    const retryable=result.status==='failed' || result.status==='degraded';
    const settled=retryable
      ? await Promise.resolve(releaseScheduledJob?.(cfg,claim)).catch(()=>false)
      : await Promise.resolve(completeScheduledJob?.(cfg,claim)).catch(()=>false);

    if (claim.persistent && settled!==true) {
      return Object.freeze({
        ...result,
        ok:result.status!=='failed',
        status:result.status==='failed' ? 'failed' : 'degraded',
        reason:shortReason(result.reason || 'scheduled_task_lease_settlement_failed'),
      });
    }
    return result;
  }

  function buildScheduledTaskPlan(cfg, scheduledAt) {
    const backtestTask = runTask('backtest', () => settleBacktestDaily(cfg));
    const remindersTask = runTask('reminders', () => processDueReminders(cfg));
    const lineupNotificationsTask = remindersTask
      .then(() => runTask('lineup_notifications', () => processLineupNotifications(cfg)));
    const importantChangeTask = lineupNotificationsTask
      .then(() => runTask('important_change_notifications', () => processImportantChangeNotifications(cfg)));
    const smartNotificationsTask = importantChangeTask
      .then(() => runTask('smart_notifications', () => processSmartNotifications(cfg)));
    const digestWindow = isDailyDigestExecutionWindow(scheduledAt);
    const dailyDigestTask = digestWindow
      ? backtestTask.then(() => runTask('daily_digest', () => processDailyDigests(cfg, scheduledAt)))
      : null;
    const postMatchPrerequisite = dailyDigestTask || backtestTask;
    const tasks = [
      ['reminders', remindersTask],
      ['lineup_notifications', lineupNotificationsTask],
      ['important_change_notifications', importantChangeTask],
      ['smart_notifications', smartNotificationsTask],
      ['backtest', backtestTask],
      ['post_match_return', postMatchPrerequisite.then(() => runTask('post_match_return', () => processPostMatchReturns(cfg)))],
    ];

    if (scheduledAt.getUTCMinutes() % 15 === 0) {
      const monitorAfterReminders = remindersTask
        .then(() => runTask('production_monitor', () => runProductionMonitor(cfg, scheduledAt)));
      tasks.push(['production_monitor', monitorAfterReminders]);
    }

    if (dailyDigestTask) tasks.push(['daily_digest', dailyDigestTask]);

    if (scheduledAt.getUTCHours() === 3 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['ops_cleanup', runDailyTaskOnce('ops_cleanup', () => cleanupOpsEvents(cfg), cfg, scheduledAt)]);
      tasks.push(['rate_window_cleanup', runDailyTaskOnce('rate_window_cleanup', () => cleanupRateWindows(cfg), cfg, scheduledAt)]);
      tasks.push(['growth_cleanup', runDailyTaskOnce('growth_cleanup', () => cleanupGrowthEvents(cfg), cfg, scheduledAt)]);
      tasks.push(['integrity_cleanup', runDailyTaskOnce('integrity_cleanup', () => cleanupIntegrityData(cfg), cfg, scheduledAt)]);
    }

    if (scheduledAt.getUTCHours() === 4 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['settlement_watchdog', backtestTask.then(() => runTask('settlement_watchdog', () => runSettlementWatchdog(cfg)))]);
    }

    if (scheduledAt.getUTCHours() === 5 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['settlement_finality', backtestTask.then(() => runTask('settlement_finality', () => runSettlementFinalityVerification(cfg)))]);
    }

    return tasks;
  }

  async function observeScheduledTasks(cfg, tasks) {
    const settled = await Promise.allSettled(tasks.map(([, promise]) => promise));
    const results=[];

    for (let i = 0; i < settled.length; i += 1) {
      const task = tasks[i]?.[0] || 'unknown';
      const entry = settled[i];
      const result = entry.status==='rejected'
        ? normalizeScheduledTaskResult(task,{ok:false,status:'failed',error:entry.reason?.message || entry.reason})
        : normalizeScheduledTaskResult(task,entry.value);
      results.push(result);

      if (result.status==='failed' || result.status==='degraded') {
        await recordOpsEvent(cfg, {
          severity: result.status==='failed' ? 'error' : 'warning',
          source: 'cron',
          eventType: 'scheduled_task',
          code: result.status==='failed' ? 'CRON_TASK_FAILED' : 'CRON_TASK_DEGRADED',
          message: result.reason || `Scheduled task reported ${result.status}`,
          meta: { task, disposition: result.status },
        }).catch(() => null);
      }
    }
    return results;
  }

  async function executeScheduledRun(controller, cfg) {
    const scheduledAt=normalizedScheduledAt(controller);
    let claim={
      claimed:true,
      persistent:false,
      reason:'lease_not_configured',
      jobKey:scheduledRunKey(scheduledAt),
      groupKey:'cron-global',
    };

    if (typeof claimScheduledJob==='function') {
      claim=await claimScheduledJob(cfg,{
        jobKey:scheduledRunKey(scheduledAt),
        groupKey:'cron-global',
        scheduledAt,
        leaseSeconds:GLOBAL_CRON_LEASE_SECONDS,
        retentionSeconds:GLOBAL_CRON_RETENTION_SECONDS,
      });
    }

    if (!claim?.claimed) {
      const skipped=normalizeScheduledTaskResult('scheduled_execution',{
        skipped:claim?.reason || 'lease_not_claimed',
        lease:claim || null,
      });
      if (claim?.reason==='lease_unavailable') {
        await recordOpsEvent(cfg,{
          severity:'error',
          source:'cron',
          eventType:'scheduled_execution',
          code:'CRON_EXECUTION_LEASE_UNAVAILABLE',
          message:'Scheduled execution skipped because the distributed lease backend is unavailable.',
          meta:{task:'scheduled_execution',disposition:'skipped',reason:claim.reason},
        }).catch(()=>null);
      }
      return [skipped];
    }

    try {
      const tasks=buildScheduledTaskPlan(cfg,scheduledAt);
      const results=await observeScheduledTasks(cfg,tasks);
      if (claim.persistent && typeof completeScheduledJob==='function') {
        const completed=await completeScheduledJob(cfg,claim);
        if (!completed) {
          const degraded=normalizeScheduledTaskResult('scheduled_execution',{
            degraded:true,
            reason:'execution_lease_completion_failed',
          });
          results.push(degraded);
          await recordOpsEvent(cfg,{
            severity:'warning',
            source:'cron',
            eventType:'scheduled_execution',
            code:'CRON_EXECUTION_LEASE_COMPLETE_FAILED',
            message:'Scheduled work completed but its distributed run marker could not be sealed.',
            meta:{task:'scheduled_execution',disposition:'degraded'},
          }).catch(()=>null);
        }
      }
      return results;
    } catch (error) {
      if (claim?.claimed && typeof releaseScheduledJob==='function') {
        await releaseScheduledJob(cfg,claim).catch(()=>false);
      }
      const failed=normalizeScheduledTaskResult('scheduled_execution',{
        ok:false,
        status:'failed',
        error:error?.message || error,
      });
      await recordOpsEvent(cfg,{
        severity:'error',
        source:'cron',
        eventType:'scheduled_execution',
        code:'CRON_EXECUTION_FAILED',
        message:failed.reason,
        meta:{task:'scheduled_execution',disposition:'failed'},
      }).catch(()=>null);
      return [failed];
    }
  }

  function handleScheduled(controller, cfg, ctx) {
    const execution=executeScheduledRun(controller,cfg);
    if (typeof ctx?.waitUntil === 'function') {
      ctx.waitUntil(execution);
      return undefined;
    }
    return execution;
  }

  return Object.freeze({
    normalizedScheduledAt,
    explicitTaskFailure,
    normalizeScheduledTaskResult,
    scheduledRunKey,
    dailyScheduledTaskKey,
    buildScheduledTaskPlan,
    observeScheduledTasks,
    executeScheduledRun,
    handleScheduled,
  });
}
