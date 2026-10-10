import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createAnalysisLifecycleRuntime } from '../src/analysis-lifecycle-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function deps(overrides = {}) {
  return {
    hasSupabase:()=>false,
    isFinishedStatus:status=>String(status || '').toUpperCase()==='FT',
    isLiveStatus:status=>['1H','2H','HT','ET','P'].includes(String(status || '').toUpperCase()),
    memory:{history:new Map()},
    supaSelectOne:async()=>null,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    generatedAt:'2026-09-23T17:58:00Z',
    match:{
      fixtureId:71,
      date:'2026-09-23T18:30:00Z',
      status:'NS',
      referee:'Ref A',
    },
    probabilities:{home:50,draw:30,away:20},
    market:{probabilities:{home:48,draw:31,away:21}},
    lineupImpact:{homeConfirmed:true,awayConfirmed:true},
    absences:{home:[],away:[]},
    aiInstructor:{
      betSignal:{code:'home',label:'П1'},
      confidenceScore:70,
    },
    ...overrides,
  };
}

test('analysis lifecycle validates dependencies, memory shape and freezes exports', () => {
  const broken=deps();
  delete broken.supaSelectOne;
  assert.throws(
    () => createAnalysisLifecycleRuntime(broken),
    /supaSelectOne is required/,
  );

  assert.throws(
    () => createAnalysisLifecycleRuntime(deps({memory:{history:[]}})),
    /memory\.history must be a Map/,
  );

  assert.equal(Object.isFrozen(createAnalysisLifecycleRuntime(deps())),true);
});

test('freshness trusts quality metadata instead of counting ten-player lineups', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const now=Date.parse('2026-09-23T18:00:00Z');

  const legacyTen=runtime.analysisFreshness({
    generatedAt:'2026-09-23T17:52:00Z',
    match:{date:'2026-09-23T18:30:00Z',status:'NS'},
    lineups:{
      home:{startXI:Array.from({length:10},(_,i)=>({id:i+1}))},
      away:{startXI:Array.from({length:10},(_,i)=>({id:i+20}))},
    },
  },now);
  assert.equal(legacyTen.lineupsConfirmed,false);
  assert.equal(legacyTen.reasonCode,'lineups_window');

  const trusted=runtime.analysisFreshness({
    generatedAt:'2026-09-23T17:52:00Z',
    match:{date:'2026-09-23T18:30:00Z',status:'NS'},
    lineupImpact:{homeConfirmed:true,awayConfirmed:true},
  },now);
  assert.equal(trusted.lineupsConfirmed,true);
  assert.equal(trusted.reasonCode,'age_window');
});

test('future or invalid generation timestamps force a recheck', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const now=Date.parse('2026-09-23T18:00:00Z');

  const future=runtime.analysisFreshness({
    generatedAt:'2026-09-24T18:00:00Z',
    match:{date:'2026-09-25T18:00:00Z',status:'NS'},
  },now);
  assert.equal(future.needsRecheck,true);
  assert.equal(future.generatedAtValid,false);
  assert.equal(future.reasonCode,'generated_time_invalid');

  const invalid=runtime.analysisFreshness({
    generatedAt:'not-a-date',
    match:{date:'2026-09-25T18:00:00Z',status:'NS'},
  },now);
  assert.equal(invalid.needsRecheck,true);
  assert.equal(invalid.reasonCode,'generated_time_invalid');

  const unknownKickoff=runtime.analysisFreshness({
    generatedAt:'2026-09-23T17:58:00Z',
    match:{date:'not-a-date',status:'NS'},
  },now);
  assert.equal(unknownKickoff.needsRecheck,true);
  assert.equal(unknownKickoff.kickoffAtValid,false);
  assert.equal(unknownKickoff.reasonCode,'kickoff_time_invalid');
});

test('kickoff handoff fails closed when kickoff time is not trustworthy', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const now=Date.parse('2026-09-23T18:00:00Z');

  const unknown=runtime.analysisKickoffHandoff({
    match:{date:'invalid',status:'NS'},
  },now);
  assert.equal(unknown.state,'unknown');
  assert.equal(unknown.locked,true);

  const live=runtime.analysisKickoffHandoff({
    match:{date:'2026-09-23T17:30:00Z',status:'NS'},
  },now);
  assert.equal(live.state,'live');
  assert.equal(live.locked,true);
});

test('history eligibility rejects fractional ids and verifies both Supabase identities', async () => {
  let calls=0;
  const rows=[
    {telegram_id:99,fixture_id:71},
    {telegram_id:12,fixture_id:72},
    {telegram_id:12,fixture_id:71},
  ];
  const runtime=createAnalysisLifecycleRuntime(deps({
    hasSupabase:()=>true,
    supaSelectOne:async(...args)=>{
      calls+=1;
      assert.equal(args[1],'analysis_history');
      assert.deepEqual(args[2],{telegram_id:'eq.12',fixture_id:'eq.71'});
      return rows.shift() || null;
    },
  }));

  assert.equal(await runtime.userHasAnalyzedFixture(12.5,71,{}),false);
  assert.equal(await runtime.userHasAnalyzedFixture(12,71.5,{}),false);
  assert.equal(calls,0);

  assert.equal(await runtime.userHasAnalyzedFixture(12,71,{}),false);
  assert.equal(await runtime.userHasAnalyzedFixture(12,71,{}),false);
  assert.equal(await runtime.userHasAnalyzedFixture(12,71,{}),true);
  assert.equal(calls,3);
});

test('memory history eligibility is bounded and uses exact safe ids', async () => {
  const memory={history:new Map([
    [12,[
      {fixture_id:'71'},
      {fixture_id:72},
      {fixture_id:71.5},
    ]],
  ])};
  const runtime=createAnalysisLifecycleRuntime(deps({memory}));

  assert.equal(await runtime.userHasAnalyzedFixture('12','71',{}),true);
  assert.equal(await runtime.userHasAnalyzedFixture(12,73,{}),false);
});

test('recheck delta refuses to compare different fixtures', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const result=runtime.analysisRecheckDelta(
    snapshot({match:{fixtureId:71,date:'2026-09-23T18:30:00Z',status:'NS'}}),
    snapshot({match:{fixtureId:72,date:'2026-09-23T18:30:00Z',status:'NS'}}),
  );

  assert.equal(result.available,false);
  assert.equal(result.material,false);
  assert.equal(result.stable,false);
  assert.equal(result.reasonCode,'fixture_mismatch');
});

test('recheck delta rejects reversed snapshot chronology', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const result=runtime.analysisRecheckDelta(
    snapshot({generatedAt:'2026-09-23T18:05:00Z'}),
    snapshot({generatedAt:'2026-09-23T18:04:59Z'}),
  );

  assert.deepEqual(result,{
    available:false,
    material:false,
    stable:false,
    reasonCode:'snapshot_order_invalid',
    codes:[],
    items:[],
    summary:'Новый AI-снимок оказался старше предыдущего; изменение не может считаться корректной перепроверкой.',
  });
});

test('recheck delta allows equal timestamps but does not invent changes', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const sameTime='2026-09-23T18:05:00Z';
  const result=runtime.analysisRecheckDelta(
    snapshot({generatedAt:sameTime}),
    snapshot({generatedAt:sameTime}),
  );

  assert.equal(result.available,true);
  assert.equal(result.material,false);
  assert.equal(result.stable,true);
  assert.deepEqual(result.codes,[]);
});

test('malformed probability snapshots never produce a false stable delta', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const result=runtime.analysisRecheckDelta(
    snapshot({probabilities:{home:Infinity,draw:0,away:0}}),
    snapshot({probabilities:{home:Infinity,draw:0,away:0}}),
  );

  assert.equal(result.available,true);
  assert.equal(result.incomplete,true);
  assert.equal(result.stable,false);
});

test('malformed market snapshots do not become a false stable comparison', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const result=runtime.analysisRecheckDelta(
    snapshot({market:{probabilities:{home:Infinity,draw:0,away:0}}}),
    snapshot({market:{probabilities:{home:Infinity,draw:0,away:0}}}),
  );

  assert.equal(result.available,true);
  assert.equal(result.incomplete,true);
  assert.equal(result.stable,false);
  assert.equal(result.codes.includes('market'),false);
});

test('loss of lineup confirmation is a material lifecycle change', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const result=runtime.analysisRecheckDelta(
    snapshot({lineupImpact:{homeConfirmed:true,awayConfirmed:true}}),
    snapshot({lineupImpact:{homeConfirmed:false,awayConfirmed:true}}),
  );

  assert.equal(result.material,true);
  assert.ok(result.codes.includes('lineups'));
  assert.match(result.items.find(item=>item.code==='lineups')?.title || '',/ухудшилось/);
});

test('market appearance and referee reassignment are tracked without zero coercion', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const previous=snapshot({
    market:null,
    match:{
      fixtureId:71,
      date:'2026-09-23T18:30:00Z',
      status:'NS',
      referee:'Ref A',
    },
  });
  const next=snapshot({
    market:{probabilities:{home:48,draw:31,away:21}},
    match:{
      fixtureId:71,
      date:'2026-09-23T18:30:00Z',
      status:'NS',
      referee:'Ref B',
    },
  });
  const result=runtime.analysisRecheckDelta(previous,next);

  assert.equal(result.material,true);
  assert.ok(result.codes.includes('market'));
  assert.ok(result.codes.includes('referee'));
  // Изменения рынка учитываются в существенности, а пользователю видна одна нейтральная строка.
  assert.equal(result.items.find(item=>item.code==='market'),undefined);
  assert.equal(result.items.find(item=>item.code==='external_data')?.title,'Обновились внешние данные матча');
  assert.equal(result.items.find(item=>item.code==='referee')?.after,'Ref B');
  assert.doesNotMatch(JSON.stringify(result.items)+result.summary,/[Рр]ын(ок|оч)|коэффициент/);
});

test('market-only recheck keeps a visible neutral item so the change count is not zero', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const previous=snapshot({market:null});
  const next=snapshot({market:{probabilities:{home:48,draw:31,away:21}}});
  const result=runtime.analysisRecheckDelta(previous,next);

  assert.equal(result.material,true);
  assert.deepEqual(result.codes,['market']);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].code,'external_data');
  assert.equal(result.items[0].importance,'high');
  assert.match(result.summary,/обновились внешние данные матча/);
  assert.doesNotMatch(JSON.stringify(result.items)+result.summary,/[Рр]ын(ок|оч)|коэффициент/);
});

test('news impact comparison is bound to the same fixture', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());
  const result=runtime.newsImpactDeltaStatus(
    snapshot({match:{fixtureId:71}}),
    snapshot({match:{fixtureId:72}}),
    {available:true,material:true,stable:false,items:[],codes:['signal']},
    {
      requested:true,
      eligible:true,
      performed:true,
      publishedAt:'2026-09-23T12:00:00Z',
    },
  );

  assert.equal(result.compared,false);
  assert.equal(result.performed,false);
  assert.equal(result.reasonCode,'fixture_mismatch');
});

test('response wrapper ignores array payloads/extras and exposes deterministic drills', () => {
  const runtime=createAnalysisLifecycleRuntime(deps());

  const response=runtime.analysisResponsePayload(
    [],
    ['unexpected'],
  );
  assert.equal(Object.prototype.hasOwnProperty.call(response,'0'),false);
  assert.ok(response.freshness);
  assert.ok(response.kickoffHandoff);

  assert.equal(runtime.analysisFreshnessDrill().pass,true);
  assert.equal(runtime.analysisKickoffHandoffDrill().pass,true);
  assert.equal(runtime.analysisDeltaDrill().pass,true);
  assert.equal(runtime.newsImpactDeltaDrill().pass,true);
});

test('worker keeps lifecycle dependencies explicit', () => {
  const worker=readRepoFile('src/worker.js');
  const source=readRepoFile('src/analysis-lifecycle-runtime.js');

  assert.match(
    worker,
    /createAnalysisLifecycleRuntime\(\{[\s\S]*?hasSupabase,[\s\S]*?isFinishedStatus,[\s\S]*?isLiveStatus,[\s\S]*?memory,[\s\S]*?supaSelectOne,[\s\S]*?\}\);/,
  );
  assert.match(source,/const requiredFunctions=\{/);
  assert.match(source,/memory\.history instanceof Map/);
  assert.match(source,/function trustedLineupsConfirmed\(payload\)/);
  assert.match(source,/snapshot_order_invalid/);
  assert.match(source,/return Object\.freeze\(\{/);
});
