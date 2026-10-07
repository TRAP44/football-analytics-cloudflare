import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMatchCenterController } from '../public/modules/match-center-controller.js';

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
    currentCenter:null,
    currentCenterTab:'summary',
    analysisBackView:'matchesView',
    analysisActionPending:false,
    analysisRequestSeq:0,
    clientPerf:{deduped:0},
  };
}

function makeController(overrides={}) {
  const state=overrides.state || baseState();
  const documentRef=overrides.documentRef || {hidden:false};
  const elements=new Map([
    ['liveRefreshText',{textContent:''}],
  ]);
  const calls=[];
  const timers=[];
  const cleared=[];
  let view=overrides.view || 'matchesView';

  const controller=createMatchCenterController({
    state,
    documentRef,
    elementById:
      overrides.elementById
      || (id=>elements.get(id) || null),
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
      || (async()=>({
        mode:'upcoming',
        match:{fixtureId:7},
      })),
    runtimeAllows:
      overrides.runtimeAllows
      || (()=>true),
    ensureMatchCenterExtras:
      overrides.ensureMatchCenterExtras
      || (async()=>{calls.push(['extras']);}),
    renderMatchCenter:
      overrides.renderMatchCenter
      || (data=>{
        state.currentCenter=data;
        calls.push(['render',data]);
      }),
    renderJourneyState:
      overrides.renderJourneyState
      || ((...args)=>calls.push(['journey',...args])),
    sendProductAction:
      overrides.sendProductAction
      || ((...args)=>calls.push(['product',...args])),
    sendMatchDataCoverage:
      overrides.sendMatchDataCoverage
      || ((...args)=>calls.push(['coverage',...args])),
    sendOperationTiming:
      overrides.sendOperationTiming
      || ((...args)=>calls.push(['timing',...args])),
    sendActionError:
      overrides.sendActionError
      || ((...args)=>calls.push(['error',...args])),
    apiErrorCategory:
      overrides.apiErrorCategory
      || (()=>'error'),
    friendlyErrorMessage:
      overrides.friendlyErrorMessage
      || (()=>'friendly'),
    toast:
      overrides.toast
      || (message=>calls.push(['toast',message])),
    performanceNow:
      overrides.performanceNow
      || (()=>123),
    setTimer:
      overrides.setTimer
      || ((fn,ms)=>{
        const handle=timers.length+1;
        timers.push({handle,fn,ms});
        return handle;
      }),
    clearTimer:
      overrides.clearTimer
      || (handle=>cleared.push(handle)),
  });

  return {
    controller,
    state,
    documentRef,
    elements,
    calls,
    timers,
    cleared,
    setView:value=>{view=value;},
  };
}

test('Match Center deduplicates concurrent requests for the same fixture',async()=>{
  const pending=deferred();
  let apiCalls=0;
  const {controller,state}=makeController({
    api:async url=>{
      apiCalls+=1;
      assert.equal(
        url,
        '/api/match-center?fixtureId=7',
      );
      return pending.promise;
    },
  });

  const first=controller.requestMatchCenter(7);
  const second=controller.requestMatchCenter('7');
  pending.resolve({
    mode:'upcoming',
    match:{fixtureId:7},
  });

  const [a,b]=await Promise.all([first,second]);
  assert.equal(apiCalls,1);
  assert.equal(state.clientPerf.deduped,1);
  assert.equal(a.match.fixtureId,7);
  assert.equal(b.match.fixtureId,7);
});

test('invalid Match Center fixture ids fail before network and navigation side effects',async()=>{
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
    let apiCalls=0;
    const {controller,calls}=makeController({
      api:async()=>{
        apiCalls+=1;
        return {};
      },
    });

    assert.equal(
      await controller.requestMatchCenter(fixtureId),
      null,
    );
    await controller.openMatchCenter(fixtureId,null);

    assert.equal(apiCalls,0,String(fixtureId));
    assert.equal(
      calls.some(row=>row[0]==='view'),
      false,
      String(fixtureId),
    );
  }
});

test('newer request suppresses both stale response and stale error',async()=>{
  for (const oldOutcome of ['resolve','reject']) {
    const first=deferred();
    const second=deferred();
    const {controller}=makeController({
      api:async url=>
        url.includes('fixtureId=1')
          ? first.promise
          : second.promise,
    });

    const oldRequest=controller.requestMatchCenter(1);
    const newRequest=controller.requestMatchCenter(2);

    if (oldOutcome==='resolve') {
      first.resolve({
        mode:'upcoming',
        match:{fixtureId:1},
      });
    } else {
      first.reject(new Error('stale provider failure'));
    }
    second.resolve({
      mode:'live',
      match:{fixtureId:2},
    });

    assert.equal(await oldRequest,null);
    assert.equal((await newRequest).match.fixtureId,2);
  }
});

test('response identity mismatch is rejected before Match Center rendering',async()=>{
  const {controller,state,calls}=makeController({
    api:async()=>({
      mode:'upcoming',
      match:{fixtureId:999},
    }),
  });

  await controller.openMatchCenter(7,null);

  assert.equal(state.currentCenter,null);
  assert.equal(
    calls.some(row=>row[0]==='render'),
    false,
  );
  assert.ok(
    calls.some(
      row=>row[0]==='journey' && row[1]==='error',
    ),
  );
});

test('malformed Match Center mode is rejected instead of being rendered as an upcoming match',async()=>{
  for (const mode of [
    undefined,
    'LIVE',
    'unknown',
    true,
    {toString(){return 'live';}},
  ]) {
    const {controller,state,calls}=makeController({
      api:async()=>({
        mode,
        match:{fixtureId:7},
      }),
    });

    await assert.rejects(
      ()=>controller.requestMatchCenter(7),
      error=>error?.code==='MATCH_CENTER_RESPONSE_MODE_INVALID',
    );

    await controller.openMatchCenter(7,null);

    assert.equal(state.currentCenter,null,String(mode));
    assert.equal(
      calls.some(row=>row[0]==='render'),
      false,
      String(mode),
    );
  }
});

test('extra request params are bounded scalars and cannot replace fixture identity',async()=>{
  let seenUrl='';
  const {controller}=makeController({
    api:async url=>{
      seenUrl=url;
      return {
        mode:'upcoming',
        match:{fixtureId:7},
      };
    },
  });

  await controller.requestMatchCenter(7,{
    fixtureId:999,
    t:123,
    source:' live ',
    flag:true,
    bad:{toString(){throw new Error('must not stringify');}},
  });

  const parsed=new URL(
    seenUrl,
    'https://example.test',
  );
  assert.equal(parsed.searchParams.get('fixtureId'),'7');
  assert.equal(parsed.searchParams.get('t'),'123');
  assert.equal(parsed.searchParams.get('source'),'live');
  assert.equal(parsed.searchParams.get('flag'),'true');
  assert.equal(parsed.searchParams.has('bad'),false);
});

test('LIVE runtime control is strict and refresh interval is bounded',()=>{
  for (const runtimeAllows of [
    ()=>false,
    ()=>'true',
    ()=>{throw new Error('controls unavailable');},
  ]) {
    const state=baseState();
    state.currentCenter={
      mode:'live',
      refreshSeconds:20,
      match:{fixtureId:9},
    };
    const {controller,timers}=makeController({
      state,
      view:'analysisView',
      runtimeAllows,
    });

    controller.startLiveRefresh(9);
    assert.equal(controller.isLiveRefreshActive(),false);
    assert.equal(timers.length,0);
  }

  const state=baseState();
  state.currentCenter={
    mode:'live',
    refreshSeconds:'1',
    match:{fixtureId:12},
  };
  const {controller,timers}=makeController({
    state,
    view:'analysisView',
  });

  controller.startLiveRefresh(12);
  assert.equal(controller.isLiveRefreshActive(),true);
  assert.equal(timers[0].ms,60000);
});

test('opening a different fixture deactivates the previous LIVE refresh before foreground loading',async()=>{
  const state=baseState();
  state.currentCenter={
    mode:'live',
    refreshSeconds:30,
    match:{fixtureId:1},
  };
  const pending=deferred();
  const {controller,timers,cleared}=makeController({
    state,
    view:'analysisView',
    api:async url=>{
      assert.match(url,/fixtureId=2/);
      return pending.promise;
    },
  });

  controller.startLiveRefresh(1);
  assert.equal(controller.isLiveRefreshActive(),true);
  assert.equal(timers.length,1);

  const opening=controller.openMatchCenter(2,null);
  assert.deepEqual(cleared,[1]);
  assert.equal(controller.isLiveRefreshActive(),false);

  pending.resolve({
    mode:'upcoming',
    match:{fixtureId:2},
  });
  await opening;

  assert.equal(state.currentCenter.match.fixtureId,2);
  assert.equal(controller.isLiveRefreshActive(),false);
});

test('visibility lifecycle suspends and resumes active live refresh',()=>{
  const state=baseState();
  state.currentCenter={
    mode:'live',
    refreshSeconds:30,
    match:{fixtureId:12},
  };
  const {controller,timers,cleared}=makeController({
    state,
    view:'analysisView',
  });

  controller.startLiveRefresh(12);
  assert.equal(timers.length,1);
  assert.equal(timers[0].ms,30000);
  assert.equal(controller.isLiveRefreshActive(),true);

  assert.equal(controller.suspendLiveRefresh(),true);
  assert.deepEqual(cleared,[1]);
  assert.equal(controller.isLiveRefreshActive(),true);

  assert.equal(controller.resumeLiveRefresh(),true);
  assert.equal(timers.length,2);

  controller.deactivateLiveRefresh();
  assert.equal(controller.isLiveRefreshActive(),false);
});

test('openMatchCenter owns loading, rendering and telemetry lifecycle',async()=>{
  const button={
    disabled:false,
    textContent:'Открыть',
  };
  const {controller,state,calls}=makeController({
    api:async()=>({
      mode:'live',
      refreshSeconds:60,
      match:{fixtureId:7},
    }),
  });

  await controller.openMatchCenter(7,button);

  assert.equal(state.analysisBackView,'matchesView');
  assert.equal(state.currentCenter.match.fixtureId,7);
  assert.equal(button.disabled,false);
  assert.equal(button.textContent,'Открыть');
  assert.ok(
    calls.some(
      row=>row[0]==='journey' && row[1]==='loading',
    ),
  );
  assert.ok(
    calls.some(
      row=>row[0]==='product' && row[1]==='match_open',
    ),
  );
  assert.ok(calls.some(row=>row[0]==='coverage'));
  assert.ok(
    calls.some(
      row=>row[0]==='timing' && row[1]==='match',
    ),
  );
});

test('presentation and telemetry callback failures do not break Match Center lifecycle',async()=>{
  const state=baseState();
  const {controller}=makeController({
    state,
    showView:()=>{throw new Error('navigation observer');},
    renderJourneyState:()=>{throw new Error('journey renderer');},
    sendProductAction:()=>{throw new Error('telemetry');},
    sendMatchDataCoverage:()=>{throw new Error('coverage');},
    sendOperationTiming:()=>{throw new Error('timing');},
    api:async()=>({
      mode:'upcoming',
      match:{fixtureId:7},
    }),
  });

  await assert.doesNotReject(
    ()=>controller.openMatchCenter(7,null),
  );
  assert.equal(state.currentCenter.match.fixtureId,7);
});

test('provider failure keeps reusable snapshot fail-soft',async()=>{
  const state=baseState();
  state.currentCenter={
    mode:'upcoming',
    match:{fixtureId:15},
  };
  const {controller,calls}=makeController({
    state,
    view:'analysisView',
    api:async()=>{
      throw Object.assign(
        new Error('provider down'),
        {status:503},
      );
    },
    apiErrorCategory:()=>'provider',
    friendlyErrorMessage:()=>
      'Источник временно недоступен',
  });

  await controller.openMatchCenter(15,null);

  assert.ok(
    calls.filter(row=>row[0]==='render').length>=1,
  );
  assert.ok(
    calls.some(
      row=>
        row[0]==='toast'
        && /Источник/.test(row[1]),
    ),
  );
});

test('app composition root delegates mutable Match Center coordination',()=>{
  const app=fs.readFileSync(
    new URL('../public/app.js',import.meta.url),
    'utf8',
  );
  const module=fs.readFileSync(
    new URL(
      '../public/modules/match-center-controller.js',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(
    app,
    /import\('\.\/modules\/match-center-controller\.js'\)/,
  );
  assert.match(
    app,
    /async function ensureMatchCenterController\(\)/,
  );
  assert.doesNotMatch(app,/matchCenterInFlight:/);
  assert.doesNotMatch(app,/matchCenterRequestSeq:/);
  assert.doesNotMatch(app,/liveRefreshTimer:/);
  assert.doesNotMatch(app,/liveRefreshWasActive:/);
  assert.match(module,/\/api\/match-center\?/);
  assert.match(module,/function scheduleLiveRefresh\(/);
  assert.match(module,/async function openMatchCenter\(/);
});
