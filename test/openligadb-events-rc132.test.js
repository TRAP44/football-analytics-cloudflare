import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOpenLigaMatchEvents,
  openLigaMatchDataUrls,
} from '../src/providers/openligadb.js';

test('RC132 builds keyless OpenLigaDB match-data URLs only for supported competitions', () => {
  assert.deepEqual(openLigaMatchDataUrls(78, 2026), [{
    shortcut: 'bl1',
    url: 'https://api.openligadb.de/getmatchdata/bl1/2026',
  }]);
  assert.deepEqual(openLigaMatchDataUrls(39, 2026), []);
});

test('RC132 conservatively matches the same fixture and maps goals into the existing event contract', () => {
  const rows = [{
    matchID: 12345,
    matchDateTimeUTC: '2026-09-25T18:30:00Z',
    lastUpdateDateTime: '2026-09-25T19:14:00Z',
    team1: { teamName: 'FC Bayern München' },
    team2: { teamName: 'SV Werder Bremen' },
    goals: [
      { scoreTeam1: 1, scoreTeam2: 0, matchMinute: 12, goalGetterName: 'A. Striker', isPenalty: false, isOwnGoal: false },
      { scoreTeam1: 1, scoreTeam2: 1, matchMinute: 33, goalGetterName: 'B. Forward', isPenalty: true, isOwnGoal: false },
      { scoreTeam1: 2, scoreTeam2: 1, matchMinute: 71, goalGetterName: 'C. Defender', isPenalty: false, isOwnGoal: true },
    ],
  }];

  const result = normalizeOpenLigaMatchEvents(rows, {
    homeId: 157,
    awayId: 162,
    homeName: 'Bayern Munich',
    awayName: 'Werder Bremen',
    kickoffAt: '2026-09-25T18:30:00Z',
  });

  assert.equal(result.available, true);
  assert.equal(result.sourceMatchId, 12345);
  assert.equal(result.sourceMeta.provider, 'openligadb');
  assert.equal(result.events.length, 3);
  assert.deepEqual(result.events.map(x => [x.time.elapsed, x.team.id, x.type, x.detail]), [
    [12, 157, 'Goal', 'Normal Goal'],
    [33, 162, 'Goal', 'Penalty'],
    [71, 157, 'Goal', 'Own Goal'],
  ]);
});

test('RC132 rejects a different or time-distant fixture instead of guessing', () => {
  const rows = [{
    MatchID: 91,
    MatchDateTimeUTC: '2026-09-27T18:30:00Z',
    Team1: { TeamName: 'FC Bayern München' },
    Team2: { TeamName: 'SV Werder Bremen' },
    Goals: [{ ScoreTeam1: 1, ScoreTeam2: 0, MatchMinute: 5, GoalGetterName: 'Player' }],
  }];

  const distant = normalizeOpenLigaMatchEvents(rows, {
    homeId: 157,
    awayId: 162,
    homeName: 'Bayern Munich',
    awayName: 'Werder Bremen',
    kickoffAt: '2026-09-25T18:30:00Z',
  });
  assert.equal(distant.available, false);
  assert.equal(distant.reason, 'fixture_not_matched');

  const wrongTeams = normalizeOpenLigaMatchEvents(rows, {
    homeId: 42,
    awayId: 49,
    homeName: 'Arsenal',
    awayName: 'Chelsea',
    kickoffAt: '2026-09-27T18:30:00Z',
  });
  assert.equal(wrongTeams.available, false);
  assert.equal(wrongTeams.reason, 'fixture_not_matched');
});

test('RC132 drops goals when the scoring side cannot be inferred safely', () => {
  const rows = [{
    matchID: 5,
    matchDateTimeUTC: '2026-09-25T18:30:00Z',
    team1: { teamName: 'Bayern Munich' },
    team2: { teamName: 'Werder Bremen' },
    goals: [{ matchMinute: 10, goalGetterName: 'Unknown scorer' }],
  }];

  const result = normalizeOpenLigaMatchEvents(rows, {
    homeId: 157,
    awayId: 162,
    homeName: 'Bayern Munich',
    awayName: 'Werder Bremen',
    kickoffAt: '2026-09-25T18:30:00Z',
  });
  assert.equal(result.available, false);
  assert.equal(result.events.length, 0);
  assert.equal(result.reason, 'goals_not_available');
});
