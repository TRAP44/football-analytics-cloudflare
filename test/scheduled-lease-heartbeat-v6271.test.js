import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createScheduledLeaseRuntime } from '../src/scheduled-lease.js';
import { createScheduledJobsRuntime } from '../src/scheduled-jobs.js';

function leaseRuntime({supaRpc,events=[]}={}) {
  return createScheduledLeaseRuntime({
    hasSupabase:()=>true,
    supaRpc,
    recordOpsEvent:async(_cfg,event)=>events.push(event),
    redactOpsString:value=>String(value || ''),
  });
}

function scheduledRuntime(overrides={}) {
  const calls=[];
  const events=[];
  const deps={
    settleBacktestDaily:async()=>{calls.push('backtest');return {ok:true};},
    processDueReminders:async()=>{calls.push('reminders');return {checked:0,failed:0};},
    processLineupNotifications:async()=>{calls.push('lineup_notifications');return {checked:0,failed:0};},
    processImportantChangeNotifications:async()=>{calls.push('important_change_notifications');return {checked:0,failed:0};},
    processSmartNotifications:async()=>{calls.push('smart_notifications');return {ok:true,checked:0,failed:0};},
    processPostMatchReturns:async()=>{calls.push('post_match_return');return {checked:0,failed:0};},
    runProductionMonitor:async()=>({ok:true}),
    processDailyDigests:async()=>({sent:0}),
    cleanupOpsEvents:async()=>({ok:true}),
    cleanupRateWindows:async()=>({ok:true}),
    cleanupScheduledJobLeases:async()=>({ok:true}),
    cleanupGrowthEvents:async()=>({ok:true}),
    cleanupIntegrityData:async()=>({ok:true}),
    runSettlementWatchdog:async()=>({ok:true}),
    runSettlementFinalityVerification:async()=>({ok:true}),
    recordOpsEvent:async(_cfg,event)=>events.push(event),
    claimScheduledJob:async(_cfg,input)=>({
      claimed:true,
      persistent:true,
      reason:'claimed',
      jobKey:input.jobKey,
      groupKey:input.groupKey,
      leaseToken:'lease-owner-1234567890',
      leaseSeconds:30,
    }),
    renewScheduledJob:async()=>({renewed:true,reason:'renewed',lockedUntil:new Date(Date.now()+30000).toISOString()}),
    completeScheduledJob:async()=>true,
    releaseScheduledJob:async()=>true,
    leaseHeartbeatIntervalMs:10,
    ...overrides,
  };
  return {api:createScheduledJobsRuntime(deps),calls,events};
}

test('scheduled lease runtime renews through owner-token RPC and claim exposes heartbeat closure', async()=>{
  const calls=[];
  const api=leaseRuntime({
    supaRpc:async(_cfg,name,args)=>{
      calls.push({name,args});
      if(name==='claim_scheduled_job') {
        return {
          claimed:true,
          reason:'claimed',
          jobKey:args.p_job_key,
          groupKey:args.p_group_key,
          leaseToken:'lease-owner-1234567890',
          lockedUntil:'2026-10-04T10:30:00Z',
        };
      }
      if(name==='renew_scheduled_job') {
        return {
          renewed:true,
          reason:'renewed',
          jobKey:args.p_job_key,
          lockedUntil:'2026-10-04T10:40:00Z',
        };
      }
      return true;
    },
  });

  const claim=await api.claimScheduledJob({},{
    jobKey:'cron:2026-10-04T10:20:00.000Z',
    groupKey:'cron-global',
    scheduledAt:new Date('2026-10-04T10:20:00Z'),
    leaseSeconds:720,
  });
  assert.equal(claim.claimed,true);
  assert.equal(typeof claim.renew,'function');

  const renewal=await claim.renew();
  assert.equal(renewal.renewed,true);
  assert.equal(renewal.reason,'renewed');
  assert.deepEqual(calls.map(call=>call.name),['claim_scheduled_job','renew_scheduled_job']);
  assert.equal(calls[1].args.p_job_key,claim.jobKey);
  assert.equal(calls[1].args.p_lease_token,claim.leaseToken);
  assert.equal(calls[1].args.p_lease_seconds,720);
});

test('scheduled lease renewal outage is explicit and fail-closed', async()=>{
  const events=[];
  const api=leaseRuntime({
    events,
    supaRpc:async(_cfg,name)=>{
      if(name==='renew_scheduled_job') throw new Error('database unavailable');
      return {
        claimed:true,
        reason:'claimed',
        jobKey:'cron:test',
        groupKey:'cron-global',
        leaseToken:'lease-owner-1234567890',
      };
    },
  });
  const claim=await api.claimScheduledJob({},{
    jobKey:'cron:test',
    groupKey:'cron-global',
    scheduledAt:new Date('2026-10-04T10:20:00Z'),
  });
  const renewal=await claim.renew();
  assert.equal(renewal.renewed,false);
  assert.equal(renewal.reason,'lease_unavailable');
  assert.equal(events.at(-1)?.code,'SCHEDULED_LEASE_RENEW_FAILED');
});

test('heartbeat loss stops launching dependent side effects and avoids stale completion', async()=>{
  let releaseBacktest;
  const blocker=new Promise(resolve=>{releaseBacktest=resolve;});
  let renewCalls=0;
  let completeCalls=0;
  let postMatchCalls=0;
  const rt=scheduledRuntime({
    settleBacktestDaily:async()=>{
      rt.calls.push('backtest');
      return blocker;
    },
    processPostMatchReturns:async()=>{
      postMatchCalls+=1;
      rt.calls.push('post_match_return');
      return {checked:0,failed:0};
    },
    renewScheduledJob:async()=>{
      renewCalls+=1;
      if(renewCalls===1) return {renewed:true,reason:'renewed',lockedUntil:new Date(Date.now()+30000).toISOString()};
      return {renewed:false,reason:'ownership_lost'};
    },
    completeScheduledJob:async()=>{
      completeCalls+=1;
      return true;
    },
  });

  const running=rt.api.executeScheduledRun(
    {scheduledTime:Date.parse('2026-10-04T10:20:00Z')},
    {},
  );
  await new Promise(resolve=>setTimeout(resolve,30));
  releaseBacktest({ok:true});

  const results=await running;
  assert.ok(renewCalls>=2,'heartbeat must renew after the initial ownership confirmation');
  assert.equal(postMatchCalls,0,'dependent side effect must not launch after ownership loss');
  assert.equal(completeCalls,0,'lost owner must not seal the execution as completed');
  assert.equal(
    results.find(row=>row.task==='post_match_return')?.status,
    'skipped',
  );
  assert.equal(
    results.find(row=>row.task==='scheduled_execution')?.status,
    'degraded',
  );
  assert.equal(
    rt.events.some(event=>event.code==='CRON_EXECUTION_LEASE_HEARTBEAT_LOST'),
    true,
  );
});

test('initial heartbeat ownership failure prevents scheduled child work from starting', async()=>{
  const rt=scheduledRuntime({
    renewScheduledJob:async()=>({renewed:false,reason:'ownership_lost'}),
  });
  const results=await rt.api.executeScheduledRun(
    {scheduledTime:Date.parse('2026-10-04T10:20:00Z')},
    {},
  );
  assert.deepEqual(rt.calls,[]);
  assert.equal(results.length,1);
  assert.equal(results[0].task,'scheduled_execution');
  assert.equal(results[0].status,'failed');
  assert.equal(rt.events.at(-1)?.code,'CRON_EXECUTION_LEASE_HEARTBEAT_LOST');
});

test('v6.27.1 migration provides token-CAS heartbeat and rejects expired owner settlement',()=>{
  const sql=fs.readFileSync(
    'supabase/migrations/supabase_migration_v6_27_1.sql',
    'utf8',
  ).toLowerCase();

  for(const marker of [
    'create or replace function public.renew_scheduled_job',
    "and lease_token=v_lease_token",
    "and status='running'",
    'and locked_until>v_now',
    "reason','ownership_lost'",
    'revoke all on function public.renew_scheduled_job(text,text,integer)',
    'grant execute on function public.renew_scheduled_job(text,text,integer)',
    "'renew_scheduled_job'",
  ]) assert.ok(sql.includes(marker),marker);

  const completion=sql.slice(
    sql.indexOf('create or replace function public.complete_scheduled_job'),
    sql.indexOf('create or replace function public.release_scheduled_job'),
  );
  const release=sql.slice(
    sql.indexOf('create or replace function public.release_scheduled_job'),
    sql.indexOf('revoke all on function public.renew_scheduled_job'),
  );
  assert.ok(completion.includes('and locked_until>v_now'),'expired owner cannot complete');
  assert.ok(release.includes('and locked_until>v_now'),'expired owner cannot release');
  assert.doesNotMatch(sql,/security\s+definer/);
});
