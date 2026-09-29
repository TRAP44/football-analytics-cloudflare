import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');
const app=fs.readFileSync('public/app.js','utf8');

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
  ]) assert.ok(css.includes(selector),selector);

  const card=app.slice(app.indexOf('function matchCardHtml'),app.indexOf('function bindMatchActions'));
  for(const token of ['compact-match-card','compact-match-row','compact-score','analyze-btn','match-secondary-actions']){
    assert.ok(card.includes(token),token);
  }
});

test('home match cards separate status from score and keep one clear primary action',()=>{
  const center=app.slice(app.indexOf('function matchCenter'),app.indexOf('function renderPopularCompetitions'));
  const card=app.slice(app.indexOf('function matchCardHtml'),app.indexOf('function bindMatchActions'));
  assert.match(center,/if \(\(m\.finished \|\| m\.live\)[\s\S]*return `\$\{m\.score\.home\} : \$\{m\.score\.away\}`/);
  assert.match(center,/if \(m\.live\) return `\$\{m\.score\?\.home \?\? 0\} : \$\{m\.score\?\.away \?\? 0\}`/);
  assert.match(center,/return 'VS'/);
  assert.doesNotMatch(center,/идёт матч/);
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
  assert.match(css,/\.compact-actions \.analyze-btn\{[\s\S]*?min-height:44px/);
  assert.match(css,/\.quick-reminder-btn\.compact\{[\s\S]*?min-height:36px/);
  for(const width of [360,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('frontend asset revision busts the public shell cache without changing release identity',()=>{
  assert.match(html,/frontend-asset-revision" content="6\.120\.0-launch\d+"/);
  assert.match(html,/styles\.css\?v=6\.120\.0-launch\d+/);
  assert.match(html,/styles\/public-shell\.css\?v=6\.120\.0-launch\d+/);
  assert.match(html,/app\.js\?v=6\.120\.0-launch\d+/);
  assert.doesNotMatch(html,/6\.120\.0-perf1/);
});
