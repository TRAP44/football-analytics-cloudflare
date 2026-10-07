import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAnalysisController } from '../public/modules/analysis-controller.js';
import { createMatchCenterController } from '../public/modules/match-center-controller.js';
import {
  positiveEntityId,
  tournamentTabForTeamShortcut,
} from '../public/modules/entity-state-safety.js';

const app=fs.readFileSync('public/app.js','utf8');

function deferred() {
  let resolve;
  let reject;
  const promise=new Promise((res,rej)=>{
    resolve=res;
    reject=rej;
  });
  return {promise,resolve,reject};
}

test('opening Match Center invalidates an in-flight analysis before stale UI can render',async()=>{
  const pending=deferred();
  const state={
    profile:null,
    provider:null,
    runtimeStatus:null,
    currentCenter:null,
    currentCenterTab:'summary',
    analysisBackView:'matchesView',
    analysisActionPending:false,
    analysisRequestSeq:0,
    remindersLoaded:true,
    favoritesLoaded:true,
    clientPerf:{deduped:0},
  };
  let view='matchesView';
  const calls=[];

  const analysis=createAnalysisController({
    state,
    documentRef:{},
    activeViewId:()=>view,
    showView:id=>{
      view=id;
      calls.push(['view',id]);
    },
    api:async url=>{
      if (url.startsWith('/api/entitlements?')) return null;
      if (url==='/api/analyze') return pending.promise;
      throw new Error('unexpected analysis api');
    },
    runtimeAllows:()=>true,
    stopLiveRefresh:()=>{},
    hideQuotaPaywall:()=>{},
    showQuotaPaywallForFixture:()=>{},
    syncAnalysisBusyUi:()=>{},
    renderJourneyState:()=>{},
    renderAnalysis:data=>calls.push(['analysis-render',data]),
    renderMatchCenter:()=>{},
    rememberHistoryAnalysis:data=>calls.push(['history',data]),
    renderProfile:()=>{},
    renderProvider:()=>{},
    renderDiscoveryHome:()=>{},
    renderGlobalSearch:()=>{},
    loadHistory:async()=>{},
    loadReminders:async()=>{},
    loadFavorites:async()=>{},
    buildAnalysisAccessUsage:()=>null,
    refreshPassAccess:async()=>{},
    isAdmin:()=>false,
    sendProductAction:()=>{},
    sendOperationTiming:()=>{},
    sendActionError:()=>{},
    apiErrorCategory:()=>'error',
    toast:()=>{},
    performanceNow:()=>100,
  });

  const matchCenter=createMatchCenterController({
    state,
    documentRef:{hidden:false},
    elementById:()=>null,
    activeViewId:()=>view,
    showView:id=>{view=id;},
    api:async()=>({
      mode:'upcoming',
      match:{fixtureId:8},
    }),
    runtimeAllows:()=>true,
    ensureMatchCenterExtras:async()=>{},
    renderMatchCenter:data=>{
      state.currentCenter=data;
      calls.push(['center-render',data]);
    },
    renderJourneyState:()=>{},
    sendProductAction:()=>{},
    sendMatchDataCoverage:()=>{},
    sendOperationTiming:()=>{},
    sendActionError:()=>{},
    apiErrorCategory:()=>'error',
    friendlyErrorMessage:()=>'error',
    toast:()=>{},
    performanceNow:()=>100,
    setTimer:()=>1,
    clearTimer:()=>{},
  });

  const analysisTask=analysis.analyzeMatch(7,null);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.analysisActionPending,true);
  const analysisSeq=state.analysisRequestSeq;

  await matchCenter.openMatchCenter(8,null);
  assert.ok(state.analysisRequestSeq>analysisSeq);
  assert.equal(state.currentCenter.match.fixtureId,8);

  pending.resolve({match:{fixtureId:7}});
  await analysisTask;

  assert.equal(state.analysisActionPending,false);
  assert.equal(
    calls.some(row=>row[0]==='analysis-render'),
    false,
  );
  assert.ok(
    calls.some(row=>row[0]==='center-render'),
  );
  assert.ok(
    calls.some(row=>row[0]==='history'),
  );
});

test('entity ids used by interaction guards reject coercive values',()=>{
  assert.equal(positiveEntityId(7),7);
  assert.equal(positiveEntityId('7'),7);

  for (const value of [
    true,
    false,
    [7],
    {valueOf(){return 7;}},
    1.5,
    -1,
    0,
    '7.0',
    'x',
  ]) {
    assert.equal(positiveEntityId(value),0,String(value));
  }
});

test('favorite mutations are deduplicated and identity-checked per team',()=>{
  const block=app.match(
    /function favoriteSet\(\)[\s\S]*?async function toggleFavorite\(team\)[\s\S]*?\n}\n\n\nfunction storageGet/,
  );
  assert.ok(block,'favorite interaction block must exist');
  const source=block[0];

  assert.match(
    app,
    /favoriteMutations:\s*new Set\(\)/,
  );
  assert.match(
    source,
    /const teamId = positiveEntityId\(team\?\.id\)/,
  );
  assert.match(
    source,
    /state\.favoriteMutations\.has\(teamId\)/,
  );
  assert.match(
    source,
    /state\.favoriteMutations\.add\(teamId\)/,
  );
  assert.match(
    source,
    /state\.favoriteMutations\.delete\(teamId\)/,
  );
  assert.match(
    source,
    /positiveEntityId\(item\.teamId\) !== teamId/,
  );
  assert.match(
    source,
    /uiErrorMessage\(e, 'Не удалось изменить избранное\.'\)/,
  );
  assert.doesNotMatch(
    source,
    /const teamId = Number\(/,
  );
});

test('reminder mutations are deduplicated, fail closed on controls and validate returned fixture identity',()=>{
  const block=app.match(
    /function reminderFor\(fixtureId\)[\s\S]*?async function toggleReminder\(match\)[\s\S]*?\n}\n\nfunction clampPercent/,
  );
  assert.ok(block,'reminder interaction block must exist');
  const source=block[0];

  assert.match(
    app,
    /reminderMutations:\s*new Set\(\)/,
  );
  assert.match(
    source,
    /const fixtureId = positiveEntityId\(match\?\.fixtureId\)/,
  );
  assert.match(
    source,
    /state\.reminderMutations\.has\(fixtureId\)/,
  );
  assert.match(
    source,
    /state\.reminderMutations\.add\(fixtureId\)/,
  );
  assert.match(
    source,
    /state\.reminderMutations\.delete\(fixtureId\)/,
  );
  assert.match(
    source,
    /runtimeAllows\('remindersEnabled'\) === true/,
  );
  assert.match(
    source,
    /positiveEntityId\(item\.fixtureId\) !== fixtureId/,
  );
  assert.doesNotMatch(
    source,
    /const fixtureId = Number\(match\.fixtureId\)/,
  );
});

test('transient profile refresh failure preserves the last authenticated profile without coercing error metadata',()=>{
  const block=app.match(
    /async function loadProfile\(\)[\s\S]*?\n}\n\nfunction isAdmin/,
  );
  assert.ok(block,'loadProfile must exist');
  const source=block[0];

  assert.match(
    source,
    /const previousProfile = state\.profile/,
  );
  assert.match(
    source,
    /if \(previousProfile[\s\S]*?!authFailure\)/,
  );
  assert.match(
    source,
    /state\.profile = previousProfile/,
  );
  assert.match(
    source,
    /state\.profileStale = true/,
  );
  assert.match(
    source,
    /typeof e\?\.status === 'number'/,
  );
  assert.match(
    source,
    /uiErrorMessage\(e, 'Не удалось загрузить профиль\.'\)/,
  );
  assert.doesNotMatch(
    source,
    /Number\(e\?\.status/,
  );
});

test('team standing shortcut targets the actual primary competition table',()=>{
  assert.equal(
    tournamentTabForTeamShortcut(true),
    'table',
  );
  assert.equal(
    tournamentTabForTeamShortcut(false),
    'matches',
  );

  const block=app.match(
    /function openTournamentFromTeam\(openTable = false\)[\s\S]*?\n}/,
  );
  assert.ok(block,'team tournament shortcut must exist');
  const source=block[0];

  assert.match(app,/id="teamStandingTableBtn"/);
  assert.match(
    app,
    /openTournamentFromTeam\(true\)/,
  );
  assert.match(
    source,
    /tournamentTabForTeamShortcut\(openTable\)/,
  );
  assert.match(
    source,
    /const leagueId=positiveEntityId\(comp\?\.leagueId\)/,
  );
  assert.match(
    source,
    /setTournamentTab\(targetTab,targetTab==='table'\)/,
  );
  assert.doesNotMatch(
    app,
    /data-open-tournament="1"/,
  );
});

test('app delegates analysis and Match Center concurrency to dedicated controllers',()=>{
  assert.match(
    app,
    /ensureAnalysisController\(\)/,
  );
  assert.match(
    app,
    /ensureMatchCenterController\(\)/,
  );
  assert.doesNotMatch(
    app,
    /const matchCenterInFlight/,
  );
  assert.doesNotMatch(
    app,
    /let liveRefreshTimer/,
  );
  assert.match(
    app,
    /analysisActionPending:\s*false/,
  );
});
