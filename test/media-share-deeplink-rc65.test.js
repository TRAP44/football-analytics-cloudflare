import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const playbook=fs.readFileSync('MEDIA_SHARE_DEEPLINK_RC65.md','utf8');

test('RC65 fixture deep-link payload is compact and carries attribution',()=> {
  assert.match(worker,/function fixtureShareStartParam\(/);
  assert.match(worker,/fx\\d\{1,12\}/);
  assert.match(worker,/fixtureId,action:'fixture'/);
  assert.match(worker,/function fixtureDeepLinkDrill\(/);
});

test('share-link endpoint resolves Telegram bot username and returns a start link',()=> {
  assert.match(worker,/async function telegramBotUsername\(/);
  assert.match(worker,/telegramApi\('getMe',cfg\)/);
  assert.match(worker,/async function fixtureTelegramDeepLink\(/);
  assert.match(worker,/async function apiFixtureShareLink\(/);
  assert.match(worker,/url\.pathname === '\/api\/share-link'/);
});

test('Telegram /start fixture link skips search and opens the target match',()=> {
  assert.match(worker,/fixtureDeepLink:Boolean\(launchIntent\.fixtureId\)/);
  assert.match(worker,/eventName:'fixture_deep_link_open'/);
  assert.match(worker,/Загружаю AI-разбор без повторного поиска/);
  assert.match(worker,/sendBotFixtureMenu\(request,cfg,userId,chatId,Number\(launchIntent\.fixtureId\)/);
});

test('deep-link attribution follows match open and quick AI events',()=> {
  assert.match(worker,/async function sendBotFixtureMenu\(request, cfg, userId, chatId, fixtureId, options = \{\}\)/);
  assert.match(worker,/eventName:'match_open'[\s\S]{0,180}attribution:options\.attribution/);
  assert.match(worker,/eventName:'quick_ai'[\s\S]{0,200}attribution:options\.attribution/);
});

test('Telegram match cards expose native share flow',()=> {
  assert.match(worker,/match:share:/);
  assert.match(worker,/async function sendBotFixtureShareCard\(/);
  assert.match(worker,/Отправить другу \/ в канал/);
  assert.match(worker,/telegramShareComposerUrl\(/);
});

test('Mini App share includes a fixture deep link and native Telegram fallback',()=> {
  assert.match(app,/\/api\/share-link\?fixtureId=/);
  assert.match(app,/campaign=match_share/);
  assert.match(app,/tg\?\.openTelegramLink/);
  assert.match(app,/navigator\.share/);
  assert.match(app,/Ссылка на матч скопирована/);
});

test('admin funnel exposes media share to AI conversion',()=> {
  assert.match(worker,/mediaLoop:\{/);
  assert.match(worker,/fixture_deep_link_open/);
  assert.match(worker,/share_link_created/);
  assert.match(app,/Media deep-link → AI/);
  assert.match(app,/Media loop:/);
});

test('RC65 health contract is release-gated',()=> {
  for (const flag of ['mediaFixtureDeepLinks','shareableMatchCards','shareAttribution','deepLinkAutoAnalysis','telegramNativeShare']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
  assert.match(worker,/fixtureDeepLinkSelfTest: fixtureDeepLinkDrill\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(playbook,/Media Share & Deep-Link Loop/);
});