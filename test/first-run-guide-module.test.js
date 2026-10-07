import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_RUN_GUIDE_KEY } from '../public/modules/app-runtime.js';
import { createFirstRunGuideController } from '../public/modules/first-run-guide.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const moduleSource=readFileSync(
  new URL('../public/modules/first-run-guide.js',import.meta.url),
  'utf8',
);
const publicHtml=readFileSync(
  new URL('../public/index.html',import.meta.url),
  'utf8',
);

function inputElement() {
  return {
    value:'seed',
    focusCalls:[],
    scrollCalls:[],
    focus(options) {
      this.focusCalls.push(options);
    },
    scrollIntoView(options) {
      this.scrollCalls.push(options);
    },
  };
}

function harness(overrides={}) {
  const stored=new Map();
  const guide={hidden:true};
  const matchSearch=inputElement();
  const globalSearchInput=inputElement();
  const elements=new Map([
    ['firstRunGuide',guide],
    ['matchSearch',matchSearch],
    ['globalSearchInput',globalSearchInput],
  ]);
  const calls={
    telemetry:[],
    renderGlobalSearch:0,
    showView:[],
    timeouts:[],
  };
  const windowObject={
    location:{search:''},
    setTimeout(fn,delay) {
      calls.timeouts.push(delay);
      fn();
      return 1;
    },
    ...overrides.window,
  };
  const state={
    globalSearch:{query:'seed'},
    ...overrides.state,
  };
  const storage={
    getItem:key=>stored.get(key) ?? null,
    setItem:(key,value)=>{stored.set(key,value);},
    ...overrides.storage,
  };
  const controller=createFirstRunGuideController({
    window:windowObject,
    tg:overrides.tg ?? {initDataUnsafe:{}},
    state,
    storage,
    elementById:id=>elements.get(id) || null,
    sendProductAction:(...args)=>{calls.telemetry.push(args);},
    renderGlobalSearch:()=>{calls.renderGlobalSearch+=1;},
    showView:(...args)=>{calls.showView.push(args);},
    ...overrides.deps,
  });
  return {
    controller,
    state,
    storage,
    stored,
    guide,
    matchSearch,
    globalSearchInput,
    windowObject,
    calls,
    elements,
  };
}

test('first-run guide behavior lives behind a dedicated controller',()=>{
  assert.match(
    app,
    /createFirstRunGuideController/,
  );
  assert.doesNotMatch(app,/function hasDirectLaunchIntent/);
  assert.doesNotMatch(app,/function renderFirstRunGuide/);
  assert.doesNotMatch(app,/function dismissFirstRunGuide/);
  assert.doesNotMatch(moduleSource,/\/api\//);

  for (const id of [
    'firstRunGuide',
    'firstRunGuideSearch',
    'firstRunGuideFavorite',
    'firstRunGuideDismiss',
  ]) {
    assert.match(publicHtml,new RegExp(`id="${id}"`));
  }
});

test('controller validates all structural dependencies',()=>{
  const base={
    window:{location:{search:''},setTimeout:()=>1},
    tg:{initDataUnsafe:{}},
    state:{globalSearch:{query:''}},
    storage:{getItem:()=>null,setItem:()=>{}},
    elementById:()=>null,
    sendProductAction:()=>{},
    renderGlobalSearch:()=>{},
    showView:()=>{},
  };

  assert.equal(
    Object.isFrozen(createFirstRunGuideController(base)),
    true,
  );

  for (const key of [
    'window',
    'state',
    'storage',
    'elementById',
    'sendProductAction',
    'renderGlobalSearch',
    'showView',
  ]) {
    assert.throws(
      ()=>createFirstRunGuideController({...base,[key]:null}),
      /First Run Guide requires/,
      key,
    );
  }

  assert.throws(
    ()=>createFirstRunGuideController({
      ...base,
      storage:{getItem:()=>null},
    }),
    /First Run Guide requires/,
  );
});

test('guide is shown only when it is neither dismissed nor opened with direct intent',()=>{
  const h=harness();
  assert.equal(h.controller.renderFirstRunGuide(),true);
  assert.equal(h.guide.hidden,false);

  h.stored.set(FIRST_RUN_GUIDE_KEY,'1');
  assert.equal(h.controller.renderFirstRunGuide(),false);
  assert.equal(h.guide.hidden,true);

  h.stored.delete(FIRST_RUN_GUIDE_KEY);
  for (const search of [
    '?view=search',
    '?view=history',
    '?q=Barcelona',
    '?fixtureId=123&action=analysis',
    '?fixtureId=123&action=center',
  ]) {
    h.windowObject.location.search=search;
    assert.equal(h.controller.hasDirectLaunchIntent(),true,search);
    assert.equal(h.controller.renderFirstRunGuide(),false,search);
  }
});

test('direct intent rejects ambiguous fixture ids and malformed Telegram start params',()=>{
  const h=harness();
  for (const search of [
    '?fixtureId=1e3&action=analysis',
    '?fixtureId=-1&action=center',
    '?fixtureId=1.5&action=analysis',
    '?fixtureId=true&action=analysis',
    '?fixtureId=123&action=other',
  ]) {
    h.windowObject.location.search=search;
    assert.equal(h.controller.hasDirectLaunchIntent(),false,search);
  }

  const stringStart=harness({
    tg:{initDataUnsafe:{start_param:'match_123'}},
  });
  assert.equal(stringStart.controller.hasDirectLaunchIntent(),true);

  const nonStringStart=harness({
    tg:{initDataUnsafe:{start_param:true}},
  });
  assert.equal(nonStringStart.controller.hasDirectLaunchIntent(),false);

  const hostileInit={};
  Object.defineProperty(hostileInit,'start_param',{
    get(){throw new Error('hostile start param');},
  });
  const hostile=harness({tg:{initDataUnsafe:hostileInit}});
  assert.doesNotThrow(()=>hostile.controller.hasDirectLaunchIntent());
  assert.equal(hostile.controller.hasDirectLaunchIntent(),false);
});

test('storage failures do not trap or redisplay the guide during the same action',()=>{
  const h=harness({
    storage:{
      getItem:()=>{throw new Error('storage read denied');},
      setItem:()=>{throw new Error('storage write denied');},
    },
  });

  assert.equal(h.controller.renderFirstRunGuide(),true);
  assert.equal(h.guide.hidden,false);
  assert.doesNotThrow(()=>h.controller.dismissFirstRunGuide());
  assert.equal(h.guide.hidden,true);
});

test('search action dismisses the guide and telemetry failure cannot block focus',()=>{
  const h=harness({
    deps:{
      sendProductAction:()=>{throw new Error('telemetry unavailable');},
    },
  });

  assert.doesNotThrow(()=>h.controller.startFirstRunSearch());
  assert.equal(h.guide.hidden,true);
  assert.equal(h.stored.get(FIRST_RUN_GUIDE_KEY),'1');
  assert.deepEqual(h.matchSearch.focusCalls,[{preventScroll:true}]);
  assert.deepEqual(h.matchSearch.scrollCalls,[{
    behavior:'smooth',
    block:'center',
  }]);
});

test('favorite action clears search, renders, navigates and focuses independently of telemetry',()=>{
  const h=harness({
    deps:{
      sendProductAction:()=>{throw new Error('telemetry unavailable');},
    },
  });

  assert.doesNotThrow(()=>h.controller.startFirstRunFavorite());
  assert.equal(h.guide.hidden,true);
  assert.equal(h.state.globalSearch.query,'');
  assert.equal(h.globalSearchInput.value,'');
  assert.equal(h.calls.renderGlobalSearch,1);
  assert.deepEqual(h.calls.showView,[['searchView']]);
  assert.deepEqual(h.calls.timeouts,[80]);
  assert.deepEqual(
    h.globalSearchInput.focusCalls,
    [{preventScroll:true}],
  );
});

test('favorite action survives malformed local UI state and missing timer support',()=>{
  const state={};
  Object.defineProperty(state,'globalSearch',{
    get(){throw new Error('hostile state getter');},
  });
  const input=inputElement();
  Object.defineProperty(input,'value',{
    configurable:true,
    get(){return 'seed';},
    set(){throw new Error('readonly input');},
  });

  const calls={render:0,show:0};
  const controller=createFirstRunGuideController({
    window:{location:{search:''}},
    tg:{initDataUnsafe:{}},
    state,
    storage:{getItem:()=>null,setItem:()=>{}},
    elementById:id=>
      id==='globalSearchInput'
        ? input
        : id==='firstRunGuide'
          ? {hidden:false}
          : null,
    sendProductAction:()=>{},
    renderGlobalSearch:()=>{calls.render+=1;},
    showView:()=>{calls.show+=1;},
  });

  assert.doesNotThrow(()=>controller.startFirstRunFavorite());
  assert.equal(calls.render,1);
  assert.equal(calls.show,1);
  assert.deepEqual(input.focusCalls,[{preventScroll:true}]);
});

test('element lookup and DOM method failures stay inside the onboarding boundary',()=>{
  const h=harness({
    deps:{
      elementById:()=>{throw new Error('DOM unavailable');},
    },
  });

  assert.doesNotThrow(()=>h.controller.renderFirstRunGuide());
  assert.doesNotThrow(()=>h.controller.dismissFirstRunGuide());
  assert.doesNotThrow(()=>h.controller.startFirstRunSearch());
  assert.doesNotThrow(()=>h.controller.startFirstRunFavorite());
});
