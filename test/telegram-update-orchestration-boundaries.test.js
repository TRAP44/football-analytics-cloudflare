import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramUpdateProcessor } from '../src/telegram-update-orchestration.js';

const responseJson=(body,status=200)=>({body,status});
const request={url:'https://app.example/telegram/webhook'};

function deps(overrides={}) {
  return {
    loadRuntimeControls:async()=>({value:{}}),
    telegramLockdownDecision:()=>({blocked:false,rejectCheckout:false}),
    telegramApi:async()=>({ok:true}),
    json:responseJson,
    parseInvoicePayload:async()=>null,
    billingPlanConfig:()=>null,
    parsePassInvoicePayload:async()=>null,
    passProductConfig:()=>null,
    setBotDigestSubscription:async()=>{},
    telegramWebAppUrl:(req,params={})=>{
      const url=new URL(req.url);
      url.pathname='/';
      url.search='';
      for(const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
      return url.toString();
    },
    recordGrowthEvent:async()=>{},
    footballBotKeyboard:()=>({keyboard:[]}),
    sendBotDayMatches:async()=>{},
    cleanNewsImpactDecisionCode:value=>String(value||''),
    cleanNewsImpactActionCode:value=>String(value||''),
    cleanNewsImpactRecoveryCode:value=>String(value||''),
    recordNewsImpactRecoveryAttempt:async()=>{},
    sendGeneralFootballNews:async()=>{},
    recordNewsImpactOutcome:async()=>{},
    sendNewsImpactRecoveryMessage:async()=>{},
    sendBotFixtureShareCard:async()=>{},
    sendBotFixtureSection:async()=>({ok:true}),
    newsPublishedAtFromDayToken:()=>null,
    newsTeamByToken:()=>null,
    botRemoteTeamMatches:async()=>[],
    newsRelevantFixture:()=>null,
    newsTeamToken:()=> '',
    sendBotFootballSearch:async()=>{},
    sendFavoriteTeamNews:async()=>{},
    toggleBotFavorite:async()=>({active:false,team:{name:'Team'}}),
    loadBotFixtureCard:async()=>null,
    getFavorites:async()=>[],
    footballMatchActionKeyboard:()=>({inline_keyboard:[]}),
    setCache:async()=>{},
    postMatchReturnDisabledKey:id=>`postmatch:${id}`,
    memory:{cache:new Map()},
    hasSupabase:()=>false,
    supaDelete:async()=>{},
    applySuccessfulPayment:async()=>{},
    applyRefundedPayment:async()=>{},
    updateUserSubscription:async()=>{},
    telegramStartPayload:()=> '',
    upsertUser:async()=>{},
    parseLaunchStartParam:()=>({fixtureId:0}),
    ensureLaunchAttribution:async()=>({}),
    applyReferralAttribution:async()=>({accepted:false,status:'none'}),
    configureFootballBot:async()=>{},
    sendBotFixtureMenu:async()=>{},
    sendFootballBotHome:async()=>{},
    footballBotMoreKeyboard:()=>({keyboard:[]}),
    sendFootballBotHelp:async()=>{},
    sendBotFavoriteTeams:async()=>{},
    sendBotFavoriteTeamMatches:async()=>{},
    sendDailyPicks:async()=>{},
    sendLastAiVerdict:async()=>{},
    sendBotAiTrackRecord:async()=>{},
    sendDigestControls:async()=>{},
    ...overrides,
  };
}

test('Telegram update orchestration rejects malformed dependency bags', () => {
  assert.throws(
    () => createTelegramUpdateProcessor(null),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelegramUpdateProcessor([]),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelegramUpdateProcessor({}),
    /loadRuntimeControls is required/,
  );
});

test('Telegram update orchestration rejects malformed updates before control-plane work', async () => {
  let controls=0;
  const processor=createTelegramUpdateProcessor(deps({
    loadRuntimeControls:async()=>{
      controls+=1;
      return {value:{}};
    },
  }));

  for (const update of [null,[],42,'bad']) {
    const result=await processor(request,{},update);
    assert.equal(result.status,400);
    assert.equal(result.body.error,'telegram_update_invalid');
  }
  assert.equal(controls,0);
});

test('Telegram callback with a chat requires a real Telegram user id', async () => {
  let subscriptions=0;
  const processor=createTelegramUpdateProcessor(deps({
    setBotDigestSubscription:async()=>{ subscriptions+=1; },
  }));

  const result=await processor(request,{},{
    callback_query:{
      id:'cb-1',
      data:'digest:on',
      message:{chat:{id:-100123}},
    },
  });

  assert.equal(result.status,400);
  assert.equal(result.body.error,'telegram_user_invalid');
  assert.equal(subscriptions,0);
});

test('Telegram callback id is bounded before Telegram API use', async () => {
  let calls=0;
  const processor=createTelegramUpdateProcessor(deps({
    telegramApi:async()=>{
      calls+=1;
      return {};
    },
  }));

  const result=await processor(request,{},{
    callback_query:{
      id:'x'.repeat(1000),
      data:'feed:today',
      from:{id:7},
      message:{chat:{id:8}},
    },
  });

  assert.equal(result.status,400);
  assert.equal(result.body.error,'callback_query_invalid');
  assert.equal(calls,0);
});

test('Telegram API dependency may return synchronously without breaking swallowed replies', async () => {
  const calls=[];
  const processor=createTelegramUpdateProcessor(deps({
    telegramLockdownDecision:()=>({blocked:true,rejectCheckout:false}),
    telegramApi:(method,_cfg,payload)=>{
      calls.push({method,payload});
      return {ok:true};
    },
  }));

  const result=await processor(request,{},{
    callback_query:{
      id:'cb-sync',
      data:'feed:today',
      from:{id:7},
      message:{chat:{id:8}},
    },
  });

  assert.equal(result.status,200);
  assert.equal(result.body.securityLockdown,true);
  assert.equal(calls[0].method,'answerCallbackQuery');
});

test('digest mutation never receives an untrusted cross-origin Web App URL', async () => {
  const writes=[];
  const processor=createTelegramUpdateProcessor(deps({
    telegramWebAppUrl:()=> 'https://evil.example/phish',
    setBotDigestSubscription:async(...args)=>writes.push(args),
  }));

  const result=await processor(request,{},{
    callback_query:{
      id:'cb-digest',
      data:'digest:on',
      from:{id:7},
      message:{chat:{id:8}},
    },
  });

  assert.equal(result.status,200);
  assert.equal(writes.length,1);
  assert.equal(writes[0][0],7);
  assert.equal(writes[0][1],8);
  assert.equal(writes[0][4],'');
});

test('malformed payment refund and subscription payloads fail closed', async () => {
  let paymentCalls=0;
  let refundCalls=0;
  let subscriptionCalls=0;
  const processor=createTelegramUpdateProcessor(deps({
    applySuccessfulPayment:async()=>{ paymentCalls+=1; },
    applyRefundedPayment:async()=>{ refundCalls+=1; },
    updateUserSubscription:async()=>{ subscriptionCalls+=1; },
  }));

  const payment=await processor(request,{},{
    message:{from:{id:7},successful_payment:[]},
  });
  assert.equal(payment.status,400);
  assert.equal(payment.body.error,'telegram_payment_invalid');

  const refund=await processor(request,{},{
    message:{from:{id:7},refunded_payment:{}},
  });
  assert.equal(refund.status,400);
  assert.equal(refund.body.error,'telegram_refund_invalid');

  const subscription=await processor(request,{},{
    subscription:{
      invoice_payload:'payload',
      state:'unknown',
      user:{id:7},
    },
  });
  assert.equal(subscription.status,400);
  assert.equal(subscription.body.error,'telegram_subscription_invalid');

  assert.equal(paymentCalls,0);
  assert.equal(refundCalls,0);
  assert.equal(subscriptionCalls,0);
});

test('ordinary search no longer falls back from missing user id to private chat id', async () => {
  let searches=0;
  const processor=createTelegramUpdateProcessor(deps({
    sendBotFootballSearch:async()=>{ searches+=1; },
  }));

  const result=await processor(request,{},{
    message:{
      chat:{id:8},
      text:'Реал — Барселона',
    },
  });

  assert.equal(result.status,400);
  assert.equal(result.body.error,'telegram_user_invalid');
  assert.equal(searches,0);
});

test('runtime-control failures are normalized into retryable upstream errors', async () => {
  const processor=createTelegramUpdateProcessor(deps({
    loadRuntimeControls:async()=>{
      const error=new Error('controls offline');
      Object.freeze(error);
      throw error;
    },
  }));

  await assert.rejects(
    () => processor(request,{}, {message:{chat:{id:8},from:{id:7},text:'/today'}}),
    error=>error?.code==='TELEGRAM_UPSTREAM'
      && error?.message==='controls offline',
  );
});


test('Telegram callback fixture and team identifiers fail closed before handlers', async () => {
  let fixtureCalls=0;
  let teamCalls=0;
  const processor=createTelegramUpdateProcessor(deps({
    sendBotFixtureMenu:async()=>{ fixtureCalls+=1; },
    sendFavoriteTeamNews:async()=>{ teamCalls+=1; },
  }));

  const invalidFixture=await processor(request,{},{
    callback_query:{
      id:'cb-fixture',
      data:'match:menu:0',
      from:{id:7},
      message:{chat:{id:8}},
    },
  });
  assert.equal(invalidFixture.status,400);
  assert.equal(invalidFixture.body.error,'fixture_id_invalid');

  const invalidTeam=await processor(request,{},{
    callback_query:{
      id:'cb-team',
      data:'news:team:0',
      from:{id:7},
      message:{chat:{id:8}},
    },
  });
  assert.equal(invalidTeam.status,400);
  assert.equal(invalidTeam.body.error,'team_id_invalid');
  assert.equal(fixtureCalls,0);
  assert.equal(teamCalls,0);
});

test('subscription identity mismatch never mutates subscription state', async () => {
  let mutations=0;
  const processor=createTelegramUpdateProcessor(deps({
    parseInvoicePayload:async()=>({userId:99}),
    updateUserSubscription:async()=>{ mutations+=1; },
  }));

  const result=await processor(request,{},{
    subscription:{
      invoice_payload:'payload',
      state:'active',
      user:{id:7},
    },
  });

  assert.equal(result.status,400);
  assert.equal(result.body.error,'telegram_subscription_identity_mismatch');
  assert.equal(mutations,0);
});

test('nonessential news outcome tracking cannot turn a delivered action into recovery', async () => {
  let recoveries=0;
  let deliveries=0;
  const processor=createTelegramUpdateProcessor(deps({
    sendGeneralFootballNews:async()=>{ deliveries+=1; },
    recordNewsImpactOutcome:async()=>{ throw new Error('analytics offline'); },
    sendNewsImpactRecoveryMessage:async()=>{ recoveries+=1; },
  }));

  const result=await processor(request,{},{
    callback_query:{
      id:'cb-news',
      data:'news:impact:material:news:77',
      from:{id:7},
      message:{chat:{id:8}},
    },
  });

  assert.equal(result.status,200);
  assert.deepEqual(result.body,{ok:true});
  assert.equal(deliveries,1);
  assert.equal(recoveries,0);
});
