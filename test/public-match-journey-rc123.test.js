import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC123 exposes today matches as a public Mini App destination',()=>{
  assert.match(html,/id="navMatches" class="nav-item" type="button"><span>⚽<\/span><small>Матчи<\/small>/);
  assert.doesNotMatch(html,/id="navMatches"[^>]*hidden/);
  assert.match(app,/matchesView: \['Матчи', 'Сегодня, LIVE и ближайшие игры для AI-разбора'\]/);
  assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('RC123 prepares the public match journey during startup',()=>{
  assert.match(app,/const startupTasks = \[loadFavorites\(\), loadMatches\(\)\]/);
  assert.match(app,/await Promise\.allSettled\(startupTasks\)/);
  assert.match(app,/if \(\$\('navMatches'\)\) \$\('navMatches'\)\.hidden=false/);
});

test('RC123 keeps search-first launch and admin-only profile separation',()=>{
  assert.match(html,/id="searchView" class="view active"/);
  assert.match(html,/id="navProfile"[^>]*hidden/);
  assert.match(app,/showView\('searchView', \{ restore: true \}\)/);
  assert.match(app,/if \(\$\('navProfile'\)\) \$\('navProfile'\)\.hidden=!admin/);
});
