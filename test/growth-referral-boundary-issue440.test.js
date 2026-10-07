import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createGrowthReferralRuntime } from '../src/growth-referral.js';
import { createTelegramCampaignRuntime } from '../src/telegram-campaign-runtime.js';
import {
  normalizeReferralCode,
  opaqueReferralCode,
  referralAttributionDecision,
  splitLaunchReferralParts,
} from '../src/referral-attribution.js';

function runtime(overrides={}) {
  const memory={
    users:new Map(),
    growthEventKeys:new Set(),
    referralCodeOwners:new Map(),
    referralAttributions:new Map(),
  };
  let nowMs=Date.parse('2026-10-04T12:00:00.000Z');
  const deleted=[];
  const upserts=[];
  const patches=[];
  const metadataSeen=[];

  const api=createGrowthReferralRuntime({
    memory,
    getUserRecord:
      overrides.getUserRecord
      || (async id=>memory.users.get(Number(id)) || null),
    hasSupabase:overrides.hasSupabase || (()=>false),
    supaPatch:
      overrides.supaPatch
      || (async (...args)=>{patches.push(args);}),
    supaUpsert:
      overrides.supaUpsert
      || (async (...args)=>{upserts.push(args);}),
    supaSelectOne:
      overrides.supaSelectOne
      || (async()=>null),
    supaDelete:
      overrides.supaDelete
      || (async (_cfg,table,filters)=>{
        deleted.push({table,filters});
      }),
    safeOpsMetadata:
      overrides.safeOpsMetadata
      || (value=>{
        metadataSeen.push(value);
        return value && typeof value==='object' && !Array.isArray(value)
          ? value
          : {};
      }),
    redactOpsString:
      overrides.redactOpsString
      || (value=>typeof value==='string' ? value.slice(0,180) : ''),
    normalizeReferralCode:
      overrides.normalizeReferralCode
      || normalizeReferralCode,
    opaqueReferralCode:
      overrides.opaqueReferralCode
      || opaqueReferralCode,
    referralAttributionDecision:
      overrides.referralAttributionDecision
      || referralAttributionDecision,
    splitLaunchReferralParts:
      overrides.splitLaunchReferralParts
      || splitLaunchReferralParts,
    clock:overrides.clock || (()=>nowMs),
  });

  return {
    api,
    memory,
    deleted,
    upserts,
    patches,
    metadataSeen,
    setNow(value){nowMs=value;},
  };
}

test('Issue #440 runtime validates dependencies and exposes frozen API',()=>{
  const h=runtime();
  assert.equal(Object.isFrozen(h.api),true);

  assert.throws(
    ()=>createGrowthReferralRuntime({}),
    /requires memory state/,
  );

  const brokenMemory={
    users:new Map(),
  };
  assert.throws(
    ()=>createGrowthReferralRuntime({
      memory:brokenMemory,
      getUserRecord:async()=>null,
      hasSupabase:()=>false,
      supaPatch:async()=>{},
      supaUpsert:async()=>{},
      supaSelectOne:async()=>null,
      supaDelete:async()=>{},
      safeOpsMetadata:value=>value,
      redactOpsString:value=>value,
      normalizeReferralCode,
      opaqueReferralCode,
      referralAttributionDecision,
      splitLaunchReferralParts,
      clock:null,
    }),
    /requires clock/,
  );
});

test('launch parser preserves fixture attribution and rejects coercive payloads',()=>{
  const {api}=runtime();
  const code='a1b2c3d4e5f60708';
  const parsed=api.parseLaunchStartParam(
    `fx123__social__match_share__miniapp__r${code}`,
  );

  assert.deepEqual(parsed,{
    fixtureId:123,
    action:'fixture',
    source:'social',
    campaign:'match_share',
    content:'miniapp',
    startParam:`fx123__social__match_share__miniapp__r${code}`,
    referralCode:code,
  });

  assert.deepEqual(
    api.parseLaunchStartParam({
      toString(){throw new Error('must not stringify');},
    }),
    {
      source:'telegram',
      campaign:'direct',
      content:'',
      startParam:'',
      referralCode:'',
    },
  );
  assert.equal(api.cleanLaunchPart(true,20),'');
});

test('memory first-touch attribution is immutable and timestamped from injected clock',async()=>{
  const {api,memory,setNow}=runtime();

  const first=await api.ensureLaunchAttribution(
    42,
    'media_social_launch_card',
    {},
  );
  assert.equal(first.source,'social');
  assert.equal(first.campaign,'launch');
  assert.equal(first.content,'card');
  assert.equal(first.firstTouchAt,'2026-10-04T12:00:00.000Z');

  setNow(Date.parse('2026-10-05T12:00:00.000Z'));
  const second=await api.ensureLaunchAttribution(
    42,
    'partner_partner_later_other',
    {},
  );
  assert.deepEqual(second,first);
  assert.equal(
    memory.users.get(42).acquisition_first_touch_at,
    first.firstTouchAt,
  );
});

test('Supabase first-touch attribution is not claimed unless persistence is confirmed',async()=>{
  const unconfirmed=runtime({
    hasSupabase:()=>true,
    getUserRecord:async()=>null,
    supaPatch:async()=>{},
  });
  const result=await unconfirmed.api.ensureLaunchAttribution(
    42,
    'media_social_launch_card',
    {},
  );
  assert.equal(result.source,'social');
  assert.equal(result.firstTouchAt,null);

  const confirmedRow={
    telegram_id:42,
    acquisition_source:'social',
    acquisition_campaign:'launch',
    acquisition_content:'card',
    acquisition_start_param:'media_social_launch_card',
    acquisition_first_touch_at:'2026-10-04T12:00:00.000Z',
  };
  let reads=0;
  const confirmed=runtime({
    hasSupabase:()=>true,
    getUserRecord:async()=>{
      reads+=1;
      return reads===1 ? null : confirmedRow;
    },
    supaPatch:async()=>{},
  });
  assert.deepEqual(
    await confirmed.api.ensureLaunchAttribution(
      42,
      'media_social_launch_card',
      {},
    ),
    {
      source:'social',
      campaign:'launch',
      content:'card',
      startParam:'media_social_launch_card',
      firstTouchAt:'2026-10-04T12:00:00.000Z',
    },
  );
});

test('invalid clock and hostile user rows cannot invent first-touch evidence',async()=>{
  const hostile={};
  Object.defineProperty(hostile,'acquisition_first_touch_at',{
    get(){throw new Error('hostile timestamp getter');},
  });

  const {api}=runtime({
    getUserRecord:async()=>hostile,
    clock:()=>NaN,
  });

  assert.doesNotThrow(()=>api.acquisitionFromUser(hostile));
  const result=await api.ensureLaunchAttribution(
    42,
    'media_social_launch_card',
    {},
  );
  assert.equal(result.firstTouchAt,null);
});

test('growth events enforce database event-name and dedupe-key contracts in memory',async()=>{
  const {api,memory}=runtime();

  assert.equal(await api.recordGrowthEvent({},{
    userId:true,
    eventName:'share_created',
    eventKey:'share_created:true:1',
  }),false);

  assert.equal(await api.recordGrowthEvent({},{
    userId:7,
    eventName:'a-b',
    eventKey:'a-b:7',
  }),false);

  assert.equal(await api.recordGrowthEvent({},{
    userId:7,
    eventName:'x',
    eventKey:'x:7',
  }),false);

  assert.equal(await api.recordGrowthEvent({},{
    userId:7,
    eventName:'share_created',
    eventKey:'unsafe/key',
  }),false);

  assert.equal(await api.recordGrowthEvent({},{
    userId:7,
    eventName:'share_created',
    eventKey:'share_created:7:1',
    metadata:{fixtureId:123},
  }),true);
  assert.equal(await api.recordGrowthEvent({},{
    userId:7,
    eventName:'share_created',
    eventKey:'share_created:7:1',
    metadata:{fixtureId:999},
  }),true);

  assert.deepEqual(
    [...memory.growthEventKeys],
    ['share_created:7:1'],
  );
});

test('waitUntil registration and metadata sanitizer failures never suppress the awaited event write',async()=>{
  const {api,memory}=runtime({
    safeOpsMetadata:()=>{
      throw new Error('metadata sanitizer unavailable');
    },
  });

  const ok=await api.recordGrowthEvent({
    waitUntil(){
      throw new Error('bad waitUntil hook');
    },
  },{
    userId:7,
    eventName:'share_created',
    eventKey:'share_created:7:2',
    metadata:{unsafe:true},
  });

  assert.equal(ok,true);
  assert.equal(
    memory.growthEventKeys.has('share_created:7:2'),
    true,
  );
});

test('Supabase dedupe conflict succeeds only when the existing row has the same owner and event',async()=>{
  const wrong=runtime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{
      throw new Error('duplicate key');
    },
    supaSelectOne:async()=>({
      telegram_id:999,
      event_name:'share_created',
      event_key:'share_created:7:1',
    }),
  });
  assert.equal(await wrong.api.recordGrowthEvent({},{
    userId:7,
    eventName:'share_created',
    eventKey:'share_created:7:1',
  }),false);

  const matching=runtime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{
      throw new Error('duplicate key');
    },
    supaSelectOne:async()=>({
      telegram_id:7,
      event_name:'share_created',
      event_key:'share_created:7:1',
    }),
  });
  assert.equal(await matching.api.recordGrowthEvent({},{
    userId:7,
    eventName:'share_created',
    eventKey:'share_created:7:1',
  }),true);
});

test('unknown Supabase availability fails closed instead of silently switching to memory',async()=>{
  const {api,memory}=runtime({
    hasSupabase:()=>{
      throw new Error('configuration getter failed');
    },
  });

  assert.equal(await api.recordGrowthEvent({},{
    userId:7,
    eventName:'share_created',
    eventKey:'share_created:7:1',
  }),false);
  assert.equal(memory.growthEventKeys.size,0);

  assert.equal(
    await api.ensureReferralCode(7,{botToken:'test-bot-secret'}),
    '',
  );
  assert.deepEqual(
    await api.cleanupGrowthEvents({}),
    {ok:false,error:'Supabase availability is unknown.'},
  );
});

test('memory referral code ownership cannot be overwritten by a deterministic collision',async()=>{
  const code='a1b2c3d4e5f60708';
  const {api}=runtime({
    opaqueReferralCode:async()=>code,
  });

  assert.equal(
    await api.ensureReferralCode(100,{botToken:'secret'}),
    code,
  );
  assert.equal(
    await api.ensureReferralCode(200,{botToken:'secret'}),
    '',
  );
  assert.equal(await api.lookupReferralCodeOwner(code,{}),100);
});

test('referral lifecycle blocks duplicates and records referred payment idempotently',async()=>{
  const {api,memory}=runtime();
  const cfg={botToken:'test-bot-secret'};

  const code=await api.ensureReferralCode(100,cfg);
  assert.match(code,/^[a-f0-9]{16}$/);
  assert.equal(await api.lookupReferralCodeOwner(code,cfg),100);

  const accepted=await api.applyReferralAttribution(200,{
    referralCode:code,
    source:'social',
    campaign:'match_share',
    content:'share',
    fixtureId:55,
  },cfg);
  assert.deepEqual(accepted,{
    accepted:true,
    status:'accepted',
    referralCode:code,
  });

  const duplicate=await api.applyReferralAttribution(
    200,
    {referralCode:code},
    cfg,
  );
  assert.equal(duplicate.accepted,false);
  assert.equal(duplicate.status,'duplicate_attribution');

  assert.equal(await api.recordReferredPayment(200,{
    telegram_payment_charge_id:'charge-1',
    total_amount:199,
    is_recurring:false,
  },'PRO',cfg),true);

  assert.equal(
    memory.growthEventKeys.has('referred_payment:charge-1'),
    true,
  );
});

test('Supabase referral evidence requires matching user, event key and referral metadata',async()=>{
  const code='a1b2c3d4e5f60708';
  const missingMetadata=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async(_cfg,_table,filters)=>{
      if (filters.event_key===`eq.referral_code:${code}`) {
        return {
          telegram_id:100,
          event_name:'referral_code_created',
          event_key:`referral_code:${code}`,
          metadata:{referral_code:'1111111111111111'},
        };
      }
      return {
        telegram_id:200,
        event_name:'referred_first_open',
        event_key:'referral_attribution:999',
        metadata:{referral_code:code},
        created_at:'2026-10-05T12:00:00.000Z',
      };
    },
  });

  assert.equal(
    await missingMetadata.api.lookupReferralCodeOwner(code,{}),
    0,
  );
  assert.equal(
    await missingMetadata.api.referralAttributionForUser(200,{}),
    null,
  );
});

test('failed referral persistence is reported separately from duplicate attribution',async()=>{
  const code='a1b2c3d4e5f60708';
  const {api}=runtime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{
      throw new Error('database unavailable');
    },
    supaSelectOne:async(_cfg,_table,filters)=>{
      if (filters.event_key===`eq.referral_code:${code}`) {
        return {
          telegram_id:100,
          event_name:'referral_code_created',
          event_key:`referral_code:${code}`,
          metadata:{referral_code:code},
        };
      }
      return null;
    },
  });

  assert.deepEqual(
    await api.applyReferralAttribution(200,{
      referralCode:code,
      source:'social',
    },{}),
    {accepted:false,status:'persistence_failed'},
  );
});

test('referred payment hashes opaque charge ids without coercion or truncation collisions',async()=>{
  const captured=[];
  const {api,memory}=runtime({
    safeOpsMetadata:value=>{
      captured.push(value);
      return value;
    },
  });
  memory.referralAttributions.set(
    200,
    'a1b2c3d4e5f60708',
  );

  const charge='opaque/charge+with=symbols';
  assert.equal(await api.recordReferredPayment(200,{
    telegram_payment_charge_id:charge,
    total_amount:199,
    is_recurring:'false',
  },'PRO',{}),true);

  const keys=[...memory.growthEventKeys]
    .filter(key=>key.startsWith('referred_payment:'));
  assert.equal(keys.length,1);
  assert.match(keys[0],/^referred_payment:h[a-f0-9]{40}$/);
  assert.equal(captured.at(-1).recurring,false);

  assert.equal(await api.recordReferredPayment(200,{
    telegram_payment_charge_id:{
      toString(){throw new Error('must not stringify charge');},
    },
    total_amount:199,
  },'PRO',{}),false);

  assert.equal(await api.recordReferredPayment(200,{
    telegram_payment_charge_id:'x'.repeat(513),
    total_amount:199,
  },'PRO',{}),false);

  assert.equal(await api.recordReferredPayment(200,{
    telegram_payment_charge_id:'charge-zero',
    total_amount:0,
  },'PRO',{}),false);
});

test('growth retention cleanup is bounded and rejects invalid clock evidence',async()=>{
  const {api,deleted}=runtime({
    hasSupabase:()=>true,
  });

  const result=await api.cleanupGrowthEvents({
    growthRetentionDays:90,
  });
  assert.equal(result.ok,true);
  assert.equal(result.retentionDays,90);
  assert.equal(deleted.length,1);
  assert.equal(deleted[0].table,'growth_events');
  assert.match(deleted[0].filters.created_at,/^lt\.2026-/);

  const tooSmall=await api.cleanupGrowthEvents({
    growthRetentionDays:1,
  });
  assert.equal(tooSmall.retentionDays,7);

  const invalid=runtime({
    hasSupabase:()=>true,
    clock:()=>({valueOf(){return Date.now();}}),
  });
  assert.equal(
    (await invalid.api.cleanupGrowthEvents({})).ok,
    false,
  );
});

test('related media campaign aggregation keeps content scoped and deterministic',()=>{
  const campaign=createTelegramCampaignRuntime({
    cleanLaunchPart:value=>
      typeof value==='string'
        ? value.toLowerCase().replace(/[^a-z0-9_-]/g,'')
        : '',
  });

  const result=campaign.buildMediaCampaignPerformance([
    {
      telegram_id:1,
      event_name:'bot_start',
      source:'press',
      campaign:'launch',
      content:'post1',
    },
  ]);
  assert.equal(result.length,1);
  assert.equal(result[0].content,'post1');
  assert.equal(result[0].entries,1);
});

test('worker composition root wires extracted growth/referral domain',()=>{
  const worker=fs.readFileSync(
    new URL('../src/worker.js',import.meta.url),
    'utf8',
  );
  const growth=fs.readFileSync(
    new URL('../src/growth-referral.js',import.meta.url),
    'utf8',
  );

  assert.match(
    worker,
    /import \{ createGrowthReferralRuntime \} from '\.\/growth-referral\.js';/,
  );
  assert.match(worker,/createAuthGrowthWiringRuntime\(\{/);
  assert.match(
    growth,
    /export function createGrowthReferralRuntime/,
  );
  assert.doesNotMatch(worker,/^function parseLaunchStartParam\(/m);
  assert.doesNotMatch(worker,/^async function recordGrowthEvent\(/m);
  assert.doesNotMatch(worker,/^async function applyReferralAttribution\(/m);
});
