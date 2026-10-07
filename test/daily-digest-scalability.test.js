import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_DIGEST_POLICY,
  assessDailyDigestRun,
  classifyDigestTransportError,
  createDigestRateGate,
  estimateDigestOrchestration,
  isDailyDigestExecutionWindow,
  planDailyDigestRecipients,
  runBoundedDailyDigest,
} from '../src/daily-digest-delivery.js';
import { createTelegramDigestRuntime } from '../src/telegram-digest-runtime.js';

const DATE = '2026-09-29';

function rows(count) {
  return Array.from({ length: count }, (_, index) => ({
    telegram_id: index + 1,
    chat_id: 10000 + index,
    enabled: true,
    hour_utc: 7,
    last_sent_date: null,
    delivery_claim_date: null,
  }));
}

function virtualClock() {
  let value = 0;
  return {
    now: () => value,
    sleep: async ms => { value += Math.max(0, Number(ms || 0)); },
    value: () => value,
  };
}

function statefulDelivery(seed, { nowMs = Date.parse(`${DATE}T07:05:00.000Z`) } = {}) {
  const state = new Map(seed.map(row => [row.telegram_id, { ...row }]));
  const sent = [];
  const news = [];
  return {
    state,
    sent,
    news,
    snapshot: () => [...state.values()].sort((a, b) => a.telegram_id - b.telegram_id),
    claim: async (row, date) => {
      const current = state.get(row.telegram_id);
      if (!current || current.last_sent_date === date) return false;
      const lockedUntil = Date.parse(String(current.delivery_locked_until || ''));
      const active = current.delivery_claim_date === date && Number.isFinite(lockedUntil) && lockedUntil > nowMs;
      if (active) return false;
      current.delivery_claim_date = date;
      current.delivery_claimed_at = new Date(nowMs).toISOString();
      current.delivery_locked_until = new Date(nowMs + DAILY_DIGEST_POLICY.claimLeaseSeconds * 1000).toISOString();
      return true;
    },
    arm: async (row, date) => {
      const current = state.get(row.telegram_id);
      if (!current || current.delivery_claim_date !== date || current.last_sent_date === date) return false;
      current.delivery_locked_until = `${date}T23:59:59.999Z`;
      return true;
    },
    release: async (row, date) => {
      const current = state.get(row.telegram_id);
      if (!current || current.delivery_claim_date !== date || current.last_sent_date === date) return false;
      current.delivery_claim_date = null;
      current.delivery_claimed_at = null;
      current.delivery_locked_until = null;
      return true;
    },
    complete: async (row, date) => {
      const current = state.get(row.telegram_id);
      current.last_sent_date = date;
      current.delivery_claim_date = null;
      current.delivery_claimed_at = null;
      current.delivery_locked_until = null;
      return true;
    },
    sendDigest: async row => { sent.push(row.telegram_id); },
    sendNews: async row => { news.push(row.telegram_id); },
  };
}

function options(plan, delivery, overrides = {}) {
  const clock = overrides.clock || virtualClock();
  return {
    plan,
    date: DATE,
    claim: delivery.claim,
    arm: delivery.arm,
    release: delivery.release,
    complete: delivery.complete,
    sendDigest: delivery.sendDigest,
    sendNews: delivery.sendNews,
    now: clock.now,
    sleep: clock.sleep,
    minSendIntervalMs: 1,
    concurrency: 4,
    executionBudgetMs: 60000,
    ...overrides,
    clock: undefined,
  };
}

function telegramDigestHarness(overrides = {}) {
  const ops=[];
  const telegram=[];
  const memory={botDigestSubscriptions:new Map()};
  memory.botDigestSubscriptions.set(1,{
    telegram_id:1,
    chat_id:10001,
    enabled:true,
    hour_utc:7,
    last_sent_date:null,
    delivery_claim_date:null,
  });

  const deps={
    DAILY_DIGEST_POLICY,
    SMART_NOTIFICATION_POLICY:{},
    apiFootball:async()=>[],
    assessDailyDigestRun,
    botMatchButtonText:()=>'', 
    bumpTelemetry:()=>{},
    currentMorningFootballNews:async()=>({items:[],degraded:false}),
    filterSmartNotificationRecipients:async()=>({rows:[]}),
    footballBotKeyboard:()=>({}),
    freeQuotaHealthy:()=>true,
    getAnalysisTimelineSnapshots:async()=>[],
    getCache:async()=>null,
    getFavorites:async()=>[],
    getStaleCache:async()=>null,
    hasSupabase:()=>false,
    isFootballRateLimitError:error=>error?.code==='FOOTBALL_RATE_LIMIT',
    isLiveStatus:()=>false,
    isYouthReserveMatch:()=>false,
    loadProviderFixturesForDate:async()=>[],
    markTelegramWebhookMutation:()=>{},
    matchInterestScore:()=>50,
    memory,
    morningNewsText:()=>'', 
    newsConversionKeyboard:()=>null,
    normalizeBotFixtureCard:value=>value,
    normalizeCompetition:()=>({priority:45}),
    planDailyDigestRecipients,
    radarStrongSignalState:()=>null,
    recordOpsEvent:async(_cfg,event)=>{ops.push(event); return event;},
    rememberBotFixtureCards:async()=>{},
    runBoundedDailyDigest,
    setCache:async()=>{},
    sleepMs:async()=>{},
    supaPatch:async()=>{},
    supaRpc:async()=>false,
    supaSelectOne:async()=>null,
    supaSelectPaged:async()=>({rows:[],truncated:false}),
    supaUpsert:async()=>{},
    telegramApi:async(_method,_cfg,payload)=>{
      telegram.push(payload);
      return {ok:true,status:200};
    },
    telegramHtmlEscape:value=>String(value ?? ''),
    todayUtc:()=>DATE,
    ...overrides,
  };

  const runtime=createTelegramDigestRuntime(deps);
  return {runtime,ops,telegram,memory:deps.memory};
}

test('A. small run processes every subscriber and keeps one main delivery per subscriber/date', async () => {
  const source = rows(8);
  const delivery = statefulDelivery(source);
  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 100 });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(result.eligible, 8);
  assert.equal(result.claimed, 8);
  assert.equal(result.sent, 8);
  assert.equal(result.failed, 0);
  assert.equal(result.remaining, 0);
  assert.deepEqual(delivery.sent, [1,2,3,4,5,6,7,8]);
  assert.equal(new Set(delivery.sent).size, 8);
});

test('B. multi-page plan processes all rows when the execution budget permits it', async () => {
  const source = rows(1200);
  const delivery = statefulDelivery(source);
  const plan = planDailyDigestRecipients(source, { date: DATE, pageSize: 500, maxRecipients: 2000 });
  const result = await runBoundedDailyDigest(options(plan, delivery, { maxRecipients: 2000, concurrency: 4 }));

  assert.equal(plan.pages, 3);
  assert.equal(result.sent, 1200);
  assert.equal(result.remaining, 0);
});

test('C. bounded execution stops at the configured recipient cap and reports deferred backlog', async () => {
  const source = rows(5);
  const delivery = statefulDelivery(source);
  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 2 });
  const result = await runBoundedDailyDigest(options(plan, delivery, { maxRecipients: 2 }));

  assert.equal(result.sent, 2);
  assert.equal(result.deferred, 3);
  assert.equal(result.remaining, 3);
  assert.equal(result.backlog, 3);
});

test('D/E. continuation advances through persistent completion state without starving later subscribers', async () => {
  const delivery = statefulDelivery(rows(7));

  for (let invocation = 0; invocation < 4; invocation += 1) {
    const plan = planDailyDigestRecipients(delivery.snapshot(), { date: DATE, maxRecipients: 2 });
    await runBoundedDailyDigest(options(plan, delivery, { maxRecipients: 2 }));
  }

  assert.deepEqual(delivery.sent, [1,2,3,4,5,6,7]);
  assert.equal(new Set(delivery.sent).size, 7);
  const finalPlan = planDailyDigestRecipients(delivery.snapshot(), { date: DATE, maxRecipients: 2 });
  assert.equal(finalPlan.pending.length, 0);
  assert.equal(finalPlan.eligible, 0);
});

test('F. duplicate cron executions share claims and never create duplicate main deliveries', async () => {
  const source = rows(20);
  const delivery = statefulDelivery(source);
  const planA = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 20 });
  const planB = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 20 });
  const a = virtualClock();
  const b = virtualClock();

  const [first, second] = await Promise.all([
    runBoundedDailyDigest(options(planA, delivery, { clock: a, now: a.now, sleep: a.sleep, maxRecipients: 20 })),
    runBoundedDailyDigest(options(planB, delivery, { clock: b, now: b.now, sleep: b.sleep, maxRecipients: 20 })),
  ]);

  assert.equal(delivery.sent.length, 20);
  assert.equal(new Set(delivery.sent).size, 20);
  assert.ok(first.duplicate + second.duplicate >= 20);
});

test('G. one recipient failure does not block the rest and its persistent claim suppresses unsafe replay', async () => {
  const source = rows(4);
  const delivery = statefulDelivery(source);
  delivery.sendDigest = async row => {
    if (row.telegram_id === 2) {
      const error = new Error('network outcome unknown');
      error.code = 'TELEGRAM_NETWORK';
      throw error;
    }
    delivery.sent.push(row.telegram_id);
  };

  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 10 });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(result.sent, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.ambiguous, 1);
  assert.deepEqual(delivery.sent, [1,3,4]);
  const next = planDailyDigestRecipients(delivery.snapshot(), { date: DATE, maxRecipients: 10, now: Date.parse(`${DATE}T07:10:00.000Z`) });
  assert.equal(next.pending.length, 0);
  assert.equal(next.duplicate, 1);
});

test('G1. malformed or missing claim leases stay sealed instead of becoming replayable', () => {
  const now=Date.parse(`${DATE}T07:20:00.000Z`);
  const source=rows(3);
  for (const row of source) row.delivery_claim_date=DATE;
  source[0].delivery_locked_until='not-a-date';
  source[1].delivery_locked_until=null;
  source[2].delivery_locked_until='2026-02-30T07:30:00.000Z';

  const plan=planDailyDigestRecipients(source,{date:DATE,maxRecipients:10,now});

  assert.equal(plan.activeClaims,3);
  assert.equal(plan.sealedClaims,3);
  assert.equal(plan.expiredClaims,0);
  assert.equal(plan.pending.length,0);
  assert.equal(plan.duplicate,3);
});

test('G1b. malformed delivery date/hour cannot authorize recipients', () => {
  const source=rows(2);

  const badDate=planDailyDigestRecipients(source,{
    date:'2026-02-30',
    hourUtc:7,
    now:Date.parse(`${DATE}T07:00:00.000Z`),
    truncated:'false',
  });
  assert.equal(badDate.invalidDate,true);
  assert.equal(badDate.eligible,0);
  assert.equal(badDate.pending.length,0);
  assert.equal(badDate.truncated,false);

  const badHour=planDailyDigestRecipients(source,{
    date:DATE,
    hourUtc:true,
    now:Date.parse(`${DATE}T07:00:00.000Z`),
  });
  assert.equal(badHour.invalidHour,true);
  assert.equal(badHour.eligible,0);

  source[0].hour_utc=true;
  const rowHour=planDailyDigestRecipients(source,{
    date:DATE,
    hourUtc:7,
    now:Date.parse(`${DATE}T07:00:00.000Z`),
  });
  assert.deepEqual(rowHour.pending.map(row=>row.telegram_id),[2]);
});

test('G2. active claim lease blocks replay while an expired lease becomes recoverable', () => {
  const now = Date.parse(`${DATE}T07:10:00.000Z`);
  const source = rows(3);
  source[0].delivery_claim_date = DATE;
  source[0].delivery_locked_until = `${DATE}T07:12:00.000Z`;
  source[1].delivery_claim_date = DATE;
  source[1].delivery_locked_until = `${DATE}T07:09:59.000Z`;

  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 10, now });

  assert.equal(plan.activeClaims, 1);
  assert.equal(plan.expiredClaims, 1);
  assert.equal(plan.duplicate, 1);
  assert.deepEqual(plan.pending.map(row => row.telegram_id), [2,3]);
});

test('G3. expired claim is reclaimed and delivered on a later invocation', async () => {
  const now = Date.parse(`${DATE}T07:10:00.000Z`);
  const source = rows(1);
  source[0].delivery_claim_date = DATE;
  source[0].delivery_locked_until = `${DATE}T07:09:00.000Z`;
  const delivery = statefulDelivery(source, { nowMs: now });
  const plan = planDailyDigestRecipients(delivery.snapshot(), { date: DATE, maxRecipients: 10, now });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(result.recoveredClaims, 1);
  assert.equal(result.sent, 1);
  assert.equal(delivery.state.get(1).last_sent_date, DATE);
});

test('G4a. malformed claim and arm responses fail closed before Telegram delivery', async () => {
  const source=rows(2);
  let sends=0;
  const plan=planDailyDigestRecipients(source,{date:DATE,maxRecipients:2});
  const result=await runBoundedDailyDigest({
    ...options(plan,statefulDelivery(source),{concurrency:1}),
    claim:async row=>row.telegram_id===1 ? 'true' : true,
    arm:async()=> 'true',
    sendDigest:async()=>{sends+=1;},
    release:async()=>true,
  });
  assert.equal(sends,0);
  assert.equal(result.duplicate,1);
  assert.equal(result.armFailed,1);
  assert.equal(result.retryableDeferred,1);
});

test('G4b. malformed completion and release responses are observable', async () => {
  const source=rows(1);
  const delivery=statefulDelivery(source);
  delivery.complete=async()=>undefined;
  const plan=planDailyDigestRecipients(source,{date:DATE,maxRecipients:1});
  const completed=await runBoundedDailyDigest(options(plan,delivery,{concurrency:1}));
  assert.equal(completed.sent,1);
  assert.equal(completed.stateFailed,1);

  const retrySource=rows(1);
  const retryDelivery=statefulDelivery(retrySource);
  retryDelivery.arm=async()=>false;
  retryDelivery.release=async()=>undefined;
  const retryPlan=planDailyDigestRecipients(retrySource,{date:DATE,maxRecipients:1});
  const released=await runBoundedDailyDigest(options(retryPlan,retryDelivery,{concurrency:1}));
  assert.equal(released.releaseFailed,1);
});

test('G4c. malformed orchestration limits fall back to bounded defaults instead of spawning zero workers', async () => {
  const source=rows(2);
  const delivery=statefulDelivery(source);
  const plan=planDailyDigestRecipients(source,{date:DATE,maxRecipients:2});
  const result=await runBoundedDailyDigest(options(plan,delivery,{
    maxRecipients:'NaN',
    concurrency:'NaN',
    minSendIntervalMs:'Infinity',
    executionBudgetMs:'NaN',
  }));
  assert.equal(result.concurrency,DAILY_DIGEST_POLICY.concurrency);
  assert.equal(result.maxRecipients,DAILY_DIGEST_POLICY.maxRecipientsPerRun);
  assert.equal(result.minSendIntervalMs,DAILY_DIGEST_POLICY.minSendIntervalMs);
  assert.equal(result.sent,2);
});

test('G4. claim is armed before Telegram send and an arm failure never touches Telegram', async () => {
  const source = rows(1);
  const delivery = statefulDelivery(source);
  let sendCalls = 0;
  delivery.arm = async () => false;
  delivery.sendDigest = async () => { sendCalls += 1; };
  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 1 });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(sendCalls, 0);
  assert.equal(result.armFailed, 1);
  assert.equal(result.retryableDeferred, 1);
  assert.equal(result.remaining, 1);
});

test('G5. confirmed Telegram success with completion failure stays sealed against replay', async () => {
  const source = rows(1);
  const delivery = statefulDelivery(source);
  delivery.complete = async () => { throw new Error('database unavailable'); };
  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 1 });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(result.sent, 1);
  assert.equal(result.stateFailed, 1);
  const next = planDailyDigestRecipients(delivery.snapshot(), {
    date: DATE,
    maxRecipients: 1,
    now: Date.parse(`${DATE}T07:30:00.000Z`),
  });
  assert.equal(next.pending.length, 0);
  assert.equal(next.activeClaims, 1);
});

test('G6. ambiguous Telegram outcome remains sealed and is not replayed after the short claim lease', async () => {
  const source = rows(1);
  const delivery = statefulDelivery(source);
  delivery.sendDigest = async () => {
    const error = new Error('network outcome unknown');
    error.code = 'TELEGRAM_NETWORK';
    throw error;
  };
  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 1 });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(result.ambiguous, 1);
  const next = planDailyDigestRecipients(delivery.snapshot(), {
    date: DATE,
    maxRecipients: 1,
    now: Date.parse(`${DATE}T07:30:00.000Z`),
  });
  assert.equal(next.pending.length, 0);
  assert.equal(next.activeClaims, 1);
});

test('G7. rate gate re-checks a concurrent 429 cooldown after an in-flight wait', async () => {
  let now=0;
  const sleepers=[];
  const gate=createDigestRateGate({
    now:()=>now,
    minIntervalMs:50,
    sleep:ms=>new Promise(resolve=>sleepers.push({ms,resolve})),
  });

  assert.equal(await gate.acquire(),true);
  const second=gate.acquire();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(sleepers.length,1);
  assert.equal(sleepers[0].ms,50);

  gate.defer(2);
  now=50;
  sleepers.shift().resolve();
  await new Promise(resolve=>setTimeout(resolve,0));

  assert.equal(sleepers.length,1);
  assert.equal(sleepers[0].ms,1950);

  now=2000;
  sleepers.shift().resolve();
  assert.equal(await second,true);
});

test('G8. execution deadline defers armed rows without sending beyond the budget', async () => {
  const source=rows(4);
  const delivery=statefulDelivery(source);
  const plan=planDailyDigestRecipients(source,{date:DATE,maxRecipients:4});
  const clock=virtualClock();
  const sendTimes=[];

  const result=await runBoundedDailyDigest(options(plan,delivery,{
    clock,
    now:clock.now,
    sleep:clock.sleep,
    maxRecipients:4,
    concurrency:4,
    minSendIntervalMs:50,
    executionBudgetMs:100,
    sendNews:null,
    sendDigest:async row=>{
      sendTimes.push({id:row.telegram_id,at:clock.value()});
      delivery.sent.push(row.telegram_id);
    },
  }));

  assert.deepEqual(sendTimes.map(item=>item.at),[0,50]);
  assert.ok(sendTimes.every(item=>item.at<100));
  assert.equal(result.sent,2);
  assert.equal(result.failed,0);
  assert.equal(result.budgetExhausted,true);
  assert.equal(result.retryableDeferred,2);
  assert.equal(result.remaining,2);
  assert.equal(result.deferred,2);
  assert.equal(result.durationMs,50);

  const snapshot=delivery.snapshot();
  assert.equal(snapshot.filter(row=>row.last_sent_date===DATE).length,2);
  assert.equal(snapshot.filter(row=>row.last_sent_date!==DATE && row.delivery_claim_date===null).length,2);
});

test('H0. malformed Telegram retry_after is bounded to a safe retry delay', () => {
  const invalid=classifyDigestTransportError({
    code:'TELEGRAM_RATE_LIMIT',
    status:429,
    retryAfter:'NaN',
  });
  assert.equal(invalid.retryAfter,1);

  const huge=classifyDigestTransportError({
    code:'TELEGRAM_RATE_LIMIT',
    status:429,
    retryAfter:999999,
  });
  assert.equal(huge.retryAfter,3600);
});

test('H. Telegram 429 honors retry_after once and never enters an uncontrolled retry loop', async () => {
  const source = rows(1);
  const delivery = statefulDelivery(source);
  const clock = virtualClock();
  let calls = 0;
  delivery.sendDigest = async row => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Too Many Requests');
      error.code = 'TELEGRAM_RATE_LIMIT';
      error.status = 429;
      error.retryAfter = 2;
      throw error;
    }
    delivery.sent.push(row.telegram_id);
  };

  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 1 });
  const result = await runBoundedDailyDigest(options(plan, delivery, {
    clock,
    now: clock.now,
    sleep: clock.sleep,
    concurrency: 1,
  }));

  assert.equal(calls, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.rateLimited, 1);
  assert.equal(result.retries, 1);
  assert.ok(result.durationMs >= 2000);
});

test('H2. repeated Telegram 429 releases the claim for a later cron slot', async () => {
  const source = rows(1);
  const delivery = statefulDelivery(source);
  const clock = virtualClock();
  let calls = 0;
  delivery.sendDigest = async () => {
    calls += 1;
    const error = new Error('Too Many Requests');
    error.code = 'TELEGRAM_RATE_LIMIT';
    error.status = 429;
    error.retryAfter = 1;
    throw error;
  };

  const plan = planDailyDigestRecipients(source, { date: DATE, maxRecipients: 1 });
  const result = await runBoundedDailyDigest(options(plan, delivery, {
    clock,
    now: clock.now,
    sleep: clock.sleep,
    concurrency: 1,
  }));

  assert.equal(calls, 2);
  assert.equal(result.rateLimited, 2);
  assert.equal(result.retryableDeferred, 1);
  assert.equal(delivery.state.get(1).delivery_claim_date, null);

  const next = planDailyDigestRecipients(delivery.snapshot(), {
    date: DATE,
    maxRecipients: 1,
    now: Date.parse(`${DATE}T07:10:00.000Z`),
  });
  assert.equal(next.pending.length, 1);
});

test('I. global scan cap remains observable and is never reported as a complete scan', () => {
  const source = rows(DAILY_DIGEST_POLICY.scanCap);
  const plan = planDailyDigestRecipients(source, {
    date: DATE,
    pageSize: DAILY_DIGEST_POLICY.pageSize,
    truncated: true,
  });

  assert.equal(plan.scanned, 10000);
  assert.equal(plan.pages, 20);
  assert.equal(plan.truncated, true);
  assert.equal(plan.remaining, 9000);
});

test('J. empty run is a clean no-op', async () => {
  const delivery = statefulDelivery([]);
  const plan = planDailyDigestRecipients([], { date: DATE });
  const result = await runBoundedDailyDigest(options(plan, delivery));

  assert.equal(result.scanned, 0);
  assert.equal(result.eligible, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.remaining, 0);
});

test('daily digest continuation window uses every five-minute cron slot during 07 UTC only', () => {
  assert.equal(isDailyDigestExecutionWindow(new Date('2026-09-29T07:00:00Z')), true);
  assert.equal(isDailyDigestExecutionWindow(new Date('2026-09-29T07:55:00Z')), true);
  assert.equal(isDailyDigestExecutionWindow(new Date('2026-09-29T06:55:00Z')), false);
  assert.equal(isDailyDigestExecutionWindow(new Date('2026-09-29T08:00:00Z')), false);
});

test('K. fresh active claims and aged sealed claims are distinguished by claim age', () => {
  const now = Date.parse(`${DATE}T07:20:00.000Z`);
  const source = rows(2);
  source[0].delivery_claim_date = DATE;
  source[0].delivery_claimed_at = `${DATE}T07:18:30.000Z`;
  source[0].delivery_locked_until = `${DATE}T23:59:59.999Z`;
  source[1].delivery_claim_date = DATE;
  source[1].delivery_claimed_at = `${DATE}T07:10:00.000Z`;
  source[1].delivery_locked_until = `${DATE}T23:59:59.999Z`;

  const plan = planDailyDigestRecipients(source, { date: DATE, now });

  assert.equal(plan.activeClaims, 2);
  assert.equal(plan.freshClaims, 1);
  assert.equal(plan.sealedClaims, 1);
  assert.equal(plan.oldestActiveClaimAgeMs, 10 * 60 * 1000);
});

test('L. ordinary bounded backlog is informational before the late window', () => {
  const health = assessDailyDigestRun(
    { remaining: 250, backlog: 250, sealedClaims: 0, failed: 0 },
    new Date(`${DATE}T07:25:00.000Z`),
  );

  assert.equal(health.severity, 'info');
  assert.equal(health.code, 'DAILY_DIGEST_RUN_DEFERRED');
  assert.equal(health.reason, 'bounded_backlog');
});

test('M. remaining backlog becomes warning near the end of the delivery window', () => {
  const health = assessDailyDigestRun(
    { remaining: 12, backlog: 12, sealedClaims: 0, failed: 0 },
    new Date(`${DATE}T07:50:00.000Z`),
  );

  assert.equal(health.severity, 'warning');
  assert.equal(health.code, 'DAILY_DIGEST_BACKLOG_LATE');
  assert.equal(health.reason, 'late_backlog');
});

test('N. sealed claims take precedence over generic degraded/backlog status', () => {
  const health = assessDailyDigestRun(
    { remaining: 50, sealedClaims: 2, failed: 1, rateLimited: 1 },
    new Date(`${DATE}T07:55:00.000Z`),
  );

  assert.equal(health.severity, 'warning');
  assert.equal(health.code, 'DAILY_DIGEST_SEALED_CLAIMS');
  assert.equal(health.reason, 'sealed_claims');
});

test('O. expired claim recovery is observable without escalating a healthy run', () => {
  const health = assessDailyDigestRun(
    { remaining: 0, expiredClaims: 3, sealedClaims: 0, failed: 0 },
    new Date(`${DATE}T07:15:00.000Z`),
  );

  assert.equal(health.severity, 'info');
  assert.equal(health.code, 'DAILY_DIGEST_CLAIMS_RECOVERED');
  assert.equal(health.reason, 'claim_recovery');
});

test('P. provider payload degradation is a warning even before Telegram delivery starts', () => {
  const health = assessDailyDigestRun(
    { remaining: 12, backlog: 12, providerDegraded: true, failed: 0, rateLimited: 0 },
    new Date(`${DATE}T07:20:00.000Z`),
  );

  assert.equal(health.severity, 'warning');
  assert.equal(health.code, 'DAILY_DIGEST_RUN_DEGRADED');
  assert.equal(health.reason, 'degraded');
});

test('Q. provider payload failure remains retryable without claiming or sending recipients', async () => {
  const providerError=Object.assign(new Error('provider limit'),{code:'FOOTBALL_RATE_LIMIT'});
  const {runtime,ops,telegram,memory}=telegramDigestHarness({
    loadProviderFixturesForDate:async()=>{throw providerError;},
    getCache:async()=>null,
    getStaleCache:async()=>null,
  });

  const summary=await runtime.processDailyDigests(
    {botToken:'123456:TEST'},
    new Date(`${DATE}T07:05:00.000Z`),
  );

  assert.equal(summary.sent,0);
  assert.equal(summary.claimed,0);
  assert.equal(summary.remaining,1);
  assert.equal(summary.backlog,1);
  assert.equal(summary.providerDegraded,true);
  assert.equal(summary.payloadUnavailable,true);
  assert.equal(summary.rateLimited,1);
  assert.equal(telegram.length,0);
  assert.equal(memory.botDigestSubscriptions.get(1).delivery_claim_date,null);

  const degraded=ops.find(item=>item.code==='DAILY_DIGEST_RUN_DEGRADED');
  assert.ok(degraded);
  assert.equal(degraded.meta.retryable,true);
  assert.equal(degraded.meta.payloadSource,'unavailable');
});

test('Q2. optional morning news failure does not block the primary digest delivery', async () => {
  const cachedDigest={
    date:DATE,
    source:'provider',
    providerDegraded:false,
    rows:[{
      fixtureId:11,
      homeName:'Home',
      awayName:'Away',
      league:'League',
      date:`${DATE}T18:00:00.000Z`,
      live:false,
    }],
  };
  const {runtime,telegram}=telegramDigestHarness({
    getCache:async key=>key===`bot:digest:${DATE}:v1` ? cachedDigest : null,
    currentMorningFootballNews:async()=>{throw new Error('news unavailable');},
  });

  const summary=await runtime.processDailyDigests(
    {botToken:'123456:TEST'},
    new Date(`${DATE}T07:05:00.000Z`),
  );

  assert.equal(summary.sent,1);
  assert.equal(summary.news,0);
  assert.equal(summary.newsDegraded,true);
  assert.equal(summary.providerDegraded,false);
  assert.equal(telegram.length,1);
  assert.match(String(telegram[0].text),/Home — Away/);
});

test('R. current digest falls back to stale current-day match cache without identity leakage', async () => {
  const providerError=Object.assign(new Error('provider limit'),{code:'FOOTBALL_RATE_LIMIT'});
  const cachedMatch={
    fixtureId:77,
    date:`${DATE}T18:00:00.000Z`,
    status:'NS',
    live:false,
    home:{id:1,name:'Home',logo:''},
    away:{id:2,name:'Away',logo:''},
    homeName:'Home',
    awayName:'Away',
    league:'League',
    interestScore:75,
    competition:{priority:60},
    featured:true,
  };
  const {runtime}=telegramDigestHarness({
    loadProviderFixturesForDate:async()=>{throw providerError;},
    getCache:async()=>null,
    getStaleCache:async key=>key===`matches:${DATE}:v6-integrity`
      ? {matches:[cachedMatch]}
      : null,
  });

  const digest=await runtime.currentDailyDigest({botToken:'private-bot-token'});

  assert.equal(digest.source,'matches_cache');
  assert.equal(digest.providerDegraded,true);
  assert.equal(digest.providerRateLimited,true);
  assert.equal(digest.rows.length,1);
  assert.equal(digest.rows[0].fixtureId,77);
  assert.doesNotMatch(
    JSON.stringify(digest),
    /chat_id|telegram_id|private-bot-token|Authorization/i,
  );
});

test('controlled performance model covers 100 / 1k / 5k / 10k recipients and rejects ambiguous inputs', () => {
  const samples=[100,1000,5000,10000].map(count=>estimateDigestOrchestration(count));
  assert.deepEqual(samples.map(x=>x.recipients),[100,1000,5000,10000]);
  assert.deepEqual(samples.map(x=>x.oldMinimumMs),[4000,49000,249000,499000]);
  assert.deepEqual(samples.map(x=>x.runs),[1,1,5,10]);
  assert.deepEqual(samples.map(x=>x.activeMsPerRun),[10000,100000,100000,100000]);
  assert.deepEqual(samples.map(x=>x.completionWindowMs),[10000,100000,1300000,2800000]);

  assert.deepEqual(estimateDigestOrchestration(true),{
    recipients:0,
    oldBatches:0,
    oldMinimumMs:0,
    runs:0,
    activeMsPerRun:0,
    completionWindowMs:0,
  });
  const bounded=estimateDigestOrchestration(100,{
    oldBatchSize:true,
    oldBatchDelayMs:false,
    messagesPerRecipient:true,
    maxRecipientsPerRun:true,
    minSendIntervalMs:true,
    cronIntervalMs:true,
  });
  assert.equal(bounded.recipients,100);
  assert.equal(bounded.oldBatches,5);
  assert.equal(bounded.runs,1);
  assert.equal(bounded.activeMsPerRun,10000);
});
