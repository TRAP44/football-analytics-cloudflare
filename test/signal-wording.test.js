import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  NO_CLEAR_SIGNAL_LABEL,
  publicSignalLabel,
  withPublicSignalLabel,
} from '../src/signal-wording.js';

test('legacy betting label is shown as a neutral analytical label',()=>{
  assert.equal(NO_CLEAR_SIGNAL_LABEL,'Без уверенного вывода');
  assert.equal(publicSignalLabel('Пропустить ставку'),'Без уверенного вывода');
  assert.equal(publicSignalLabel('  пропустить   ставку '),'Без уверенного вывода');
  assert.equal(publicSignalLabel('П1 · хозяева'),'П1 · хозяева');
  assert.equal(publicSignalLabel(undefined),'');
});

test('cached analysis payloads get the neutral label without mutating the source',()=>{
  const cached={aiInstructor:{betSignal:{code:'skip',label:'Пропустить ставку',reason:'x'}},other:1};
  const out=withPublicSignalLabel(cached);
  assert.equal(out.aiInstructor.betSignal.label,'Без уверенного вывода');
  assert.equal(out.aiInstructor.betSignal.code,'skip');
  assert.equal(cached.aiInstructor.betSignal.label,'Пропустить ставку');
  const fresh={aiInstructor:{betSignal:{code:'home',label:'П1'}}};
  assert.equal(withPublicSignalLabel(fresh),fresh);
  assert.equal(withPublicSignalLabel(null),null);
});

test('user-facing code no longer tells people to bet or skip a bet',()=>{
  const files=[
    'src/analysis-runtime.js','src/analysis-context-runtime.js','src/telegram-bot-ui-runtime.js',
    'src/user-data-api-runtime.js','src/telegram-search-runtime.js','src/post-match-return-runtime.js',
    'public/app.js','public/index.html',
  ];
  for (const file of files) {
    const source=fs.readFileSync(file,'utf8');
    assert.doesNotMatch(source,/['`"]Пропустить ставку['`"]/,file);
    assert.doesNotMatch(source,/пропустить ставку\./i,file);
    assert.doesNotMatch(source,/искать ставку/i,file);
    assert.doesNotMatch(source,/🎯 Идея:/,file);
  }
  // History, search and post-match reads normalize labels stored before this change.
  assert.match(fs.readFileSync('src/user-data-api-runtime.js','utf8'),/publicSignalLabel\(safeText\(row\.ai_signal_label,160\)\)/);
  assert.match(fs.readFileSync('src/telegram-search-runtime.js','utf8'),/publicSignalLabel\(safeText\(source\.ai_signal_label,300\)\)/);
  // Бот после матча и в поиске показывает нейтральный вывод по коду сигнала, а не сохранённую метку.
  assert.match(fs.readFileSync('src/post-match-return-runtime.js','utf8'),/neutralSignalText\(history\.ai_signal_code/);
  assert.match(fs.readFileSync('src/telegram-search-runtime.js','utf8'),/neutralSignalText\(source\.ai_signal_code/);
  assert.match(fs.readFileSync('src/analysis-runtime.js','utf8'),/withPublicSignalLabel\(objectValue\(analysisResponsePayload/);
});

test('full history re-open and Telegram share cards also use the neutral label (Codex review)',()=>{
  const userData=fs.readFileSync('src/user-data-api-runtime.js','utf8');
  assert.match(userData,/return json\(withPublicSignalLabel\(analysisResponsePayload\(payload,\{cached:true,stale:!fresh,historyReadOnly:true/);
  const publisher=fs.readFileSync('src/publisher-runtime.js','utf8');
  assert.match(publisher,/telegramHtmlEscape\(neutralSignalText\(signal\.code/);
  assert.doesNotMatch(publisher,/signal\.label/);
  const tasks=fs.readFileSync('docs/ai-team/TASKS_RU.md','utf8');
  assert.doesNotMatch(tasks,/Задача 5 \(LLM\) без этого требует секрет/);
});
