import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('Home uses contextual LIVE and My Teams cards without duplicate counters', () => {
  assert.match(html, /id="homeLiveCard"/);
  assert.match(html, /id="homeTeamsBtn"/);
  assert.match(html, /id="homeFavoriteBtn"/);
  assert.doesNotMatch(html, /overviewRecommendedCount|dailyOverviewTitle|dailyOverviewKicker/);
  assert.match(app, /liveCard\.hidden = liveCount <= 0/);
  assert.match(app, /teamsCard\.hidden = favoriteCount <= 0/);
});

test('the primary match feed is presented as a personal For You view', () => {
  assert.match(html, /class="filter-btn active" data-filter="top">Для вас/);
  assert.match(html, /<option value="top">✨ Для вас<\/option>/);
});

test('recommendations combine favorites, viewing history and live context', () => {
  assert.match(app, /function personalContextSignals\(\)/);
  assert.match(app, /function personalMatchInsight\(match,/);
  assert.match(app, /signals\.favoriteTeams\.has\(homeId\)/);
  assert.match(app, /signals\.viewedTeams\.has\(homeName\)/);
  assert.match(app, /if \(match\.live\) score \+= 48/);
  assert.match(app, /personalMatchInsight\(m, signals\)\.recommended/);
});

test('recommendation reasons stay in ranking logic but off compact feed cards', () => {
  assert.match(app, /reason = 'Любимая команда'/);
  assert.match(app, /reason = 'Вы смотрели эту команду'/);
  assert.match(app, /reason = 'Сейчас в эфире'/);
  const card=app.slice(app.indexOf('function matchCardHtml'),app.indexOf('function bindMatchActions'));
  assert.doesNotMatch(card, /favorite-signal|Почему здесь/);
});

test('AI history is deferred while technical profile data stays collapsed for admin', () => {
  assert.match(app, /const tasks = \[loadHistory\(false\)\]/);
  assert.match(app, /tasks\.push\(loadProvider\(\),loadReminders\(\)\)/);
  assert.match(html, /<details class="profile-data-details">/);
  assert.match(html, /id="dataModeSummary"/);
  assert.match(css, /\.profile-data-details > summary/);
});
