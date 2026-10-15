import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramBotOrchestrationRuntime } from '../src/telegram-bot-orchestration-runtime.js';
import { createTelegramUpdateProcessor } from '../src/telegram-update-orchestration.js';

// Выбор любимой команды сразу после /start (Сергей 15.10).

function botRuntime({ favorites = [] } = {}) {
  const calls = [];
  const added = [];
  const rows = [...favorites];
  const runtime = createTelegramBotOrchestrationRuntime({
    telegramApi: async (method, _cfg, payload) => { calls.push({ method, payload }); return {}; },
    getFavorites: async () => rows,
    addFavorite: async (_uid, team) => { added.push(team); rows.push({ team_id: team.id, team_name: team.name }); },
    telegramHtmlEscape: value => String(value),
  });
  return { runtime, calls, added };
}

test('picker shows popular clubs with current favorites marked and a done button', async () => {
  const { runtime, calls } = botRuntime({ favorites: [{ team_id: 541 }] });
  await runtime.sendFavoritePicker({}, {}, 7, 42);
  const keyboard = calls[0].payload.reply_markup.inline_keyboard;
  const buttons = keyboard.flat();
  assert.equal(buttons[0].text, '★ Реал');
  assert.equal(buttons[0].callback_data, 'fav:pick:541');
  assert.ok(buttons.some(b => b.text === '☆ Зенит' && b.callback_data === 'fav:pick:596'));
  assert.deepEqual(keyboard.at(-1), [{ text: '✅ Готово · 1', callback_data: 'fav:done' }]);
  assert.match(calls[0].payload.text, /Напишите название клуба в чат/);
});

test('picking a club adds it once and marks it in the same message', async () => {
  const { runtime, calls, added } = botRuntime();
  const first = await runtime.pickStartFavorite({}, 7, 42, 100, 596);
  await runtime.pickStartFavorite({}, 7, 42, 100, 596);
  assert.deepEqual(added, [{ id: 596, name: 'Zenit', logo: 'https://media.api-sports.io/football/teams/596.png' }]);
  assert.equal(first.team.label, 'Зенит');
  const edit = calls.find(c => c.method === 'editMessageReplyMarkup').payload;
  assert.equal(edit.message_id, 100);
  assert.ok(edit.reply_markup.inline_keyboard.flat().some(b => b.text === '★ Зенит'));
  await assert.rejects(runtime.pickStartFavorite({}, 7, 42, 100, 999999), /Команда не определена/);
});

function processor(overrides = {}) {
  const sent = [];
  const picker = [];
  const deps = new Proxy({
    loadRuntimeControls: async () => ({ value: {} }),
    telegramLockdownDecision: () => ({ blocked: false }),
    telegramApi: async (method, _cfg, payload) => { sent.push({ method, payload }); return {}; },
    json: (body, status = 200) => ({ body, status }),
    telegramStartPayload: () => '',
    parseLaunchStartParam: () => ({}),
    getFavorites: async () => [],
    sendFavoritePicker: async (...args) => { picker.push(args); },
    pickStartFavorite: async () => ({ team: { label: 'Зенит' } }),
    sendBotFavoriteTeams: async () => { sent.push({ method: 'favoriteTeams' }); },
    ...overrides,
  }, { get: (target, key) => (key in target ? target[key] : async () => null) });
  return { run: createTelegramUpdateProcessor(deps), sent, picker };
}

const request = { url: 'https://app.example/telegram/webhook' };
const message = (text, type = 'private', id = 42) => ({ message: { chat: { id, type }, from: { id: 7 }, text } });

test('/start in a private chat without favorites opens the picker; groups and existing fans do not', async () => {
  let p = processor();
  await p.run(request, {}, message('/start'));
  assert.equal(p.picker.length, 1);

  p = processor();
  await p.run(request, {}, message('/start', 'group', -100));
  assert.equal(p.picker.length, 0);

  p = processor({ getFavorites: async () => [{ team_id: 541 }] });
  await p.run(request, {}, message('/start'));
  assert.equal(p.picker.length, 0);
});

test('«Мои команды» without favorites opens the picker, with favorites shows them', async () => {
  let p = processor();
  await p.run(request, {}, message('⭐ Мои команды'));
  assert.equal(p.picker.length, 1);
  assert.ok(!p.sent.some(c => c.method === 'favoriteTeams'));

  p = processor({ getFavorites: async () => [{ team_id: 541 }] });
  await p.run(request, {}, message('⭐ Мои команды'));
  assert.equal(p.picker.length, 0);
  assert.ok(p.sent.some(c => c.method === 'favoriteTeams'));
});

test('picker callbacks add a club and «Готово» shows the chosen teams', async () => {
  const p = processor();
  const callback = data => ({ callback_query: { id: 'cb', data, from: { id: 7 }, message: { message_id: 100, chat: { id: 42 } } } });
  await p.run(request, {}, callback('fav:pick:596'));
  assert.match(p.sent.find(c => c.method === 'answerCallbackQuery').payload.text, /Зенит — в «Моих командах»/);
  await p.run(request, {}, callback('fav:done'));
  assert.ok(p.sent.some(c => c.method === 'favoriteTeams'));
});
