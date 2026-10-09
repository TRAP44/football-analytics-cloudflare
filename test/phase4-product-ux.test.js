import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMyTeamsRenderer } from '../public/modules/my-teams-renderer.js';

const app=fs.readFileSync('public/app.js','utf8');
const myTeamsRenderer=fs.readFileSync('public/modules/my-teams-renderer.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');

test('Phase 4 public navigation is Home My Teams History Profile with search on Home',()=>{
  assert.match(html,/id="navMatches"[\s\S]*Главная/);
  assert.match(html,/id="navMyTeams"[\s\S]*Мои команды/);
  assert.match(html,/id="navHistory"[\s\S]*История/);
  assert.match(html,/id="navProfile"[\s\S]*Профиль/);
  assert.doesNotMatch(html,/id="navSearch"/);
  assert.match(html,/id="homeSearchBtn"/);
});
test('Home keeps frequent match filters visible and secondary filters behind one disclosure',()=>{
  const start=html.indexOf('<div class="home-filter-controls">');
  const end=html.indexOf('<div class="section-head">',start);
  assert.ok(start>=0 && end>start);
  const controls=html.slice(start,end);
  const drawer=controls.slice(controls.indexOf('<details'),controls.indexOf('</details>')+10);
  const quick=controls.slice(0,controls.indexOf('<details'));
  for(const filter of ['top','live','all']) assert.match(quick,new RegExp(`data-filter="${filter}"`));
  for(const filter of ['favorites','international','cups','england','spain','italy','germany','france']) {
    assert.match(drawer,new RegExp(`data-filter="${filter}"`));
    assert.doesNotMatch(quick,new RegExp(`data-filter="${filter}"`));
  }
  assert.match(drawer,/data-filter-summary-value hidden/);
  assert.match(app,/summaryValue\.hidden = !activeDrawerFilter/);
  assert.match(app,/const drawerFilters = \['favorites', 'international', 'cups', 'england', 'spain', 'italy', 'germany', 'france',[\s\S]*?'saudi'\]/);
  assert.match(app,/querySelector\('\[data-filter-summary-value\]'\)/);
  assert.match(css,/MatchRadar Home Filter Simplification — fast choices first/);
});

test('new users use Search or My Teams without a duplicate favorite-team promo on Home',()=>{
  assert.doesNotMatch(html,/id="homeFavoriteBtn"/);
  assert.doesNotMatch(html,/Сделайте ленту своей/);
  assert.match(html,/id="homeSearchBtn"/);
  assert.match(html,/id="navMyTeams"/);
  assert.match(myTeamsRenderer,/function renderMyTeams\(\)/);
});
test('My Teams reuses favorites and existing match catalog',()=>{
  const start=myTeamsRenderer.indexOf('function renderMyTeams');
  const end=myTeamsRenderer.indexOf('return Object.freeze',start);
  const body=myTeamsRenderer.slice(start,end);
  assert.match(body,/state\.favorites/);
  assert.match(body,/state\.matches/);
  assert.match(body,/matches\.filter/);
  assert.match(body,/onOpenMatch/);
  assert.doesNotMatch(body,/api\(/);
  assert.match(app,/onOpenMatch: \(fixtureId, button\) => openMatchCenter\(fixtureId, button\)/);
});
test('Match Center first level keeps AI confidence data quality three factors and risks',()=>{
  const start=app.indexOf('function analysisGlanceHtml');
  const end=app.indexOf('function renderAnalysis',start);
  const body=app.slice(start,end);
  assert.match(body,/slice\(0, 3\)/);
  assert.match(body,/Уверенность AI/);
  assert.match(body,/Данные:/);
  assert.match(body,/Главные факторы/);
  assert.match(body,/Основные риски/);
});
test('mobile contracts explicitly cover 360 375 390 and 430 widths without horizontal overflow',()=>{
  assert.match(css,/overflow-x:hidden/);
  for(const width of [360,375,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
});
test('admin navigation remains outside the public bottom navigation',()=>{
  const nav=html.slice(html.indexOf('<nav class="bottom-nav"'),html.indexOf('</nav>',html.indexOf('<nav class="bottom-nav"')));
  assert.doesNotMatch(nav,/admin|provider|runtime|diagnostic|release/i);
  assert.doesNotMatch(html,/data-admin-only/);
});



function myTeamsHarness(initialState = {}) {
  const root={innerHTML:'',querySelectorAll:()=>[]};
  const onboarding={hidden:true};
  const state={favorites:[],matches:[],...initialState};
  const escaping=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
  const callbacks={teams:[],matches:[]};
  const renderer=createMyTeamsRenderer({
    state,
    elementById:id=>({myTeamsList:root,myTeamsOnboarding:onboarding})[id]||null,
    escapeHtml:escaping,
    safeUrl:url=>typeof url==='string' && url.startsWith('https://') ? url : '',
    timeOf:()=> '15:00',
    onOpenTeam:team=>callbacks.teams.push(team),
    onOpenMatch:id=>callbacks.matches.push(id),
    now:()=>Date.parse('2026-10-08T10:00:00.000Z'),
  });
  return {state,root,onboarding,callbacks,renderer};
}

test('My Teams onboarding and loading are mutually exclusive and recover correctly',()=>{
  const h=myTeamsHarness({favoritesLoading:true,favoritesLoaded:false});
  h.renderer.renderMyTeams();
  assert.match(h.root.innerHTML,/Загружаю ваши команды/);
  assert.equal(h.onboarding.hidden,true);
  h.state.favoritesLoading=false;
  h.state.favoritesLoaded=true;
  h.renderer.renderMyTeams();
  assert.equal(h.root.innerHTML,'');
  assert.equal(h.onboarding.hidden,false);
  h.state.favorites=[{teamId:7,teamName:'Команда',teamLogo:''}];
  h.renderer.renderMyTeams();
  assert.equal(h.onboarding.hidden,true);
  assert.match(h.root.innerHTML,/class="panel my-team-card"/);
  assert.match(h.root.innerHTML,/Матчи пока не найдены/);
});

test('My Teams prioritizes LIVE then nearest upcoming then latest finished fixture',()=>{
  const h=myTeamsHarness({
    favorites:[{teamId:7,teamName:'Arsenal'}],
    matches:[
      {fixtureId:1,finished:true,date:'2026-10-07T18:00:00Z',home:{id:7,name:'Arsenal'},away:{id:8,name:'A'}},
      {fixtureId:2,date:'2026-10-09T15:00:00Z',home:{id:7,name:'Arsenal'},away:{id:9,name:'B'}},
      {fixtureId:3,live:true,date:'2026-10-08T09:00:00Z',home:{id:7,name:'Arsenal'},away:{id:10,name:'C'},score:{home:1,away:0}},
      {fixtureId:99,live:true,date:'2026-10-08T09:00:00Z',home:{id:30,name:'Other'},away:{id:31,name:'Else'}},
    ],
  });
  h.renderer.renderMyTeams();
  assert.match(h.root.innerHTML,/data-team-fixture="3"/);
  assert.match(h.root.innerHTML,/Матч идёт/);
  h.state.matches=h.state.matches.filter(m=>m.fixtureId!==3);
  h.renderer.renderMyTeams();
  assert.match(h.root.innerHTML,/data-team-fixture="2"/);
  assert.match(h.root.innerHTML,/Ближайший матч/);
  h.state.matches=h.state.matches.filter(m=>m.fixtureId!==2);
  h.renderer.renderMyTeams();
  assert.match(h.root.innerHTML,/data-team-fixture="1"/);
  assert.match(h.root.innerHTML,/Последний матч/);
});

test('My Teams escapes untrusted fixture and club labels and rejects invalid favorites',()=>{
  const h=myTeamsHarness({
    favorites:[
      {teamId:'invalid',teamName:'Ignored'},
      {teamId:7,teamName:'<img src=x onerror=alert(1)>',teamLogo:'javascript:alert(1)'},
    ],
    matches:[
      {fixtureId:42,date:'2026-10-09T12:00:00Z',home:{id:7,name:'<b>Unsafe</b>'},away:{id:8,name:'Away'}},
    ],
  });
  h.renderer.renderMyTeams();
  assert.equal((h.root.innerHTML.match(/class="panel my-team-card"/g)||[]).length,1);
  assert.match(h.root.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h.root.innerHTML,/&lt;b&gt;Unsafe&lt;\/b&gt;/);
  assert.doesNotMatch(h.root.innerHTML,/<img src=x|<b>Unsafe<\/b>|javascript:/);
});

test('My Teams binds match and team controls to explicit ID-validated callbacks',()=>{
  const controls={};
  const root={
    innerHTML:'',
    querySelectorAll:selector=>[{
      dataset:selector==='[data-open-team]'
        ? {openTeam:'7',teamName:'Arsenal',teamLogo:''}
        : {teamFixture:'42'},
      addEventListener:(event,cb)=>{controls[selector]=cb;},
    }],
  };
  const state={
    favorites:[{teamId:7,teamName:'Arsenal'}],
    matches:[{fixtureId:42,live:true,home:{id:7,name:'Arsenal'},away:{id:8,name:'Away'}}],
  };
  const calls=[];
  const renderer=createMyTeamsRenderer({
    state,elementById:id=>id==='myTeamsList'?root:null,
    escapeHtml:String,safeUrl:String,timeOf:String,
    onOpenTeam:team=>calls.push(['team',team.id]),
    onOpenMatch:id=>calls.push(['match',id]),
  });
  renderer.renderMyTeams();
  controls['[data-open-team]']();
  controls['[data-team-fixture]']();
  assert.deepEqual(calls,[['team',7],['match',42]]);
});
