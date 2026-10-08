import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const runtime=fs.readFileSync('public/modules/app-runtime.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');
const client=fs.readFileSync('public/modules/client-core.js','utf8');
const brand=fs.readFileSync('MATCHRADAR_BRAND_SPEC_RU.md','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

test('MatchRadar is the public brand while internal release identifiers stay untouched',()=>{
  assert.match(html,/MatchRadar · AI-футбольный ассистент/);
  assert.match(html,/Видим, что меняет матч\./);
  assert.doesNotMatch(html,/FutLens|FM AI/);
  assert.doesNotMatch(app,/FutLens|FM AI/);
  assert.match(runtime,/const CLIENT_VERSION = '6\.120\.0-rc144'/);
  assert.match(client,/phase5-session:v2/);
});

test('brand assets are local minimal SVGs and wired into startup and topbar',()=>{
  for(const path of [
    'public/assets/brand/matchradar-mark.svg',
    'public/assets/brand/matchradar-avatar.svg',
    'public/assets/brand/matchradar-wordmark.svg',
  ]){
    assert.equal(fs.existsSync(path),true,path);
    const asset=fs.readFileSync(path,'utf8');
    assert.match(asset,/<svg/);
    assert.doesNotMatch(asset,/<script|foreignObject/i);
  }
  assert.match(html,/rel="icon"[^>]+matchradar-mark\.svg/);
  const boot=block(html,'<div id="bootGate"','<div class="app-shell">');
  assert.match(boot,/matchradar-mark\.svg/);
  assert.doesNotMatch(boot,/RC\d|release|build|provider|runtime|telemetry|api contract/i);
});

test('premium public navigation uses brand-consistent vector icons',()=>{
  const nav=block(html,'<nav class="bottom-nav"','</nav>');
  assert.equal((nav.match(/<svg/g)||[]).length,4);
  assert.doesNotMatch(nav,/⚽|⭐|🕘|👤/);
  assert.match(css,/\.nav-item svg/);
});

test('AI match center keeps probabilities quality factors and risks above details',()=>{
  const analysis=block(app,'function renderAnalysis','function safeUrl');
  const hero=analysis.indexOf('match-experience-hero');
  const probs=analysis.indexOf('experience-prob-labels');
  const health=analysis.indexOf('experience-health-row');
  const glance=analysis.indexOf('analysisGlanceHtml(d)');
  const details=analysis.indexOf('Подробные данные матча');
  assert.ok(hero>=0 && hero<probs && probs<health && health<glance && glance<details);
  const glanceFn=block(app,'function analysisGlanceHtml','function renderAnalysis');
  assert.match(glanceFn,/slice\(0, 3\)/);
  assert.match(glanceFn,/Главные факторы/);
  assert.match(glanceFn,/Основные риски/);
  assert.match(glanceFn,/Данные:/);
});

test('ordinary Match Center promotes smart context without fabricating probability fields',()=>{
  const center=block(app,'function renderMatchCenter','async function openMatchCenter');
  const hero=center.indexOf('center-hero');
  const smart=center.indexOf('smartInsightsHeroHtml(d.smartInsights, m)');
  const details=center.indexOf('<details class="match-center-more">');
  assert.ok(hero>=0 && hero<smart && smart<details);
  assert.doesNotMatch(center,/d\.probabilities|probabilityStrip\(/);
});

test('profile keeps legal and service links after user settings',()=>{
  const profile=block(html,'<section id="profileView"','<nav class="bottom-nav"');
  const settings=profile.indexOf('preferences-panel');
  const about=profile.indexOf('profile-about-service');
  assert.ok(settings>=0 && about>settings);
  for(const label of ['Конфиденциальность','Условия использования','Сообщить о проблеме','Версия приложения']){
    assert.match(profile,new RegExp(label));
  }
  assert.match(profile,/Статус сервиса|status\.html/);
});

test('existing fixture deep-link and share contracts remain available',()=>{
  const launch=block(app,'function applyLaunchIntent','function analysisFreshnessHtml');
  assert.match(launch,/fixtureId/);
  assert.match(launch,/\['analysis','center'\]/);
  assert.match(app,/\/api\/share-link\?fixtureId=/);
  assert.match(app,/telegramShareUrl/);
  assert.match(brand,/Channel post → generated fixture link → MatchRadar Mini App/);
});

test('requested mobile widths are explicitly covered by premium CSS',()=>{
  for(const width of [360,375,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
  assert.match(css,/MatchRadar Public UI Polish|Premium/);
});

test('MatchRadar brand specification remains the current public contract',()=>{
  assert.match(brand,/Продукт:\*\* MatchRadar/);
  assert.match(brand,/Telegram-бот:\*\* MatchRadar AI/);
  assert.match(brand,/MatchRadar \| Футбол сегодня/);
  assert.match(brand,/Видим, что меняет матч\./);
  assert.match(brand,/Матчи, LIVE и AI-разбор — быстро и по делу\./);
  assert.match(brand,/source of truth/);
  assert.doesNotMatch(brand,/FutLens|FM AI/);
});



test('brand SVG assets have accessible titles and do not embed active or remote content',()=>{
  for(const path of [
    'public/assets/brand/matchradar-mark.svg',
    'public/assets/brand/matchradar-avatar.svg',
    'public/assets/brand/matchradar-wordmark.svg',
  ]){
    const svg=fs.readFileSync(path,'utf8');
    assert.match(svg,/<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="/);
    assert.match(svg,/<svg\b[^>]*role="img"[^>]*aria-labelledby="title"/);
    assert.match(svg,/<title id="title">[^<]+<\/title>/);
    assert.doesNotMatch(svg,/<(?:script|foreignObject|iframe|image)\b/i);
    assert.doesNotMatch(svg,/\bon[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=/i);
  }
});

test('brand icon and copy stay consistent between loading and app navigation',()=>{
  const boot=block(html,'<div id="bootGate"','<div class="app-shell">');
  const header=block(html,'<header class="topbar"','</header>');
  assert.match(boot,/<img src="\/assets\/brand\/matchradar-mark\.svg" alt=""/);
  assert.match(header,/<img src="\/assets\/brand\/matchradar-mark\.svg" alt=""/);
  assert.match(header,/<div class="eyebrow">MatchRadar<\/div>/);
  assert.match(header,/<p id="topbarSubtitle">Видим, что меняет матч\.<\/p>/);
  assert.match(html,/<link rel="icon" type="image\/svg\+xml" href="\/assets\/brand\/matchradar-mark\.svg\?/);
});

test('premium bottom navigation has four semantic buttons and one active page',()=>{
  const nav=block(html,'<nav class="bottom-nav"','</nav>');
  assert.match(nav,/aria-label="Основная навигация"/);
  for(const id of ['navMatches','navMyTeams','navHistory','navProfile']){
    assert.match(nav,new RegExp('<button id="'+id+'"[^>]*type="button"'));
  }
  assert.equal((nav.match(/<button\b/g)||[]).length,4);
  assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);
  assert.match(nav,/id="navMatches"[^>]*aria-current="page"/);
});

test('legal and support links remain user-facing, local and outside the match-search view',()=>{
  const profile=block(html,'<section id="profileView"','<nav class="bottom-nav"');
  for(const [route,label] of [
    ['/privacy.html','Конфиденциальность'],
    ['/terms.html','Условия использования'],
    ['/status.html','Статус сервиса'],
  ]){
    assert.ok(profile.includes('<a href="'+route+'">'+label+'</a>'),'Missing '+route);
  }
  assert.match(profile,/<button id="betaFeedbackOpenBtn"[^>]*type="button"[^>]*aria-expanded="false"/);
  assert.match(profile,/<div id="betaFeedbackForm"[^>]*hidden>/);
  const search=block(html,'<section id="searchView"','<section id="tournamentView"');
  assert.doesNotMatch(search,/href="\/(?:privacy|terms|status)\.html"/);
});
