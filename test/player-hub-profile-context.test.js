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
  assert.match(html, /frontend-asset-revision" content="6\.120\.0-launch\d+"/);
  assert.doesNotMatch(html, /6\.120\.0-launch11/);
});



test('Player Hub squad matching uses player ID before fallback to normalized name',()=>{
  const start=app.indexOf('function playerSquadProfile(');
  const end=app.indexOf('function playerSquadProfileHtml',start);
  assert.ok(start>=0 && end>start);
  const code=app.slice(start,end);
  assert.match(code,/const targetId = Number\(player\?\.data\?\.id \|\| 0\)/);
  assert.match(code,/const sameId = targetId > 0 && Number\(item\?\.id \|\| 0\) === targetId/);
  assert.match(code,/const sameName = !targetId && targetName && String\(item\?\.name \|\| ''\)\.trim\(\)\.toLowerCase\(\) === targetName/);
  assert.match(code,/if \(sameId \|\| sameName\) return/);
  assert.match(code,/return \{ found: false, stale:/);
});

test('Player Hub discards outdated cached or network squad responses after a player change',()=>{
  const start=app.indexOf('async function loadPlayerSquadProfile');
  const end=app.indexOf('function playerSeasonStatProfile',start);
  assert.ok(start>=0 && end>start);
  const code=app.slice(start,end);
  assert.match(code,/state\.teamSquadCache\.get\(key\)/);
  assert.match(code,/if \(!data\) \{[\s\S]*await api\(/);
  assert.match(code,/state\.teamSquadCache\.set\(key, data\)/);
  assert.equal((code.match(/if \(state\.currentPlayer !== player\) return;/g)||[]).length,2);
  assert.match(code,/player\.squadProfile = playerSquadProfile\(data, player\)/);
  assert.match(code,/player\.squadProfile = \{ error: true,/);
});

test('Player Hub escapes cached group, position and stale-warning text before rendering',()=>{
  const start=app.indexOf('function playerSquadProfileHtml');
  const end=app.indexOf('async function loadPlayerSquadProfile',start);
  assert.ok(start>=0 && end>start);
  const code=app.slice(start,end);
  assert.match(code,/escapeHtml\(profile\.warning \|\| 'Показан сохранённый состав команды\.'\)/);
  assert.match(code,/escapeHtml\(playerPositionLabel\(profile\.position\)\)/);
  assert.match(code,/escapeHtml\(profile\.group \|\| '—'\)/);
  assert.match(code,/profile\.age \?\? '—'/);
  assert.doesNotMatch(code,/\bfetch\s*\(|\bapi\s*\(/);
});

test('Player Hub tolerates missing, loading and failed squad enrichment without dropping match data',()=>{
  const start=app.indexOf('function playerSquadProfileHtml');
  const end=app.indexOf('function playerSeasonStatProfile',start);
  const code=app.slice(start,end);
  assert.match(code,/Профиль состава временно недоступен\. Данные текущего матча остаются актуальными/);
  assert.match(code,/Игрок не найден в текущем составе команды/);
  assert.match(code,/Сверяю с составом команды/);
  assert.match(code,/player\.squadProfile = \{ loading: true \}/);
  assert.doesNotMatch(code,/throw error|state\.currentCenter\s*=\s*null|state\.currentPlayer\s*=\s*null/);
});
