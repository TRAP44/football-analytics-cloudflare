import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

test('pre-match response exposes an AI football instructor with a skip state', () => {
  assert.match(worker, /function buildAiInstructor/);
  assert.match(worker, /label:'Пропустить ставку'/);
  assert.match(worker, /aiInstructor: buildAiInstructor/);
  assert.match(app, /function aiInstructorHtml/);
  assert.match(css, /\.ai-instructor-card/);
});

test('pre-match analysis exposes referee context', () => {
  assert.match(worker, /referee: fixture\.fixture\?\.referee \|\| ''/);
  assert.match(app, /Судья/);
  assert.match(app, /analysis-referee-line/);
});

test('startup experience presents the FM AI brand without internal detail', () => {
  const boot=html.slice(html.indexOf('id="bootGate"'),html.indexOf('class="app-shell"'));
  assert.match(boot, /FM AI/);
  assert.match(boot, /Ваш футбол — в одном месте/);
  assert.match(boot, /Загружаем матчи/);
  assert.doesNotMatch(boot, /версия|RC\d|release|build|boot-feature-row/i);
});

test('telegram bot has a button-first hub and mini-app routes', () => {
  assert.match(worker, /setMyCommands/);
  assert.match(worker, /commands:\s*\[\]/);
  assert.match(worker, /setChatMenuButton/);
  assert.match(worker, /footballBotKeyboard/);
  assert.match(worker, /⚽ Матчи сегодня/);
  assert.match(worker, /🔴 LIVE/);
  assert.match(worker, /⭐ Мои команды/);
  assert.match(app, /function applyLaunchIntent/);
});

test('RC41 health exposes AI and bot contracts', () => {
  assert.match(worker, /aiFootballInstructor:\s*'enabled'/);
  assert.match(worker, /refereeContext:\s*'enabled'/);
  assert.match(worker, /telegramBotHub:\s*'enabled'/);
  assert.match(worker, /aiLaunchExperience:\s*'enabled'/);
});
