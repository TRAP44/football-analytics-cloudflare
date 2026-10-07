import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeOpenLigaMatchEvents,
  openLigaMatchDataUrls,
} from '../src/providers/openligadb.js';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const teamTournament = fs.readFileSync('src/team-tournament-runtime.js', 'utf8');
const matchCenter = fs.readFileSync('src/match-center-runtime.js', 'utf8');

function context(overrides={}) {
  return {
    homeId:157,
    awayId:162,
    homeName:'Bayern Munich',
    awayName:'Werder Bremen',
    kickoffAt:'2026-09-25T18:30:00Z',
    ...overrides,
  };
}

function match(overrides={}) {
  return {
    matchID:12345,
    matchDateTimeUTC:'2026-09-25T18:30:00Z',
    lastUpdateDateTime:'2026-09-25T19:14:00Z',
    team1:{teamName:'FC Bayern München'},
    team2:{teamName:'SV Werder Bremen'},
    goals:[],
    ...overrides,
  };
}

test('RC132 builds keyless OpenLigaDB match-data URLs only for strict supported competition ids', () => {
  assert.deepEqual(openLigaMatchDataUrls(78, 2026), [{
    shortcut:'bl1',
    teamFilter:'',
    url:'https://api.openligadb.de/getmatchdata/bl1/2026',
  }]);
  assert.deepEqual(openLigaMatchDataUrls('78', '2026', 'Bayern Munich'), [{
    shortcut:'bl1',
    teamFilter:'bayern',
    url:'https://api.openligadb.de/getmatchdata/bl1/2026/bayern',
  }]);
  assert.deepEqual(openLigaMatchDataUrls(39, 2026), []);
  assert.deepEqual(openLigaMatchDataUrls([78], 2026), []);
  assert.deepEqual(openLigaMatchDataUrls(true, 2026), []);
  assert.deepEqual(openLigaMatchDataUrls(78, [2026]), []);
});

test('RC132 conservatively matches the same fixture and maps sequential goals into the existing event contract', () => {
  const rows=[match({
    goals:[
      {scoreTeam1:1,scoreTeam2:0,matchMinute:12,goalGetterName:'A. Striker',isPenalty:false,isOwnGoal:false},
      {scoreTeam1:1,scoreTeam2:1,matchMinute:33,goalGetterName:'B. Forward',isPenalty:true,isOwnGoal:false},
      {scoreTeam1:2,scoreTeam2:1,matchMinute:71,goalGetterName:'C. Defender',isPenalty:false,isOwnGoal:true},
    ],
  })];

  const result=normalizeOpenLigaMatchEvents(rows,context());

  assert.equal(result.available,true);
  assert.equal(result.sourceMatchId,12345);
  assert.equal(result.sourceMeta.provider,'openligadb');
  assert.equal(result.events.length,3);
  assert.deepEqual(result.events.map(x=>[x.time.elapsed,x.team.id,x.type,x.detail]),[
    [12,157,'Goal','Normal Goal'],
    [33,162,'Goal','Penalty'],
    [71,157,'Goal','Own Goal'],
  ]);
});

test('RC132 rejects a different or time-distant fixture instead of guessing', () => {
  const rows=[{
    MatchID:91,
    MatchDateTimeUTC:'2026-09-27T18:30:00Z',
    Team1:{TeamName:'FC Bayern München'},
    Team2:{TeamName:'SV Werder Bremen'},
    Goals:[{ScoreTeam1:1,ScoreTeam2:0,MatchMinute:5,GoalGetterName:'Player'}],
  }];

  const distant=normalizeOpenLigaMatchEvents(rows,context({
    kickoffAt:'2026-09-25T18:30:00Z',
  }));
  assert.equal(distant.available,false);
  assert.equal(distant.reason,'fixture_not_matched');

  const wrongTeams=normalizeOpenLigaMatchEvents(rows,context({
    homeId:42,
    awayId:49,
    homeName:'Arsenal',
    awayName:'Chelsea',
    kickoffAt:'2026-09-27T18:30:00Z',
  }));
  assert.equal(wrongTeams.available,false);
  assert.equal(wrongTeams.reason,'fixture_not_matched');

  const genericNameTrap=normalizeOpenLigaMatchEvents([{
    matchID:92,
    matchDateTimeUTC:'2026-09-27T18:30:00Z',
    team1:{teamName:'Manchester City'},
    team2:{teamName:'Liverpool'},
    goals:[{scoreTeam1:1,scoreTeam2:0,matchMinute:5,goalGetterName:'Player'}],
  }],context({
    homeId:33,
    awayId:40,
    homeName:'Manchester United',
    awayName:'Liverpool',
    kickoffAt:'2026-09-27T18:30:00Z',
  }));
  assert.equal(genericNameTrap.available,false);
  assert.equal(genericNameTrap.reason,'fixture_not_matched');
});

test('RC132 fails closed when fixture kickoff or team identity context is missing or malformed', () => {
  const rows=[match({
    matchID:93,
    matchDateTimeUTC:'2026-09-27T18:30:00Z',
    goals:[{scoreTeam1:1,scoreTeam2:0,matchMinute:5,goalGetterName:'Player'}],
  })];

  for (const kickoffAt of ['', 'not-a-date', {toString:()=> '2026-09-27T18:30:00Z'}]) {
    const result=normalizeOpenLigaMatchEvents(rows,context({kickoffAt}));
    assert.equal(result.available,false);
    assert.equal(result.reason,'fixture_not_matched');
  }

  for (const ids of [
    {homeId:true,awayId:162},
    {homeId:[157],awayId:162},
    {homeId:157,awayId:157},
  ]) {
    const result=normalizeOpenLigaMatchEvents(rows,context({
      ...ids,
      kickoffAt:'2026-09-27T18:30:00Z',
    }));
    assert.equal(result.available,false);
    assert.equal(result.reason,'fixture_context_invalid');
  }
});

test('RC132 does not coerce malformed score or minute values into synthetic goals', () => {
  const malformedScore=normalizeOpenLigaMatchEvents([match({
    goals:[{scoreTeam1:[1],scoreTeam2:0,matchMinute:10,goalGetterName:'Bad score'}],
  })],context());
  assert.equal(malformedScore.available,false);
  assert.equal(malformedScore.reason,'goals_not_available');

  const malformedMinute=normalizeOpenLigaMatchEvents([match({
    goals:[{scoreTeam1:1,scoreTeam2:0,matchMinute:true,goalGetterName:'Bad minute'}],
  })],context());
  assert.equal(malformedMinute.available,false);
  assert.equal(malformedMinute.reason,'goals_not_available');

  const scoreJump=normalizeOpenLigaMatchEvents([match({
    goals:[{scoreTeam1:2,scoreTeam2:0,matchMinute:10,goalGetterName:'Missing prior goal'}],
  })],context());
  assert.equal(scoreJump.available,false);
  assert.equal(scoreJump.reason,'goals_not_available');
});

test('RC132 interprets explicit false flags as false instead of JavaScript truthiness', () => {
  const result=normalizeOpenLigaMatchEvents([match({
    goals:[{
      scoreTeam1:1,
      scoreTeam2:0,
      matchMinute:10,
      goalGetterName:'Player',
      isPenalty:'false',
      isOwnGoal:'false',
    }],
  })],context());

  assert.equal(result.available,true);
  assert.equal(result.events[0].detail,'Normal Goal');
});

test('RC132 drops goals when the scoring side cannot be inferred safely', () => {
  const result=normalizeOpenLigaMatchEvents([match({
    matchID:5,
    goals:[{matchMinute:10,goalGetterName:'Unknown scorer'}],
  })],context());

  assert.equal(result.available,false);
  assert.equal(result.events.length,0);
  assert.equal(result.reason,'goals_not_available');
});

test('RC132 Match Center keeps API-Football primary and calls the modular OpenLigaDB fallback only after empty events', () => {
  assert.match(teamTournament,/async function secondaryOpenLigaEvents\(/);
  assert.match(teamTournament,/openLigaMatchDataUrls\(leagueId \|\| 0, season, homeName\)/);
  assert.match(teamTournament,/claimSecondaryProviderBudget\(cfg, 'openligadb', 50\)/);
  assert.match(teamTournament,/secondary-events:\$\{fixtureId\}:openligadb:v2/);
  assert.doesNotMatch(teamTournament,/secondary-events:\$\{fixtureId\}:openligadb:v1/);

  assert.match(matchCenter,/if \(!events\.length && !limitedCoverage\) \{/);
  assert.match(matchCenter,/optionalAsync\(secondaryOpenLigaEvents,fixture,cfg,eventContext\)/);
  assert.match(matchCenter,/if \(secondaryEvents\?\.available===true\) \{/);
  assert.match(matchCenter,/fallbackProvider:'openligadb'/);

  assert.match(worker,/const secondaryOpenLigaEvents = \(\.\.\.args\) => getTeamTournamentRuntime\(\)\.secondaryOpenLigaEvents\(\.\.\.args\);/);
  assert.match(worker,/createMatchCenterRuntime\(\{[\s\S]*?secondaryOpenLigaEvents,[\s\S]*?\}\);/);
});

test('RC132 fallback does not impersonate unsupported event types or expanded datasets', () => {
  const helperStart=teamTournament.indexOf('async function secondaryOpenLigaEvents');
  const helperEnd=teamTournament.indexOf('async function footballDataStandingsProvider',helperStart);
  const helper=teamTournament.slice(helperStart,helperEnd);
  assert.ok(helperStart>0 && helperEnd>helperStart);
  assert.doesNotMatch(helper,/fixtures\/statistics|fixtures\/players|fixtures\/lineups|\/injuries/);
  assert.match(helper,/normalizeOpenLigaMatchEvents/);
});
