import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

test('Match Center premium polish keeps the existing data and interaction contract',()=>{
  assert.match(css,/MatchRadar Public UI Polish — Match Center \+ AI Analysis/);
  const center=block(app,'function renderMatchCenter','async function openMatchCenter');
  for(const token of [
    'center-hero',
    'center-scoreboard',
    'center-team-card',
    'center-score-core',
    'centerRefreshBtn',
    'centerAnalyzeBtn',
    'smartInsightsHeroHtml',
    'match-center-more',
  ]) assert.ok(center.includes(token),token);
  assert.doesNotMatch(center,/d\.probabilities|probabilityStrip\(/);
});

test('AI analysis keeps probabilities decision factors risks and detailed data in that order',()=>{
  const analysis=block(app,'function renderAnalysis','function safeUrl');
  const hero=analysis.indexOf('match-experience-hero');
  const outcome=analysis.indexOf('experience-callout');
  const probs=analysis.indexOf('experience-prob-labels');
  const glance=analysis.indexOf('analysisGlanceHtml(d)');
  const details=analysis.indexOf('analysis-more-data');
  assert.ok(hero>=0 && hero<outcome && outcome<probs && probs<glance && glance<details);
  const glanceFn=block(app,'function analysisGlanceHtml','function renderAnalysis');
  assert.match(glanceFn,/slice\(0, 3\)/);
  assert.match(glanceFn,/Главные факторы/);
  assert.match(glanceFn,/Основные риски/);
});

test('match center and AI polish preserves mobile and touch behavior',()=>{
  for(const selector of [
    '.center-hero-actions > button',
    '.experience-actions > button',
    '.center-tab-btn',
    '.analysis-tab-btn',
  ]) assert.ok(css.includes(selector),selector);
  assert.match(css,/\.center-hero-actions > button\{[\s\S]*?min-height:44px/);
  for(const width of [360,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('frontend revision refreshes the polished Match Center assets',()=>{
  assert.match(html,/frontend-asset-revision" content="6\.120\.0-launch4"/);
  assert.match(html,/styles\.css\?v=6\.120\.0-launch4/);
  assert.match(html,/styles\/public-shell\.css\?v=6\.120\.0-launch4/);
  assert.match(html,/app\.js\?v=6\.120\.0-launch4/);
  assert.doesNotMatch(html,/6\.120\.0-ui1/);
});
