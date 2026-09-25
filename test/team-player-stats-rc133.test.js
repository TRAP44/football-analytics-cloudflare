import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  footballDataScorersUrl,
  normalizeFootballDataTeamScorers,
} from '../src/providers/football-data.js';

test('RC133 football-data scorer URL is limited to supported competitions and bounded limits', () => {
  assert.equal(
    footballDataScorersUrl(39, 2026),
    'https://api.football-data.org/v4/competitions/PL/scorers?season=2026&limit=50',
  );
  assert.equal(
    footballDataScorersUrl(39, 2026, { limit: 500 }),
    'https://api.football-data.org/v4/competitions/PL/scorers?season=2026&limit=100',
  );
  assert.equal(footballDataScorersUrl(999999, 2026), '');
});

test('RC133 football-data scorer adapter keeps only the requested team and normalizes contributions', () => {
  const payload = {
    competition: { name: 'Premier League' },
    scorers: [
      {
        player: { id: 1, name: 'A. Forward', nationality: 'England', position: 'Centre-Forward' },
        team: { id: 64, name: 'Liverpool FC' },
        playedMatches: 8, goals: 6, assists: 2, penalties: 1,
      },
      {
        player: { id: 2, name: 'B. Forward', nationality: 'England', position: 'Forward' },
        team: { id: 57, name: 'Arsenal FC' },
        playedMatches: 8, goals: 7, assists: 1, penalties: 0,
      },
      {
        player: { id: 3, name: 'C. Winger', nationality: 'Egypt', position: 'Right Winger' },
        team: { id: 64, name: 'Liverpool' },
        playedMatches: 7, goals: 3, assists: 4, penalties: 0,
      },
    ],
  };

  const result = normalizeFootballDataTeamScorers(payload, {
    teamId: 40,
    teamName: 'Liverpool',
    leagueId: 39,
    leagueName: 'Premier League',
    season: 2026,
  });

  assert.equal(result.available, true);
  assert.equal(result.complete, false);
  assert.equal(result.partial, true);
  assert.equal(result.scope, 'competition-scorers');
  assert.deepEqual(result.players.map(x => x.name), ['A. Forward', 'C. Winger']);
  assert.deepEqual(result.players.map(x => [x.goals.total, x.goals.assists]), [[6, 2], [3, 4]]);
  assert.equal(result.sourceMeta.provider, 'football-data');
});

test('RC133 football-data scorer adapter does not match generic club-name collisions', () => {
  const payload = {
    scorers: [{
      player: { id: 9, name: 'Player' },
      team: { id: 10, name: 'Manchester City FC' },
      playedMatches: 5, goals: 4, assists: 0,
    }],
  };

  const result = normalizeFootballDataTeamScorers(payload, {
    teamId: 33,
    teamName: 'Manchester United',
    leagueId: 39,
    season: 2026,
  });

  assert.equal(result.available, false);
  assert.equal(result.players.length, 0);
});


const worker = fs.readFileSync('src/worker.js', 'utf8');

test('RC133 API-Football player stats preserve paging metadata and bound user-facing pagination', () => {
  assert.match(worker, /options\.responseType === 'envelope'/);
  assert.match(worker, /paging:\s*\{\s*current:/);
  assert.match(worker, /async function apiFootballTeamSeasonPlayers\(/);
  assert.match(worker, /const maxPages=Math\.max\(1,Math\.min\(3,Number\(context\.maxPages \|\| 3\)\)\)/);
  assert.match(worker, /if \(page>1 && !freeQuotaHealthy\(8,1\)\)/);
  assert.match(worker, /responseType:'envelope'/);
  assert.match(worker, /complete=currentPage>=totalPages/);
});

test('RC133 team intelligence keeps player stats fail-soft and cached separately by contract version', () => {
  assert.match(worker, /team:intelligence:\$\{teamId\}:\$\{leagueId\}:\$\{season\}:v2/);
  assert.match(worker, /playerStats=await resolveTeamSeasonPlayers/);
  assert.match(worker, /reason:'all_player_sources_unavailable'/);
  assert.match(worker, /footballDataTeamScorersProvider/);
  assert.match(worker, /sourceMeta:sourceMeta\(\{[\s\S]{0,220}provider:'football-data'[\s\S]{0,220}fallback:true/);
});

test('RC133 normalizes useful season fields without inventing missing data', () => {
  assert.match(worker, /appearances:playerStatNumber\(stats\?\.games\?\.appearences\)/);
  assert.match(worker, /rating:playerStatNullable\(stats\?\.games\?\.rating\)/);
  assert.match(worker, /assists:playerStatNumber\(stats\?\.goals\?\.assists\)/);
  assert.match(worker, /accuracy:playerStatNullable\(stats\?\.passes\?\.accuracy\)/);
  assert.match(worker, /yellowRed:playerStatNumber\(stats\?\.cards\?\.yellowred\)/);
  assert.doesNotMatch(worker, /playerImpactScore|playerQualityScore/);
});


const app = fs.readFileSync('public/app.js', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');

test('RC133 Team Intelligence renders player season data without extra frontend requests', () => {
  assert.match(app, /function teamPlayerSeasonStatsHtml\(data = \{\}\)/);
  assert.match(app, /👤 Игроки сезона/);
  assert.match(app, /Сортировка: голы, ассисты, матчи, минуты — без искусственного рейтинга/);
  assert.match(app, /playerStatsHtml=teamPlayerSeasonStatsHtml\(data\)/);
  const start=app.indexOf('function teamPlayerSeasonStatsHtml');
  const end=app.indexOf('function renderTeamIntelligence', start);
  const helper=app.slice(start,end);
  assert.doesNotMatch(helper, /\bapi\s*\(/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
});

test('RC133 player stats UI makes partial provider coverage explicit', () => {
  assert.match(app, /Резервный источник: показаны только игроки команды, присутствующие в таблице бомбардиров турнира/);
  assert.match(app, /Частичная выборка/);
  assert.match(app, /травмирован/);
  assert.match(styles, /\.player-season-table\{display:grid/);
  assert.match(styles, /overflow-x:auto/);
  assert.match(styles, /@media\(max-width:560px\)[\s\S]*\.player-season-head/);
});


test('RC133 feature remains part of the RC136 release health contract', () => {
  assert.match(worker, /teamPlayerSeasonStats: 'enabled'/);
  assert.match(worker, /footballDataScorersFallback: cfg\.footballDataToken \? 'enabled' : 'available_when_configured'/);
  assert.match(worker, /const APP_VERSION = '6\.119\.0-rc143'/);
  assert.match(worker, /const RC_NAME = 'RC144'/);
  assert.match(app, /const CLIENT_VERSION = '6\.119\.0-rc143'/);
});


test('RC133 comparison reuses the v2 Team Intelligence cache contract', () => {
  assert.match(worker, /getStaleCache\(\`team:intelligence:\$\{Number\(teamId\)\}:\$\{Number\(leagueId\)\}:\$\{Number\(season\)\}:v2\`/);
  assert.doesNotMatch(worker, /team:intelligence:\$\{Number\(teamId\)\}:\$\{Number\(leagueId\)\}:\$\{Number\(season\)\}:v1/);
});
