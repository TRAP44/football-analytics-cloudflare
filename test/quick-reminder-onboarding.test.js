import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

test('Home avoids persistent favorite onboarding promos and keeps the first screen focused', () => {
  assert.doesNotMatch(html, /id="homeFavoriteBtn"/);
  assert.doesNotMatch(html, /Сделайте ленту своей/);
  assert.doesNotMatch(html, /dailyOverviewTitle|Главное без лишнего/);
});
test('upcoming match cards expose a quick reminder action', () => {
  assert.match(app, /data-quick-reminder=/);
  assert.match(app, /syncQuickReminderButton/);
  assert.match(app, /toggleReminder\(match\)/);
  assert.match(css, /\.quick-reminder-btn/);
  assert.match(css, /\.match-card-actions/);
});
test('first-run guidance stays available without a permanent Home favorite card', () => {
  assert.match(html, /id="firstRunGuide"/);
  assert.match(html, /id="firstRunGuideFavorite"/);
  assert.doesNotMatch(html, /id="homeFavoriteBtn"/);
  assert.doesNotMatch(app, /homeFavoriteBtn/);
});
test('RC38 health advertises the new UX contracts', () => {
  assert.match(worker, /quickMatchReminders:\s*'enabled'/);
  assert.match(worker, /firstRunGuide:\s*'enabled'/);
});
