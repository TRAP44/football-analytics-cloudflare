import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLIC_VIEW_IDS, backTargetForView, telegramBackButtonVisible } from '../public/modules/navigation.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('Player Hub is a first-class public view with Match Center return navigation', () => {
  assert.ok(PUBLIC_VIEW_IDS.includes('playerView'));
  assert.equal(backTargetForView('playerView', { playerBackView:'analysisView' }), 'analysisView');
  assert.equal(backTargetForView('playerView', { playerBackView:'' }), 'matchesView');
  assert.equal(telegramBackButtonVisible('playerView'), true);
  assert.match(html, /id="playerView" class="view"/);
  assert.match(html, /id="playerBackBtn"/);
  assert.match(html, /id="playerHub"/);
});

test('Match Center player rows open Player Hub from already loaded match data', () => {
  assert.match(app, /data-center-player="/);
  assert.match(app, /function openPlayerFromMatch\(playerId, side = ''\)/);
  assert.match(app, /center\.playerLeaders\?\.\[key\]/);
  assert.match(app, /state\.currentPlayer = \{/);
  assert.match(app, /source: 'match_center'/);
  assert.match(app, /showView\('playerView'\)/);
});

test('Player Hub 4A exposes match metrics without adding an API request', () => {
  const start=app.indexOf('function renderPlayerHub');
  const end=app.indexOf('function openPlayerFromMatch', start);
  assert.ok(start >= 0 && end > start);
  const source=app.slice(start,end);
  for (const label of ['Минуты','Голы','Ассисты','Удары в створ','Ключевые передачи','Отборы','Перехваты','Сейвы']) {
    assert.ok(source.includes(label), `missing metric: ${label}`);
  }
  assert.doesNotMatch(source, /\bapi\s*\(/);
  assert.match(source, /Контекст матча остаётся независимым от сезонной выборки/);
});

test('Player Hub has responsive visual hierarchy and launch11 cache revision', () => {
  assert.match(styles, /\/\* Player Hub 4A \*\//);
  assert.match(styles, /\.player-hub-main\s*\{/);
  assert.match(styles, /\.player-hub-metrics\s*\{/);
  assert.match(html, /frontend-asset-revision" content="6\.120\.0-launch\d+"/);
  assert.doesNotMatch(html, /6\.120\.0-launch10/);
});
