import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createSearchDiscoveryRuntime } from '../src/search-discovery-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const botUi=fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8');
const botOrchestration=fs.readFileSync('src/telegram-bot-orchestration-runtime.js','utf8');
const updateOrchestration=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
const digest=fs.readFileSync('src/telegram-digest-runtime.js','utf8');
const telegramSearch=fs.readFileSync('src/telegram-search-runtime.js','utf8');

const searchRuntime=createSearchDiscoveryRuntime({
  COMPETITIONS:new Map(),
  async apiFootball(){ return []; },
  freeQuotaHealthy(){ return true; },
  async getCache(){ return null; },
  async getStaleCache(){ return null; },
  isFootballRateLimitError(){ return false; },
  isRetryableFootballTransportError(){ return false; },
  isYouthReserveMatch(){ return false; },
  json(value){ return value; },
  async loadProviderTeamDiscoveryFixtures(){ return []; },
  normalizeCountryName(value){ return String(value || ''); },
  normalizeTeamHubMatch(value){ return value; },
  publicDataCapabilities(){ return {}; },
  async setCache(){},
});

test('public onboarding explains the Telegram and Mini App roles',()=> {
  assert.match(botOrchestration,/async function sendFootballBotHome/);
  assert.match(botOrchestration,/telegramUser = \{\}/);
  assert.match(botOrchestration,/Привет, <b>/);
  assert.match(botOrchestration,/Новости и 🔴 LIVE остаются здесь, в Telegram/);
  assert.match(botOrchestration,/полного AI-разбора откроет Mini App/i);
  assert.match(botOrchestration,/Если данных мало или перевеса нет/);
});

test('match cards preserve team identity and use MatchRadar AI branding',()=> {
  assert.match(botUi,/function normalizeBotFixtureCard/);
  assert.match(botUi,/const homeSource=objectValue\(source\.home\)/);
  assert.match(botUi,/const awaySource=objectValue\(source\.away\)/);
  assert.match(botUi,/homeName:home\.name/);
  assert.match(botUi,/awayName:away\.name/);
  assert.match(botUi,/bot:team-card:/);
  assert.match(botUi,/MatchRadar AI · MATCH/);
  assert.match(botUi,/AI-разбор уже сохранён/);
});

test('favorites toggle directly on the match card and refresh the keyboard',()=> {
  assert.match(botUi,/function favoriteMatchTeamRow/);
  assert.match(botUi,/favorite:toggle:/);
  assert.match(botUi,/fav\.has\(team\.id\)\?'★':'☆'/);
  assert.match(botOrchestration,/async function toggleBotFavorite/);
  assert.match(botOrchestration,/removeFavorite\)\(uid,id,cfg\)/);
  assert.match(botOrchestration,/addFavorite\)\(uid,normalized,cfg\)/);
  assert.match(updateOrchestration,/favorite:toggle:\(\\d\+\):\(\\d\+\)/);
  assert.match(updateOrchestration,/editMessageReplyMarkup/);
});

test('empty favorites state tells the user exactly how to start',()=> {
  assert.match(digest,/Мои команды пока пусты/);
  assert.match(digest,/нажмите ☆ рядом с нужным клубом/);
  assert.doesNotMatch(digest,/Добавление клубов в избранное перенесём/);
});

test('Telegram accepts known short club aliases before length rejection',()=> {
  const plan=searchRuntime.topTeamSearchPlan('мю');
  assert.equal(plan.best?.canonical,'Manchester United');
  assert.equal(plan.best?.score,280);
  assert.equal(plan.providerQuery,'Manchester United');

  assert.match(telegramSearch,/const plan=safeSearchPlan\(query\)/);
  assert.match(telegramSearch,/const bestScore=finiteNumber\(plan\.best\?\.score\) \?\? 0/);
  assert.match(telegramSearch,/query\.length < 3 && bestScore < 280/);
});

test('RC51 public-launch UX stays wired through current modular runtimes',()=> {
  assert.match(worker,/createTelegramBotUiRuntime/);
  assert.match(worker,/createTelegramBotOrchestrationRuntime/);
  assert.match(worker,/createTelegramSearchRuntime/);
  assert.match(worker,/createTelegramDigestRuntime/);
});
