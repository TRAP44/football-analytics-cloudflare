import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBotOrchestrationRuntime } from '../src/telegram-bot-orchestration-runtime.js';

const request = new Request('https://app.example/webhook');

function escapeHtml(value='') {
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function runtime(overrides={}) {
  const sent=[];
  const apiCalls=[];
  const deps={
    addFavorite: async () => {},
    analysisFreshness: () => ({state:'fresh',label:'Свежо',ageMinutes:2,needsRecheck:false}),
    analysisKickoffHandoff: () => ({locked:false,state:'',label:'',reason:''}),
    apiMatchCenter: async () => new Response(JSON.stringify({
      match:{fixtureId:7},
      postMatchReview:{available:false},
    }), {status:200,headers:{'content-type':'application/json'}}),
    botAiVerdictText: () => '<b>ok</b>',
    botAnalyzeFixture: async () => ({
      match:{fixtureId:7,home:{id:1,name:'Home'},away:{id:2,name:'Away'}},
    }),
    footballBotKeyboard: () => ({keyboard:[[{text:'⚽ Матчи'}]]}),
    footballMatchActionKeyboard: () => ({inline_keyboard:[]}),
    getFavorites: async () => [],
    loadBotTeamCard: async id => ({id,name:'Team'}),
    markTelegramWebhookMutation: () => true,
    marketMovementNote: () => 'без движения',
    newsImpactDecisionCard: () => null,
    normalizeBotFixtureCard: match => match,
    publicSiteUrl: (req,path) => new URL(path,req.url).toString(),
    recordGrowthEvent: async () => {},
    rememberBotFixtureCards: async () => true,
    removeFavorite: async () => {},
    telegramApi: async (method,_cfg,payload) => {
      apiCalls.push({method,payload});
      if (method==='sendMessage') sent.push(payload);
      return {};
    },
    telegramFullAnalysisUrl: (req,id) => new URL(`/?fixtureId=${id}`,req.url).toString(),
    telegramHtmlEscape: escapeHtml,
    telegramWebAppUrl: req => new URL('/',req.url).toString(),
    ...overrides,
  };
  return {api:createTelegramBotOrchestrationRuntime(deps),sent,apiCalls};
}

test('rejects invalid dependency containers', () => {
  assert.throws(
    () => createTelegramBotOrchestrationRuntime(null),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelegramBotOrchestrationRuntime([]),
    /dependencies are required/,
  );
});

test('handoff rendering tolerates malformed collections and escapes text', () => {
  const {api}=runtime({
    analysisFreshness: () => { throw new Error('bad freshness'); },
    analysisKickoffHandoff: () => { throw new Error('bad handoff'); },
    newsImpactDecisionCard: () => { throw new Error('bad decision'); },
  });

  const text=api.botAiHandoffText({
    match:{home:{name:'<Home>'},away:{name:'Away & Co'}},
    aiInstructor:{
      betSignal:{label:'<signal>'},
      verdict:{outcome:'<P1>'},
      risks:{},
    },
    recheck:{performed:true,delta:{available:true,items:{not:'array'}}},
    newsImpact:{requested:true,items:{not:'array'},summary:'<news>'},
  });

  assert.match(text,/&lt;Home&gt;/);
  assert.match(text,/Away &amp; Co/);
  assert.match(text,/&lt;P1&gt;/);
  assert.doesNotMatch(text,/<Home>|<P1>|<news>/);
});

test('post-match review never emits NaN for malformed score and arrays', () => {
  const {api}=runtime();
  const text=api.botPostMatchReviewText({
    match:{home:{name:'A'},away:{name:'B'}},
    postMatchReview:{
      available:true,
      score:{home:'bad',away:{}},
      outcome:{predictedLabel:'P1',actualLabel:'X'},
      markets:{bad:true},
      evidence:'bad',
    },
  });

  assert.match(text,/Счёт: <b>—:—<\/b>/);
  assert.doesNotMatch(text,/NaN/);
});

test('match center validates fixture id before calling upstream', async () => {
  let calls=0;
  const {api}=runtime({
    apiMatchCenter: async () => {
      calls+=1;
      return new Response('{}');
    },
  });

  await assert.rejects(
    () => api.botMatchCenterFixture(request,{},'nope'),
    error => {
      assert.equal(error.status,400);
      assert.equal(error.code,'FIXTURE_ID_INVALID');
      return true;
    },
  );
  assert.equal(calls,0);
});

test('match center rejects successful non-object JSON payloads', async () => {
  const {api}=runtime({
    apiMatchCenter: async () => new Response('[]',{
      status:200,
      headers:{'content-type':'application/json'},
    }),
  });

  await assert.rejects(
    () => api.botMatchCenterFixture(request,{},7),
    error => {
      assert.equal(error.status,502);
      assert.equal(error.code,'MATCH_CENTER_INVALID_PAYLOAD');
      return true;
    },
  );
});

test('fixture sections reject unknown names before mutation or analysis', async () => {
  let mutated=0;
  let analyzed=0;
  const {api}=runtime({
    markTelegramWebhookMutation: () => { mutated+=1; },
    botAnalyzeFixture: async () => {
      analyzed+=1;
      return {};
    },
  });

  const result=await api.sendBotFixtureSection(request,{},123,456,7,'unknown');
  assert.deepEqual(result,{
    ok:false,
    status:400,
    code:'TELEGRAM_SECTION_INPUT_INVALID',
    message:'Неизвестный раздел матча.',
  });
  assert.equal(mutated,0);
  assert.equal(analyzed,0);
});

test('growth event rejection is contained and does not break Telegram send', async () => {
  const {api,sent}=runtime({
    recordGrowthEvent: async () => {
      throw new Error('analytics down');
    },
  });

  const result=await api.sendBotFixtureSection(request,{},123,456,7,'verdict');
  assert.deepEqual(result,{ok:true,status:200});
  assert.equal(sent.length,1);
  await new Promise(resolve=>setImmediate(resolve));
});

test('fallback still sends when full-analysis URL factory throws', async () => {
  const {api,sent}=runtime({
    botAnalyzeFixture: async () => {
      const error=new Error('upstream fail');
      error.status=503;
      throw error;
    },
    telegramFullAnalysisUrl: () => {
      throw new Error('bad link');
    },
  });

  const result=await api.sendBotFixtureSection(request,{},123,456,7,'verdict');
  assert.equal(result.ok,false);
  assert.equal(result.status,503);
  assert.equal(sent.length,1);
  assert.equal(sent[0].reply_markup,undefined);
  assert.match(sent[0].text,/upstream fail/);
});

test('toggle favorite rejects invalid identity before storage reads', async () => {
  let reads=0;
  const {api}=runtime({
    getFavorites: async () => {
      reads+=1;
      return [];
    },
  });

  await assert.rejects(
    () => api.toggleBotFavorite(0,1,{}),
    /Пользователь не определён/,
  );
  await assert.rejects(
    () => api.toggleBotFavorite(1,'bad',{}),
    /Команда не определена/,
  );
  assert.equal(reads,0);
});

test('bot configuration omits unsafe Web App URL but still configures metadata', async () => {
  const {api,apiCalls}=runtime({
    telegramWebAppUrl: () => 'javascript:alert(1)',
  });

  const result=await api.configureFootballBot(request,{},456);
  assert.equal(result.length,4);
  assert.equal(apiCalls.some(call=>call.method==='setChatMenuButton'),false);
  assert.equal(apiCalls.some(call=>call.method==='setMyCommands'),true);
});

test('home safely escapes personalized name', async () => {
  const {api,sent}=runtime();
  await api.sendFootballBotHome(request,{},456,{first_name:'<Alex & Co>'});

  assert.match(sent[0].text,/&lt;Alex &amp; Co&gt;/);
  assert.doesNotMatch(sent[0].text,/<Alex & Co>/);
});
