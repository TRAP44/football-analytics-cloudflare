import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_14.sql','utf8');

test('analysis history persists compact AI verdict fields',()=>{
  assert.match(worker,/ai_signal_code/);
  assert.match(worker,/ai_signal_label/);
  assert.match(worker,/ai_confidence/);
  assert.match(worker,/ai_outcome/);
  assert.match(migration,/alter table public\.analysis_history/);
});

test('analyzed upcoming matches expose a compact saved verdict',()=>{
  assert.match(app,/function analysisHistoryForFixture/);
  assert.match(app,/data-history-analysis/);
  assert.match(app,/Открыть AI-разбор/);
});

test('AI center summarizes analyzed upcoming matches',()=>{
  assert.match(html,/id="aiCenterSummary"/);
  assert.match(app,/function renderAiCenterSummary/);
  assert.match(app,/высокий риск/);
  assert.match(app,/Повторное открытие не тратит новый анализ/);
});

test('history re-open uses the active v15 availability-quality analysis cache',()=>{
  assert.match(worker,/const cacheKey = `fixture:\$\{fixtureId\}:v15-availability-quality-rc144`/);
  assert.match(worker,/historyAnalysisCacheFix:\s*'enabled'/);
});

test('telegram bot exposes last saved verdict',()=>{
  assert.match(worker,/🕘 Последний разбор/);
  assert.match(worker,/function lastAiVerdictText/);
  assert.match(worker,/sendLastAiVerdict/);
  assert.match(app,/view === 'history'/);
});
