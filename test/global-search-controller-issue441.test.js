import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createGlobalSearchController,
  discoveryMatchRank,
  discoveryText,
  mergeById,
} from '../public/modules/global-search-controller.js';

function element(value='') {
  return {
    value,
    dataset:{},
    listeners:{},
    attrs:{},
    classList:{
      calls:[],
      toggle(...args){this.calls.push(args);},
    },
    addEventListener(type,fn){this.listeners[type]=fn;},
    setAttribute(name,value){this.attrs[name]=value;},
  };
}

function makeState() {
  return {
    matches:[
      {
        fixtureId:11,
        date:'2026-10-05T12:00:00Z',
        country:'England',
        leagueId:39,
        season:2026,
        league:'Premier League',
        leagueShort:'EPL',
        home:{id:1,name:'Arsenal'},
        away:{id:2,name:'Chelsea'},
        competition:{tier:'top'},
      },
    ],
    globalSearch:{
      query:'',
      mode:'all',
      requestSeq:0,
      loading:false,
      status:'idle',
      warning:'',
      resolvedQuery:'',
      remoteTeams:[],
      knownTeams:[],
      remoteCompetitions:[],
      remoteMatches:[],
      matchSourceTeam:'',
      matchDiscovery:null,
      primaryFixtureId:null,
      searchedAt:null,
    },
  };
}

function makeController(overrides={}) {
  const state=overrides.state || makeState();
  const input=element(overrides.inputValue || '');
  const button=element();
  const mode=element();
  mode.dataset.searchMode='teams';
  const elements=new Map([
    ['globalSearchInput',input],
    ['globalSearchBtn',button],
  ]);
  const calls=[];
  const timers=[];
  const cleared=[];

  const controller=createGlobalSearchController({
    state,
    elementById:overrides.elementById || (id=>elements.get(id) || null),
    querySelectorAll:
      overrides.querySelectorAll
      || (selector=>selector==='[data-search-mode]' ? [mode] : []),
    runtimeAllows:
      overrides.runtimeAllows
      || (()=>true),
    api:
      overrides.api
      || (async()=>({
        teams:[],
        knownTeams:[],
        competitions:[],
        matches:[],
      })),
    renderSearch:
      overrides.renderSearch
      || (()=>calls.push(['render'])),
    sendProductAction:
      overrides.sendProductAction
      || ((...args)=>calls.push(['product',...args])),
    sendOperationTiming:
      overrides.sendOperationTiming
      || ((...args)=>calls.push(['timing',...args])),
    isAdmin:
      overrides.isAdmin
      || (()=>false),
    renderProvider:
      overrides.renderProvider
      || (()=>calls.push(['provider'])),
    apiErrorCategory:
      overrides.apiErrorCategory
      || (()=>'error'),
    friendlyErrorMessage:
      overrides.friendlyErrorMessage
      || (()=>'friendly error'),
    sendActionError:
      overrides.sendActionError
      || ((...args)=>calls.push(['error',...args])),
    toast:
      overrides.toast
      || (message=>calls.push(['toast',message])),
    nowIso:
      overrides.nowIso
      || (()=>'2026-10-04T12:00:00.000Z'),
    performanceNow:
      overrides.performanceNow
      || (()=>123),
    setTimer:
      overrides.setTimer
      || ((fn,ms)=>{
        const handle={fn,ms,id:timers.length+1};
        timers.push(handle);
        return handle;
      }),
    clearTimer:
      overrides.clearTimer
      || (handle=>cleared.push(handle)),
  });

  return {
    controller,
    state,
    input,
    button,
    mode,
    calls,
    timers,
    cleared,
    elements,
  };
}

test('Issue #441 search text ranking is strict and non-coercive',()=>{
  assert.equal(discoveryText('  Арсенал  '),'арсенал');
  assert.equal(discoveryMatchRank('Arsenal','arsenal'),0);
  assert.equal(discoveryMatchRank('Arsenal Women','ars'),1);
  assert.equal(discoveryMatchRank('Real Madrid','mad'),2);
  assert.equal(discoveryMatchRank('Paris Saint-Germain','germain'),3);
  assert.equal(discoveryMatchRank('Inter','xyz'),99);

  assert.equal(discoveryText(true),'');
  assert.equal(discoveryText(123),'');
  assert.equal(
    discoveryText({
      toString(){throw new Error('must not coerce search input');},
    }),
    '',
  );
});

test('Issue #441 mergeById rejects malformed collections and coercive entity ids',()=>{
  const hostile={name:'hostile'};
  Object.defineProperty(hostile,'id',{
    enumerable:true,
    get(){throw new Error('hostile id getter');},
  });

  const merged=mergeById(
    [
      {id:1,name:'One'},
      {id:'2',name:'Two'},
      {id:true,name:'Boolean'},
      {id:[3],name:'Array'},
      hostile,
    ],
    [
      {id:1,name:'Duplicate'},
      {id:3,name:'Three'},
    ],
    'id',
  );

  assert.deepEqual(
    merged.map(row=>[row.id,row.name]),
    [[1,'One'],[2,'Two'],[3,'Three']],
  );
  assert.deepEqual(mergeById({unexpected:true},null,'id'),[]);
  assert.deepEqual(mergeById([{id:1}],[],''),[]);
});

test('Issue #441 local discovery ranks and deduplicates real in-memory match data',()=>{
  const {controller}=makeController();
  const result=controller.localDiscoveryResults('ars');

  assert.equal(result.teams.length,1);
  assert.equal(result.teams[0].id,1);
  assert.equal(result.teams[0].name,'Arsenal');
  assert.equal(result.competitions.length,0);
  assert.equal(result.matches.length,1);
  assert.equal(result.matches[0].fixtureId,11);
});

test('Issue #441 local discovery fails soft on malformed state and hostile match fields',()=>{
  const hostile={};
  Object.defineProperty(hostile,'fixtureId',{
    enumerable:true,
    get(){throw new Error('hostile fixture getter');},
  });
  const state=makeState();
  state.matches=[
    hostile,
    null,
    {
      fixtureId:true,
      home:{id:true,name:'Bad'},
      away:{id:2,name:'Chelsea'},
      leagueId:[39],
      league:'Premier League',
    },
  ];
  const {controller}=makeController({state});

  assert.doesNotThrow(()=>controller.localDiscoveryResults('chelsea'));
  const result=controller.localDiscoveryResults('chelsea');
  assert.equal(result.matches.length,0);
  assert.equal(result.teams.length,1);
  assert.equal(result.teams[0].id,2);

  state.matches={0:makeState().matches[0],length:1};
  assert.deepEqual(
    controller.localDiscoveryResults('arsenal'),
    {teams:[],competitions:[],matches:[]},
  );
});

test('Issue #441 successful remote search stores only bounded typed result collections',async()=>{
  const {controller,state,input,calls}=makeController({
    inputValue:'Arsenal',
    api:async(url,options)=>{
      assert.equal(url,'/api/search?q=Arsenal');
      assert.deepEqual(options,{timeoutMs:6500,retry:false});
      return {
        teams:[
          {id:'1',name:'Arsenal'},
          {id:true,name:'Invalid boolean id'},
        ],
        knownTeams:[
          {id:999,name:'Known Arsenal',country:'England',catalogOnly:true},
          {id:0,name:true},
        ],
        competitions:[
          {leagueId:'39',name:'Premier League'},
          {leagueId:false,name:'Invalid'},
        ],
        matches:[
          {fixtureId:'12',date:'2026-10-06T12:00:00Z'},
          {fixtureId:[13],date:'2026-10-07T12:00:00Z'},
        ],
        matchSource:{name:'Arsenal'},
        matchDiscovery:{primaryFixtureId:'12'},
        primaryFixtureId:true,
        resolvedQuery:'Arsenal',
        refreshedAt:'2026-10-04T12:00:00',
      };
    },
  });
  input.value='Arsenal';

  await controller.runGlobalSearch();

  assert.equal(state.globalSearch.loading,false);
  assert.equal(state.globalSearch.status,'found');
  assert.deepEqual(
    state.globalSearch.remoteTeams.map(row=>row.id),
    [1],
  );
  assert.deepEqual(
    state.globalSearch.remoteCompetitions.map(row=>row.leagueId),
    [39],
  );
  assert.deepEqual(
    state.globalSearch.remoteMatches.map(row=>row.fixtureId),
    [12],
  );
  assert.deepEqual(
    state.globalSearch.knownTeams.map(row=>row.name),
    ['Known Arsenal'],
  );
  assert.equal(state.globalSearch.primaryFixtureId,12);
  assert.equal(
    state.globalSearch.searchedAt,
    '2026-10-04T12:00:00.000Z',
  );
  assert.ok(
    calls.some(
      row=>row[0]==='product' && row[1]==='search_used',
    ),
  );
  assert.ok(
    calls.some(
      row=>row[0]==='product' && row[1]==='search_found',
    ),
  );
  assert.ok(
    calls.some(
      row=>row[0]==='timing' && row[1]==='search',
    ),
  );
});

test('Issue #441 malformed successful API payload cannot poison renderer-facing search state',async()=>{
  const response={};
  Object.defineProperty(response,'teams',{
    enumerable:true,
    get(){throw new Error('hostile teams getter');},
  });
  Object.defineProperty(response,'warning',{
    enumerable:true,
    get(){throw new Error('hostile warning getter');},
  });

  const {controller,state,input}=makeController({
    inputValue:'unknown',
    api:async()=>response,
  });
  input.value='unknown';

  await assert.doesNotReject(()=>controller.runGlobalSearch());

  assert.equal(state.globalSearch.loading,false);
  assert.equal(state.globalSearch.status,'empty');
  assert.deepEqual(state.globalSearch.remoteTeams,[]);
  assert.deepEqual(state.globalSearch.remoteMatches,[]);
  assert.deepEqual(state.globalSearch.knownTeams,[]);
  assert.equal(
    state.globalSearch.searchedAt,
    '2026-10-04T12:00:00.000Z',
  );
});

test('Issue #441 stale remote response cannot overwrite a newer query',async()=>{
  let resolveArsenal;
  const arsenalResponse=new Promise(resolve=>{
    resolveArsenal=resolve;
  });

  const {controller,state,input}=makeController({
    api:async url=>{
      if (url.includes('Arsenal')) return arsenalResponse;
      if (url.includes('Chelsea')) {
        return {
          teams:[{id:2,name:'Chelsea'}],
          knownTeams:[],
          competitions:[],
          matches:[{fixtureId:22,date:'2026-10-08T12:00:00Z'}],
          refreshedAt:'2026-10-04T12:00:00Z',
        };
      }
      return {};
    },
  });

  input.value='Arsenal';
  const first=controller.runGlobalSearch();

  input.value='Chelsea';
  await controller.runGlobalSearch();

  resolveArsenal({
    teams:[{id:1,name:'Arsenal'}],
    knownTeams:[],
    competitions:[],
    matches:[{fixtureId:11,date:'2026-10-05T12:00:00Z'}],
    refreshedAt:'2026-10-04T11:00:00Z',
  });
  await first;

  assert.equal(state.globalSearch.query,'Chelsea');
  assert.deepEqual(
    state.globalSearch.remoteTeams.map(row=>row.name),
    ['Chelsea'],
  );
  assert.deepEqual(
    state.globalSearch.remoteMatches.map(row=>row.fixtureId),
    [22],
  );
});

test('Issue #441 runtime guard failures fail closed without calling remote search',async()=>{
  let apiCalls=0;
  const {controller,state,input}=makeController({
    inputValue:'Arsenal',
    runtimeAllows:()=>{
      throw new Error('runtime controls unavailable');
    },
    api:async()=>{
      apiCalls+=1;
      return {};
    },
  });
  input.value='Arsenal';

  await assert.doesNotReject(
    ()=>controller.runGlobalSearch({manual:true}),
  );

  assert.equal(apiCalls,0);
  assert.equal(state.globalSearch.loading,false);
  assert.equal(state.globalSearch.status,'done');
  assert.match(
    state.globalSearch.warning,
    /Удалённый поиск временно недоступен/,
  );
});

test('Issue #441 input changes clear all remote state before debounce',()=>{
  const {controller,state,input,timers}=makeController();
  Object.assign(state.globalSearch,{
    resolvedQuery:'Old resolved',
    remoteTeams:[{id:1}],
    knownTeams:[{name:'Old'}],
    remoteCompetitions:[{leagueId:39}],
    remoteMatches:[{fixtureId:11}],
    matchSourceTeam:'Old source',
    matchDiscovery:{primaryFixtureId:11},
    primaryFixtureId:11,
    searchedAt:'2026-10-01T12:00:00Z',
    warning:'Old warning',
  });

  controller.bindGlobalSearchControls();
  input.value='che';
  input.listeners.input({target:input});

  assert.equal(state.globalSearch.query,'che');
  assert.equal(state.globalSearch.status,'local');
  assert.equal(state.globalSearch.loading,false);
  assert.deepEqual(state.globalSearch.remoteTeams,[]);
  assert.deepEqual(state.globalSearch.knownTeams,[]);
  assert.deepEqual(state.globalSearch.remoteCompetitions,[]);
  assert.deepEqual(state.globalSearch.remoteMatches,[]);
  assert.equal(state.globalSearch.matchSourceTeam,'');
  assert.equal(state.globalSearch.matchDiscovery,null);
  assert.equal(state.globalSearch.primaryFixtureId,null);
  assert.equal(state.globalSearch.resolvedQuery,'');
  assert.equal(state.globalSearch.searchedAt,null);
  assert.equal(state.globalSearch.warning,'');
  assert.equal(timers.length,1);
  assert.equal(timers[0].ms,500);
});

test('Issue #441 observability callback failures never block successful search UX',async()=>{
  const {controller,state,input}=makeController({
    inputValue:'Arsenal',
    api:async()=>({
      teams:[{id:1,name:'Arsenal'}],
      knownTeams:[],
      competitions:[],
      matches:[],
      refreshedAt:'2026-10-04T12:00:00Z',
    }),
    renderSearch:()=>{throw new Error('render observer failed');},
    sendProductAction:()=>{throw new Error('telemetry failed');},
    sendOperationTiming:()=>{throw new Error('timing failed');},
    isAdmin:()=>{throw new Error('admin probe failed');},
  });
  input.value='Arsenal';

  await assert.doesNotReject(()=>controller.runGlobalSearch());

  assert.equal(state.globalSearch.loading,false);
  assert.equal(state.globalSearch.status,'done');
  assert.equal(state.globalSearch.remoteTeams[0].id,1);
});

test('Issue #441 error reporting failures stay inside controller boundary',async()=>{
  const {controller,state,input}=makeController({
    inputValue:'unknown',
    api:async()=>{throw new Error('network');},
    apiErrorCategory:()=>{throw new Error('classifier failed');},
    friendlyErrorMessage:()=>{throw new Error('formatter failed');},
    sendActionError:()=>{throw new Error('telemetry failed');},
    toast:()=>{throw new Error('toast failed');},
  });
  input.value='unknown';

  await assert.doesNotReject(
    ()=>controller.runGlobalSearch({manual:true}),
  );

  assert.equal(state.globalSearch.loading,false);
  assert.equal(state.globalSearch.status,'error');
  assert.equal(
    state.globalSearch.warning,
    'Не удалось обновить поиск.',
  );
});

test('Issue #441 control binding is idempotent and malformed DOM helpers fail soft',()=>{
  const {controller,input,button,mode,state}=makeController();
  controller.bindGlobalSearchControls();
  const firstInput=input.listeners.input;
  const firstButton=button.listeners.click;

  controller.bindGlobalSearchControls();

  assert.equal(input.listeners.input,firstInput);
  assert.equal(button.listeners.click,firstButton);

  mode.listeners.click();
  assert.equal(state.globalSearch.mode,'teams');

  const hostile=createGlobalSearchController({
    state:makeState(),
    elementById:()=>{throw new Error('DOM unavailable');},
    querySelectorAll:()=>{throw new Error('selector unavailable');},
    runtimeAllows:()=>true,
    api:async()=>({}),
  });
  assert.doesNotThrow(()=>hostile.bindGlobalSearchControls());
});

test('Issue #441 app root only wires the extracted controller',()=>{
  const app=fs.readFileSync(
    new URL('../public/app.js',import.meta.url),
    'utf8',
  );
  const controller=fs.readFileSync(
    new URL('../public/modules/global-search-controller.js',import.meta.url),
    'utf8',
  );

  assert.match(app,/createGlobalSearchController/);
  assert.match(app,/bindGlobalSearchControls\(\)/);
  assert.doesNotMatch(app,/async function runGlobalSearch\(/);
  assert.doesNotMatch(app,/function discoveryMatchRank\(/);
  assert.doesNotMatch(app,/let globalSearchTimer/);
  assert.match(controller,/async function runGlobalSearch\(/);
  assert.match(controller,/function handleSearchInput\(/);
  assert.match(controller,/\/api\/search\?q=/);
});
