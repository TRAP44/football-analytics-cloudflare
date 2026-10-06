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

  async function renewScheduledJob(_cfg,claim={}) {
    const row=rows.get(claim.jobKey);
    if (!row || row.leaseToken!==claim.leaseToken || row.status!=='running') {
      return {renewed:false,reason:'ownership_lost',jobKey:claim.jobKey,groupKey:claim.groupKey};
    }
    return {renewed:true,reason:'renewed',jobKey:claim.jobKey,groupKey:row.groupKey,lockedUntil:new Date(Date.now()+720000).toISOString()};
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

  return {rows,activeByGroup,claimScheduledJob,renewScheduledJob,completeScheduledJob,releaseScheduledJob};
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
    cleanupScheduledJobLeases: async () => { calls.push('scheduled_lease_cleanup'); return { ok: true }; },
    cleanupGrowthEvents: async () => { calls.push('growth_cleanup'); return { ok: true }; },
    cleanupIntegrityData: async () => { calls.push('integrity_cleanup'); return { ok: true }; },
    runSettlementWatchdog: async () => { calls.push('settlement_watchdog'); return { ok: true }; },
    runSettlementFinalityVerification: async () => { calls.push('settlement_finality'); return { ok: true }; },
    recordOpsEvent: async (_cfg, event) => { events.push(event); },
    claimScheduledJob: leases.claimScheduledJob,
    renewScheduledJob: leases.renewScheduledJob,
    completeScheduledJob: leases.completeScheduledJob,
    releaseScheduledJob: leases.releaseScheduledJob,
    ...overrides,
  };
  delete deps.leases;
  return { api: createScheduledJobsRuntime(deps), calls, events, leases };
}

test('scheduled result contract rejects coercion and forged normalized markers',()=>{
  assert.equal(normalizeScheduledTaskResult('task',{failed:true}).status,'failed');
  assert.equal(normalizeScheduledTaskResult('task',{failed:'1'}).status,'degraded');
  assert.equal(normalizeScheduledTaskResult('task',{failed:[1]}).status,'degraded');
  assert.equal(normalizeScheduledTaskResult('task',{ok:'false'}).status,'degraded');
  assert.equal(normalizeScheduledTaskResult('task',[]).status,'degraded');

  const forged={
    __scheduledTaskResult:true,
    task:'other',
    ok:true,
    status:'ok',
    reason:'',
    value:{failed:true},
  };
  const normalized=normalizeScheduledTaskResult('task',forged);
  assert.equal(normalized.task,'task');
  assert.equal(normalized.status,'ok');
  assert.notEqual(normalized,forged);
  assert.deepEqual(normalized.value,{failed:true});
});

test('scheduled result contract standardizes ok, failed, degraded and skipped shapes', () => {
  assert.equal(normalizeScheduledTaskResult('ok',{ok:true}).status,'ok');
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
  assert.equal(results.find(row=>row.task==='backtest').status,'ok');
});

test('rejected backtest cannot suppress watchdog or finality safety work', async () => {
  const watchdog=runtime({
    settleBacktestDaily: async () => { throw new Error('backtest failed'); },
  });
  const watchdogTasks=watchdog.api.buildScheduledTaskPlan({},new Date('2026-09-28T04:05:00.000Z'));
  const watchdogResults=await watchdog.api.observeScheduledTasks({},watchdogTasks);
  assert.equal(watchdog.calls.includes('settlement_watchdog'),true);
  assert.equal(watchdogResults.find(row=>row.task==='backtest').status,'failed');
  assert.equal(watchdogResults.find(row=>row.task==='settlement_watchdog').status,'ok');

  const finality=runtime({
    settleBacktestDaily: async () => { throw new Error('backtest failed'); },
  });
  const finalityTasks=finality.api.buildScheduledTaskPlan({},new Date('2026-09-28T05:05:00.000Z'));
  const finalityResults=await finality.api.observeScheduledTasks({},finalityTasks);
  assert.equal(finality.calls.includes('settlement_finality'),true);
  assert.equal(finalityResults.find(row=>row.task==='backtest').status,'failed');
  assert.equal(finalityResults.find(row=>row.task==='settlement_finality').status,'ok');
});

test('observer fails malformed task entries instead of treating them as success',async()=>{
  const rt=runtime();
  const results=await rt.api.observeScheduledTasks({},[
    ['valid',Promise.resolve({ok:true})],
    ['missing_promise',undefined],
    [{toString:()=> 'forged'},Promise.resolve({ok:true})],
  ]);
  assert.deepEqual(results.map(row=>row.status),['ok','failed','failed']);
  assert.equal(results[1].reason,'malformed_scheduled_task');
  assert.equal(results[2].task,'unknown');
});

test('degraded, skipped and failed results are all observable with distinct dispositions', async () => {
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
    ['CRON_TASK_SKIPPED','skipped_task','skipped'],
    ['CRON_TASK_FAILED','failed_task','failed'],
  ]);
  assert.equal(rt.events[0].severity,'warning');
  assert.equal(rt.events[1].severity,'info');
  assert.equal(rt.events[2].severity,'error');
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

test('invalid scheduled timestamps fail closed before lease or task execution',async()=>{
  let leaseCalls=0;
  const rt=runtime({
    claimScheduledJob:async()=>{leaseCalls+=1;return {claimed:true,persistent:false};},
  });
  for(const scheduledTime of [true,'2026-09-28T12:05:00Z',NaN,-1]){
    const result=await rt.api.executeScheduledRun({scheduledTime},{});
    assert.equal(result.length,1);
    assert.equal(result[0].task,'scheduled_execution');
    assert.equal(result[0].status,'failed');
    assert.equal(result[0].reason,'invalid_scheduled_time');
  }
  assert.equal(leaseCalls,0);
  assert.equal(rt.calls.length,0);
  assert.equal(rt.events.every(event=>event.code==='CRON_SCHEDULE_INVALID'),true);
});

test('global lease exceptions fail closed without launching scheduled work',async()=>{
  const rt=runtime({
    claimScheduledJob:async()=>{throw new Error('lease backend exploded');},
  });
  const result=await rt.api.executeScheduledRun({
    scheduledTime:Date.parse('2026-09-28T12:05:00.000Z'),
  },{});
  assert.equal(result.length,1);
  assert.equal(result[0].status,'skipped');
  assert.equal(result[0].reason,'lease_unavailable');
  assert.equal(rt.calls.length,0);
  assert.equal(rt.events.at(-1).code,'CRON_EXECUTION_LEASE_UNAVAILABLE');
});

test('truthy lease claims cannot launch scheduled work',async()=>{
  const rt=runtime({
    claimScheduledJob:async()=>({
      claimed:'true',
      persistent:'true',
      reason:'claimed',
    }),
  });
  const result=await rt.api.executeScheduledRun({
    scheduledTime:Date.parse('2026-09-28T12:05:00.000Z'),
  },{});
  assert.equal(result[0].status,'skipped');
  assert.equal(rt.calls.length,0);
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

  for (const task of ['ops_cleanup','rate_window_cleanup','scheduled_lease_cleanup','growth_cleanup','integrity_cleanup']) {
    assert.equal(rt.calls.filter(call=>call===task).length,1,task);
    assert.equal(leases.rows.get(dailyScheduledTaskKey(task,new Date('2026-09-28T03:00:00.000Z')))?.status,'done');
  }
});

test('daily task refuses a malformed persistent lease claim',async()=>{
  const rt=runtime({
    claimScheduledJob:async(_cfg,input)=>({
      claimed:true,
      persistent:true,
      reason:'claimed',
      jobKey:input.jobKey,
      groupKey:input.groupKey,
      leaseToken:'',
    }),
  });
  const tasks=rt.api.buildScheduledTaskPlan(
    {},
    new Date('2026-09-28T03:05:00.000Z'),
    {lost:false},
  );
  const results=await rt.api.observeScheduledTasks({},tasks);
  const cleanup=results.find(row=>row.task==='ops_cleanup');
  assert.equal(cleanup.status,'failed');
  assert.equal(cleanup.reason,'invalid_daily_task_lease_claim');
  assert.equal(rt.calls.includes('ops_cleanup'),false);
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
  assert.equal(rt.calls.filter(x=>x==='scheduled_lease_cleanup').length,1);
  assert.equal(rt.calls.filter(x=>x==='growth_cleanup').length,1);
  assert.equal(rt.calls.filter(x=>x==='integrity_cleanup').length,2);
});

test('malformed persistent claim cannot bypass global lease heartbeat',async()=>{
  const rt=runtime({
    claimScheduledJob:async(_cfg,input)=>({
      claimed:true,
      persistent:'true',
      reason:'claimed',
      jobKey:input.jobKey,
      groupKey:input.groupKey,
      leaseToken:'token',
    }),
  });
  const result=await rt.api.executeScheduledRun({
    scheduledTime:Date.parse('2026-09-28T12:05:00.000Z'),
  },{});
  assert.equal(result[0].status,'skipped');
  assert.equal(result[0].reason,'invalid_lease_claim');
  assert.equal(rt.calls.length,0);
  assert.equal(rt.events.at(-1).code,'CRON_EXECUTION_LEASE_UNAVAILABLE');
});

test('persistent claim identity must match the scheduled run',async()=>{
  const rt=runtime({
    claimScheduledJob:async()=>({
      claimed:true,
      persistent:true,
      reason:'claimed',
      jobKey:'cron:wrong',
      groupKey:'cron-global',
      leaseToken:'token',
    }),
  });
  const result=await rt.api.executeScheduledRun({
    scheduledTime:Date.parse('2026-09-28T12:05:00.000Z'),
  },{});
  assert.equal(result[0].reason,'invalid_lease_claim');
  assert.equal(rt.calls.length,0);
});

test('heartbeat timer failure marks lease ownership lost',async()=>{
  const rt=runtime({
    renewScheduledJob:async()=>({renewed:true}),
    setHeartbeatTimeout:()=>{throw new Error('timer unavailable');},
    leaseHeartbeatIntervalMs:1000,
  });
  const heartbeat=await rt.api.startScheduledLeaseHeartbeat({},{
    claimed:true,
    persistent:true,
    reason:'claimed',
    jobKey:'cron:2026-09-28T12:05:00.000Z',
    groupKey:'cron-global',
    leaseToken:'token',
    leaseSeconds:720,
  });
  await heartbeat.done;
  assert.equal(heartbeat.state.lost,true);
  assert.equal(heartbeat.state.reason,'heartbeat_timer_failed');
});

test('heartbeat requires strict persistent and renewed flags',async()=>{
  let renewCalls=0;
  const nonPersistent=runtime({
    renewScheduledJob:async()=>{renewCalls+=1;return {renewed:true};},
  });
  const controller=await nonPersistent.api.startScheduledLeaseHeartbeat({},{
    claimed:true,
    persistent:'true',
  });
  assert.equal(controller.state.lost,false);
  assert.equal(renewCalls,0);

  const malformedRenewal=runtime({
    renewScheduledJob:async()=>({renewed:'true'}),
  });
  const lost=await malformedRenewal.api.startScheduledLeaseHeartbeat({},{
    claimed:true,
    persistent:true,
    jobKey:'cron:x',
    groupKey:'cron-global',
    leaseSeconds:720,
  });
  assert.equal(lost.state.lost,true);
  assert.equal(lost.state.reason,'lease_renewal_failed');
});

test('persistent global completion requires strict true confirmation',async()=>{
  const leases={
    claimScheduledJob:async(_cfg,input)=>({
      claimed:true,
      persistent:true,
      reason:'claimed',
      jobKey:input.jobKey,
      groupKey:input.groupKey,
      leaseToken:'token',
      leaseSeconds:720,
    }),
    renewScheduledJob:async()=>({renewed:true}),
    completeScheduledJob:async()=> 'true',
    releaseScheduledJob:async()=>true,
  };
  const rt=runtime({leases});
  const result=await rt.api.executeScheduledRun({
    scheduledTime:Date.parse('2026-09-28T12:05:00.000Z'),
  },{});
  assert.equal(
    result.some(row=>row.task==='scheduled_execution' && row.status==='degraded' && row.reason==='execution_lease_completion_failed'),
    true,
  );
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
  assert.equal(isolateB.events.at(-1)?.code,'CRON_EXECUTION_SKIPPED');
  assert.equal(isolateB.events.at(-1)?.meta?.reason,'duplicate_active');

  const overlappingNextSlot=await isolateB.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T12:10:00.000Z')},{});
  assert.equal(overlappingNextSlot[0].status,'skipped');
  assert.equal(overlappingNextSlot[0].reason,'overlap');
  assert.equal(isolateB.events.at(-1)?.code,'CRON_EXECUTION_SKIPPED');
  assert.equal(isolateB.events.at(-1)?.meta?.reason,'overlap');

  releaseBacktest({ok:true});
  await first;

  const duplicateAfterCompletion=await isolateB.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T12:05:00.000Z')},{});
  assert.equal(duplicateAfterCompletion[0].status,'skipped');
  assert.equal(duplicateAfterCompletion[0].reason,'duplicate');
  assert.equal(isolateB.events.at(-1)?.code,'CRON_EXECUTION_SKIPPED');
  assert.equal(isolateB.events.at(-1)?.meta?.reason,'duplicate');

  const nextRun=await isolateB.api.executeScheduledRun({scheduledTime:Date.parse('2026-09-28T12:10:00.000Z')},{});
  assert.ok(nextRun.some(row=>row.task==='backtest' && row.status==='ok'));
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
  assert.equal(results.find(row=>row.task==='daily_digest').status,'ok');
  assert.equal(results.find(row=>row.task==='post_match_return').status,'ok');
});

test('scheduled handler returns execution when waitUntil throws synchronously',async()=>{
  const rt=runtime();
  const execution=rt.api.handleScheduled(
    {scheduledTime:Date.parse('2026-09-28T12:05:00.000Z')},
    {},
    {waitUntil(){throw new Error('registration failed');}},
  );
  assert.ok(execution instanceof Promise);
  const results=await execution;
  assert.equal(results.some(row=>row.task==='backtest'),true);
});

test('run and daily keys reject coercible or invalid identities',()=>{
  assert.throws(()=>scheduledRunKey(true),TypeError);
  assert.throws(()=>scheduledRunKey('2026-09-28T03:05:00.000Z'),TypeError);
  assert.throws(()=>dailyScheduledTaskKey({toString:()=> 'ops_cleanup'},new Date()),TypeError);
  assert.throws(()=>dailyScheduledTaskKey('ops cleanup',new Date()),TypeError);
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
