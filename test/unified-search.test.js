import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');

test('search exposes teams, leagues, upcoming and finished modes', () => {
  for (const mode of ['all','teams','competitions','upcoming','finished']) {
    assert.match(html, new RegExp(`data-search-mode="${mode}"`));
  }
  assert.match(html, />Команды</);
  assert.match(html, />Лиги</);
  assert.match(html, />Предстоящие</);
  assert.match(html, />Завершённые</);
  assert.match(app, /function setGlobalSearchMode\(/);
  assert.match(app, /remoteMatches/);
  assert.match(app, /matchSourceTeam/);
});

test('search enriches league queries with cached upcoming and finished fixtures', () => {
  assert.match(worker, /async function loadSearchCompetitionMatches\(/);
  assert.match(worker, /apiFootball\('\/fixtures', \{ league: leagueId, season, from, to \}/);
  assert.match(worker, /preferCompetitionSearch\(/);
  assert.match(app, /data\.matches \|\| \[\]/);
  assert.match(app, /data\.matchSource\?\.name/);
});

test('search enriches a team query with recent and upcoming fixtures', () => {
  assert.match(app, /\/api\/team\?teamId=/);
  assert.match(app, /\.\.\.\(hub\.upcoming \|\| \[\]\)/);
  assert.match(app, /\.\.\.\(hub\.recent \|\| \[\]\)/);
  assert.match(app, /Предстоящие матчи/);
  assert.match(app, /Завершённые матчи/);
});

test('search match results have direct actions without running analysis automatically', () => {
  assert.match(app, /data-search-fixture/);
  assert.match(app, /data-search-center/);
  assert.match(app, /Преданализ/);
  assert.match(app, /Центр матча/);
  assert.match(app, /Итоги/);
  assert.match(styles, /\.search-match-card/);
});

test('server manifest advertises unified search capabilities', () => {
  assert.match(worker, /unifiedSearch:\s*true/);
  assert.match(worker, /searchMatchHistory:\s*true/);
  assert.match(worker, /searchLeagueFixtures:\s*true/);
});
