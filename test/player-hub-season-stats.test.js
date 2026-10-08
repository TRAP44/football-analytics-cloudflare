import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

function sourceBetween(startNeedle, endNeedle) {
  const start = app.indexOf(startNeedle);
  const end = app.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  assert.ok(end > start, `missing boundary ${endNeedle}`);
  return app.slice(start, end);
}

test('Player Hub 4C resolves season data from the existing team player stats payload', () => {
  const source = sourceBetween('function playerSeasonStatProfile', 'function playerSeasonStatsHtml');
  assert.match(source, /data\?\.playerStats/);
  assert.match(source, /stats\.players/);
  assert.match(source, /found\.games\?\.appearances/);
  assert.match(source, /found\.goals\?\.total/);
  assert.match(source, /found\.goals\?\.assists/);
  assert.match(source, /found\.passes\?\.accuracy/);
  assert.match(source, /found\.cards\?\.yellow/);
});

test('Player Hub 4C reuses Team Intelligence cache before making any shared team request', () => {
  const source = sourceBetween('async function loadPlayerSeasonStats', 'function renderPlayerHub');
  assert.match(source, /state\.teamIntelligenceCache\.get\(key\)/);
  assert.match(source, /\/api\/team\/intelligence\?\$\{q\.toString\(\)\}/);
  assert.match(source, /state\.teamIntelligenceCache\.set\(key, data\)/);
  assert.doesNotMatch(source, /\/api\/player|\/players\?/);
});

test('Player Hub 4C remains fail-soft when competition context or season coverage is missing', () => {
  const loadSource = sourceBetween('async function loadPlayerSeasonStats', 'function renderPlayerHub');
  const htmlSource = sourceBetween('function playerSeasonStatsHtml', 'async function loadPlayerSeasonStats');
  assert.match(loadSource, /competition_context_missing/);
  assert.match(loadSource, /seasonStats = \{ error:true/);
  assert.match(htmlSource, /частичное покрытие/);
  assert.match(htmlSource, /сезонные показатели временно недоступны/i);
  assert.match(htmlSource, /Источник сейчас бережёт квоту/);
});

test('Player Hub 4C renders season metrics and responsive layout', () => {
  const source = sourceBetween('function playerSeasonStatsHtml', 'async function loadPlayerSeasonStats');
  for (const label of ['Матчи','В старте','Минуты','Голы','Ассисты','Рейтинг','Ключ. передачи','Точность паса','Жёлтые','Красные']) {
    assert.ok(source.includes(label), `missing season metric: ${label}`);
  }
  assert.match(styles, /Player Hub 4C — season statistics/);
  assert.match(styles, /\.player-hub-season-grid\s*\{/);
  assert.match(FRONTEND_ASSET_REVISION, /^6\.120\.0-launch\d+$/);
});



test('Player Hub season stats never resolve a known ID from a different same-name player',()=>{
  const code=sourceBetween('function playerSeasonStatProfile','function playerSeasonStatsHtml');
  assert.match(code,/const sameId = targetId > 0 && Number\(item\?\.id \|\| 0\) === targetId/);
  assert.match(code,/const sameName = !targetId && targetName &&/);
  assert.match(code,/return sameId \|\| sameName/);
});

test('Player Hub season stats preserve missing data as unavailable rather than zero',()=>{
  const code=sourceBetween('function playerSeasonStatProfile','function playerSeasonStatsHtml');
  assert.match(code,/if \(value === null \|\| value === undefined \|\| value === ''\) return null/);
  assert.match(code,/return Number\.isFinite\(parsed\) \? parsed : null/);
  for(const field of ['appearances','lineups','minutes','rating','goals','assists','keyPasses','passAccuracy','yellow']){
    assert.match(code,new RegExp(field+': optionalMetric\\('));
  }
  assert.doesNotMatch(code,/Number\.isFinite\(Number\(found\./);
});

test('Player Hub counts additional yellow-red cards only when red card value is present',()=>{
  const code=sourceBetween('function playerSeasonStatProfile','function playerSeasonStatsHtml');
  assert.match(code,/const redCards = optionalMetric\(found\.cards\?\.red\)/);
  assert.match(code,/const yellowRedCards = optionalMetric\(found\.cards\?\.yellowRed\) \?\? 0/);
  assert.match(code,/red: redCards === null \? null : redCards \+ yellowRedCards/);
});

test('Player Hub ignores late season responses after the user navigates to another player',()=>{
  const code=sourceBetween('async function loadPlayerSeasonStats','function renderPlayerHub');
  assert.match(code,/state\.teamIntelligenceCache\.get\(key\)/);
  assert.match(code,/state\.teamIntelligenceCache\.set\(key, data\)/);
  assert.equal((code.match(/if \(state\.currentPlayer !== player\) return;/g)||[]).length,2);
  assert.match(code,/competition_context_missing/);
});
