import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_PREFERENCES,
  createUserPreferencesService,
} from '../src/user-preferences.js';

function runtime(overrides = {}) {
  const memory={preferences:new Map()};
  const reads=[];
  const writes=[];
  const service=createUserPreferencesService({
    memory,
    hasSupabase:overrides.hasSupabase || (()=>false),
    supaSelectOne:overrides.supaSelectOne || (async(_cfg,table,filters)=>{
      reads.push({table,filters});
      return null;
    }),
    supaUpsert:overrides.supaUpsert || (async(_cfg,table,row,onConflict)=>{
      writes.push({table,row,onConflict});
      return row;
    }),
  });
  return {memory,reads,writes,service};
}

test('preferences service preserves default normalization', () => {
  const {service}=runtime();
  assert.deepEqual(service.normalizePreferences({}),DEFAULT_PREFERENCES);
  assert.deepEqual(service.normalizePreferences({
    default_filter:'favorites',
    reminder_minutes:60,
    kickoff_notification:false,
    hide_youth:false,
    favorite_first:false,
  }),{
    defaultFilter:'favorites',
    reminderMinutes:60,
    kickoffNotification:false,
    hideYouth:false,
    favoriteFirst:false,
  });
  assert.equal(service.normalizePreferences({defaultFilter:'invalid'}).defaultFilter,'top');
  assert.equal(service.normalizePreferences({reminderMinutes:99}).reminderMinutes,30);
});

test('preferences service preserves memory read and partial-save semantics', async () => {
  const {memory,service}=runtime();
  memory.preferences.set(7,{
    telegram_id:7,
    default_filter:'all',
    reminder_minutes:60,
    kickoff_notification:false,
    hide_youth:true,
    favorite_first:false,
  });
  const before=await service.getPreferences(7,{});
  assert.equal(before.defaultFilter,'all');
  assert.equal(before.reminderMinutes,60);
  assert.equal(before.kickoffNotification,false);

  const next=await service.savePreferences(7,{reminderMinutes:15,hideYouth:false},{});
  assert.deepEqual(next,{
    defaultFilter:'all',
    reminderMinutes:15,
    kickoffNotification:false,
    hideYouth:false,
    favoriteFirst:false,
  });
  const stored=memory.preferences.get(7);
  assert.equal(stored.default_filter,'all');
  assert.equal(stored.reminder_minutes,15);
  assert.equal(stored.hide_youth,false);
  assert.ok(stored.updated_at);
});

test('preferences service preserves Supabase read and upsert contracts', async () => {
  const {reads,writes,service}=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async(_cfg,table,filters)=>{
      reads.push({table,filters});
      return {
        telegram_id:11,
        default_filter:'favorites',
        reminder_minutes:30,
        kickoff_notification:true,
        hide_youth:false,
        favorite_first:true,
      };
    },
  });
  const cfg={supabaseUrl:'https://db.test'};
  const current=await service.getPreferences(11,cfg);
  assert.equal(current.defaultFilter,'favorites');
  assert.deepEqual(reads[0],{table:'user_preferences',filters:{telegram_id:'eq.11'}});

  const next=await service.savePreferences(11,{favoriteFirst:false},cfg);
  assert.equal(next.favoriteFirst,false);
  assert.equal(writes.length,1);
  assert.equal(writes[0].table,'user_preferences');
  assert.equal(writes[0].onConflict,'telegram_id');
  assert.equal(writes[0].row.telegram_id,11);
  assert.equal(writes[0].row.default_filter,'favorites');
  assert.equal(writes[0].row.favorite_first,false);
});

test('preferences service surfaces Supabase read failures instead of overwriting with defaults', async () => {
  const {service}=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>{ throw new Error('Supabase preferences unavailable'); },
  });
  await assert.rejects(
    ()=>service.getPreferences(15,{supabaseUrl:'https://db.test'}),
    /Supabase preferences unavailable/,
  );
});

test('worker delegates preferences storage boundary to extracted service', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/import \{ createUserPreferencesService \} from '\.\/user-preferences\.js'/);
  assert.match(worker,/createUserPreferencesService\(\{/);
  assert.match(worker,/supaSelectOne,/);
  assert.match(worker,/supaUpsert,/);
  assert.doesNotMatch(worker,/function normalizePreferences\(row = \{\}\)/);
  assert.doesNotMatch(worker,/async function getPreferences\(userId, cfg\)/);
  assert.doesNotMatch(worker,/async function savePreferences\(userId, input, cfg\)/);
  assert.match(worker,/getPreferences,/);
  assert.match(worker,/savePreferences,/);
  assert.match(worker,/getPreferences\(user\.id, cfg\)/);
  assert.match(worker,/savePreferences\(user\.id, body, cfg\)/);
});
