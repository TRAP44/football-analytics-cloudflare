import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');
const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_13.sql','utf8');

test('home screen exposes one AI focus without pre-spending analysis quota',()=>{
  assert.match(html,/id="aiFocus"/);
  assert.match(app,/function renderAiFocus/);
  assert.match(app,/data-ai-focus-fixture/);
  assert.match(app,/Полный вывод появится после анализа/);
});
test('completed match center collects referee history from loaded data',()=>{
  assert.match(worker,/function refereeCardSummary/);
  assert.match(worker,/saveRefereeMatchHistory/);
  assert.match(worker,/if \(finished && fixture\.fixture\?\.referee\)/);
});
test('referee profile requires a verified minimum sample',()=>{
  assert.match(worker,/function loadRefereeHistoryProfile/);
  assert.match(worker,/available:sample>=3/);
  assert.match(worker,/styleLabel/);
  assert.match(app,/ai\.refereeHistory\?\.available/);
});
test('referee table is private to worker role',()=>{
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all privileges.*anon, authenticated/i);
  assert.match(migration,/grant select, insert, update, delete.*service_role/i);
});
test('RC42 health exposes referee history and AI focus',()=>{
  assert.match(worker,/verifiedRefereeHistory:\s*'enabled'/);
  assert.match(worker,/aiFocusOfDay:\s*'enabled'/);
});
