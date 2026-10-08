import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createUserFavoritesService } from '../src/user-favorites.js';
import { createUserRemindersService } from '../src/user-reminders.js';
import {
  PERSONAL_WRITE_LIMITS,
  normalizeFavoritePlayerReference,
  normalizeFavoritePlayerWrite,
  normalizeFavoriteWrite,
  normalizeReminderWrite,
} from '../src/personal-write-guards.js';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const favorites = fs.readFileSync('src/user-favorites.js', 'utf8');
const reminders = fs.readFileSync('src/user-reminders.js', 'utf8');
const serviceWiring = fs.readFileSync('src/service-wiring-runtime.js', 'utf8');
const schemaRuntime = fs.readFileSync('src/supabase-schema-runtime.js', 'utf8');
const http = fs.readFileSync('src/http.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/supabase_migration_v6_19_1.sql', 'utf8').toLowerCase();

test('personal write guards normalize valid favorites and reject unsafe payloads', () => {
  assert.deepEqual(
    normalizeFavoriteWrite({ teamId: 7, teamName: ' Arsenal ', teamLogo: 'https://example.test/logo.png' }),
    { teamId: 7, teamName: 'Arsenal', teamLogo: 'https://example.test/logo.png' },
  );
  assert.throws(() => normalizeFavoriteWrite({ teamId: 0, teamName: 'x' }), /Некорректная команда/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'x'.repeat(PERSONAL_WRITE_LIMITS.teamName + 1) }), /слишком длинный/);
  assert.throws(() => normalizeFavoriteWrite({ teamId: 7, teamName: 'Club', teamLogo: 'javascript:alert(1)' }), /Некорректный URL/);
});

test('personal write guards reject coerced IDs, non-string names and credentialed logo URLs', () => {
  assert.throws(
    () => normalizeFavoriteWrite({teamId:true,teamName:'Club'}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.throws(
    () => normalizeFavoriteWrite({teamId:7,teamName:{name:'Club'}}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.throws(
    () => normalizeFavoriteWrite({teamId:7,teamName:'Club\u0000Name'}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.throws(
    () => normalizeFavoriteWrite({teamId:7,teamName:'Club',teamLogo:'https://user:secret@example.test/logo.png'}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );

  assert.deepEqual(
    normalizeFavoritePlayerReference({playerId:'15',teamId:'7'}),
    {playerId:15,teamId:7},
  );
  assert.throws(
    () => normalizeFavoritePlayerReference({playerId:[15],teamId:7}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.throws(
    () => normalizeFavoritePlayerWrite({playerId:15,teamId:7,playerName:['Player']}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
});

test('personal write guards normalize valid reminders and reject stale or oversized input', () => {
  const now = Date.parse('2026-09-27T18:00:00.000Z');
  const row = normalizeReminderWrite({
    fixtureId: 42,
    homeName: ' Home ',
    awayName: ' Away ',
    leagueName: ' League ',
    fixtureDate: '2026-09-27T20:00:00.000Z',
    reminderMinutes: 60,
    kickoffNotify: false,
  }, now);
  assert.equal(row.fixtureId, 42);
  assert.equal(row.homeName, 'Home');
  assert.equal(row.awayName, 'Away');
  assert.equal(row.leagueName, 'League');
  assert.equal(row.reminderMinutes, 60);
  assert.equal(row.kickoffNotify, false);
  assert.throws(() => normalizeReminderWrite({
    fixtureId: 42,
    homeName: 'Home',
    awayName: 'Away',
    fixtureDate: '2026-09-27T18:04:00.000Z',
  }, now), /начинается или начался/);

  assert.throws(() => normalizeReminderWrite({
    fixtureId:true,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27T20:00:00.000Z',
  },now), error => error?.code === 'PERSONAL_DATA_INVALID');

  assert.throws(() => normalizeReminderWrite({
    fixtureId:42,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27 20:00:00',
  },now), /Некорректное время матча/);

  assert.throws(() => normalizeReminderWrite({
    fixtureId:42,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-02-30T20:00:00.000Z',
  },now), /Некорректное время матча/);

  assert.throws(() => normalizeReminderWrite({
    fixtureId:42,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27T20:00:00+14:30',
  },now), /Некорректное время матча/);



  assert.throws(() => normalizeReminderWrite({
    fixtureId:42,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27T20:00:00.000Z',
    kickoffNotify:'false',
  },now), error => error?.code === 'PERSONAL_DATA_INVALID');

  assert.throws(() => normalizeReminderWrite({
    fixtureId:42,
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27T20:00:00.000Z',
  },Number.NaN), /Некорректное текущее время/);

  assert.equal(normalizeReminderWrite({
    fixtureId:'42',
    homeName:'Home',
    awayName:'Away',
    fixtureDate:'2026-09-27T20:00:00+00:00',
    reminderMinutes:'60',
  },now).reminderMinutes,60);
});

test('v6.19.1 serializes per-user writes and keeps RPCs backend-only', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /save_favorite_guarded/);
  assert.match(migration, /save_match_reminder_guarded/);
  assert.match(migration, /limit_reached/);
  assert.match(migration, /revoke execute on function public\.save_favorite_guarded[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_favorite_guarded[\s\S]*to service_role/);
  assert.match(migration, /revoke execute on function public\.save_match_reminder_guarded[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_match_reminder_guarded[\s\S]*to service_role/);
});

test('personal write storage boundaries use guarded RPCs instead of direct upserts', () => {
  assert.match(favorites, /save_favorite_guarded/);
  assert.doesNotMatch(favorites, /supaUpsert\(cfg, 'favorites'/);
  assert.match(serviceWiring, /createUserFavoritesService\(\{/);
  assert.doesNotMatch(worker, /async function addFavorite\(/);

  assert.match(reminders, /save_match_reminder_guarded/);
  assert.doesNotMatch(reminders, /supaUpsert\(cfg, 'match_reminders'/);
  assert.match(serviceWiring, /createUserRemindersService\(\{/);
  assert.doesNotMatch(worker, /async function addReminder\(/);
  assert.match(http, /FAVORITES_LIMIT/);
  assert.match(http, /REMINDERS_LIMIT/);
  assert.match(worker, /createSupabaseSchemaRuntime\(\{[\s\S]*PERSONAL_WRITE_LIMITS/);
});

test('personal write guard contract is a blocking schema-drift dependency', () => {
  assert.match(worker, /readPersonalWriteGuardContract/);
  assert.match(schemaRuntime, /missing\.push\('personal_write_guards'\)/);
  assert.match(schemaRuntime, /summary\.ok && fingerprint\.ok && personalWriteGuards\.ok/);
});

test('favorite guards enforce safe integer IDs and canonical text bounds', () => {
  const valid=normalizeFavoriteWrite({
    teamId:String(Number.MAX_SAFE_INTEGER),
    teamName:'  North    City  ',
    teamLogo:'',
  });
  assert.deepEqual(valid,{
    teamId:Number.MAX_SAFE_INTEGER,
    teamName:'North City',
    teamLogo:'',
  });
  assert.equal(
    normalizeFavoriteWrite({teamId:7,teamName:'N'.repeat(PERSONAL_WRITE_LIMITS.teamName)}).teamName.length,
    PERSONAL_WRITE_LIMITS.teamName,
  );
  for (const teamId of ['0','-1','1.5','1e3','9007199254740992',false,[7],Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => normalizeFavoriteWrite({teamId,teamName:'Club'}),
      error => error?.code === 'PERSONAL_DATA_INVALID',
      'Unsafe teamId must be rejected: '+String(teamId),
    );
  }
  assert.throws(
    () => normalizeFavoriteWrite({teamId:7,teamName:'   '}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.throws(
    () => normalizeFavoriteWrite({teamId:7,teamName:'Club'+String.fromCharCode(127)}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
});

test('favorite player guards validate both IDs and the bounded required name', () => {
  assert.deepEqual(
    normalizeFavoritePlayerWrite({playerId:'15',teamId:'7',playerName:'  First   Last  '}),
    {playerId:15,teamId:7,playerName:'First Last'},
  );
  for (const input of [
    {playerId:0,teamId:7,playerName:'Player'},
    {playerId:15,teamId:0,playerName:'Player'},
    {playerId:15,teamId:7,playerName:' '},
    {playerId:15,teamId:7,playerName:'X'.repeat(PERSONAL_WRITE_LIMITS.playerName+1)},
    {playerId:15,teamId:7,playerName:'Player'+String.fromCharCode(0)},
  ]) {
    assert.throws(
      () => normalizeFavoritePlayerWrite(input),
      error => error?.code === 'PERSONAL_DATA_INVALID',
    );
  }
});

test('reminder timestamps enforce timezone, leap-year and five-minute boundaries', () => {
  const now=Date.parse('2026-09-27T18:00:00.000Z');
  const input={fixtureId:42,homeName:'Home',awayName:'Away'};
  assert.equal(
    normalizeReminderWrite({...input,fixtureDate:'2026-09-27T22:00:00+02:00'},now).fixtureDate,
    '2026-09-27T20:00:00.000Z',
  );
  assert.equal(
    normalizeReminderWrite({...input,fixtureDate:'2028-02-29T12:00:00Z'},now).fixtureDate,
    '2028-02-29T12:00:00.000Z',
  );
  assert.throws(
    () => normalizeReminderWrite({...input,fixtureDate:'2026-09-27T18:05:00.000Z'},now),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.equal(
    normalizeReminderWrite({...input,fixtureDate:'2026-09-27T18:05:00.001Z'},now).fixtureDate,
    '2026-09-27T18:05:00.001Z',
  );
  for (const fixtureDate of [
    '2026-02-29T20:00:00Z',
    '2026-04-31T20:00:00Z',
    '2026-09-27T24:00:00Z',
    '2026-09-27T20:60:00Z',
    '2026-09-27T20:00:60Z',
    '2026-09-27T20:00:00+14:01',
    '2026-09-27T20:00:00+00:60',
    '2026-09-27T20:00:00',
  ]) {
    assert.throws(
      () => normalizeReminderWrite({...input,fixtureDate},now),
      error => error?.code === 'PERSONAL_DATA_INVALID',
      'Invalid fixtureDate must be rejected: '+fixtureDate,
    );
  }
});

test('reminder defaults and user-supplied preference types remain bounded', () => {
  const now=Date.parse('2026-09-27T18:00:00.000Z');
  const input={fixtureId:42,homeName:'Home',awayName:'Away',fixtureDate:'2026-09-27T20:00:00Z'};
  const defaults=normalizeReminderWrite(input,now);
  assert.equal(defaults.reminderMinutes,30);
  assert.equal(defaults.kickoffNotify,true);
  assert.equal(defaults.leagueName,'');
  assert.equal(normalizeReminderWrite({...input,reminderMinutes:45},now).reminderMinutes,30);
  for (const bad of [
    {...input,homeName:' '},
    {...input,awayName:'A'.repeat(PERSONAL_WRITE_LIMITS.clubName+1)},
    {...input,leagueName:'L'.repeat(PERSONAL_WRITE_LIMITS.leagueName+1)},
    {...input,kickoffNotify:0},
    {...input,fixtureId:Number.MAX_SAFE_INTEGER+1},
  ]) {
    assert.throws(
      () => normalizeReminderWrite(bad,now),
      error => error?.code === 'PERSONAL_DATA_INVALID',
    );
  }
  for (const badNow of [null,NaN,Infinity,'2026-09-27T18:00:00Z']) {
    assert.throws(
      () => normalizeReminderWrite(input,badNow),
      error => error?.code === 'PERSONAL_DATA_INVALID',
    );
  }
});

test('favorites persistence sends validated fields only through the guarded RPC', async () => {
  const calls=[];
  const memory={};
  const service=createUserFavoritesService({
    memory,
    hasSupabase:()=>true,
    supaRpc:async (_cfg,name,params,timeout)=>{
      calls.push({name,params,timeout});
      return {allowed:true,item:{telegram_id:123,team_id:7,team_name:'Club',team_logo:''}};
    },
  });
  const saved=await service.addFavorite('123',{id:'7',name:' Club ',logo:''},{});
  assert.equal(saved.team_id,7);
  assert.deepEqual(calls,[{
    name:'save_favorite_guarded',
    params:{p_telegram_id:123,p_team_id:7,p_team_name:'Club',p_team_logo:'',p_limit:PERSONAL_WRITE_LIMITS.favorites},
    timeout:4000,
  }]);
  await assert.rejects(
    service.addFavorite(123,{id:true,name:'Club'},{}),
    error => error?.code === 'PERSONAL_DATA_INVALID',
  );
  assert.equal(calls.length,1,'Invalid inputs must fail before reaching Supabase');
  const rejected=createUserFavoritesService({
    memory,
    hasSupabase:()=>true,
    supaRpc:async()=>({allowed:false,reason:'limit_reached'}),
  });
  await assert.rejects(
    rejected.addFavorite(123,{id:8,name:'Club'},{}),
    error => error?.code === 'FAVORITES_LIMIT',
  );
  assert.equal(memory.favorites.size,0,'A denied database write must not be added in memory');
});

test('reminders persistence never trusts client fixture details and uses guarded v2', async () => {
  const calls=[];
  const service=createUserRemindersService({
    memory:{},
    hasSupabase:()=>true,
    getPreferences:async()=>({reminderMinutes:60,kickoffNotification:false}),
    supaRpc:async (_cfg,name,params,timeout)=>{
      calls.push({name,params,timeout});
      return {allowed:true,item:{telegram_id:123,fixture_id:42}};
    },
  });
  const saved=await service.addReminder('123',{
    fixtureId:'42',
    homeName:'Client-controlled home',
    awayName:'Client-controlled away',
    leagueName:'Client-controlled league',
    fixtureDate:'2020-01-01T00:00:00Z',
    rearm:true,
  },{});
  assert.equal(saved.fixture_id,42);
  assert.deepEqual(calls,[{
    name:'save_match_reminder_guarded_v2',
    params:{
      p_telegram_id:123,
      p_fixture_id:42,
      p_home_name:'',
      p_away_name:'',
      p_league_name:'',
      p_fixture_date:null,
      p_remind_before_minutes:60,
      p_kickoff_notify:false,
      p_rearm:true,
      p_limit:PERSONAL_WRITE_LIMITS.reminders,
    },
    timeout:4000,
  }]);
});

test('reminder RPC denials fail closed with typed errors', async () => {
  const build=(payload)=>createUserRemindersService({
    memory:{},
    hasSupabase:()=>true,
    getPreferences:async()=>({}),
    supaRpc:async()=>payload,
  });
  for (const [reason,expected] of [
    ['limit_reached','REMINDERS_LIMIT'],
    ['fixture_started','PERSONAL_DATA_INVALID'],
    ['fixture_unavailable','REMINDER_FIXTURE_UNAVAILABLE'],
    ['not_cached','REMINDER_FIXTURE_UNAVAILABLE'],
    ['invalid_input','PERSONAL_DATA_INVALID'],
  ]) {
    await assert.rejects(
      build({allowed:false,reason}).addReminder(123,{fixtureId:42},{}),
      error => error?.code === expected,
      'Unexpected failure mapping for '+reason,
    );
  }
  await assert.rejects(
    build({allowed:true,item:{telegram_id:999,fixture_id:42}})
      .addReminder(123,{fixtureId:42},{}),
    /invalid guarded RPC response/,
  );
});

test('current personal-write v2 schema contract stays service-role-only and complete', () => {
  const current=fs.readFileSync('supabase/migrations/supabase_migration_v6_29_2.sql','utf8').toLowerCase();
  for (const [field,value] of [
    ['version',"'v2'"],
    ['favoriteslimit','50'],
    ['favoriteplayerslimit','50'],
    ['reminderslimit','50'],
    ['canonicalreminders','true'],
    ['explicitrearm','true'],
    ['reminderretentiondays','90'],
  ]) {
    assert.match(current,new RegExp("'"+field+"'\\s*,\\s*"+value+"\\b"));
  }
  assert.match(current,/revoke all on function public\.personal_write_guard_contract\(\)\s+from public, anon, authenticated;/);
  assert.match(current,/grant execute on function public\.personal_write_guard_contract\(\)\s+to service_role;/);
  const canonical=fs.readFileSync('supabase/migrations/supabase_migration_v6_25_2.sql','utf8').toLowerCase();
  assert.match(canonical,/create or replace function public\.save_match_reminder_guarded_v2\(/);
  assert.match(schemaRuntime,/favoritePlayersLimit === PERSONAL_WRITE_LIMITS\.favoritePlayers/);
  assert.match(schemaRuntime,/canonicalReminders\s*&&\s*explicitRearm/);
});
