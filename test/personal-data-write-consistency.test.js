import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const favoriteTeamsRenderer = fs.readFileSync('public/modules/favorite-teams-renderer.js', 'utf8');

test('favorite reads cannot overwrite a newer confirmed mutation', () => {
  assert.match(app, /favoritesRevision:\s*0/);
  const load = app.match(/async function loadFavorites\(\)[\s\S]*?\n}\n\nasync function loadReminders/);
  assert.ok(load, 'loadFavorites must exist');
  assert.match(load[0], /const revisionAtStart = state\.favoritesRevision/);
  assert.match(load[0], /revisionAtStart !== state\.favoritesRevision/);
  assert.match(app, /state\.favoritesRevision \+= 1/);
});

test('reminder reads cannot overwrite a newer confirmed mutation', () => {
  assert.match(app, /remindersRevision:\s*0/);
  const load = app.match(/async function loadReminders\(\)[\s\S]*?\n}\n\nfunction reminderDeliveryBadge/);
  assert.ok(load, 'loadReminders must exist');
  assert.match(load[0], /const revisionAtStart = state\.remindersRevision/);
  assert.match(load[0], /revisionAtStart !== state\.remindersRevision/);
  assert.match(app, /state\.remindersRevision \+= 1/);
});

test('creating a reminder updates the local list from the POST response without a second GET', () => {
  const toggle = app.match(/async function toggleReminder\(match\)[\s\S]*?\n}\n\nfunction clampPercent/);
  assert.ok(toggle, 'toggleReminder must exist');
  assert.match(toggle[0], /const data = await api\('\/api\/reminders', \{/);
  assert.match(toggle[0], /const item = data\?\.item/);
  assert.match(toggle[0], /state\.reminders = \[item,/);
  assert.doesNotMatch(toggle[0], /await loadReminders\(\)/);
});

test('reminder API returns the same normalized item shape after GET and POST', () => {
  assert.match(worker, /function publicReminder\(row = \{\}\)/);
  assert.match(worker, /rows\.map\(publicReminder\)/);
  assert.match(worker, /item: publicReminder\(row\)/);
  assert.match(worker, /deliveryStatus: reminderDeliveryStatus\(row\)/);
  assert.match(worker, /remindBeforeMinutes: Number\(row\.remind_before_minutes \|\| 30\)/);
});

test('empty cached personal-data lists still surface refresh failures', () => {
  assert.match(favoriteTeamsRenderer, /Последний загруженный список избранного был пуст/);
  assert.match(app, /Последний загруженный список напоминаний был пуст/);
});

test('RC28 health exposes personal-data write consistency contracts', () => {
  assert.match(worker, /personalDataWriteConsistency:\s*'enabled'/);
  assert.match(worker, /reminderWriteConfirmation:\s*'enabled'/);
  assert.match(worker, /readWriteRaceGuard:\s*'enabled'/);
});
