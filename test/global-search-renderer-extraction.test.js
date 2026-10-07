import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGlobalSearchRenderer } from '../public/modules/global-search-renderer.js';
import { mergeById } from '../public/modules/global-search-controller.js';

const app=readFileSync(
  new URL('../public/app.js',import.meta.url),
  'utf8',
);
const rendererSource=readFileSync(
  new URL('../public/modules/global-search-renderer.js',import.meta.url),
  'utf8',
);
const controllerSource=readFileSync(
  new URL('../public/modules/global-search-controller.js',import.meta.url),
  'utf8',
);

function button(dataset={}) {
  return {
    dataset,
    disabled:false,
    textContent:'',
    innerHTML:'',
    hidden:false,
    attrs:{},
    listeners:{},
    classList:{
      calls:[],
      toggle(...args){this.calls.push(args);},
    },
    setAttribute(name,value){this.attrs[name]=value;},
    addEventListener(type,fn){this.listeners[type]=fn;},
    click(){this.listeners.click?.();},
  };
}

function elements() {
  const map=new Map([
    ['searchResultsWrap',button()],
    ['searchResults',button()],
    ['searchResultsMeta',button()],
    ['searchStatus',button()],
    ['globalSearchBtn',button()],
  ]);
  return {
    map,
    elementById(id) {
      if (!map.has(id)) map.set(id,button());
      return map.get(id);
    },
  };
}

function countLabel(value,one,few,many) {
  const n=Number.isSafeInteger(value) && value>=0 ? value : 0;
  const word=n===1 ? one : n>=2 && n<=4 ? few : many;
  return `${n} ${word}`;
}

function baseState(overrides={}) {
  return {
    globalSearch:{
      query:'',
      mode:'all',
      loading:false,
      status:'idle',
      warning:'',
      resolvedQuery:'',
      remoteTeams:[],
      knownTeams:[],
      remoteCompetitions:[],
      remoteMatches:[],
      ...overrides,
    },
  };
}

function makeRenderer({
  state=baseState(),
  els=elements(),
  local={},
  callbacks={},
  filters=[],
  deps={},
}={}) {
  const calls=[];
  const renderer=createGlobalSearchRenderer({
    state,
    elementById:els.elementById,
    querySelectorAll:()=>filters,
    escapeHtml:value=>String(value ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#39;"),
    localDiscoveryResults:()=>({
      teams:local.teams || [],
      competitions:local.competitions || [],
      matches:local.matches || [],
    }),
    mergeById,
    russianCountLabel:countLabel,
    searchTeamSummaryCard:row=>`<team>${row.name}</team>`,
    knownTeamSummaryCard:row=>`<known>${row.name}</known>`,
    searchCompetitionSummaryCard:row=>
      `<competition>${row.name}</competition>`,
    searchMatchCard:row=>`<match>${row.fixtureId}</match>`,
    setDiscoveryHomeVisibility:
      callbacks.setDiscoveryHomeVisibility
      || (value=>calls.push(['visibility',value])),
    onRenderDiscoveryHome:
      callbacks.onRenderDiscoveryHome
      || (()=>calls.push(['home'])),
    onRetry:
      callbacks.onRetry
      || (()=>calls.push(['retry'])),
    onBindDiscoveryActions:
      callbacks.onBindDiscoveryActions
      || (root=>calls.push(['entities',root])),
    onBindSearchMatchActions:
      callbacks.onBindSearchMatchActions
      || (root=>calls.push(['matches',root])),
    onSetMode:
      callbacks.onSetMode
      || (mode=>calls.push(['mode',mode])),
    ...deps,
  });
  return {renderer,state,els,calls};
}

test('global search renderer stays presentation-only while controller owns lifecycle',()=>{
  assert.match(
    rendererSource,
    /export function createGlobalSearchRenderer/,
  );
  assert.doesNotMatch(
    rendererSource,
    /\/api\/search|sendProductAction|sendActionError/,
  );
  assert.match(
    controllerSource,
    /export function createGlobalSearchController/,
  );
  assert.match(controllerSource,/async function runGlobalSearch\(/);
  assert.doesNotMatch(app,/async function runGlobalSearch\(/);
  assert.doesNotMatch(app,/function renderGlobalSearch\(/);
});

test('app composes extracted controller and renderer with lifecycle callbacks',()=>{
  assert.match(
    app,
    /import \{ createGlobalSearchRenderer \} from '\.\/modules\/global-search-renderer\.js'/,
  );
  assert.match(
    app,
    /import \{ createGlobalSearchController \} from '\.\/modules\/global-search-controller\.js'/,
  );
  assert.match(app,/createGlobalSearchController\(\{/);
  assert.match(
    app,
    /\(\{ renderGlobalSearch \} = createGlobalSearchRenderer\(\{/,
  );
  assert.match(
    app,
    /onRetry: \(\) => runGlobalSearch\(\{ manual:true \}\)/,
  );
  assert.match(
    app,
    /onSetMode: mode => setGlobalSearchMode\(mode\)/,
  );
});

test('renderer validates structural presentation dependencies and freezes API',()=>{
  const els=elements();
  const state=baseState();
  const base={
    state,
    elementById:els.elementById,
    escapeHtml:value=>String(value),
    localDiscoveryResults:()=>({
      teams:[],
      competitions:[],
      matches:[],
    }),
    mergeById,
    russianCountLabel:countLabel,
    searchTeamSummaryCard:()=> '',
    knownTeamSummaryCard:()=> '',
    searchCompetitionSummaryCard:()=> '',
    searchMatchCard:()=> '',
    setDiscoveryHomeVisibility:()=>{},
  };

  assert.equal(
    Object.isFrozen(createGlobalSearchRenderer(base)),
    true,
  );

  for (const key of [
    'elementById',
    'escapeHtml',
    'localDiscoveryResults',
    'mergeById',
    'russianCountLabel',
    'searchTeamSummaryCard',
    'knownTeamSummaryCard',
    'searchCompetitionSummaryCard',
    'searchMatchCard',
    'setDiscoveryHomeVisibility',
  ]) {
    assert.throws(
      ()=>createGlobalSearchRenderer({...base,[key]:null}),
      /Global search renderer requires/,
      key,
    );
  }

  assert.throws(
    ()=>createGlobalSearchRenderer({...base,state:{}}),
    /state\.globalSearch/,
  );
});

test('empty query hides results and returns to discovery home',()=>{
  const h=makeRenderer();

  h.renderer.renderGlobalSearch();

  assert.equal(h.els.map.get('searchResultsWrap').hidden,true);
  assert.equal(h.els.map.get('searchStatus').innerHTML,'');
  assert.deepEqual(
    h.calls.filter(row=>row[0]==='visibility' || row[0]==='home'),
    [['visibility',true],['home']],
  );
});

test('loading search keeps local results usable and updates filters',()=>{
  const filter=button({searchMode:'all'});
  const h=makeRenderer({
    state:baseState({
      query:'arsenal',
      mode:'all',
      loading:true,
      status:'refreshing',
    }),
    filters:[filter],
    local:{
      teams:[{id:1,name:'Arsenal'}],
    },
  });

  h.renderer.renderGlobalSearch();

  assert.equal(h.els.map.get('globalSearchBtn').disabled,true);
  assert.equal(h.els.map.get('globalSearchBtn').textContent,'Ищу…');
  assert.match(
    h.els.map.get('searchStatus').innerHTML,
    /Обновляем результаты/,
  );
  assert.match(
    h.els.map.get('searchResults').innerHTML,
    /<team>Arsenal<\/team>/,
  );
  assert.match(
    h.els.map.get('searchResultsMeta').textContent,
    /1 команда/,
  );
  assert.equal(filter.attrs['aria-pressed'],'true');
});

test('renderer treats only explicit finished=true as a finished match',()=>{
  const h=makeRenderer({
    state:baseState({
      query:'arsenal',
      remoteMatches:[
        {
          fixtureId:1,
          finished:true,
          date:'2026-10-01T12:00:00Z',
          selection:{rank:2},
        },
        {
          fixtureId:2,
          finished:'true',
          date:'2026-10-08T12:00:00Z',
          selection:{rank:1},
        },
        {
          fixtureId:3,
          finished:false,
          date:'2026-10-07T12:00:00Z',
          selection:{rank:0},
        },
      ],
    }),
  });

  h.renderer.renderGlobalSearch();

  const output=h.els.map.get('searchResults').innerHTML;
  const upcoming=output.indexOf('Предстоящие матчи');
  const finished=output.indexOf('Завершённые матчи');
  assert.ok(upcoming>=0);
  assert.ok(finished>upcoming);
  assert.ok(output.indexOf('<match>3</match>')<output.indexOf('<match>2</match>'));
  assert.ok(output.indexOf('<match>1</match>')>finished);
});

test('match ordering rejects coercive rank and timezone-less date evidence',()=>{
  const hostileRank={
    valueOf(){throw new Error('must not coerce rank');},
  };
  const h=makeRenderer({
    state:baseState({
      query:'arsenal',
      remoteMatches:[
        {
          fixtureId:1,
          finished:false,
          date:'2026-10-09T12:00:00Z',
          selection:{rank:1},
        },
        {
          fixtureId:2,
          finished:false,
          date:'2026-10-01T12:00:00',
          selection:{rank:hostileRank},
        },
        {
          fixtureId:3,
          finished:false,
          date:'2026-10-08T12:00:00Z',
          selection:{rank:1},
        },
      ],
    }),
  });

  assert.doesNotThrow(()=>h.renderer.renderGlobalSearch());
  const output=h.els.map.get('searchResults').innerHTML;
  assert.ok(
    output.indexOf('<match>3</match>')
      < output.indexOf('<match>1</match>'),
  );
  assert.ok(
    output.indexOf('<match>2</match>')
      > output.indexOf('<match>1</match>'),
  );
});

test('timeout and empty states preserve retry and mode-reset actions',()=>{
  const timeout=makeRenderer({
    state:baseState({
      query:'inter',
      status:'timeout',
    }),
  });
  timeout.renderer.renderGlobalSearch();
  timeout.els.map.get('searchRetryBtn').click();
  assert.match(
    timeout.els.map.get('searchStatus').innerHTML,
    /Источник отвечает слишком долго/,
  );
  assert.ok(
    timeout.calls.some(row=>row[0]==='retry'),
  );

  const empty=makeRenderer({
    state:baseState({
      query:'unknown',
      mode:'teams',
      status:'empty',
    }),
  });
  empty.renderer.renderGlobalSearch();
  empty.els.map.get('searchEmptyAll').click();
  assert.match(
    empty.els.map.get('searchResults').innerHTML,
    /Ничего не найдено в этом разделе/,
  );
  assert.ok(
    empty.calls.some(
      row=>row[0]==='mode' && row[1]==='all',
    ),
  );
});

test('error and resolved-query copy are escaped before entering status HTML',()=>{
  const h=makeRenderer({
    state:baseState({
      query:'arsenal',
      status:'error',
      warning:'<img src=x onerror=alert(1)>',
      resolvedQuery:'<script>alert(1)</script>',
      remoteTeams:[{id:1,name:'Arsenal'}],
    }),
  });

  h.renderer.renderGlobalSearch();

  const status=h.els.map.get('searchStatus').innerHTML;
  assert.doesNotMatch(status,/<img|<script/i);
  assert.match(status,/&lt;img/);

  h.state.globalSearch.status='done';
  h.renderer.renderGlobalSearch();
  const resolved=h.els.map.get('searchStatus').innerHTML;
  assert.match(resolved,/&lt;script&gt;/);
  assert.doesNotMatch(resolved,/<script>/i);
});

test('malformed state and hostile getters fail soft instead of crashing renderer',()=>{
  const hostileTeam={name:'hostile'};
  Object.defineProperty(hostileTeam,'id',{
    enumerable:true,
    get(){throw new Error('hostile id getter');},
  });
  const hostileState=baseState({
    query:'arsenal',
    remoteTeams:[hostileTeam],
    knownTeams:{0:{name:'bad'},length:1},
    remoteCompetitions:{unexpected:true},
    remoteMatches:null,
  });
  Object.defineProperty(hostileState.globalSearch,'warning',{
    enumerable:true,
    get(){throw new Error('hostile warning getter');},
  });

  const h=makeRenderer({
    state:hostileState,
    local:{
      teams:[{id:1,name:'Arsenal'}],
    },
  });

  assert.doesNotThrow(()=>h.renderer.renderGlobalSearch());
  assert.match(
    h.els.map.get('searchResults').innerHTML,
    /Arsenal/,
  );
});

test('presentation callback and DOM helper failures stay inside renderer boundary',()=>{
  const h=makeRenderer({
    state:baseState({
      query:'arsenal',
      remoteTeams:[{id:1,name:'Arsenal'}],
    }),
    callbacks:{
      setDiscoveryHomeVisibility:()=>{
        throw new Error('visibility failed');
      },
      onBindDiscoveryActions:()=>{
        throw new Error('bind failed');
      },
      onBindSearchMatchActions:()=>{
        throw new Error('bind failed');
      },
    },
    deps:{
      searchTeamSummaryCard:()=>{
        throw new Error('card failed');
      },
      russianCountLabel:()=>{
        throw new Error('count failed');
      },
    },
  });

  assert.doesNotThrow(()=>h.renderer.renderGlobalSearch());
  assert.match(
    h.els.map.get('searchResults').innerHTML,
    /Ничего не найдено в этом разделе/,
  );

  const hostile=createGlobalSearchRenderer({
    state:baseState({query:'arsenal'}),
    elementById:()=>{
      throw new Error('DOM lookup failed');
    },
    querySelectorAll:()=>{
      throw new Error('selector failed');
    },
    escapeHtml:value=>String(value),
    localDiscoveryResults:()=>({
      teams:[],
      competitions:[],
      matches:[],
    }),
    mergeById,
    russianCountLabel:countLabel,
    searchTeamSummaryCard:()=> '',
    knownTeamSummaryCard:()=> '',
    searchCompetitionSummaryCard:()=> '',
    searchMatchCard:()=> '',
    setDiscoveryHomeVisibility:()=>{},
  });

  assert.doesNotThrow(()=>hostile.renderGlobalSearch());
});
