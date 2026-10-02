import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
  assert.doesNotMatch(html, /id="remindersPanel"|id="reminderList"|Активные напоминания/);
  assert.match(app, /profileFavoriteTeamsBtn/);
  assert.match(app, /profileRemindersBtn[^]*showView\('matchesView'\)/);
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
