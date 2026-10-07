import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createLiveMatchIntelligenceRuntime } from '../src/live-match-intelligence-runtime.js';
import { createMarketParsingRuntime } from '../src/market-parsing-runtime.js';

const marketParsing=createMarketParsingRuntime();

function runtime(overrides={}) {
  return createLiveMatchIntelligenceRuntime({
    numericValue:marketParsing.numericValue,
    ...overrides,
  });
}

test('live intelligence requires numeric parsing and exposes an immutable surface', () => {
  assert.throws(
    () => createLiveMatchIntelligenceRuntime({}),
    /numericValue is required/,
  );
  assert.equal(Object.isFrozen(runtime()),true);
});

test('player leaders reject malformed containers, unsafe ids and negative statistics', () => {
  const live=runtime();

  assert.deepEqual(
    live.formatPlayerLeaders({unexpected:true},10,11),
    {home:[],away:[]},
  );
  assert.deepEqual(
    live.formatPlayerLeaders([],1.5,11),
    {home:[],away:[]},
  );

  const result=live.formatPlayerLeaders([
    {
      team:{id:10},
      players:[
        {
          player:{id:1,name:'Valid'},
          statistics:[{
            games:{rating:'8.1',minutes:90},
            goals:{total:1,assists:1,saves:0},
            shots:{on:3},
            passes:{key:2},
            tackles:{total:1,interceptions:1},
          }],
        },
        {
          player:{id:2,name:'Invalid'},
          statistics:[{
            games:{rating:-5,minutes:-20},
            goals:{total:-2,assists:-1},
            shots:{on:-3},
          }],
        },
      ],
    },
    {
      team:{id:11},
      players:{unexpected:true},
    },
  ],10,11);

  assert.equal(result.home.length,1);
  assert.equal(result.home[0].name,'Valid');
  assert.equal(result.home[0].rating,8.1);
  assert.equal(result.away.length,0);
});

test('live pressure only compares paired valid metrics', () => {
  const live=runtime();

  const polluted=live.livePressure({items:[
    {key:'Total Shots',home:-50,away:10},
    {key:'Shots on Goal',home:-10,away:4},
    {key:'Ball Possession',home:500,away:45},
    {key:'Corner Kicks',home:-3,away:4},
    {key:'Goalkeeper Saves',home:-1,away:2},
    {key:'Red Cards',home:-1,away:0},
  ]});
  assert.equal(polluted,null);

  const mixed=live.livePressure({items:[
    {key:'Total Shots',home:12,away:7},
    {key:'Shots on Goal',home:-1,away:3},
    {key:'Ball Possession',home:'58%',away:'42%'},
  ]});

  assert.ok(mixed);
  assert.equal(mixed.home+mixed.away,100);
  assert.equal(mixed.leader,'home');
});

test('derived pressure direction cannot be overridden by contradictory metadata', () => {
  const live=runtime();

  assert.equal(
    live.livePerformanceSide({
      statistics:{items:[]},
      pressure:{home:70,away:30,leader:'away'},
    }),
    'home',
  );

  const coach=live.buildLiveAiCoach({
    statistics:{items:[]},
    events:[],
    pressure:{home:70,away:30,leader:'away'},
    score:{home:null,away:null},
    elapsed:30,
    homeName:'Home',
    awayName:'Away',
    smartInsights:{available:true,dataScore:50},
    prematch:null,
  });

  assert.equal(coach.current.performanceSide,'home');
  assert.equal(coach.current.pressureLeaderLabel,'Home');
});

test('statistics and recent-event helpers fail closed on malformed boundaries', () => {
  const live=runtime();

  assert.equal(
    live.smartStat({items:{unexpected:true}},'Total Shots','home'),
    null,
  );
  assert.equal(
    live.smartStat({items:[{key:'Ball Possession',home:150}]},'Ball Possession','home'),
    null,
  );
  assert.equal(
    live.smartStat({items:[{key:'Total Shots',home:'0x10'}]},'Total Shots','home'),
    null,
  );
  assert.equal(
    live.smartStat({items:[{key:'Total Shots',home:'1e2'}]},'Total Shots','home'),
    null,
  );
  assert.equal(
    live.recentEventSummary(
      [{minute:0,side:'home',type:'goal'}],
      null,
      'Home',
      'Away',
    ),
    null,
  );
  assert.equal(
    live.recentEventSummary(
      [{side:'home',type:'goal'}],
      60,
      'Home',
      'Away',
    ),
    null,
  );

  const recent=live.recentEventSummary(
    [{minute:55,side:'home',type:'goal'}],
    60,
    'Home',
    'Away',
  );
  assert.equal(recent.leader,'home');
});

test('live market shift requires a coherent complete 1X2 probability delta and reports the positive mover', () => {
  const live=runtime();

  assert.equal(
    live.liveMarketShift({
      probabilityChange:{home:'4.2',draw:'bad',away:'-4.2'},
    }),
    null,
  );
  assert.equal(
    live.liveMarketShift({
      probabilityChange:{home:10,draw:10,away:10},
    }),
    null,
  );

  assert.deepEqual(
    live.liveMarketShift({
      probabilityChange:{home:'4.25',draw:'-1.2',away:'-3.05'},
    }),
    {side:'home',delta:4.3},
  );

  // The largest absolute move is away -8, but the market moved toward
  // home/draw (+4 each). Reporting "toward away: -8" is semantically wrong.
  assert.deepEqual(
    live.liveMarketShift({
      probabilityChange:{home:4,draw:4,away:-8},
    }),
    {side:'home',delta:4},
  );
});

test('live coach does not invent a nil-nil score when score is unavailable', () => {
  const live=runtime();
  const statistics={items:[
    {key:'expected_goals',home:.3,away:.4},
    {key:'Total Shots',home:3,away:4},
    {key:'Shots on Goal',home:1,away:1},
  ]};

  const missing=live.buildLiveAiCoach({
    statistics,
    events:[],
    score:{home:null,away:null},
    elapsed:70,
    homeName:'Home',
    awayName:'Away',
    smartInsights:{available:true,dataScore:70},
    prematch:{
      aiInstructor:{
        betSignal:{code:' OVER25 ',label:'ТБ 2.5'},
      },
    },
  });

  assert.equal(missing.current.scoreKnown,false);
  assert.equal(missing.state,'shifted');
  assert.ok(Number.isFinite(missing.confidence));

  const knownZero=live.buildLiveAiCoach({
    statistics,
    events:[],
    score:{home:0,away:0},
    elapsed:70,
    homeName:'Home',
    awayName:'Away',
    smartInsights:{available:true,dataScore:70},
    prematch:{
      aiInstructor:{
        betSignal:{code:'over25',label:'ТБ 2.5'},
      },
    },
  });

  assert.equal(knownZero.current.scoreKnown,true);
  assert.equal(knownZero.state,'weakened');
});

test('smart match insights do not count future-only events as current evidence', () => {
  const live=runtime();

  const result=live.buildSmartMatchInsights({
    statistics:{items:[]},
    events:[
      {minute:70,side:'home',type:'goal',detail:'Normal Goal'},
    ],
    pressure:null,
    score:{home:null,away:null},
    elapsed:60,
    status:'2H',
    homeName:'Home',
    awayName:'Away',
    playerLeaders:{home:[],away:[]},
    absences:{home:[],away:[]},
  });

  assert.equal(result.available,false);
  assert.equal(result.dataScore,0);
  assert.equal(result.insights.length,0);
});

test('smart match insights tolerate malformed arrays and suppress score-derived claims without score', () => {
  const live=runtime();

  const result=live.buildSmartMatchInsights({
    statistics:{items:[
      {key:'expected_goals',home:2.1,away:.3},
      {key:'Total Shots',home:15,away:5},
      {key:'Shots on Goal',home:7,away:1},
    ]},
    events:{unexpected:true},
    pressure:{home:150,away:-50,leader:'home'},
    score:{home:null,away:null},
    elapsed:60,
    homeName:'Home',
    awayName:'Away',
    playerLeaders:{
      home:[{name:{unexpected:true},rating:8.2,goals:'bad',assists:-1}],
      away:[],
    },
    absences:{
      home:'not-an-array',
      away:{unexpected:true},
    },
  });

  const types=result.insights.map(item=>item.type);
  assert.equal(result.scoreKnown,false);
  assert.equal(result.minute,60);
  assert.equal(types.includes('score_mismatch'),false);
  assert.equal(types.includes('finishing'),false);
  assert.ok(Number.isFinite(result.dataScore));
});

test('worker wires numericValue into live intelligence runtime', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const source=fs.readFileSync('src/live-match-intelligence-runtime.js','utf8');

  assert.match(
    worker,
    /createLiveMatchIntelligenceRuntime\(\{[\s\S]*?numericValue[\s\S]*?\}\);/,
  );
  assert.match(source,/function normalizedPressure/);
  assert.match(source,/const scoreKnown=/);
  assert.match(source,/return Object\.freeze\(\{/);
});
