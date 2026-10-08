import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const viewChrome=fs.readFileSync('public/modules/view-chrome.js','utf8');

test('RC125 public match feed starts alongside favorites without admin gating',()=>{
  assert.match(app,/const startupTasks = \[loadFavorites\(\), loadMatches\(\{ snapshotFastPath:true \}\)\]/);
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
  assert.match(viewChrome,/profileView:\s*Object\.freeze\(\['Профиль', 'Напоминания и настройки'\]\)/);
  assert.match(viewChrome,/matchesView:\s*Object\.freeze\(\['Главная', 'Видим, что меняет матч\.'\]\)/);
});

test('RC125 fallback does not clear a visible cached feed after provider failures',()=>{
  const start=app.indexOf('async function loadMatches');
  const end=app.indexOf('function syncFilterButtons',start);
  assert.ok(start>=0 && end>start);
  const load=app.slice(start,end);
  assert.match(load,/const fallbackSnapshot = readMatchSnapshot\(date\)/);
  assert.match(load,/const canReuseCurrent = Boolean\(state\.matches\.length/);
  assert.match(load,/applyMatchPayload\(snapshot, \{ snapshot: true, refreshing: true \}\)/);
  assert.match(load,/if \(seq !== state\.matchesLoadSeq\) return/);
  assert.match(load,/writeMatchSnapshot\(date, data\)/);
  assert.match(load,/const refresh = async \(\) => \{/);
});
