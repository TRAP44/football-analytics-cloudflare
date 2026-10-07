import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportantChangeNotificationService } from '../src/important-change-notification-service.js';

const NOW=Date.parse('2026-10-07T12:00:00.000Z');

function reminder(
  userId,
  fixtureId,
  minutes=60,
  overrides={},
) {
  return {
    telegram_id:userId,
    fixture_id:fixtureId,
    enabled:true,
    home_name:'Home',
    away_name:'Away',
    league_name:'League',
    fixture_date:new Date(
      NOW+minutes*60_000,
    ).toISOString(),
    important_change_notified_at:null,
    ...overrides,
  };
}

function snapshots({
  home=[40,46],
  draw=[30,28],
  away=[30,26],
  latestAt=NOW,
  baselineMinutes=45,
}={}) {
  return [
    {
      at:new Date(latestAt).toISOString(),
      homeProb:home[1],
      drawProb:draw[1],
      awayProb:away[1],
    },
    {
      at:new Date(
        latestAt-baselineMinutes*60_000,
      ).toISOString(),
      homeProb:home[0],
      drawProb:draw[0],
      awayProb:away[0],
    },
  ];
}

function runtime({
  rows=[],
  byFixture={},
  thresholdPp=5,
  maxFixturesPerRun=12,
  hasSupabase=()=>true,
  loadRuntimeControls=async()=>({
    value:{remindersEnabled:true},
  }),
  filterNotificationRecipients,
  supaSelectPaged,
  deliverClaimedReminder,
  recordOpsEvent,
  now=()=>NOW,
}={}) {
  const reads=[];
  const deliveries=[];
  const events=[];

  const service=createImportantChangeNotificationService({
    hasSupabase,
    loadRuntimeControls,
    supaSelectPaged:supaSelectPaged || (async()=>({
      rows,
      truncated:false,
    })),
    getOddsSnapshots:async fixtureId=>{
      reads.push(fixtureId);
      const value=byFixture[fixtureId];
      if (value instanceof Error) throw value;
      return value || [];
    },
    deliverClaimedReminder:
      deliverClaimedReminder
      || (async(row,kind,text)=>{
        deliveries.push({row,kind,text});
        return {state:'sent'};
      }),
    filterNotificationRecipients,
    recordOpsEvent:
      recordOpsEvent
      || (async(_cfg,event)=>events.push(event)),
    thresholdPp,
    maxFixturesPerRun,
    now,
  });

  return {
    service,
    reads,
    deliveries,
    events,
  };
}

test('important-change service validates required dependencies and freezes API',()=>{
  const {service}=runtime();
  assert.equal(Object.isFrozen(service),true);

  for (const key of [
    'hasSupabase',
    'loadRuntimeControls',
    'supaSelectPaged',
    'getOddsSnapshots',
    'deliverClaimedReminder',
    'now',
  ]) {
    const base={
      hasSupabase:()=>true,
      loadRuntimeControls:async()=>({
        value:{remindersEnabled:true},
      }),
      supaSelectPaged:async()=>({
        rows:[],
        truncated:false,
      }),
      getOddsSnapshots:async()=>[],
      deliverClaimedReminder:async()=>({state:'sent'}),
      now:()=>NOW,
    };
    assert.throws(
      ()=>createImportantChangeNotificationService({
        ...base,
        [key]:null,
      }),
      /Important change notifications require/,
      key,
    );
  }
});

test('movement detector requires recent distinct timezone-bearing snapshots and a 5pp move',()=>{
  const {service}=runtime();

  assert.deepEqual(
    service.movementFromSnapshots([],NOW),
    {
      significant:false,
      reason:'insufficient_history',
      sample:0,
    },
  );

  const below=service.movementFromSnapshots(
    snapshots({
      home:[40,44],
      draw:[30,29],
      away:[30,27],
    }),
    NOW,
  );
  assert.equal(below.significant,false);
  assert.equal(below.reason,'evaluated');

  const movement=service.movementFromSnapshots(
    snapshots(),
    NOW,
  );
  assert.equal(movement.significant,true);
  assert.deepEqual(
    movement.strongest,
    {side:'home',delta:6},
  );
});

test('movement detector rejects coercive probabilities, malformed dates and same-time pseudo history',()=>{
  const {service}=runtime();
  const nowIso=new Date(NOW).toISOString();

  for (const homeProb of [
    true,
    '46',
    [46],
    {valueOf(){return 46;}},
  ]) {
    const result=service.movementFromSnapshots([
      {
        at:nowIso,
        homeProb,
        drawProb:28,
        awayProb:26,
      },
      {
        at:new Date(NOW-60_000).toISOString(),
        homeProb:40,
        drawProb:30,
        awayProb:30,
      },
    ],NOW);
    assert.equal(result.significant,false);
  }

  const timezoneLess=service.movementFromSnapshots([
    {
      at:'2026-10-07T12:00:00',
      homeProb:46,
      drawProb:28,
      awayProb:26,
    },
    {
      at:'2026-10-07T11:00:00Z',
      homeProb:40,
      drawProb:30,
      awayProb:30,
    },
  ],NOW);
  assert.equal(timezoneLess.significant,false);
  assert.equal(timezoneLess.sample,1);

  const sameTime=service.movementFromSnapshots([
    {
      at:nowIso,
      homeProb:46,
      drawProb:28,
      awayProb:26,
    },
    {
      at:nowIso,
      homeProb:40,
      drawProb:30,
      awayProb:30,
    },
  ],NOW);
  assert.deepEqual(sameTime,{
    significant:false,
    reason:'insufficient_history',
    sample:1,
  });
});

test('movement detector rejects stale/future signals and compares cumulative recent movement',()=>{
  const {service}=runtime();

  const stale=service.movementFromSnapshots(
    snapshots({
      latestAt:NOW-181*60_000,
    }),
    NOW,
  );
  assert.equal(stale.significant,false);
  assert.equal(stale.reason,'stale_signal');

  const future=service.movementFromSnapshots(
    snapshots({
      latestAt:NOW+6*60_000,
    }),
    NOW,
  );
  assert.equal(future.significant,false);
  assert.equal(future.reason,'stale_signal');

  const cumulative=service.movementFromSnapshots([
    {
      at:new Date(NOW).toISOString(),
      homeProb:46,
      drawProb:28,
      awayProb:26,
    },
    {
      at:new Date(NOW-30*60_000).toISOString(),
      homeProb:43,
      drawProb:29,
      awayProb:28,
    },
    {
      at:new Date(NOW-120*60_000).toISOString(),
      homeProb:40,
      drawProb:30,
      awayProb:30,
    },
  ],NOW);
  assert.equal(cumulative.significant,true);
  assert.deepEqual(
    cumulative.strongest,
    {side:'home',delta:6},
  );

  const ancientBaseline=service.movementFromSnapshots([
    {
      at:new Date(NOW).toISOString(),
      homeProb:46,
      drawProb:28,
      awayProb:26,
    },
    {
      at:new Date(NOW-181*60_000).toISOString(),
      homeProb:40,
      drawProb:30,
      awayProb:30,
    },
  ],NOW);
  assert.equal(ancientBaseline.significant,false);
  assert.equal(
    ancientBaseline.reason,
    'insufficient_recent_history',
  );
});

test('threshold, fixture cap and candidate clock reject malformed/coercive configuration',async()=>{
  const rows=[
    reminder(1,100),
    reminder(2,200),
    reminder(3,300),
  ];
  const {service,reads}=runtime({
    rows,
    byFixture:{
      100:snapshots(),
      200:snapshots(),
      300:snapshots(),
    },
    maxFixturesPerRun:'1',
    thresholdPp:'1',
  });

  const result=await service.processImportantChangeNotifications({
    botToken:'token',
  });
  assert.equal(result.fixturesChecked,3);
  assert.deepEqual(reads,[100,200,300]);

  const invalidClock=runtime({
    rows,
    now:()=>Number.NaN,
  });
  assert.equal(
    invalidClock.service.candidateWindow(),
    null,
  );
  const failed=await invalidClock.service
    .processImportantChangeNotifications({botToken:'token'});
  assert.equal(failed.ok,false);
  assert.equal(failed.reason,'invalid_clock');
});

test('scheduler reads stored odds once per fixture and fans out through atomic claims',async()=>{
  const rows=[
    reminder(1,100),
    reminder(2,100),
    reminder(3,200),
  ];
  const {service,reads,deliveries}=runtime({
    rows,
    byFixture:{
      100:snapshots(),
      200:snapshots({
        home:[40,42],
        draw:[30,30],
        away:[30,28],
      }),
    },
  });

  const result=await service
    .processImportantChangeNotifications({botToken:'token'});

  assert.deepEqual(reads,[100,200]);
  assert.equal(deliveries.length,2);
  assert.ok(
    deliveries.every(
      item=>item.kind==='important_change',
    ),
  );
  assert.ok(
    deliveries.every(
      item=>item.text.includes(
        'Важное изменение перед матчем',
      ),
    ),
  );
  assert.equal(result.significant,1);
  assert.equal(result.sent,2);
});

test('recipient authorization is per user and is expanded back to all of that users reminder fixtures',async()=>{
  const rows=[
    reminder(10,100),
    reminder(10,200),
    reminder(20,300),
  ];
  const {service,reads,deliveries}=runtime({
    rows,
    byFixture:{
      100:snapshots(),
      200:snapshots(),
      300:snapshots(),
    },
    filterNotificationRecipients:async sourceRows=>({
      rows:[
        sourceRows.find(
          row=>row.telegram_id===10,
        ),
      ],
      blockedByPreference:1,
      blockedByEntitlement:0,
    }),
  });

  const result=await service
    .processImportantChangeNotifications({botToken:'token'});

  assert.deepEqual(reads,[100,200]);
  assert.deepEqual(
    deliveries.map(item=>item.row.fixture_id),
    [100,200],
  );
  assert.equal(result.eligible,2);
  assert.equal(result.blockedByPreference,1);
});

test('recipient filter cannot inject identities outside the source reminder page',async()=>{
  for (const injected of [
    reminder(999,999),
    reminder(10,999),
  ]) {
    const rows=[reminder(10,100)];
    const {service,reads,deliveries}=runtime({
      rows,
      byFixture:{
        100:snapshots(),
        999:snapshots(),
      },
      filterNotificationRecipients:async()=>({
        rows:[injected],
        blockedByPreference:0,
        blockedByEntitlement:0,
      }),
    });

    const result=await service
      .processImportantChangeNotifications({
        botToken:'token',
      });

    assert.deepEqual(reads,[]);
    assert.deepEqual(deliveries,[]);
    assert.equal(result.eligible,0);
    assert.equal(result.sent,0);
  }
});

test('scheduler locally validates enabled, notification and kickoff evidence returned by storage',async()=>{
  const rows=[
    reminder(1,100),
    reminder(2,200,60,{enabled:false}),
    reminder(3,300,60,{
      important_change_notified_at:
        '2026-10-07T10:00:00Z',
    }),
    reminder(4,400,60,{
      fixture_date:'2026-10-07T13:00:00',
    }),
    reminder(5,500,240),
    reminder(6,600,-5),
    {
      ...reminder(7,700),
      fixture_id:true,
    },
  ];
  const {service,reads}=runtime({
    rows,
    byFixture:{100:snapshots()},
  });

  const result=await service
    .processImportantChangeNotifications({botToken:'token'});

  assert.deepEqual(reads,[100]);
  assert.equal(result.checked,rows.length);
  assert.equal(result.eligible,1);
  assert.equal(result.sent,1);
});

test('malformed reminder page and malformed audience fail closed',async()=>{
  const malformedPage=runtime({
    supaSelectPaged:async()=>({
      rows:{0:reminder(1,100),length:1},
      truncated:false,
    }),
  });
  const pageResult=await malformedPage.service
    .processImportantChangeNotifications({botToken:'token'});
  assert.equal(pageResult.ok,false);
  assert.equal(pageResult.reason,'reminder_read_invalid');
  assert.equal(
    malformedPage.events.at(-1)?.code,
    'IMPORTANT_CHANGE_NOTIFICATION_READ_INVALID',
  );

  const malformedAudience=runtime({
    rows:[reminder(1,100)],
    filterNotificationRecipients:async()=>({
      rows:{0:reminder(1,100),length:1},
    }),
  });
  const audienceResult=await malformedAudience.service
    .processImportantChangeNotifications({botToken:'token'});
  assert.equal(audienceResult.ok,false);
  assert.equal(
    audienceResult.reason,
    'audience_unavailable',
  );
  assert.equal(
    malformedAudience.events.at(-1)?.code,
    'IMPORTANT_CHANGE_NOTIFICATION_AUDIENCE_FAILED',
  );
});

test('scheduler fails closed for unavailable or malformed runtime controls',async()=>{
  const unavailable=runtime({
    rows:[reminder(1,100)],
    loadRuntimeControls:async()=>{
      throw new Error('controls unavailable');
    },
  });
  const failed=await unavailable.service
    .processImportantChangeNotifications({botToken:'token'});
  assert.equal(failed.ok,false);
  assert.equal(
    failed.reason,
    'runtime_controls_unavailable',
  );
  assert.equal(
    unavailable.events.at(-1)?.code,
    'IMPORTANT_CHANGE_NOTIFICATION_RUNTIME_CONTROLS_FAILED',
  );

  for (const value of [
    {},
    {value:{}},
    {value:{remindersEnabled:'true'}},
  ]) {
    const malformed=runtime({
      rows:[reminder(1,100)],
      loadRuntimeControls:async()=>value,
    });
    const result=await malformed.service
      .processImportantChangeNotifications({
        botToken:'token',
      });
    assert.equal(result.ok,false);
    assert.equal(
      result.reason,
      'runtime_controls_invalid',
    );
    assert.deepEqual(malformed.reads,[]);
  }
});

test('storage availability and bot token boundaries do not throw or start work',async()=>{
  const unavailable=runtime({
    rows:[reminder(1,100)],
    hasSupabase:()=>{
      throw new Error('storage probe failed');
    },
  });
  const result=await unavailable.service
    .processImportantChangeNotifications({botToken:'token'});
  assert.equal(result.ok,false);
  assert.equal(
    result.reason,
    'storage_availability_unknown',
  );
  assert.deepEqual(unavailable.reads,[]);

  const hostileCfg={};
  Object.defineProperty(hostileCfg,'botToken',{
    get(){throw new Error('hostile token getter');},
  });
  const safe=runtime({rows:[reminder(1,100)]});
  await assert.doesNotReject(
    ()=>safe.service
      .processImportantChangeNotifications(hostileCfg),
  );
  assert.deepEqual(safe.reads,[]);
});

test('odds snapshot failures are isolated per fixture and hostile error getters stay inside boundary',async()=>{
  const hostileError={};
  Object.defineProperty(hostileError,'message',{
    get(){throw new Error('hostile message getter');},
  });
  const rows=[
    reminder(1,100),
    reminder(2,200),
  ];
  const {service,reads,events}=runtime({
    rows,
    byFixture:{
      100:hostileError,
      200:snapshots(),
    },
    getOddsSnapshots:undefined,
  });

  // Replace first fixture reader behavior through a dedicated runtime.
  const reads2=[];
  const h=runtime({
    rows,
    byFixture:{200:snapshots()},
  });
  h.service;
  const custom=createImportantChangeNotificationService({
    hasSupabase:()=>true,
    loadRuntimeControls:async()=>({
      value:{remindersEnabled:true},
    }),
    supaSelectPaged:async()=>({
      rows,
      truncated:false,
    }),
    getOddsSnapshots:async fixtureId=>{
      reads2.push(fixtureId);
      if (fixtureId===100) throw hostileError;
      return snapshots();
    },
    deliverClaimedReminder:async()=>({state:'sent'}),
    recordOpsEvent:async(_cfg,event)=>events.push(event),
    now:()=>NOW,
  });

  const result=await custom
    .processImportantChangeNotifications({botToken:'token'});

  assert.deepEqual(reads2,[100,200]);
  assert.equal(result.failed,1);
  assert.equal(result.significant,1);
  assert.equal(result.sent,1);
  assert.ok(
    events.some(
      event=>
        event.code
          ==='IMPORTANT_CHANGE_NOTIFICATION_ODDS_READ_FAILED'
        && event.meta?.fixtureId===100,
    ),
  );
  assert.deepEqual(reads,[]);
});

test('delivery outcomes preserve atomic claim ambiguity instead of treating it as success',async()=>{
  const states=[
    ['sent',1,0,0,0],
    ['already_claimed',0,0,0,1],
    ['unknown',0,0,1,0],
    ['sent_unconfirmed',0,0,1,0],
    ['failed',0,1,0,0],
  ];

  for (const [
    state,
    sent,
    failed,
    unknown,
    claimed,
  ] of states) {
    const h=runtime({
      rows:[reminder(1,100)],
      byFixture:{100:snapshots()},
      deliverClaimedReminder:async()=>({state}),
    });
    const result=await h.service
      .processImportantChangeNotifications({
        botToken:'token',
      });
    assert.equal(result.sent,sent,state);
    assert.equal(result.failed,failed,state);
    assert.equal(result.unknown,unknown,state);
    assert.equal(result.claimed,claimed,state);
  }
});

test('message is informational, bounded and does not coerce hostile display fields',()=>{
  const {service}=runtime();
  const movement=service.movementFromSnapshots(
    snapshots(),
    NOW,
  );
  const hostile={league_name:'League'};
  Object.defineProperty(hostile,'home_name',{
    get(){throw new Error('hostile home getter');},
  });
  Object.defineProperty(hostile,'away_name',{
    get(){throw new Error('hostile away getter');},
  });

  assert.doesNotThrow(
    ()=>service.changeMessage(hostile,movement),
  );
  const text=service.changeMessage(
    reminder(1,100),
    movement,
  );
  assert.match(text,/Home/);
  assert.match(text,/\+6\.0 п\.п\./);
  assert.match(text,/не гарантия результата/i);

  const coerciveMovement={
    strongest:{
      side:'home',
      delta:{
        valueOf(){throw new Error('must not coerce');},
      },
    },
    sample:'2',
  };
  assert.doesNotThrow(
    ()=>service.changeMessage(
      reminder(1,100),
      coerciveMovement,
    ),
  );
});
