import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramSearchRuntime } from '../src/telegram-search-runtime.js';

function baseDeps(overrides = {}) {
  return {
    apiFootball: async () => [],
    digestTime: value => String(value || 'время уточняется'),
    footballMatchActionKeyboard: () => ({inline_keyboard:[]}),
    footballSearchHandoffKeyboard: (_request,match) => ({
      inline_keyboard:[[{text:'AI',callback_data:`match:menu:${match.fixtureId}`}]],
    }),
    freeQuotaHealthy: () => true,
    getCache: async () => null,
    getHistory: async () => [],
    loadPublicAiTrackRecord: async () => ({available:false}),
    loadSearchTeamMatches: async () => ({matches:[]}),
    normalizeSearchTeam: row => row?.team || row || {},
    rankTeamDiscoveryMatches: matches => Array.isArray(matches) ? matches : [],
    recordGrowthEvent: () => {},
    rememberBotFixtureCards: async () => {},
    searchText: value => String(value || '').trim().toLowerCase(),
    setCache: async () => true,
    telegramApi: async () => ({}),
    telegramWebAppUrl: (request,params = {}) => {
      const url=new URL(request.url);
      url.pathname='/';
      url.search='';
      url.hash='';
      for (const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
      return url.toString();
    },
    todayUtc: () => '2026-10-07',
    topTeamSearchPlan: query => ({
      providerQuery:query,
      candidates:[],
      resolved:false,
      best:null,
    }),
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return createTelegramSearchRuntime(baseDeps(overrides));
}

test('Telegram search runtime rejects malformed dependency bags and missing contracts', () => {
  assert.throws(
    () => createTelegramSearchRuntime(null),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelegramSearchRuntime([]),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelegramSearchRuntime({}),
    /apiFootball is required/,
  );
});

test('Telegram search text helpers fail closed on hostile and malformed values', () => {
  const api=runtime({
    searchText: value => {
      if (value === 'explode') throw new Error('normalizer failed');
      return String(value || '').toLowerCase();
    },
  });

  assert.equal(api.telegramHtmlEscape({toString(){ throw new Error('boom'); }}),'');
  assert.deepEqual(api.botSearchParts({toString(){ throw new Error('boom'); }}),{
    query:'',
    first:'',
    second:'',
    intent:'search',
  });
  assert.equal(api.botSearchParts('/search explode').query,'explode');
  assert.equal(api.botMatchScore([],{}),0);
  assert.equal(api.botMatchScore({},[]),0);
});

test('Telegram match rendering escapes provider text and tolerates broken formatter output', () => {
  const api=runtime({
    digestTime: () => '<script>alert(1)</script>',
  });

  const line=api.botMatchLine({
    fixtureId:77,
    home:{name:'<Home & Co>'},
    away:{name:'Away > Team'},
    league:'<League>',
    date:'2026-10-07T20:00:00Z',
    selection:{primary:true,reason:'<best>'},
  },0);

  assert.match(line,/&lt;Home &amp; Co&gt;/);
  assert.match(line,/Away &gt; Team/);
  assert.match(line,/&lt;League&gt;/);
  assert.match(line,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(line,/&lt;best&gt;/);
  assert.doesNotMatch(line,/<script>|<Home & Co>|<League>/);
  assert.equal(api.botMatchLine({fixtureId:0},0),'');
});

test('Telegram cached search ignores malformed cache payloads and invalid fixture cards', async () => {
  const api=runtime({
    getCache: async () => ({
      matches:[
        null,
        [],
        {fixtureId:0,home:{name:'Arsenal'},away:{name:'Chelsea'}},
        {fixtureId:10,home:{name:'Arsenal'},away:{name:'Chelsea'},date:'2026-10-07T20:00:00Z'},
      ],
    }),
  });

  const matches=await api.botCachedDayMatches(
    {query:'Arsenal',first:'Arsenal',second:'',intent:'search'},
    {},
  );
  assert.deepEqual(matches.map(match=>match.fixtureId),[10]);

  const failed=runtime({
    todayUtc: () => { throw new Error('clock failed'); },
  });
  assert.deepEqual(await failed.botCachedDayMatches({query:'Arsenal'},{}),[]);
});

test('Telegram remote search fails safely on quota provider and discovery boundary failures', async () => {
  let providerCalls=0;
  const quotaBlocked=runtime({
    freeQuotaHealthy: () => { throw new Error('quota failed'); },
    apiFootball: async () => {
      providerCalls += 1;
      return [];
    },
  });
  assert.deepEqual(
    await quotaBlocked.botRemoteTeamMatches({first:'Arsenal',second:''},{}),
    [],
  );
  assert.equal(providerCalls,0);

  const malformedProvider=runtime({
    getCache: async () => ({teams:'not-an-array'}),
    apiFootball: async () => ({response:'not-an-array'}),
  });
  assert.deepEqual(
    await malformedProvider.botRemoteTeamMatches({first:'Arsenal',second:''},{}),
    [],
  );
});

test('Telegram search suppresses analytics failures and does not expose broken callback cards', async () => {
  const sent=[];
  const api=runtime({
    getCache: async key => key.startsWith('matches:')
      ? {
          matches:[{
            fixtureId:101,
            home:{name:'Arsenal'},
            away:{name:'Chelsea'},
            league:'Premier League',
            date:'2026-10-07T20:00:00Z',
          }],
        }
      : null,
    rankTeamDiscoveryMatches: matches => matches.map((match,index)=>({
      ...match,
      selection:{primary:index===0,reason:'best'},
    })),
    recordGrowthEvent: () => Promise.reject(new Error('analytics offline')),
    rememberBotFixtureCards: async () => { throw new Error('cache offline'); },
    telegramApi: async (method,_cfg,payload) => {
      sent.push({method,payload});
      return {};
    },
  });

  await api.sendBotFootballSearch(
    new Request('https://app.example/telegram/webhook'),
    {},
    55,
    66,
    'Arsenal',
  );

  assert.equal(sent.length,1);
  assert.equal(sent[0].method,'sendMessage');
  assert.equal(sent[0].payload.chat_id,66);
  assert.match(sent[0].payload.text,/Arsenal/);
  const buttons=sent[0].payload.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.some(button=>String(button.callback_data || '').startsWith('match:menu:')),false);
  assert.equal(buttons.some(button=>button.web_app?.url?.startsWith('https://app.example/')),true);
});

test('Telegram search validates Telegram user and chat identifiers before side effects', async () => {
  let calls=0;
  const api=runtime({
    telegramApi: async () => {
      calls += 1;
      return {};
    },
  });

  await assert.rejects(
    () => api.sendBotFootballSearch(new Request('https://app.example/'),{},0,1,'Arsenal'),
    error=>error?.code==='TELEGRAM_USER_INVALID',
  );
  await assert.rejects(
    () => api.sendBotFootballSearch(new Request('https://app.example/'),{},1,0,'Arsenal'),
    error=>error?.code==='TELEGRAM_CHAT_INVALID',
  );
  assert.equal(calls,0);
});

test('Telegram AI track record normalizes malformed evidence and escapes HTML', () => {
  const api=runtime();

  assert.equal(
    api.botAiTrackRecordText({available:true,recent:'broken'}),
    [
      '📈 <b>Протокол MatchRadar AI</b>',
      'Период: последние 180 дней',
      '',
      'Проверенных матчей: <b>0</b>',
      'Совпало / не совпало: <b>0 / 0</b>',
      'Статус выборки: <b>—</b>',
      'Ошибка Брайера: пока недостаточно данных',
      '',
      '<i>Это история вероятностей модели, а не «винрейт» и не показатель доходности ставок. Прошлые результаты не гарантируют будущие.</i>',
    ].join('\n'),
  );

  const text=api.botAiTrackRecordText({
    available:true,
    sample:{verified:1,matched:1,missed:0,label:'<Ready>',message:'<unsafe>'},
    probabilityQuality:{avgBrier:0.125},
    recent:[{
      matched:true,
      home:'<Home>',
      away:'Away & Co',
      score:'2:1',
      predictedLabel:'<P1>',
      topProbability:61.2,
      actualLabel:'П1',
    }],
  });
  assert.match(text,/&lt;Ready&gt;/);
  assert.match(text,/&lt;unsafe&gt;/);
  assert.match(text,/&lt;Home&gt;/);
  assert.match(text,/Away &amp; Co/);
  assert.match(text,/&lt;P1&gt;/);
  assert.doesNotMatch(text,/<Ready>|<unsafe>|<Home>|<P1>/);
});

test('Telegram last verdict ignores invalid confidence and malformed history', async () => {
  const sent=[];
  const api=runtime({
    getHistory: async () => [{
      fixture_id:77,
      home_name:'Home',
      away_name:'Away',
      ai_signal_label:'П1',
      ai_confidence:'not-a-number',
      ai_risk:'HIGH',
      ai_outcome:'2:0',
    }],
    telegramApi: async (_method,_cfg,payload) => {
      sent.push(payload);
      return {};
    },
  });

  assert.equal(api.lastAiVerdictText([]),'История AI-разборов пока пуста.');
  assert.doesNotMatch(api.lastAiVerdictText({
    fixture_id:77,
    home_name:'Home',
    away_name:'Away',
    ai_signal_label:'П1',
    ai_confidence:999,
  }),/999\/100/);

  await api.sendLastAiVerdict(
    new Request('https://app.example/telegram/webhook'),
    {},
    55,
    -100123,
  );
  assert.equal(sent.length,1);
  assert.equal(sent[0].chat_id,-100123);
  assert.match(sent[0].text,/Последний AI-разбор/);
});
