import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('the daily overview uses clear wording', () => {
  assert.match(html, /id="dailyOverviewTitle">Рекомендации для вас<\/h2>/);
  assert.match(app, /title\.textContent = 'Рекомендации для вас'/);
  assert.match(app, /title\.textContent = 'Сейчас в эфире'/);
  assert.match(app, /title\.textContent = 'Матчи ваших команд'/);
  assert.doesNotMatch(app, /Главное без лишнего/);
});

test('the primary match feed is presented as a personal For You view', () => {
  assert.match(html, /class="filter-btn active" data-filter="top">✨ Для вас/);
  assert.match(html, /id="overviewRecommendedCount"/);
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

test('match cards explain why a recommendation is shown', () => {
  assert.match(app, /reason = 'Любимая команда'/);
  assert.match(app, /reason = 'Вы смотрели эту команду'/);
  assert.match(app, /reason = 'Сейчас в эфире'/);
  assert.match(app, /favorite-signal/);
});

test('history enrichment is deferred and technical profile data is collapsed', () => {
  assert.match(app, /const tasks = \[loadReminders\(\), loadHistory\(false\)\]/);
  assert.match(html, /<details class="profile-data-details">/);
  assert.match(html, /id="dataModeSummary"/);
  assert.match(css, /\.profile-data-details > summary/);
});
