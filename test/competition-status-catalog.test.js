import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPETITIONS,
  isFinishedStatus,
  isLiveStatus,
  matchStatusRank,
  normalizeCompetition,
  normalizeRoundLabel,
  statusLabel,
} from '../src/competition-status-catalog.js';

test('known competition catalog preserves elite league metadata', () => {
  const premierLeague = normalizeCompetition(39, 'Premier League', 'England');
  assert.equal(COMPETITIONS.get(39)?.short, 'АПЛ');
  assert.equal(premierLeague.name, 'Премьер-лига');
  assert.equal(premierLeague.group, 'england');
  assert.equal(premierLeague.tier, 'elite');
  assert.equal(premierLeague.priority, 100);
  assert.equal(premierLeague.featured, true);
});

test('competition classification keeps youth and friendly safeguards', () => {
  const youth = normalizeCompetition(0, 'U19 League', 'England', 'Academy U19', 'Reserve U19');
  assert.equal(youth.category, 'youth');
  assert.equal(youth.tier, 'basic');
  assert.equal(youth.priority, 8);
  assert.equal(youth.featured, false);

  const friendly = normalizeCompetition(0, 'Club Friendly', 'World');
  assert.equal(friendly.category, 'friendly');
  assert.equal(friendly.tier, 'basic');
  assert.equal(friendly.featured, false);
});

test('status catalog preserves live and finished semantics', () => {
  assert.equal(isLiveStatus('1H'), true);
  assert.equal(isLiveStatus('live'), true);
  assert.equal(isLiveStatus('FT'), false);
  assert.equal(isFinishedStatus('AET'), true);
  assert.equal(isFinishedStatus('NS'), false);
  assert.equal(statusLabel('2H', 67), '2-й тайм · 67′');
  assert.equal(statusLabel('FT'), 'Завершён');
  assert.equal(matchStatusRank('HT'), 0);
  assert.equal(matchStatusRank('NS'), 1);
  assert.equal(matchStatusRank('PEN'), 2);
});

test('round labels preserve localized catalog behavior', () => {
  assert.equal(normalizeRoundLabel('Regular Season - 12'), 'Тур 12');
  assert.equal(normalizeRoundLabel('Round of 16'), '1/8 финала');
  assert.equal(normalizeRoundLabel('Quarter-finals'), '1/4 финала');
  assert.equal(normalizeRoundLabel('Final'), 'Финал');
});
