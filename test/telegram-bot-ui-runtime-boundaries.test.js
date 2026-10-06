import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTelegramBotUiRuntime } from '../src/telegram-bot-ui-runtime.js';

function providerFixture(overrides={}) {
  return {
    fixture:{
      id:123,
      date:'2030-01-01T12:00:00Z',
      status:{short:'NS',long:'Not Started',elapsed:null},
    },
    league:{
      id:39,
      name:'Premier League',
      country:'England',
      round:'Round 1',
    },
    teams:{
      home:{id:1,name:'Home FC',logo:'https://cdn.example/home.png'},
      away:{id:2,name:'Away FC',logo:'https://cdn.example/away.png'},
    },
    ...overrides,
  };
}

function response(payload,status=200) {
  return {
    ok:status>=200 && status<300,
    status,
    async json(){ return payload; },
  };
}

function baseDeps(overrides={}) {
  const cache=new Map();
  const sent=[];
  const growth=[];
  const requestCalls=[];
  const deps={
    apiAnalyze:async()=>response({
      match:{
        fixtureId:123,
        home:{id:1,name:'Home FC'},
        away:{id:2,name:'Away FC'},
      },
      cached:false,
    }),
    botAiHandoffText:()=> 'line one\nline two',
    createRequest:(url,init)=>{
      const value={url,init};
      requestCalls.push(value);
      return value;
    },
    freeQuotaHealthy:()=>true,
    getCache:async key=>cache.get(key) || null,
    getFavorites:async()=>[],
    isFinishedStatus:status=>String(status || '').toUpperCase()==='FT',
    isLiveStatus:status=>['1H','HT','2H','ET','P'].includes(String(status || '').toUpperCase()),
    loadProviderFixture:async()=>providerFixture(),
    markTelegramWebhookMutation:()=>true,
    newsImpactDecisionCard:()=>({code:'hold'}),
    newsImpactDecisionKeyboard:()=>({inline_keyboard:[]}),
    recordGrowthEvent:async(_cfg,event)=>{ growth.push(event); },
    setCache:async key=>{ cache.set(key,arguments[2]); return true; },
    statusLabel:status=>status,
    telegramApi:async (method,_cfg,payload)=>{
      sent.push({method,payload});
      return {ok:true};
    },
    telegramFullAnalysisUrl:(request,fixtureId,tab)=>
      `https://app.example/?fixtureId=${fixtureId}&action=analysis&tab=${tab}&handoff=1`,
    telegramHtmlEscape:value=>String(value)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;'),
    telegramWebAppUrl:(request,params={})=>{
      const url=new URL(request.url);
      url.pathname='/';
      url.search='';
      for(const [key,value] of Object.entries(params)) {
        url.searchParams.set(key,String(value));
      }
      return url.toString();
    },
    ...overrides,
  };
  return {deps,cache,sent,growth,requestCalls};
}

function runtime(overrides={}) {
  const state=baseDeps(overrides);
  return {...state,api:createTelegramBotUiRuntime(state.deps)};
}

const request={url:'https://app.example/telegram/webhook?old=1'};

test('Telegram bot UI validates dependencies and freezes its public surface', () => {
  const {deps}=baseDeps();
  delete deps.getCache;
  assert.throws(
    ()=>createTelegramBotUiRuntime(deps),
    /getCache is required/,
  );
  const {api}=runtime();
  assert.equal(Object.isFrozen(api),true);
});

test('public site URL keeps trusted origin and rejects invalid request URLs', () => {
  const {api}=runtime();
  assert.equal(
    api.publicSiteUrl(request,'/help'),
    'https://app.example/help',
  );
  assert.throws(
    ()=>api.publicSiteUrl({url:'javascript:alert(1)'},'/'),
    /Некорректный URL/,
  );
  assert.throws(
    ()=>api.publicSiteUrl({url:'https://user:pass@app.example/'},'/'),
    /Некорректный URL/,
  );
});

test('favorite team ids reject coercive values and callbacks use canonical ids', () => {
  const {api}=runtime();
  const ids=api.favoriteTeamIdSet([
    {team_id:1},
    {teamId:'2'},
    {team_id:true},
    {team_id:[3]},
    {team_id:'4.5'},
  ]);
  assert.deepEqual([...ids],[1,2]);

  const row=api.favoriteMatchTeamRow({
    fixtureId:'123',
    home:{id:'1',name:'Home'},
    away:{id:true,name:'Bad'},
  },[{team_id:1}]);
  assert.deepEqual(row,[{
    text:'★ Home',
    callback_data:'favorite:toggle:1:123',
  }]);
});

test('fixture normalization is strict and never exposes live plus finished together', () => {
  const {api}=runtime();
  const live=api.normalizeBotFixtureCard({
    fixtureId:'123',
    status:'1H',
    finished:true,
    elapsed:'12',
    home:{id:'1',name:' Home '},
    away:{id:'2',name:'Away'},
    leagueShort:'League Short',
  });
  assert.equal(live.live,true);
  assert.equal(live.finished,false);
  assert.equal(live.elapsed,12);
  assert.equal(live.league,'League Short');

  const invalid=api.normalizeBotFixtureCard({
    fixtureId:true,
    home:{id:[1],name:'Home'},
    away:{id:2,name:'Away'},
  });
  assert.equal(invalid.fixtureId,0);
  assert.equal(invalid.home.id,0);
});

test('keyboard drops cross-origin search links and unsafe generated web-app links', () => {
  const {api}=runtime({
    telegramFullAnalysisUrl:()=> 'javascript:alert(1)',
  });
  const keyboard=api.footballMatchActionKeyboard(
    request,
    {
      fixtureId:123,
      home:{id:1,name:'Home'},
      away:{id:2,name:'Away'},
    },
    'https://evil.example/search',
    [],
  );
  const buttons=keyboard.inline_keyboard.flat();
  assert.equal(buttons.some(button=>button.web_app?.url?.includes('evil.example')),false);
  assert.equal(buttons.some(button=>button.text.includes('Полный AI-разбор')),false);
  assert.ok(buttons.some(button=>button.callback_data==='match:verdict:123'));
});

test('live and finished keyboard state derives from canonical status', () => {
  const {api}=runtime();
  const live=api.footballMatchActionKeyboard(request,{
    fixtureId:123,
    status:'1H',
    finished:true,
    home:{id:1,name:'Home'},
    away:{id:2,name:'Away'},
  });
  const liveButtons=live.inline_keyboard.flat();
  assert.ok(liveButtons.some(button=>button.text==='🔴 Открыть LIVE-центр'));
  assert.equal(liveButtons.some(button=>button.callback_data==='match:review:123'),false);

  const finished=api.footballMatchActionKeyboard(request,{
    fixtureId:123,
    status:'FT',
    live:true,
    home:{id:1,name:'Home'},
    away:{id:2,name:'Away'},
  });
  assert.ok(
    finished.inline_keyboard.flat()
      .some(button=>button.callback_data==='match:review:123'),
  );
});

test('fixture cache rejects cross-fixture and duplicate-team identities', async () => {
  let providerCalls=0;
  const {api,cache}=runtime({
    loadProviderFixture:async()=>{
      providerCalls+=1;
      return providerFixture();
    },
  });

  cache.set('bot:fixture-card:123:v2',{
    match:{
      fixtureId:999,
      home:{id:1,name:'Wrong'},
      away:{id:2,name:'Wrong'},
    },
  });
  const card=await api.loadBotFixtureCard(123,{});
  assert.equal(card.fixtureId,123);
  assert.equal(providerCalls,1);

  cache.clear();
  cache.set('bot:fixture-card:123:v2',{
    match:{
      fixtureId:123,
      home:{id:1,name:'Home'},
      away:{id:1,name:'Away'},
    },
  });
  const second=await api.loadBotFixtureCard(123,{});
  assert.equal(second.home.id,1);
  assert.equal(second.away.id,2);
  assert.equal(providerCalls,2);
});

test('provider fixture identity mismatch is rejected and quota probe failures fail closed', async () => {
  let providerCalls=0;
  const mismatch=runtime({
    loadProviderFixture:async()=>{
      providerCalls+=1;
      return providerFixture({
        fixture:{
          ...providerFixture().fixture,
          id:999,
        },
      });
    },
  });
  assert.equal(await mismatch.api.loadBotFixtureCard(123,{}),null);
  assert.equal(providerCalls,1);

  const quota=runtime({
    freeQuotaHealthy:()=>{ throw new Error('quota probe down'); },
    loadProviderFixture:async()=>{
      throw new Error('must not call provider');
    },
  });
  const fallback=await quota.api.loadBotFixtureCard(123,{});
  assert.equal(fallback.fixtureId,123);
  assert.equal(fallback.homeName,'Матч');
});

test('team cache is fixture-independent but identity-bound', async () => {
  const {api,cache}=runtime();
  cache.set('bot:team-card:7:v1',{
    team:{id:8,name:'Wrong Team'},
  });
  assert.equal(await api.loadBotTeamCard(7,{}),null);

  cache.set('bot:team-card:7:v1',{
    team:{id:7,name:'Correct Team',logo:'javascript:alert(1)'},
  });
  const team=await api.loadBotTeamCard(7,{});
  assert.equal(team.id,7);
  assert.equal(team.logo,'');
});

test('remembering fixture cards fails soft when cache writes fail', async () => {
  const {api}=runtime({
    setCache:async()=>{ throw new Error('cache down'); },
  });
  await api.rememberBotFixtureCards([providerFixture()],{});
});

test('AI handoff uses canonical ids and rejects cross-fixture payloads', async () => {
  let analyzedUser=null;
  const {api,requestCalls}=runtime({
    apiAnalyze:async (_request,_cfg,user)=>{
      analyzedUser=user;
      return response({
        match:{
          fixtureId:999,
          home:{id:1,name:'Wrong'},
          away:{id:2,name:'Wrong'},
        },
      });
    },
  });

  await assert.rejects(
    ()=>api.botAnalyzeFixture(request,{},'77','123'),
    error=>error?.code==='TELEGRAM_ANALYSIS_FIXTURE_MISMATCH',
  );
  assert.deepEqual(analyzedUser,{id:77});
  assert.equal(requestCalls.length,1);
  assert.deepEqual(JSON.parse(requestCalls[0].init.body),{
    fixtureId:123,
    origin:'telegram_quick',
    recheck:true,
  });

  await assert.rejects(
    ()=>api.botAnalyzeFixture(request,{},true,123),
    /Некорректные параметры/,
  );
});

test('AI handoff rejects malformed service responses and preserves upstream status', async () => {
  const malformed=runtime({
    apiAnalyze:async()=>({ok:true,status:200}),
  });
  await assert.rejects(
    ()=>malformed.api.botAnalyzeFixture(request,{},7,123),
    error=>error?.status===502,
  );

  const limited=runtime({
    apiAnalyze:async()=>response({error:'rate limited'},429),
  });
  await assert.rejects(
    ()=>limited.api.botAnalyzeFixture(request,{},7,123),
    error=>error?.status===429 && error?.message==='rate limited',
  );
});

test('send menu isolates growth telemetry failures and preserves multiline AI copy', async () => {
  const {api,sent}=runtime({
    recordGrowthEvent:()=>Promise.reject(new Error('telemetry down')),
    botAiHandoffText:()=> 'first line\nsecond line',
  });

  const ok=await api.sendBotFixtureMenu(
    request,
    {},
    7,
    -100123,
    123,
  );
  assert.equal(ok,true);
  const message=sent.find(row=>row.method==='sendMessage');
  assert.match(message.payload.text,/first line\nsecond line/);
});

test('send menu validates Telegram identities before side effects', async () => {
  const {api,sent}=runtime();
  await assert.rejects(
    ()=>api.sendBotFixtureMenu(request,{},true,1,123),
    /Некорректный Telegram user\/chat\/fixture ID/,
  );
  assert.equal(sent.length,0);
});

test('fixture text and verdict escape untrusted HTML and reject coercive scores', () => {
  const {api}=runtime();
  const card=api.botFixtureCardText({
    fixtureId:123,
    home:{id:1,name:'<Home>'},
    away:{id:2,name:'Away & Co'},
    league:'<League>',
  });
  assert.match(card,/&lt;Home&gt;/);
  assert.match(card,/Away &amp; Co/);
  assert.doesNotMatch(card,/<League>/);

  const verdict=api.botAiVerdictText({
    match:{
      home:{name:'<Home>'},
      away:{name:'Away'},
    },
    aiInstructor:{
      confidenceScore:true,
      confidenceLabel:'<High>',
      dataTrust:{score:true,label:'<Trusted>'},
      betSignal:{
        code:'skip',
        label:'<Skip>',
        reason:'<Reason>',
      },
      verdict:{outcome:'<P1>'},
    },
  });
  assert.match(verdict,/Лучше пропустить/);
  assert.match(verdict,/&lt;Home&gt;/);
  assert.match(verdict,/&lt;Skip&gt;/);
  assert.match(verdict,/· —/);
});

test('worker explicitly wires the request factory into the extracted runtime', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const source=fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8');
  assert.match(
    worker,
    /createTelegramBotUiRuntime\(\{[\s\S]*?apiAnalyze,[\s\S]*?createRequest: \(url, init\) => new Request\(url, init\),[\s\S]*?telegramWebAppUrl[\s\S]*?\}\);/,
  );
  assert.match(source,/validBotFixtureCard/);
  assert.match(source,/sameOriginWebAppUrl/);
  assert.match(source,/TELEGRAM_ANALYSIS_FIXTURE_MISMATCH/);
  assert.match(source,/return Object\.freeze\(\{/);
});
