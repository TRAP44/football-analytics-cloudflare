import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';
import { createLiveMatchIntelligenceRuntime } from '../src/live-match-intelligence-runtime.js';
import { createMarketParsingRuntime } from '../src/market-parsing-runtime.js';

const marketParsing=createMarketParsingRuntime();

function liveRuntime(overrides={}) {
  return createLiveMatchIntelligenceRuntime({
    numericValue:marketParsing.numericValue,
    ...overrides,
  });
}

const app=fs.readFileSync('public/app.js','utf8');
const matchCenter=fs.readFileSync('src/match-center-runtime.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC44 builds a behavioral AI LIVE coach from trusted current-match evidence',()=>{
  const live=liveRuntime();
  const result=live.buildLiveAiCoach({
    statistics:{items:[
      {key:'expected_goals',home:.2,away:1.5},
      {key:'Shots on Goal',home:1,away:5},
      {key:'Red Cards',home:0,away:0},
    ]},
    events:[
      {minute:55,side:'away',type:'goal',detail:'Normal Goal'},
    ],
    pressure:{home:30,away:70,leader:'away'},
    score:{home:0,away:1},
    elapsed:60,
    homeName:'Home',
    awayName:'Away',
    smartInsights:{available:true,dataScore:80},
    prematch:{
      aiInstructor:{
        betSignal:{code:'home',label:'П1'},
        verdict:{outcome:'П1 · 62%'},
        confidenceScore:72,
      },
    },
  });

  assert.equal(result.available,true);
  assert.equal(result.state,'broken');
  assert.equal(result.action.code,'avoid');
  assert.equal(
    result.action.label,
    'Не опираться на предматчевый вывод',
  );
  assert.equal(result.current.performanceSide,'away');
  assert.equal(result.current.scoreKnown,true);
  assert.ok(result.watchNext.length>0);
});

test('RC44 ignores provider events that are timestamped after the current live minute',()=>{
  const live=liveRuntime();

  const recent=live.recentEventSummary(
    [{minute:70,side:'away',type:'goal',detail:'Normal Goal'}],
    60,
    'Home',
    'Away',
  );
  assert.equal(recent,null);

  const result=live.buildLiveAiCoach({
    statistics:{items:[
      {key:'expected_goals',home:.5,away:.5},
      {key:'Shots on Goal',home:2,away:2},
      {key:'Red Cards',home:0,away:0},
    ]},
    events:[
      {minute:70,side:'away',type:'card',detail:'Red Card'},
    ],
    pressure:{home:50,away:50,leader:'balanced'},
    score:{home:0,away:0},
    elapsed:60,
    homeName:'Home',
    awayName:'Away',
    smartInsights:{available:true,dataScore:80},
    prematch:{
      aiInstructor:{
        betSignal:{code:'skip',label:'Пропустить ставку'},
      },
    },
  });

  assert.equal(result.volatility.label,'Умеренный');
  assert.equal(
    result.watchNext.some(item=>/красн|удален/i.test(item)),
    false,
  );

  const futureOnly=live.buildLiveAiCoach({
    statistics:{items:[]},
    events:[
      {minute:70,side:'home',type:'goal',detail:'Normal Goal'},
    ],
    pressure:null,
    score:{home:null,away:null},
    elapsed:60,
    homeName:'Home',
    awayName:'Away',
    smartInsights:{available:false,dataScore:0},
    prematch:null,
  });
  assert.equal(futureOnly.available,false);
});

test('RC44 numeric boundaries do not coerce arrays or booleans into live metrics',()=>{
  const live=liveRuntime();

  assert.equal(
    live.smartStat(
      {items:[{key:'Ball Possession',home:['58'],away:'42%'}]},
      'Ball Possession',
      'home',
    ),
    null,
  );
  assert.equal(
    live.smartStat(
      {items:[{key:'Shots on Goal',home:true,away:2}]},
      'Shots on Goal',
      'home',
    ),
    null,
  );

  const pressure=live.livePressure({items:[
    {key:'Total Shots',home:['12'],away:8},
    {key:'Shots on Goal',home:4,away:3},
  ]});
  assert.ok(pressure);
  assert.equal(pressure.home+pressure.away,100);
});

test('RC44 keeps low-data and scenario guards explicit',()=>{
  const live=liveRuntime();
  const result=live.buildLiveAiCoach({
    statistics:{items:[]},
    events:[],
    pressure:null,
    score:{home:null,away:null},
    elapsed:10,
    homeName:'Home',
    awayName:'Away',
    smartInsights:{available:true,dataScore:20},
    prematch:{
      aiInstructor:{
        betSignal:{code:'away',label:'П2'},
      },
    },
  });

  assert.equal(result.current.scoreKnown,false);
  assert.equal(result.action.code,'wait');
  assert.equal(result.action.label,'Ждать больше данных');
  assert.ok(result.confidence>=20);
});

test('RC44 frontend never renders an unknown LIVE score as fabricated 0:0',()=>{
  const start=app.indexOf('function liveAiCoachHtml');
  const end=app.indexOf('function postMatchReviewHtml',start);
  assert.ok(start>=0 && end>start);
  const source=app.slice(start,end);

  assert.match(source,/ai\.current\?\.scoreKnown === true/);
  assert.match(source,/const scoreText = scoreKnown/);
  assert.match(source,/: '—:—'/);
  assert.doesNotMatch(source,/match\.score\?\.home \?\? 0/);
  assert.match(source,/currentMinute !== null/);
});

test('RC44 Match Center only constructs AI LIVE for live mode and suppresses stale live intelligence',()=>{
  assert.match(matchCenter,/let liveAiCoach=null;[\s\S]*if \(live\) \{/);
  assert.match(matchCenter,/liveAiCoach=objectValue\(buildLiveAiCoach\(\{/);
  assert.match(
    matchCenter,
    /getStaleCache,[\s\S]*fixture:\$\{fixtureId\}:v17-starting-xi-rc146/,
  );
  assert.match(
    matchCenter,
    /suppressLiveSignals[\s\S]*liveAiCoach:null/,
  );
  assert.match(css,/\.live-ai-coach/);
});

test('RC44 live AI capabilities are exposed through the current app manifest',()=>{
  const capabilities=createAppCapabilitiesRuntime({
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

  const manifest=capabilities.appManifest({});
  assert.equal(manifest.features.aiLiveCoach,true);
  assert.equal(manifest.features.prematchLiveComparison,true);
  assert.equal(manifest.features.liveScenarioGuard,true);
});
