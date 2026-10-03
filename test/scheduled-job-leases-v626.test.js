import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createScheduledLeaseRuntime } from '../src/scheduled-lease.js';

function runtime({hasSupabase=()=>true,supaRpc,events=[]}={}) {
  return createScheduledLeaseRuntime({
    hasSupabase,
    supaRpc,
    recordOpsEvent:async(_cfg,event)=>events.push(event),
    redactOpsString:value=>String(value || ''),
  });
}

test('scheduled lease wrapper uses server-only RPC contract and keeps lease identity', async () => {
  const calls=[];
  const api=runtime({
    supaRpc:async(_cfg,name,args,timeout)=>{
      calls.push({name,args,timeout});
      if (name==='claim_scheduled_job') {
        return {
          claimed:true,
          reason:'claimed',
          jobKey:args.p_job_key,
          groupKey:args.p_group_key,
          leaseToken:'lease-token-123456',
          scheduledAt:args.p_scheduled_at,
          lockedUntil:'2026-09-28T12:17:00Z',
        };
      }
      return true;
    },
  });

  const claim=await api.claimScheduledJob({},{
    jobKey:'cron:2026-09-28T12:05:00.000Z',
    groupKey:'cron-global',
    scheduledAt:new Date('2026-09-28T12:05:00Z'),
    leaseSeconds:720,
    retentionSeconds:172800,
  });
  assert.equal(claim.claimed,true);
  assert.equal(claim.persistent,true);
  assert.equal(claim.leaseToken,'lease-token-123456');

  assert.equal(await api.completeScheduledJob({},claim),true);
  assert.deepEqual(calls.map(call=>call.name),['claim_scheduled_job','complete_scheduled_job']);
  assert.equal(calls[0].args.p_lease_seconds,720);
  assert.equal(calls[0].args.p_retention_seconds,172800);
  assert.equal(calls[1].args.p_lease_token,'lease-token-123456');
});

test('scheduled lease claim fails closed when persistent coordination is unavailable', async () => {
  const events=[];
  const api=runtime({
    events,
    supaRpc:async()=>{throw new Error('database unavailable');},
  });
  const claim=await api.claimScheduledJob({},{
    jobKey:'cron:2026-09-28T12:05:00.000Z',
    groupKey:'cron-global',
    scheduledAt:new Date('2026-09-28T12:05:00Z'),
  });
  assert.equal(claim.claimed,false);
  assert.equal(claim.persistent,true);
  assert.equal(claim.reason,'lease_unavailable');
  assert.equal(events[0].code,'SCHEDULED_LEASE_UNAVAILABLE');
});

test('memory-only development mode remains runnable without pretending persistence', async () => {
  const api=runtime({
    hasSupabase:()=>false,
    supaRpc:async()=>{throw new Error('must not be called');},
  });
  const claim=await api.claimScheduledJob({},{
    jobKey:'cron:dev',
    groupKey:'cron-global',
    scheduledAt:new Date('2026-09-28T12:05:00Z'),
  });
  assert.equal(claim.claimed,true);
  assert.equal(claim.persistent,false);
  assert.equal(claim.reason,'memory_only');
});

test('v6.26 migration provides least-privilege atomic scheduled lease contract', () => {
  const sql=fs.readFileSync('supabase/migrations/supabase_migration_v6_26.sql','utf8').toLowerCase();
  for (const marker of [
    'create table if not exists public.scheduled_job_leases',
    "status text not null default 'running'",
    'alter table public.scheduled_job_leases enable row level security',
    'revoke all privileges on table public.scheduled_job_leases from public, anon, authenticated',
    'grant select, insert, update, delete on table public.scheduled_job_leases to service_role',
    'create or replace function public.claim_scheduled_job',
    'pg_advisory_xact_lock',
    "reason','overlap'",
    "reason','duplicate'",
    'create or replace function public.complete_scheduled_job',
    'create or replace function public.release_scheduled_job',
    'revoke execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)',
    'grant execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)',
    "'scheduled_job_leases'",
    "'claim_scheduled_job'",
    "'complete_scheduled_job'",
    "'release_scheduled_job'",
  ]) assert.ok(sql.includes(marker),marker);
  assert.equal(/delete\s+from\s+public\.scheduled_job_leases/.test(sql),false,'claim RPC must not prune with DELETE on the hot path');
});


test('v6.26 lease SQL bounds TTL, blocks active owners and permits stale-owner reclaim', () => {
  const sql=fs.readFileSync('supabase/migrations/supabase_migration_v6_26.sql','utf8').toLowerCase();
  assert.match(
    sql,
    /v_lease_seconds integer := greatest\(30, least\(coalesce\(p_lease_seconds,720\),1800\)\)/,
    'lease ttl must remain bounded between 30 and 1800 seconds',
  );
  assert.match(
    sql,
    /if v_existing\.locked_until>v_now then[\s\S]*?'duplicate_active'[\s\S]*?end if;/,
    'an active owner must block a duplicate claim',
  );
  assert.match(
    sql,
    /and status='running'\s+and locked_until>v_now/,
    'cross-job overlap must only block while the other owner lease is active',
  );
  assert.match(
    sql,
    /on conflict \(job_key\) do update[\s\S]*?status='running'[\s\S]*?lease_token=excluded\.lease_token[\s\S]*?locked_until=excluded\.locked_until/,
    'expired or stale rows must be reclaimable with a new owner token and bounded lock',
  );
});


test('v6.26.1 lease privilege hardening removes non-CRUD service-role table privileges', () => {
  const sql=fs.readFileSync('supabase/migrations/supabase_migration_v6_26_1.sql','utf8').toLowerCase();
  for (const marker of [
    'revoke all privileges on table public.scheduled_job_leases',
    'from public, anon, authenticated',
    'revoke truncate, references, trigger',
    'from service_role',
    'grant select, insert, update, delete',
    'to service_role',
    'revoke execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)',
    'grant execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)',
  ]) assert.ok(sql.includes(marker),marker);
});
