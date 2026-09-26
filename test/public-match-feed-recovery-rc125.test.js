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

test('public match navigation and user profile stay independent from admin console',()=>{
  assert.match(app,/if \(\$\('profileBtn'\)\) \$\('profileBtn'\)\.hidden=false/);
  assert.match(app,/if \(\$\('navProfile'\)\) \$\('navProfile'\)\.hidden=false/);
  assert.match(app,/profileView: \['Профиль', 'Команды, напоминания и настройки'\]/);
  assert.match(app,/matchesView: \['Главная', 'Понимай матч глубже\\.'\]/);
});
