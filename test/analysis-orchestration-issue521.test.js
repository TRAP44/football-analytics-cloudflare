import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisOrchestrationModule } from '../public/modules/analysis-orchestration.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('analysis orchestration module exposes extracted contract',()=>{
  assert.equal(typeof createAnalysisOrchestrationModule,'function');
  const module=createAnalysisOrchestrationModule({});
  for(const name of [
    'syncAnalysisBusyUi',
    'analyzeMatch',
    'historyItemFromAnalysis',
    'rememberHistoryAnalysis',
    'loadAiTrackRecord',
    'ensureAiTrackRecordRenderer',
    'renderAiTrackRecord',
    'loadHistory',
    'openHistoryAnalysis',
    'ensureHistoryRenderer',
    'renderHistory',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes analysis orchestration instead of keeping it inline',()=>{
  assert.match(app,/import \{ createAnalysisOrchestrationModule \} from '\.\/modules\/analysis-orchestration\.js'/);
  assert.match(app,/createAnalysisOrchestrationModule\(\{/);
  assert.doesNotMatch(app,/function syncAnalysisBusyUi\(\) \{/);
  assert.doesNotMatch(app,/async function analyzeMatch\(fixtureId, btn, options = \{\}\) \{/);
  assert.doesNotMatch(app,/async function loadHistory\(showLoader = true\) \{/);
});
