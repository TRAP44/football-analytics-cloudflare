import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const reminderHealth = readFileSync(new URL('../public/modules/admin-reminder-health.js', import.meta.url), 'utf8');

test('reminder health implementation lives outside the shared app root', () => {
  assert.match(reminderHealth, /export function createAdminReminderHealthModule/);
  assert.match(reminderHealth, /function renderReminderHealth\(\)/);
  assert.match(reminderHealth, /async function loadReminderHealth\(force = false\)/);
  assert.match(reminderHealth, /async function sendReminderTest\(\)/);
  assert.doesNotMatch(app, /Проверяю расписание и фиксацию задач доставки/);
  assert.doesNotMatch(app, /prematchSent24h/);
});

test('shared app root lazy-loads reminder health only for admins', () => {
  const start = app.indexOf('async function ensureAdminReminderHealthModule()');
  const end = app.indexOf('\nlet adminReleaseMonitorModule', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-reminder-health\.js'\)/);
  assert.match(boundary, /loadReminderHealth/);
  assert.match(boundary, /sendReminderTest/);
});
