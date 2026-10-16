import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTelegramDigestRuntime } from '../src/telegram-digest-runtime.js';
import { createTelegramBotOrchestrationRuntime } from '../src/telegram-bot-orchestration-runtime.js';
import { createTelegramBotUiRuntime } from '../src/telegram-bot-ui-runtime.js';
import { createTelegramUpdateProcessor } from '../src/telegram-update-orchestration.js';
import { createTelegramSearchRuntime } from '../src/telegram-search-runtime.js';
import { chatAllowsWebApp, chatSafeTelegramBody } from '../src/telegram-chat-markup.js';

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

test('notifications retain match settings while retired news and digest buttons never fetch or subscribe', async () => {
  const settings=processor({getBotDigestSubscription:async()=>assert.fail('retired setting read')});
  await settings.run(request,{}, {message:{chat:{id:42,type:'private'},from:{id:7},text:'⚙️ Уведомления'}});
  const shown=settings.sent.find(c=>c.method==='sendMessage').payload;
  assert.match(shown.text,/Уведомления/);
  assert.ok(shown.reply_markup.inline_keyboard.flat().some(b=>b.web_app));
  assert.doesNotMatch(JSON.stringify(shown),/digest:|подборк|news:/);
  for(const data of ['digest:on','digest:off','news:general','news:refresh','news:team:40','news:ai_match:77','news:impact:material:news:77','ni:r:material:news:retry:77']){
    const h=processor({setBotDigestSubscription:async()=>assert.fail('retired subscription write'),sendGeneralFootballNews:async()=>assert.fail('news fetch'),sendFavoriteTeamNews:async()=>assert.fail('club news fetch'),sendBotFixtureMenu:async()=>assert.fail('retired news action')});
    await h.run(request,{},callback(data));
    assert.equal(h.sent.length,1,data);
    assert.equal(h.sent[0].method,'answerCallbackQuery');
    assert.match(h.sent[0].payload.text,/больше недоступен/);
  }
});

test('inline: an unavailable search is not shown as «Матч не найден» and is not cached', async () => {
  const answer = async store => {
    const calls = [];
    const runtime = createTelegramSearchRuntime(proxy({
      getCache: async key => store[key] ?? null,
      getStaleCache: async () => null,
      todayUtc: () => '2026-10-15',
      loadSearchTeamMatches: async () => ({ matches: [] }),
      freeQuotaHealthy: () => true,
      apiFootball: async () => [],
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

// Ревью Codex #927.

test('real sendBotFixtureMenu handoff: no confidence /100, data quality % or empty freshness', async () => {
  const handoff = createTelegramBotOrchestrationRuntime({ telegramHtmlEscape: value => String(value) });
  const match = { fixtureId: 7, date: '2099-10-20T18:00:00Z', status: 'NS', home: { id: 1, name: 'Home' }, away: { id: 2, name: 'Away' }, league: 'L' };
  const analysis = {
    match,
    aiInstructor: {
      betSignal: { code: 'home', reason: 'Хозяева сильнее по форме.' },
      verdict: { outcome: 'П1 · 52%' },
      confidenceScore: 62, confidenceLabel: 'Средняя', riskLabel: 'Высокий',
      dataTrust: { score: 44, label: 'Ограниченные данные' },
    },
  };
  const send = async (extra = {}) => {
    const sent = [];
    const ui = createTelegramBotUiRuntime(proxy({
      telegramWebAppUrl: (_req, params) => `https://app.example/?${new URLSearchParams(params)}`,
      telegramFullAnalysisUrl: (_req, id, tab) => `https://app.example/?fixtureId=${id}&action=analysis&tab=${tab}`,
      telegramHtmlEscape: value => String(value),
      isLiveStatus: status => status === '1H',
      isFinishedStatus: status => status === 'FT',
      statusLabel: status => status,
      createRequest: (url, init) => new Request(url, init),
      markTelegramWebhookMutation: () => true,
      getCache: async key => (key === 'bot:fixture-card:7:v2' ? { match } : null),
      getFavorites: async () => [],
      apiAnalyze: async () => new Response(JSON.stringify({ ...analysis, ...extra }), { status: 200 }),
      botAiHandoffText: data => handoff.botAiHandoffText(data),
      telegramApi: async (method, _cfg, payload) => { sent.push({ method, payload }); return {}; },
    }));
    assert.equal(await ui.sendBotFixtureMenu(new Request('https://app.example/telegram'), {}, 77, 77, 7), true);
    return sent.find(c => c.method === 'sendMessage').payload.text;
  };
  const text = await send();
  assert.match(text, /короткая оценка/);
  assert.match(text, /Почему: Хозяева сильнее по форме\./);
  assert.doesNotMatch(text, /\/100|44%|Уверенность|Неопределённость|Данные: |Свежесть|мин\./);
  // Существенное предупреждение о данных остаётся — без шкал.
  const stale = await send({ freshness: { state: 'stale', label: 'Данные устарели', reason: 'Составы изменились после разбора.', needsRecheck: true, ageMinutes: 300 } });
  assert.match(stale, /🟠 Данные устарели: Составы изменились после разбора\./);
  assert.doesNotMatch(stale, /300 мин|\/100/);
});

test('inline with a day feed: a failing provider search is «temporarily unavailable», not «not found»', async () => {
  let providerCalls = 0;
  const answer = async ({ apiFootball, loadSearchTeamMatches = async () => ({ matches: [] }), quota = true }) => {
    const calls = [];
    const runtime = createTelegramSearchRuntime(proxy({
      getCache: async key => (key === 'matches:2026-10-15:v6-integrity' ? { matches: [], refreshedAt: new Date().toISOString() } : null),
      getStaleCache: async () => null,
      todayUtc: () => '2026-10-15',
      freeQuotaHealthy: () => quota,
      apiFootball: async (...args) => { providerCalls += 1; return apiFootball(...args); },
      loadSearchTeamMatches,
      searchText: value => String(value).toLowerCase(),
      topTeamSearchPlan: query => ({ providerQuery: query, candidates: [], resolved: false, best: null }),
      normalizeSearchTeam: row => ({ id: Number(row?.team?.id || row?.id || 0), name: String(row?.team?.name || row?.name || ''), score: 200 }),
      rankTeamDiscoveryMatches: matches => matches,
      telegramApi: async (method, _cfg, payload) => { calls.push(payload); return {}; },
    }));
    await runtime.answerBotInlineQuery({ url: 'https://app.example/telegram' }, {}, { id: 'q1', from: { id: 77 }, query: 'Zzzz United' });
    return calls[0];
  };
  const timeout = await answer({ apiFootball: async () => { throw Object.assign(new Error('API-Football /teams timeout'), { code: 'UPSTREAM_TIMEOUT' }); } });
  assert.equal(timeout.button.text, 'Поиск временно недоступен — открыть MatchRadar');
  assert.equal(timeout.cache_time, 0);
  assert.equal(providerCalls, 1, 'no extra provider calls');

  const matchesDown = await answer({
    apiFootball: async () => [{ id: 9, name: 'Zzzz United' }],
    loadSearchTeamMatches: async () => { throw new Error('fixtures timeout'); },
  });
  assert.equal(matchesDown.button.text, 'Поиск временно недоступен — открыть MatchRadar');
  assert.equal(matchesDown.cache_time, 0);

  const limited = await answer({ apiFootball: async () => [], quota: false });
  assert.equal(limited.button.text, 'Поиск временно недоступен — открыть MatchRadar', 'provider budget guard is respected, not bypassed');
  assert.equal(providerCalls, 2, 'no provider call when the budget guard blocks the search');

  const empty = await answer({ apiFootball: async () => [] });
  assert.equal(empty.button.text, 'Матч не найден — открыть MatchRadar');
  assert.ok(empty.cache_time > 0);
});

test('removed news and digest commands return the current menu without provider or subscription work',async()=>{
  for(const text of ['/news','/digest','/digest_off','/picks','📰 Новости','☀️ Утренняя подборка','🧠 AI-подборка']){
    const h=processor({setBotDigestSubscription:async()=>assert.fail('subscription mutation'),sendGeneralFootballNews:async()=>assert.fail('news request'),sendDailyPicks:async()=>assert.fail('picks delivery'),sendBotFootballSearch:async()=>assert.fail('retired command must not become search')});
    await h.run(request,{}, {message:{chat:{id:42,type:'private'},from:{id:7},text}});
    assert.equal(h.sent.length,1,text);
    assert.equal(h.sent[0].method,'sendMessage');
    assert.match(h.sent[0].payload.text,/Меню обновлено/);
  }
});
