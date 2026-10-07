import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFavoriteTeamsRenderer } from '../public/modules/favorite-teams-renderer.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const source=readFileSync(
  new URL('../public/modules/favorite-teams-renderer.js',import.meta.url),
  'utf8',
);

function button(dataset={}) {
  return {
    dataset:{...dataset},
    listeners:new Map(),
    addEventListener(type,handler) {
      this.listeners.set(type,handler);
    },
    click() {
      this.listeners.get('click')?.();
    },
  };
}

function createRoot() {
  return {
    innerHTML:'',
    removeButtons:[],
    openButtons:[],
    querySelectorAll(selector) {
      if (selector==='.favorite-remove') return this.removeButtons;
      if (selector==='[data-open-team]') return this.openButtons;
      return [];
    },
  };
}

function createHarness(overrides={}) {
  const root=createRoot();
  const retry=button();
  const emptyRetry=button();
  const matches=button();
  const elements=new Map([
    ['favoriteTeams',root],
    ['favoritesRetry',retry],
    ['favoritesEmptyRetry',emptyRetry],
    ['favoritesEmptyMatches',matches],
  ]);
  const state={
    favorites:[],
    favoritesLoading:false,
    favoritesLoaded:false,
    favoritesLoadError:'',
    favoriteMutations:new Set(),
    ...overrides.state,
  };
  const calls={retry:0,matches:0,remove:[],open:[]};
  const module=createFavoriteTeamsRenderer({
    state,
    elementById:id=>elements.get(id) || null,
    escapeHtml:value=>String(value ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#39;"),
    safeUrl:value=>
      typeof value==='string' && value.startsWith('https://')
        ? value
        : '',
    recoveryCardHtml:({title,message,retryId})=>
      `<div class="recovery"><strong>${title}</strong><p>${message}</p><button id="${retryId}">retry</button></div>`,
    onRetryLoad:()=>{calls.retry+=1;},
    onShowMatches:()=>{calls.matches+=1;},
    onRemoveFavorite:team=>{calls.remove.push(team);},
    onOpenTeam:team=>{calls.open.push(team);},
    ...overrides.deps,
  });
  return {module,state,root,elements,calls};
}

test('favorite renderer extraction keeps data loading and mutation ownership in app composition',()=>{
  assert.match(
    app,
    /import \{ createFavoriteTeamsRenderer \} from '\.\/modules\/favorite-teams-renderer\.js'/,
  );
  assert.match(
    app,
    /const \{ renderFavoriteTeams \} = createFavoriteTeamsRenderer\(\{/,
  );
  assert.match(app,/onRetryLoad: \(\) => loadFavorites\(\)/);
  assert.match(app,/onShowMatches: \(\) => showView\('matchesView'\)/);
  assert.match(app,/onRemoveFavorite: team => toggleFavorite\(team\)/);
  assert.match(app,/onOpenTeam: team => openTeam\(team\)/);
  assert.doesNotMatch(app,/function renderFavoriteTeams\(\)/);

  assert.match(source,/export function createFavoriteTeamsRenderer/);
  assert.match(source,/function renderFavoriteTeams\(\)/);
  for (const forbidden of [
    'async function loadFavorites',
    'async function toggleFavorite',
    'function openTeam',
    "showView('matchesView')",
    '/api/favorites',
  ]) {
    assert.equal(source.includes(forbidden),false,forbidden);
  }
});

test('renderer requires explicit formatters and callbacks at construction',()=>{
  const base={
    state:{
      favorites:[],
      favoritesLoading:false,
      favoritesLoaded:true,
      favoritesLoadError:'',
      favoriteMutations:new Set(),
    },
    elementById:()=>null,
    escapeHtml:value=>String(value),
    safeUrl:value=>String(value),
    recoveryCardHtml:()=> '',
    onRetryLoad:()=>{},
    onShowMatches:()=>{},
    onRemoveFavorite:()=>{},
    onOpenTeam:()=>{},
  };

  assert.doesNotThrow(()=>createFavoriteTeamsRenderer(base));
  for (const key of [
    'elementById',
    'escapeHtml',
    'safeUrl',
    'recoveryCardHtml',
    'onRetryLoad',
    'onShowMatches',
    'onRemoveFavorite',
    'onOpenTeam',
  ]) {
    assert.throws(
      ()=>createFavoriteTeamsRenderer({...base,[key]:null}),
      /requires state, DOM helpers, formatters and explicit callbacks/,
      key,
    );
  }
});

test('loading state preserves compact loader',()=>{
  const {module,root}=createHarness({
    state:{favoritesLoading:true,favoritesLoaded:false},
  });

  module.renderFavoriteTeams();

  assert.match(root.innerHTML,/Загружаю избранное…/);
  assert.match(root.innerHTML,/compact-loader/);
});

test('first-load error renders recovery and delegates retry',()=>{
  const {module,root,elements,calls}=createHarness({
    state:{favoritesLoadError:'offline',favoritesLoaded:false},
  });

  module.renderFavoriteTeams();

  assert.match(root.innerHTML,/Избранное временно недоступно/);
  assert.match(root.innerHTML,/offline/);
  elements.get('favoritesRetry').click();
  assert.equal(calls.retry,1);
});

test('empty state preserves stale warning, retry and matches callbacks',()=>{
  const {module,root,elements,calls}=createHarness({
    state:{
      favorites:[],
      favoritesLoaded:true,
      favoritesLoadError:'<stale>',
    },
  });

  module.renderFavoriteTeams();

  assert.match(root.innerHTML,/Избранных команд пока нет/);
  assert.match(root.innerHTML,/&lt;stale&gt;/);
  assert.match(
    root.innerHTML,
    /Последний загруженный список избранного был пуст/,
  );
  assert.match(root.innerHTML,/favoritesEmptyRetry/);
  assert.match(root.innerHTML,/favoritesEmptyMatches/);

  elements.get('favoritesEmptyRetry').click();
  elements.get('favoritesEmptyMatches').click();
  assert.equal(calls.retry,1);
  assert.equal(calls.matches,1);
});

test('rows sanitize identity, deduplicate teams, escape attributes and delegate canonical entities',()=>{
  const state={
    favorites:[
      {
        teamId:7,
        teamName:'Team <Seven>',
        teamLogo:'https://img.test/7.png',
      },
      {
        teamId:7,
        teamName:'Duplicate',
        teamLogo:'https://img.test/duplicate.png',
      },
      {
        teamId:'8',
        teamName:'No Logo',
        teamLogo:'javascript:bad',
      },
      {
        teamId:9,
        teamName:'Quoted',
        teamLogo:'https://img.test/x" onload="bad',
      },
      {teamId:true,teamName:'Invalid'},
      null,
    ],
    favoritesLoaded:true,
    favoriteMutations:new Set(),
  };
  const {module,root,calls}=createHarness({state});

  root.removeButtons=[
    button({teamId:'7'}),
    button({teamId:'8'}),
  ];
  root.openButtons=[
    button({openTeam:'7'}),
    button({openTeam:'8'}),
  ];

  module.renderFavoriteTeams();

  assert.match(root.innerHTML,/https:\/\/img\.test\/7\.png/);
  assert.match(root.innerHTML,/Team &lt;Seven&gt;/);
  assert.match(root.innerHTML,/team-placeholder/);
  assert.equal((root.innerHTML.match(/data-open-team="7"/g) || []).length,1);
  assert.doesNotMatch(root.innerHTML,/Duplicate/);
  assert.doesNotMatch(root.innerHTML,/data-open-team="true"/);
  assert.match(
    root.innerHTML,
    /https:\/\/img\.test\/x&quot; onload=&quot;bad/,
  );
  assert.doesNotMatch(root.innerHTML,/src="https:\/\/img\.test\/x" onload=/);

  root.removeButtons[0].click();
  root.openButtons[1].click();

  assert.deepEqual(calls.remove,[{
    id:7,
    name:'Team <Seven>',
    logo:'https://img.test/7.png',
  }]);
  assert.deepEqual(calls.open,[{
    id:8,
    name:'No Logo',
    logo:'',
  }]);
});

test('pending mutation is rechecked at click time and cannot double-submit removal',()=>{
  const {module,state,root,calls}=createHarness({
    state:{
      favorites:[{teamId:7,teamName:'Seven',teamLogo:''}],
      favoritesLoaded:true,
      favoriteMutations:new Set(),
    },
  });

  const remove=button({teamId:'7'});
  root.removeButtons=[remove];
  module.renderFavoriteTeams();

  state.favoriteMutations.add(7);
  remove.click();
  assert.deepEqual(calls.remove,[]);

  state.favoriteMutations.delete(7);
  remove.click();
  assert.deepEqual(calls.remove,[{id:7,name:'Seven',logo:''}]);
});

test('malformed favorite collection and hostile fields fail soft as an empty state',()=>{
  const hostile={teamId:9};
  Object.defineProperty(hostile,'teamName',{
    enumerable:true,
    get(){throw new Error('hostile name getter');},
  });
  Object.defineProperty(hostile,'teamLogo',{
    enumerable:true,
    get(){throw new Error('hostile logo getter');},
  });

  const {module,state,root}=createHarness({
    state:{
      favorites:[hostile,{teamId:false,teamName:'Bad'}],
      favoritesLoaded:true,
      favoriteMutations:{has(){throw new Error('not a Set');}},
    },
  });

  assert.doesNotThrow(()=>module.renderFavoriteTeams());
  assert.match(root.innerHTML,/Команда/);

  state.favorites={0:{teamId:7},length:1};
  assert.doesNotThrow(()=>module.renderFavoriteTeams());
  assert.match(root.innerHTML,/Избранных команд пока нет/);
});

test('malformed button datasets cannot invoke entity callbacks',()=>{
  const {module,root,calls}=createHarness({
    state:{
      favorites:[{teamId:7,teamName:'Seven',teamLogo:''}],
      favoritesLoaded:true,
    },
  });

  root.removeButtons=[
    button({teamId:'true'}),
    button({teamId:'999'}),
  ];
  root.openButtons=[
    button({openTeam:'false'}),
    button({openTeam:'999'}),
  ];

  module.renderFavoriteTeams();
  root.removeButtons.forEach(item=>item.click());
  root.openButtons.forEach(item=>item.click());

  assert.deepEqual(calls.remove,[]);
  assert.deepEqual(calls.open,[]);
});

test('missing root fails soft without invoking callbacks',()=>{
  let callbackCalls=0;
  const module=createFavoriteTeamsRenderer({
    state:{
      favorites:[],
      favoritesLoading:false,
      favoritesLoaded:true,
      favoritesLoadError:'',
      favoriteMutations:new Set(),
    },
    elementById:()=>null,
    escapeHtml:value=>String(value ?? ''),
    safeUrl:value=>String(value ?? ''),
    recoveryCardHtml:()=> '',
    onRetryLoad:()=>{callbackCalls+=1;},
    onShowMatches:()=>{callbackCalls+=1;},
    onRemoveFavorite:()=>{callbackCalls+=1;},
    onOpenTeam:()=>{callbackCalls+=1;},
  });

  assert.doesNotThrow(()=>module.renderFavoriteTeams());
  assert.equal(callbackCalls,0);
});
