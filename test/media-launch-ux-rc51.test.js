import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');

test('public onboarding explains the Telegram and Mini App roles',()=> {
  assert.match(worker,/function sendFootballBotHome/);
  assert.match(worker,/telegramUser = \{\}/);
  assert.match(worker,/Привет, <b>/);
  assert.match(worker,/Новости и LIVE остаются здесь, в Telegram/);
  assert.match(worker,/Полный AI-разбор/);
  assert.match(worker,/Если данных недостаточно или сценарий слабый/);
});

test('match cards preserve team identity and use FM AI branding',()=> {
  assert.match(worker,/home:\{id:Number\(homeSource\?\.id/);
  assert.match(worker,/away:\{id:Number\(awaySource\?\.id/);
  assert.match(worker,/bot:team-card:/);
  assert.match(worker,/FM AI · MATCH/);
  assert.match(worker,/AI-разбор уже сохранён/);
});

test('favorites toggle directly on the match card',()=> {
  assert.match(worker,/function favoriteMatchTeamRow/);
  assert.match(worker,/favorite:toggle:/);
  assert.match(worker,/function toggleBotFavorite/);
  assert.match(worker,/addFavorite\(userId,team,cfg\)/);
  assert.match(worker,/removeFavorite\(userId,id,cfg\)/);
  assert.match(worker,/editMessageReplyMarkup/);
  assert.match(worker,/★/);
  assert.match(worker,/☆/);
});

test('empty favorites state tells the user exactly how to start',()=> {
  assert.match(worker,/Мои команды пока пусты/);
  assert.match(worker,/нажмите ☆ рядом с нужным клубом/);
  assert.doesNotMatch(worker,/Добавление клубов в избранное перенесём/);
});

test('Telegram accepts known short club aliases before length rejection',()=> {
  const plan=worker.indexOf('const plan=topTeamSearchPlan(query);');
  const guard=worker.indexOf("Number(plan.best?.score || 0) < 280",plan);
  assert.ok(plan>=0 && guard>plan);
  assert.match(worker,/aliases:\['ман юнайтед'.*'мю'/);
});

test('RC51 health publishes public-launch UX contracts',()=> {
  assert.match(worker,/publicTelegramOnboarding:\s*'enabled'/);
  assert.match(worker,/inlineFavoriteTeams:\s*'enabled'/);
  assert.match(worker,/brandedMatchCards:\s*'enabled'/);
  assert.match(worker,/telegramSearchAliasParity:\s*'enabled'/);
  assert.match(worker,/mediaLaunchUx:\s*'enabled'/);
});
