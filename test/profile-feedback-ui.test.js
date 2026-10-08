import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { digestLocalDeliveryWindow } from '../public/modules/digest-settings.js';
import { buildPassPurchaseBody } from '../public/modules/billing.js';

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const billing = fs.readFileSync('public/modules/billing.js', 'utf8');
const digest = fs.readFileSync('public/modules/digest-settings.js', 'utf8');
const notifications = fs.readFileSync('public/modules/smart-notifications.js', 'utf8');

test('Profile removes the duplicate My Teams block and makes useful counters actionable', () => {
  assert.doesNotMatch(html, /profile-teams-shortcut/);
  assert.doesNotMatch(html, /id="profileMyTeamsBtn"/);
  assert.match(html, /id="profileFavoriteTeamsBtn"/);
  assert.match(html, /id="profileRemindersBtn"/);
  assert.match(html, /id="remindersPanel"/);
  assert.match(html, /id="reminderList"/);
  assert.match(html, /Активные напоминания/);
  assert.match(app, /profileFavoriteTeamsBtn/);
  assert.match(app, /profileRemindersBtn[^]*remindersPanel[^]*scrollIntoView/);
});

test('Profile uses plain Russian copy and removes technical data availability chrome', () => {
  assert.doesNotMatch(html, /smart-уведомления/);
  assert.doesNotMatch(html, /notification-возможности/);
  assert.doesNotMatch(html, /Что может быть в матче/);
  assert.doesNotMatch(html, /profile-data-details/);
  assert.match(notifications, /УМНЫЕ УВЕДОМЛЕНИЯ/);
  assert.match(notifications, /AI-сигналы/);
  assert.doesNotMatch(notifications, /Smart Alerts/);
  assert.doesNotMatch(notifications, /cooldown/);
});

test('Digest renders the fixed delivery schedule in local browser time without implementation wording', () => {
  assert.match(digest, /digestLocalDeliveryWindow/);
  assert.match(digest, /По вашему местному времени/);
  assert.match(digest, /Время доставки задаётся автоматически/);
  assert.doesNotMatch(digest, /Время пока нельзя изменить вручную|серверное окно доставки|Фиксированное окно текущей серверной доставки · 07:00–07:55 UTC/);
});

test('Match Pass profile context does not inherit an unrelated last viewed fixture', () => {
  assert.match(billing, /return safeFixtureId\(passFixtureId\)/);
  assert.match(billing, /function clearPassContext/);
  assert.doesNotMatch(billing, /Сервер подпишет именно этот fixtureId/);
  assert.match(billing, /Match Pass будет привязан к выбранному матчу №/);
  assert.match(app, /profileBtn[\s\S]*billingModule\?\.clearPassContext/);
  assert.match(app, /navProfile[\s\S]*billingModule\?\.clearPassContext/);
});



test('Digest invalid timezone falls back to the browser local window rather than raw UTC',()=>{
  const when=new Date('2026-06-15T12:00:00.000Z');
  const local=digestLocalDeliveryWindow(7,when);
  assert.equal(digestLocalDeliveryWindow(7,when,'Not/ARealZone'),local);
  assert.match(local,/^\d{2}:\d{2}–\d{2}:\d{2}$/);
});

test('Digest delivery respects named summer and winter timezone offsets',()=>{
  assert.equal(digestLocalDeliveryWindow(7,new Date('2026-06-15T12:00:00Z'),'Europe/Riga'),'10:00–10:55');
  assert.equal(digestLocalDeliveryWindow(7,new Date('2026-12-15T12:00:00Z'),'Europe/Riga'),'09:00–09:55');
  assert.equal(digestLocalDeliveryWindow(7,new Date('2026-06-15T12:00:00Z'),'UTC'),'07:00–07:55');
});

test('Match Pass purchase always requires a validated explicitly selected fixture',()=>{
  assert.deepEqual(buildPassPurchaseBody('MATCH_PASS',12345),{passType:'MATCH_PASS',fixtureId:12345});
  assert.deepEqual(buildPassPurchaseBody('MATCH_PASS','00012345'),{passType:'MATCH_PASS',fixtureId:12345});
  for(const invalid of [undefined,null,0,-1,true,[],{},'1e3','123?next=45','9007199254740992']){
    assert.equal(buildPassPurchaseBody('MATCH_PASS',invalid),null);
  }
  assert.deepEqual(buildPassPurchaseBody('DAY_PASS',0),{passType:'DAY_PASS'});
  assert.equal(buildPassPurchaseBody('UNKNOWN',123),null);
});

test('Profile and navigation clicks clear old Match Pass fixture context before entering profile',()=>{
  const handlers=[
    app.slice(app.indexOf("$('profileBtn').addEventListener"),app.indexOf("$('profileBtn').addEventListener")+350),
    app.slice(app.indexOf("$('navProfile').addEventListener"),app.indexOf("$('navProfile').addEventListener")+230),
  ];
  for(const handler of handlers){
    assert.match(handler,/billingModule\?\.clearPassContext\(\)/);
    assert.ok(handler.indexOf('clearPassContext()')<handler.indexOf('openProfileView()'));
  }
});
