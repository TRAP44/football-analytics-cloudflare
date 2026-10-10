import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFirstRunGuideController } from '../public/modules/first-run-guide.js';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const firstRun=fs.readFileSync('public/modules/first-run-guide.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');

test('first run guide exists on Home and explains the product before requiring navigation',()=>{
  assert.match(html,/id="firstRunGuide"/);
  assert.match(html,/Быстрый старт/);
  assert.match(html,/Найдите матч — MatchRadar соберёт главное в одном месте/);
  assert.match(html,/Составы, форма, ключевые факторы и AI-разбор/);
  assert.match(html,/id="firstRunGuideSearch"/);
  assert.match(html,/id="firstRunGuideFavorite"/);
  assert.match(html,/id="firstRunGuideDismiss"/);
});

test('first run actions reuse search surfaces and keep team selection resumable',()=>{
  const searchStart=firstRun.indexOf('function startFirstRunSearch');
  const favoriteStart=firstRun.indexOf('function startFirstRunFavorite');
  assert.ok(searchStart>=0 && favoriteStart>searchStart);
  const searchBlock=firstRun.slice(searchStart,favoriteStart);
  const favoriteBlock=firstRun.slice(favoriteStart,firstRun.indexOf('return {',favoriteStart));
  assert.match(searchBlock,/dismissFirstRunGuide\(\)/);
  assert.match(searchBlock,/focusMatchSearch\(\)/);
  assert.doesNotMatch(favoriteBlock,/dismissFirstRunGuide\(\)/);
  assert.match(favoriteBlock,/safeCall\(showView,'searchView'\)/);
  assert.match(favoriteBlock,/resetGlobalSearchQuery\(\)/);
  assert.match(favoriteBlock,/focusGlobalSearch/);
  assert.match(firstRun,/safeElement\(elementById,'globalSearchInput'\)/);
  assert.doesNotMatch(searchBlock+favoriteBlock,/api\(/);
});

test('first run guide is one-time local UI state with privacy-safe product actions',()=>{
  assert.match(firstRun,/FIRST_RUN_GUIDE_KEY/);
  assert.match(firstRun,/storageObject\.getItem\(FIRST_RUN_GUIDE_KEY\)/);
  assert.match(firstRun,/storageObject\.setItem\(FIRST_RUN_GUIDE_KEY,'1'\)/);
  assert.match(firstRun,/safeCall\(sendProductAction,'first_run_search','matchesView'\)/);
  assert.match(firstRun,/safeCall\(sendProductAction,'first_run_favorite','searchView'\)/);
  assert.match(app,/function sendProductAction[\s\S]*?try \{[\s\S]*?sendClientTelemetry\('product_action'/);
});

test('direct launch intent bypasses the guide and is not overwritten by the default Home route',()=>{
  assert.match(firstRun,/function hasDirectLaunchIntent\(\)/);
  assert.match(firstRun,/const hidden=dismissed \|\| dismissedThisSession \|\| count>=3 \|\| hasDirectLaunchIntent\(\)/);
  assert.match(firstRun,/view==='search'/);
  assert.match(firstRun,/view==='history'/);
  assert.match(firstRun,/\['analysis','center'\]\.includes\(action\)/);
  assert.match(firstRun,/startParam[\s\S]*view==='search'[\s\S]*view==='history'[\s\S]*\['analysis','center'\]\.includes\(action\)/);
});

test('first run guide keeps mobile touch targets and collapses to one column on narrow screens',()=>{
  assert.match(css,/\.first-run-guide\{[\s\S]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.first-run-guide-actions[\s\S]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css,/\.first-run-guide-actions \.primary-btn,[\s\S]*min-height:44px/);
  assert.match(css,/@media\(max-width:375px\)[\s\S]*\.first-run-guide-actions\{grid-template-columns:1fr\}/);
  assert.match(css,/\.first-run-guide-dismiss\{[\s\S]*?min-height:44px/);
  assert.match(css,/\.miniapp-public-shell \.app-shell\{[\s\S]*--tg-content-safe-area-inset-top/);
  assert.match(css,/\.miniapp-public-shell \.topbar\{[\s\S]*padding-top:8px/);
});

test('first-run controller handles deep links and dismisses guide without network requests',()=>{
  const guide={hidden:false};
  const matchSearch={focus(){this.focused=true;},scrollIntoView(){}};
  const globalSearchInput={value:'old',focus(){this.focused=true;}};
  const elements={firstRunGuide:guide,matchSearch,globalSearchInput};
  const persisted=new Map();
  const actions=[];
  const state={globalSearch:{query:'old'}};
  const browser={location:{search:'?view=history'},setTimeout:callback=>callback()};
  const controller=createFirstRunGuideController({
    window:browser,tg:null,state,
    storage:{getItem:key=>persisted.get(key),setItem:(key,value)=>persisted.set(key,value)},
    elementById:id=>elements[id]||null,
    sendProductAction:(...args)=>actions.push(args),
    renderGlobalSearch:()=>actions.push(['renderGlobalSearch']),
    showView:view=>actions.push(['showView',view]),
  });
  assert.equal(controller.hasDirectLaunchIntent(),true);
  assert.equal(controller.renderFirstRunGuide(),false);
  assert.equal(guide.hidden,true);

  browser.location.search='?view=matches';
  assert.equal(controller.hasDirectLaunchIntent(),false);
  assert.equal(controller.renderFirstRunGuide(),true);
  assert.equal(controller.startFirstRunFavorite(),true);
  assert.equal(guide.hidden,true);
  assert.equal(state.globalSearch.query,'');
  assert.equal(globalSearchInput.value,'');
  assert.equal(globalSearchInput.focused,true);
  assert.deepEqual(actions,[
    ['first_run_favorite','searchView'],
    ['renderGlobalSearch'],
    ['showView','searchView'],
  ]);
  assert.equal(controller.renderFirstRunGuide(),true);
  assert.equal(controller.startFirstRunSearch(),true);
  assert.equal(matchSearch.focused,true);
});
