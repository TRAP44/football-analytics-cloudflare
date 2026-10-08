import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const viewChrome=fs.readFileSync('public/modules/view-chrome.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC123 exposes today matches as a public Mini App destination',()=>{
  assert.match(html,/id="navMatches" class="nav-item active"/);
  assert.match(html,/<small>Главная<\/small>/);
  assert.doesNotMatch(html,/id="navMatches"[^>]*hidden/);
  assert.match(viewChrome,/matchesView:\s*Object\.freeze\(\['Главная', 'Видим, что меняет матч\.'\]\)/);
  assert.match(css,/grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
});

test('RC123 prepares the public match journey during startup',()=>{
  assert.match(app,/const startupTasks = \[loadFavorites\(\), loadMatches\(\{ snapshotFastPath:true \}\)\]/);
  assert.match(app,/await Promise\.allSettled\(startupTasks\)/);
  assert.match(app,/if \(\$\('navMatches'\)\) \$\('navMatches'\)\.hidden=false/);
});

test('home-first launch exposes the user profile while admin panels remain gated',()=>{
  assert.match(html,/id="matchesView" class="view active"/);
  assert.match(html,/id="navProfile" class="nav-item"/);
  assert.match(html,/<small>Профиль<\/small>/);
  assert.doesNotMatch(html,/data-admin-only|class="panel admin-console"/);
  assert.match(app,/showView\('matchesView', \{ restore: true \}\)/);
  assert.match(app,/if \(\$\('navProfile'\)\) \$\('navProfile'\)\.hidden=false/);
});

test('RC123 defers public match-feed work until access-control bootstrap completes',()=>{
  const start=app.indexOf('async function runStartupSequence');
  const end=app.indexOf('const api = createApiClient',start);
  assert.ok(start>=0 && end>start);
  const startup=app.slice(start,end);
  const profile=startup.indexOf('loadProfile().catch(()=>null)');
  const access=startup.indexOf('if (state.closedBetaBlocked) return false');
  const feed=startup.indexOf('const startupTasks = [loadFavorites(), loadMatches({ snapshotFastPath:true })]');
  assert.ok(profile>=0 && access>profile && feed>access);
  assert.doesNotMatch(startup.slice(0,access),/loadMatches\(\{/);
});
