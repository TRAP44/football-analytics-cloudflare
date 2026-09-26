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
  assert.match(boot,/FM AI/);
  assert.match(boot,/Ваш футбол — в одном месте/);
  assert.match(boot,/Загружаем матчи/);
  assert.doesNotMatch(boot,/bootVersion|версия|RC\d|release|build|provider|runtime|telemetry|api contract/i);
  const startup=block(app,'async function runStartupSequence','const api = createApiClient');
  assert.doesNotMatch(startup,/формат данных|apiContract|Проверяю версию|Системная информация/);
});

test('Home priority is search then contextual live or teams then today matches',()=>{
  const home=block(html,'<section id="matchesView"','<section id="searchView"');
  const search=home.indexOf('id="homeSearchBtn"');
  const priority=home.indexOf('id="dailyOverview"');
  const dates=home.indexOf('class="date-strip"');
  const matches=home.indexOf('id="matchesTitle"');
  assert.ok(search>=0 && search<priority && priority<dates && dates<matches);
  assert.match(home,/id="homeLiveCard"[^>]*hidden/);
  assert.match(home,/id="homeTeamsBtn"[^>]*hidden/);
  assert.match(home,/id="homeFavoriteBtn"[^>]*hidden/);
  const overview=block(app,'function renderDailyOverview','function filteredMatches');
  assert.match(overview,/liveCard\.hidden = liveCount <= 0/);
  assert.match(overview,/teamsCard\.hidden = favoriteCount <= 0/);
  assert.match(overview,/onboarding\.hidden = favoriteCount > 0/);
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
  const analysis=block(app,'function renderAnalysis','function safeUrl');
  assert.ok(analysis.indexOf('analysisGlanceHtml(d)') < analysis.indexOf('Подробные данные матча'));
  assert.match(analysis,/class="analysis-more-data"/);
  assert.doesNotMatch(analysis.slice(0,analysis.indexOf('Подробные данные матча')),/analysisVersion|fingerprint|temperature/);
  const center=block(app,'function renderMatchCenter','async function openMatchCenter');
  assert.match(center,/class="match-center-more"/);
  assert.ok(center.indexOf('center-scoreboard') < center.indexOf('Подробности матча'));
});

test('profile prioritizes user teams reminders settings and moves legal to About',()=>{
  const publicProfile=block(html,'<section id="profileView"','<section class="panel admin-console"');
  const profile=publicProfile.indexOf('class="panel profile-panel"');
  const teams=publicProfile.indexOf('id="favoriteTeams"');
  const reminders=publicProfile.indexOf('id="reminderList"');
  const settings=publicProfile.indexOf('class="panel preferences-panel"');
  const about=publicProfile.indexOf('class="panel profile-about-service"');
  assert.ok(profile>=0 && profile<teams && teams<reminders && reminders<settings && settings<about);
  assert.match(publicProfile,/О сервисе/);
  assert.match(publicProfile,/Конфиденциальность/);
  assert.match(publicProfile,/Условия использования/);
  assert.match(publicProfile,/Статус сервиса/);
  assert.match(publicProfile,/Сообщить о проблеме/);
  assert.match(publicProfile,/id="publicAppVersion"/);
  const search=block(html,'<section id="searchView"','<section id="tournamentView"');
  assert.doesNotMatch(search,/privacy\.html|terms\.html|status\.html/);
});

test('public visible copy keeps developer vocabulary out of ordinary profile and startup',()=>{
  const publicProfile=block(html,'<section id="profileView"','<section class="panel admin-console"').replace(/<[^>]+>/g,' ').toLowerCase();
  for(const term of ['provider','runtime','release','telemetry','rc144']) assert.equal(publicProfile.includes(term),false,term);
});

test('mobile polish covers requested widths',()=>{
  for(const width of [360,375,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
  assert.match(css,/compact-match-row/);
  assert.match(css,/boot-card-simple/);
  assert.match(css,/home-priority-card/);
});

test('Phase 5 resumes only in a clean post-polish cohort',()=>{
  assert.match(worker,/PHASE5_VALIDATION_COHORT\s*=\s*'phase5_public_v2'/);
  assert.match(client,/phase5-session:v2/);
  assert.doesNotMatch(client,/phase5-session:v1/);
});
