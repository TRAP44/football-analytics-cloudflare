import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');
const client=fs.readFileSync('public/modules/client-core.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

test('startup is brand-only and contains no release or internal identifiers',()=>{
  const boot=block(html,'<div id="bootGate"','<div class="app-shell">');
  assert.match(boot,/MatchRadar/);
  assert.match(boot,/Видим, что меняет матч\./);
  assert.match(boot,/Загружаем матчи/);
  assert.doesNotMatch(boot,/bootVersion|версия|RC\d|release|build|provider|runtime|telemetry|api contract/i);
  const startup=block(app,'async function runStartupSequence','const api = createApiClient');
  assert.doesNotMatch(startup,/формат данных|apiContract|Проверяю версию|Системная информация/);
});

test('Home keeps search and filters primary while only a real personal match may appear contextually',()=>{
  const home=block(html,'<section id="matchesView"','<section id="searchView"');
  const search=home.indexOf('id="homeSearchBtn"');
  const priority=home.indexOf('id="dailyOverview"');
  const dates=home.indexOf('class="date-strip"');
  const matches=home.indexOf('id="matchesTitle"');
  assert.ok(search>=0 && search<priority && priority<dates && dates<matches);
  assert.match(home,/id="dailyOverview"[^>]*hidden/);
  assert.match(home,/id="homePersonalMatchBtn"[^>]*hidden/);
  assert.doesNotMatch(home,/id="homeLiveCard"/);
  assert.doesNotMatch(home,/id="homeTeamsBtn"/);
  assert.doesNotMatch(home,/id="homeFavoriteBtn"/);
  assert.doesNotMatch(home,/Сделайте ленту своей/);
  const overview=block(app,'function renderDailyOverview','function filteredMatches');
  assert.match(overview,/const personalItem = homePersonalMatch\(\)/);
  assert.match(overview,/root\.hidden = !personalItem/);
  assert.doesNotMatch(overview,/liveCount|favoriteCount|homeLiveCard|homeTeamsBtn|homeFavoriteBtn/);
});

test('match feed card is compact and does not embed analysis detail',()=>{
  const card=block(app,'function matchCardHtml','function bindMatchActions');
  assert.match(card,/compact-match-card/);
  assert.match(card,/match-card-topline/);
  assert.match(card,/compact-match-row/);
  assert.match(card,/compact-actions/);
  assert.match(card,/match-secondary-actions/);
  assert.doesNotMatch(card,/matchAiSnapshotHtml|Почему здесь|match-card-more/);
});

test('AI match view exposes key decision layer before detailed data',()=>{
  const glance=block(app,'function analysisGlanceHtml','function renderAnalysis');
  assert.match(glance,/slice\(0, 3\)/);
  assert.match(glance,/Уверенность AI/);
  assert.match(glance,/Данные:/);
  assert.match(glance,/Главные факторы/);
  assert.match(glance,/Основные риски/);
  const analysis=app.slice(app.indexOf('function renderAnalysis'));
  assert.ok(analysis.indexOf('analysisGlanceHtml(d)') < analysis.indexOf('Подробные данные матча'));
  assert.match(analysis,/class="analysis-more-data"/);
  assert.doesNotMatch(analysis.slice(0,analysis.indexOf('Подробные данные матча')),/analysisVersion|fingerprint|temperature/);
  const center=block(app,'function renderMatchCenter','async function openMatchCenter');
  assert.match(center,/class="match-center-more"/);
  assert.ok(center.indexOf('center-scoreboard') < center.indexOf('Статистика, составы и хронология'));
});

test('profile prioritizes actionable team counter reminders settings and moves legal to About',()=>{
  const publicProfile=block(html,'<section id="profileView"','<nav class="bottom-nav"');
  const profile=publicProfile.indexOf('class="panel profile-panel"');
  const teams=publicProfile.indexOf('id="profileFavoriteTeamsBtn"');
  const reminders=publicProfile.indexOf('id="reminderList"');
  const settings=publicProfile.indexOf('class="panel preferences-panel"');
  const about=publicProfile.indexOf('class="panel profile-about-service"');
  assert.ok(profile>=0 && profile<teams && teams<reminders && reminders<settings && settings<about);
  assert.match(publicProfile,/Активные напоминания/);
  assert.match(publicProfile,/О сервисе/);
  assert.match(publicProfile,/Конфиденциальность/);
  assert.match(publicProfile,/Условия использования/);
  assert.match(publicProfile,/Статус сервиса|status\.html/);
  assert.match(publicProfile,/Сообщить о проблеме/);
  assert.match(publicProfile,/id="publicAppVersion"/);
  const search=block(html,'<section id="searchView"','<section id="tournamentView"');
  assert.doesNotMatch(search,/privacy\.html|terms\.html|status\.html/);
});

test('public visible copy keeps developer vocabulary out of ordinary profile and startup',()=>{
  const publicProfile=block(html,'<section id="profileView"','<nav class="bottom-nav"').replace(/<[^>]+>/g,' ').toLowerCase();
  for(const term of ['provider','runtime','release','telemetry','rc144']) assert.equal(publicProfile.includes(term),false,term);
});

test('mobile polish covers requested widths',()=>{
  for(const width of [360,375,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
  assert.match(css,/compact-match-row/);
  assert.match(css,/boot-card-simple/);
  assert.match(css,/home-priority-card/);
});

test('Phase 5 resumes only with the current session cohort contract',()=>{
  assert.match(worker,/createBetaPhase5Runtime\(\{[\s\S]*PHASE5_VALIDATION_COHORT/);
  assert.match(client,/phase5-session:v2/);
  assert.doesNotMatch(client,/phase5-session:v1/);
});



test('startup provides accessible loading feedback with recovery buttons hidden by default',()=>{
  const boot=block(html,'<div id="bootGate"','<div class="app-shell">');
  assert.match(boot,/<div id="bootGate"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(boot,/<h1 id="bootTitle">MatchRadar<\/h1>/);
  assert.match(boot,/<p id="bootText">Загружаем матчи…<\/p>/);
  assert.match(boot,/class="boot-progress" aria-hidden="true"/);
  for(const id of ['bootRetryBtn','bootContinueBtn','bootReloadBtn']){
    assert.match(boot,new RegExp('<button id="'+id+'"[^>]*type="button"[^>]*hidden'));
  }
});

test('Home has labeled search, accessible quick filters, and chronological date defaults',()=>{
  const home=block(html,'<section id="matchesView"','<section id="searchView"');
  assert.match(home,/<input id="matchSearch"[^>]*type="search"[^>]*aria-label="Поиск команды или матча"/);
  assert.match(home,/<button id="homeSearchBtn"[^>]*type="button">Найти<\/button>/);
  assert.match(home,/id="filterStrip"[^>]*role="group"[^>]*aria-label="Быстрые фильтры матчей"/);
  for(const filter of ['top','live','all']){
    assert.match(home,new RegExp('data-filter="'+filter+'"'));
  }
  const offsets=[...home.matchAll(/class="date-btn[^"]*" type="button" data-offset="(-?\d+)"/g)]
    .map(match=>Number(match[1]));
  assert.deepEqual(offsets.slice(0,3),[-1,0,1]);
  assert.match(home,/class="date-btn active" type="button" data-offset="0"/);
});

test('personal match and Radar feed never render before personalized data exists',()=>{
  const home=block(html,'<section id="matchesView"','<section id="searchView"');
  assert.match(home,/<section id="dailyOverview"[^>]*hidden>/);
  assert.match(home,/<button id="homePersonalMatchBtn"[^>]*hidden>/);
  assert.match(home,/<section id="radarFeedWrap"[^>]*hidden>/);
  const overview=block(app,'function renderDailyOverview','function filteredMatches');
  assert.match(overview,/personalCard\.hidden = !personalItem/);
  assert.match(overview,/root\.hidden = !personalItem/);
  for(const name of ['kicker','text','meta']){
    assert.match(overview,new RegExp('if \\('+name+'\\) '+name+'\\.textContent ='));
  }
  assert.doesNotMatch(overview,/\.innerHTML\s*=/);
});

test('compact match cards escape untrusted team labels and use safe logo URLs',()=>{
  const card=block(app,'function matchCardHtml','function bindMatchActions');
  assert.match(card,/class="competition-name">\$\{escapeHtml\(m\.league \|\| 'Турнир'\)\}/);
  assert.match(card,/data-team-name="\$\{escapeHtml\(m\.home\?\.name \|\| ''\)\}"/);
  assert.match(card,/data-team-name="\$\{escapeHtml\(m\.away\?\.name \|\| ''\)\}"/);
  assert.match(card,/src="\$\{safeUrl\(m\.home\.logo\)\}"/);
  assert.match(card,/src="\$\{safeUrl\(m\.away\.logo\)\}"/);
  assert.match(card,/<strong>\$\{escapeHtml\(m\.home\?\.name \|\| ''\)\}<\/strong>/);
  assert.match(card,/<strong>\$\{escapeHtml\(m\.away\?\.name \|\| ''\)\}<\/strong>/);
});
