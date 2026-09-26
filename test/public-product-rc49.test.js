import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('global search recognizes major clubs across countries and Russian aliases',()=> {
  assert.match(worker,/TOP_TEAM_SEARCH_CATALOG/);
  for (const sample of ['реал мадрид','барселона','ман сити','мю','псж','бавария','интер','ювентус','бенфика','аякс','галатасарай','аль наср']) {
    assert.ok(worker.includes(sample), `missing club alias: ${sample}`);
  }
  assert.match(worker,/function topTeamSearchPlan/);
  assert.match(worker,/teamPlan\.providerQuery/);
  assert.match(worker,/v2-global/);
});

test('telegram search shares the same canonical club resolution',()=> {
  assert.match(worker,/const plan=topTeamSearchPlan\(query\)/);
  assert.match(worker,/apiFootball\('\/teams',\{search:plan\.providerQuery \|\| query\}/);
  assert.match(worker,/normalizeSearchTeam\(x,query,plan\.candidates\)/);
});

test('main Telegram navigation keeps content in chat',()=> {
  assert.match(worker,/\{ text: '⚽ Матчи' \}/);
  assert.match(worker,/\{ text: '🔴 LIVE' \}/);
  assert.match(worker,/\{ text: '⭐ Мои команды' \}/);
  assert.match(worker,/function sendBotDayMatches/);
  assert.match(worker,/function sendBotFavoriteTeams/);
  assert.match(worker,/🤖 AI-подборка/);
  assert.match(worker,/••• Ещё/);
  assert.match(worker,/text === '⚽ Матчи'/);
  assert.match(worker,/text === '🔴 LIVE'/);
  assert.match(worker,/text === '⭐ Мои команды'/);
});

test('mini app exposes the current public football shell',()=> {
  assert.match(html,/body class="miniapp-public-shell"/);
  assert.match(html,/id="matchesView" class="view active"/);
  assert.match(html,/id="navMatches" class="nav-item active"/);
  assert.match(html,/<small>Главная<\/small>/);
  assert.match(html,/id="navHistory" class="nav-item"/);
  assert.match(html,/<small>История<\/small>/);
  assert.match(html,/id="navProfile" class="nav-item"/);
  assert.match(html,/<small>Профиль<\/small>/);
  assert.match(html,/class="panel admin-console" data-admin-only hidden/);
  assert.match(html,/id="navMyTeams" class="nav-item"/); assert.doesNotMatch(html,/id="navSearch"/);
  assert.doesNotMatch(app,/MINIAPP_PRODUCT_MODE = 'ai-analysis-only'/);
  assert.match(css,/RC49 — public Mini App shell/);
});

test('normal mini app startup prepares the public home-first match feed',()=> {
  assert.match(app,/const startupTasks = \[loadFavorites\(\), loadMatches\(\)\]/);
  assert.match(app,/if \(admin\) startupTasks\.push\(loadReminders\(\)\)/);
  assert.match(app,/showView\('matchesView', \{ restore: true \}\)/);
});

test('RC49 health exposes public-product contracts',()=> {
  assert.match(worker,/globalTopClubSearch:\s*'enabled'/);
  assert.match(worker,/miniAppPublicShell:\s*'enabled'/);
  assert.match(worker,/botContentFirstNavigation:\s*'enabled'/);
});
