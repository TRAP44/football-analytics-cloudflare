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
