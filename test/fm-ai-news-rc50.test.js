import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createFootballNewsRuntime } from '../src/football-news-runtime.js';

const orchestration=fs.readFileSync(
  'src/telegram-update-orchestration.js',
  'utf8',
);
const digestRuntimeSource=fs.readFileSync(
  'src/telegram-digest-runtime.js',
  'utf8',
);
const html=fs.readFileSync('public/index.html','utf8');

const NEWS_BLOCKED_HOST_RE=/(?:^|\.)(?:facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|pinterest\.[a-z.]+|bet365\.com)$/i;
const NEWS_MAJOR_SOURCE_RE=/(?:^|\.)(?:reuters\.com|apnews\.com|bbc\.(?:com|co\.uk)|espn\.com|skysports\.com|theathletic\.com|goal\.com|marca\.com|as\.com|lequipe\.fr|kicker\.de|gazzetta\.it)$/i;
const NEWS_OFFICIAL_SOURCE_RE=/(?:^|\.)(?:uefa\.com|fifa\.com|premierleague\.com|laliga\.com|bundesliga\.com|legaseriea\.it|ligue1\.com)$/i;

function searchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9 ]/gi,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function harness(overrides={}) {
  const cache=new Map();
  const calls={
    fetch:[],
    setCache:[],
    telegram:[],
    growth:[],
  };
  const deps={
    NEWS_BLOCKED_HOST_RE,
    NEWS_MAJOR_SOURCE_RE,
    NEWS_OFFICIAL_SOURCE_RE,
    TOP_TEAM_SEARCH_CATALOG:[
      {
        canonical:'Arsenal',
        country:'England',
        aliases:['arsenal','арсенал'],
      },
      {
        canonical:'Barcelona',
        country:'Spain',
        aliases:['barcelona','барселона'],
      },
    ],
    botTeamIdMatches:async()=>[],
    fetchWithTimeout:async(url,init,timeout,label)=>{
      calls.fetch.push({url,init,timeout,label});
      return {
        ok:true,
        status:200,
        json:async()=>({results:[]}),
      };
    },
    getCache:async key=>cache.get(key) ?? null,
    getFavorites:async()=>[],
    normalizeBotFixtureCard:value=>value,
    recordGrowthEvent:async(...args)=>{calls.growth.push(args);},
    searchText,
    setCache:async(key,id,value,cfg,ttl)=>{
      calls.setCache.push({key,id,value,cfg,ttl});
      cache.set(key,value);
    },
    telegramApi:async(method,cfg,payload)=>{
      calls.telegram.push({method,cfg,payload});
      return {ok:true};
    },
    telegramHtmlEscape:value=>String(value ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#39;"),
    todayUtc:()=> '2026-10-07',
    ...overrides,
  };
  return {
    api:createFootballNewsRuntime(deps),
    deps,
    cache,
    calls,
  };
}

test('RC50 football news runtime validates dependencies and exposes a frozen boundary',()=>{
  const h=harness();
  assert.equal(Object.isFrozen(h.api),true);

  const broken={...h.deps,fetchWithTimeout:null};
  assert.throws(
    ()=>createFootballNewsRuntime(broken),
    /fetchWithTimeout is required/,
  );
});

test('news URLs and source trust are based on the actual hostname, not path spoofing',()=>{
  const {api}=harness();

  assert.equal(
    api.externalNewsUrl('javascript:alert(1)'),
    '',
  );
  assert.equal(
    api.externalNewsUrl('https://user:secret@example.com/story'),
    '',
  );
  assert.equal(
    api.externalNewsUrl({toString(){return 'https://reuters.com';}}),
    '',
  );

  assert.equal(
    api.newsSourceTrust('https://www.uefa.com/news/club').tier,
    'official',
  );
  assert.equal(
    api.newsSourceTrust('https://www.reuters.com/world/football').tier,
    'major',
  );
  assert.equal(
    api.newsSourceTrust('https://evil.example/path/reuters.com').tier,
    'web',
  );
  assert.equal(
    api.newsSourceTrust('https://reuters.com.evil.example/story').tier,
    'web',
  );

  assert.equal(
    api.normalizeFootballNewsResult({
      url:'https://x.com/example/status/1',
      title:'Football update',
      content:'news',
    }),
    null,
  );
});

test('high-impact web headlines are downgraded until a trusted source confirms them',()=>{
  const {api}=harness();

  const web=api.normalizeFootballNewsResult({
    url:'https://example.com/injury',
    title:'Arsenal player ruled out with injury',
    content:'The player will miss the next match.',
    published_date:'2026-10-07T09:00:00Z',
  });
  const gatedWeb=api.applyNewsTrustGate(web);
  assert.equal(gatedWeb.category.code,'injury');
  assert.equal(gatedWeb.category.impact,'medium');
  assert.equal(gatedWeb.verification,'needs_confirmation');

  const official=api.normalizeFootballNewsResult({
    url:'https://www.uefa.com/news/injury',
    title:'Player ruled out with injury',
    content:'Official update.',
    published_date:'2026-10-07T09:00:00Z',
  });
  const gatedOfficial=api.applyNewsTrustGate(official);
  assert.equal(gatedOfficial.category.impact,'high');
  assert.equal(gatedOfficial.verification,'source_backed');
});

test('news helper boundaries tolerate hostile article metadata without coercion',()=>{
  const {api}=harness();

  const hostileCategory={};
  Object.defineProperty(hostileCategory,'impact',{
    enumerable:true,
    get(){throw new Error('hostile impact getter');},
  });
  Object.defineProperty(hostileCategory,'code',{
    enumerable:true,
    get(){throw new Error('hostile code getter');},
  });

  assert.doesNotThrow(
    ()=>api.footballNewsImpactText(hostileCategory,true),
  );
  assert.match(
    api.footballNewsImpactText(hostileCategory,true),
    /Проверяем/,
  );

  const hostileItem={
    url:'https://example.com/a',
    title:'Arsenal injury update',
    content:'injury',
    category:hostileCategory,
  };
  assert.doesNotThrow(()=>api.applyNewsTrustGate(hostileItem));

  assert.equal(
    api.newsConversionHook(
      {title:'Arsenal update',content:'club news',category:{code:'club'}},
      {fixtureId:{valueOf(){throw new Error('must not coerce fixture');}}},
    ).includes('Найти ближайший матч Arsenal'),
    true,
  );
});

test('news publication time is deterministic and invalid calendar tokens fail closed',()=>{
  const {api}=harness();

  assert.equal(
    api.newsPublishedMs({publishedAt:'2026-10-07T10:00:00'}),
    null,
  );
  assert.equal(
    api.newsPublishedMs({publishedAt:'2026-10-07T10:00:00+03:00'}),
    Date.parse('2026-10-07T10:00:00+03:00'),
  );
  assert.equal(
    api.newsPublishedMs({publishedAt:'2026-10-07'}),
    Date.parse('2026-10-07T12:00:00Z'),
  );
  assert.equal(
    api.newsPublishedAtFromDayToken('20260231'),
    '',
  );
  assert.equal(
    api.newsPublishedAtFromDayToken('20261007'),
    '2026-10-07T12:00:00Z',
  );
});

test('Tavily news mode is strict, bounded and rejects malformed success payloads',async()=>{
  const {api,calls}=harness({
    fetchWithTimeout:async(url,init,timeout,label)=>{
      calls.fetch.push({url,init,timeout,label});
      return {
        ok:true,
        status:200,
        json:async()=>({
          results:[
            {
              url:'https://www.reuters.com/sports/football/a',
              title:'Arsenal lineup update',
              content:'Starting XI expected soon.',
              published_date:'2026-10-07T08:00:00Z',
            },
          ],
        }),
      };
    },
  });

  const result=await api.tavilyNewsSearch(
    'Arsenal latest',
    {tavilyKey:'secret'},
    {days:'14',maxResults:'10'},
  );
  assert.equal(result.available,true);
  assert.equal(result.results.length,1);

  const payload=JSON.parse(calls.fetch[0].init.body);
  assert.equal(payload.topic,'news');
  assert.equal(payload.include_answer,false);
  assert.equal(payload.days,3);
  assert.equal(payload.max_results,7);

  const malformed=harness({
    fetchWithTimeout:async()=>({
      ok:true,
      status:200,
      json:async()=>({results:{0:'not-an-array'}}),
    }),
  });
  assert.deepEqual(
    await malformed.api.tavilyNewsSearch(
      'football',
      {tavilyKey:'secret'},
    ),
    {results:[],available:false,reason:'invalid_payload'},
  );

  const truthy=harness({
    fetchWithTimeout:async()=>({
      ok:'true',
      status:200,
      json:async()=>({results:[]}),
    }),
  });
  assert.equal(
    (await truthy.api.tavilyNewsSearch(
      'football',
      {tavilyKey:'secret'},
    )).available,
    false,
  );
});

test('cached news is re-sanitized and old unsafe cache generations are not reused',async()=>{
  const {api,cache,calls}=harness();

  cache.set('bot:news:general:current:v2',{
    available:true,
    items:[
      {
        url:'https://www.reuters.com/sports/football/a',
        title:'Arsenal lineup update',
        content:'Starting XI update.',
        publishedAt:'2026-10-07T08:00:00.000Z',
      },
      {
        url:'https://x.com/example/status/1',
        title:'Blocked social post',
        content:'rumor',
        publishedAt:'2026-10-07T08:00:00.000Z',
      },
    ],
  });
  cache.set('bot:news:general:current:v1',{
    available:true,
    items:[{
      url:'https://evil.example/old',
      title:'Old cache generation',
      content:'old',
    }],
  });

  const result=await api.currentGeneralFootballNews({},false);
  assert.equal(result.cached,true);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].source,'reuters.com');
  assert.equal(calls.fetch.length,0);
});

test('dedupe keeps one canonical article and rejects coercive rows and limits',()=>{
  const {api}=harness();
  const rows=[
    {
      url:'https://example.com/a',
      title:'Same football injury update',
      content:'injury',
      published_date:'2026-10-07',
    },
    {
      url:'https://example.com/b',
      title:'Same football injury update',
      content:'injury duplicate',
      published_date:'2026-10-07',
    },
    {
      url:{toString(){return 'https://example.com/c';}},
      title:'Must not coerce URL',
    },
  ];

  assert.equal(api.dedupeFootballNews(rows,10).length,1);
  assert.equal(api.dedupeFootballNews(rows,'10').length,1);
});

test('news conversion keyboard never emits unsafe source URLs or coercive fixture ids',()=>{
  const {api}=harness();
  const safe={
    url:'https://example.com/a',
    title:'Arsenal injury update',
    content:'injury',
    publishedAt:'2026-10-07T08:00:00Z',
    category:{code:'injury'},
  };
  const unsafe={
    url:'javascript:alert(1)',
    title:'Unsafe',
    content:'bad',
  };

  const keyboard=api.newsConversionKeyboard(
    [unsafe,safe],
    [],
    {fixtureId:true},
  );

  assert.equal(keyboard.inline_keyboard.length,1);
  assert.equal(
    keyboard.inline_keyboard[0][0].url,
    'https://example.com/a',
  );
  assert.match(
    keyboard.inline_keyboard[0][1].callback_data,
    /^news:ai_team:arsenal:/,
  );
});

test('general Telegram news ignores malformed favorite ids and survives telemetry failure',async()=>{
  const {api,cache,calls}=harness({
    getFavorites:async()=>[
      {team_id:40,team_name:'Liverpool'},
      {team_id:true,team_name:'Invalid'},
      {team_id:{valueOf(){throw new Error('must not coerce');}},team_name:'Invalid'},
    ],
    recordGrowthEvent:()=>{throw new Error('telemetry unavailable');},
  });

  cache.set('bot:news:general:current:v2',{
    available:true,
    items:[{
      url:'https://www.reuters.com/sports/football/a',
      title:'Liverpool lineup news',
      content:'Starting lineup update.',
      publishedAt:'2026-10-07T08:00:00Z',
    }],
  });

  await assert.doesNotReject(
    ()=>api.sendGeneralFootballNews({}, {}, 7, 99, {force:false}),
  );
  assert.equal(calls.telegram.length,1);
  const keyboard=calls.telegram[0].payload.reply_markup.inline_keyboard;
  const callbacks=keyboard.flat().map(item=>item.callback_data).filter(Boolean);
  assert.ok(callbacks.includes('news:team:40'));
  assert.equal(callbacks.some(value=>/news:team:(?:true|NaN|0)$/.test(value)),false);
});

test('favorite-team news validates membership and links a real upcoming fixture',async()=>{
  const now=Date.now();
  const future=new Date(now+6*60*60*1000).toISOString();
  const {api,cache,calls}=harness({
    getFavorites:async()=>[
      {team_id:40,team_name:'Liverpool'},
    ],
    botTeamIdMatches:async()=>[{
      fixtureId:9001,
      date:future,
      live:false,
      finished:false,
      homeName:'Liverpool',
      awayName:'Arsenal',
    }],
  });

  cache.set('bot:news:team:40:v2',{
    available:true,
    items:[{
      url:'https://www.reuters.com/sports/football/a',
      title:'Liverpool injury update',
      content:'Player ruled out.',
      publishedAt:new Date(now).toISOString(),
    }],
  });

  await api.sendFavoriteTeamNews({}, {}, 7, 99, '40', {force:false});
  const message=calls.telegram.at(-1).payload;
  assert.match(message.text,/Проверить|Матч:/);
  assert.ok(
    message.reply_markup.inline_keyboard
      .flat()
      .some(item=>item.callback_data==='news:match:9001'),
  );

  const before=calls.telegram.length;
  await api.sendFavoriteTeamNews({}, {}, 7, 99, true, {force:false});
  assert.equal(calls.telegram.length,before+1);
  assert.match(
    calls.telegram.at(-1).payload.text,
    /не найдена в вашем избранном/,
  );
});

test('morning news cache is optional, sanitized and reports degraded source state',async()=>{
  const {api,cache}=harness();
  cache.set('bot:news:general:current:v2',{
    available:false,
    reason:'http_503',
    items:[
      {
        url:'https://example.com/a',
        title:'Morning football update',
        content:'club update',
        publishedAt:'2026-10-07T06:00:00Z',
      },
      {
        url:'https://x.com/example/status/1',
        title:'Blocked morning item',
        content:'rumor',
        publishedAt:'2026-10-07T06:00:00Z',
      },
    ],
  });

  const morning=await api.currentMorningFootballNews({});
  assert.equal(morning.degraded,true);
  assert.equal(morning.items.length,1);
  assert.match(api.morningNewsText(morning.items),/Главное за утро/);
});

test('Telegram navigation owns news while Mini App remains intentionally separate',()=>{
  assert.match(orchestration,/text === '📰 Новости'/);
  assert.match(orchestration,/sendGeneralFootballNews/);
  assert.match(orchestration,/^\s*const newsTeamAction=/m);
  assert.doesNotMatch(html,/id="newsView"/);

  assert.match(
    digestRuntimeSource,
    /currentMorningFootballNews\(cfg\)\.catch\(\(\)=>\(\{/,
  );
  assert.match(
    digestRuntimeSource,
    /sendNews:newsText[\s\S]{0,180}?telegramApi\('sendMessage'/,
  );
});
