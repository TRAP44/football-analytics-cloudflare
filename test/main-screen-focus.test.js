import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';
import {
  homeMatchScoreLabel,
  homeMatchSections,
} from '../public/modules/home-match-priority.js';

const app = fs.readFileSync('public/app.js', 'utf8');
const profileSummary = fs.readFileSync('public/modules/profile-summary.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

test('main match screen keeps secondary discovery inside the league drawer', () => {
  const drawerStart = html.indexOf('<details class="home-filter-drawer league-filter-drawer">');
  const drawerEnd = html.indexOf('</details>', drawerStart);
  const popular = html.indexOf('id="popularCompetitionsWrap"');
  assert.ok(drawerStart >= 0 && drawerEnd > drawerStart);
  assert.ok(popular > drawerStart && popular < drawerEnd);
  assert.match(app, /\.slice\(0, 5\)/);
});

test('secondary filter summary explains the selected filter and closes after selection', () => {
  assert.match(app, /const drawerFilters = \['favorites', 'international', 'cups', 'england', 'spain', 'italy', 'germany', 'france'\]/);
  assert.match(app, /summaryValue\.textContent = activeDrawerFilter \? labels\[state\.filter\] : ''/);
  assert.match(app, /summaryValue\.hidden = !activeDrawerFilter/);
  assert.match(app, /btn\.closest\('\.league-filter-drawer'\)/);
  assert.match(app, /drawer\.open = false/);
});

test('focused home grouping keeps scheduled matches in soon/later sections without a render-time ReferenceError', () => {
  const now=Date.parse('2026-10-07T18:00:00.000Z');
  const soon={
    fixtureId:101,
    live:false,
    finished:false,
    date:'2026-10-07T19:00:00.000Z',
  };
  const later={
    fixtureId:102,
    live:false,
    finished:false,
    date:'2026-10-08T00:00:00.000Z',
  };

  const sections=homeMatchSections([soon,later],now);

  assert.deepEqual(
    sections.map(section=>section.key),
    ['soon','later'],
  );
  assert.equal(sections[0].matches[0],soon);
  assert.equal(sections[1].matches[0],later);
});

test('focused home score label never fabricates nil-nil for an unknown live score', () => {
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
      live:true,
      finished:false,
      score:{home:'2',away:'1'},
    }),
    '2 : 1',
  );
  assert.equal(
    homeMatchScoreLabel({
      live:false,
      finished:false,
      score:{home:0,away:0},
    }),
    'VS',
  );
  assert.equal(
    homeMatchScoreLabel({
      live:true,
      finished:false,
      score:{home:true,away:0},
    }),
    '— : —',
  );

  assert.match(
    app,
    /function matchCenter\(m\) \{\s*return homeMatchScoreLabel\(m\);\s*\}/,
  );
});

test('quota is quiet until it is useful', () => {
  assert.match(html, /id="quotaText" hidden/);
  assert.match(profileSummary, /Number\(quota\.left\) <= 3 \|\| state\.profileStale/);
});

test('date context stays directly available without a duplicate overview headline', () => {
  assert.match(html, /data-offset="-1">Вчера/);
  assert.match(html, /data-offset="0">Сегодня/);
  assert.match(html, /data-offset="1">Завтра/);
  assert.doesNotMatch(html, /dailyOverviewKicker|dailyOverviewTitle|dailyOverviewText/);
});

test('focused-home capabilities are exposed by the current app manifest', () => {
  const runtime=createAppCapabilitiesRuntime({
    memory:{provider:{plan:'FREE'}},
    appVersion:'test',
    minClientVersion:'test',
    apiContractVersion:1,
    releaseChannel:'test',
    releaseCandidate:'test',
    paidQuotaHealthy:()=>false,
    providerPublicBudgetMode:()=>({
      mode:'normal',
      label:'Норма',
      liveRefreshSeconds:30,
    }),
    runtimeControlsSnapshot:()=>({
      maintenanceMode:false,
      liveEnabled:true,
      expandedDataEnabled:true,
    }),
    isSecurityLockdownControls:()=>false,
    publicRuntimeControls:value=>value,
    currentReleaseIdentity:()=>({}),
    now:()=>new Date('2026-10-07T18:00:00.000Z'),
  });

  const manifest=runtime.appManifest({});
  assert.equal(manifest.features.focusedMatchHome,true);
  assert.equal(manifest.features.contextualLeagueFilter,true);
});
