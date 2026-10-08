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
test('current public manifest keeps the launch UX capabilities enabled', () => {
  const capabilities=fs.readFileSync('src/app-capabilities.js','utf8');
  assert.match(capabilities,/focusedMatchHome:true/);
  assert.match(capabilities,/contextualLeagueFilter:true/);
  assert.match(capabilities,/matchAtAGlanceCockpit:true/);
  assert.doesNotMatch(worker,/quickMatchReminders:\s*'disabled'|firstRunGuide:\s*'disabled'/);
});

test('quick reminder reflects pending and active state without duplicate writes',()=>{
  const start=app.indexOf('function syncQuickReminderButton');
  const end=app.indexOf('function syncAllQuickReminderButtons',start);
  const sync=app.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.match(sync,/button\.disabled = pending/);
  assert.match(sync,/classList\.toggle\('is-pending', pending\)/);
  assert.match(sync,/classList\.toggle\('active', active\)/);
  assert.match(sync,/setAttribute\('aria-pressed', active \? 'true' : 'false'\)/);
  const toggleStart=app.indexOf('async function toggleReminder');
  const toggleEnd=app.indexOf('\nfunction ',toggleStart+8);
  const toggle=app.slice(toggleStart,toggleEnd>toggleStart?toggleEnd:undefined);
  assert.match(toggle,/state\.reminderMutations\.has\(fixtureId\)/);
  assert.match(toggle,/runtimeAllows\('remindersEnabled'\) === true/);
  assert.match(toggle,/state\.reminderMutations\.add\(fixtureId\)/);
  assert.match(toggle,/method: 'DELETE'/);
  assert.match(toggle,/method: 'POST'/);
});
