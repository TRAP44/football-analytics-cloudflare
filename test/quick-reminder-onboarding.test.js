import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

test('daily overview uses a concrete user-facing title', () => {
  assert.match(html, /id="dailyOverviewTitle">Матчи для вас</);
  assert.match(app, /title\.textContent = 'Матчи для вас'/);
  assert.doesNotMatch(html, /Главное без лишнего/);
});
test('upcoming match cards expose a quick reminder action', () => {
  assert.match(app, /data-quick-reminder=/);
  assert.match(app, /syncQuickReminderButton/);
  assert.match(app, /toggleReminder\(match\)/);
  assert.match(css, /\.quick-reminder-btn/);
  assert.match(css, /\.match-card-actions/);
});
test('first-run guidance is local and dismissible', () => {
  assert.match(html, /id="firstRunGuide"/);
  assert.match(html, /id="firstRunGuideDismiss"/);
  assert.match(app, /FIRST_RUN_GUIDE_KEY/);
  assert.match(app, /localStorage\.setItem\(FIRST_RUN_GUIDE_KEY, '1'\)/);
});
test('RC38 health advertises the new UX contracts', () => {
  assert.match(worker, /quickMatchReminders:\s*'enabled'/);
  assert.match(worker, /firstRunGuide:\s*'enabled'/);
});
