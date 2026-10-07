import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { homeMatchScoreLabel } from '../public/modules/home-match-priority.js';

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
  assert.match(center,/const details = document\.querySelector\('\.match-center-more'\)/);
  assert.match(center,/details\.open = true/);
  assert.match(center,/data-center-panel="insights"/);
  assert.match(center,/scrollIntoView/);
});

test('Match Center score presentation never invents a result when provider score is missing',()=>{
  assert.equal(
    homeMatchScoreLabel({
      live:true,
      finished:false,
      score:{home:null,away:null},
    }),
    '— : —',
  );
  assert.equal(
    homeMatchScoreLabel({
      live:false,
      finished:true,
      score:{home:null,away:null},
    }),
    '— : —',
  );
  assert.equal(
    homeMatchScoreLabel({
      live:false,
      finished:true,
      score:{home:3,away:1},
    }),
    '3 : 1',
  );

  const center=block(app,'function renderMatchCenter','async function openMatchCenter');
  assert.match(
    center,
    /homeMatchScoreLabel\(\{\.\.\.m,live,finished\}\)/,
  );
  assert.doesNotMatch(
    center,
    /score\.home \?\? 0|score\.away \?\? 0/,
  );
});

test('AI visual scores are bounded before presentation',()=>{
  const hero=block(app,'function smartInsightsHeroHtml','function smartInsightsFullHtml');
  const full=block(app,'function smartInsightsFullHtml','function liveAiCoachHtml');
  const live=block(app,'function liveAiCoachHtml','function postMatchReviewHtml');

  assert.match(hero,/Math\.round\(clampPercent\(si\.dataScore\)\)/);
  assert.match(full,/Math\.round\(clampPercent\(si\.dataScore\)\)/);
  assert.match(live,/Math\.round\(clampPercent\(ai\.confidence\)\)/);
  assert.doesNotMatch(hero,/Number\(si\.dataScore \|\| 0\)/);
  assert.doesNotMatch(live,/Math\.round\(Number\(ai\.confidence \|\| 0\)\)/);
});

test('Match Center escapes insight metrics and validates visual market/player values',()=>{
  const insight=block(app,'function smartInsightCardHtml','function matchChangeNarrativeHtml');
  const market=block(app,'function centerMarketHtml','function centerAbsenceSummary');
  const players=block(app,'function centerPlayersHtml','function playerPositionLabel');

  assert.match(insight,/escapeHtml\(publicText\(value\)\)/);
  assert.match(insight,/metricValue\(m\?\.home\)/);
  assert.match(insight,/metricValue\(m\?\.away\)/);

  assert.match(market,/Number\.isFinite\(numeric\) && numeric>1 && numeric<1000/);
  assert.doesNotMatch(
    market,
    /d\.liveOdds\.odds\?\.home \?\? '—'|d\.liveOdds\.odds\?\.draw \?\? '—'|d\.liveOdds\.odds\?\.away \?\? '—'/,
  );

  assert.match(
    players,
    /typeof p\?\.rating==='number' && Number\.isFinite\(p\.rating\)/,
  );
  assert.doesNotMatch(players,/p\.rating \? p\.rating\.toFixed/);
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
  for(const width of [360,390,430]) {
    assert.match(css,new RegExp('max-width:'+width+'px'));
  }
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('frontend asset revision is consistent after Match Center presentation changes',()=>{
  const revision=html.match(
    /frontend-asset-revision" content="([^"]+)"/,
  )?.[1];

  assert.equal(revision,'6.120.0-launch50');
  for(const asset of [
    'styles.css',
    'styles/public-shell.css',
    'styles/premium-ui.css',
    'app.js',
  ]) {
    assert.ok(
      html.includes('/'+asset+'?v='+revision),
      asset,
    );
  }
  assert.doesNotMatch(html,/6\.120\.0-launch49/);
});
