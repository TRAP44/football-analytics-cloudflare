import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createUserRemindersService } from '../src/user-reminders.js';

function runtime(overrides = {}) {
  const memory={reminders:new Map()};
  const rpcCalls=[];
  const service=createUserRemindersService({
    memory,
    hasSupabase:overrides.hasSupabase || (()=>false),
    supaSelectMany:overrides.supaSelectMany || (async()=>[]),
    supaRpc:overrides.supaRpc || (async(_cfg,name,args)=>{
      rpcCalls.push({name,args});
      if (name === 'resolve_match_reminder_fixture') {
        return {
          available:true,
          fixtureId:args.p_fixture_id,
          homeName:'Server Home',
          awayName:'Server Away',
          leagueName:'Server League',
          fixtureDate:new Date(Date.now()+3*60*60_000).toISOString(),
        };
      }
      if (name === 'prune_match_reminders_for_user') return {ok:true,disabled:0,deleted:0};
      if (name === 'save_match_reminder_guarded_v2') {
        return {
          allowed:true,
          reason:args.p_rearm ? 'rearmed' : 'created',
          item:{
            telegram_id:args.p_telegram_id,
            fixture_id:args.p_fixture_id,
            home_name:args.p_home_name,
            away_name:args.p_away_name,
            league_name:args.p_league_name,
            fixture_date:args.p_fixture_date,
            remind_before_minutes:args.p_remind_before_minutes,
            kickoff_notify:args.p_kickoff_notify,
            enabled:true,
          },
        };
      }
      throw new Error('unexpected rpc '+name);
    }),
    fetchWithTimeout:overrides.fetchWithTimeout || (async()=>({ok:true,status:204})),
    supaHeaders:overrides.supaHeaders || ((_cfg,extra)=>extra),
    getPreferences:overrides.getPreferences || (async()=>({reminderMinutes:30,kickoffNotification:true})),
    resolveCanonicalFixture:overrides.resolveCanonicalFixture,
  });
  return {service,memory,rpcCalls};
}

function future(hours=3) {
  return new Date(Date.now()+hours*60*60_000).toISOString();
}

test('Supabase reminder persistence ignores forged client fixture metadata and uses canonical server data', async()=>{
  const {service,rpcCalls}=runtime({hasSupabase:()=>true});
  const row=await service.addReminder(77,{
    fixtureId:9001,
    homeName:'FORGED HOME',
    awayName:'FORGED AWAY',
    leagueName:'FORGED LEAGUE',
    fixtureDate:'2099-01-01T00:00:00.000Z',
  },{supabaseUrl:'https://db.test'});

  assert.equal(row.home_name,'Server Home');
  assert.equal(row.away_name,'Server Away');
  const save=rpcCalls.find(call=>call.name==='save_match_reminder_guarded_v2');
  assert.ok(save);
  assert.equal(save.args.p_home_name,'Server Home');
  assert.equal(save.args.p_away_name,'Server Away');
  assert.equal(save.args.p_league_name,'Server League');
  assert.notEqual(save.args.p_fixture_date,'2099-01-01T00:00:00.000Z');
});

test('cache/provider canonicalization unavailability fails closed before persistence', async()=>{
  const calls=[];
  const {service}=runtime({
    hasSupabase:()=>true,
    supaRpc:async(_cfg,name,args)=>{
      calls.push({name,args});
      if(name==='resolve_match_reminder_fixture') return {available:false,reason:'not_cached'};
      throw new Error('save should not execute');
    },
  });
  await assert.rejects(
    ()=>service.addReminder(88,{fixtureId:9002,homeName:'Fake',awayName:'Fake',fixtureDate:future()},{}),
    error=>error?.code==='REMINDER_FIXTURE_UNAVAILABLE',
  );
  assert.deepEqual(calls.map(call=>call.name),['resolve_match_reminder_fixture']);
});

test('duplicate reminder update preserves delivered state unless rearm is explicit', async()=>{
  const canonical=async fixtureId=>({
    available:true,
    fixtureId,
    homeName:'Home',
    awayName:'Away',
    leagueName:'League',
    fixtureDate:future(),
  });
  const {service,memory}=runtime({resolveCanonicalFixture:canonical});
  await service.addReminder(5,{fixtureId:55,homeName:'x',awayName:'y',fixtureDate:future()},{});

  const stored=memory.reminders.get(5)[0];
  stored.notified_at='2026-10-03T10:00:00.000Z';
  stored.kickoff_notified_at='2026-10-03T11:00:00.000Z';
  stored.lineup_notified_at='2026-10-03T09:30:00.000Z';
  stored.important_change_notified_at='2026-10-03T09:45:00.000Z';
  stored.prematch_attempts=2;
  stored.kickoff_attempts=1;
  stored.delivery_last_success_at='2026-10-03T11:00:00.000Z';

  const updated=await service.addReminder(5,{
    fixtureId:55,
    homeName:'forged',
    awayName:'forged',
    fixtureDate:future(5),
    reminderMinutes:60,
  },{});

  assert.equal(updated.notified_at,'2026-10-03T10:00:00.000Z');
  assert.equal(updated.kickoff_notified_at,'2026-10-03T11:00:00.000Z');
  assert.equal(updated.lineup_notified_at,'2026-10-03T09:30:00.000Z');
  assert.equal(updated.important_change_notified_at,'2026-10-03T09:45:00.000Z');
  assert.equal(updated.prematch_attempts,2);
  assert.equal(updated.kickoff_attempts,1);
  assert.equal(updated.delivery_last_success_at,'2026-10-03T11:00:00.000Z');
  assert.equal(updated.remind_before_minutes,60);

  const rearmed=await service.addReminder(5,{
    fixtureId:55,
    homeName:'forged',
    awayName:'forged',
    fixtureDate:future(5),
    rearm:true,
  },{});

  assert.equal(rearmed.enabled,true);
  assert.equal(rearmed.notified_at,null);
  assert.equal(rearmed.kickoff_notified_at,null);
  assert.equal(rearmed.lineup_notified_at,null);
  assert.equal(rearmed.important_change_notified_at,null);
  assert.equal(rearmed.prematch_attempts,0);
  assert.equal(rearmed.kickoff_attempts,0);
  assert.equal(rearmed.delivery_last_success_at,null);
});

test('expired reminders are disabled and retained only within the bounded retention window', async()=>{
  const {service,memory}=runtime();
  const now=Date.now();
  memory.reminders.set(12,[
    {
      telegram_id:12,fixture_id:1,home_name:'Old',away_name:'Old',
      fixture_date:new Date(now-60*60_000).toISOString(),enabled:true,
    },
    {
      telegram_id:12,fixture_id:2,home_name:'Ancient',away_name:'Ancient',
      fixture_date:new Date(now-120*24*60*60_000).toISOString(),enabled:false,
    },
    {
      telegram_id:12,fixture_id:3,home_name:'Future',away_name:'Future',
      fixture_date:new Date(now+2*60*60_000).toISOString(),enabled:true,
    },
  ]);

  const rows=await service.getReminders(12,{});
  assert.deepEqual(rows.map(row=>row.fixture_id),[3]);
  const persisted=memory.reminders.get(12);
  assert.equal(persisted.find(row=>row.fixture_id===1)?.enabled,false);
  assert.equal(persisted.some(row=>row.fixture_id===2),false);
});

test('unsafe user and fixture identifiers are rejected before storage or delete', async()=>{
  const {service}=runtime();
  await assert.rejects(
    ()=>service.addReminder(Number.MAX_SAFE_INTEGER+10,{fixtureId:1,homeName:'A',awayName:'B',fixtureDate:future()},{}),
    error=>error?.code==='PERSONAL_DATA_INVALID',
  );
  await assert.rejects(
    ()=>service.addReminder(1,{fixtureId:Number.MAX_SAFE_INTEGER+10,homeName:'A',awayName:'B',fixtureDate:future()},{}),
    error=>error?.code==='PERSONAL_DATA_INVALID',
  );
  await assert.rejects(
    ()=>service.removeReminder(1,-1,{}),
    error=>error?.code==='PERSONAL_DATA_INVALID',
  );
});

test('v6.25.2 SQL contract canonicalizes, prunes, preserves idempotent state and requires explicit rearm',()=>{
  const sql=fs.readFileSync('supabase/migrations/supabase_migration_v6_25_2.sql','utf8');
  assert.match(sql,/create or replace function public\.resolve_match_reminder_fixture/);
  assert.match(sql,/provider-fixtures:%/);
  assert.match(sql,/match-center:%/);
  assert.match(sql,/observed_at >= now\(\) - interval '36 hours'/);
  assert.match(sql,/create or replace function public\.prune_match_reminders_for_user/);
  assert.match(sql,/fixture_date <= now\(\) - interval '10 minutes'/);
  assert.match(sql,/fixture_date < now\(\) - interval '90 days'/);
  assert.match(sql,/create or replace function public\.save_match_reminder_guarded_v2/);
  assert.match(sql,/coalesce\(p_rearm, false\)/);
  assert.match(sql,/reason', 'rearmed'/);
  assert.match(sql,/Compatibility wrapper/);
  assert.match(sql,/save_match_reminder_guarded_v2[\s\S]*false,[\s\S]*p_limit/);
  assert.match(sql,/revoke execute on function public\.resolve_match_reminder_fixture\(bigint\)[\s\S]*from public, anon, authenticated/);
  assert.match(sql,/grant execute on function public\.resolve_match_reminder_fixture\(bigint\)[\s\S]*to service_role/);
});

test('HTTP contract exposes cache-unavailable reminder validation as recoverable',()=>{
  const http=fs.readFileSync('src/http.js','utf8');
  assert.match(http,/REMINDER_FIXTURE_UNAVAILABLE/);
  assert.match(http,/category: 'fixture_validation'/);
  assert.match(http,/recoverable: true/);
});
