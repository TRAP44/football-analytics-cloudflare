import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC124 analysis explains provider feature coverage to users',()=>{
  assert.match(app,/function providerCoverageHtml\(reliability = \{\}\)/);
  for (const label of ['Травмы','Составы','Коэффициенты','Прогноз API','Очные встречи']) assert.ok(app.includes(label));
  assert.match(app,/providerCoverageHtml\(d\.providerReliability \|\| d\.dataPolicy\?\.reliability \|\| \{\}\)/);
});

test('RC124 distinguishes plan limits from empty and delayed provider data',()=>{
  assert.match(app,/plan_limited:\['!','Недоступно на текущем тарифе источника'\]/);
  assert.match(app,/empty_response:\['○','Источник вернул пустой ответ'\]/);
  assert.match(app,/skipped:\['○','Запрос отложен'\]/);
  assert.match(app,/rate_limited:\['!','Лимит запросов'\]/);
});

test('RC124 exposes reliability trust cap without inventing missing data',()=>{
  assert.match(app,/доверие ≤/);
  assert.match(app,/AI использует только подтверждённые сигналы/);
  assert.match(css,/RC124 — provider coverage transparency/);
  assert.match(css,/provider-coverage-row\.degraded/);
});
