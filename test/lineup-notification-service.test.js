import test from 'node:test';
import assert from 'node:assert/strict';
import { createLineupNotificationService } from '../src/lineup-notification-service.js';

const NOW=Date.parse('2026-10-07T18:00:00.000Z');

function row(userId,fixtureId,minutes=45,overrides={}) {
  return {
    telegram_id:userId,
    fixture_id:fixtureId,
    home_name:'Home',
    away_name:'Away',
    league_name:'League',
    fixture_date:new Date(NOW+minutes*60_000).toISOString(),
    enabled:true,
    lineup_notified_at:null,
    ...overrides,
  };
}

function runtime({
  rows=[],
  snapshots={},
  maxFixturesPerRun=4,
  hasSupabase=()=>true,
  loadRuntimeControls=async()=>({
    value:{remindersEnabled:true},
  }),
  supaSelectPaged,
  loadLineupSnapshot,
  deliverClaimedReminder,
  filterNotificationRecipients,
  recordOpsEvent,
  now=()=>NOW,
}={}) {
  const probes=[];
  const deliveries=[];
  const events=[];

  const service=createLineupNotificationService({
    hasSupabase,
    loadRuntimeControls,
    supaSelectPaged:supaSelectPaged || (async()=>({
      rows,
      truncated:false,
    })),
    loadLineupSnapshot:loadLineupSnapshot || (async fixtureId=>{
      probes.push(fixtureId);
      return snapshots[fixtureId] || {confirmed:false};
    }),
    deliverClaimedReminder:deliverClaimedReminder || (async(reminder,kind,text)=>{
      deliveries.push({reminder,kind,text});
      return {state:'sent'};
    }),
    filterNotificationRecipients,
    recordOpsEvent:recordOpsEvent || (async(_cfg,event)=>events.push(event)),
    maxFixturesPerRun,
    now,
  });

  return {service,probes,deliveries,events};
}

test('lineup notification service validates required dependencies and freezes API',()=>{
  const {service}=runtime();
  assert.equal(Object.isFrozen(service),true);

  const base={
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({
      value:{remindersEnabled:true},
    }),
    supaSelectPaged:async()=>({
      rows:[],
      truncated:false,
    }),
    loadLineupSnapshot:async()=>({confirmed:false}),
    deliverClaimedReminder:async()=>({state:'sent'}),
    now:()=>NOW,
  };

  for (const key of [
    'hasSupabase',
    'loadRuntimeControls',
    'supaSelectPaged',
    'loadLineupSnapshot',
    'deliverClaimedReminder',
    'now',
  ]) {
    assert.throws(
      ()=>createLineupNotificationService({
        ...base,
        [key]:null,
      }),
      /Lineup notifications require/,
      key,
    );
  }
});

test('lineup notifications probe each unique fixture once and fan out through lineup claims',async()=>{
  const rows=[
    row(1,100),
    row(2,100),
    row(3,200),
  ];
  const {service,probes,deliveries}=runtime({
    rows,
    snapshots:{
      100:{confirmed:true},
      200:{confirmed:false},
    },
  });

  const result=await service.processLineupNotifications({
    botToken:'token',
  });

  assert.deepEqual(probes,[100,200]);
  assert.equal(deliveries.length,2);
  assert.ok(deliveries.every(item=>item.kind==='lineup'));
  assert.ok(
    deliveries.every(
      item=>item.text.includes('Составы опубликованы'),
    ),
  );
  assert.equal(result.confirmed,1);
  assert.equal(result.sent,2);
  assert.equal(result.ok,true);
});

test('lineup scheduler locally validates identity, enabled state, notification state and candidate window',async()=>{
  const rows=[
    row(1,100),
    row(2,200,45,{enabled:false}),
    row(3,300,45,{
      lineup_notified_at:'2026-10-07T17:30:00.000Z',
    }),
    row(4,400,45,{
      fixture_date:'2026-10-07T18:45:00',
    }),
    row(5,500,120),
    row(6,600,-10),
    {
      ...row(7,700),
      fixture_id:true,
    },
  ];

  const {service,probes,deliveries}=runtime({
    rows,
    snapshots:{
      100:{confirmed:true},
      200:{confirmed:true},
      300:{confirmed:true},
      400:{confirmed:true},
      500:{confirmed:true},
      600:{confirmed:true},
      700:{confirmed:true},
    },
  });

  const result=await service.processLineupNotifications({
    botToken:'token',
  });

  assert.deepEqual(probes,[100]);
  assert.equal(deliveries.length,1);
  assert.equal(result.checked,7);
  assert.equal(result.eligible,1);
});

test('lineup scheduler ignores coerced fixture IDs and only accepts boolean confirmed snapshots',async()=>{
  const rows=[
    {...row(1,100),fixture_id:true},
    {...row(2,200),fixture_id:'200'},
    {...row(3,300),fixture_id:[300]},
  ];
  const {service,probes,deliveries}=runtime({
    rows,
    snapshots:{
      200:{confirmed:'true'},
      300:{confirmed:true},
    },
  });

  const result=await service.processLineupNotifications({
    botToken:'token',
  });

  assert.deepEqual(probes,[200]);
  assert.equal(deliveries.length,0);
  assert.equal(result.confirmed,0);
});

test('lineup scheduler falls back from malformed fixture cap instead of disabling work',async()=>{
  const rows=[
    row(1,101),
    row(2,102),
    row(3,103),
    row(4,104),
    row(5,105),
  ];
  const {service,probes}=runtime({
    rows,
    snapshots:{
      101:{confirmed:false},
      102:{confirmed:false},
      103:{confirmed:false},
      104:{confirmed:false},
      105:{confirmed:false},
    },
    maxFixturesPerRun:Infinity,
  });

  const result=await service.processLineupNotifications({
    botToken:'token',
  });

  assert.deepEqual(probes,[101,102,103,104]);
  assert.equal(result.fixturesChecked,4);
  assert.equal(result.truncated,true);
});

test('lineup scheduler caps unique fixture probes per cron run',async()=>{
  const rows=[
    row(1,101),
    row(2,102),
    row(3,103),
  ];
  const {service,probes}=runtime({
    rows,
    snapshots:{
      101:{confirmed:false},
      102:{confirmed:false},
      103:{confirmed:false},
    },
    maxFixturesPerRun:2,
  });

  const result=await service.processLineupNotifications({
    botToken:'token',
  });

  assert.deepEqual(probes,[101,102]);
  assert.equal(result.fixturesChecked,2);
  assert.equal(result.truncated,true);
  assert.equal(result.ok,false);
});

test('runtime control failures and malformed control state keep lineup delivery fail-closed',async()=>{
  for (const scenario of [
    {
      loadRuntimeControls:async()=>{
        throw new Error('controls unavailable');
      },
      code:'LINEUP_NOTIFICATION_RUNTIME_CONTROLS_FAILED',
      reason:'runtime_controls_unavailable',
    },
    {
      loadRuntimeControls:async()=>({value:{}}),
      code:'LINEUP_NOTIFICATION_RUNTIME_CONTROLS_INVALID',
      reason:'runtime_controls_invalid',
    },
    {
      loadRuntimeControls:async()=>({
        value:{remindersEnabled:'true'},
      }),
      code:'LINEUP_NOTIFICATION_RUNTIME_CONTROLS_INVALID',
      reason:'runtime_controls_invalid',
    },
  ]) {
    let reads=0;
    const {service,events}=runtime({
      rows:[row(1,100)],
      loadRuntimeControls:scenario.loadRuntimeControls,
      supaSelectPaged:async()=>{
        reads+=1;
        return {rows:[],truncated:false};
      },
    });

    const result=await service.processLineupNotifications({
      botToken:'token',
    });

    assert.equal(result.ok,false);
    assert.equal(result.failed,1);
    assert.equal(result.reason,scenario.reason);
    assert.equal(reads,0);
    assert.equal(events.at(-1)?.code,scenario.code);
  }
});

test('lineup scheduler is disabled only by an explicit false reminder control',async()=>{
  let reads=0;
  const {service}=runtime({
    loadRuntimeControls:async()=>({
      value:{remindersEnabled:false},
    }),
    supaSelectPaged:async()=>{
      reads+=1;
      return {rows:[],truncated:false};
    },
  });

  const result=await service.processLineupNotifications({
    botToken:'token',
  });

  assert.equal(result.disabled,true);
  assert.equal(result.ok,true);
  assert.equal(reads,0);
});

test('lineup scheduler reports invalid clock and storage availability without throwing',async()=>{
  const invalidClock=runtime({
    rows:[row(1,100)],
    now:()=>Number.NaN,
  });
  assert.equal(invalidClock.service.candidateWindow(),null);

  const clockResult=await invalidClock.service
    .processLineupNotifications({botToken:'token'});
  assert.equal(clockResult.ok,false);
  assert.equal(clockResult.reason,'invalid_clock');

  const storage=runtime({
    hasSupabase:()=>{
      throw new Error('storage probe failed');
    },
  });
  const storageResult=await storage.service
    .processLineupNotifications({botToken:'token'});
  assert.equal(storageResult.ok,false);
  assert.equal(
    storageResult.reason,
    'storage_availability_unknown',
  );
});

test('malformed reminder pages are not silently treated as an empty successful run',async()=>{
  for (const page of [
    null,
    {rows:{unexpected:true},truncated:false},
    {rows:[],truncated:'false'},
  ]) {
    const {service,events}=runtime({
      supaSelectPaged:async()=>page,
    });

    const result=await service.processLineupNotifications({
      botToken:'token',
    });

    assert.equal(result.ok,false);
    assert.equal(result.failed,1);
    assert.ok([
      'reminder_read_failed',
      'reminder_read_invalid',
    ].includes(result.reason));
    assert.match(
      events.at(-1)?.code || '',
      /LINEUP_NOTIFICATION_READ_(?:FAILED|INVALID)/,
    );
  }
});

test('recipient filter cannot inject reminder identities outside the source page',async()=>{
  for (const injected of [
    row(999,999),
    row(10,999),
  ]) {
    const rows=[row(10,100)];
    const {service,probes,deliveries}=runtime({
      rows,
      snapshots:{
        100:{confirmed:true},
        999:{confirmed:true},
      },
      filterNotificationRecipients:async()=>({
        rows:[injected],
        blockedByPreference:0,
        blockedByEntitlement:0,
      }),
    });

    const result=await service.processLineupNotifications({
      botToken:'token',
    });

    assert.deepEqual(probes,[]);
    assert.deepEqual(deliveries,[]);
    assert.equal(result.eligible,0);
    assert.equal(result.sent,0);
  }
});

test('malformed audience results fail closed before lineup probes',async()=>{
  for (const audience of [
    null,
    {rows:{unexpected:true}},
  ]) {
    const {service,probes,deliveries,events}=runtime({
      rows:[row(1,100)],
      snapshots:{100:{confirmed:true}},
      filterNotificationRecipients:async()=>audience,
    });

    const result=await service.processLineupNotifications({
      botToken:'token',
    });

    assert.equal(result.ok,false);
    assert.equal(result.reason,'audience_unavailable');
    assert.equal(result.failed,1);
    assert.deepEqual(probes,[]);
    assert.deepEqual(deliveries,[]);
    assert.equal(
      events.at(-1)?.code,
      'LINEUP_NOTIFICATION_AUDIENCE_FAILED',
    );
  }
});

test('sent but unconfirmed lineup delivery is counted as unknown rather than an ordinary failure',async()=>{
  const {service}=runtime({
    rows:[row(1,100)],
    snapshots:{100:{confirmed:true}},
    deliverClaimedReminder:async()=>({
      state:'sent_unconfirmed',
    }),
  });

  const result=await service.processLineupNotifications({
    botToken:'token',
  });

  assert.equal(result.sent,0);
  assert.equal(result.failed,0);
  assert.equal(result.unknown,1);
  assert.equal(result.ok,false);
});

test('lineup scheduler fails soft when recipient filtering is unavailable',async()=>{
  const {service,events}=runtime({
    rows:[row(1,100)],
    filterNotificationRecipients:async()=>{
      throw new Error('preferences unavailable');
    },
  });

  const result=await service.processLineupNotifications({
    botToken:'token',
  });

  assert.equal(result.ok,false);
  assert.equal(result.failed,1);
  assert.equal(result.fixturesChecked,0);
  assert.equal(result.reason,'audience_unavailable');
  assert.equal(
    events.at(-1)?.code,
    'LINEUP_NOTIFICATION_AUDIENCE_FAILED',
  );
});

test('lineup scheduler observability failures do not abort remaining fixture probes',async()=>{
  const {service}=runtime({
    rows:[row(1,100),row(2,200)],
    loadLineupSnapshot:async fixtureId=>{
      if (fixtureId===100) {
        throw new Error('lineup unavailable');
      }
      return {confirmed:true};
    },
    deliverClaimedReminder:async()=>({state:'sent'}),
    recordOpsEvent:async()=>{
      throw new Error('ops unavailable');
    },
  });

  const result=await service.processLineupNotifications({
    botToken:'token',
  });

  assert.equal(result.failed,1);
  assert.equal(result.confirmed,1);
  assert.equal(result.sent,1);
  assert.equal(result.ok,false);
});
