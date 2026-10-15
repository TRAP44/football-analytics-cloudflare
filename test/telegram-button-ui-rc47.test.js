import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const worker=(fs.readFileSync('src/worker.js','utf8')
  +'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8')
  +'\n'+fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8')
  +'\n'+fs.readFileSync('src/telegram-bot-orchestration-runtime.js','utf8')
  +'\n'+fs.readFileSync('src/telegram-digest-runtime.js','utf8'));

test('telegram uses a persistent button-first keyboard with a short slash command menu',()=> {
  // Вариант оформления A (Сергей 13.10): кнопки остаются основными, в меню «/» — короткий список команд.
  assert.match(worker,/setMyCommands', \{ commands: BOT_COMMANDS \}/);
  assert.match(worker,/is_persistent:\s*true/);
  assert.match(worker,/⚽ Матчи/);
  assert.match(worker,/🤖 AI-подборка/);
  assert.match(worker,/🕘 Последний разбор/);
  assert.match(worker,/••• Ещё/);
  assert.match(worker,/function footballBotMoreKeyboard/);
});

test('bot profile is branded as MatchRadar AI',()=> {
  assert.match(worker,/setMyName/);
  assert.match(worker,/setMyName[\s\S]{0,120}name: 'MatchRadar AI'/);
  assert.match(worker,/setMyShortDescription/);
  assert.match(worker,/setMyDescription/);
  assert.match(worker,/Матчи, LIVE и AI-разбор — быстро и по делу\./);
  assert.match(worker,/Футбольный AI-ассистент: ближайшие матчи ваших команд, LIVE и короткий разбор того, что меняет матч\./);
  assert.doesNotMatch(worker,/FM AI/);
});

test('single match search exposes action buttons',()=> {
  assert.match(worker,/function footballMatchActionKeyboard/);
  assert.match(worker,/🧠 AI-вердикт/);
  assert.match(worker,/👥 Составы и потери/);
  // Сергей 13.10: «Судья», «Риски матча», «Обновить AI» убраны с карточки матча.
  assert.doesNotMatch(worker,/text:'🧑‍⚖️ Судья'/);
  assert.doesNotMatch(worker,/text:'⚠️ Риски матча'/);
  assert.doesNotMatch(worker,/text:'🔄 Обновить AI'/);
  assert.doesNotMatch(worker,/💹 Рынок и риски/);
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
  assert.match(app,/normalizeAnalysisTab\(tab\)/);
  assert.match(app,/openLaunchFixture\(fixtureId, action, tab, handoff, newsImpactDecision, newsImpactAction, newsImpactRecoveryCode, newsImpactRecoveryFrom\)/);
});

test('RC47 release contract follows extracted button-first runtimes',()=> {
  assert.match(worker,/createTelegramBotUiRuntime\(\{/);
  assert.match(worker,/createTelegramBotOrchestrationRuntime\(\{/);
  assert.match(worker,/createTelegramDigestRuntime\(\{/);
  assert.match(worker,/return Object\.freeze\(\{/);
});

test('RC47 public bot uses a short Telegram command menu and persistent reply buttons',()=>{
  assert.match(worker,/command: 'plans', description: 'Тарифы'/);
  assert.match(worker,/is_persistent:\s*true/);
  assert.match(worker,/function footballBotKeyboard/);
  assert.match(worker,/function footballBotMoreKeyboard/);
  assert.match(worker,/callback_data:\s*'digest:on'/);
  assert.match(worker,/callback_data:\s*'digest:off'/);
});

test('bot links to tariffs and notifications open the matching profile block',()=>{
  assert.match(app,/view === 'profile'/);
  assert.match(app,/section === 'billing' \? 'billingPanel'/);
  assert.match(app,/section === 'notifications' \? 'smartNotificationsRoot'/);
  assert.match(worker,/\[\{text:'⭐ Мои команды'\},\{text:'⚙️ Уведомления'\}\]/);
});
