import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTelegramDigestRuntime } from '../src/telegram-digest-runtime.js';
import { createTelegramBotOrchestrationRuntime } from '../src/telegram-bot-orchestration-runtime.js';
import { createTelegramBotUiRuntime } from '../src/telegram-bot-ui-runtime.js';
import { createTelegramUpdateProcessor } from '../src/telegram-update-orchestration.js';
import { createTelegramSearchRuntime } from '../src/telegram-search-runtime.js';
import { chatAllowsWebApp, chatSafeTelegramBody } from '../src/telegram-chat-markup.js';
import { botDigestView } from '../src/telegram-bot-plans.js';

// Кнопки и сценарии Telegram-бота (Issue #922).

const proxy = base => new Proxy(base, { get: (t, k) => (k in t ? t[k] : async () => null), has: () => true });
const teams = count => Array.from({ length: count }, (_, i) => ({ team_id: 100 + i, team_name: `Club ${i + 1}` }));

function digestRuntime(favorites, calls) {
  return createTelegramDigestRuntime(proxy({
    DAILY_DIGEST_POLICY: { deliveryHourUtc: 7, pageSize: 500, maxRecipientsPerRun: 1000 },
    SMART_NOTIFICATION_POLICY: {},
    memory: { botDigestSubscriptions: new Map() },
    telegramHtmlEscape: value => String(value),
    getFavorites: async () => favorites,
    telegramApi: async (method, _cfg, payload) => { calls.push({ method, payload }); return {}; },
  }));
}

test('all favorites are reachable page by page; paging edits the same message', async () => {
  const calls = [];
  const digest = digestRuntime(teams(23), calls);
  await digest.sendBotFavoriteTeams({}, {}, 7, 7);
  const first = calls[0];
  assert.equal(first.method, 'sendMessage');
  assert.match(first.payload.text, /Мои команды<\/b> · 23/);
  const rows = first.payload.reply_markup.inline_keyboard;
  assert.equal(rows.filter(row => row[0].callback_data.startsWith('favorite:team:')).length, 10);
  assert.deepEqual(rows.at(-2).map(b => b.callback_data), ['favorite:page:0', 'favorite:page:1']);
  assert.deepEqual(rows.at(-1), [{ text: '➕ Добавить команду', callback_data: 'fav:add' }]);

  const seen = new Set();
  for (const page of [0, 1, 2]) {
    calls.length = 0;
    await digest.sendBotFavoriteTeams({}, {}, 7, 7, { page, messageId: 55 });
    assert.equal(calls[0].method, 'editMessageText');
    assert.equal(calls[0].payload.message_id, 55);
    for (const row of calls[0].payload.reply_markup.inline_keyboard) {
      for (const b of row) if (b.callback_data.startsWith('favorite:team:')) seen.add(b.callback_data);
    }
  }
  assert.equal(seen.size, 23, 'every club is on some page');

  calls.length = 0;
  await digest.sendBotFavoriteTeams({}, {}, 7, 7, { page: 999 });
  assert.match(calls[0].payload.reply_markup.inline_keyboard.at(-2)[0].text, /Назад/, 'out-of-range page clamps to the last');
});

test('club card has an explicit «Убрать» and a way back; no news button', async () => {
  const calls = [];
  const digest = digestRuntime([{ team_id: 40, team_name: 'Liverpool' }], calls);
  await digest.sendBotFavoriteTeamMatches({}, {}, 7, 7, 40);
  const data = calls[0].payload.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
  assert.ok(data.includes('favorite:remove:40'));
  assert.ok(data.includes('favorite:page:0'));
  assert.ok(!data.some(d => d.startsWith('news:team:')));
});

function processor(overrides = {}) {
  const sent = [];
  const calls = [];
  const deps = proxy({
    loadRuntimeControls: async () => ({ value: {} }),
    telegramLockdownDecision: () => ({ blocked: false }),
    telegramApi: async (method, _cfg, payload) => { sent.push({ method, payload }); return {}; },
    json: (body, status = 200) => ({ body, status }),
    telegramStartPayload: () => '',
    parseLaunchStartParam: () => ({}),
    telegramWebAppUrl: () => 'https://app.example/?view=profile',
    getFavorites: async () => [],
    sendBotFavoriteTeams: async (...args) => { calls.push(['list', ...args.slice(2)]); },
    sendFavoritePicker: async (...args) => { calls.push(['picker', ...args.slice(2)]); },
    removeBotFavorite: async (userId, teamId) => { calls.push(['remove', userId, teamId]); return { removed: true, team: { id: teamId, name: 'Liverpool' } }; },
    ...overrides,
  });
  return { run: createTelegramUpdateProcessor(deps), sent, calls };
}
const request = { url: 'https://app.example/telegram/webhook' };
const callback = (data, { from = 7, chat = 42, type = 'private', messageId = 100 } = {}) => ({
  callback_query: { id: 'cb', data, from: { id: from }, message: { message_id: messageId, chat: { id: chat, type } } },
});

test('remove / paging / add callbacks act for callback.from.id, old callbacks keep working', async () => {
  const p = processor();
  await p.run(request, {}, callback('favorite:remove:40', { from: 7, chat: -100500, type: 'group' }));
  assert.deepEqual(p.calls[0], ['remove', 7, 40], 'removal uses the clicking user, not the chat');
  assert.match(p.sent.find(c => c.method === 'answerCallbackQuery').payload.text, /Liverpool убран/);
  assert.deepEqual(p.calls[1], ['list', 7, -100500, { page: 0, messageId: 100 }]);

  await p.run(request, {}, callback('favorite:page:2'));
  assert.deepEqual(p.calls.at(-1), ['list', 7, 42, { page: 2, messageId: 100 }]);
  await p.run(request, {}, callback('fav:add'));
  assert.deepEqual(p.calls.at(-1), ['picker', 7, 42]);

  const failing = processor({ removeBotFavorite: async () => { throw new Error('Supabase favorites: HTTP 503 — upstream unavailable'); } });
  await failing.run(request, {}, callback('favorite:remove:40'));
  const alert = failing.sent.find(c => c.method === 'answerCallbackQuery').payload;
  assert.equal(alert.show_alert, true);
  assert.doesNotMatch(alert.text, /HTTP|Supabase|upstream/);

  const old = processor({ sendBotFavoriteTeamMatches: async (...args) => { old.calls.push(['team', ...args.slice(2)]); } });
  await old.run(request, {}, callback('favorite:team:40'));
  assert.deepEqual(old.calls.at(-1), ['team', 7, 42, 40]);
});

test('removeBotFavorite is idempotent and removes only for that user', async () => {
  const removed = [];
  const rows = [{ team_id: 40, team_name: 'Liverpool' }];
  const runtime = createTelegramBotOrchestrationRuntime({
    getFavorites: async () => rows,
    removeFavorite: async (uid, id) => { removed.push([uid, id]); rows.splice(0, 1); },
  });
  assert.deepEqual(await runtime.removeBotFavorite(7, 40, {}), { removed: true, team: { id: 40, name: 'Liverpool' } });
  assert.deepEqual((await runtime.removeBotFavorite(7, 40, {})).removed, false);
  assert.deepEqual(removed, [[7, 40]]);
});

function sectionRuntime(overrides = {}) {
  const spies = { analyze: 0, mutation: 0, matchCenter: 0, ops: [], sent: [] };
  const runtime = createTelegramBotOrchestrationRuntime({
    apiMatchCenter: async () => { spies.matchCenter += 1; return new Response(JSON.stringify({
      match: { fixtureId: 7, home: { name: 'Home' }, away: { name: 'Away' } },
      lineups: { home: { formation: '4-3-3', startXI: Array(11).fill({}) }, away: {} },
      absences: { home: [{ name: 'Player A' }], away: [] },
    }), { status: 200 }); },
    botAnalyzeFixture: async () => { spies.analyze += 1; return {}; },
    markTelegramWebhookMutation: () => { spies.mutation += 1; },
    recordOpsEvent: async (_cfg, event) => { spies.ops.push(event); },
    telegramApi: async (method, _cfg, payload) => { spies.sent.push({ method, payload }); return {}; },
    telegramHtmlEscape: value => String(value).replace(/</g, '&lt;'),
    getFavorites: async () => [],
    ...overrides,
  });
  return { runtime, spies };
}

test('«Составы и потери» reads the match center: no full AI analysis and no AI-quota mutation', async () => {
  const { runtime, spies } = sectionRuntime();
  const result = await runtime.sendBotFixtureSection(new Request('https://app.example/telegram'), {}, 7, 42, 7, 'squads');
  assert.equal(result.ok, true);
  assert.equal(spies.analyze, 0, 'botAnalyzeFixture (quota reservation path) is not called');
  assert.equal(spies.mutation, 0, 'no analysis_quota_or_history mutation');
  assert.equal(spies.matchCenter, 1);
  const text = spies.sent[0].payload.text;
  assert.match(text, /Составы и потери · Home — Away/);
  assert.match(text, /Потери: Player A/);
  assert.match(text, /подтверждён · 4-3-3/);
  assert.doesNotMatch(text, /AI-контекст/, 'no invented AI note without analysis');
});

test('public errors are short Russian text; details go to ops only', async () => {
  const { runtime, spies } = sectionRuntime({
    botAnalyzeFixture: async () => { throw Object.assign(new Error('Supabase users: HTTP 503 — upstream unavailable'), { status: 503, code: 'SUPABASE_UPSTREAM' }); },
  });
  const result = await runtime.sendBotFixtureSection(new Request('https://app.example/telegram'), {}, 7, 42, 7, 'verdict');
  assert.equal(result.ok, false);
  const text = spies.sent[0].payload.text;
  assert.doesNotMatch(text, /HTTP|Supabase|upstream|503/);
  assert.match(text, /Не удалось получить AI-разбор матча/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spies.ops.length, 1);
  assert.match(spies.ops[0].message, /HTTP 503/);
  assert.equal(spies.ops[0].meta.section, 'verdict');

  const sources = ['src/telegram-update-orchestration.js', 'src/telegram-bot-orchestration-runtime.js', 'src/telegram-bot-ui-runtime.js']
    .map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(sources, /boundedErrorText\(error\?\.message,'Не удалось (изменить избранное|добавить команду)/);
});

function uiRuntime() {
  return createTelegramBotUiRuntime(proxy({
    telegramWebAppUrl: (_req, params) => `https://app.example/?${new URLSearchParams(params)}`,
    telegramFullAnalysisUrl: (_req, id, tab) => `https://app.example/?fixtureId=${id}&action=analysis&tab=${tab}`,
    telegramHtmlEscape: value => String(value),
    isLiveStatus: status => status === '1H',
    isFinishedStatus: status => status === 'FT',
    statusLabel: status => status,
    createRequest: (url, init) => new Request(url, init),
  }));
}

test('group chats never get web_app buttons: real match keyboard payloads for private and group', async () => {
  const ui = uiRuntime();
  const match = { fixtureId: 7, date: '2026-10-20T18:00:00Z', status: 'NS', home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' }, league: 'L' };
  const live = { ...match, status: '1H', elapsed: 20 };
  const req = new Request('https://app.example/telegram');
  const links = [];
  const linkFor = async fixtureId => { links.push(fixtureId); return fixtureId ? `https://t.me/MatchRadarBot?start=f${fixtureId}_g` : 'https://t.me/MatchRadarBot'; };
  for (const card of [match, live]) {
    const markup = ui.footballMatchActionKeyboard(req, card, '', []);
    assert.ok(JSON.stringify(markup).includes('web_app'), 'private keyboard uses the Mini App');
    const privateBody = await chatSafeTelegramBody('sendMessage', { chat_id: 42, text: 'x', reply_markup: markup }, linkFor);
    assert.deepEqual(privateBody.reply_markup, markup, 'private chat is unchanged');
    const group = await chatSafeTelegramBody('sendMessage', { chat_id: -100500, text: 'x', reply_markup: markup }, linkFor);
    const flat = group.reply_markup.inline_keyboard.flat();
    assert.ok(!flat.some(b => b.web_app), 'no web_app in a group');
    assert.ok(flat.some(b => b.url === 'https://t.me/MatchRadarBot?start=f7_g'), 'replaced by a bot link to the match');
    assert.ok(flat.some(b => b.callback_data === 'match:share:7'), 'callback buttons stay');
  }
  // Ссылку получить не удалось — кнопка убирается, пустые ряды и клавиатура — тоже.
  const dropped = await chatSafeTelegramBody('editMessageReplyMarkup', {
    chat_id: '@channel', message_id: 1, reply_markup: { inline_keyboard: [[{ text: 'App', web_app: { url: 'https://app.example/' } }]] },
  }, async () => { throw new Error('getMe failed'); });
  assert.equal(dropped.reply_markup, undefined);
  // Inline-карточки уже со ссылкой url — не трогаем.
  const urlOnly = { chat_id: -1, reply_markup: { inline_keyboard: [[{ text: 'AI', url: 'https://t.me/MatchRadarBot?start=f1' }]] } };
  assert.equal(await chatSafeTelegramBody('sendMessage', urlOnly, linkFor), urlOnly);
  assert.equal(chatAllowsWebApp(42), true);
  assert.equal(chatAllowsWebApp(-42), false);
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.match(worker, /async function telegramApi\(method, cfg, body, \.\.\.rest\) \{\n  const safeBody = await chatSafeTelegramBody\(/);
});

test('favorite picker no longer promises an automatic reminder', async () => {
  const calls = [];
  const runtime = createTelegramBotOrchestrationRuntime({
    getFavorites: async () => [],
    telegramApi: async (method, _cfg, payload) => { calls.push(payload); return {}; },
  });
  await runtime.sendFavoritePicker({}, {}, 7, 42);
  assert.doesNotMatch(calls[0].text, /напомню|напоминани/i);
  assert.match(calls[0].text, /живой счёт/);
});

test('digest controls show the confirmed state with one action; a failed save is not a success', async () => {
  assert.deepEqual(botDigestView(true).buttons.map(b => b.callback_data), ['digest:off']);
  assert.deepEqual(botDigestView(false).buttons.map(b => b.callback_data), ['digest:on']);
  assert.deepEqual(botDigestView(null).buttons.map(b => b.callback_data), ['digest:on', 'digest:off']);
  assert.match(botDigestView(true).text, /Утренняя подборка: включена/);
  assert.match(botDigestView(true).text, /меняет только подборку/);

  const settings = processor({ getBotDigestSubscription: async () => ({ enabled: true }) });
  await settings.run(request, {}, { message: { chat: { id: 42, type: 'private' }, from: { id: 7 }, text: '⚙️ Уведомления' } });
  const shown = settings.sent.find(c => c.method === 'sendMessage').payload;
  assert.match(shown.text, /включена/);
  assert.deepEqual(shown.reply_markup.inline_keyboard[0], [{ text: '🔕 Выключить подборку', callback_data: 'digest:off' }]);

  const saved = [];
  const ok = processor({ setBotDigestSubscription: async (...args) => { saved.push(args.slice(0, 3)); } });
  await ok.run(request, {}, callback('digest:off'));
  assert.deepEqual(saved, [[7, 42, false]]);
  const edit = ok.sent.find(c => c.method === 'editMessageText').payload;
  assert.equal(edit.message_id, 100);
  assert.match(edit.text, /выключена/);
  assert.deepEqual(edit.reply_markup.inline_keyboard[0].map(b => b.callback_data), ['digest:on']);

  const broken = processor({ setBotDigestSubscription: async () => { throw new Error('Supabase bot_digest_subscriptions: HTTP 503'); } });
  await broken.run(request, {}, callback('digest:on'));
  const alert = broken.sent.find(c => c.method === 'answerCallbackQuery').payload;
  assert.equal(alert.show_alert, true);
  assert.match(alert.text, /Не удалось сохранить/);
  assert.ok(!broken.sent.some(c => c.method === 'editMessageText' || c.method === 'sendMessage'), 'no success message after a failed save');
});

test('inline: an unavailable search is not shown as «Матч не найден» and is not cached', async () => {
  const answer = async store => {
    const calls = [];
    const runtime = createTelegramSearchRuntime(proxy({
      getCache: async key => store[key] ?? null,
      getStaleCache: async () => null,
      todayUtc: () => '2026-10-15',
      loadSearchTeamMatches: async () => ({ matches: [] }),
      searchText: value => String(value).toLowerCase(),
      topTeamSearchPlan: query => ({ providerQuery: query, candidates: [], resolved: false, best: null }),
      normalizeSearchTeam: row => row,
      rankTeamDiscoveryMatches: matches => matches,
      telegramApi: async (method, _cfg, payload) => { calls.push(payload); return {}; },
    }));
    await runtime.answerBotInlineQuery({ url: 'https://app.example/telegram' }, {}, { id: 'q1', from: { id: 77 }, query: 'Zzzz United' });
    return calls[0];
  };
  const down = await answer({});
  assert.equal(down.button.text, 'Поиск временно недоступен — открыть MatchRadar');
  assert.equal(down.cache_time, 0);
  const none = await answer({ 'matches:2026-10-15:v6-integrity': { matches: [], refreshedAt: new Date().toISOString() } });
  assert.equal(none.button.text, 'Матч не найден — открыть MatchRadar');
  assert.ok(none.cache_time > 0);
});
