import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const profileSummary = fs.readFileSync('public/modules/profile-summary.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

test('main match screen keeps secondary discovery inside the league drawer', () => {
  const drawerStart = html.indexOf('<details class="home-filter-drawer league-filter-drawer">');
  const drawerEnd = html.indexOf('</details>', drawerStart);
  const popular = html.indexOf('id="popularCompetitionsWrap"');
  assert.ok(drawerStart >= 0 && drawerEnd > drawerStart);
  assert.ok(popular > drawerStart && popular < drawerEnd);
  assert.match(app, /\.slice\(0, 5\)/);
});

test('league filter summary explains the selected filter and closes after selection', () => {
  assert.match(app, /summaryValue\.textContent = activeLeagueFilter \? labels\[state\.filter\] : 'Выбрать'/);
  assert.match(app, /btn\.closest\('\.league-filter-drawer'\)/);
  assert.match(app, /drawer\.open = false/);
});

test('quota is quiet until it is useful', () => {
  assert.match(html, /id="quotaText" hidden/);
  assert.match(profileSummary, /Number\(quota\.left\) <= 3 \|\| state\.profileStale/);
});

test('date context stays directly available without a duplicate overview headline', () => {
  assert.match(html, /data-offset="-1">Вчера/);
  assert.match(html, /data-offset="0">Сегодня/);
  assert.match(html, /data-offset="1">Завтра/);
  assert.doesNotMatch(html, /dailyOverviewKicker|dailyOverviewTitle|dailyOverviewText/);
});

test('RC39 health exposes focused-home contracts', () => {
  assert.match(worker, /focusedMatchHome:\s*'enabled'/);
  assert.match(worker, /contextualLeagueFilter:\s*'enabled'/);
});
