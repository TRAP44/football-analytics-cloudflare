import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const reminderList = fs.readFileSync('public/modules/reminder-list.js', 'utf8');
const favoriteTeamsRenderer = fs.readFileSync('public/modules/favorite-teams-renderer.js', 'utf8');

test('team hub, squad and intelligence ignore responses for a team that is no longer active', () => {
  assert.match(app, /teamHubRequestSeq:\s*0/);
  assert.match(app, /teamIntelligenceRequestSeq:\s*0/);
  assert.match(app, /teamSquadRequestSeq:\s*0/);
  assert.match(app, /seq!==state\.teamHubRequestSeq/);
  assert.match(app, /seq!==state\.teamIntelligenceRequestSeq/);
  assert.match(app, /seq!==state\.teamSquadRequestSeq/);
  assert.match(app, /String\(Number\(state\.currentTeam\?\.id\|\|0\)\)!==key/);
});

test('tournament table ignores a response from a previously opened tournament', () => {
  assert.match(app, /tournamentStandingsRequestSeq:\s*0/);
  assert.match(app, /const seq = \+\+state\.tournamentStandingsRequestSeq/);
  assert.match(app, /key !== tournamentKey\(state\.currentTournament\)/);
});

test('team fixture tournament shortcut does not pass the click event as openTable=true', () => {
  assert.match(app, /addEventListener\('click', \(\) => openTournamentFromTeam\(false\)\)/);
  assert.doesNotMatch(app, /addEventListener\('click', openTournamentFromTeam\)/);
});

test('favorites and reminders distinguish loading, error, empty and stale data states', () => {
  assert.match(app, /favoritesLoading:\s*false/);
  assert.match(app, /favoritesLoadError:\s*''/);
  assert.match(app, /remindersLoading:\s*false/);
  assert.match(app, /remindersLoadError:\s*''/);
  assert.match(favoriteTeamsRenderer, /Загружаю избранное/);
  assert.match(favoriteTeamsRenderer, /Избранное временно недоступно/);
  assert.match(reminderList, /Загружаю напоминания/);
  assert.match(reminderList, /Напоминания временно недоступны/);
  assert.match(favoriteTeamsRenderer, /Показано последнее загруженное избранное/);
  assert.match(reminderList, /Показаны последние загруженные напоминания/);
});

test('RC27 health exposes async entity and personal-data safety contracts', () => {
  assert.match(worker, /entityNavigationSafety:\s*'enabled'/);
  assert.match(worker, /personalDataStateSafety:\s*'enabled'/);
  assert.match(worker, /asyncEntityGuard:\s*'enabled'/);
});
