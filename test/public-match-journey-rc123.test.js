import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC123 exposes today matches as a public Mini App destination',()=>{
  assert.match(html,/id="navMatches" class="nav-item active" type="button"><span>⚽<\/span><small>Главная<\/small>/);
  assert.doesNotMatch(html,/id="navMatches"[^>]*hidden/);
  assert.match(app,/matchesView: \['Главная', 'Ваш футбол — в одном месте'\]/);
  assert.match(css,/grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
});

test('RC123 prepares the public match journey during startup',()=>{
  assert.match(app,/const startupTasks = \[loadFavorites\(\), loadMatches\(\)\]/);
  assert.match(app,/await Promise\.allSettled\(startupTasks\)/);
  assert.match(app,/if \(\$\('navMatches'\)\) \$\('navMatches'\)\.hidden=false/);
});

test('home-first launch exposes the user profile while admin panels remain gated',()=>{
  assert.match(html,/id="matchesView" class="view active"/);
  assert.match(html,/id="navProfile" class="nav-item" type="button"><span>👤<\/span><small>Профиль<\/small>/);
  assert.match(html,/class="panel admin-console" data-admin-only hidden/);
  assert.match(app,/showView\('matchesView', \{ restore: true \}\)/);
  assert.match(app,/if \(\$\('navProfile'\)\) \$\('navProfile'\)\.hidden=false/);
});
