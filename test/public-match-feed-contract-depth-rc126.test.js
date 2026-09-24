import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');

test('RC126 match feed recovery is bounded and request-order safe',()=>{
  assert.match(app,/matchesLoadSeq/);
  assert.match(app,/MATCH_SNAPSHOT_MAX_AGE_MS\s*=\s*6 \* 60 \* 60 \* 1000/);
  assert.match(app,/MATCH_SNAPSHOT_PREFIX/);
});

test('RC126 public feed exposes explicit degraded-state semantics',()=>{
  assert.match(app,/matchesMeta:\s*\{ refreshedAt: null, stale: false, warning: '', retryAfter: 0/);
  assert.match(app,/Сохранённые данные останутся на экране/);
  assert.match(app,/Если есть сохранённая версия, приложение оставит её на экране/);
});

test('RC126 preserves public navigation while admin remains isolated',()=>{
  assert.match(app,/matchesView: \['Матчи', 'Сегодня, LIVE и ближайшие игры для AI-разбора'\]/);
  assert.match(app,/profileView: \['Администрирование', 'Служебные настройки проекта'\]/);
  assert.match(app,/if \(\$\('profileBtn'\)\) \$\('profileBtn'\)\.hidden=!admin/);
  assert.match(app,/if \(\$\('navProfile'\)\) \$\('navProfile'\)\.hidden=!admin/);
});
