import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');

test('telegram uses a persistent button-first keyboard instead of a slash command menu',()=> {
  assert.match(worker,/commands:\s*\[\]/);
  assert.match(worker,/is_persistent:\s*true/);
  assert.match(worker,/⚽ Матчи сегодня/);
  assert.match(worker,/🧠 AI-подборка/);
  assert.match(worker,/🕘 Последний разбор/);
  assert.match(worker,/☀️ Утренняя подборка/);
});

test('bot profile is branded as FM AI',()=> {
  assert.match(worker,/setMyName/);
  assert.match(worker,/FM AI • Футбольный Инструктор/);
  assert.match(worker,/setMyShortDescription/);
  assert.match(worker,/setMyDescription/);
});

test('single match search exposes action buttons',()=> {
  assert.match(worker,/function footballMatchActionKeyboard/);
  assert.match(worker,/🧠 AI-вердикт/);
  assert.match(worker,/🧑‍⚖️ Судья/);
  assert.match(worker,/👥 Составы и потери/);
  assert.match(worker,/💹 Рынок и риски/);
  assert.match(worker,/📊 Полный AI-разбор/);
});

test('digest is managed with buttons and callback queries',()=> {
  assert.match(worker,/callback_data:\s*'digest:on'/);
  assert.match(worker,/callback_data:\s*'digest:off'/);
  assert.match(worker,/update\.callback_query/);
  assert.match(worker,/answerCallbackQuery/);
});

test('mini app deep links can open an exact analysis tab',()=> {
  assert.match(app,/params\.get\('tab'\)/);
  assert.match(app,/allowedTabs/);
  assert.match(app,/openLaunchFixture\(fixtureId, action, tab, handoff, newsImpactDecision, newsImpactAction\)/);
});

test('RC47 health exposes button-first contracts',()=> {
  assert.match(worker,/botPersistentKeyboard:\s*'enabled'/);
  assert.match(worker,/botMatchActionButtons:\s*'enabled'/);
  assert.match(worker,/botSlashMenuHidden:\s*'enabled'/);
  assert.match(worker,/botProfileBranding:\s*'enabled'/);
});
