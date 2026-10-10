import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  createHomeSignalRenderer,
  homeHeroStats,
  russianPlural,
  selectHomeFeaturedMatch,
} from '../public/modules/home-signal.js';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const signal=fs.readFileSync('public/modules/home-signal.js','utf8');
const css=fs.readFileSync('public/styles/premium-ui.css','utf8');

const NOW=Date.parse('2026-10-10T15:00:00.000Z');
const at=minutes=>new Date(NOW+minutes*60000).toISOString();

function match(fixtureId,extra={}) {
  return {
    fixtureId,
    live:false,
    finished:false,
    youthReserve:false,
    date:at(60),
    interestScore:50,
    featured:false,
    competition:{priority:50},
    ...extra,
  };
}

function block(source,start,end) {
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('featured match prefers LIVE, then upcoming, then finished',()=>{
  const finished=match(1,{finished:true,date:at(-200),interestScore:99,featured:true});
  const upcoming=match(2,{interestScore:90});
  const live=match(3,{live:true,date:at(-40),interestScore:10});
  assert.equal(selectHomeFeaturedMatch({matches:[finished,upcoming,live],nowMs:NOW}),live);
  assert.equal(selectHomeFeaturedMatch({matches:[finished,upcoming],nowMs:NOW}),upcoming);
  assert.equal(selectHomeFeaturedMatch({matches:[finished],nowMs:NOW}),finished);
});

test('featured match ranks by featured flag, interest, priority and kickoff inside a phase',()=>{
  const plain=match(1,{interestScore:95});
  const flagged=match(2,{featured:true,interestScore:60});
  assert.equal(selectHomeFeaturedMatch({matches:[plain,flagged],nowMs:NOW}),flagged);

  const lowInterest=match(3,{interestScore:40});
  const highInterest=match(4,{interestScore:80});
  assert.equal(selectHomeFeaturedMatch({matches:[lowInterest,highInterest],nowMs:NOW}),highInterest);

  const later=match(5,{date:at(240)});
  const sooner=match(6,{date:at(30)});
  assert.equal(selectHomeFeaturedMatch({matches:[later,sooner],nowMs:NOW}),sooner);
});

test('featured match never invents a candidate',()=>{
  assert.equal(selectHomeFeaturedMatch({matches:[],nowMs:NOW}),null);
  assert.equal(selectHomeFeaturedMatch({matches:null,nowMs:NOW}),null);
  // Scheduled but already past kickoff and not live: data is uncertain, skip it.
  assert.equal(selectHomeFeaturedMatch({matches:[match(1,{date:at(-10)})],nowMs:NOW}),null);
  // Youth/reserve matches are never the match of the day.
  assert.equal(selectHomeFeaturedMatch({matches:[match(2,{youthReserve:true})],nowMs:NOW}),null);
  // Contradictory status is rejected.
  assert.equal(selectHomeFeaturedMatch({matches:[match(3,{live:true,finished:true})],nowMs:NOW}),null);
  // Invalid identifiers are rejected.
  assert.equal(selectHomeFeaturedMatch({matches:[match(0)],nowMs:NOW}),null);
});

test('featured match does not duplicate the personal «Для вас» card',()=>{
  const personal=match(10,{live:true,date:at(-30),interestScore:99});
  const other=match(11,{interestScore:70});
  assert.equal(selectHomeFeaturedMatch({matches:[personal,other],excludeFixtureId:10,nowMs:NOW}),other);
  assert.equal(selectHomeFeaturedMatch({matches:[personal],excludeFixtureId:'10',nowMs:NOW}),null);
});

test('hero stats count only loaded, valid, non-youth matches',()=>{
  assert.deepEqual(homeHeroStats([]),{total:0,live:0});
  assert.deepEqual(homeHeroStats(undefined),{total:0,live:0});
  assert.deepEqual(homeHeroStats([
    match(1,{live:true}),
    match(2),
    match(3,{finished:true}),
    match(4,{youthReserve:true,live:true}),
    match(0),
  ]),{total:3,live:1});
});

test('home SIGNAL layout keeps search primary and personal card contract intact',()=>{
  const home=block(html,'<section id="matchesView"','<section id="searchView"');
  const hero=home.indexOf('id="homeHero"');
  const search=home.indexOf('id="homeSearchBtn"');
  const featured=home.indexOf('id="homeFeatured"');
  const priority=home.indexOf('id="dailyOverview"');
  const dates=home.indexOf('class="date-strip"');
  const feed=home.indexOf('id="matchesTitle"');
  assert.ok(hero>=0 && hero<search && search<featured && featured<priority && priority<dates && dates<feed);
  assert.match(home,/<section id="homeFeatured"[^>]*hidden>/);
  assert.match(home,/<div id="homeHeroStats"[^>]*hidden>/);
  // Only one page-level h1 (topbar); the hero is a section heading.
  assert.doesNotMatch(home,/<h1/);
});

test('featured card escapes provider text, uses safe logos and opens the match headquarters',()=>{
  const featured=block(signal,'function teamHtml','return Object.freeze');
  assert.match(featured,/src="\$\{safeUrl\(team\.logo\)\}"/);
  assert.match(featured,/escapeHtml\(team\?\.name \|\| ''\)/);
  assert.match(featured,/escapeHtml\(meta\)/);
  assert.match(featured,/openMatchCenter\(fixtureId,event\.currentTarget\)/);
  // The featured card never auto-starts a paid AI analysis.
  assert.doesNotMatch(featured,/analyzeMatch\(/);
  // Score comes from the shared, non-fabricating label.
  assert.match(featured,/homeMatchScoreLabel\(match\)/);
});

test('hero renders text only and hides stats until real data is loaded',()=>{
  const hero=block(signal,'function renderHomeHero','function teamHtml');
  assert.doesNotMatch(hero,/innerHTML/);
  assert.match(hero,/statsEl\.hidden=!loaded \|\| stats\.total<1/);
  assert.doesNotMatch(hero,/matchesMeta\?\.date===/);
  assert.match(hero,/\$\('homeHeroLiveWrap'\)\.hidden=stats\.live<1/);
});

test('SIGNAL styles use theme tokens, respect reduced motion and keep 44px targets',()=>{
  const signal=block(css,'MatchRadar SIGNAL','Поиск: на узких экранах');
  assert.doesNotMatch(signal,/#[0-9a-f]{3,8}\b/i,'colours must come from theme tokens');
  assert.match(signal,/prefers-reduced-motion: no-preference[\s\S]*mr-sweep/);
  assert.match(signal,/\.mr-featured-team \{[\s\S]*?min-height: 44px/);
  assert.match(signal,/\.mr-featured-open \{[\s\S]*?min-height: 52px/);
  assert.match(signal,/#matches \.compact-actions \.analyze-btn \{ min-height: 44px/);
});

test('home SIGNAL is loaded lazily so the startup bundle does not grow',()=>{
  assert.equal(app.includes("from './modules/home-signal.js'"),false);
  assert.match(app,/import\('\.\/modules\/home-signal\.js\?v=6\.120\.0-launch\d+'\)/);
  assert.match(app,/renderDailyOverview\(\);\s*renderRadarFeed\(\);\s*renderHomeSignal\(\);/);
  // A failed chunk load must not break the home feed and may retry later.
  assert.match(app,/\.catch\(\(\)=>\{homeSignal=null;\}\)/);
  assert.match(app,/homeSignal\.then\(r=>r\?\.render\(\)\)/);
});

test('russian plural forms for the hero counter',()=>{
  assert.equal(russianPlural(1,'матч','матча','матчей'),'матч');
  assert.equal(russianPlural(3,'матч','матча','матчей'),'матча');
  assert.equal(russianPlural(5,'матч','матча','матчей'),'матчей');
  assert.equal(russianPlural(11,'матч','матча','матчей'),'матчей');
  assert.equal(russianPlural(21,'матч','матча','матчей'),'матч');
  assert.equal(russianPlural(112,'матч','матча','матчей'),'матчей');
});

test('explicit dark theme keeps the amber brand accent instead of the legacy green',()=>{
  // :root[data-theme="dark"] in styles.css has specificity (0,2,0) and sets green;
  // the brand override must be at least as specific and load later.
  assert.match(css,/html\[data-accent="system"\]\[data-theme="dark"\] \{ --accent: #fbbf24; --accent-text: #1a1203; \}/);
  assert.match(css,/html\[data-accent="system"\]\[data-theme="light"\] \{ --accent: #b45309;/);
});

function fakeHome(state) {
  const nodes=new Map();
  const node=()=>({hidden:false,textContent:'',innerHTML:'',dataset:{},querySelector:()=>null,querySelectorAll:()=>[]});
  for (const id of ['homeHeroDate','homeHeroStats','homeHeroTotal','homeHeroTotalLabel','homeHeroLive','homeHeroLiveWrap','homeFeatured','homeFeaturedCard','homeFeaturedReason','homePersonalMatchBtn']) nodes.set(id,node());
  nodes.get('homeHeroStats').hidden=true;
  nodes.get('homeFeatured').hidden=true;
  const renderer=createHomeSignalRenderer({
    $:id=>nodes.get(id) || null,
    state,
    safeUrl:value=>value,
    escapeHtml:value=>String(value),
    analysisHistoryForFixture:()=>null,
    aiConfidenceMeterHtml:()=>'',
    openMatchCenter:()=>{},
    openTeam:()=>{},
  });
  return {nodes,renderer};
}

test('hero counters appear as soon as a payload is applied, before matchesMeta.date is set (Codex review)',()=>{
  // applyMatchPayload() replaces matchesMeta without a date and renders first;
  // loadMatches() assigns the date only afterwards.
  const state={offset:0,matches:[match(1,{live:true}),match(2)],matchesMeta:{cached:false,refreshing:false}};
  const {nodes,renderer}=fakeHome(state);
  renderer.render();
  assert.equal(nodes.get('homeHeroStats').hidden,false);
  assert.equal(nodes.get('homeHeroTotal').textContent,'2');
  assert.equal(nodes.get('homeHeroTotalLabel').textContent,'матча в поле зрения');
  assert.equal(nodes.get('homeHeroLive').textContent,'1');
  assert.equal(nodes.get('homeHeroLiveWrap').hidden,false);
});

test('hero counters stay hidden while a new day is loading or the date is unavailable',()=>{
  const loading=fakeHome({offset:1,matches:[],matchesMeta:{date:'2026-10-10'}});
  loading.renderer.render();
  assert.equal(loading.nodes.get('homeHeroStats').hidden,true);
  assert.equal(loading.nodes.get('homeFeatured').hidden,true);

  const noPayload=fakeHome({offset:0,matches:[match(1)],matchesMeta:null});
  noPayload.renderer.render();
  assert.equal(noPayload.nodes.get('homeHeroStats').hidden,true);

  const restricted=fakeHome({offset:-1,matches:[match(1)],matchesMeta:{restrictedDate:true}});
  restricted.renderer.render();
  assert.equal(restricted.nodes.get('homeHeroStats').hidden,true);
});
