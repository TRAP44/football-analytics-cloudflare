import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import {
  REMINDER_DELIVERY_KINDS,
  createReminderDeliveryStore,
  reminderDeliveryKindConfig,
} from '../src/reminder-delivery-store.js';
import { createUserRemindersService } from '../src/user-reminders.js';

const migration=readFileSync(
  new URL(
    '../supabase/migrations/supabase_migration_v6_21_3.sql',
    import.meta.url,
  ),
  'utf8',
);
const canonicalReminderMigration=readFileSync(
  new URL(
    '../supabase/migrations/supabase_migration_v6_25_2.sql',
    import.meta.url,
  ),
  'utf8',
);
const release=JSON.parse(
  readFileSync(
    new URL('../release-contract.json',import.meta.url),
    'utf8',
  ),
);

function versionTuple(path) {
  const match=/supabase_migration_v(\d+(?:_\d+)*)\.sql$/i.exec(
    path || '',
  );
  assert.ok(match,`Unparseable migration path: ${path}`);
  return match[1].split('_').map(Number);
}

function compareVersion(left,right) {
  const size=Math.max(left.length,right.length);
  for (let index=0;index<size;index+=1) {
    const delta=(left[index] || 0)-(right[index] || 0);
    if (delta) return delta;
  }
  return 0;
}

function reminderService(memory) {
  return createUserRemindersService({
    memory,
    hasSupabase:()=>false,
    supaSelectMany:async()=>[],
    supaRpc:async()=>null,
    fetchWithTimeout:async()=>({
      ok:true,
      status:204,
    }),
    supaHeaders:()=>({}),
    getPreferences:async()=>({
      reminderMinutes:30,
      kickoffNotification:true,
    }),
    resolveCanonicalFixture:async fixtureId=>({
      available:true,
      fixtureId,
      homeName:'Home',
      awayName:'Away',
      leagueName:'League',
      fixtureDate:'2099-01-01T12:00:00Z',
    }),
  });
}

function storeHarness() {
  const calls=[];
  const responses=[];
  const now=Date.parse('2026-10-07T12:00:00.000Z');
  const store=createReminderDeliveryStore({
    hasSupabase:()=>true,
    fetchWithTimeout:async(url,init,timeout,source)=>{
      calls.push({
        url:String(url),
        init,
        timeout,
        source,
      });
      const next=responses.shift();
      if (!next) throw new Error('Unexpected persistence call.');
      return {
        ok:next.ok,
        status:next.status,
        async json(){return next.json;},
      };
    },
    supaHeaders:(_cfg,extra)=>({
      ...extra,
      authorization:'Bearer test',
    }),
    recordOpsEvent:async()=>{},
    redactOpsString:(value,limit)=>
      typeof value==='string'
        ? value.slice(0,limit)
        : '',
    now:()=>now,
  });
  return {store,calls,responses,now};
}

test('important-change delivery kind maps to dedicated atomic persistence columns',()=>{
  assert.deepEqual(
    reminderDeliveryKindConfig('important_change'),
    {
      claimColumn:'important_change_claimed_at',
      doneColumn:'important_change_notified_at',
      attemptsColumn:'important_change_attempts',
    },
  );
  assert.equal(
    Object.hasOwn(
      REMINDER_DELIVERY_KINDS,
      'important_change',
    ),
    true,
  );
  assert.equal(
    Object.isFrozen(
      REMINDER_DELIVERY_KINDS.important_change,
    ),
    true,
  );
});

test('important-change claim and finish use the dedicated columns atomically',async()=>{
  const {store,calls,responses}=storeHarness();
  const claimAt='2026-10-07T12:00:00.000Z';
  const row={
    telegram_id:7,
    fixture_id:77,
    important_change_attempts:2,
  };

  responses.push({
    ok:true,
    status:200,
    json:[{
      telegram_id:7,
      fixture_id:77,
      important_change_claimed_at:claimAt,
    }],
  });
  const claim=await store.claimReminderDelivery(
    row,
    'important_change',
    {supabaseUrl:'https://db.test'},
  );

  assert.deepEqual(claim,{
    claimed:true,
    claimAt,
  });
  assert.match(
    calls[0].url,
    /important_change_notified_at=is\.null/,
  );
  assert.match(
    calls[0].url,
    /important_change_claimed_at=is\.null/,
  );
  const claimBody=JSON.parse(calls[0].init.body);
  assert.equal(
    claimBody.important_change_claimed_at,
    claimAt,
  );
  assert.equal(
    claimBody.important_change_attempts,
    3,
  );

  responses.push({
    ok:true,
    status:200,
    json:[{
      telegram_id:7,
      fixture_id:77,
      important_change_claimed_at:null,
      important_change_notified_at:claimAt,
    }],
  });
  const finish=await store.finishReminderDelivery(
    row,
    'important_change',
    claimAt,
    {supabaseUrl:'https://db.test'},
  );

  assert.deepEqual(finish,{
    finalized:true,
    reconciled:false,
    doneAt:claimAt,
  });
  assert.match(
    calls[1].url,
    /important_change_claimed_at=eq\.2026-10-07T12%3A00%3A00\.000Z/,
  );
  const finishBody=JSON.parse(calls[1].init.body);
  assert.equal(
    finishBody.important_change_notified_at,
    claimAt,
  );
  assert.equal(
    finishBody.important_change_claimed_at,
    null,
  );
});

test('important-change sent state requires deterministic timezone-bearing persistence evidence',()=>{
  const {store}=storeHarness();

  assert.equal(
    store.reminderDeliveryStatus({
      important_change_notified_at:
        '2026-10-07T12:00:00Z',
    }),
    'important_change_sent',
  );
  assert.equal(
    store.reminderDeliveryStatus({
      important_change_notified_at:
        '2026-10-07T12:00:00+03:00',
    }),
    'important_change_sent',
  );
  assert.equal(
    store.reminderDeliveryStatus({
      important_change_notified_at:
        '2026-10-07T12:00:00',
    }),
    'scheduled',
  );
  assert.equal(
    store.reminderDeliveryStatus({
      important_change_notified_at:'2026-10-07',
    }),
    'scheduled',
  );
});

test('historical migration introduced all dedicated important-change columns',()=>{
  assert.match(
    migration,
    /add column if not exists important_change_notified_at timestamptz/i,
  );
  assert.match(
    migration,
    /add column if not exists important_change_claimed_at timestamptz/i,
  );
  assert.match(
    migration,
    /add column if not exists important_change_attempts integer not null default 0/i,
  );
  assert.match(
    migration,
    /important_change_notified_at = null/i,
  );
  assert.match(
    migration,
    /important_change_claimed_at = null/i,
  );
  assert.match(
    migration,
    /important_change_attempts = 0/i,
  );
});

test('current canonical reminder migration preserves important-change state unless explicitly rearmed',()=>{
  const rearmIndex=canonicalReminderMigration.indexOf(
    "if coalesce(p_rearm, false) then",
  );
  const normalUpdateIndex=canonicalReminderMigration.indexOf(
    "return jsonb_build_object(\n      'allowed', true,\n      'reason', 'updated'",
    rearmIndex,
  );
  assert.ok(rearmIndex>=0);
  assert.ok(normalUpdateIndex>rearmIndex);

  const rearmBlock=canonicalReminderMigration.slice(
    rearmIndex,
    normalUpdateIndex,
  );
  assert.match(
    rearmBlock,
    /important_change_notified_at = null/,
  );
  assert.match(
    rearmBlock,
    /important_change_claimed_at = null/,
  );
  assert.match(
    rearmBlock,
    /important_change_attempts = 0/,
  );

  const normalUpdateStart=
    canonicalReminderMigration.lastIndexOf(
      'update public.match_reminders',
      normalUpdateIndex,
    );
  const normalUpdateBlock=canonicalReminderMigration.slice(
    normalUpdateStart,
    normalUpdateIndex,
  );
  assert.doesNotMatch(
    normalUpdateBlock,
    /important_change_notified_at\s*=\s*null/,
  );
  assert.doesNotMatch(
    normalUpdateBlock,
    /important_change_attempts\s*=\s*0/,
  );
});

test('memory reminder lifecycle matches explicit-rearm persistence semantics',async()=>{
  const memory={reminders:new Map()};
  const service=reminderService(memory);

  const created=await service.addReminder(
    11,
    {
      fixtureId:77,
      reminderMinutes:30,
      kickoffNotify:true,
    },
    {},
  );

  assert.equal(created.important_change_notified_at,null);
  assert.equal(created.important_change_claimed_at,null);
  assert.equal(created.important_change_attempts,0);

  const stored=memory.reminders.get(11)[0];
  stored.important_change_notified_at=
    '2026-10-07T12:00:00Z';
  stored.important_change_claimed_at=
    '2026-10-07T11:59:00Z';
  stored.important_change_attempts=4;

  const updated=await service.addReminder(
    11,
    {
      fixtureId:77,
      reminderMinutes:60,
      kickoffNotify:false,
    },
    {},
  );

  assert.equal(
    updated.important_change_notified_at,
    '2026-10-07T12:00:00Z',
  );
  assert.equal(
    updated.important_change_claimed_at,
    '2026-10-07T11:59:00Z',
  );
  assert.equal(updated.important_change_attempts,4);

  const rearmed=await service.addReminder(
    11,
    {
      fixtureId:77,
      reminderMinutes:30,
      kickoffNotify:true,
      rearm:true,
    },
    {},
  );

  assert.equal(rearmed.important_change_notified_at,null);
  assert.equal(rearmed.important_change_claimed_at,null);
  assert.equal(rearmed.important_change_attempts,0);
});

test('release contract points to an existing migration newer than important-change introduction',()=>{
  const latestPath=release.latestMigration;
  assert.equal(typeof latestPath,'string');
  assert.equal(
    existsSync(new URL(`../${latestPath}`,import.meta.url)),
    true,
  );
  assert.ok(
    compareVersion(
      versionTuple(latestPath),
      versionTuple(
        'supabase/migrations/supabase_migration_v6_21_3.sql',
      ),
    )>=0,
  );
  assert.equal(
    release.databaseContract
      ?.personalWriteGuards
      ?.explicitRearm,
    true,
  );
  assert.equal(
    release.databaseContract
      ?.personalWriteGuards
      ?.canonicalReminders,
    true,
  );
});
