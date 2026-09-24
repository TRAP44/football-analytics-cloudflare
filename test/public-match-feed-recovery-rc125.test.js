import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');

test('RC125 public match feed starts alongside favorites without admin gating',()=>{
  assert.match(app,/const startupTasks = \[loadFavorites\(\), loadMatches\(\)\]/);
  assert.match(app,/if \(\$\('navMatches'\)\) \$\('navMatches'\)\.hidden=false/);
});

test('RC125 keeps match feed usable during provider or network degradation',()=>{
  assert.match(app,/MATCH_SNAPSHOT_PREFIX/);
  assert.match(app,/MATCH_SNAPSHOT_MAX_AGE_MS/);
  assert.match(app,/Сохранённые данные останутся на экране/);
  assert.match(app,/Если есть сохранённая версия, приложение оставит её на экране/);
});

test('RC125 keeps public match navigation independent from admin console',()=>{
  assert.match(app,/if \(\$\('profileBtn'\)\) \$\('profileBtn'\)\.hidden=!admin/);
  assert.match(app,/if \(\$\('navProfile'\)\) \$\('navProfile'\)\.hidden=!admin/);
  assert.match(app,/matchesView: \['Матчи', 'Сегодня, LIVE и ближайшие игры для AI-разбора'\]/);
});
