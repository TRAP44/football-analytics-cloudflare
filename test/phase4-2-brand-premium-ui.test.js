import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const runtime=fs.readFileSync('public/modules/app-runtime.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');
const client=fs.readFileSync('public/modules/client-core.js','utf8');
const legacyDoc=fs.readFileSync('docs/archive/PHASE4_2_BRAND_IDENTITY_RU.md','utf8');
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
  for(const label of ['Конфиденциальность','Условия использования','Статус сервиса','Сообщить о проблеме','Версия приложения']){
    assert.match(profile,new RegExp(label));
  }
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
  assert.match(css,/Phase 4\.2 — FutLens AI Brand Identity & Premium UI Polish/);
});

test('historical Phase 4.2 options are preserved while MatchRadar is the current contract',()=>{
  for(const name of ['FutLens AI','KickScope AI','PitchBrief AI']) assert.match(legacyDoc,new RegExp(name));
  assert.match(brand,/Продукт:\*\* MatchRadar/);
  assert.match(brand,/Telegram-бот:\*\* MatchRadar AI/);
  assert.match(brand,/MatchRadar \| Футбол сегодня/);
  assert.match(brand,/Видим, что меняет матч\./);
  assert.match(brand,/Матчи, LIVE и AI-разбор — быстро и по делу\./);
  assert.match(brand,/phase5_public_v2/);
});
