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



test('Player Hub back navigation rejects unknown, external and self-referential destinations',()=>{
  for(const target of ['',null,undefined,'https://example.test','playerView','adminView']){
    assert.equal(backTargetForView('playerView',{playerBackView:target}),'matchesView');
  }
  assert.equal(backTargetForView('playerView',{playerBackView:'teamView'}),'teamView');
  assert.equal(backTargetForView('playerView',{playerBackView:'analysisView'}),'analysisView');
  assert.equal(backTargetForView('unknownView',{playerBackView:'analysisView'}),'matchesView');
});

test('Player Hub remains in an immutable public view registry without a new bottom tab',()=>{
  assert.equal(Object.isFrozen(PUBLIC_VIEW_IDS),true);
  assert.equal(new Set(PUBLIC_VIEW_IDS).size,PUBLIC_VIEW_IDS.length);
  assert.equal(PUBLIC_VIEW_IDS.includes('adminView'),false);
  assert.equal(telegramBackButtonVisible('matchesView'),false);
  assert.equal(telegramBackButtonVisible('playerView'),true);
  assert.equal(telegramBackButtonVisible('adminView'),false);
  const start=html.indexOf('<nav class="bottom-nav"');
  const end=html.indexOf('</nav>',start);
  assert.ok(start>=0 && end>start);
  const nav=html.slice(start,end);
  assert.doesNotMatch(nav,/playerView|navPlayer|data-open-player/);
});

test('Player Hub escapes visible match and player fields and sanitizes player image URLs',()=>{
  const start=app.indexOf('function renderPlayerHub');
  const end=app.indexOf('function openPlayerFromMatch',start);
  assert.ok(start>=0 && end>start);
  const hub=app.slice(start,end);
  for(const field of [
    "escapeHtml(p.name || 'Игрок')",
    "escapeHtml(team.name || 'Команда')",
    "escapeHtml(match.league || '')",
    "escapeHtml(match.home?.name || '')",
    "escapeHtml(match.away?.name || '')",
    "escapeHtml(match.statusLabel || '')",
  ]) assert.ok(hub.includes(field),'Missing escape for '+field);
  assert.match(hub,/safeUrl\(p\.photo\)/);
  assert.match(hub,/playerFollowModule\.controlHtml\(player\)/);
  assert.match(hub,/bindPlayerComparisonActions\(player, playerComparisonCandidatesFor\(player\)\)/);
  assert.doesNotMatch(hub,/\bfetch\(|\bapi\s*\(/);
});

test('Player Hub opens only cached Match Center players and handles missing player data safely',()=>{
  const start=app.indexOf("function openPlayerFromMatch");
  const end=app.indexOf("function freshnessSourceLabel",start);
  assert.ok(start>=0 && end>start);
  const open=app.slice(start,end);
  assert.match(open,/state\.currentCenter \|\| \{\}/);
  assert.match(open,/center\.playerLeaders\?\.\[key\]/);
  assert.match(open,/if \(!player\) return toast\(/);
  assert.match(open,/if \(current !== 'playerView'\) state\.playerBackView = current \|\| 'analysisView'/);
  assert.match(open,/showView\('playerView'\)/);
  assert.doesNotMatch(open,/\bapi\s*\(|\bfetch\s*\(/);
});
