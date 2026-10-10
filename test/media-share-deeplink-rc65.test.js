import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTelegramLinksRuntime } from '../src/telegram-links.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const router=fs.readFileSync('src/router.js','utf8');
const referral=fs.readFileSync('src/growth-referral.js','utf8');
const publisher=fs.readFileSync('src/publisher-runtime.js','utf8');
const telegramLinks=fs.readFileSync('src/telegram-links.js','utf8');
const telegramUpdate=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
const botUi=fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const adminFunnel=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');
const growthAnalytics=fs.readFileSync('src/growth-analytics-runtime.js','utf8');

const linksRuntime=createTelegramLinksRuntime({
  cleanLaunchPart(value,max=48) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,max);
  },
});

test('RC65 fixture deep-link payload is compact and carries attribution',()=> {
  const payload=linksRuntime.fixtureShareStartParam(123456,{
    source:'media',
    campaign:'launch',
    content:'sportnews',
  });
  assert.equal(payload,'fx123456__media__launch__sportnews');
  assert.ok(payload.length<=64);

  assert.match(referral,/\^fx\\d\{1,12\}\$/);
  assert.match(referral,/fixtureId,/);
  assert.match(referral,/action:'fixture'/);
  assert.match(publisher,/function fixtureDeepLinkDrill\(/);
});

test('share-link endpoint resolves Telegram bot identity and returns a start link',()=> {
  assert.match(telegramLinks,/async function telegramBotUsername\(/);
  assert.match(telegramLinks,/getMe:async\(\)=>/);
  assert.match(telegramLinks,/telegramApi\('getMe',source\)/);
  assert.match(telegramLinks,/async function fixtureTelegramDeepLink\(/);
  assert.match(publisher,/async function apiFixtureShareLink\(/);
  assert.match(router,/pathname === '\/api\/share-link'/);
});

test('Telegram /start fixture link skips search and opens the target match',()=> {
  assert.match(telegramUpdate,/fixtureDeepLink:launchFixtureId>0/);
  assert.match(telegramUpdate,/eventName:'fixture_deep_link_open'/);
  assert.match(telegramUpdate,/Загружаю AI-разбор без повторного поиска/);
  assert.match(
    telegramUpdate,
    /sendBotFixtureMenu\(request,cfg,userId,chatId,launchFixtureId,\{attribution:launchIntent,source:'deep_link'\}\)/,
  );
});

test('deep-link attribution follows match open and quick AI events',()=> {
  assert.match(botUi,/async function sendBotFixtureMenu\(/);
  assert.match(botUi,/const attribution=objectValue\(opts\.attribution\)/);
  assert.match(botUi,/eventName:'match_open'[\s\S]{0,220}attribution/);
  assert.match(botUi,/eventName:'quick_ai'[\s\S]{0,220}attribution/);
});

test('Telegram match cards expose native share flow',()=> {
  assert.match(botUi,/match:share:/);
  assert.match(telegramUpdate,/match:share:/);
  assert.match(publisher,/async function sendBotFixtureShareCard\(/);
  assert.match(publisher,/Отправить другу \/ в канал/);
  assert.match(publisher,/telegramShareComposerUrl\(/);
});

test('Mini App share includes a fixture deep link and native Telegram fallback',()=> {
  // «Поделиться матчем» вынесено в ленивый модуль match-share.js.
  const share=fs.readFileSync('public/modules/match-share.js','utf8');
  assert.match(app,/import\('\.\/modules\/match-share\.js\?v=/);
  assert.match(share,/\/api\/share-link\?fixtureId=/);
  assert.match(share,/campaign=match_share/);
  assert.match(share,/tg\?\.openTelegramLink/);
  assert.match(share,/navigatorRef\?\.share/);
  assert.match(share,/Ссылка на матч скопирована/);
});

test('admin funnel exposes media share to AI conversion',()=> {
  assert.match(growthAnalytics,/mediaLoop:\{/);
  assert.match(growthAnalytics,/fixture_deep_link_open/);
  assert.match(growthAnalytics,/share_created/);
  assert.match(growthAnalytics,/share_link_created/);
  assert.match(adminFunnel,/Media deep-link → AI/);
  assert.match(adminFunnel,/Media loop:/);
});

test('RC65 deep-link flow stays release-wired through current modules',()=> {
  assert.match(worker,/createTelegramLinksRuntime/);
  assert.match(worker,/createPublisherRuntime/);
  assert.match(worker,/createTelegramBotUiRuntime/);
  assert.match(worker,/createGrowthAnalyticsRuntime/);
  assert.match(router,/apiFixtureShareLink/);
});
