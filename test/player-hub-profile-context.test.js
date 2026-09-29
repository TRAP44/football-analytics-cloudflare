import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('Player Hub 4B enriches a match player from the existing team squad endpoint', () => {
  assert.match(app, /function playerSquadProfile\(data = \{\}, player = \{\}\)/);
  assert.match(app, /function loadPlayerSquadProfile\(player = state\.currentPlayer\)/);
  assert.match(app, /state\.teamSquadCache\.get\(key\)/);
  assert.match(app, /\/api\/team\/squad\?teamId=\$\{teamId\}/);
  assert.match(app, /state\.teamSquadCache\.set\(key, data\)/);
});

test('Player Hub 4B keeps current-match profile usable while squad enrichment loads or fails', () => {
  const start = app.indexOf('async function loadPlayerSquadProfile');
  const end = app.indexOf('function renderPlayerHub', start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /player\.squadProfile = \{ loading: true \}/);
  assert.match(source, /player\.squadProfile = \{ error: true/);
  assert.doesNotMatch(source, /throw error/);
});

test('Player Hub 4B exposes age number position and squad group without season-stat fabrication', () => {
  const start = app.indexOf('function playerSquadProfileHtml');
  const end = app.indexOf('async function loadPlayerSquadProfile', start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  for (const label of ['Возраст','Номер','Позиция','Группа состава']) {
    assert.ok(source.includes(label), `missing profile field: ${label}`);
  }
  assert.match(source, /не создаёт отдельный запрос на сезонную статистику игрока/);
  assert.doesNotMatch(source, /матчи сезона|голы сезона|ассисты сезона/);
});

test('Player Hub 4B has responsive profile context and launch12 revision', () => {
  assert.match(styles, /Player Hub 4B — profile context/);
  assert.match(styles, /\.player-hub-profile-grid\s*\{/);
  assert.match(html, /frontend-asset-revision" content="6\.120\.0-launch14"/);
  assert.doesNotMatch(html, /6\.120\.0-launch11/);
});
