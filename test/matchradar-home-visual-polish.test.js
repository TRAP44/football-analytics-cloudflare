import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { homeMatchScoreLabel } from '../public/modules/home-match-priority.js';

const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));

function sourceSection(source,start,end) {
  const from=source.indexOf(start);
  assert.notEqual(from,-1,`missing section start: ${start}`);
  const to=source.indexOf(end,from+start.length);
  assert.notEqual(to,-1,`missing section end: ${end}`);
  assert.ok(to>from,`invalid section order: ${start} -> ${end}`);
  return source.slice(from,to);
}

test('MatchRadar home visual polish keeps the existing interaction contract',()=>{
  assert.match(css,/MatchRadar Public UI Polish — Home \+ Match Cards/);
  for(const selector of [
    '.home-search-block',
    '.home-priority-card',
    '.compact-match-card',
    '.compact-match-row',
    '.compact-score',
    '.match-secondary-actions',
    '.quick-reminder-btn.compact',
    '.match-watch-btn.compact',
  ]) assert.ok(css.includes(selector),selector);

  const card=sourceSection(app,'function matchCardHtml','function bindMatchActions');
  for(const token of ['compact-match-card','compact-match-row','compact-score','analyze-btn','match-secondary-actions']){
    assert.ok(card.includes(token),token);
  }
});

test('home match cards separate status from score and keep one clear primary action',()=>{
  const center=sourceSection(app,'function matchCenter','function renderPopularCompetitions');
  const card=sourceSection(app,'function matchCardHtml','function bindMatchActions');

  assert.match(center,/return homeMatchScoreLabel\(m\)/);
  assert.equal(homeMatchScoreLabel({live:true,score:{home:0,away:0}}),'0 : 0');
  assert.equal(homeMatchScoreLabel({finished:true,score:{home:2,away:1}}),'2 : 1');
  assert.equal(homeMatchScoreLabel({live:false,finished:false,score:{home:2,away:1}}),'VS');
  assert.equal(homeMatchScoreLabel({live:true,score:{home:null,away:null}}),'— : —');
  assert.doesNotMatch(center,/идёт матч/i);

  assert.match(card,/LIVE\$\{liveMinute\}/);
  assert.match(card,/Матч-центр/);
  assert.match(card,/score-live/);
  assert.match(card,/score-finished/);
  assert.match(card,/score-upcoming/);
  assert.match(css,/Home Match Card Hierarchy — status, score and first-action clarity/);
  assert.match(css,/\.compact-score\.score-upcoming\{[\s\S]*?font-size:12px/);
  assert.match(css,/\.compact-match-card\.is-live \.live-center-btn\{/);
});

test('visual polish preserves accessible touch targets and mobile widths',()=>{
  const a11y=sourceSection(css,'/* MatchRadar UX QA — Edge Cases & Accessibility */','/* Public Launch UX — actionable first run */');
  assert.match(a11y,/\.compact-actions \.analyze-btn,[\s\S]*?min-height:44px/);
  assert.match(a11y,/\.quick-reminder-btn\.compact,[\s\S]*?\.match-watch-btn\.compact,[\s\S]*?min-height:44px/);
  assert.match(a11y,/\.quick-reminder-btn\.compact,[\s\S]*?\.match-watch-btn\.compact\{[\s\S]*?min-width:44px/);
  for(const width of [360,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('frontend asset revision busts the public shell cache without changing release identity',()=>{
  const revisionMatch=html.match(/frontend-asset-revision" content="([^"]+)"/);
  assert.ok(revisionMatch,'frontend asset revision meta is required');
  const frontendRevision=revisionMatch[1];

  assert.match(frontendRevision,/^\d+\.\d+\.\d+-launch\d+$/);
  assert.ok(frontendRevision.startsWith(`${pkg.version}-launch`),'asset revision must preserve package release identity');

  for(const asset of [
    '/styles.css?v=',
    '/styles/public-shell.css?v=',
    '/styles/premium-ui.css?v=',
    '/app.js?v=',
  ]) {
    assert.ok(html.includes(`${asset}${frontendRevision}`),`${asset} must use ${frontendRevision}`);
  }

  assert.doesNotMatch(html,/6\.120\.0-perf1/);
});
