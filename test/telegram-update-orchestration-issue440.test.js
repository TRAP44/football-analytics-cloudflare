import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTelegramUpdateProcessor } from '../src/telegram-update-orchestration.js';

const responseJson=(body,status=200)=>({body,status});

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
    telegramWebAppUrl:()=> 'https://example.test/app',
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
    newsTeamToken:()=>'',
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
    telegramStartPayload:()=>'',
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

const request={url:'https://example.test/telegram/webhook'};

test('Telegram update processor fails closed during security lockdown', async()=>{
  const calls=[];
  const processor=createTelegramUpdateProcessor(deps({
    telegramLockdownDecision:()=>({blocked:true,rejectCheckout:false}),
    telegramApi:async(method,_cfg,body)=>calls.push({method,body}),
  }));
  const result=await processor(request,{}, {callback_query:{id:'cb-1'}});
  assert.deepEqual(result.body,{ok:true,securityLockdown:true});
  assert.equal(calls[0]?.method,'answerCallbackQuery');
  assert.equal(calls[0]?.body?.show_alert,true);
});

test('Telegram update processor rejects checkout when monetization is paused', async()=>{
  const calls=[];
  const processor=createTelegramUpdateProcessor(deps({telegramApi:async(method,_cfg,body)=>calls.push({method,body})}));
  const result=await processor(request,{monetizationEnabled:false},{pre_checkout_query:{id:'pc-1'}});
  assert.deepEqual(result.body,{ok:true});
  assert.equal(calls[0]?.method,'answerPreCheckoutQuery');
  assert.equal(calls[0]?.body?.ok,false);
});

test('Telegram digest callback delegates persistence and delivery through injected capabilities', async()=>{
  const events=[];
  const processor=createTelegramUpdateProcessor(deps({
    setBotDigestSubscription:async(...args)=>events.push(['digest',...args.slice(0,3)]),
    telegramApi:async(method,_cfg,body)=>events.push(['api',method,body]),
  }));
  const update={callback_query:{id:'cb-2',data:'digest:on',from:{id:77},message:{chat:{id:88}}}};
  const result=await processor(request,{},update);
  assert.deepEqual(result.body,{ok:true});
  assert.deepEqual(events[0].slice(0,4),['digest',77,88,true]);
  assert.equal(events.filter(x=>x[0]==='api').length,2);
});

test('Telegram successful payment is delegated without embedding billing state in orchestration', async()=>{
  const applied=[];
  const processor=createTelegramUpdateProcessor(deps({applySuccessfulPayment:async(...args)=>applied.push(args)}));
  const payment={telegram_payment_charge_id:'charge-1'};
  const result=await processor(request,{}, {message:{from:{id:5},date:100,successful_payment:payment}});
  assert.deepEqual(result.body,{ok:true});
  assert.equal(applied.length,1);
  assert.equal(applied[0][0],5);
  assert.equal(applied[0][1],payment);
  assert.equal(applied[0][3],100);
});

test('ordinary Telegram text delegates to football search', async()=>{
  const calls=[];
  const processor=createTelegramUpdateProcessor(deps({sendBotFootballSearch:async(...args)=>calls.push(args)}));
  const result=await processor(request,{}, {message:{from:{id:7},chat:{id:8},text:'Реал — Барселона'}});
  assert.deepEqual(result.body,{ok:true});
  assert.equal(calls.length,1);
  assert.equal(calls[0][2],7);
  assert.equal(calls[0][3],8);
  assert.equal(calls[0][4],'Реал — Барселона');
});

test('worker keeps Telegram webhook transport wiring but no longer owns update dispatch body',()=>{
  // Source-contract assertions intentionally live here after the bounded extraction.
  const worker=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  assert.match(worker,/createTelegramUpdateProcessor/);
  assert.doesNotMatch(worker,/async function processTelegramUpdate\s*\(/);
  assert.match(worker,/processTelegramUpdate,\n\s+releaseTelegramUpdate/);
});
