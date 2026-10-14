import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramDigestRuntime } from '../src/telegram-digest-runtime.js';
import {botCardSignature} from '../src/bot-match-card.js';

function escapeHtml(value='') {
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function runtime(overrides={}) {
  const memory={botDigestSubscriptions:new Map()};
  const deps={
    DAILY_DIGEST_POLICY:{
      deliveryHourUtc:7,
      claimLeaseSeconds:180,
      pageSize:500,
      maxRecipientsPerRun:1000,
      scanCap:10000,
      concurrency:4,
      minSendIntervalMs:50,
      executionBudgetMs:100000,
    },
    SMART_NOTIFICATION_POLICY:{
      radarConfidenceThreshold:70,
      radarOutcomeThreshold:55,
      maxSignalAgeMinutes:60,
    },
    apiFootball:async()=>[],
    assessDailyDigestRun:()=>({severity:'info',code:'DAILY_DIGEST_RUN_OK',reason:'ok'}),
    botMatchButtonText:()=> 'Матч',
    bumpTelemetry:()=>{},
    currentMorningFootballNews:async()=>({items:[],degraded:false}),
    filterSmartNotificationRecipients:async()=>({rows:[]}),
    footballBotKeyboard:()=>({inline_keyboard:[]}),
    freeQuotaHealthy:()=>true,
    getAnalysisTimelineSnapshots:async()=>[],
    getCache:async()=>null,
    getFavorites:async()=>[],
    getStaleCache:async()=>null,
    hasSupabase:()=>false,
    isFootballRateLimitError:()=>false,
    isLiveStatus:status=>status==='1H',
    isYouthReserveMatch:()=>false,
    loadProviderFixturesForDate:async()=>[],
    markTelegramWebhookMutation:()=>{},
    matchInterestScore:()=>10,
    morningNewsText:()=> '',
    newsConversionKeyboard:()=>({inline_keyboard:[]}),
    normalizeBotFixtureCard:value=>value,
    normalizeCompetition:()=>({name:'Лига',shortName:'Лига',priority:1,featured:false}),
    planDailyDigestRecipients:rows=>({
      rows,
      pending:rows,
      scanned:rows.length,
      pages:rows.length?1:0,
      eligible:rows.length,
      duplicate:0,
      activeClaims:0,
      freshClaims:0,
      sealedClaims:0,
      oldestActiveClaimAgeMs:0,
      expiredClaims:0,
      deferred:0,
      remaining:0,
      backlog:0,
      truncated:false,
    }),
    radarStrongSignalState:()=>({reason:'none'}),
    recordOpsEvent:async()=>{},
    rememberBotFixtureCards:async()=>true,
    runBoundedDailyDigest:async()=>({
      scanned:0,
      eligible:0,
      claimed:0,
      sent:0,
      duplicate:0,
      failed:0,
      rateLimited:0,
      deferred:0,
      remaining:0,
      backlog:0,
    }),
    setCache:async()=>true,
    sleepMs:async()=>{},
    supaPatch:async()=>true,
    supaRpc:async()=>true,
    supaSelectOne:async()=>null,
    supaSelectPaged:async()=>({rows:[],truncated:false}),
    supaUpsert:async()=>true,
    telegramApi:async()=>({ok:true}),
    telegramHtmlEscape:escapeHtml,
    todayUtc:()=> '2026-10-07',
    memory,
    ...overrides,
  };
  return {api:createTelegramDigestRuntime(deps),memory,deps};
}

test('digest runtime validates its dependency boundary and freezes public API',()=>{
  assert.throws(
    ()=>createTelegramDigestRuntime(null),
    /dependencies are required/,
  );
  const {deps}=runtime();
  assert.throws(
    ()=>createTelegramDigestRuntime({...deps,telegramApi:null}),
    /dependency telegramApi is required/,
  );
  assert.throws(
    ()=>createTelegramDigestRuntime({...deps,memory:{botDigestSubscriptions:{}}}),
    /memory store is required/,
  );
  assert.equal(Object.isFrozen(createTelegramDigestRuntime(deps)),true);
});

test('daily digest HTML escapes provider-controlled labels and rejects malformed row containers',()=>{
  const {api}=runtime();
  assert.doesNotThrow(()=>api.dailyDigestText({length:1}));
  assert.match(api.dailyDigestText({length:1}),/нет подходящих матчей/);

  const text=api.dailyDigestText([{
    fixtureId:7,
    homeName:'<Home>',
    awayName:'Away & Co',
    league:'<League>',
    date:'2026-10-07T12:00:00Z',
    live:false,
  }]);
  assert.match(text,/&lt;Home&gt;/);
  assert.match(text,/Away &amp; Co/);
  assert.match(text,/&lt;League&gt;/);
  assert.doesNotMatch(text,/<Home>|<League>|Away & Co/);
});

test('expanded digest contains malformed Radar evidence without NaN or unsafe HTML',()=>{
  const {api}=runtime();
  const rows=[{
    fixtureId:7,
    homeName:'<A>',
    awayName:'B & C',
    league:'League',
    date:'2026-10-07T12:00:00Z',
  }];
  assert.doesNotThrow(()=>api.expandedDailyDigestText(rows,{broken:true}));

  const radar=new Map([[7,{
    reason:'evaluated',
    latest:{confidence:999},
    strongest:{side:'home',probability:'bad'},
  }]]);
  const text=api.expandedDailyDigestText(rows,radar);
  assert.match(text,/—%/);
  assert.doesNotMatch(text,/Radar \d+\/100/);
  assert.doesNotMatch(text,/NaN|<A>|B & C/);
  assert.match(text,/&lt;A&gt;/);
  assert.match(text,/B &amp; C/);
});

test('subscription mutation rejects unsafe identity and non-boolean state before side effects',async()=>{
  let mutations=0;
  let reads=0;
  const {api}=runtime({
    markTelegramWebhookMutation:()=>{mutations+=1;},
    hasSupabase:()=>true,
    supaSelectOne:async()=>{reads+=1; return null;},
  });

  await assert.rejects(
    ()=>api.setBotDigestSubscription(0,1,true,{}),
    /identity is invalid/,
  );
  await assert.rejects(
    ()=>api.setBotDigestSubscription(1.5,1,true,{}),
    /identity is invalid/,
  );
  await assert.rejects(
    ()=>api.setBotDigestSubscription(1,1,'true',{}),
    /enabled must be boolean/,
  );
  assert.equal(mutations,0);
  assert.equal(reads,0);
});

test('subscription normalization preserves valid Telegram group chat ids and sanitized favorites',async()=>{
  const {api,memory}=runtime();
  const row=await api.setBotDigestSubscription('7','-100123',true,{},'https://example.com/app');
  assert.equal(row.telegram_id,7);
  assert.equal(row.chat_id,-100123);
  assert.equal(row.enabled,true);
  assert.equal(memory.botDigestSubscriptions.get(7).chat_id,-100123);

  const settings=api.publicDigestSettings(row,'pro',[
    {team_id:'10',team_name:' Team\u0000 Name '},
    {team_id:'1e3',team_name:'Unsafe'},
    {team_id:-5,team_name:'Negative'},
  ]);
  assert.equal(settings.plan,'PRO');
  assert.deepEqual(settings.favoriteTeams,[{teamId:10,teamName:'Team Name'}]);
});

test('Supabase digest claim accepts only literal boolean success',async()=>{
  let result='true';
  const {api}=runtime({
    hasSupabase:()=>true,
    supaRpc:async()=>result,
  });

  assert.equal(await api.claimDigestDelivery({telegram_id:7},'2026-10-07',{}),false);
  result=true;
  assert.equal(await api.claimDigestDelivery({telegram_id:7},'2026-10-07',{}),true);
  assert.equal(await api.claimDigestDelivery({telegram_id:'1e3'},'2026-10-07',{}),false);
  assert.equal(await api.claimDigestDelivery({telegram_id:7},'not-a-date',{}),false);
});

test('memory claim lifecycle completes explicitly and stale release cannot clear a newer claim',async()=>{
  const {api,memory}=runtime();
  await api.setBotDigestSubscription(7,7,true,{});

  assert.equal(await api.claimDigestDelivery({telegram_id:7},'2026-10-07',{}),true);
  assert.equal(await api.armDigestDelivery({telegram_id:7},'2026-10-07',{}),true);
  assert.equal(await api.markDigestSent({telegram_id:7},'2026-10-07',{}),true);
  assert.equal(memory.botDigestSubscriptions.get(7).last_sent_date,'2026-10-07');

  memory.botDigestSubscriptions.set(7,{
    ...memory.botDigestSubscriptions.get(7),
    last_sent_date:null,
    delivery_claim_date:'2026-10-08',
    delivery_claimed_at:new Date().toISOString(),
    delivery_locked_until:new Date(Date.now()+60000).toISOString(),
  });
  assert.equal(await api.releaseDigestDelivery({telegram_id:7},'2026-10-07',{}),false);
  assert.equal(memory.botDigestSubscriptions.get(7).delivery_claim_date,'2026-10-08');
});

test('current digest ignores malformed cache payload and treats cache persistence as fail-soft',async()=>{
  let providerCalls=0;
  const {api}=runtime({
    getCache:async()=>({rows:{not:'an-array'}}),
    loadProviderFixturesForDate:async()=>{
      providerCalls+=1;
      return [{
        fixture:{id:55,date:'2026-10-07T19:00:00Z',status:{short:'NS'}},
        teams:{
          home:{id:1,name:'A',logo:''},
          away:{id:2,name:'B',logo:''},
        },
        league:{id:10,name:'League',country:'Country'},
      }];
    },
    setCache:async()=>{throw new Error('cache down');},
  });

  const digest=await api.currentDailyDigest({});
  assert.equal(providerCalls,1);
  assert.equal(digest.source,'provider');
  assert.equal(digest.rows.length,1);
  assert.equal(digest.rows[0].fixtureId,55);
});

test('team lookup rejects unsafe ids before cache or provider work',async()=>{
  let cacheCalls=0;
  let providerCalls=0;
  const {api}=runtime({
    getCache:async()=>{cacheCalls+=1; return null;},
    apiFootball:async()=>{providerCalls+=1; return [];},
  });

  assert.deepEqual(await api.botTeamIdMatches(-1,{}),[]);
  assert.deepEqual(await api.botTeamIdMatches(1.5,{}),[]);
  assert.deepEqual(await api.botTeamIdMatches('1e3',{}),[]);
  assert.equal(cacheCalls,0);
  assert.equal(providerCalls,0);
});

test('digest cron rejects invalid schedule before subscription storage access',async()=>{
  let scans=0;
  const {api}=runtime({
    supaSelectPaged:async()=>{scans+=1; return {rows:[],truncated:false};},
    hasSupabase:()=>true,
  });

  assert.deepEqual(
    await api.processDailyDigests({botToken:'token'},new Date('invalid')),
    {sent:0,skipped:'invalid_schedule'},
  );
  assert.deepEqual(
    await api.processDailyDigests({},new Date('2026-10-07T07:00:00Z')),
    {sent:0,skipped:'bot_token_missing'},
  );
  assert.equal(scans,0);
});

test('digest public settings cap favorite teams and deduplicate provider identities',()=>{
  const {api}=runtime();
  const rows=[
    {team_id:10,team_name:'Arsenal'},
    {team_id:'10',team_name:'Duplicate'},
    ...Array.from({length:12},(_,i)=>({team_id:20+i,team_name:'Team '+i})),
  ];
  const settings=api.publicDigestSettings({telegram_id:7,enabled:true},'FREE',rows);
  assert.equal(settings.favoriteTeams.length,6);
  assert.equal(settings.favoriteTeams[0].teamName,'Arsenal');
  assert.equal(new Set(settings.favoriteTeams.map(x=>x.teamId)).size,6);
  assert.equal(settings.capabilities.smartRadarContext,false);
  assert.equal(settings.capabilities.customDeliveryTime,false);
});

// 13.10: «⚽ Матчи» и «🔴 LIVE» отвечали «не найдено», когда кэш матчей истёк, а запрос к
// провайдеру из бота не прошёл защиту лимитов. Теперь берётся снимок из фонового запуска.
function fixtureRow(id,status,home,away,date='2026-10-07T18:00:00+00:00'){
  return {fixture:{id,date,status:{short:status}},league:{id:39,name:'Premier League',country:'England'},teams:{home:{id:id*10,name:home},away:{id:id*10+1,name:away}}};
}

test('bot day matches fall back to the background provider snapshot when cache and quota fail',async()=>{
  const sent=[];
  const snapshot={date:'2026-10-07',fixtures:[
    fixtureRow(1,'1H','Arsenal','Chelsea'),
    fixtureRow(2,'NS','Inter','Milan'),
    fixtureRow(3,'FT','Roma','Lazio'),
  ]};
  const {api}=runtime({
    freeQuotaHealthy:()=>false,
    getCache:async()=>null,
    getStaleCache:async key=>key==='provider-fixtures:2026-10-07:v1' ? snapshot : null,
    telegramApi:async(method,_cfg,payload)=>{ sent.push({method,payload}); return {ok:true}; },
  });
  await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:true});
  assert.match(sent[0].payload.text,/LIVE сейчас/);
  assert.match(sent[0].payload.text,/Arsenal <b>—<\/b> Chelsea/);
  assert.doesNotMatch(sent[0].payload.text,/Inter/);

  sent.length=0;
  await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:false});
  assert.match(sent[0].payload.text,/Матчи сегодня/);
  assert.match(sent[0].payload.text,/Inter — Milan/);
  assert.doesNotMatch(sent[0].payload.text,/Roma/,'finished matches are hidden when others exist');
  // Два открытых матча + «Обновить».
  assert.equal(sent[0].payload.reply_markup.inline_keyboard.length,3);
  assert.equal(sent[0].payload.reply_markup.inline_keyboard.at(-1)[0].callback_data,'feed:today');
});

test('bot day matches still say «not found» only when no source has data',async()=>{
  const sent=[];
  const {api}=runtime({
    freeQuotaHealthy:()=>false,
    telegramApi:async(method,_cfg,payload)=>{ sent.push({method,payload}); return {ok:true}; },
  });
  await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:true});
  assert.match(sent[0].payload.text,/нет матчей в прямом эфире/);
});

test('LIVE keeps looking past a fresh match cache that has no live games (Codex #875)',async()=>{
  const sent=[];
  const freshCache={matches:[{fixtureId:5,homeName:'Inter',awayName:'Milan',status:'NS',live:false,date:'2026-10-07T18:00:00+00:00',league:'Лига'}]};
  const snapshot={fixtures:[fixtureRow(6,'1H','Waterhouse','Tru-Juice')]};
  const {api}=runtime({
    freeQuotaHealthy:()=>false,
    getCache:async key=>key==='matches:2026-10-07:v6-integrity' ? freshCache : null,
    getStaleCache:async key=>key==='provider-fixtures:2026-10-07:v1' ? snapshot : null,
    telegramApi:async(method,_cfg,payload)=>{ sent.push({method,payload}); return {ok:true}; },
  });
  await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:true});
  assert.match(sent[0].payload.text,/Waterhouse <b>—<\/b> Tru-Juice/);
  sent.length=0;
  await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:false});
  assert.match(sent[0].payload.text,/Inter — Milan/,'today uses the first source that has open matches');
});

test('upcoming matches are not pushed out by 20 important finished ones (Codex #875)',async()=>{
  const sent=[];
  const finished=Array.from({length:25},(_,i)=>fixtureRow(100+i,'FT',`Home${i}`,`Away${i}`));
  const snapshot={fixtures:[...finished,fixtureRow(7,'NS','Inter','Milan')]};
  const {api}=runtime({
    freeQuotaHealthy:()=>false,
    matchInterestScore:({homeName})=>homeName==='Inter' ? 1 : 100,
    getStaleCache:async key=>key==='provider-fixtures:2026-10-07:v1' ? snapshot : null,
    telegramApi:async(method,_cfg,payload)=>{ sent.push({method,payload}); return {ok:true}; },
  });
  await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:false});
  assert.match(sent[0].payload.text,/Inter — Milan/);
  assert.doesNotMatch(sent[0].payload.text,/Home0/);
});

// 13.10: Сергей — «Матчи» и «LIVE» выглядели одинаково: 8 случайных LIVE низших лиг, все
// кнопки красные, список дублировал кнопки. Теперь наверху главные турниры, матчи сгруппированы
// по турнирам, у LIVE — минута и счёт, у предстоящих — время МСК.
function rankedRow(id,status,home,away,league,{date='2026-10-07T18:00:00+00:00',goals=null,elapsed=null}={}){
  return {
    fixture:{id,date,status:{short:status,elapsed}},
    league:{id,name:league,country:'Country'},
    teams:{home:{id:id*10,name:home},away:{id:id*10+1,name:away}},
    goals:goals || {home:null,away:null},
  };
}

function rankedRuntime(snapshot,sent){
  return runtime({
    freeQuotaHealthy:()=>false,
    isLiveStatus:status=>['1H','2H','HT'].includes(status),
    normalizeCompetition:(_id,name,country)=>name==='Premier League'
      ? {name:'Премьер-лига',shortName:'Премьер-лига',country:'Англия',priority:95,featured:true}
      : {name,shortName:name,country:'Египет',priority:30,featured:false,lower:name==='2nd Division'},
    getStaleCache:async key=>key==='provider-fixtures:2026-10-07:v1' ? snapshot : null,
    telegramApi:async(method,_cfg,payload)=>{ sent.push({method,payload}); return {ok:true}; },
  });
}

test('«Матчи» put important tournaments above random lower-league LIVE games',async()=>{
  const sent=[];
  const minor=Array.from({length:10},(_,i)=>rankedRow(200+i,'2H',`Minor${i}`,`Side${i}`,'2nd Division',{goals:{home:0,away:0},elapsed:70}));
  const snapshot={fixtures:[...minor,rankedRow(9,'NS','Arsenal','Chelsea','Premier League',{date:'2026-10-07T19:00:00+00:00'})]};
  const {api}=rankedRuntime(snapshot,sent);
  await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:false});
  const {text,reply_markup}=sent[0].payload;
  assert.ok(text.indexOf('Arsenal')<text.indexOf('Minor'),'featured match goes first');
  assert.match(text,/<b>Премьер-лига · Англия<\/b>\n<b>22:00<\/b> · Arsenal — Chelsea/,'grouped by tournament, time in MSK');
  assert.match(text,/главные 8 из 11 · время МСК/);
  assert.equal(reply_markup.inline_keyboard[0][0].text,'22:00 Arsenal — Chelsea');
  assert.equal(reply_markup.inline_keyboard[0][0].callback_data,'match:menu:9');
  assert.equal(reply_markup.inline_keyboard.length,9,'8 matches + refresh');
});

test('LIVE shows minute and score; buttons are not all the same red dot',async()=>{
  const sent=[];
  const snapshot={fixtures:[
    rankedRow(1,'2H','Arsenal','Chelsea','Premier League',{goals:{home:1,away:0},elapsed:63}),
    rankedRow(2,'HT','Al Ahly','Zamalek','Egypt League',{goals:{home:0,away:0}}),
  ]};
  const {api}=rankedRuntime(snapshot,sent);
  await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:true});
  const {text,reply_markup}=sent[0].payload;
  assert.match(text,/🔴 63′ · Arsenal <b>1:0<\/b> Chelsea/);
  assert.match(text,/🔴 Перерыв · Al Ahly <b>0:0<\/b> Zamalek/);
  assert.doesNotMatch(text,/время МСК/,'no time note when nothing is upcoming');
  assert.deepEqual(reply_markup.inline_keyboard.map(row=>row[0].text),[
    '63′ Arsenal 1:0 Chelsea',
    'Перерыв Al Ahly 0:0 Zamalek',
    '🔄 Обновить',
  ]);
});

test('review: important non-featured match survives more than 20 low-priority fixtures',async()=>{
 const sent=[];
 const fixtures=[...Array.from({length:21},(_,i)=>rankedRow(300+i,'2H',`Minor${i}`,`Side${i}`,'2nd Division')),rankedRow(900,'NS','MajorHome','MajorAway','Major League')];
 const {api}=runtime({
  freeQuotaHealthy:()=>false,
  normalizeCompetition:(_id,name)=>({name,shortName:name,priority:name==='Major League'?70:20,lower:name==='2nd Division',featured:false}),
  matchInterestScore:({leagueName})=>leagueName==='Major League'?30:60,
  getStaleCache:async key=>key==='provider-fixtures:2026-10-07:v1'?{fixtures}:null,
  telegramApi:async(method,_cfg,payload)=>{sent.push({method,payload});return {ok:true};},
 });
 await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:false});
 assert.match(sent[0].payload.text,/MajorHome/);
 assert.match(sent[0].payload.text,/главные 8 из 22/);
});

test('morning delivery has one news button, and filtered-empty news sends nothing',async()=>{
  for (const text of ['☀️ <b>Футбольное утро</b>','']) {
    const sent=[];
    const {api}=runtime({
      currentMorningFootballNews:async()=>({items:[{title:'Club update',url:'https://example.com/a'}]}),
      morningNewsText:()=>text,
      telegramApi:async(method,cfg,payload)=>{sent.push({method,payload});return {ok:true};},
      runBoundedDailyDigest:async options=>{
        if (options.sendNews) await options.sendNews({chat_id:7});
        return {claimed:1,sent:1};
      },
    });
    await api.setBotDigestSubscription(7,7,true,{});
    await api.processDailyDigests({botToken:'test-token'},new Date('2026-10-07T07:00:00Z'));
    assert.equal(sent.length,text?1:0);
    if (text) {
      assert.equal(sent[0].payload.text,text);
      assert.deepEqual(sent[0].payload.reply_markup,{inline_keyboard:[[{text:'📰 Все новости',callback_data:'news:general'}]]});
      assert.equal(sent[0].payload.disable_web_page_preview,true);
    }
  }
});

const cardPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZwoAAAAASUVORK5CYII=';
test('background cards render at most two boards from fresh cache without provider API calls',async()=>{
  const snapshot={fixtures:[rankedRow(1,'2H','Arsenal','Chelsea','Premier League',{goals:{home:1,away:0},elapsed:63})],fetchedAt:new Date().toISOString()};
  const cache=new Map([['provider-fixtures:2026-10-07:v1',snapshot]]);
  let renders=0;
  const {api}=runtime({
    isLiveStatus:()=>true,
    freeQuotaHealthy:()=>{throw new Error('background must not check provider quota');},
    loadProviderFixturesForDate:()=>{throw new Error('no new provider calls');},
    getCache:async key=>cache.get(key),
    getStaleCache:()=>{throw new Error('no stale input');},
    setCache:async(key,id,payload)=>cache.set(key,payload),
  });
  const cfg={botMatchCardsEnabled:true,botMatchCardRenderer:async()=>{renders++;return cardPng;}};
  assert.deepEqual(await api.processBotMatchCards(cfg),{prepared:2,failed:0,degraded:false});
  assert.equal(renders,2);
  assert.deepEqual(await api.processBotMatchCards(cfg),{prepared:0,failed:0,degraded:false});
  for (const [key,value] of cache) {
    if (key.startsWith('bot:match-card:')) value.generatedAt=Date.now()-5*60000;
  }
  assert.deepEqual(await api.processBotMatchCards(cfg),{prepared:2,failed:0,degraded:false},'renew before TTL expires even without a score change');
  assert.equal(renders,4);
  snapshot.fetchedAt=new Date(Date.now()-7*60000).toISOString();
  assert.deepEqual(await api.processBotMatchCards(cfg),{prepared:0,failed:0,degraded:false});
  assert.equal(renders,4);
});

test('cached board sends one photo with readable caption and unchanged buttons; mismatched score uses text',async()=>{
  const sent=[];
  const snapshot={fixtures:[rankedRow(1,'2H','Arsenal','Chelsea','Premier League',{goals:{home:1,away:0},elapsed:63})]};
  const {api,deps}=rankedRuntime(snapshot,sent);
  const selected=await api.loadBotDayMatches({}, {liveOnly:true});
  const cache={png:cardPng,signature:botCardSignature(selected,true),generatedAt:Date.now()};
  const modified=createTelegramDigestRuntime({...deps,getCache:async key=>key.includes('bot:match-card')?cache:null});
  await modified.sendBotDayMatches({}, {botMatchCardsEnabled:true},42,{liveOnly:true});
  assert.equal(sent.length,1);
  assert.equal(sent[0].method,'sendPhoto');
  const form=sent[0].payload;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('chat_id'),'42');
  assert.match(form.get('caption'),/LIVE сейчас/);
  assert.doesNotMatch(form.get('caption'),/Arsenal/,'the picture is not duplicated in the caption');
  assert.match(JSON.parse(form.get('reply_markup')).inline_keyboard[0][0].text,/63′ Arsenal 1:0 Chelsea/);
  assert.ok(form.get('caption').length<1024);
  assert.equal(form.get('photo').type,'image/png');
  assert.equal(JSON.parse(form.get('reply_markup')).inline_keyboard[0][0].callback_data,'match:menu:1');
  snapshot.fixtures[0].fixture.status.elapsed=64;
  await modified.sendBotDayMatches({}, {botMatchCardsEnabled:true},42,{liveOnly:true});
  assert.equal(sent[1].method,'sendPhoto','minute changes must not switch the response to plain text');
  assert.match(JSON.parse(sent[1].payload.get('reply_markup')).inline_keyboard[0][0].text,/64′/);
  snapshot.fixtures[0].goals.home=2;
  await modified.sendBotDayMatches({}, {botMatchCardsEnabled:true},42,{liveOnly:true});
  assert.equal(sent[2].method,'sendMessage');
  assert.match(sent[2].payload.text,/2:0/);
});

test('photo timeout does not double-send; definite invalid photo falls back to text',async()=>{
  const snapshot={fixtures:[rankedRow(1,'2H','Arsenal','Chelsea','Premier League',{goals:{home:1,away:0},elapsed:63})]};
  const {api,deps}=rankedRuntime(snapshot,[]);
  const selected=await api.loadBotDayMatches({}, {liveOnly:true});
  const cache={png:cardPng,signature:botCardSignature(selected,true),generatedAt:Date.now()};
  for (const code of ['TELEGRAM_TIMEOUT','TELEGRAM_REJECTED']) {
    const sent=[];
    const error=Object.assign(new Error('PHOTO_INVALID'),{code,status:400});
    const modified=createTelegramDigestRuntime({...deps,getCache:async key=>key.includes('bot:match-card')?cache:null,
      telegramApi:async(method,cfg,payload)=>{sent.push(method);if(method==='sendPhoto') throw error;},
    });
    const action=modified.sendBotDayMatches({}, {botMatchCardsEnabled:true},42,{liveOnly:true});
    if (code==='TELEGRAM_TIMEOUT') {await assert.rejects(action,e=>e===error);assert.deepEqual(sent,['sendPhoto']);}
    else {await action;assert.deepEqual(sent,['sendPhoto','sendMessage']);}
  }
});
