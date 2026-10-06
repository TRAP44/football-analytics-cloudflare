import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createRefereeIntelligenceRuntime } from '../src/referee-intelligence-runtime.js';

function deps(overrides = {}) {
  return {
    hasSupabase:()=>false,
    memory:{refereeMatchHistory:new Map()},
    numericValue:value=>{
      if (value === null || value === undefined || value === '') return null;
      const number=Number(String(value).replace('%','').trim());
      return Number.isFinite(number) ? number : null;
    },
    supaSelectMany:async()=>[],
    supaUpsert:async()=>{},
    ...overrides,
  };
}

function statistics(home = 10, away = 12) {
  return {
    items:[
      {key:'Shots',home:5,away:6},
      {key:'Fouls',home,away},
    ],
  };
}

test('referee intelligence validates dependencies, memory shape and freezes exports', () => {
  const broken=deps();
  delete broken.numericValue;
  assert.throws(
    () => createRefereeIntelligenceRuntime(broken),
    /numericValue is required/,
  );

  assert.throws(
    () => createRefereeIntelligenceRuntime(deps({
      memory:{refereeMatchHistory:[]},
    })),
    /refereeMatchHistory must be a Map/,
  );

  assert.equal(Object.isFrozen(createRefereeIntelligenceRuntime(deps())),true);
});

test('referee profile normalizes bounded scalar input and rejects object coercion', () => {
  const runtime=createRefereeIntelligenceRuntime(deps());

  assert.deepEqual(runtime.refereeProfile({
    name:'should not stringify',
  }),{
    name:'',
    country:'',
    available:false,
  });

  assert.deepEqual(
    runtime.refereeProfile('  John\tDoe  ,  England  '),
    {name:'John Doe',country:'England',available:true},
  );
  assert.equal(runtime.refereeHistoryKey(' JOHN   DOE, England '),'john doe');
});

test('card summary tolerates malformed collections and only verifies complete evidence', () => {
  const runtime=createRefereeIntelligenceRuntime(deps());

  assert.deepEqual(runtime.refereeCardSummary({unexpected:true},{items:{}}),{
    yellow:0,
    red:0,
    fouls:0,
    observedCards:false,
    observedFouls:false,
    verified:false,
  });

  const summary=runtime.refereeCardSummary([
    {type:'Goal',detail:'Normal Goal'},
    {type:'Card',detail:'Yellow Card'},
    {type:'Card',detail:'Second Yellow card'},
    {type:'Card',detail:'Red Card'},
  ],statistics('11','9'));

  assert.equal(summary.yellow,1);
  assert.equal(summary.red,2);
  assert.equal(summary.fouls,20);
  assert.equal(summary.observedCards,true);
  assert.equal(summary.observedFouls,true);
  assert.equal(summary.verified,true);
});

test('verified zero-card matches are persisted so averages are not biased upward', async () => {
  const memory={refereeMatchHistory:new Map()};
  const runtime=createRefereeIntelligenceRuntime(deps({memory}));

  const saved=await runtime.saveRefereeMatchHistory({
    fixtureId:100,
    referee:'John Doe, England',
    kickoffAt:'2026-10-01T18:00:00Z',
    leagueId:39,
    events:[{type:'Goal',detail:'Normal Goal'}],
    statistics:statistics(0,0),
  },{});

  assert.equal(saved,true);
  const row=memory.refereeMatchHistory.get(100);
  assert.equal(row.yellow_cards,0);
  assert.equal(row.red_cards,0);
  assert.equal(row.fouls,0);
  assert.equal(row.referee_key,'john doe');
});

test('history writes reject unsafe identity, invalid dates and partial evidence', async () => {
  const memory={refereeMatchHistory:new Map()};
  const runtime=createRefereeIntelligenceRuntime(deps({memory}));

  assert.equal(await runtime.saveRefereeMatchHistory({
    fixtureId:1.5,
    referee:'John Doe, England',
    kickoffAt:'2026-10-01T18:00:00Z',
    events:[{type:'Card',detail:'Yellow Card'}],
    statistics:statistics(),
  },{}),false);

  assert.equal(await runtime.saveRefereeMatchHistory({
    fixtureId:100,
    referee:'John Doe, England',
    kickoffAt:'not-a-date',
    events:[{type:'Card',detail:'Yellow Card'}],
    statistics:statistics(),
  },{}),false);

  assert.equal(await runtime.saveRefereeMatchHistory({
    fixtureId:100,
    referee:'John Doe, England',
    kickoffAt:'2026-10-01T18:00:00Z',
    events:[],
    statistics:statistics(),
  },{}),false);

  assert.equal(memory.refereeMatchHistory.size,0);
});

test('memory upserts preserve created_at while refreshing verified metrics', async () => {
  const memory={refereeMatchHistory:new Map()};
  const runtime=createRefereeIntelligenceRuntime(deps({memory}));

  await runtime.saveRefereeMatchHistory({
    fixtureId:100,
    referee:'John Doe, England',
    kickoffAt:'2026-10-01T18:00:00Z',
    leagueId:39,
    events:[{type:'Card',detail:'Yellow Card'}],
    statistics:statistics(10,12),
  },{});
  const first=memory.refereeMatchHistory.get(100);

  await runtime.saveRefereeMatchHistory({
    fixtureId:100,
    referee:'John Doe, England',
    kickoffAt:'2026-10-01T18:00:00Z',
    leagueId:39,
    events:[
      {type:'Card',detail:'Yellow Card'},
      {type:'Card',detail:'Red Card'},
    ],
    statistics:statistics(11,13),
  },{});
  const second=memory.refereeMatchHistory.get(100);

  assert.equal(second.created_at,first.created_at);
  assert.equal(second.yellow_cards,1);
  assert.equal(second.red_cards,1);
  assert.equal(second.fouls,24);
});

test('Supabase persistence writes only normalized verified history rows', async () => {
  const writes=[];
  const runtime=createRefereeIntelligenceRuntime(deps({
    hasSupabase:()=>true,
    supaUpsert:async(...args)=>writes.push(args),
  }));

  const saved=await runtime.saveRefereeMatchHistory({
    fixtureId:'100',
    referee:' John Doe , England ',
    kickoffAt:'2026-10-01T18:00:00+00:00',
    leagueId:'39',
    events:[{type:'Card',detail:'Yellow Card'}],
    statistics:statistics(10,12),
  },{});

  assert.equal(saved,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0][1],'referee_match_history');
  assert.equal(writes[0][3],'fixture_id');
  assert.deepEqual({
    fixture_id:writes[0][2].fixture_id,
    referee_key:writes[0][2].referee_key,
    kickoff_at:writes[0][2].kickoff_at,
    league_id:writes[0][2].league_id,
    yellow_cards:writes[0][2].yellow_cards,
    red_cards:writes[0][2].red_cards,
    fouls:writes[0][2].fouls,
  },{
    fixture_id:100,
    referee_key:'john doe',
    kickoff_at:'2026-10-01T18:00:00.000Z',
    league_id:39,
    yellow_cards:1,
    red_cards:0,
    fouls:22,
  });
});

test('history profile filters corrupt, future, wrong-referee and duplicate fixture rows', async () => {
  const memory={refereeMatchHistory:new Map([
    [1,{fixture_id:1,referee_key:'john doe',referee_name:'John Doe',referee_country:'England',kickoff_at:'2026-10-01T18:00:00Z',yellow_cards:2,red_cards:0,fouls:20}],
    [2,{fixture_id:2,referee_key:'john doe',referee_name:'John Doe',referee_country:'England',kickoff_at:'2026-09-25T18:00:00Z',yellow_cards:4,red_cards:1,fouls:30}],
    [3,{fixture_id:3,referee_key:'john doe',referee_name:'John Doe',referee_country:'England',kickoff_at:'2026-09-20T18:00:00Z',yellow_cards:0,red_cards:0,fouls:10}],
    [4,{fixture_id:4,referee_key:'another ref',referee_name:'Another Ref',referee_country:'England',kickoff_at:'2026-09-18T18:00:00Z',yellow_cards:10,red_cards:3,fouls:60}],
    [5,{fixture_id:5,referee_key:'john doe',referee_name:'John Doe',referee_country:'England',kickoff_at:'2099-01-01T00:00:00Z',yellow_cards:10,red_cards:2,fouls:50}],
    [6,{fixture_id:6,referee_key:'john doe',referee_name:'John Doe',referee_country:'England',kickoff_at:'2026-09-10T18:00:00Z',yellow_cards:'bad',red_cards:0,fouls:20}],
    [7,{fixture_id:7,referee_key:'john doe',referee_name:'John Doe',referee_country:'Scotland',kickoff_at:'2026-09-09T18:00:00Z',yellow_cards:9,red_cards:2,fouls:45}],
  ])};
  const runtime=createRefereeIntelligenceRuntime(deps({memory}));

  const profile=await runtime.loadRefereeHistoryProfile('John Doe, England',{},30);

  assert.equal(profile.available,true);
  assert.equal(profile.sample,3);
  assert.equal(profile.avgYellow,2);
  assert.equal(profile.avgRed,0.3);
  assert.equal(profile.avgFouls,20);
  assert.equal(profile.avgCards,2.3);
  assert.equal(profile.styleLabel,'Сдержанный стиль');
  assert.equal(profile.source,'verified-match-history');
});

test('Supabase history reads bound hostile limits and fail soft on storage errors', async () => {
  const calls=[];
  const runtime=createRefereeIntelligenceRuntime(deps({
    hasSupabase:()=>true,
    supaSelectMany:async(...args)=>{
      calls.push(args);
      return [];
    },
  }));

  const empty=await runtime.loadRefereeHistoryProfile('John Doe, England',{},1);
  assert.equal(empty.available,false);
  assert.equal(calls[0][3].limit,3);

  await runtime.loadRefereeHistoryProfile('John Doe, England',{},999999);
  assert.equal(calls[1][3].limit,50);

  const failing=createRefereeIntelligenceRuntime(deps({
    hasSupabase:()=>true,
    supaSelectMany:async()=>{ throw new Error('database unavailable'); },
  }));
  const degraded=await failing.loadRefereeHistoryProfile('John Doe, England',{},30);
  assert.deepEqual(degraded,{
    available:false,
    sample:0,
    name:'John Doe',
    country:'England',
  });
});

test('worker keeps referee intelligence dependencies explicit', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const source=fs.readFileSync('src/referee-intelligence-runtime.js','utf8');

  assert.match(
    worker,
    /createRefereeIntelligenceRuntime\(\{[\s\S]*?hasSupabase,[\s\S]*?memory,[\s\S]*?numericValue,[\s\S]*?supaSelectMany,[\s\S]*?supaUpsert,[\s\S]*?\}\);/,
  );
  assert.match(source,/const requiredFunctions=\{/);
  assert.match(source,/memory\.refereeMatchHistory instanceof Map/);
  assert.match(source,/return Object\.freeze\(\{/);
});
