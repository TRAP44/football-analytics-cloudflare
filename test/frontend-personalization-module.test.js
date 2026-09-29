import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizedSignalText,
  buildPersonalContextSignals,
  buildPersonalMatchInsight,
  pickHomePersonalMatch,
} from '../public/modules/personalization.js';

test('personalization context normalizes favorites and recent viewing history', () => {
  const signals = buildPersonalContextSignals(
    [{ teamId: 10 }, { team_id: 20 }],
    [
      { homeName: ' Arsenal ', awayName: 'Chelsea', leagueName: ' Premier League ' },
      { homeName: 'ARSENAL', awayName: 'Liverpool', leagueName: 'Premier League' },
    ],
  );

  assert.equal(normalizedSignalText(' Arsenal '), 'arsenal');
  assert.deepEqual([...signals.favoriteTeams], [10, 20]);
  assert.equal(signals.viewedTeams.has('arsenal'), true);
  assert.equal(signals.viewedTeams.has('chelsea'), true);
  assert.equal(signals.viewedLeagues.has('premier league'), true);
  assert.equal(signals.hasPersonalData, true);
});

test('favorite and viewed-team signals preserve the existing match ranking semantics', () => {
  const signals = buildPersonalContextSignals(
    [{ teamId: 10 }],
    [{ homeName: 'Viewed FC', awayName: 'Other', leagueName: 'League' }],
  );

  const favorite = buildPersonalMatchInsight({
    home: { id: 10, name: 'Favorite FC' },
    away: { id: 30, name: 'Away' },
    interestScore: 30,
    competition: { priority: 2 },
  }, signals);

  const viewed = buildPersonalMatchInsight({
    home: { id: 40, name: 'Viewed FC' },
    away: { id: 50, name: 'Away' },
    interestScore: 30,
    competition: { priority: 2 },
  }, signals);

  assert.equal(favorite.favorite, true);
  assert.equal(favorite.reason, 'Любимая команда');
  assert.equal(favorite.recommended, true);
  assert.equal(viewed.viewedTeam, true);
  assert.equal(viewed.reason, 'Вы смотрели эту команду');
  assert.ok(favorite.score > viewed.score);
});

test('home personalization prefers live relevant match then strongest relevant score', () => {
  const signals = buildPersonalContextSignals([{ teamId: 10 }], []);
  const rows = [
    {
      fixtureId: 1,
      home: { id: 10, name: 'Favorite FC' },
      away: { id: 20, name: 'Away' },
      date: '2026-10-01T20:00:00Z',
      interestScore: 90,
      competition: { priority: 5 },
    },
    {
      fixtureId: 2,
      home: { id: 10, name: 'Favorite FC' },
      away: { id: 30, name: 'Live Away' },
      date: '2026-09-30T20:00:00Z',
      live: true,
      interestScore: 20,
      competition: { priority: 1 },
    },
  ];

  assert.equal(pickHomePersonalMatch(rows, signals, Date.parse('2026-09-30T18:00:00Z'))?.match?.fixtureId, 2);
});

test('personalization module stays pure and zero-request', () => {
  const source = readFileSync(new URL('../public/modules/personalization.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bapi\s*\(/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test('public app delegates personalization instead of duplicating scoring implementation', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /from '\.\/modules\/personalization\.js'/);
  assert.match(app, /return buildPersonalContextSignals\(state\.favorites, state\.history\)/);
  assert.match(app, /return buildPersonalMatchInsight\(match, signals\)/);
  assert.match(app, /return pickHomePersonalMatch\(state\.matches, signals, nowMs\)/);
  assert.doesNotMatch(app, /score \+= 150/);
});
