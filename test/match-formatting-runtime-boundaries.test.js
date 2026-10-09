import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createMatchFormattingRuntime } from '../src/match-formatting-runtime.js';

function assessLineupQuality(lineup) {
  const starters=Array.isArray(lineup?.startXI) ? lineup.startXI : [];
  return {
    state:starters.length===11 ? 'confirmed' : starters.length ? 'partial' : 'unavailable',
    score:starters.length,
    confirmed:starters.length===11,
    published:starters.length>0,
    partial:starters.length>0 && starters.length!==11,
    warnings:[],
  };
}

function normalizeFixtureAbsences(rows,{homeId,awayId}) {
  const list=Array.isArray(rows) ? rows : [];
  return {
    home:list.filter(item=>Number(item?.team?.id)===homeId),
    away:list.filter(item=>Number(item?.team?.id)===awayId),
    summary:{},
    resolvedByLineup:{home:[],away:[]},
    source:'test',
  };
}

function runtime(overrides={}) {
  return createMatchFormattingRuntime({
    assessLineupQuality,
    normalizeFixtureAbsences,
    ...overrides,
  });
}

test('match formatting fails fast and exposes an immutable runtime surface', () => {
  assert.throws(
    () => createMatchFormattingRuntime({assessLineupQuality}),
    /normalizeFixtureAbsences is required/,
  );

  assert.equal(Object.isFrozen(runtime()),true);
});

test('lineup formatting tolerates malformed containers and normalizes player identity fields', () => {
  const result=runtime().formatLineups([
    {
      team:{id:10},
      formation:'4-3-3',
      coach:{name:'Coach'},
      startXI:{unexpected:true},
      substitutes:null,
    },
    {
      team:{id:20},
      formation:{unexpected:true},
      startXI:[
        {
          player:{
            id:'2',
            name:'Player',
            number:'7',
            pos:'F',
            grid:'1:1',
          },
        },
        {
          player:{
            id:-1,
            name:{unexpected:true},
          },
        },
      ],
      substitutes:{unexpected:true},
    },
  ],10,20);

  assert.deepEqual(result.home.startXI,[]);
  assert.equal(result.home.quality.state,'unavailable');

  assert.equal(result.away.startXI.length,1);
  assert.deepEqual(result.away.startXI[0],{
    id:2,
    name:'Player',
    number:7,
    pos:'F',
    grid:'1:1',
    photo:'',
  });
});

test('invalid or duplicate fixture team context does not assign lineups to a side', () => {
  const live=runtime();

  assert.deepEqual(
    live.formatLineups([{team:{id:10},startXI:[]}],10,10),
    {home:null,away:null},
  );
  assert.deepEqual(
    live.formatLineups([{team:{id:10},startXI:[]}],1.5,20),
    {home:null,away:null},
  );
  assert.deepEqual(
    live.formatLineups([{team:{id:1},startXI:[]}],true,20),
    {home:null,away:null},
  );
  assert.deepEqual(
    live.formatLineups([{team:{id:10},startXI:[]}],[10],20),
    {home:null,away:null},
  );
});

test('H2H counts only finished matches for the requested pair with a real score', () => {
  const result=runtime().formatH2H([
    {
      fixture:{date:'2026-10-01T10:00:00Z',status:{short:'FT'}},
      teams:{
        home:{id:10,name:'A',winner:true},
        away:{id:20,name:'B',winner:false},
      },
      goals:{home:2,away:1},
    },
    {
      fixture:{date:'2026-10-02T10:00:00Z',status:{short:'NS'}},
      teams:{home:{id:10,name:'A'},away:{id:20,name:'B'}},
      goals:{home:null,away:null},
    },
    {
      fixture:{date:'2026-09-01T10:00:00Z',status:{short:'FT'}},
      teams:{home:{id:20,name:'B'},away:{id:10,name:'A'}},
      goals:{home:null,away:null},
    },
    {
      fixture:{date:'2026-08-01T10:00:00Z',status:{short:'FT'}},
      teams:{home:{id:30,name:'C'},away:{id:40,name:'D'}},
      goals:{home:0,away:0},
    },
    {
      fixture:{date:'2026-07-01T10:00:00Z',status:{short:'FT'}},
      teams:{home:{id:20,name:'B'},away:{id:10,name:'A'}},
      goals:{home:1,away:1},
    },
  ],10,20);

  assert.equal(result.homeWins,1);
  assert.equal(result.draws,1);
  assert.equal(result.awayWins,0);
  assert.deepEqual(
    result.matches.map(match=>match.score),
    ['2:1','1:1'],
  );
});

test('H2H honors provider winner flags for penalty shootout results', () => {
  const result=runtime().formatH2H([
    {
      fixture:{id:101,date:'2026-10-01T10:00:00Z',status:{short:'PEN'}},
      teams:{
        home:{id:10,name:'A',winner:false},
        away:{id:20,name:'B',winner:true},
      },
      goals:{home:1,away:1},
    },
  ],10,20);

  assert.equal(result.homeWins,0);
  assert.equal(result.draws,0);
  assert.equal(result.awayWins,1);
});

test('H2H ignores contradictory winner flags outside penalty shootouts and deduplicates fixture ids', () => {
  const duplicate={
    fixture:{
      id:202,
      date:'2026-09-01T10:00:00Z',
      status:{short:'FT'},
    },
    teams:{
      home:{id:10,name:'A',winner:true},
      away:{id:20,name:'B',winner:false},
    },
    goals:{home:1,away:1},
  };

  const result=runtime().formatH2H([
    duplicate,
    duplicate,
    {
      fixture:{
        id:203,
        date:'2026-08-01T10:00:00Z',
        status:{short:'FT'},
      },
      teams:{
        home:{id:10,name:'A',winner:false},
        away:{id:20,name:'B',winner:true},
      },
      goals:{home:2,away:0},
    },
  ],10,20);

  assert.equal(result.homeWins,1);
  assert.equal(result.draws,1);
  assert.equal(result.awayWins,0);
  assert.equal(result.matches.length,2);
});

test('status label never converts missing invalid or coercive elapsed time to zero', () => {
  const live=runtime();

  assert.equal(live.statusLabel('1H',null),'1-й тайм');
  assert.equal(live.statusLabel('2H',999),'2-й тайм');
  assert.equal(live.statusLabel('1H',0),'1-й тайм · 0′');
  assert.equal(live.statusLabel('1H','45'),'1-й тайм · 45′');
  assert.equal(live.statusLabel('1H',[45]),'1-й тайм');
  assert.equal(live.statusLabel('1H',true),'1-й тайм');
  assert.equal(live.statusLabel('FT',90),'Завершён');
});

test('live statistics ignore malformed rows, unknown teams and non-scalar values', () => {
  const result=runtime().formatLiveStatistics([
    {
      team:{id:10,name:'A'},
      statistics:{unexpected:true},
    },
    {
      team:{id:20,name:'B'},
      statistics:[
        {type:'Ball Possession',value:'45%'},
        {type:'Total Shots',value:Number.POSITIVE_INFINITY},
        {type:'x',value:{unexpected:true}},
      ],
    },
    {
      team:{id:99,name:'Other'},
      statistics:[
        {type:'Total Shots',value:999},
      ],
    },
  ],10,20);

  assert.deepEqual(result.home.values,{});
  assert.equal(result.away.values['Ball Possession'],'45%');
  assert.equal(result.away.values['Total Shots'],undefined);
  assert.deepEqual(
    result.items.map(item=>item.key),
    ['Ball Possession'],
  );
});

test('live events preserve unknown minute as null and sanitize unsafe fields', () => {
  const events=runtime().formatLiveEvents([
    {
      time:{elapsed:null,extra:null},
      team:{id:null,name:{unexpected:true}},
      player:{name:{unexpected:true}},
      type:'Goal',
      detail:'Normal Goal',
    },
    {
      time:{elapsed:-2,extra:-1},
      team:{id:10,name:'A'},
      type:'Card',
      detail:'Red Card',
    },
    {
      time:{elapsed:45,extra:2},
      team:{id:20,name:'B'},
      type:'subst',
      detail:'Substitution 1',
      comments:'ok',
    },
  ],10,20);

  assert.equal(events[0].minute,45);
  assert.equal(events[0].extra,2);
  assert.equal(events[0].side,'away');

  assert.equal(events[1].minute,null);
  assert.equal(events[1].teamId,null);
  assert.equal(events[1].teamName,'');

  assert.equal(events[2].minute,null);
  assert.equal(events[2].side,'home');
  assert.equal(events[2].label,'🟥 Красная карточка');
});

test('score snapshot preserves missing and partial score information without synthetic zeroes', () => {
  const live=runtime();

  assert.deepEqual(live.scoreSnapshot(null),{
    home:null,
    away:null,
    halftime:null,
    fulltime:null,
    extratime:null,
    penalty:null,
  });

  assert.deepEqual(
    live.scoreSnapshot({
      goals:{home:'x',away:-1},
      score:{
        halftime:{home:1,away:null},
        fulltime:{home:2,away:1.5},
      },
    }),
    {
      home:null,
      away:null,
      halftime:{home:1,away:null},
      fulltime:{home:2,away:null},
      extratime:null,
      penalty:null,
    },
  );

  assert.deepEqual(
    live.scoreSnapshot({
      goals:{home:'2',away:1},
      score:{
        halftime:{home:1,away:0},
        fulltime:{home:2,away:1},
      },
    }),
    {
      home:2,
      away:1,
      halftime:{home:1,away:0},
      fulltime:{home:2,away:1},
      extratime:null,
      penalty:null,
    },
  );

  assert.deepEqual(
    live.scoreSnapshot({
      goals:{home:true,away:[1]},
      score:{
        halftime:{home:{valueOf(){return 1;}},away:false},
      },
    }),
    {
      home:null,
      away:null,
      halftime:null,
      fulltime:null,
      extratime:null,
      penalty:null,
    },
  );
});

test('embedded live data safely returns empty arrays for malformed fixtures', () => {
  const live=runtime();

  assert.deepEqual(live.embeddedLiveData(null),{
    events:[],
    lineups:[],
    statistics:[],
    players:[],
  });

  assert.deepEqual(live.embeddedLiveData({
    events:{unexpected:true},
    lineups:null,
    statistics:[],
    players:'bad',
  }),{
    events:[],
    lineups:[],
    statistics:[],
    players:[],
  });
});

test('mutating exported status sets cannot alter internal status classification', () => {
  const live=runtime();

  assert.equal(live.isLiveStatus('1H'),true);
  live.LIVE_STATUSES.delete('1H');
  live.LIVE_STATUSES.add('FAKE');

  assert.equal(live.isLiveStatus('1H'),true);
  assert.equal(live.isLiveStatus('FAKE'),false);
});

test('worker keeps exact match-formatting dependency wiring', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const source=fs.readFileSync('src/match-formatting-runtime.js','utf8');

  assert.match(
    worker,
    /createMatchFormattingRuntime\(\{[\s\S]*?assessLineupQuality[\s\S]*?normalizeFixtureAbsences[\s\S]*?\}\);/,
  );
  assert.match(source,/if \(!isFinishedStatus\(finishedStatus\)\) continue;/);
  assert.match(source,/return Object\.freeze\(\{/);
});
