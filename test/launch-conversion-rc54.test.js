import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOrderedLaunchFunnel } from '../src/growth-analytics-runtime.js';
import { createSearchDiscoveryRuntime } from '../src/search-discovery-runtime.js';

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

const botOrchestration=readRepoFile('src/telegram-bot-orchestration-runtime.js');
const botUi=readRepoFile('src/telegram-bot-ui-runtime.js');
const updateOrchestration=readRepoFile('src/telegram-update-orchestration.js');
const newsRuntime=readRepoFile('src/football-news-runtime.js');
const growthRuntime=readRepoFile('src/growth-analytics-runtime.js');
const worker=readRepoFile('src/worker.js');
const capabilities=readRepoFile('src/app-capabilities.js');
const globalSearchController=readRepoFile('public/modules/global-search-controller.js');
const globalSearchRenderer=readRepoFile('public/modules/global-search-renderer.js');
const adminLaunchFunnel=readRepoFile('public/modules/admin-launch-funnel.js');

test('RC54 first-session path remains short and search-first after runtime extraction',()=> {
  assert.match(botOrchestration,/Напишите клуб прямо в чат/);
  assert.match(botUi,/\[\{text:'⚽ Матчи'\},\{text:'🔎 Найти матч'\}\]/);
  assert.match(updateOrchestration,/Можно по-русски: «Реал»/);
  assert.doesNotMatch(botOrchestration,/'<b>Как начать:<\/b>'/);
});

test('top-club discovery is behavioral, global and allowed through the low-quota high-intent gate',async()=> {
  const catalogRuntime=createSearchRuntime();
  for (const club of [
    'Flamengo',
    'River Plate',
    'Boca Juniors',
    'Zenit',
    'Olympiakos Piraeus',
    'Red Bull Salzburg',
  ]) {
    const plan=catalogRuntime.topTeamSearchPlan(club);
    assert.equal(plan.best?.canonical,club);
    assert.ok(Number(plan.best?.score || 0)>=170);
  }

  const quotaCalls=[];
  let providerCalls=0;
  const runtime=createSearchRuntime({
    freeQuotaHealthy:(reserve,cost)=>{
      quotaCalls.push([reserve,cost]);
      return reserve===2 && cost===1;
    },
    apiFootball:async(path,params)=>{
      providerCalls+=1;
      assert.equal(path,'/teams');
      assert.equal(params.search,'Real Madrid');
      return [{team:{id:541,name:'Real Madrid',country:'Spain'}}];
    },
  });

  const result=await runtime.apiSearch(
    {url:'https://example.test/api/search?q=%D0%A0%D0%B5%D0%B0%D0%BB'},
    {},
  );

  assert.equal(providerCalls,1);
  assert.ok(quotaCalls.some(([reserve,cost])=>reserve===8 && cost===2));
  assert.ok(quotaCalls.some(([reserve,cost])=>reserve===2 && cost===1));
  assert.equal(result.teams[0]?.name,'Real Madrid');
  assert.equal(result.resolvedQuery,'Real Madrid');
});

test('recognized clubs remain visible even when provider fixtures are empty',()=> {
  const runtime=createSearchRuntime();
  const known=runtime.knownTopTeamFallbacks('ПСЖ');

  assert.equal(known[0]?.name,'Paris Saint Germain');
  assert.equal(known[0]?.catalogOnly,true);
  assert.ok(Number(known[0]?.score || 0)>=170);
  assert.match(globalSearchController,/knownTeams/);
  assert.match(globalSearchRenderer,/knownTeams/);
  assert.match(globalSearchRenderer,/Распознано/);
});

test('news return loop remains separately measurable after module extraction',()=> {
  assert.match(newsRuntime,/callback_data:`news:match:\$\{fixtureId\}`/);
  assert.match(updateOrchestration,/eventName:'news_return'/);
  assert.match(updateOrchestration,/origin:'team_news'/);
  assert.match(growthRuntime,/returnLoop:\{newsOpen:newsOpen\.size,newsReturn:newsReturn\.size/);
});

test('launch funnel measures an ordered user journey and cannot report impossible conversion above 100%',()=> {
  const rows=[
    {telegram_id:1,event_name:'bot_start',created_at:'2026-10-07T10:00:00Z'},
    {telegram_id:1,event_name:'search',created_at:'2026-10-07T10:01:00Z'},
    {telegram_id:1,event_name:'match_open',created_at:'2026-10-07T10:02:00Z'},
    {telegram_id:1,event_name:'quick_ai',created_at:'2026-10-07T10:03:00Z'},
    {telegram_id:1,event_name:'full_ai',created_at:'2026-10-07T10:04:00Z'},

    {telegram_id:2,event_name:'miniapp_open',created_at:'2026-10-07T11:00:00Z'},
    {telegram_id:2,event_name:'search',created_at:'2026-10-07T11:01:00Z'},
    {telegram_id:2,event_name:'full_ai',created_at:'2026-10-07T11:02:00Z'},

    {telegram_id:3,event_name:'search',created_at:'2026-10-07T11:59:00Z'},
    {telegram_id:3,event_name:'bot_start',created_at:'2026-10-07T12:00:00Z'},
    {telegram_id:3,event_name:'match_open',created_at:'2026-10-07T12:01:00Z'},
    {telegram_id:3,event_name:'quick_ai',created_at:'2026-10-07T12:02:00Z'},
    {telegram_id:3,event_name:'full_ai',created_at:'2026-10-07T12:03:00Z'},

    {telegram_id:4,event_name:'bot_start',created_at:'not-a-date'},
    {telegram_id:4,event_name:'search',created_at:'2026-10-07T13:01:00Z'},

    // Intentionally out of input order: the helper must use event time, not array position.
    {telegram_id:'5',event_name:'full_ai',created_at:'2026-10-07T14:04:00Z'},
    {telegram_id:'5',event_name:'quick_ai',created_at:'2026-10-07T14:03:00Z'},
    {telegram_id:'5',event_name:'match_open',created_at:'2026-10-07T14:02:00Z'},
    {telegram_id:'5',event_name:'search',created_at:'2026-10-07T14:01:00Z'},
    {telegram_id:'5',event_name:'miniapp_open',created_at:'2026-10-07T14:00:00Z'},
  ];

  const funnel=buildOrderedLaunchFunnel(rows);
  assert.deepEqual(
    funnel.map(stage=>[stage.key,stage.users]),
    [
      ['entry',4],
      ['search',3],
      ['match_open',2],
      ['quick_ai',2],
      ['full_ai',2],
    ],
  );
  for (const stage of funnel) {
    assert.ok(stage.fromEntryPct>=0 && stage.fromEntryPct<=100);
    assert.ok(stage.fromPreviousPct>=0 && stage.fromPreviousPct<=100);
  }
  assert.equal(funnel[1].fromPreviousPct,75);
  assert.equal(funnel[2].fromPreviousPct,66.7);

  assert.match(growthRuntime,/supaSelectPaged\(cfg,'growth_events'/);
  assert.match(growthRuntime,/pageSize:1000,maxRows:10000/);
  assert.match(growthRuntime,/funnelMode:'ordered_unique_users'/);
  assert.match(adminLaunchFunnel,/Узкое место:/);
  assert.match(adminLaunchFunnel,/последовательный путь/);
});

test('current health contract keeps launch search and funnel wiring visible',()=> {
  const runtime=createSearchRuntime();
  assert.equal(runtime.searchQualityDrill().pass,true);
  assert.match(capabilities,/searchQualityDrill:true/);
  assert.match(capabilities,/searchOutcomeAnalytics:true/);
  assert.match(capabilities,/oneTapAiHandoff:true/);
  assert.match(worker,/createGrowthAnalyticsRuntime/);
  assert.match(worker,/apiLaunchFunnel/);
});
