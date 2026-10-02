import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTelegramLinksRuntime } from '../src/telegram-links.js';

function cleanLaunchPart(value, maxLength = 24) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,maxLength);
}

function runtime() {
  return createTelegramLinksRuntime({
    cleanLaunchPart,
    getCache:async()=>null,
    setCache:async()=>{},
    telegramApi:async()=>({id:1,username:'MatchRadarAIBot'}),
  });
}

test('generic promo campaign start param is compact and attributable', async () => {
  const api=runtime();
  const startParam=api.campaignStartParam({
    source:'telegram_channel',
    campaign:'soft_launch',
    content:'post1',
  });
  assert.equal(startParam,'media__telegram_channel__soft_launch__post1');
  assert.ok(startParam.length<=64);
  const deep=await api.telegramCampaignDeepLink({botToken:'test'},{
    source:'telegram_channel',
    campaign:'soft_launch',
    content:'post1',
  });
  assert.equal(deep.startParam,startParam);
  assert.match(deep.url,/^https:\/\/t\.me\/MatchRadarAIBot\?start=media__/);
});

test('worker parses generic media campaign into source campaign and content', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/campaignStartParam/);
  assert.match(worker,/telegramCampaignDeepLink/);
  assert.match(worker,/campaignParsed\.source==='telegram_channel'/);
  assert.match(worker,/campaignParsed\.campaign==='soft_launch'/);
  assert.match(worker,/campaignParsed\.content==='post1'/);
});

test('admin media publisher supports generic promo link when fixture is empty', () => {
  const module=fs.readFileSync('public/modules/admin-media-publisher.js','utf8');
  assert.match(module,/const fixtureRaw = mediaPublisherValue\('mediaPublisherFixtureId'\)/);
  assert.match(module,/fixtureId: fixtureId \|\| null/);
  assert.match(module,/telegram_channel/);
  assert.match(module,/soft_launch/);
  assert.match(module,/post1/);

  const worker=fs.readFileSync('src/worker.js','utf8');
  const start=worker.indexOf('async function apiMediaPublisherLink');
  const end=worker.indexOf('function mediaPublisherDrill',start);
  const block=worker.slice(start,end);
  assert.match(block,/if \(fixtureId>0\)/);
  assert.match(block,/telegramCampaignDeepLink\(cfg/);
  assert.match(block,/mode='campaign'/);
  assert.match(block,/fixtureId:fixtureId \|\| null/);
});

test('admin UI explains generic promotion and optional fixture targeting', () => {
  const html=fs.readFileSync('public/admin.html','utf8');
  assert.match(html,/Промо-ссылка/);
  assert.match(html,/Fixture ID · необязательно/);
  assert.match(html,/Пусто = ссылка на MatchRadar/);
  assert.match(html,/media__telegram_channel__soft_launch__post1/);
});

test('launch funnel keeps source campaign content performance dimensions', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const start=worker.indexOf('function buildMediaCampaignPerformance');
  const end=worker.indexOf('function mediaCampaignControlDrill',start);
  const block=worker.slice(start,end);
  assert.match(block,/source/);
  assert.match(block,/campaign/);
  assert.match(block,/content/);
  assert.match(block,/fullAiConversionPct/);
});
