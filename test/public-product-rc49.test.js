import { readFileSync as readContractSource } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');
const appCapabilities=fs.readFileSync('src/app-capabilities.js','utf8');

test('global search recognizes major clubs across countries and Russian aliases',()=> {
  assert.match(worker,/TOP_TEAM_SEARCH_CATALOG/);
  for (const sample of ['реал мадрид','барселона','ман сити','мю','псж','бавария','интер','ювентус','бенфика','аякс','галатасарай','аль наср']) {
    assert.ok(fs.readFileSync('src/search-discovery-runtime.js','utf8').includes(sample), `missing club alias: ${sample}`);
  }
  assert.match(readContractSource(new URL('../src/search-discovery-runtime.js', import.meta.url), 'utf8'),/function topTeamSearchPlan/);
  assert.match(readContractSource(new URL('../src/search-discovery-runtime.js', import.meta.url), 'utf8'),/teamPlan\.providerQuery/);
  assert.match(fs.readFileSync('src/search-discovery-runtime.js','utf8'),/v2-global/);
});

test('telegram search shares the same canonical club resolution',()=> {
  const search=fs.readFileSync('src/telegram-search-runtime.js','utf8');
  assert.match(search,/const plan=safeSearchPlan\(query\)/);
  assert.match(search,/optionalCall\(topTeamSearchPlan,null,query\)/);
  assert.match(search,/optionalAsync\(apiFootball,\[\], '\/teams',\{search:providerQuery\}/);
  assert.match(search,/normalizeSearchTeam\(row,query,plan\.candidates\)/);
});

test('main Telegram navigation keeps content in chat',()=> {
  assert.match(readContractSource(new URL('../src/telegram-bot-ui-runtime.js', import.meta.url), 'utf8'),/\{\s*text:\s*'⚽\s*Матчи'\s*\}/);
  assert.match(readContractSource(new URL('../src/telegram-bot-ui-runtime.js', import.meta.url), 'utf8'),/\{\s*text:\s*'🔴\s*LIVE'\s*\}/);
  assert.match(readContractSource(new URL('../src/telegram-bot-ui-runtime.js', import.meta.url), 'utf8'),/\{\s*text:\s*'⭐\s*Мои\s*команды'\s*\}/);
  assert.match(worker,/function sendBotDayMatches/);
  assert.match(worker,/function sendBotFavoriteTeams/);
  assert.match(worker,/🤖 AI-подборка/);
  assert.match(worker,/••• Ещё/);
  assert.match(readContractSource(new URL('../src/telegram-update-orchestration.js', import.meta.url), 'utf8'),/text === '⚽ Матчи'/);
  assert.match(readContractSource(new URL('../src/telegram-update-orchestration.js', import.meta.url), 'utf8'),/text === '🔴 LIVE'/);
  assert.match(readContractSource(new URL('../src/telegram-update-orchestration.js', import.meta.url), 'utf8'),/text === '⭐ Мои команды'/);
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
  assert.doesNotMatch(html,/data-admin-only|class="panel admin-console"/);
  assert.match(html,/id="navMyTeams" class="nav-item"/); assert.doesNotMatch(html,/id="navSearch"/);
  assert.doesNotMatch(app,/MINIAPP_PRODUCT_MODE = 'ai-analysis-only'/);
  assert.match(html,/styles\/public-shell\.css/);
  assert.match(fs.readFileSync('public/styles/public-shell.css','utf8'),/\.miniapp-public-shell \.bottom-nav/);
});

test('normal mini app startup prepares the public home-first match feed',()=> {
  assert.match(app,/const startupTasks = \[loadFavorites\(\), loadMatches\(\{ snapshotFastPath:true \}\)\]/);
  assert.doesNotMatch(app,/if \(admin\) startupTasks\.push\(loadReminders\(\)\)/);
  assert.match(app,/if \(!state\.remindersLoaded\) tasks\.push\(loadReminders\(\)\)/);
  assert.match(app,/showView\('matchesView', \{ restore: true \}\)/);
});

test('current manifest preserves the public-product contracts introduced by RC49',()=> {
  assert.match(appCapabilities,/unifiedSearch:true/);
  assert.match(appCapabilities,/focusedMatchHome:true/);
  assert.match(appCapabilities,/telegramMiniAppE2E:true/);
});

test('RC49 public shell keeps four distinct main navigation targets',()=>{
  const expected=['navMatches','navMyTeams','navHistory','navProfile'];
  for(const id of expected){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  }
  assert.doesNotMatch(html,/id="navSearch"/);
  assert.match(html,/<meta name="matchradar-surface" content="public"/);
  assert.doesNotMatch(html,/data-admin-only/);
});
