import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAnalysisAccessUsage,
  analysisAccessUsageHtml,
} from '../public/modules/analysis-access.js';
import { createAnalysisController } from '../public/modules/analysis-controller.js';
import { resolveEntitlementAccess } from '../src/entitlements.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function entitlement(overrides = {}) {
  return {
    source:'free',
    plan:'FREE',
    effectiveTier:'FREE',
    passes:{active:[]},
    decisions:[],
    ...overrides,
  };
}

function createController({
  api = async () => ({}),
  buildAccessUsage = buildAnalysisAccessUsage,
} = {}) {
  const state = {
    analysisActionPending:false,
    analysisRequestSeq:0,
    analysisBackView:'matchesView',
    currentCenter:null,
    runtimeStatus:null,
    profile:{
      quota:{plan:'FREE',used:0,limit:3,left:3},
    },
    remindersLoaded:true,
    favoritesLoaded:true,
  };
  const calls = {
    showView:[],
    renderAnalysis:[],
    paywall:[],
    toasts:[],
    refreshedPass:[],
    accessUsage:[],
  };

  const controller = createAnalysisController({
    state,
    documentRef:null,
    activeViewId:()=> 'matchesView',
    showView:(...args)=>calls.showView.push(args),
    api,
    runtimeAllows:()=>true,
    stopLiveRefresh:()=>{},
    hideQuotaPaywall:()=>{},
    showQuotaPaywallForFixture:id=>calls.paywall.push(id),
    syncAnalysisBusyUi:()=>{},
    renderJourneyState:()=>{},
    renderAnalysis:data=>calls.renderAnalysis.push(data),
    renderMatchCenter:()=>{},
    rememberHistoryAnalysis:()=>{},
    renderProfile:()=>{},
    renderProvider:()=>{},
    renderDiscoveryHome:()=>{},
    renderGlobalSearch:()=>{},
    loadHistory:async()=>{},
    loadReminders:async()=>{},
    loadFavorites:async()=>{},
    buildAnalysisAccessUsage:args=>{
      calls.accessUsage.push(args);
      return buildAccessUsage(args);
    },
    refreshPassAccess:async fixtureId=>calls.refreshedPass.push(fixtureId),
    isAdmin:()=>false,
    sendProductAction:()=>{},
    sendOperationTiming:()=>{},
    sendActionError:()=>{},
    apiErrorCategory:()=> 'generic',
    toast:message=>calls.toasts.push(message),
    performanceNow:()=>1,
  });

  return {controller,state,calls};
}

const app = readRepoFile('public/app.js');
const billing = readRepoFile('public/modules/billing.js');
const analysisRuntime = readRepoFile('src/analysis-runtime.js');

test('analysis access identifies FREE quota without implying Pass consumption', () => {
  const usage=buildAnalysisAccessUsage({
    analysis:{quota:{plan:'FREE',used:1,limit:3,left:2}},
    entitlementBefore:{entitlement:entitlement()},
    profile:{},
    fixtureId:100,
  });

  assert.deepEqual(usage,{
    kind:'quota',
    label:'Использовано: FREE · 1/3 сегодня',
    detail:'Pass для этого анализа не использовался.',
  });
});

test('analysis access clamps malformed quota values instead of displaying impossible usage', () => {
  const over=buildAnalysisAccessUsage({
    analysis:{quota:{plan:'FREE',used:99,limit:3,left:-96}},
    entitlementBefore:{entitlement:entitlement()},
  });
  assert.equal(over.label,'Использовано: FREE · 3/3 сегодня');

  const malformed=buildAnalysisAccessUsage({
    analysis:{cached:true,quota:{plan:'FREE',left:-1}},
    entitlementBefore:{entitlement:entitlement()},
  });
  assert.equal(malformed.kind,'cached');
  assert.equal(malformed.detail,'');
});

test('Match Pass is scoped to the selected positive integer fixture', () => {
  const row={id:11,type:'MATCH_PASS',fixtureId:777,usageLimit:null,usageCount:0};

  const matching=buildAnalysisAccessUsage({
    analysis:{quota:{plan:'FREE',used:3,limit:3,left:0}},
    entitlementBefore:{entitlement:entitlement({
      source:'pass',
      effectiveTier:'PASS',
      passes:{active:[row]},
    })},
    entitlementAfter:{entitlement:entitlement({
      source:'pass',
      effectiveTier:'PASS',
      passes:{active:[row]},
    })},
    fixtureId:777,
  });
  assert.equal(matching.passType,'MATCH_PASS');
  assert.equal(matching.label,'Использовано: Match Pass · только этот матч');
  assert.match(matching.detail,/Другие матчи/);

  for (const fixtureId of [0,-1,1.5,778]) {
    const usage=buildAnalysisAccessUsage({
      analysis:{quota:{plan:'FREE',used:2,limit:3,left:1}},
      entitlementBefore:{entitlement:entitlement({
        source:'pass',
        passes:{active:[row]},
      })},
      fixtureId,
    });
    assert.equal(usage.kind,'quota');
  }
});

test('Day Pass and Weekend Pass follow server usage semantics', () => {
  const day={id:12,type:'DAY_PASS',fixtureId:0,usageLimit:null,usageCount:0};
  const weekend={id:13,type:'WEEKEND_PASS',fixtureId:0,usageLimit:6,usageCount:5};

  const dayUsage=buildAnalysisAccessUsage({
    analysis:{quota:{plan:'FREE',used:3,limit:3,left:0}},
    entitlementBefore:{entitlement:entitlement({source:'pass',passes:{active:[day]}})},
    entitlementAfter:{entitlement:entitlement({source:'pass',passes:{active:[day]}})},
    fixtureId:888,
  });
  assert.equal(dayUsage.label,'Использовано: Day Pass · все матчи');

  const weekendUsage=buildAnalysisAccessUsage({
    analysis:{quota:{plan:'FREE',used:3,limit:3,left:0}},
    entitlementBefore:{entitlement:entitlement({source:'pass',passes:{active:[weekend]}})},
    entitlementAfter:{entitlement:entitlement({
      source:'free',
      passes:{active:[]},
      decisions:[{
        id:13,
        type:'WEEKEND_PASS',
        usageLimit:6,
        usageCount:6,
        active:false,
        reason:'usage_exhausted',
      }],
    })},
    fixtureId:999,
  });
  assert.equal(weekendUsage.label,'Использовано: Weekend Pass · 6/6 AI-анализов');
  assert.equal(weekendUsage.detail,'Осталось анализов: 0.');
});

test('frontend rejects malformed active Pass rows just as server entitlement validation does', () => {
  const malformedRows=[
    {
      id:1.5,
      telegram_id:123,
      entitlement_type:'MATCH_PASS',
      fixture_id:777,
      starts_at:'2026-10-01T00:00:00Z',
      expires_at:'2026-11-01T00:00:00Z',
      usage_limit:null,
      usage_count:0,
      status:'active',
    },
    {
      id:2,
      telegram_id:123,
      entitlement_type:'WEEKEND_PASS',
      fixture_id:0,
      starts_at:'2026-10-01T00:00:00Z',
      expires_at:'2026-11-01T00:00:00Z',
      usage_limit:-6,
      usage_count:0,
      status:'active',
    },
  ];
  const server=resolveEntitlementAccess({
    plan:'FREE',
    entitlements:malformedRows,
    fixtureId:777,
    now:Date.parse('2026-10-07T12:00:00Z'),
  });
  assert.equal(server.source,'free');

  const frontend=buildAnalysisAccessUsage({
    analysis:{quota:{plan:'FREE',used:1,limit:3,left:2}},
    entitlementBefore:{entitlement:entitlement({
      source:'pass',
      passes:{
        active:[
          {id:1.5,type:'MATCH_PASS',fixtureId:777,usageLimit:null,usageCount:0},
          {id:2,type:'WEEKEND_PASS',fixtureId:0,usageLimit:-6,usageCount:0},
        ],
      },
    })},
    fixtureId:777,
  });
  assert.equal(frontend.kind,'quota');
  assert.equal(frontend.label,'Использовано: FREE · 1/3 сегодня');
});

test('unlimited Pass is preferred before limited Weekend to preserve limited quota', () => {
  const weekend={id:13,type:'WEEKEND_PASS',fixtureId:0,usageLimit:6,usageCount:2};
  const day={id:14,type:'DAY_PASS',fixtureId:0,usageLimit:null,usageCount:0};

  const usage=buildAnalysisAccessUsage({
    analysis:{quota:{plan:'FREE',used:3,limit:3,left:0}},
    entitlementBefore:{entitlement:entitlement({
      source:'pass',
      passes:{active:[weekend,day]},
    })},
    entitlementAfter:{entitlement:entitlement({
      source:'pass',
      passes:{active:[weekend,day]},
    })},
    fixtureId:321,
  });

  assert.equal(usage.passType,'DAY_PASS');
});

test('free recheck and cached analysis take precedence over Pass inference', () => {
  const before={entitlement:entitlement({
    source:'pass',
    passes:{active:[{id:13,type:'WEEKEND_PASS',fixtureId:0,usageLimit:6,usageCount:1}]},
  })};

  const freeRecheck=buildAnalysisAccessUsage({
    analysis:{recheck:{free:true},quota:{plan:'FREE',used:2,limit:3,left:1}},
    entitlementBefore:before,
    fixtureId:123,
  });
  assert.equal(freeRecheck.kind,'free_recheck');
  assert.match(freeRecheck.label,/Без списания/);

  const cached=buildAnalysisAccessUsage({
    analysis:{cached:true,quota:{plan:'FREE',used:2,limit:3,left:1}},
    entitlementBefore:before,
    fixtureId:123,
  });
  assert.equal(cached.kind,'cached');
  assert.equal(cached.detail,'Осталось по дневной квоте: 1.');
});

test('analysis access HTML escapes content even when no external escape helper is supplied', () => {
  const html=analysisAccessUsageHtml({
    label:'<FREE & Pass>',
    detail:'<script>alert("x")</script>',
  });

  assert.match(html,/&lt;FREE &amp; Pass&gt;/);
  assert.match(html,/&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script/i);
  assert.ok(!html.includes('<FREE'));
});

test('analysis controller validates entitlement snapshot fixture IDs before calling API', async () => {
  const apiCalls=[];
  const {controller}=createController({
    api:async (...args)=>{
      apiCalls.push(args);
      return {};
    },
  });

  for (const fixtureId of [0,-1,1.5,Number.NaN,'bad']) {
    assert.equal(await controller.loadAnalysisAccessSnapshot(fixtureId),null);
  }
  assert.equal(apiCalls.length,0);

  await controller.loadAnalysisAccessSnapshot(777);
  assert.deepEqual(apiCalls,[[
    '/api/entitlements?fixtureId=777',
    {retry:false,timeoutMs:4000},
  ]]);
});

test('successful Pass analysis snapshots entitlement before and after server consumption', async () => {
  const apiCalls=[];
  const passBefore={
    entitlement:entitlement({
      source:'pass',
      passes:{active:[{id:13,type:'WEEKEND_PASS',fixtureId:0,usageLimit:6,usageCount:5}]},
    }),
  };
  const passAfter={
    entitlement:entitlement({
      source:'free',
      passes:{active:[]},
      decisions:[{id:13,type:'WEEKEND_PASS',usageLimit:6,usageCount:6,active:false,reason:'usage_exhausted'}],
    }),
  };

  let entitlementReads=0;
  const {controller,calls}=createController({
    api:async (path,options)=>{
      apiCalls.push({path,options});
      if (path.startsWith('/api/entitlements')) {
        entitlementReads+=1;
        return entitlementReads===1 ? passBefore : passAfter;
      }
      if (path==='/api/analyze') {
        return {quota:{plan:'FREE',used:3,limit:3,left:0}};
      }
      return {};
    },
  });

  await controller.analyzeMatch(777,null,{recheck:false});

  assert.equal(entitlementReads,2);
  assert.equal(apiCalls[1].path,'/api/analyze');
  assert.deepEqual(JSON.parse(apiCalls[1].options.body),{
    fixtureId:777,
    origin:'miniapp',
    recheck:false,
    newsImpactDecision:'',
    newsImpactAction:'',
    newsImpactRecoveryCode:'',
    newsImpactRecoveryFrom:'',
  });
  assert.equal(calls.accessUsage.length,1);
  assert.equal(calls.renderAnalysis[0].accessUsage.passType,'WEEKEND_PASS');
  assert.equal(calls.renderAnalysis[0].accessUsage.detail,'Осталось анализов: 0.');
  assert.deepEqual(calls.refreshedPass,[777]);
});

test('quota exhaustion opens AI access UI without treating provider throttling as a paywall', () => {
  assert.match(
    readRepoFile('public/modules/analysis-controller.js'),
    /const providerRateLimit = error\?\.status === 429[\s\S]*?startsWith\('FOOTBALL_'\)[\s\S]*?const quotaExhausted = error\?\.status === 429 && !providerRateLimit;[\s\S]*?if \(quotaExhausted\) showPaywall\(fixtureId\)/,
  );
  assert.match(
    analysisRuntime,
    /if \(!freeRecheck && !passCandidate && quotaBefore\.left<=0\)[\s\S]*?quota_exhausted/,
  );
  assert.match(
    analysisRuntime,
    /if \(!freeRecheck && passCandidate\)[\s\S]*?reserveEntitlementUsage/,
  );
});

test('analysis access UI wiring and Profile Pass copy keep scope explicit', () => {
  assert.match(app,/analysis-access\.js/);
  assert.match(app,/analysisAccessUsageHtml\(d\.accessUsage, escapeHtml\)/);

  assert.match(billing,/Активен только для выбранного матча/);
  assert.match(billing,/Все поддерживаемые матчи/);
  assert.match(billing,/использовано ' \+ used \+ '\/' \+ limit/);
  assert.match(billing,/осталось ' \+ Math\.max\(0, limit - used\)/);
  assert.match(billing,/только матч №/);
});
