import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');
const client=fs.readFileSync('public/modules/client-core.js','utf8');
const doc=fs.readFileSync('PHASE4_2_BRAND_IDENTITY_RU.md','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

test('FutLens is the public brand while internal release identifiers stay untouched',()=>{
  assert.match(html,/FutLens AI · Футбольный ассистент/);
  assert.match(html,/Понимай матч глубже\./);
  assert.doesNotMatch(html,/FM AI/);
  assert.doesNotMatch(app,/FM AI/);
  assert.match(app,/const CLIENT_VERSION = '6\.120\.0-rc144'/);
  assert.match(client,/phase5-session:v2/);
});

test('brand assets are local minimal SVGs and wired into startup and topbar',()=>{
  for(const path of [
    'public/assets/brand/futlens-mark.svg',
    'public/assets/brand/futlens-avatar.svg',
    'public/assets/brand/futlens-wordmark.svg',
  ]){
    assert.equal(fs.existsSync(path),true,path);
    const asset=fs.readFileSync(path,'utf8');
    assert.match(asset,/<svg/);
    assert.doesNotMatch(asset,/<script|foreignObject/i);
  }
  assert.match(html,/rel="icon"[^>]+futlens-mark\.svg/);
  const boot=block(html,'<div id="bootGate"','<div class="app-shell">');
  assert.match(boot,/futlens-mark\.svg/);
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
  const profile=block(html,'<section id="profileView"','<section class="panel admin-console"');
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
  assert.match(doc,/Channel post → generated fixture link → FutLens Mini App/);
});

test('requested mobile widths are explicitly covered by premium CSS',()=>{
  for(const width of [360,375,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
  assert.match(css,/Phase 4\.2 — FutLens AI Brand Identity & Premium UI Polish/);
});

test('brand spec contains three concepts and bot/channel packaging',()=>{
  for(const name of ['FutLens AI','KickScope AI','PitchBrief AI']) assert.match(doc,new RegExp(name));
  assert.match(doc,/Display name/);
  assert.match(doc,/Telegram channel concept/);
  assert.match(doc,/Deep-link \/ growth flow/);
  assert.match(doc,/phase5_public_v2/);
});
