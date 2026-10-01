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
  assert.match(html, /id="remindersPanel"/);
  assert.match(app, /profileFavoriteTeamsBtn/);
  assert.match(app, /profileRemindersBtn/);
});

test('Profile uses plain Russian copy for plans notifications and data availability', () => {
  assert.doesNotMatch(html, /smart-уведомления/);
  assert.doesNotMatch(html, /notification-возможности/);
  assert.match(html, /Что может быть в матче/);
  assert.match(html, /Составы, игроки, статистика и коэффициенты/);
  assert.match(notifications, /УМНЫЕ УВЕДОМЛЕНИЯ/);
  assert.match(notifications, /AI-сигналы/);
  assert.doesNotMatch(notifications, /Smart Alerts/);
  assert.doesNotMatch(notifications, /cooldown/);
});

test('Digest renders the fixed server schedule in local browser time', () => {
  assert.match(digest, /digestLocalDeliveryWindow/);
  assert.match(digest, /По вашему местному времени/);
  assert.match(digest, /Время пока нельзя изменить вручную/);
  assert.doesNotMatch(digest, /Фиксированное окно текущей серверной доставки · 07:00–07:55 UTC/);
});

test('Match Pass profile context does not inherit an unrelated last viewed fixture', () => {
  assert.match(billing, /return safeFixtureId\(passFixtureId\)/);
  assert.match(billing, /function clearPassContext/);
  assert.doesNotMatch(billing, /Сервер подпишет именно этот fixtureId/);
  assert.match(billing, /Match Pass будет привязан к выбранному матчу №/);
  assert.match(app, /preservePassContext/);
});
