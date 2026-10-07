import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisController } from '../public/modules/analysis-controller.js';

function readRepoFile(relativePath) {
  return readFileSync(
    new URL('../'+relativePath,import.meta.url),
    'utf8',
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise=new Promise((res,rej)=>{
    resolve=res;
    reject=rej;
  });
  return {promise,resolve,reject};
}

function baseState() {
  return {
    profile:{quota:{remaining:3}},
    provider:null,
    runtimeStatus:null,
    currentCenter:null,
    analysisBackView:'matchesView',
    analysisActionPending:false,
    analysisRequestSeq:0,
    remindersLoaded:false,
    favoritesLoaded:false,
  };
}

function makeController(overrides={}) {
  const state=overrides.state || baseState();
  const calls=[];
  let view=overrides.view || 'matchesView';

  const controller=createAnalysisController({
    state,
    documentRef:{},
    activeViewId:
      overrides.activeViewId
      || (()=>view),
    showView:
      overrides.showView
      || ((id,options)=>{
        calls.push(['view',id,options]);
        view=id;
      }),
    api:
      overrides.api
      || (async url=>{
        if (url.startsWith('/api/entitlements?')) {
          return {entitlement:{source:'free'}};
        }
        if (url==='/api/analyze') {
          return {
            match:{fixtureId:7},
            quota:{remaining:2},
          };
        }
        throw new Error('unexpected api '+url);
      }),
    runtimeAllows:
      overrides.runtimeAllows
      || (()=>true),
    stopLiveRefresh:
      overrides.stopLiveRefresh
      || (()=>calls.push(['stop-live'])),
    hideQuotaPaywall:
      overrides.hideQuotaPaywall
      || (()=>calls.push(['hide-paywall'])),
    showQuotaPaywallForFixture:
      overrides.showQuotaPaywallForFixture
      || (fixtureId=>calls.push(['show-paywall',fixtureId])),
    syncAnalysisBusyUi:
      overrides.syncAnalysisBusyUi
      || (()=>calls.push(['busy',state.analysisActionPending])),
    renderJourneyState:
      overrides.renderJourneyState
      || ((...args)=>calls.push(['journey',...args])),
    renderAnalysis:
      overrides.renderAnalysis
      || (data=>calls.push(['render-analysis',data])),
    renderMatchCenter:
      overrides.renderMatchCenter
      || (data=>calls.push(['render-center',data])),
    rememberHistoryAnalysis:
      overrides.rememberHistoryAnalysis
      || (data=>calls.push(['history',data])),
    renderProfile:
      overrides.renderProfile
      || (()=>calls.push(['profile'])),
    renderProvider:
      overrides.renderProvider
      || (()=>calls.push(['provider'])),
    renderDiscoveryHome:
      overrides.renderDiscoveryHome
      || (()=>calls.push(['discovery'])),
    renderGlobalSearch:
      overrides.renderGlobalSearch
      || (()=>calls.push(['search'])),
    loadHistory:
      overrides.loadHistory
      || ((...args)=>{
        calls.push(['load-history',...args]);
        return Promise.resolve();
      }),
    loadReminders:
      overrides.loadReminders
      || ((...args)=>{
        calls.push(['load-reminders',...args]);
        return Promise.resolve();
      }),
    loadFavorites:
      overrides.loadFavorites
      || ((...args)=>{
        calls.push(['load-favorites',...args]);
        return Promise.resolve();
      }),
    buildAnalysisAccessUsage:
      overrides.buildAnalysisAccessUsage
      || (args=>({
        fixtureId:args.fixtureId,
        source:
          args.entitlementBefore?.entitlement?.source
          || 'none',
      })),
    refreshPassAccess:
      overrides.refreshPassAccess
      || (fixtureId=>{
        calls.push(['pass-refresh',fixtureId]);
        return Promise.resolve();
      }),
    isAdmin:overrides.isAdmin || (()=>false),
    sendProductAction:
      overrides.sendProductAction
      || ((...args)=>calls.push(['product',...args])),
    sendOperationTiming:
      overrides.sendOperationTiming
      || ((...args)=>calls.push(['timing',...args])),
    sendActionError:
      overrides.sendActionError
      || ((...args)=>calls.push(['error',...args])),
    apiErrorCategory:
      overrides.apiErrorCategory
      || (()=>'error'),
    toast:
      overrides.toast
      || (message=>calls.push(['toast',message])),
    performanceNow:
      overrides.performanceNow
      || (()=>100),
  });

  return {
    controller,
    state,
    calls,
    setView:id=>{view=id;},
  };
}

test('analysis controller keeps analysis globally single-flight',async()=>{
  const state=baseState();
  state.analysisActionPending=true;
  let apiCalls=0;
  const {controller,calls}=makeController({
    state,
    api:async()=>{
      apiCalls+=1;
      return {};
    },
  });

  await controller.analyzeMatch(7,null);

  assert.equal(apiCalls,0);
  assert.ok(
    calls.some(
      row=>
        row[0]==='toast'
        && /уже выполняется/.test(row[1]),
    ),
  );
});

test('invalid fixture ids fail before navigation, busy UI or network work',async()=>{
  for (const fixtureId of [
    0,
    -1,
    1.5,
    Number.NaN,
    'bad',
    true,
    [7],
    {valueOf(){return 7;}},
  ]) {
    const state=baseState();
    let apiCalls=0;
    const {controller,calls}=makeController({
      state,
      view:'teamView',
      api:async()=>{
        apiCalls+=1;
        return {};
      },
    });

    await controller.analyzeMatch(fixtureId,null);

    assert.equal(apiCalls,0,String(fixtureId));
    assert.equal(state.analysisRequestSeq,0,String(fixtureId));
    assert.equal(state.analysisActionPending,false,String(fixtureId));
    assert.equal(state.analysisBackView,'matchesView',String(fixtureId));
    assert.equal(
      calls.some(row=>row[0]==='stop-live'),
      false,
      String(fixtureId),
    );
    assert.equal(
      calls.some(row=>row[0]==='busy'),
      false,
      String(fixtureId),
    );
    assert.equal(
      calls.some(row=>row[0]==='view'),
      false,
      String(fixtureId),
    );
  }
});

test('runtime control must be strict true and probe failures fail closed',async()=>{
  for (const runtimeAllows of [
    ()=>false,
    ()=>'true',
    ()=>{throw new Error('controls unavailable');},
  ]) {
    let apiCalls=0;
    const {controller,state}=makeController({
      runtimeAllows,
      api:async()=>{
        apiCalls+=1;
        return {};
      },
    });

    await controller.analyzeMatch(7,null);

    assert.equal(apiCalls,0);
    assert.equal(state.analysisActionPending,false);
    assert.equal(state.analysisRequestSeq,0);
  }
});

test('successful analysis validates identity and preserves access/telemetry lifecycle',async()=>{
  const state=baseState();
  const apiCalls=[];
  const {controller,calls}=makeController({
    state,
    api:async(url,options)=>{
      apiCalls.push([url,options]);
      if (url.startsWith('/api/entitlements?')) {
        return {entitlement:{source:'pass'}};
      }
      if (url==='/api/analyze') {
        return {
          match:{fixtureId:7},
          quota:{remaining:1},
          provider:{
            visibility:'admin',
            name:'fixture-source',
          },
        };
      }
      throw new Error('unexpected api '+url);
    },
    isAdmin:()=>true,
  });

  const button={textContent:'Разобрать'};
  await controller.analyzeMatch(
    7,
    button,
    {newsImpactAction:'RECHECK'},
  );
  await new Promise(resolve=>setImmediate(resolve));

  assert.equal(
    apiCalls.filter(
      ([url])=>url.startsWith('/api/entitlements?'),
    ).length,
    2,
  );
  const analyzeCall=apiCalls.find(
    ([url])=>url==='/api/analyze',
  );
  assert.ok(analyzeCall);
  const body=JSON.parse(analyzeCall[1].body);
  assert.equal(body.fixtureId,7);
  assert.equal(body.origin,'miniapp');
  assert.equal(body.newsImpactAction,'recheck');
  assert.equal(state.analysisActionPending,false);
  assert.equal(state.profile.quota.remaining,1);
  assert.equal(state.provider.name,'fixture-source');
  assert.equal(button.textContent,'Разобрать');
  assert.ok(calls.some(row=>row[0]==='render-analysis'));
  assert.ok(calls.some(row=>row[0]==='history'));
  assert.ok(
    calls.some(
      row=>row[0]==='product' && row[1]==='ai_start',
    ),
  );
  assert.ok(
    calls.some(
      row=>row[0]==='product' && row[1]==='ai_complete',
    ),
  );
  assert.ok(
    calls.some(
      row=>row[0]==='timing' && row[1]==='ai',
    ),
  );
  assert.ok(
    calls.some(
      row=>row[0]==='pass-refresh' && row[1]===7,
    ),
  );
});

test('mismatched analysis response identity is never rendered or stored',async()=>{
  const {controller,state,calls}=makeController({
    api:async url=>{
      if (url.startsWith('/api/entitlements?')) return null;
      if (url==='/api/analyze') {
        return {match:{fixtureId:999}};
      }
      return null;
    },
  });

  await controller.analyzeMatch(7,null);

  assert.equal(state.analysisActionPending,false);
  assert.equal(
    calls.some(row=>row[0]==='render-analysis'),
    false,
  );
  assert.equal(
    calls.some(row=>row[0]==='history'),
    false,
  );
  assert.ok(
    calls.some(
      row=>row[0]==='journey' && row[1]==='error',
    ),
  );
});

test('stale analysis success and failure cannot reclaim the current view',async()=>{
  for (const mode of ['resolve','reject']) {
    const pending=deferred();
    const state=baseState();
    const {controller,calls,setView}=makeController({
      state,
      api:async url=>{
        if (url.startsWith('/api/entitlements?')) {
          return {entitlement:{source:'free'}};
        }
        if (url==='/api/analyze') return pending.promise;
        throw new Error('unexpected api '+url);
      },
    });

    const task=controller.analyzeMatch(7,null);
    await new Promise(resolve=>setImmediate(resolve));
    state.analysisRequestSeq+=1;
    setView('matchesView');

    if (mode==='resolve') {
      pending.resolve({match:{fixtureId:7}});
    } else {
      pending.reject(new Error('stale failure'));
    }
    await task;

    assert.equal(state.analysisActionPending,false);
    assert.equal(
      calls.some(row=>row[0]==='render-analysis'),
      false,
    );
    assert.equal(
      calls.some(
        row=>
          row[0]==='journey'
          && row[1]==='error',
      ),
      false,
    );
    if (mode==='resolve') {
      assert.ok(calls.some(row=>row[0]==='history'));
    }
  }
});

test('callback failures cannot strand analysisActionPending',async()=>{
  const state=baseState();
  const {controller}=makeController({
    state,
    sendProductAction:()=>{
      throw new Error('telemetry failed');
    },
    syncAnalysisBusyUi:()=>{
      throw new Error('busy ui failed');
    },
    showView:()=>{
      throw new Error('navigation observer failed');
    },
    api:async url=>{
      if (url.startsWith('/api/entitlements?')) return null;
      if (url==='/api/analyze') {
        return {match:{fixtureId:7}};
      }
      return null;
    },
  });

  await assert.doesNotReject(
    ()=>controller.analyzeMatch(7,null),
  );
  assert.equal(state.analysisActionPending,false);
});

test('provider failure restores previous Match Center snapshot fail-soft',async()=>{
  const state=baseState();
  state.currentCenter={
    mode:'upcoming',
    match:{fixtureId:7},
  };
  const {controller,calls}=makeController({
    state,
    view:'analysisView',
    api:async url=>{
      if (url.startsWith('/api/entitlements?')) return null;
      if (url==='/api/analyze') {
        throw Object.assign(
          new Error('provider down'),
          {status:503},
        );
      }
      return null;
    },
    apiErrorCategory:()=>'provider',
  });

  await controller.analyzeMatch(7,null);

  assert.equal(state.currentCenter.match.fixtureId,7);
  assert.ok(calls.some(row=>row[0]==='render-center'));
  assert.ok(
    calls.some(row=>row[0]==='error' && row[1]==='ai'),
  );
});

test('quota exhaustion is distinct from warming and provider throttling',async()=>{
  const scenarios=[
    {
      error:Object.assign(new Error('quota'),{
        status:429,
        payload:{
          code:'ANALYSIS_QUOTA_EXHAUSTED',
          quota:{used:3,limit:3,left:0},
        },
      }),
      category:'quota',
      paywall:true,
    },
    {
      error:Object.assign(
        new Error('Матч уже рассчитывается.'),
        {
          status:429,
          payload:{
            code:'ANALYSIS_WARMING',
            retryAfter:5,
            quota:{used:1,limit:3,left:2},
          },
        },
      ),
      category:'rate_limit',
      paywall:false,
    },
    {
      error:Object.assign(
        new Error('provider limited'),
        {
          status:429,
          payload:{
            code:'FOOTBALL_RATE_LIMIT',
            retryAfter:12,
          },
        },
      ),
      category:'rate_limit',
      paywall:false,
    },
  ];

  for (const scenario of scenarios) {
    const {controller,calls}=makeController({
      api:async url=>{
        if (url.startsWith('/api/entitlements?')) return null;
        if (url==='/api/analyze') throw scenario.error;
        return null;
      },
      apiErrorCategory:()=>scenario.category,
    });

    await controller.analyzeMatch(15,null);

    assert.equal(
      calls.some(row=>row[0]==='show-paywall'),
      scenario.paywall,
    );
  }
});

test('app keeps only lazy analysis composition while controller owns lifecycle',()=>{
  const app=readRepoFile('public/app.js');
  const module=readRepoFile(
    'public/modules/analysis-controller.js',
  );

  assert.match(
    app,
    /import\('\.\/modules\/analysis-controller\.js'\)/,
  );
  assert.match(
    app,
    /async function ensureAnalysisController\(\)/,
  );
  assert.doesNotMatch(app,/await api\('\/api\/analyze'/);
  assert.doesNotMatch(
    app,
    /async function loadAnalysisAccessSnapshot\(/,
  );
  assert.match(
    module,
    /async function loadAnalysisAccessSnapshot\(/,
  );
  assert.match(module,/await api\('\/api\/analyze'/);
  assert.match(module,/const ownsAnalysisView=/);
  assert.match(module,/safeCall\(showPaywall,id\)/);
});
