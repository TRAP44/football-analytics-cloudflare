import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  channelPublisherState,
  fixtureChannelCta,
  publishChannelMessage,
  publisherDedupeKey,
  sendPhoto,
} from '../src/channel-publisher.js';

const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/auth-user.js','utf8');
const router=fs.readFileSync('src/router.js','utf8');
const envExample=fs.readFileSync('.env.example','utf8');
const wrangler=fs.readFileSync('wrangler.jsonc','utf8');

test('publisher token is separate and missing config fails closed', () => {
  assert.deepEqual(
    channelPublisherState({botToken:'main',publisherBotToken:'',telegramChannelId:'@MatchRadarFootball'}),
    {enabled:false,reason:'missing_publisher_token',channelId:'@MatchRadarFootball'}
  );
  assert.equal(channelPublisherState({botToken:'same',publisherBotToken:'same',telegramChannelId:'@MatchRadarFootball'}).reason,'publisher_token_must_be_separate');
  assert.equal(channelPublisherState({botToken:'main',publisherBotToken:'publisher',telegramChannelId:'@MatchRadarFootball'}).enabled,true);
  assert.match(worker,/publisherBotToken:\s*env\.TELEGRAM_PUBLISHER_BOT_TOKEN/);
  assert.match(worker,/telegramChannelId:\s*env\.TELEGRAM_CHANNEL_ID/);
  assert.match(envExample,/TELEGRAM_PUBLISHER_BOT_TOKEN=PASTE_TELEGRAM_PUBLISHER_BOT_TOKEN/);
  assert.match(wrangler,/"TELEGRAM_CHANNEL_ID":\s*"@MatchRadarFootball"/);
});

test('channel CTA is fixed and sendPhoto is prepared without being routed in MVP', () => {
  const markup=fixtureChannelCta('https://t.me/MatchRadarBot?start=fx123');
  assert.equal(markup.inline_keyboard[0][0].text,'Открыть матч в MatchRadar');
  assert.equal(typeof sendPhoto,'function');
  assert.match(fs.readFileSync('src/channel-publisher.js','utf8'),/publisherTelegramApi\('sendPhoto'/);
  assert.doesNotMatch(router,/channel-publisher\/photo/);
});

test('manual publisher route is admin-only and uses existing fixture deep-link contract', () => {
  assert.match(router,/request\.method === 'POST' && url\.pathname === '\/api\/admin\/channel-publisher\/test'/);
  assert.match(router,/if \(!isAdminUser\(user, cfg\)\) return adminForbidden\(\);[\s\S]{0,180}apiChannelPublisherTest/);
  assert.match(worker,/fixtureTelegramDeepLink\(cfg,fixtureId,\{source:'channel',campaign:'publisher_mvp',content:'manual'\}\)/);
  assert.match(worker,/url:\s*link\.url/);
  assert.match(worker,/dryRun\s*=\s*body\?\.dryRun !== false/);
  assert.match(worker,/const adminSensitive = isAdminSensitivePath\(requestUrl\.pathname\)/);
  assert.match(worker,/path\.startsWith\('\/api\/admin\/'\)/);
});

test('publisher has deterministic idempotency and suppresses a repeated send', async () => {
  const cfg={botToken:'main-token',publisherBotToken:'publisher-token',telegramChannelId:'@MatchRadarFootball'};
  const input={cfg,fixtureId:12345,text:'Тест MatchRadar',ctaUrl:'https://t.me/MatchRadarBot?start=fx12345'};
  const a=await publisherDedupeKey(input);
  const b=await publisherDedupeKey(input);
  assert.equal(a,b);
  assert.match(a,/^telegram:channel-publish:v1:sha256:/);

  const ledger=new Map();
  let sends=0;
  const deps={
    fetchImpl:async () => {
      sends += 1;
      return new Response(JSON.stringify({ok:true,result:{message_id:77}}),{status:200,headers:{'content-type':'application/json'}});
    },
    claimIdempotency:async key => {
      const existing=ledger.get(key);
      if (existing) return {claimed:false,messageId:existing.messageId,inProgress:existing.state==='publishing'};
      const claim={state:'publishing',claimId:'claim-1'};
      ledger.set(key,claim);
      return {claimed:true,claimId:claim.claimId};
    },
    completeIdempotency:async (key,value) => ledger.set(key,{state:'sent',messageId:value.messageId,claimId:value.claimId}),
    releaseIdempotency:async key => ledger.delete(key),
  };

  const first=await publishChannelMessage(input,deps);
  const second=await publishChannelMessage(input,deps);
  assert.equal(first.published,true);
  assert.equal(second.duplicate,true);
  assert.equal(second.messageId,77);
  assert.equal(sends,1);
});

test('publisher dedupe uses existing analysis_cache without schema changes and cron does not publish', () => {
  assert.match(worker,/async function claimChannelPublishIdempotency/);
  assert.match(worker,/resolution=ignore-duplicates,return=representation/);
  assert.match(worker,/analysis_cache/);
  const scheduled=worker.slice(worker.indexOf('async scheduled('));
  assert.doesNotMatch(scheduled,/publishChannelMessage|apiChannelPublisherTest|TELEGRAM_PUBLISHER_BOT_TOKEN/);
});
