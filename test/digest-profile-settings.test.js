import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DIGEST_FIXED_HOUR_UTC,
  createDigestSettingsModule,
  digestDeliverySummary,
  digestLocalDeliveryWindow,
  normalizeDigestSettingsPayload,
} from '../public/modules/digest-settings.js';
import { createTelegramDigestRuntime } from '../src/telegram-digest-runtime.js';
import { createUserDataApiRuntime } from '../src/user-data-api-runtime.js';
import {
  DAILY_DIGEST_POLICY,
  assessDailyDigestRun,
  planDailyDigestRecipients,
  runBoundedDailyDigest,
} from '../src/daily-digest-delivery.js';
import { SMART_NOTIFICATION_POLICY } from '../src/smart-notification-policy.js';

function digestRuntime(overrides={}) {
  const memory={
    botDigestSubscriptions:new Map(),
  };
  const calls={
    mutations:[],
    selectOne:[],
    paged:[],
    upserts:[],
    telegram:[],
    events:[],
  };
  const deps={
    DAILY_DIGEST_POLICY,
    SMART_NOTIFICATION_POLICY,
    apiFootball:async()=>[],
    assessDailyDigestRun,
    botMatchButtonText:match=>String(match?.fixtureId || ''),
    bumpTelemetry:()=>{},
    currentMorningFootballNews:async()=>({items:[],degraded:false}),
    filterSmartNotificationRecipients:async()=>({rows:[]}),
    footballBotKeyboard:()=>({inline_keyboard:[]}),
    freeQuotaHealthy:()=>false,
    getAnalysisTimelineSnapshots:async()=>[],
    getCache:async()=>null,
    getFavorites:async()=>[],
    getStaleCache:async()=>null,
    hasSupabase:()=>false,
    isFootballRateLimitError:()=>false,
    isLiveStatus:()=>false,
    isYouthReserveMatch:()=>false,
    loadProviderFixturesForDate:async()=>[],
    markTelegramWebhookMutation:(...args)=>calls.mutations.push(args),
    matchInterestScore:()=>0,
    memory,
    morningNewsText:()=> '',
    newsConversionKeyboard:()=>({inline_keyboard:[]}),
    normalizeBotFixtureCard:value=>value,
    normalizeCompetition:()=>({priority:0,featured:false}),
    planDailyDigestRecipients,
    radarStrongSignalState:()=>({reason:'insufficient'}),
    recordOpsEvent:async(...args)=>{ calls.events.push(args); },
    rememberBotFixtureCards:async()=>{},
    runBoundedDailyDigest,
    setCache:async()=>{},
    sleepMs:async()=>{},
    supaPatch:async()=>{},
    supaRpc:async()=>false,
    supaSelectOne:async(...args)=>{
      calls.selectOne.push(args);
      return null;
    },
    supaSelectPaged:async(...args)=>{
      calls.paged.push(args);
      return {rows:[],truncated:false};
    },
    supaUpsert:async(...args)=>{ calls.upserts.push(args); },
    telegramApi:async(...args)=>{
      calls.telegram.push(args);
      return {ok:true};
    },
    telegramHtmlEscape:value=>String(value)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;'),
    todayUtc:()=> '2026-10-07',
    ...overrides,
  };
  return {
    api:createTelegramDigestRuntime(deps),
    memory,
    calls,
    deps,
  };
}

function userDataRuntime({
  digest,
  overrides={},
}={}) {
  const calls={
    setDigest:[],
    events:[],
  };
  const json=(body,status=200,headers={})=>({body,status,headers});
  const noOpAsync=async()=>null;
  const telegram=digest || digestRuntime();
  const deps={
    addFavorite:noOpAsync,
    addFavoritePlayer:noOpAsync,
    addReminder:noOpAsync,
    analysisFreshness:()=>({}),
    analysisResponsePayload:value=>value,
    getBotDigestSubscription:telegram.api.getBotDigestSubscription,
    getCache:noOpAsync,
    getFavoritePlayers:async()=>[],
    getFavorites:async()=>[
      {team_id:40,team_name:'Liverpool'},
      {team_id:40,team_name:'Liverpool duplicate'},
    ],
    getHistory:async()=>[],
    getPreferences:async()=>({}),
    getQuota:async()=>({plan:'PRO'}),
    getReminders:async()=>[],
    getStaleCache:noOpAsync,
    getUserRecord:async()=>({}),
    isAdminUser:()=>false,
    json,
    publicDataCapabilities:()=>({}),
    publicDigestSettings:telegram.api.publicDigestSettings,
    publicPlayerFollowNotificationContract:()=>({}),
    publicRuntimeControls:()=>({}),
    publicSiteUrl:()=> 'https://app.test/',
    publicSmartNotificationCapabilities:()=>({}),
    recordOpsEvent:async(...args)=>{ calls.events.push(args); },
    reminderDeliveryStatus:()=> 'pending',
    removeFavorite:noOpAsync,
    removeFavoritePlayer:noOpAsync,
    removeReminder:noOpAsync,
    savePreferences:async()=>({}),
    setBotDigestSubscription:async(...args)=>{
      calls.setDigest.push(args);
      return telegram.api.setBotDigestSubscription(...args);
    },
    ...overrides,
  };
  return {
    api:createUserDataApiRuntime(deps),
    calls,
    telegram,
  };
}

test('digest settings normalize the fixed UTC delivery contract without coercion',()=>{
  const settings=normalizeDigestSettingsPayload({
    settings:{
      enabled:true,
      configured:true,
      plan:'PRO',
      delivery:{hourUtc:7,label:'07:00 UTC'},
      capabilities:{
        baseDigest:true,
        morningNews:true,
        favoritePriority:false,
        customDeliveryTime:false,
        planSpecificContent:true,
      },
      favoriteTeams:[
        {teamId:40,teamName:'Liverpool'},
        {teamId:'40',teamName:'Duplicate'},
        {teamId:50,teamName:'Barcelona'},
      ],
    },
  });

  assert.equal(DIGEST_FIXED_HOUR_UTC,7);
  assert.equal(settings.enabled,true);
  assert.equal(settings.delivery.label,'07:00 UTC');
  assert.equal(settings.delivery.editable,false);
  assert.equal(settings.plan,'PRO');
  assert.equal(settings.capabilities.planSpecificContent,true);
  assert.equal(settings.capabilities.favoritePriority,false);
  assert.deepEqual(settings.favoriteTeams,[
    {teamId:40,teamName:'Liverpool'},
    {teamId:50,teamName:'Barcelona'},
  ]);
  assert.equal(digestDeliverySummary(settings).status,'Включена');
  assert.equal(
    digestLocalDeliveryWindow(
      7,
      new Date('2026-10-01T00:00:00Z'),
      'Europe/Warsaw',
    ),
    '09:00–09:55',
  );
  assert.equal(
    digestLocalDeliveryWindow(
      '8',
      new Date('2026-10-01T00:00:00Z'),
      'UTC',
    ),
    '07:00–07:55',
  );
});

test('digest settings fail closed for malformed and hostile payload fields',()=>{
  const hostilePlan={
    toString(){ throw new Error('must not coerce plan'); },
  };
  const hostileTeam={teamId:true};
  Object.defineProperty(hostileTeam,'teamName',{
    get(){ throw new Error('must not read hostile team name'); },
  });

  const settings=normalizeDigestSettingsPayload({
    settings:{
      enabled:'true',
      configured:1,
      plan:hostilePlan,
      delivery:{
        hourUtc:true,
        label:{toString(){ throw new Error('must not coerce label'); }},
        editable:true,
      },
      capabilities:{
        baseDigest:'true',
        customDeliveryTime:'true',
        planSpecificContent:1,
      },
      favoriteTeams:[
        hostileTeam,
        {teamId:false,teamName:'Bad'},
        {teamId:0,teamName:'Bad'},
      ],
      updatedAt:{toString(){ throw new Error('must not coerce timestamp'); }},
    },
  });

  assert.equal(settings.enabled,false);
  assert.equal(settings.configured,false);
  assert.equal(settings.plan,'FREE');
  assert.equal(settings.delivery.hourUtc,7);
  assert.equal(settings.delivery.label,'07:00 UTC');
  assert.equal(settings.delivery.editable,false);
  assert.deepEqual(settings.capabilities,{
    baseDigest:false,
    morningNews:false,
    favoritePriority:false,
    customDeliveryTime:false,
    planSpecificContent:false,
  });
  assert.deepEqual(settings.favoriteTeams,[]);
  assert.equal(settings.updatedAt,null);
});

test('concurrent Mini App toggles are serialized and the last requested state wins',async()=>{
  const root={innerHTML:''};
  const calls=[];
  let releaseFirst;
  const firstGate=new Promise(resolve=>{ releaseFirst=resolve; });
  const api=async(path,options={})=>{
    assert.equal(path,'/api/digest-settings');
    const enabled=JSON.parse(options.body || '{}').enabled;
    calls.push(enabled);
    if (calls.length===1) await firstGate;
    return {
      settings:{
        enabled,
        configured:true,
        plan:'FREE',
        delivery:{hourUtc:7,label:'07:00 UTC'},
        capabilities:{baseDigest:true,morningNews:true},
        favoriteTeams:[],
      },
    };
  };
  const module=createDigestSettingsModule({
    elementById:id=>id==='digestSettingsRoot' ? root : null,
    api,
    escapeHtml:value=>String(value),
    planLabel:plan=>plan,
  });

  const first=module.setDigestEnabled(true);
  const second=module.setDigestEnabled(false);
  releaseFirst();
  await Promise.all([first,second]);

  assert.deepEqual(calls,[true,false]);
  assert.equal(module.snapshot().settings.enabled,false);
  assert.equal(module.saving,false);
});

test('a failed in-flight toggle cannot discard a newer requested state',async()=>{
  const root={innerHTML:''};
  const calls=[];
  let releaseFirst;
  const firstGate=new Promise(resolve=>{ releaseFirst=resolve; });
  const api=async(_path,options={})=>{
    const enabled=JSON.parse(options.body || '{}').enabled;
    calls.push(enabled);
    if (calls.length===1) {
      await firstGate;
      throw new Error('first mutation failed');
    }
    return {
      settings:{
        enabled,
        configured:true,
        plan:'FREE',
        delivery:{hourUtc:7},
        capabilities:{baseDigest:true,morningNews:true},
        favoriteTeams:[],
      },
    };
  };
  const module=createDigestSettingsModule({
    elementById:id=>id==='digestSettingsRoot' ? root : null,
    api,
    escapeHtml:value=>String(value),
  });

  const first=module.setDigestEnabled(true);
  const second=module.setDigestEnabled(false);
  releaseFirst();
  await Promise.all([first,second]);

  assert.deepEqual(calls,[true,false]);
  assert.equal(module.snapshot().settings.enabled,false);
  assert.equal(module.snapshot().error,'');
  assert.equal(module.saving,false);
});

test('concurrent digest reloads join one server read and malformed writes are rejected',async()=>{
  const root={innerHTML:''};
  let calls=0;
  let release;
  const gate=new Promise(resolve=>{ release=resolve; });
  const module=createDigestSettingsModule({
    elementById:id=>id==='digestSettingsRoot' ? root : null,
    api:async()=>{
      calls+=1;
      await gate;
      return {
        settings:{
          enabled:true,
          configured:true,
          plan:'FREE',
          delivery:{hourUtc:7},
          capabilities:{baseDigest:true,morningNews:true},
          favoriteTeams:[],
        },
      };
    },
    escapeHtml:value=>String(value),
  });

  const first=module.loadDigestSettings();
  const second=module.loadDigestSettings();
  assert.equal(calls,1);
  release();
  const [a,b]=await Promise.all([first,second]);
  assert.equal(a.enabled,true);
  assert.equal(b.enabled,true);
  assert.equal(calls,1);

  await assert.rejects(
    ()=>module.setDigestEnabled('false'),
    /must be boolean/,
  );
  assert.equal(calls,1);
});

test('reload keeps last known settings visible when the database read fails',async()=>{
  const root={innerHTML:''};
  let calls=0;
  const api=async()=>{
    calls+=1;
    if (calls===1) {
      return {
        settings:{
          enabled:true,
          configured:true,
          plan:'PREMIUM',
          delivery:{hourUtc:7,label:'07:00 UTC'},
          capabilities:{
            baseDigest:true,
            morningNews:true,
            favoritePriority:false,
            customDeliveryTime:false,
            planSpecificContent:true,
          },
          favoriteTeams:[{teamId:50,teamName:'Barcelona'}],
        },
      };
    }
    throw new Error('База данных временно недоступна');
  };
  const module=createDigestSettingsModule({
    elementById:id=>id==='digestSettingsRoot' ? root : null,
    api,
    escapeHtml:value=>String(value),
    planLabel:plan=>plan,
  });

  await module.loadDigestSettings();
  await assert.rejects(
    ()=>module.loadDigestSettings(true),
    /База данных/,
  );

  const snapshot=module.snapshot();
  assert.equal(snapshot.settings.enabled,true);
  assert.equal(snapshot.settings.plan,'PREMIUM');
  assert.match(snapshot.error,/База данных/);
  assert.match(root.innerHTML,/База данных временно недоступна/);
  assert.doesNotMatch(
    root.innerHTML,
    /Barcelona|Любимые команды|digest-team-chips|digest-favorites/,
  );
});

test('initial database error renders recovery state instead of a false disabled subscription',async()=>{
  const root={innerHTML:''};
  const module=createDigestSettingsModule({
    elementById:id=>id==='digestSettingsRoot' ? root : null,
    api:async()=>{ throw new Error('Хранилище временно недоступно'); },
    escapeHtml:value=>String(value),
  });

  await assert.rejects(
    ()=>module.loadDigestSettings(),
    /Хранилище/,
  );
  assert.equal(module.snapshot().settings,null);
  assert.match(root.innerHTML,/Подборка временно недоступна/);
  assert.match(root.innerHTML,/Повторить/);
});

test('authenticated digest API uses the existing subscription store and strict boolean writes',async()=>{
  const digest=digestRuntime();
  const {api,calls,telegram}=userDataRuntime({digest});
  const request=url=>({
    method:'PUT',
    url,
    json:async()=>({enabled:true}),
  });

  const unauthenticated=await api.apiDigestSettings(
    {method:'GET',url:'https://app.test/api/digest-settings'},
    {},
    {id:false},
  );
  assert.equal(unauthenticated.status,401);
  assert.equal(
    telegram.memory.botDigestSubscriptions.size,
    0,
  );

  const invalid=await api.apiDigestSettings(
    {
      method:'PUT',
      url:'https://app.test/api/digest-settings',
      json:async()=>({enabled:'true'}),
    },
    {},
    {id:777},
  );
  assert.equal(invalid.status,400);
  assert.equal(calls.setDigest.length,0);

  const saved=await api.apiDigestSettings(
    request('https://app.test/api/digest-settings'),
    {},
    {id:777},
  );
  assert.equal(saved.status,200);
  assert.equal(saved.body.ok,true);
  assert.equal(saved.body.settings.enabled,true);
  assert.equal(saved.body.settings.configured,true);
  assert.equal(saved.body.settings.delivery.hourUtc,7);
  assert.equal(saved.body.settings.plan,'PRO');
  assert.deepEqual(saved.body.settings.favoriteTeams,[
    {teamId:40,teamName:'Liverpool'},
  ]);
  assert.equal(calls.setDigest.length,1);
  assert.equal(telegram.memory.botDigestSubscriptions.get(777).enabled,true);

  const loaded=await api.apiDigestSettings(
    {method:'GET',url:'https://app.test/api/digest-settings'},
    {},
    {id:777},
  );
  assert.equal(loaded.status,200);
  assert.equal(loaded.body.settings.enabled,true);
});

test('persistent digest subscription boundary validates rows before delivery',async()=>{
  const calls={
    upserts:[],
  };
  const {api}=digestRuntime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>({
      telegram_id:321,
      chat_id:'-900',
      app_url:'https://old.test/',
    }),
    supaUpsert:async(...args)=>{ calls.upserts.push(args); },
    supaSelectPaged:async()=>({
      rows:[
        {telegram_id:1,chat_id:1,enabled:true},
        {telegram_id:2,chat_id:2,enabled:false},
        {telegram_id:true,chat_id:3,enabled:true},
        {telegram_id:4,chat_id:false,enabled:true},
      ],
      truncated:false,
    }),
  });

  const saved=await api.setBotDigestSubscription(
    321,
    -800,
    true,
    {supabaseUrl:'https://db.test'},
    'https://app.test/',
  );
  assert.equal(saved.telegram_id,321);
  assert.equal(saved.chat_id,-900);
  assert.equal(saved.hour_utc,DAILY_DIGEST_POLICY.deliveryHourUtc);
  assert.equal(saved.enabled,true);
  assert.equal(calls.upserts.length,1);
  assert.equal(calls.upserts[0][1],'bot_digest_subscriptions');
  assert.equal(calls.upserts[0][3],'telegram_id');

  await assert.rejects(
    ()=>api.setBotDigestSubscription(321,-800,'true',{},''),
    /enabled must be boolean/,
  );

  const page=await api.loadBotDigestSubscriptions({
    supabaseUrl:'https://db.test',
  });
  assert.deepEqual(page.rows,[
    {telegram_id:1,chat_id:1,enabled:true},
  ]);

  const malformed=api.publicDigestSettings(
    {
      telegram_id:'bad',
      enabled:true,
      updated_at:{toString(){ throw new Error('must not coerce'); }},
    },
    {toString(){ throw new Error('must not coerce plan'); }},
    [
      {team_id:50,team_name:'Barcelona'},
      {team_id:50,team_name:'Duplicate'},
      {team_id:true,team_name:'Bad'},
    ],
  );
  assert.equal(malformed.configured,false);
  assert.equal(malformed.plan,'FREE');
  assert.equal(malformed.updatedAt,null);
  assert.deepEqual(malformed.favoriteTeams,[
    {teamId:50,teamName:'Barcelona'},
  ]);
});

test('daily digest delivery uses claim-arm-send-complete state transitions',async()=>{
  const memory={
    botDigestSubscriptions:new Map([
      [123,{
        telegram_id:123,
        chat_id:123,
        enabled:true,
        hour_utc:7,
        last_sent_date:null,
      }],
    ]),
  };
  const sent=[];
  const {api}=digestRuntime({
    memory,
    getCache:async key=>{
      if (String(key).startsWith('bot:digest:')) {
        return {
          date:'2026-10-07',
          rows:[{
            fixtureId:9001,
            homeName:'Alpha',
            awayName:'Beta',
            league:'League',
            date:'2026-10-07T18:00:00Z',
            live:false,
          }],
          source:'cache',
          providerDegraded:false,
          providerRateLimited:false,
        };
      }
      return null;
    },
    telegramApi:async(method,_cfg,payload)=>{
      sent.push({method,payload});
      return {ok:true};
    },
  });

  const result=await api.processDailyDigests(
    {botToken:'token'},
    new Date('2026-10-07T07:05:00Z'),
  );

  assert.equal(result.sent,1);
  assert.equal(result.failed,0);
  assert.equal(sent.length,1);
  assert.equal(sent[0].method,'sendMessage');
  assert.equal(sent[0].payload.chat_id,123);
  assert.equal(memory.botDigestSubscriptions.get(123).last_sent_date,'2026-10-07');
  assert.equal(memory.botDigestSubscriptions.get(123).delivery_claim_date,null);
  assert.equal(memory.botDigestSubscriptions.get(123).delivery_locked_until,null);
});

test('Profile surface exposes Russian Digest controls and narrow mobile layouts',()=>{
  const html=fs.readFileSync('public/index.html','utf8');
  const app=fs.readFileSync('public/app.js','utf8');
  const styles=fs.readFileSync('public/styles.css','utf8');
  const moduleSource=fs.readFileSync('public/modules/digest-settings.js','utf8');

  assert.match(html,/id="digestSettingsRoot"/);
  assert.match(app,/createDigestSettingsModule/);
  assert.match(app,/loadDigestSettings\(\)/);
  assert.match(moduleSource,/☀️ Утренняя подборка/);
  assert.match(moduleSource,/Получать подборку/);
  assert.match(moduleSource,/По вашему местному времени/);
  assert.match(moduleSource,/Время доставки задаётся автоматически/);
  assert.match(moduleSource,/Базовая подборка доступна/);
  assert.doesNotMatch(
    moduleSource,
    /Проверяем текущую подписку|текущей серверной доставке|серверное окно доставки/,
  );
  assert.doesNotMatch(moduleSource,/07:00–07:55 UTC/);
  assert.doesNotMatch(
    moduleSource,
    /⭐ Любимые команды|digest-favorites|digest-team-chips|Любимые команды уже связаны/,
  );
  assert.match(styles,/@media \(max-width: 430px\)[\s\S]*?\.digest-settings-grid/);
  assert.match(styles,/@media \(max-width: 360px\)[\s\S]*?\.digest-settings-head/);
});
