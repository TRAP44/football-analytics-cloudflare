import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const runtime=fs.readFileSync('public/modules/app-runtime.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');
const smoke=fs.readFileSync('scripts/bottom-nav-render-smoke.js','utf8');

test('QA layer restores 44px touch targets after visual polish',()=>{
  assert.match(css,/MatchRadar UX QA — Edge Cases & Accessibility/);
  for(const selector of [
    '.compact-actions .analyze-btn',
    '.fav-star.compact',
    '.quick-reminder-btn.compact',
    '.history-open',
    '.favorite-remove',
    '.reminder-remove',
  ]) assert.ok(css.includes(selector),selector);
  assert.match(css,/\.miniapp-public-shell \.fav-star\.compact\{[\s\S]*?width:44px;[\s\S]*?height:44px;/);
  assert.match(css,/\.miniapp-public-shell \.history-open,[\s\S]*?\.favorite-remove,[\s\S]*?\.reminder-remove\{[\s\S]*?min-height:44px;/);
});

test('long football names can wrap safely instead of forcing horizontal overflow',()=>{
  for(const selector of [
    '.compact-team strong',
    '.my-team-head strong',
    '.my-team-match span',
    '.history-main > strong',
    '.favorite-team-main strong',
    '.reminder-row strong',
  ]) assert.ok(css.includes(selector),selector);
  assert.match(css,/overflow-wrap:anywhere/);
  assert.match(css,/-webkit-line-clamp:2/);
});

test('loading empty recovery and error states have bounded public surfaces',()=>{
  for(const selector of [
    '.compact-loader',
    '.history-empty-state',
    '.profile-empty-state',
    '.search-empty-state',
    '.ai-track-record-empty',
    '.ai-track-record-error',
    '.recovery-card',
    '.journey-state',
  ]) assert.ok(css.includes(selector),selector);
  assert.match(css,/max-width:100%/);
  assert.match(css,/\.recovery-card \.recovery-retry-btn\{[\s\S]*?min-height:44px/);
});

test('render smoke exercises edge cases across mobile widths and themes',()=>{
  assert.match(smoke,/function assertEdgeCaseFixture/);
  assert.match(smoke,/function inspectEdgeCaseFixture/);
  for(const width of [320,360,375,390,430]) assert.match(smoke,new RegExp(String(width)));
  for(const theme of ['dark','light','ocean']) assert.ok(smoke.includes(`'${theme}'`),theme);
  assert.match(smoke,/touch target is only/);
  assert.match(smoke,/long text exceeds two lines/);
  assert.match(smoke,/EXPECTED_ASSET_REVISION/);
  assert.match(smoke,/navigateForExpectedRevision/);
  assert.match(smoke,/Network\.setCacheDisabled/);
  assert.match(smoke,/compact-match-card is-live/);
  assert.match(smoke,/match-live-label/);
  assert.match(smoke,/LIVE · 88′/);
  assert.match(smoke,/compact-score score-upcoming/);
  assert.match(smoke,/>VS</);
  assert.match(smoke,/home-match-section--live/);
  assert.match(smoke,/Сейчас идут/);
  assert.match(smoke,/home-match-section--soon/);
  assert.match(smoke,/Скоро начнутся/);
  assert.match(smoke,/home-match-section--later is-collapsible/);
  assert.match(smoke,/disclosureState/);
  assert.match(smoke,/lower-priority Home section is not collapsed by default/);
  assert.match(smoke,/home-priority-card home-personal-match/);
  assert.match(smoke,/Любимая команда · 21:45 · Premier League/);
  assert.match(smoke,/personalState/);
  assert.match(smoke,/personal Home card does not preserve single-line ellipsis clipping/);
});

test('frontend revision refreshes QA styles without changing release identity',()=>{
  assert.match(html,/frontend-asset-revision" content="6\.120\.0-launch\d+"/);
  assert.match(html,/styles\.css\?v=6\.120\.0-launch\d+/);
  assert.match(html,/styles\/public-shell\.css\?v=6\.120\.0-launch\d+/);
  assert.match(html,/app\.js\?v=6\.120\.0-launch\d+/);
  assert.match(runtime,/const CLIENT_VERSION = '6\.120\.0-rc144'/);
  assert.doesNotMatch(html,/6\.120\.0-ui3/);
});
