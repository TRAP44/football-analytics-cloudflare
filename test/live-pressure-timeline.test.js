import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLivePressureTimelineRuntime} from '../src/live-pressure-timeline-runtime.js';
import {renderLivePressureHistory} from '../public/modules/match-pulse.js';

const trusted={confidenceBearing:true,provenanceState:'verified',stale:false};
const sample=(date,home=63,away=37)=>({
  fixtureId:44,pressure:{home,away},minute:24,mode:'live',
  meta:trusted,capturedAt:date,
});
const verifiedPayload=()=>({
  mode:'live',match:{home:{name:'Арсенал'},away:{name:'Челси'}},
  availability:{statistics:true},
  dataFreshness:{statistics:trusted},
  livePressure:{home:61,away:39},
  pressureHistory:[
    {capturedAt:'2026-10-08T16:01:00Z',minute:23,home:63,away:37},
    {capturedAt:'2026-10-08T16:03:00Z',minute:25,home:61,away:39},
  ],
});

test('Verified LIVE pressure stores only genuine two-minute buckets with stable keys',async()=>{
  const inserts=[];
  const memory={livePressureSnapshots:new Map()};
  const runtime=createLivePressureTimelineRuntime({
    memory,
    hasSupabase:()=>true,
    supaInsertIgnore:async(_cfg,table,row,key)=>{inserts.push({table,row,key});return true;},
    supaSelectMany:async()=>[],
  });
  assert.equal(await runtime.capture(sample('2026-10-08T16:01:03Z'),{}),true);
  assert.equal(await runtime.capture(sample('2026-10-08T16:01:35Z'),{}),true);
  assert.equal(inserts[0].table,'live_pressure_snapshots');
  assert.equal(inserts[0].key,'snapshot_key');
  assert.equal(inserts[0].row.snapshot_key,'44:2026-10-08T16:00:00.000Z');
  assert.equal(inserts[1].row.snapshot_key,inserts[0].row.snapshot_key);
  assert.equal(memory.livePressureSnapshots.get(44).length,1);
  assert.equal(await runtime.capture(sample('2026-10-08T16:02:05Z',61,39),{}),true);
  assert.equal(memory.livePressureSnapshots.get(44).length,2);
});

test('No writes for invalid, untrusted, non-LIVE, or missing pressure',async()=>{
  let writes=0;
  const runtime=createLivePressureTimelineRuntime({
    memory:{livePressureSnapshots:new Map()},
    hasSupabase:()=>true,
    supaInsertIgnore:async()=>{writes++},
    supaSelectMany:async()=>[],
  });
  const base=sample('2026-10-08T16:01:03Z');
  for(const change of [
    {mode:'finished'}, {meta:{...trusted,stale:true}},
    {meta:{...trusted,confidenceBearing:false}},
    {meta:{...trusted,provenanceState:'unverified'}},
    {fixtureId:0},{minute:300},{pressure:{home:95,away:31}},
    {pressure:{home:NaN,away:39}},{capturedAt:'invalid'},
  ]){
    assert.equal(await runtime.capture({...base,...change},{}),false);
  }
  assert.equal(writes,0);
});

test('Persistent history is sorted, filtered by fixture and not padded',async()=>{
  const calls=[];
  const runtime=createLivePressureTimelineRuntime({
    memory:{livePressureSnapshots:new Map()},
    hasSupabase:()=>true,
    supaInsertIgnore:async()=>true,
    supaSelectMany:async(_cfg,table,filters,options)=>{
      calls.push({table,filters,options});
      return [
        {fixture_id:44,captured_at:'2026-10-08T16:03:00Z',source:'verified',home_pressure:61,away_pressure:39,match_minute:25},
        {fixture_id:99,captured_at:'2026-10-08T16:02:00Z',source:'verified',home_pressure:70,away_pressure:30},
        {fixture_id:44,captured_at:'2026-10-08T16:01:00Z',source:'verified',home_pressure:63,away_pressure:37,match_minute:23},
        {fixture_id:44,captured_at:'2026-10-08T16:04:00Z',source:'unverified',home_pressure:55,away_pressure:45},
      ];
    },
  });
  const points=await runtime.load(44,{},80);
  assert.deepEqual(points.map(row=>row.home),[63,61]);
  assert.deepEqual(calls,[{table:'live_pressure_snapshots',filters:{fixture_id:'eq.44'},options:{order:'captured_at.desc',limit:80}}]);
  assert.deepEqual(await runtime.load(-1,{}),[]);
});

test('LIVE graph is based only on observed readings and escapes untrusted labels',()=>{
  const html=renderLivePressureHistory(verifiedPayload());
  assert.match(html,/match-pulse-history/);
  assert.match(html,/2 измерений/);
  assert.match(html,/pressure-history-home/);
  assert.match(html,/pressure-history-away/);
  assert.match(html,/Недоступные минуты не восстанавливаются/);
  assert.match(html,/M30\.0 [\d.]+ L610\.0/);
  for(const input of [
    {...verifiedPayload(),pressureHistory:[]},
    {...verifiedPayload(),pressureHistory:verifiedPayload().pressureHistory.slice(0,1)},
    {...verifiedPayload(),stale:true},
    {...verifiedPayload(),mode:'upcoming'},
    {...verifiedPayload(),dataFreshness:{statistics:{...trusted,stale:true}}},
  ])assert.equal(renderLivePressureHistory(input),'');
  const poisoned=verifiedPayload();
  poisoned.match.home.name='<script>alert(1)</script>';
  const result=renderLivePressureHistory(poisoned);
  assert.equal(result.includes('<script>'),false);
  assert.match(result,/&lt;script&gt;/);
});

test('Integration uses only fresh verified readings, RLS and append-only grants',()=>{
  const server=readFileSync(new URL('../src/match-center-runtime.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  const migration=readFileSync(new URL('../supabase/migrations/supabase_migration_v6_29_14.sql',import.meta.url),'utf8').toLowerCase();
  const css=readFileSync(new URL('../public/styles/public-shell.css',import.meta.url),'utf8');
  assert.match(server,/pressureTrusted=live/);
  assert.match(server,/trustedFeature\(featureMeta\.statistics\)/);
  assert.match(server,/await optionalAsync\(captureLivePressureSnapshot/);
  assert.match(server,/pressureHistory:null/);
  assert.match(server,/pressureHistory,/);
  assert.match(worker,/createLivePressureTimelineRuntime/);
  assert.match(migration,/create table if not exists public\.live_pressure_snapshots/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/grant select, insert on table public\.live_pressure_snapshots to service_role/);
  assert.doesNotMatch(migration,/grant[^;]*(update|delete)[^;]*live_pressure_snapshots/i);
  assert.match(css,/\.pressure-history-chart/);
});
