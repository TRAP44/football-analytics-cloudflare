import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('P0 capped public feed ranks competition relevance before LIVE status',()=>{
  const rank=block(worker,'function catalogRank','function matchStatusRank');
  assert.doesNotMatch(rank,/if \(match\?\.live\)/);
  assert.match(rank,/featured.*return 0/s);

  const matches=block(worker,'async function apiMatches','function normalizeStandingRow');
  const sortIndex=matches.indexOf('catalogRank(a) - catalogRank(b)');
  const statusIndex=matches.indexOf('matchStatusRank(a.status) - matchStatusRank(b.status)');
  assert.ok(sortIndex >= 0 && statusIndex > sortIndex,'status must only break relevance ties');
  assert.match(matches,/providerBudgetProfile\(\)\.paid \? 1 : 3/);
});

test('P0 All and For You do not inherit unconditional LIVE-first sorting',()=>{
  const filtered=block(app,'function filteredMatches','function categoryLabel');
  assert.match(filtered,/state\.filter === 'live' && Boolean\(a\.live\) !== Boolean\(b\.live\)/);
  assert.doesNotMatch(filtered,/^\s*if \(Boolean\(a\.live\) !== Boolean\(b\.live\)\)/m);
  assert.match(filtered,/state\.filter === 'live'\) byFilter = Boolean\(m\.live\)/);
});

test('P0 FREE Match Center preserves provider minute budget for AI',()=>{
  const policy=block(worker,'function providerFeaturePolicy','function featureCacheAgeSeconds');
  assert.match(policy,/context\.preserveAiBudget === true && feature === 'events'/);
  assert.match(policy,/reason = 'interactive_ai_reserve'/);

  const center=block(worker,'async function apiMatchCenter','async function cachedTeamIntelligenceForAnalysis');
  assert.match(center,/preserveAiBudget: !providerBudgetProfile\(\)\.paid/);
  assert.match(center,/secondaryOpenLigaEvents/);
  assert.match(center,/feature: 'statistics', path: '\/fixtures\/statistics'/);
});

test('P0 AI optional availability data fails soft instead of dereferencing null',()=>{
  const analyze=block(worker,'async function apiAnalyze','async function publicServiceStatus');
  assert.match(analyze,/const normalizedAbsences = formatAbsences/);
  assert.match(analyze,/normalizedAbsences && Array\.isArray\(normalizedAbsences\.home\) && Array\.isArray\(normalizedAbsences\.away\)/);
  assert.match(analyze,/methodology: 'Данные о потерях недоступны; анализ продолжен без этого сигнала\.'/);
  assert.match(analyze,/blendProbabilitySignals\(\{ market:analysisMarket, model: apiPrediction/);
});
