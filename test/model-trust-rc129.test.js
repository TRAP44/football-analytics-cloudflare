import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  providerTeamNameKey,
  resolveStandingTeamRow,
} from '../src/entity-reconciliation.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC129 reconciles provider team names conservatively',()=>{
  assert.equal(providerTeamNameKey('FC Bayern München'),'bayern munich');
  assert.equal(providerTeamNameKey('Bayern Munich'),'bayern munich');
  const rows=[
    {team:{id:0,providerId:1,name:'FC Bayern München'},rank:1},
    {team:{id:0,providerId:2,name:'Borussia Dortmund'},rank:2},
  ];
  const resolved=resolveStandingTeamRow(rows,{teamId:157,teamName:'Bayern Munich'});
  assert.equal(resolved.matchedBy,'normalized_name');
  assert.equal(resolved.row.rank,1);
});

test('RC129 canonical API-Football team id wins before provider-name reconciliation',()=>{
  const rows=[
    {team:{id:55,name:'Different Label'},rank:3},
    {team:{id:0,name:'Different Label'},rank:9},
  ];
  const resolved=resolveStandingTeamRow(rows,{teamId:55,teamName:'Different Label'});
  assert.equal(resolved.matchedBy,'canonical_id');
  assert.equal(resolved.row.rank,3);
});

test('RC129 refuses ambiguous provider-name matches',()=>{
  const rows=[
    {team:{id:0,name:'Example FC'},rank:1},
    {team:{id:0,name:'Example Club'},rank:2},
  ];
  const resolved=resolveStandingTeamRow(rows,{teamName:'Example'});
  assert.equal(resolved.row,null);
});

test('RC129 unvalidated absence counts no longer shift outcome probabilities',()=>{
  assert.doesNotMatch(worker,/function applyAbsenceAdjustment/);
  assert.match(worker,/function absenceContextPolicy/);
  assert.match(worker,/probabilityShiftApplied:false/);
  assert.match(worker,/const rawProbabilities = baselineBlend\.probabilities/);
  assert.match(worker,/const weightedProbabilities = blended\.probabilities/);
  assert.match(worker,/не сдвигают проценты напрямую без валидированной оценки значимости/);
});

test('RC129 exposes explicit model methodology and calibration diagnostics',()=>{
  assert.match(worker,/modelMethodology:\s*\{/);
  assert.match(worker,/version:'rc129-trust-v1'/);
  assert.match(worker,/effectiveWeights:\{ \.\.\.blended\.weights \}/);
  assert.match(worker,/absencePolicy/);
  assert.match(worker,/modelMethodologyTransparency: 'enabled'/);
  assert.match(worker,/crossProviderStandingReconciliation: 'enabled'/);
  assert.match(worker,/unvalidatedAbsenceProbabilityShift: 'disabled'/);
  assert.match(app,/function modelMethodologyHtml/);
  assert.match(app,/Как рассчитаны проценты/);
  assert.match(app,/только риск \/ уверенность/);
});
