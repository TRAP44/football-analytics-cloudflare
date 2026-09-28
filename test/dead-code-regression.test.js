import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('obsolete superseded Worker helpers stay removed',()=>{
  for(const name of ["botMatchAction","combineProbabilities","digestAppUrl","incrementUsage","newsSourceKeyboard","patchReminder"]){
    assert.doesNotMatch(worker,new RegExp('\\bfunction\\s+'+name+'\\s*\\('),name);
  }
  for(const name of ['NEWS_IMPACT_ACTION_WINDOW_MS','NEWS_IMPACT_OUTCOME_WINDOW_MS','NEWS_IMPACT_RECOVERY_WINDOW_MS']){
    assert.doesNotMatch(worker,new RegExp('\\b'+name+'\\b'),name);
  }
});

test('obsolete superseded Mini App helpers stay removed',()=>{
  for(const name of ["absenceList","coverageLabel","discoveryCompetitionCard","interestLabel","liveStatsHtml","playerLeadersHtml","prematchUncertaintyClass","betaHealthLabel","betaActionLabel","betaMetricLabel","categoryClass","competitionGroups","matchAiSnapshotHtml","statValue","analysisSourceStatus"]){
    assert.doesNotMatch(app,new RegExp('\\bfunction\\s+'+name+'\\s*\\('),name);
  }
  assert.doesNotMatch(app,/\bMINIAPP_PRODUCT_MODE\b/);
});
