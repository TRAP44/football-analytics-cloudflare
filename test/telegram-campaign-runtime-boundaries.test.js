import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramCampaignRuntime } from '../src/telegram-campaign-runtime.js';

function cleanLaunchPart(value,maxLength=24) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,maxLength);
}

function runtime(overrides={}) {
  return createTelegramCampaignRuntime({cleanLaunchPart,...overrides});
}

test('Telegram campaign runtime validates dependencies and freezes public surface',()=>{
  assert.throws(
    ()=>createTelegramCampaignRuntime(null),
    /dependencies are required/,
  );
  assert.throws(
    ()=>createTelegramCampaignRuntime({}),
    /cleanLaunchPart is required/,
  );
  assert.equal(Object.isFrozen(runtime()),true);
});

test('start payload parser accepts only exact Telegram start commands',()=>{
  const api=runtime();
  assert.equal(api.telegramStartPayload('/start media__press__ucl__post1'),'media__press__ucl__post1');
  assert.equal(api.telegramStartPayload('/start@MatchRadarAIBot ABC_123-xyz'),'ABC_123-xyz');
  assert.equal(api.telegramStartPayload('/START abc'),'abc');
  assert.equal(api.telegramStartPayload('/starter abc'),'');
  assert.equal(api.telegramStartPayload('/start abc!'),'');
  assert.equal(api.telegramStartPayload('/start abc extra'),'');
  assert.equal(api.telegramStartPayload(`/start ${'a'.repeat(65)}`),'');
  assert.equal(api.telegramStartPayload('/start abc\ndef'),'');
  assert.equal(api.telegramStartPayload({toString(){throw new Error('boom');}}),'');
});

test('campaign aggregation rejects non-array inputs and malformed rows',()=>{
  const api=runtime();
  assert.deepEqual(api.buildMediaCampaignPerformance({length:1}),[]);
  assert.deepEqual(api.buildMediaCampaignPerformance([null,1,'row',[]]),[]);
});

test('campaign aggregation accepts only positive safe Telegram ids',()=>{
  const api=runtime();
  const rows=[
    {telegram_id:true,event_name:'bot_start',source:'press',campaign:'c',content:'x'},
    {telegram_id:[1],event_name:'bot_start',source:'press',campaign:'c',content:'x'},
    {telegram_id:-1,event_name:'bot_start',source:'press',campaign:'c',content:'x'},
    {telegram_id:'1e3',event_name:'bot_start',source:'press',campaign:'c',content:'x'},
    {telegram_id:'7',event_name:'bot_start',source:'press',campaign:'c',content:'x'},
    {telegram_id:8,event_name:'quick_ai',source:'press',campaign:'c',content:'x'},
  ];
  const [result]=api.buildMediaCampaignPerformance(rows);
  assert.equal(result.users,2);
  assert.equal(result.entries,1);
  assert.equal(result.quickAi,1);
});

test('campaign dimensions fail soft when cleaner throws or returns unsafe output',()=>{
  const throwing=runtime({
    cleanLaunchPart(value,max){
      if (String(value).includes('boom')) throw new Error('cleaner down');
      return cleanLaunchPart(value,max);
    },
  });
  assert.doesNotThrow(()=>throwing.buildMediaCampaignPerformance([
    {telegram_id:1,event_name:'bot_start',source:'boom',campaign:'c'},
    {telegram_id:2,event_name:'bot_start',source:'press',campaign:'c',content:'good'},
  ]));
  const result=throwing.buildMediaCampaignPerformance([
    {telegram_id:2,event_name:'bot_start',source:'press',campaign:'c',content:'good'},
  ]);
  assert.equal(result[0].source,'press');

  const unsafe=runtime({cleanLaunchPart:()=> 'bad|dimension'});
  assert.deepEqual(unsafe.buildMediaCampaignPerformance([
    {telegram_id:1,event_name:'bot_start',source:'press',campaign:'c'},
  ]),[]);
});

test('media event counters remain available without a Telegram user id',()=>{
  const api=runtime();
  const [result]=api.buildMediaCampaignPerformance([
    {telegram_id:0,event_name:'media_link_created',source:'press',campaign:'launch',content:'post1'},
    {telegram_id:null,event_name:'fixture_deep_link_open',source:'press',campaign:'launch',content:'post1'},
  ]);
  assert.equal(result.users,0);
  assert.equal(result.linksCreated,1);
  assert.equal(result.deepLinkOpens,1);
  assert.equal(result.events,2);
});

test('campaign ordering is deterministic for equal performance buckets',()=>{
  const api=runtime();
  const result=api.buildMediaCampaignPerformance([
    {telegram_id:2,event_name:'bot_start',source:'press',campaign:'z',content:'b'},
    {telegram_id:1,event_name:'bot_start',source:'press',campaign:'a',content:'a'},
  ]);
  assert.deepEqual(result.map(x=>x.campaign),['a','z']);
});

test('campaign control drill still passes after boundary hardening',()=>{
  assert.deepEqual(runtime().mediaCampaignControlDrill(),{pass:true,cases:8});
});

test('campaign conversion counts unique Telegram users despite repeated identical events',()=>{
  const api=runtime();
  const rows=[
    {telegram_id:7,event_name:'bot_start',source:'press',campaign:'launch',content:'post'},
    {telegram_id:7,event_name:'bot_start',source:'press',campaign:'launch',content:'post'},
    {telegram_id:7,event_name:'quick_ai',source:'press',campaign:'launch',content:'post'},
    {telegram_id:7,event_name:'quick_ai',source:'press',campaign:'launch',content:'post'},
  ];
  const result=api.buildMediaCampaignPerformance(rows);
  assert.equal(result.length,1);
  assert.equal(result[0].users,1);
  assert.equal(result[0].entries,1);
  assert.equal(result[0].quickAi,1);
  assert.equal(result[0].events,4);
  assert.equal(result[0].quickAiPct,100);
});
