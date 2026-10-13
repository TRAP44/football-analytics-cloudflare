import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramDigestRuntime } from '../src/telegram-digest-runtime.js';

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
  assert.match(sent[0].payload.text,/Arsenal — Chelsea/);
  assert.doesNotMatch(sent[0].payload.text,/Inter/);

  sent.length=0;
  await api.sendBotDayMatches({url:'https://app.example/'},{},42,{liveOnly:false});
  assert.match(sent[0].payload.text,/Матчи сегодня/);
  assert.match(sent[0].payload.text,/Inter — Milan/);
  assert.doesNotMatch(sent[0].payload.text,/Roma/,'finished matches are hidden when others exist');
  assert.equal(sent[0].payload.reply_markup.inline_keyboard.length,2);
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
