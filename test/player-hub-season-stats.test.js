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
