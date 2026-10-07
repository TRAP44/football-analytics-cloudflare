import { isDailyDigestExecutionWindow } from './daily-digest-delivery.js';

const GLOBAL_CRON_LEASE_SECONDS = 12 * 60;
const GLOBAL_CRON_HEARTBEAT_INTERVAL_MS = Math.floor(GLOBAL_CRON_LEASE_SECONDS * 1000 / 3);
const GLOBAL_CRON_RETENTION_SECONDS = 2 * 24 * 60 * 60;
const DAILY_TASK_LEASE_SECONDS = 10 * 60;
const DAILY_TASK_RETENTION_SECONDS = 4 * 24 * 60 * 60;
const MAX_TIMESTAMP_MS = 8.64e15;
const MAX_HEARTBEAT_INTERVAL_MS = Math.floor(GLOBAL_CRON_LEASE_SECONDS * 1000 / 2);
const TASK_NAME_RE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function nonNegativeInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number >= 0 ? number : null;
}

function shortReason(value, fallback='') {
  const candidate=typeof value === 'string'
    ? value
    : typeof fallback === 'string'
      ? fallback
      : '';
  const raw=candidate.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) {
    return typeof fallback === 'string' ? fallback.trim().slice(0,500) : '';
  }
  return raw.replace(/\s+/gu,' ').slice(0,500);
}

function taskName(value,fallback='unknown') {
  if (typeof value !== 'string') return fallback;
  const task=value.trim().toLowerCase();
  return TASK_NAME_RE.test(task) ? task : fallback;
}

function scheduledDate(value) {
  if (value instanceof Date) {
    const timestamp=value.getTime();
    return Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= MAX_TIMESTAMP_MS
      ? new Date(timestamp)
      : null;
  }
  if (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_TIMESTAMP_MS
  ) {
    const date=new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function heartbeatInterval(value) {
  const interval=integerCandidate(value);
  if (interval === null || interval < 10 || interval > MAX_HEARTBEAT_INTERVAL_MS) {
    return GLOBAL_CRON_HEARTBEAT_INTERVAL_MS;
  }
  return interval;
}

function leaseSeconds(value,fallback=GLOBAL_CRON_LEASE_SECONDS) {
  const seconds=integerCandidate(value);
  if (seconds === null || seconds < 30 || seconds > 1800) return fallback;
  return seconds;
}

function cleanLeaseIdentity(value,maxLength) {
  if (typeof value !== 'string') return '';
  const raw=value.trim();
  if (!raw || raw.length > maxLength || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return '';
  return raw;
}

function validExecutionClaim(claim,{jobKey='',groupKey=''}={}) {
  const source=plainObject(claim);
  if (!source || source.claimed !== true || typeof source.persistent !== 'boolean') return false;
  const actualJobKey=cleanLeaseIdentity(source.jobKey,180);
  const actualGroupKey=cleanLeaseIdentity(source.groupKey,120);
  if (jobKey && actualJobKey !== jobKey) return false;
  if (groupKey && actualGroupKey !== groupKey) return false;
  if (source.persistent === true) {
    const token=cleanLeaseIdentity(source.leaseToken,80);
    if (!actualJobKey || !actualGroupKey || !token) return false;
  }
  return true;
}

export function normalizeScheduledTaskResult(task, value) {
  const raw=plainObject(value) || {};
  const state=typeof raw.status === 'string'
    ? raw.status.trim().toLowerCase()
    : typeof raw.state === 'string'
      ? raw.state.trim().toLowerCase()
      : '';
  const failedCount=nonNegativeInteger(raw.failed);
  const invalidContract=Boolean(
    value !== undefined
    && value !== null
    && !plainObject(value)
  ) || (
    Object.hasOwn(raw,'ok') && typeof raw.ok !== 'boolean'
  ) || (
    Object.hasOwn(raw,'failed')
    && typeof raw.failed !== 'boolean'
    && nonNegativeInteger(raw.failed) === null
  ) || (
    Object.hasOwn(raw,'degraded') && typeof raw.degraded !== 'boolean'
  );

  let status='ok';
  if (
    raw.failed === true
    || ['failed','failure','error'].includes(state)
    || (
      raw.ok === false
      && state !== 'degraded'
      && state !== 'skipped'
      && raw.degraded !== true
      && raw.skipped !== true
      && !(typeof raw.skipped === 'string' && raw.skipped.trim())
    )
  ) status='failed';
  else if (
    raw.degraded === true
    || state === 'degraded'
    || (failedCount !== null && failedCount > 0)
    || invalidContract
  ) status='degraded';
  else if (
    raw.skipped === true
    || (typeof raw.skipped === 'string' && raw.skipped.trim())
    || state === 'skipped'
  ) status='skipped';

  const reason=shortReason(
    typeof raw.error === 'string' ? raw.error
      : typeof raw.reason === 'string' ? raw.reason
        : typeof raw.skipped === 'string' ? raw.skipped
          : invalidContract ? 'malformed_task_result'
            : status === 'degraded' && failedCount !== null
              ? `partial_failures:${failedCount}`
              : '',
    status,
  );

  return Object.freeze({
    __scheduledTaskResult:true,
    task:taskName(task),
    ok:status === 'ok',
    status,
    reason,
    value:raw.__scheduledTaskResult === true && Object.hasOwn(raw,'value')
      ? raw.value
      : value,
  });
}

export function scheduledRunKey(scheduledAt) {
  const date=scheduledDate(scheduledAt);
  if (!date) throw new TypeError('scheduledAt must be a valid Date or epoch milliseconds');
  return `cron:${date.toISOString()}`;
}

export function dailyScheduledTaskKey(task, scheduledAt) {
  const safeTask=taskName(task,'');
  const date=scheduledDate(scheduledAt);
  if (!safeTask || !date) {
    throw new TypeError('daily scheduled task identity is invalid');
  }
  return `daily:${safeTask}:${date.toISOString().slice(0,10)}`;
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
  cleanupScheduledJobLeases,
  cleanupGrowthEvents,
  cleanupIntegrityData,
  runSettlementWatchdog,
  runSettlementFinalityVerification,
  recordOpsEvent,
  claimScheduledJob,
  renewScheduledJob,
  completeScheduledJob,
  releaseScheduledJob,
  leaseHeartbeatIntervalMs=GLOBAL_CRON_HEARTBEAT_INTERVAL_MS,
  setHeartbeatTimeout=setTimeout,
  clearHeartbeatTimeout=clearTimeout,
} = {}) {
  const timerSet=typeof setHeartbeatTimeout === 'function' ? setHeartbeatTimeout : setTimeout;
  const timerClear=typeof clearHeartbeatTimeout === 'function' ? clearHeartbeatTimeout : clearTimeout;
  const heartbeatMs=heartbeatInterval(leaseHeartbeatIntervalMs);

  async function safeRecordOpsEvent(cfg,event) {
    if (typeof recordOpsEvent !== 'function') return false;
    try {
      await recordOpsEvent(cfg,event);
      return true;
    } catch {
      return false;
    }
  }

  function normalizedScheduledAt(controller) {
    const source=plainObject(controller);
    return source ? scheduledDate(source.scheduledTime) : null;
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

  function ownershipLostResult(task, ownershipState) {
    return normalizeScheduledTaskResult(task,{
      skipped:ownershipState?.reason || 'execution_lease_ownership_lost',
    });
  }

  async function runOwnedTask(task, runner, ownershipState) {
    if (ownershipState?.lost) return ownershipLostResult(task,ownershipState);
    return await runTask(task,runner);
  }

  async function startScheduledLeaseHeartbeat(cfg, claim={}) {
    const state={
      lost:false,
      reason:'',
      stopped:false,
      renewals:0,
    };
    const emptyController={
      state,
      done:Promise.resolve(),
      stop:async()=>{},
    };
    if (claim?.persistent !== true) return emptyController;

    const renew=typeof renewScheduledJob==='function'
      ? () => renewScheduledJob(cfg,claim,leaseSeconds(claim?.leaseSeconds))
      : typeof claim?.renew==='function'
        ? () => claim.renew()
        : null;

    async function markLost(reason='lease_renewal_failed') {
      if (state.lost) return;
      state.lost=true;
      state.reason=shortReason(reason,'lease_renewal_failed');
      await safeRecordOpsEvent(cfg,{
        severity:'error',
        source:'cron',
        eventType:'scheduled_execution',
        code:'CRON_EXECUTION_LEASE_HEARTBEAT_LOST',
        message:'Scheduled execution stopped launching new work because distributed lease ownership could not be renewed.',
        meta:{
          task:'scheduled_execution',
          disposition:'degraded',
          reason:state.reason,
          jobKey:String(claim?.jobKey || '').slice(0,180),
          groupKey:String(claim?.groupKey || '').slice(0,120),
        },
      });
    }

    if (!validExecutionClaim(claim,{
      jobKey:cleanLeaseIdentity(claim?.jobKey,180),
      groupKey:cleanLeaseIdentity(claim?.groupKey,120),
    })) {
      await markLost('invalid_lease_claim');
      return emptyController;
    }

    async function renewOnce() {
      if (!renew) {
        await markLost('renew_not_configured');
        return false;
      }
      let result;
      try {
        result=await renew();
      } catch {
        result={renewed:false,reason:'lease_unavailable'};
      }
      if (result?.renewed !== true) {
        await markLost(result?.reason || 'lease_renewal_failed');
        return false;
      }
      state.renewals+=1;
      if (
        typeof result?.lockedUntil === 'string'
        && Number.isFinite(Date.parse(result.lockedUntil))
      ) claim.lockedUntil=result.lockedUntil;
      return true;
    }

    if (!await renewOnce()) return emptyController;

    const intervalMs=heartbeatMs;
    let wakeSleep=null;

    function sleepUntilHeartbeat() {
      return new Promise((resolve,reject)=>{
        let timer;
        try {
          timer=timerSet(()=>{
            wakeSleep=null;
            resolve();
          },intervalMs);
        } catch (error) {
          reject(error);
          return;
        }
        wakeSleep=()=>{
          try { timerClear(timer); } catch {}
          wakeSleep=null;
          resolve();
        };
      });
    }

    const done=(async()=>{
      while (!state.stopped && !state.lost) {
        try {
          await sleepUntilHeartbeat();
        } catch {
          await markLost('heartbeat_timer_failed');
          break;
        }
        if (state.stopped || state.lost) break;
        await renewOnce();
      }
    })();

    return {
      state,
      done,
      stop:async()=>{
        state.stopped=true;
        wakeSleep?.();
        await done.catch(()=>{});
      },
    };
  }

  async function runDailyTaskOnce(task, runner, cfg, scheduledAt, ownershipState) {
    if (ownershipState?.lost) return ownershipLostResult(task,ownershipState);
    if (typeof claimScheduledJob!=='function') return await runOwnedTask(task,runner,ownershipState);

    let claim;
    try {
      claim=await claimScheduledJob(cfg,{
        jobKey:dailyScheduledTaskKey(task,scheduledAt),
        groupKey:`daily:${taskName(task)}`,
        scheduledAt,
        leaseSeconds:DAILY_TASK_LEASE_SECONDS,
        retentionSeconds:DAILY_TASK_RETENTION_SECONDS,
      });
    } catch (error) {
      return normalizeScheduledTaskResult(task,{
        ok:false,
        status:'failed',
        reason:shortReason(error?.message,'daily_task_lease_unavailable'),
      });
    }

    const expectedDailyJobKey=dailyScheduledTaskKey(task,scheduledAt);
    const expectedDailyGroupKey=`daily:${taskName(task)}`;
    if (claim?.claimed !== true) {
      return normalizeScheduledTaskResult(task,{
        skipped:typeof claim?.reason === 'string' ? claim.reason : 'daily_task_not_claimed',
        lease:plainObject(claim),
      });
    }
    if (!validExecutionClaim(claim,{
      jobKey:expectedDailyJobKey,
      groupKey:expectedDailyGroupKey,
    })) {
      return normalizeScheduledTaskResult(task,{
        ok:false,
        status:'failed',
        reason:'invalid_daily_task_lease_claim',
      });
    }

    if (ownershipState?.lost) {
      await Promise.resolve(releaseScheduledJob?.(cfg,claim)).catch(()=>false);
      return ownershipLostResult(task,ownershipState);
    }

    const result=await runOwnedTask(task,runner,ownershipState);
    const retryable=result.status==='failed' || result.status==='degraded';
    const settled=retryable
      ? await Promise.resolve(releaseScheduledJob?.(cfg,claim)).catch(()=>false)
      : await Promise.resolve(completeScheduledJob?.(cfg,claim)).catch(()=>false);

    if (claim?.persistent === true && settled !== true) {
      return Object.freeze({
        ...result,
        ok:false,
        status:result.status==='failed' ? 'failed' : 'degraded',
        reason:shortReason(result.reason || 'scheduled_task_lease_settlement_failed'),
      });
    }
    return result;
  }

  function buildScheduledTaskPlan(cfg, scheduledAt, ownershipState) {
    const normalizedDate=scheduledDate(scheduledAt);
    if (!normalizedDate) throw new TypeError('scheduledAt is invalid');
    scheduledAt=normalizedDate;
    const run=(task,runner)=>runOwnedTask(task,runner,ownershipState);
    const backtestTask = run('backtest', () => settleBacktestDaily(cfg));
    const remindersTask = run('reminders', () => processDueReminders(cfg));
    const lineupNotificationsTask = remindersTask
      .then(() => run('lineup_notifications', () => processLineupNotifications(cfg)));
    const importantChangeTask = lineupNotificationsTask
      .then(() => run('important_change_notifications', () => processImportantChangeNotifications(cfg)));
    const smartNotificationsTask = importantChangeTask
      .then(() => run('smart_notifications', () => processSmartNotifications(cfg)));
    const digestWindow = isDailyDigestExecutionWindow(scheduledAt);
    const dailyDigestTask = digestWindow
      ? backtestTask.then(() => run('daily_digest', () => processDailyDigests(cfg, scheduledAt)))
      : null;
    const postMatchPrerequisite = dailyDigestTask || backtestTask;
    const tasks = [
      ['reminders', remindersTask],
      ['lineup_notifications', lineupNotificationsTask],
      ['important_change_notifications', importantChangeTask],
      ['smart_notifications', smartNotificationsTask],
      ['backtest', backtestTask],
      ['post_match_return', postMatchPrerequisite.then(() => run('post_match_return', () => processPostMatchReturns(cfg)))],
    ];

    if (scheduledAt.getUTCMinutes() % 15 === 0) {
      const monitorAfterReminders = remindersTask
        .then(() => run('production_monitor', () => runProductionMonitor(cfg, scheduledAt)));
      tasks.push(['production_monitor', monitorAfterReminders]);
    }

    if (dailyDigestTask) tasks.push(['daily_digest', dailyDigestTask]);

    if (scheduledAt.getUTCHours() === 3 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['ops_cleanup', runDailyTaskOnce('ops_cleanup', () => cleanupOpsEvents(cfg), cfg, scheduledAt, ownershipState)]);
      tasks.push(['rate_window_cleanup', runDailyTaskOnce('rate_window_cleanup', () => cleanupRateWindows(cfg), cfg, scheduledAt, ownershipState)]);
      tasks.push(['scheduled_lease_cleanup', runDailyTaskOnce('scheduled_lease_cleanup', () => cleanupScheduledJobLeases(cfg), cfg, scheduledAt, ownershipState)]);
      tasks.push(['growth_cleanup', runDailyTaskOnce('growth_cleanup', () => cleanupGrowthEvents(cfg), cfg, scheduledAt, ownershipState)]);
      tasks.push(['integrity_cleanup', runDailyTaskOnce('integrity_cleanup', () => cleanupIntegrityData(cfg), cfg, scheduledAt, ownershipState)]);
    }

    if (scheduledAt.getUTCHours() === 4 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['settlement_watchdog', backtestTask.then(() => run('settlement_watchdog', () => runSettlementWatchdog(cfg)))]);
    }

    if (scheduledAt.getUTCHours() === 5 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['settlement_finality', backtestTask.then(() => run('settlement_finality', () => runSettlementFinalityVerification(cfg)))]);
    }

    return tasks;
  }

  async function observeScheduledTasks(cfg, tasks) {
    const safeTasks=Array.isArray(tasks) ? tasks : [];
    const settled = await Promise.allSettled(
      safeTasks.map(entry=>{
        if (
          !Array.isArray(entry)
          || !taskName(entry[0],'')
          || !entry[1]
          || typeof entry[1].then !== 'function'
        ) return Promise.reject(new Error('malformed_scheduled_task'));
        return entry[1];
      }),
    );
    const results=[];

    for (let i = 0; i < settled.length; i += 1) {
      const task = taskName(safeTasks[i]?.[0]);
      const entry = settled[i];
      const result = entry.status==='rejected'
        ? normalizeScheduledTaskResult(task,{ok:false,status:'failed',error:entry.reason?.message || entry.reason})
        : normalizeScheduledTaskResult(task,entry.value);
      results.push(result);

      if (result.status==='failed' || result.status==='degraded' || result.status==='skipped') {
        const severity=result.status==='failed' ? 'error' : result.status==='degraded' ? 'warning' : 'info';
        const code=result.status==='failed'
          ? 'CRON_TASK_FAILED'
          : result.status==='degraded'
            ? 'CRON_TASK_DEGRADED'
            : 'CRON_TASK_SKIPPED';
        await safeRecordOpsEvent(cfg,{
          severity,
          source:'cron',
          eventType:'scheduled_task',
          code,
          message:result.reason || `Scheduled task reported ${result.status}`,
          meta:{task,disposition:result.status},
        });
      }
    }
    return results;
  }

  async function executeScheduledRun(controller, cfg) {
    const scheduledAt=normalizedScheduledAt(controller);
    if (!scheduledAt) {
      const failed=normalizeScheduledTaskResult('scheduled_execution',{
        ok:false,
        status:'failed',
        reason:'invalid_scheduled_time',
      });
      await safeRecordOpsEvent(cfg,{
        severity:'error',
        source:'cron',
        eventType:'scheduled_execution',
        code:'CRON_SCHEDULE_INVALID',
        message:'Scheduled execution rejected an invalid scheduled timestamp.',
        meta:{task:'scheduled_execution',disposition:'failed'},
      });
      return [failed];
    }

    const jobKey=scheduledRunKey(scheduledAt);
    let claim={
      claimed:true,
      persistent:false,
      reason:'lease_not_configured',
      jobKey,
      groupKey:'cron-global',
    };

    if (typeof claimScheduledJob === 'function') {
      try {
        claim=await claimScheduledJob(cfg,{
          jobKey,
          groupKey:'cron-global',
          scheduledAt,
          leaseSeconds:GLOBAL_CRON_LEASE_SECONDS,
          retentionSeconds:GLOBAL_CRON_RETENTION_SECONDS,
        });
      } catch (error) {
        claim={
          claimed:false,
          persistent:true,
          reason:'lease_unavailable',
          jobKey,
          groupKey:'cron-global',
          error:shortReason(error?.message,'lease_unavailable'),
        };
      }
    }

    if (claim?.claimed === true && !validExecutionClaim(claim,{
      jobKey,
      groupKey:'cron-global',
    })) {
      claim={
        claimed:false,
        persistent:true,
        reason:'invalid_lease_claim',
        jobKey,
        groupKey:'cron-global',
      };
    }

    if (claim?.claimed !== true) {
      const skipped=normalizeScheduledTaskResult('scheduled_execution',{
        skipped:claim?.reason || 'lease_not_claimed',
        lease:claim || null,
      });
      const leaseUnavailable=claim?.reason === 'lease_unavailable' || claim?.reason === 'invalid_lease_claim';
      await safeRecordOpsEvent(cfg,{
        severity:leaseUnavailable ? 'error' : 'info',
        source:'cron',
        eventType:'scheduled_execution',
        code:leaseUnavailable ? 'CRON_EXECUTION_LEASE_UNAVAILABLE' : 'CRON_EXECUTION_SKIPPED',
        message:leaseUnavailable
          ? 'Scheduled execution skipped because the distributed lease backend is unavailable.'
          : `Scheduled execution skipped: ${shortReason(claim?.reason,'lease_not_claimed')}.`,
        meta:{
          task:'scheduled_execution',
          disposition:'skipped',
          reason:shortReason(claim?.reason,'lease_not_claimed'),
        },
      });
      return [skipped];
    }

    const heartbeat=await startScheduledLeaseHeartbeat(cfg,claim);
    if (heartbeat.state.lost) {
      return [normalizeScheduledTaskResult('scheduled_execution',{
        ok:false,
        status:'failed',
        reason:heartbeat.state.reason || 'execution_lease_heartbeat_lost',
      })];
    }

    try {
      const tasks=buildScheduledTaskPlan(cfg,scheduledAt,heartbeat.state);
      const results=await observeScheduledTasks(cfg,tasks);
      await heartbeat.stop();

      if (heartbeat.state.lost) {
        results.push(normalizeScheduledTaskResult('scheduled_execution',{
          degraded:true,
          reason:heartbeat.state.reason || 'execution_lease_heartbeat_lost',
        }));
        return results;
      }

      if (claim?.persistent === true) {
        let completed=false;
        if (typeof completeScheduledJob === 'function') {
          try {
            completed=await completeScheduledJob(cfg,claim) === true;
          } catch {
            completed=false;
          }
        }
        if (!completed) {
          const degraded=normalizeScheduledTaskResult('scheduled_execution',{
            degraded:true,
            reason:'execution_lease_completion_failed',
          });
          results.push(degraded);
          await safeRecordOpsEvent(cfg,{
            severity:'warning',
            source:'cron',
            eventType:'scheduled_execution',
            code:'CRON_EXECUTION_LEASE_COMPLETE_FAILED',
            message:'Scheduled work completed but its distributed run marker could not be sealed.',
            meta:{task:'scheduled_execution',disposition:'degraded'},
          });
        }
      }
      return results;
    } catch (error) {
      await heartbeat.stop().catch(()=>{});
      if (!heartbeat.state.lost && claim?.claimed === true && typeof releaseScheduledJob==='function') {
        await releaseScheduledJob(cfg,claim).catch(()=>false);
      }
      const failed=normalizeScheduledTaskResult('scheduled_execution',{
        ok:false,
        status:'failed',
        error:error?.message || error,
      });
      await safeRecordOpsEvent(cfg,{
        severity:'error',
        source:'cron',
        eventType:'scheduled_execution',
        code:'CRON_EXECUTION_FAILED',
        message:failed.reason,
        meta:{task:'scheduled_execution',disposition:'failed'},
      });
      return [failed];
    }
  }

  function handleScheduled(controller, cfg, ctx) {
    const execution=executeScheduledRun(controller,cfg);
    if (typeof ctx?.waitUntil === 'function') {
      try {
        ctx.waitUntil(execution);
        return undefined;
      } catch {
        return execution;
      }
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
    startScheduledLeaseHeartbeat,
    observeScheduledTasks,
    executeScheduledRun,
    handleScheduled,
  });
}
