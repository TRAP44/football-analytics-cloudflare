import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSearchDiscoveryRuntime } from '../src/search-discovery-runtime.js';
import { createTelegramSearchRuntime } from '../src/telegram-search-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createSearchRuntime(overrides = {}) {
  return createSearchDiscoveryRuntime({
    COMPETITIONS:new Map(),
    apiFootball:async()=>[],
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,
    getStaleCache:async()=>null,
    isFootballRateLimitError:()=>false,
    isRetryableFootballTransportError:()=>false,
    isYouthReserveMatch:()=>false,
    json:body=>body,
    loadProviderTeamDiscoveryFixtures:async()=>[],
    normalizeCountryName:value=>String(value || ''),
    normalizeTeamHubMatch:value=>value,
    publicDataCapabilities:()=>({}),
    setCache:async()=>null,
    ...overrides,
  });
}

function createTelegramRuntime(searchRuntime,{events=[],messages=[]}={}) {
  return createTelegramSearchRuntime({
    apiFootball:async()=>[],
    digestTime:value=>String(value || ''),
    footballMatchActionKeyboard:()=>null,
    footballSearchHandoffKeyboard:()=>null,
    freeQuotaHealthy:()=>false,
    getCache:async()=>null,
    getHistory:async()=>[],
    loadPublicAiTrackRecord:async()=>({available:false}),
    loadSearchTeamMatches:async()=>({matches:[]}),
    normalizeSearchTeam:(...args)=>searchRuntime.normalizeSearchTeam(...args),
    rankTeamDiscoveryMatches:(...args)=>searchRuntime.rankTeamDiscoveryMatches(...args),
    recordGrowthEvent:async(_cfg,event)=>{ events.push(event); return true; },
    rememberBotFixtureCards:async()=>true,
    searchText:(...args)=>searchRuntime.searchText(...args),
    setCache:async()=>null,
    telegramApi:async(method,_cfg,payload)=>{
      messages.push({method,payload});
      return {ok:true};
    },
    telegramWebAppUrl:(request,params={})=>{
      const url=new URL(request.url);
      url.pathname='/';
      url.search='';
      for (const [key,value] of Object.entries(params)) {
        url.searchParams.set(key,String(value));
      }
      return url.toString();
    },
    todayUtc:()=> '2026-10-07',
    topTeamSearchPlan:(...args)=>searchRuntime.topTeamSearchPlan(...args),
  });
}

const app=readRepoFile('public/app.js');
const css=readRepoFile('public/styles.css');
const growthRuntime=readRepoFile('src/growth-analytics-runtime.js');
const adminLaunchFunnel=readRepoFile('public/modules/admin-launch-funnel.js');
const capabilities=readRepoFile('src/app-capabilities.js');

test('RC55 search normalization handles punctuation, composed/decomposed Unicode and pasted invisible separators',()=> {
  const runtime=createSearchRuntime();

  const cases=[
    ['МЮ','Manchester United'],
    ['мю!!!','Manchester United'],
    ['Бока-Хуниорс','Boca Juniors'],
    ['Al‑Nassr','Al-Nassr'],
    ['Fenerbahçe','Fenerbahce'],
    ['Sa\u0303o Paulo','Sao Paulo'],
    ['Ｂａｙｅｒｎ　Ｍüｎｃｈｅｎ','Bayern Munich'],
    ['Интер\u200BМайами','Inter Miami'],
  ];

  for (const [query,expected] of cases) {
    const plan=runtime.topTeamSearchPlan(query);
    assert.equal(plan.best?.canonical,expected,query);
    assert.ok(Number(plan.best?.score || 0)>=170,query);
  }

  assert.equal(runtime.searchText('Sa\u0303o Paulo'),'sao paulo');
  assert.equal(runtime.searchText('Ｒｅａｌ　Ｍａｄｒｉｄ'),'real madrid');
  assert.equal(runtime.searchText('Интер\u200BМайами'),'интер маиами');
  assert.equal(runtime.searchQualityDrill().pass,true);
  assert.equal(runtime.searchQualityDrill().total,21);
});

test('telegram match parsing keeps internal club hyphens and splits only an actual match separator',()=> {
  const searchRuntime=createSearchRuntime();
  const telegram=createTelegramRuntime(searchRuntime);

  const parsed=telegram.botSearchParts(
    'что поставить на Бока-Хуниорс - Ривер-Плейт',
  );
  assert.equal(parsed.intent,'pick');
  assert.equal(parsed.first,'Бока-Хуниорс');
  assert.equal(parsed.second,'Ривер-Плейт');

  const compact=telegram.botSearchParts('Al-Nassr — Inter Miami');
  assert.equal(compact.first,'Al-Nassr');
  assert.equal(compact.second,'Inter Miami');
});

test('recognized fallback remains actionable instead of becoming a dead result',()=> {
  assert.match(app,/function knownTeamSummaryCard\(/);
  assert.match(app,/data-known-team-query/);
  assert.match(app,/void runGlobalSearch\(\)/);
  assert.match(app,/Повторить →/);
  assert.match(css,/\.known-team-summary/);
});

test('search outcome analytics stores outcome metadata but never the user query text',async()=> {
  const events=[];
  const messages=[];
  const searchRuntime=createSearchRuntime();
  const telegram=createTelegramRuntime(searchRuntime,{events,messages});

  await telegram.sendBotFootballSearch(
    {url:'https://example.test/telegram'},
    {},
    123,
    456,
    'СверхНеизвестныйКлуб',
  );

  const searchEvent=events.find(row=>row.eventName==='search');
  const resultEvent=events.find(row=>row.eventName==='search_result');

  assert.equal(searchEvent?.metadata?.intent,'search');
  assert.equal(resultEvent?.metadata?.outcome,'not_found');
  assert.equal(resultEvent?.metadata?.recognized,false);
  assert.equal(messages.length,1);

  const serialized=JSON.stringify(events);
  assert.doesNotMatch(serialized,/СверхНеизвестныйКлуб/);
  assert.doesNotMatch(serialized,/"query"|"rawText"/);
});

test('launch funnel exposes search quality aggregates without returning query text',()=> {
  assert.match(growthRuntime,/searchQuality:\{attempts:searchResultRows\.length/);
  assert.match(growthRuntime,/recognizedNoMatch:searchRecognizedNoMatch/);
  assert.match(growthRuntime,/notFound:searchNotFound/);
  assert.match(growthRuntime,/privacy:'Ответ содержит только агрегаты; Telegram ID и текст поисковых запросов пользователей не возвращаются\.'/);
  assert.match(adminLaunchFunnel,/Качество поиска:/);
});

test('current health contract keeps search normalization, outcome analytics and recovery capabilities visible',()=> {
  const runtime=createSearchRuntime();

  assert.equal(runtime.searchQualityDrill().pass,true);
  assert.match(capabilities,/searchQualityDrill:true/);
  assert.match(capabilities,/searchOutcomeAnalytics:true/);
  assert.match(capabilities,/zeroResultRecovery:true/);
  assert.match(capabilities,/teamFixtureDiscovery:true/);
  assert.match(capabilities,/matchSelectionIntelligence:true/);
});
