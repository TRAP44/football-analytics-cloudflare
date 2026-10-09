import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=read('../public/app.js');
const styles=read('../public/styles/premium-ui.css');
const html=read('../public/index.html');
const smoke=read('../scripts/bottom-nav-render-smoke.js');

test('mobile filter drawer has independently constrained width, two-column choices and scrollable competition rail',()=>{
  assert.match(styles,/\.miniapp-public-shell \.home-filter-controls\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles,/\.miniapp-public-shell \.home-filter-controls \.league-filter-drawer\s*\{[\s\S]*?width:\s*100%;[\s\S]*?overflow:\s*hidden/);
  assert.match(styles,/\.miniapp-public-shell \.home-filter-controls \.league-filter-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles,/\.miniapp-public-shell \.home-filter-controls \.competition-shortcuts\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(smoke,/async function assertMobileFilterDrawer/);
  assert.match(smoke,/await assertMobileFilterDrawer\(cdp,width\)/);
  assert.match(smoke,/width<=430&&!value\.railOverflow/);
});

test('rate-limited tomorrow feed retains a one-tap path to today LIVE without bypassing retry cooldown',()=>{
  const start=app.indexOf('async function loadMatches');
  const end=app.indexOf('function syncFilterButtons',start);
  assert.ok(start>=0 && end>start);
  const feed=app.slice(start,end);
  assert.match(feed,/const todayShortcut = state\.offset !== 0/);
  assert.match(feed,/matchesTodayLiveBtn/);
  assert.match(feed,/state\.filter = 'live'/);
  assert.match(feed,/date-btn\[data-offset="0"\]/);
  assert.match(feed,/bindCooldownRetry\(/);
  assert.match(feed,/category === 'rate_limit' \? retry : 0/);
  assert.match(feed,/fallbackSnapshot\.matches\.length/);
  assert.match(app,/Источник ограничил запросы/);
  assert.match(html,/data-filter="live"/);
});

test('frontend revision covers public, status, admin and runtime',()=>{
  for(const path of ['../public/index.html','../public/status.html','../public/admin.html','../public/modules/app-runtime.js']){
    assert.match(read(path),/6\.120\.0-launch69/);
  }
});
