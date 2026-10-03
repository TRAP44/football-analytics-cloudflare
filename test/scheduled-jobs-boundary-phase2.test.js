import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScheduledJobsRuntime,
  dailyScheduledTaskKey,
  normalizeScheduledTaskResult,
  scheduledRunKey,
} from '../src/scheduled-jobs.js';

function inMemoryLeaseBackend() {
  const rows=new Map();
  const activeByGroup=new Map();
  let seq=0;

  async function claimScheduledJob(_cfg,input={}) {
    const jobKey=String(input.jobKey || '');
    const groupKey=String(input.groupKey || '');
    const existing=rows.get(jobKey);
    if (existing?.status==='done') {
      return {claimed:false,persistent:true,reason:'duplicate',jobKey,groupKey};
    }
    if (existing?.status==='running') {
      return {claimed:false,persistent:true,reason:'duplicate_active',jobKey,groupKey};
    }
    const active=activeByGroup.get(groupKey);
    if (active && active!==jobKey) {
      return {claimed:false,persistent:true,reason:'overlap',jobKey,groupKey,overlapJobKey:active};
    }
    const leaseToken=`lease-${++seq}`;
    rows.set(jobKey,{status:'running',groupKey,leaseToken});
    activeByGroup.set(groupKey,jobKey);
    return {claimed:true,persistent:true,reason:'claimed',jobKey,groupKey,leaseToken};
  }

  async function completeScheduledJob(_cfg,claim={}) {
    const row=rows.get(claim.jobKey);
    if (!row || row.leaseToken!==claim.leaseToken || row.status!=='running') return false;
    row.status='done';
    rows.set(claim.jobKey,row);
    if (activeByGroup.get(row.groupKey)===claim.jobKey) activeByGroup.delete(row.groupKey);
    return true;
  }

  async function releaseScheduledJob(_cfg,claim={}) {
    const row=rows.get(claim.jobKey);
    if (!row || row.leaseToken!==claim.leaseToken || row.status!=='running') return false;
    row.status='failed';
    rows.set(claim.jobKey,row);
    if (activeByGroup.get(row.groupKey)===claim.jobKey) activeByGroup.delete(row.groupKey);
    return true;
  }

  return {rows,activeByGroup,claimScheduledJob,completeScheduledJob,releaseScheduledJob};
}

function runtime(overrides = {}) {
  const calls = [];
  const events = [];
  const leases=overrides.leases || {
    claimScheduledJob: async (_cfg,input) => ({
      claimed:true,
      persistent:false,
      reason:'memory_only',
      jobKey:input.jobKey,
      groupKey:input.groupKey,
      leaseToken:'',
    }),
    completeScheduledJob: async () => true,
    releaseScheduledJob: async () => true,
  };
  const deps = {
    settleBacktestDaily: async () => { calls.push('backtest'); return { ok: true }; },
    processDueReminders: async () => { calls.push('reminders'); return { checked: 0, failed: 0 }; },
    processLineupNotifications: async () => { calls.push('lineup_notifications'); return { checked: 0, failed: 0 }; },
    processImportantChangeNotifications: async () => { calls.push('important_change_notifications'); return { checked: 0, failed: 0 }; },
    processSmartNotifications: async () => { calls.push('smart_notifications'); return { ok: true, checked: 0, failed: 0 }; },
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
    claimScheduledJob: leases.claimScheduledJob,
    completeScheduledJob: leases.completeScheduledJob,
    releaseScheduledJob: leases.releaseScheduledJob,
    ...overrides,
  };
  delete deps.leases;
  return { api: createScheduledJobsRuntime(deps), calls, events, leases };
}

test('scheduled result contract standardizes success, skipped, degraded and failed shapes', () => {
  assert.equal(normalizeScheduledTaskResult('ok',{ok:true}).status,'success');
  assert.equal(normalizeScheduledTaskResult('skip',{skipped:'already_checked'}).status,'skipped');
  assert.equal(normalizeScheduledTaskResult('degraded',{checked:4,failed:1}).status,'degraded');
  assert.equal(normalizeScheduledTaskResult('failed',{ok:false,error:'boom'}).status,'failed');
  assert.equal(normalizeScheduledTaskResult('failed-state',{status:'failed',reason:'bad'}).status,'failed');
});

test('scheduled boundary preserves dependency ordering without failure propagation', async () => {
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
  assert.deepEqual(tasks.map(([name]) => name), ['reminders', 'lineup_notifications', 'important_change_notifications', 'smart_notifications', 'backtest', 'post_match_return']);
  await Promise.resolve();
  assert.equal(postMatchStarted, false);

  releaseBacktest({ ok: true });
  const results=await rt.api.observeScheduledTasks({}, tasks);
  assert.equal(postMatchStarted, true);
  assert.equal(results.find(row=>row.task==='backtest').status,'success');
});

test('rejected backtest cannot suppress watchdog or finality safety work', async () => {
  const watchdog=runtime({
    settleBacktestDaily: async () => { throw new Error('backtest failed'); },
  });
  const watchdogTasks=watchdog.api.buildScheduledTaskPlan({},new Date('2026-09-28T04:05:00.000Z'));
  const watchdogResults=await watchdog.api.observeScheduledTasks({},watchdogTasks);
  assert.equal(watchdog.calls.includes('settlement_watchdog'),true);
  assert.equal(watchdogResults.find(row=>row.task==='backtest').status,'failed');
  assert.equal(watchdogResults.find(row=>row.task==='settlement_watchdog').status,'success');

  const finality=runtime({
    settleBacktestDaily: async () => { throw new Error('backtest failed'); },
  });
  const finalityTasks=finality.api.buildScheduledTaskPlan({},new Date('2026-09-28T05:05:00.000Z'));
  const finalityResults=await finality.api.observeScheduledTasks({},finalityTasks);
  assert.equal(finality.calls.includes('settlement_finality'),true);
  assert.equal(finalityResults.find(row=>row.task==='backtest').status,'failed');
  assert.equal(finalityResults.find(row=>row.task==='settlement_finality').status,'success');
});

test('degraded results are observed as warnings while skipped results remain explicit non-failures', async () => {
  const rt=runtime();
  const tasks=[
    ['degraded_task',Promise.resolve(normalizeScheduledTaskResult('degraded_task',{checked:3,failed:1}))],
    ['skipped_task',Promise.resolve(normalizeScheduledTaskResult('skipped_task',{skipped:'already_done'}))],
    ['failed_task',Promise.resolve(normalizeScheduledTaskResult('failed_task',{ok:false,error:'database unavailable'}))],
  ];
  const results=await rt.api.observeScheduledTasks({},tasks);
  assert.deepEqual(results.map(row=>row.status),['degraded','skipped','failed']);
  assert.deepEqual(rt.events.map(event=>[event.code,event.meta.task,event.meta.disposition]),[
    ['CRON_TASK_DEGRADED','degraded_task','degraded'],
    ['CRON_TASK_FAILED','failed_task','failed'],
  ]);
  assert.equal(rt.events[0].severity,'warning');
  assert.equal(rt.events[1].severity,'error');
});

test('production monitor still waits for reminders completion even when reminders fail', async () => {
  let rejectReminders;
  const reminders=new Promise((_,reject)=>{rejectReminders=reject;});
  let monitorStarted=false;
  const rt=runtime({
    processDueReminders:()=>reminders,
    runProductionMonitor:async()=>{monitorStarted=true;return {ok:true};},
  });
  const tasks=rt.api.buildScheduledTaskPlan({},new Date('2026-09-28T12:15:00.000Z'));
  await Promise.resolve();
  assert.equal(monitorStarted,false);
  rejectReminders(new Error('reminder read failed'));
  await rt.api.observeScheduledTasks({},tasks);
  assert.equal(monitorStarted,true);
});

test('daily cleanup executes once per UTC day across the 03:00/03:05/03:10 window', async () => {
  const leases=inMemoryLeaseBackend();
  const rt=runtime({leases});

  for (const iso of [
    '2026-09-28T03:00:00.000Z',
    '2026-09-28T03:05:00.000Z',
    '2026-09-28T03:10:00.000Z',
  ]) {
    await rt.api.executeScheduledRun({scheduledTime:Date.parse(iso)},{});
  }

  for (const task of ['ops_cleanup','rate_window_cleanup','growth_cleanup','integrity_cleanup']) {
    assert.equal(rt.calls.filter(call=>call===task).length,1,task);
    assert.equal(leases.rows.get(dailyScheduledTaskKey(task,new Date('2026-09-28T03:00:00.000Z')))?.status,'done');
  }
});

test('failed daily cleanup is released for retry without repeating successful cleanup jobs', async () => {
  const leases=inMemoryLeaseBackend();
  let integrityAttempts=0;
  const rt=runtime({
    leases,
    cleanupIntegrityData:async()=>{
      rt.calls.push('integrity_cleanup');
      integrityAttempts+=1;
      return integrityAttempts===1 ? {ok:false,error:'temporary failure'} : {ok:true};
    },
  });

  await rt.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T03:00:00.000Z')},{});
  await rt.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T03:05:00.000Z')},{});

  assert.equal(rt.calls.filter(x=>x==='ops_cleanup').length,1);
  assert.equal(rt.calls.filter(x=>x==='rate_window_cleanup').length,1);
  assert.equal(rt.calls.filter(x=>x==='growth_cleanup').length,1);
  assert.equal(rt.calls.filter(x=>x==='integrity_cleanup').length,2);
});

test('duplicate invocation and cross-isolate overlap are blocked by the shared global lease', async () => {
  const leases=inMemoryLeaseBackend();
  let releaseBacktest;
  const blocker=new Promise(resolve=>{releaseBacktest=resolve;});
  const isolateA=runtime({leases,settleBacktestDaily:()=>blocker});
  const isolateB=runtime({leases});

  const first=isolateA.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T12:05:00.000Z')},{});
  await new Promise(resolve=>setImmediate(resolve));

  const duplicate=await isolateB.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T12:05:00.000Z')},{});
  assert.equal(duplicate.length,1);
  assert.equal(duplicate[0].task,'scheduled_execution');
  assert.equal(duplicate[0].status,'skipped');
  assert.equal(['duplicate_active','overlap'].includes(duplicate[0].reason),true);

  const overlappingNextSlot=await isolateB.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T12:10:00.000Z')},{});
  assert.equal(overlappingNextSlot[0].status,'skipped');
  assert.equal(overlappingNextSlot[0].reason,'overlap');

  releaseBacktest({ok:true});
  await first;

  const duplicateAfterCompletion=await isolateB.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T12:05:00.000Z')},{});
  assert.equal(duplicateAfterCompletion[0].status,'skipped');
  assert.equal(duplicateAfterCompletion[0].reason,'duplicate');

  const nextRun=await isolateB.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T12:10:00.000Z')},{});
  assert.ok(nextRun.some(row=>row.task==='backtest' && row.status==='success'));
});

test('07 UTC provider-heavy tasks remain serialized after backtest failure', async () => {
  const calls=[];
  const rt=runtime({
    settleBacktestDaily:async()=>{calls.push('backtest');throw new Error('backtest failed');},
    processDailyDigests:async()=>{calls.push('daily_digest');return {sent:0};},
    processPostMatchReturns:async()=>{calls.push('post_match_return');return {checked:0,failed:0};},
  });

  const tasks=rt.api.buildScheduledTaskPlan({},new Date('2026-09-29T07:05:00.000Z'));
  const results=await rt.api.observeScheduledTasks({},tasks);
  assert.deepEqual(calls,['backtest','daily_digest','post_match_return']);
  assert.equal(results.find(row=>row.task==='backtest').status,'failed');
  assert.equal(results.find(row=>row.task==='daily_digest').status,'success');
  assert.equal(results.find(row=>row.task==='post_match_return').status,'success');
});

test('scheduled handler registers exactly one execution with waitUntil', async () => {
  const rt=runtime();
  const registered=[];
  const result=rt.api.handleScheduled(
    {scheduledTime:Date.parse('2026-09-28T12:05:00.000Z')},
    {},
    {waitUntil:promise=>registered.push(promise)},
  );
  assert.equal(result,undefined);
  assert.equal(registered.length,1);
  await registered[0];
});

test('run and daily keys are stable UTC identities', () => {
  const when=new Date('2026-09-28T03:05:00.000Z');
  assert.equal(scheduledRunKey(when),'cron:2026-09-28T03:05:00.000Z');
  assert.equal(dailyScheduledTaskKey('ops_cleanup',when),'daily:ops_cleanup:2026-09-28');
});

test('worker delegates scheduled orchestration through the distributed lease runtime', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/import \{ createScheduledJobsRuntime \} from '\.\/scheduled-jobs\.js';/);
  assert.match(worker,/import \{ createScheduledLeaseRuntime \} from '\.\/scheduled-lease\.js';/);
  assert.match(worker,/createScheduledLeaseRuntime\(\{/);
  assert.match(worker,/const \{ handleScheduled \} = createScheduledJobsRuntime\(\{/);
  assert.match(worker,/claimScheduledJob,/);
  assert.match(worker,/completeScheduledJob,/);
  assert.match(worker,/releaseScheduledJob,/);
  assert.match(worker,/return handleScheduled\(controller, cfg, ctx\);/);
});
