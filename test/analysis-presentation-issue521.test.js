import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisPresentationModule } from '../public/modules/analysis-presentation.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('analysis presentation module exposes extracted contract',()=>{
  assert.equal(typeof createAnalysisPresentationModule,'function');
  const module=createAnalysisPresentationModule({});
  for(const name of [
    'pct',
    'formSequence',
    'likelyOutcomeDisplay',
    'formCard',
    'modelWeightsText',
    'bullets',
    'reminderFor',
    'hasReminder',
    'syncQuickReminderButton',
    'syncAllQuickReminderButtons',
    'syncReminderMutationUi',
    'toggleReminder',
    'clampPercent',
    'qualityInfo',
    'probabilityStrip',
    'compactAbsence',
    'lineupBlock',
    'shareAnalysis',
    'bindRovingTabKeyboard',
    'setAnalysisTab',
    'bindAnalysisTabs',
    'comparisonValue',
    'comparisonMetricRow',
    'comparisonAdvantages',
    'comparisonTeamHeader',
    'prematchOutcomeName',
    'prematchDriverCard',
    'prematchScenarioCard',
    'prematchSourceRow',
    'prematchBriefHtml',
    'providerCoverageHtml',
    'aiInstructorHtml',
    'openLaunchFixture',
    'applyLaunchIntent',
    'analysisFreshnessHtml',
    'kickoffHandoffHtml',
    'dataProvenanceHtml',
    'cockpitProviderLabel',
    'matchCockpitHtml',
    'analysisGlanceHtml',
    'renderAnalysis',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes analysis presentation instead of keeping it inline',()=>{
  assert.match(app,/import \{ createAnalysisPresentationModule \} from '\.\/modules\/analysis-presentation\.js'/);
  assert.match(app,/createAnalysisPresentationModule\(\{/);
  assert.doesNotMatch(app,/function pct\(v\) \{/);
  assert.doesNotMatch(app,/function prematchBriefHtml\(pm, match, probabilities\) \{/);
  assert.doesNotMatch(app,/function renderAnalysis\(d\) \{/);
});
