import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHistoryRenderer } from '../public/modules/history-renderer.js';

const app=readFileSync(
  new URL('../public/app.js',import.meta.url),
  'utf8',
);
const rendererSource=readFileSync(
  new URL('../public/modules/history-renderer.js',import.meta.url),
  'utf8',
);

function makeButton(dataset={}) {
  return {
    dataset,
    disabled:false,
    textContent:'',
    innerHTML:'',
    hidden:false,
    listeners:{},
    addEventListener(type,fn){this.listeners[type]=fn;},
    click(){this.listeners.click?.();},
  };
}

function makeRoot() {
  return {
    innerHTML:'',
    buttons:[],
    querySelectorAll(selector) {
      return selector==='.history-open' ? this.buttons : [];
    },
  };
}

function createElements(root=makeRoot()) {
  const map=new Map([['history',root]]);
  return {
    map,
    elementById(id) {
      if (!map.has(id)) map.set(id,makeButton());
      return map.get(id);
    },
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}

function createRenderer({
  state,
  elements=createElements(),
  callbacks={},
  deps={},
}={}) {
  const renderer=createHistoryRenderer({
    state,
    elementById:elements.elementById,
    recoveryCardHtml:
      deps.recoveryCardHtml
      || (({title,message,retryId})=>
        `<div id="${retryId}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`),
    escapeHtml:deps.escapeHtml || escapeHtml,
    safeUrl:deps.safeUrl || (value=>typeof value==='string' ? value : ''),
    dateTime:deps.dateTime || (value=>`date:${value}`),
    relativeAge:deps.relativeAge || (value=>`age:${value}`),
    onReloadHistory:callbacks.onReloadHistory,
    onOpenSearch:callbacks.onOpenSearch,
    onOpenHistoryAnalysis:callbacks.onOpenHistoryAnalysis,
  });
  return {renderer,elements};
}

test('history renderer owns presentation while lifecycle remains in app root',()=>{
  assert.match(rendererSource,/export function createHistoryRenderer/);
  assert.match(rendererSource,/function renderHistory\(\)/);
  assert.doesNotMatch(
    rendererSource,
    /\/api\/history|\/api\/history-analysis|requestMatchCenter|showView\(/,
  );
  assert.match(app,/async function loadHistory\(showLoader = true\)/);
  assert.match(app,/async function openHistoryAnalysis\(fixtureId, btn\)/);
  assert.doesNotMatch(app,/class="history-item"/);
});

test('app lazy-loads renderer and keeps response normalization in lifecycle boundary',()=>{
  const start=app.indexOf('async function ensureHistoryRenderer()');
  const end=app.indexOf('\nfunction pct(v)',start);
  assert.ok(start>=0 && end>start);
  const boundary=app.slice(start,end);

  assert.match(boundary,/import\('\.\/modules\/history-renderer\.js'\)/);
  assert.match(
    boundary,
    /onReloadHistory: force => loadHistory\(force\)/,
  );
  assert.match(
    boundary,
    /onOpenHistoryAnalysis: \(fixtureId, button\) => openHistoryAnalysis\(fixtureId, button\)/,
  );

  const loadStart=app.indexOf('async function loadHistory');
  const openStart=app.indexOf(
    'async function openHistoryAnalysis',
    loadStart,
  );
  const loadBlock=app.slice(loadStart,openStart);
  assert.match(loadBlock,/state\.history = collectionItems\(data\)/);
  assert.match(loadBlock,/uiErrorMessage\(/);

  const openEnd=app.indexOf(
    '\nlet historyRenderer',
    openStart,
  );
  const openBlock=app.slice(openStart,openEnd);
  assert.match(
    openBlock,
    /const id = positiveEntityId\(fixtureId\)/,
  );
});

test('history renderer validates presentation dependencies and freezes API',()=>{
  const state={
    historyLoading:false,
    historyLoaded:true,
    historyLoadError:'',
    history:[],
  };
  const elements=createElements();
  const base={
    state,
    elementById:elements.elementById,
    recoveryCardHtml:()=> '',
    escapeHtml,
    safeUrl:value=>value,
    dateTime:value=>String(value),
    relativeAge:value=>String(value),
  };

  assert.equal(
    Object.isFrozen(createHistoryRenderer(base)),
    true,
  );

  for (const key of [
    'elementById',
    'recoveryCardHtml',
    'escapeHtml',
    'safeUrl',
    'dateTime',
    'relativeAge',
  ]) {
    assert.throws(
      ()=>createHistoryRenderer({...base,[key]:null}),
      /History renderer requires/,
      key,
    );
  }

  assert.throws(
    ()=>createHistoryRenderer({...base,state:null}),
    /History renderer requires state/,
  );
});

test('initial loading state renders without invoking optional callbacks',()=>{
  const root=makeRoot();
  const elements=createElements(root);
  const {renderer}=createRenderer({
    state:{
      historyLoading:true,
      historyLoaded:false,
      historyLoadError:'',
      history:[],
    },
    elements,
  });

  assert.doesNotThrow(()=>renderer.renderHistory());
  assert.match(root.innerHTML,/Загружаю историю/);
});

test('first-load failure escapes server error and wires retry fail-soft',()=>{
  const root=makeRoot();
  const elements=createElements(root);
  const calls=[];
  const {renderer}=createRenderer({
    state:{
      historyLoading:false,
      historyLoaded:false,
      historyLoadError:'<img src=x onerror=alert(1)>',
      history:[],
    },
    elements,
    callbacks:{
      onReloadHistory:force=>calls.push(force),
    },
  });

  renderer.renderHistory();
  elements.map.get('historyRecoveryRetry').click();

  assert.doesNotMatch(root.innerHTML,/<img/);
  assert.match(root.innerHTML,/&lt;img/);
  assert.deepEqual(calls,[true]);

  const throwing=createRenderer({
    state:{
      historyLoading:false,
      historyLoaded:false,
      historyLoadError:'offline',
      history:[],
    },
    elements:createElements(),
    deps:{
      recoveryCardHtml:()=>{
        throw new Error('recovery renderer failed');
      },
    },
  });
  assert.doesNotThrow(()=>throwing.renderer.renderHistory());
});

test('empty and stale-empty history preserve refresh and search actions',()=>{
  const root=makeRoot();
  const elements=createElements(root);
  const calls=[];
  const {renderer}=createRenderer({
    state:{
      historyLoading:false,
      historyLoaded:true,
      historyLoadError:'stale',
      history:[],
    },
    elements,
    callbacks:{
      onReloadHistory:force=>calls.push(['reload',force]),
      onOpenSearch:()=>calls.push(['search']),
    },
  });

  renderer.renderHistory();
  elements.map.get('historyEmptyRetry').click();
  elements.map.get('historyEmptyMatches').click();

  assert.match(root.innerHTML,/История пока пуста/);
  assert.match(root.innerHTML,/Последняя загруженная история была пустой/);
  assert.deepEqual(
    calls,
    [['reload',true],['search']],
  );
});

test('history rows are normalized, deduplicated and invalid fixture identities are dropped',()=>{
  const root=makeRoot();
  const firstButton=makeButton({fixture:'77'});
  root.buttons=[firstButton];
  const elements=createElements(root);
  const calls=[];
  const {renderer}=createRenderer({
    state:{
      historyLoading:false,
      historyLoaded:true,
      historyLoadError:'',
      history:[
        {
          fixtureId:'77',
          homeName:'<Home>',
          awayName:'Away',
          leagueName:'League',
          fixtureDate:'2026-09-30T10:00:00Z',
          viewedAt:'2026-09-30T11:00:00Z',
          aiSignalLabel:'Сигнал',
          aiSignalCode:'skip',
          aiConfidence:81.6,
        },
        {
          fixtureId:77,
          homeName:'Duplicate',
          awayName:'Ignored',
        },
        {
          fixtureId:true,
          homeName:'Boolean fixture',
          awayName:'Invalid',
        },
        {
          fixtureId:[88],
          homeName:'Array fixture',
          awayName:'Invalid',
        },
      ],
    },
    elements,
    callbacks:{
      onOpenHistoryAnalysis:(fixtureId,btn)=>
        calls.push([fixtureId,btn]),
    },
  });

  renderer.renderHistory();
  firstButton.click();

  assert.match(root.innerHTML,/&lt;Home&gt; — Away/);
  assert.equal(
    (root.innerHTML.match(/class="history-item"/g) || []).length,
    1,
  );
  // Метки сигнала бывают ставочными — в списке только нейтральный итог.
  assert.match(root.innerHTML,/AI · без уверенного вывода · 82\/100/);
  assert.doesNotMatch(root.innerHTML,/Сигнал/);
  assert.deepEqual(calls,[[77,firstButton]]);
});

test('confidence and timestamp evidence are strict and non-coercive',()=>{
  const root=makeRoot();
  root.buttons=[
    makeButton({fixture:'1'}),
    makeButton({fixture:'2'}),
  ];
  const {renderer}=createRenderer({
    state:{
      historyLoading:false,
      historyLoaded:true,
      historyLoadError:'',
      history:[
        {
          fixtureId:1,
          homeName:'A',
          awayName:'B',
          fixtureDate:'2026-09-30T10:00:00',
          viewedAt:'2026-09-30T11:00:00',
          aiSignalLabel:'Signal',
          aiConfidence:'99',
        },
        {
          fixtureId:2,
          homeName:'C',
          awayName:'D',
          fixtureDate:'2026-09-30T10:00:00+03:00',
          viewedAt:'2026-09-30T11:00:00Z',
          aiSignalLabel:'Signal',
          aiConfidence:true,
        },
      ],
    },
    elements:createElements(root),
  });

  renderer.renderHistory();

  assert.doesNotMatch(root.innerHTML,/99\/100|1\/100/);
  assert.doesNotMatch(
    root.innerHTML,
    /date:2026-09-30T10:00:00(?!\+)/,
  );
  assert.match(
    root.innerHTML,
    /date:2026-09-30T10:00:00\+03:00/,
  );
});

test('history image URLs are protocol and credential guarded before HTML insertion',()=>{
  const root=makeRoot();
  root.buttons=[makeButton({fixture:'9'})];
  const {renderer}=createRenderer({
    state:{
      historyLoading:false,
      historyLoaded:true,
      historyLoadError:'',
      history:[{
        fixtureId:9,
        homeName:'A',
        awayName:'B',
        homeLogo:'javascript:alert(1)',
        awayLogo:'https://user:secret@example.com/logo.png',
      }],
    },
    elements:createElements(root),
    deps:{
      safeUrl:value=>value,
    },
  });

  renderer.renderHistory();

  assert.doesNotMatch(root.innerHTML,/javascript:|user:secret@/);
  assert.equal(
    (root.innerHTML.match(/<img /g) || []).length,
    0,
  );
});

test('malformed history state and hostile row getters fail soft',()=>{
  const hostile={};
  Object.defineProperty(hostile,'fixtureId',{
    enumerable:true,
    get(){throw new Error('hostile fixture getter');},
  });
  const root=makeRoot();
  const elements=createElements(root);
  const {renderer}=createRenderer({
    state:{
      historyLoading:false,
      historyLoaded:true,
      historyLoadError:'',
      history:[hostile,null,1,'row',[]],
    },
    elements,
  });

  assert.doesNotThrow(()=>renderer.renderHistory());
  assert.match(root.innerHTML,/История пока пуста/);

  const nonArray=createRenderer({
    state:{
      historyLoading:false,
      historyLoaded:true,
      historyLoadError:'',
      history:{0:{fixtureId:1},length:1},
    },
    elements:createElements(),
  });
  assert.doesNotThrow(()=>nonArray.renderer.renderHistory());
});

test('helper, DOM and callback failures remain inside renderer boundary',()=>{
  const root=makeRoot();
  root.buttons=[makeButton({fixture:'7'})];
  const calls=[];
  const {renderer}=createRenderer({
    state:{
      historyLoading:false,
      historyLoaded:true,
      historyLoadError:'',
      history:[{
        fixtureId:7,
        homeName:'Home',
        awayName:'Away',
        homeLogo:'https://img.example/home.png',
        fixtureDate:'2026-09-30T10:00:00Z',
        viewedAt:'2026-09-30T11:00:00Z',
      }],
    },
    elements:createElements(root),
    callbacks:{
      onOpenHistoryAnalysis:()=>{
        calls.push('open');
        throw new Error('navigation failed');
      },
    },
    deps:{
      safeUrl:()=>{
        throw new Error('URL formatter failed');
      },
      dateTime:()=>{
        throw new Error('date formatter failed');
      },
      relativeAge:()=>{
        throw new Error('age formatter failed');
      },
    },
  });

  assert.doesNotThrow(()=>renderer.renderHistory());
  assert.doesNotThrow(()=>root.buttons[0].click());
  assert.deepEqual(calls,['open']);

  const hostile=createHistoryRenderer({
    state:{
      historyLoading:false,
      historyLoaded:true,
      historyLoadError:'',
      history:[],
    },
    elementById:()=>{
      throw new Error('DOM lookup unavailable');
    },
    recoveryCardHtml:()=> '',
    escapeHtml,
    safeUrl:value=>value,
    dateTime:value=>String(value),
    relativeAge:value=>String(value),
  });
  assert.doesNotThrow(()=>hostile.renderHistory());
});
