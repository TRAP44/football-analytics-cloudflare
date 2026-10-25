import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettlementRuntime} from '../src/settlement-runtime.js';
import {settlementDependencies} from '../test-support/runtime-deps.js';
import {runCron} from '../scripts/cron-runner.js';
function harness({maintenance=false,remaining=7000,truncated=false,verified=true,circuit=false,auditFail=false,count=45,lookup=null,dateFixtures=[],automatic=false,reliabilityFail=false}={}){
  const calls=[],audits=[],states=[],cache=new Map();
  const rows=Array.from({length:count},(_,i)=>({fixture_id:i+1,status:'pending',kickoff_at:new Date(Date.now()-(i+2)*86400000).toISOString()}));
  const controls={autoSettlementRecoveryEnabled:automatic,maintenanceMode:maintenance,revision:1};
  const snapshot={plan:'PRO',dailyLimit:7500,dailyRemaining:remaining,updatedAt:new Date().toISOString(),cooldownActive:false};
  const rt=createSettlementRuntime(settlementDependencies({
    memory:{modelPredictions:new Map(),modelRemediation:{actions:[]},provider:snapshot},
    SETTLEMENT_RUN_STALE_MINUTES:30,SETTLEMENT_RUN_MAX_ATTEMPTS:3,
    SETTLEMENT_FINALITY_DELAY_HOURS:24,SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS:24,SETTLEMENT_FINALITY_LOOKBACK_DAYS:90,
    DEFAULT_RUNTIME_CONTROLS:{},parseJsonObject:value=>value && typeof value==='object'?value:{},
    hasSupabase:()=>true,probeOptionalTable:async()=>({ok:true}),fetchWithTimeout:async()=>({ok:true}),supaHeaders:()=>({}),
    supaSelectPaged:async(_cfg,table,filter)=>{assert.deepEqual(filter,{status:'eq.pending'});return {rows,truncated};},
    supaSelectMany:async(_cfg,table,filter)=>{
      if(table==='model_predictions')return rows.filter(row=>(!filter.status || row.status==='pending') && (!filter.fixture_id || filter.fixture_id.slice(4,-1).split(',').includes(String(row.fixture_id))));
      if(table==='prediction_integrity_actions'){
        let found=audits.filter(row=>filter.action_type==='in.(auto_recover,recover)' || !filter.action_type || row.action_type===filter.action_type.slice(3));
        if(filter.status==='eq.started')found=found.filter(row=>row.status==='started');
        if(filter.status==='in.(completed,partial)')return found.filter(row=>['completed','partial'].includes(row.status)).slice(-1);
        return [...found].reverse();
      }return [];
    },supaSelectOne:async(_cfg,table)=>{if(reliabilityFail && table==='settlement_watchdog_state')throw Error('reliability unavailable');return circuit?{consecutive_failures:3,circuit_open_until:new Date(Date.now()+3600000).toISOString(),last_status:'failed'}:null;},
    supaInsertIgnore:async(_cfg,table,row)=>{calls.push(table);audits.push(row);},
    supaPatch:async(_cfg,table,filter,patch)=>{calls.push(table);if(table==='model_predictions'){const id=Number(filter.fixture_id.slice(3));Object.assign(rows.find(row=>row.fixture_id===id),patch);}if(table==='prediction_integrity_actions'){if(auditFail)throw Error('audit unavailable');Object.assign(audits.find(row=>row.action_id===filter.action_id.slice(3)),patch);}},supaUpsert:async(_cfg,table,row)=>{calls.push(table);if(table==='settlement_watchdog_state')states.push(row);},
    loadProviderFixturesForDate:async()=>{calls.push('fixtures');return dateFixtures;},
    ...(lookup?{loadProviderFixture:async(...args)=>{calls.push('fixture-by-id');return lookup(...args);}}:{}),
    fixtureIdentity:f=>f?.fixture?.id || 0,fixtureStatusShort:f=>f?.fixture?.status?.short || '',
    isFinishedStatus:s=>['FT','AET','PEN'].includes(s),regulationScore:f=>f?.score?.fulltime || null,
    actualOutcomeFromGoals:(home,away)=>home>away?'home':home<away?'away':'draw',scoreBrier:()=>0.2,
    loadRuntimeControls:async()=>({source:verified?'supabase':'memory',value:controls}),stalePredictionCandidates:r=>r,
    providerSnapshot:()=>snapshot,loadSharedProviderState:async()=>{},probeProviderStatus:async()=>snapshot,
    freeQuotaHealthy:()=>true,
    todayUtc:()=>new Date().toISOString().slice(0,10),getCache:async key=>cache.get(key),setCache:async(key,_id,value,_cfg,ttl)=>{calls.push('cache write');cache.set(key,{...value,ttl});},
    recordOpsEvent:async()=>{},redactOpsString:s=>String(s||''),
    bytesToHex:bytes=>Buffer.from(bytes).toString('hex'),
  }));return {rt,calls,controls,audits,rows,states,cache};
}
test('preview scans only pending rows with a hard forty-row/date cap and no writes',async()=>{
  const h=harness();const result=await h.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co'},{manual:true,preview:true});
  assert.equal(result.ok,true);assert.equal(result.stalePending,45);assert.equal(result.selectedCount,40);assert.equal(result.providerCalls,40);
  assert.deepEqual(h.calls,[]);assert.equal(h.controls.autoSettlementRecoveryEnabled,false);
});
test('manual recovery refuses non-runner calls, maintenance, truncated scans and user quota reserve',async()=>{
  const bad=harness();assert.equal((await bad.rt.runSettlementWatchdog({}, {manual:true})).skipped,'manual_recovery_runner_required');
  for(const [opts,reason] of [[{maintenance:true},'recovery_paused'],[{truncated:true},'recovery_scan_truncated'],[{remaining:3750},'recovery_provider_reserve']]){
    const h=harness(opts);const result=await h.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co',apiFootballKey:'test'},{manual:true});
    assert.equal(result.skipped,reason);assert.equal(h.controls.autoSettlementRecoveryEnabled,false);assert.deepEqual(h.calls,[]);
  }
});
test('runner passes only the selected manual mode and exposes numeric summary without private fields',async()=>{
  let controller;const result=await runCron({recoveryMode:'preview',env:{},nowMs:Date.now(),worker:{scheduled:async c=>{controller=c;return [{task:'settlement_recovery',status:'ok',value:{stalePending:40,selectedCount:40,providerCalls:30,actionId:'private',fixtureIds:[123]}}];}}});
  assert.equal(controller.settlementRecoveryMode,'preview');assert.equal(controller.liveNotificationsOnly,undefined);
  assert.equal(result.tasks[0].recovery.selectedCount,40);assert.doesNotMatch(JSON.stringify(result),/private|fixtureIds/);
  await assert.rejects(runCron({recoveryMode:'typo'}),/invalid_recovery_mode/);
});


test('all forty selected fixture identities remain in the persistent recovery audit',async()=>{
  const h=harness();const ids=Array.from({length:40},(_,i)=>i+1);
  await h.rt.recordRemediationAction({},null,{fixtureIds:ids,actionType:'recover',triggerSource:'admin',status:'started'});
  assert.deepEqual(h.audits[0].fixture_ids,ids);assert.equal(h.audits[0].admin_telegram_id,null);
});

test('lost ownership stops manual recovery before provider fetch or prediction mutation',async()=>{
  const h=harness();const result=await h.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co',apiFootballKey:'test'},{manual:true,canContinue:()=>false});
  assert.equal(result.ok,false);assert.equal(h.calls.includes('fixtures'),false);assert.equal(h.calls.includes('model_predictions'),false);
  assert.equal(h.controls.autoSettlementRecoveryEnabled,false);
});


test('runtime and circuit blocks are explicit skipped results rather than a claimed repair success',async()=>{
  for(const [opts,reason] of [[{verified:false},'runtime_unverified'],[{circuit:true},'circuit_open']]){
    const h=harness(opts);const result=await h.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co',apiFootballKey:'test'},{manual:true});
    assert.equal(result.skipped,reason);assert.equal(h.calls.includes('fixtures'),false);assert.equal(h.calls.includes('model_predictions'),false);
  }
});


test('missing provider finals and an unfinished audit remain degraded without invented results',async()=>{
  for(const auditFail of [false,true]){
    const h=harness({auditFail});const result=await h.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co',apiFootballKey:'test'},{manual:true});
    assert.equal(result.status,'degraded');assert.equal(result.settledCount,0);assert.equal(result.skippedCount,40);
    assert.equal(result.reason,auditFail?'manual_recovery_audit_pending':'manual_recovery_partial');
    assert.equal(h.calls.filter(x=>x==='fixtures').length,40);assert.equal(h.calls.includes('model_predictions'),false);
  }
});


function sourceFixture(id,status='FT',score={home:2,away:1}){
  return {fixture:{id,date:new Date(Date.now()-86400000).toISOString(),status:{short:status}},score:{fulltime:score}};
}
test('manual recovery resolves a moved fixture by stable ID with force refresh and settles actual source score',async()=>{
  const checked=[];const h=harness({count:2,lookup:async(id,_cfg,options)=>{checked.push(id);assert.deepEqual(options,{forceRefresh:true});return sourceFixture(id);}});
  const result=await h.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co',apiFootballKey:'test'},{manual:true});
  assert.equal(result.settledCount,2);assert.equal(result.skippedCount,0);assert.deepEqual(checked,[1,2]);assert.equal(result.fixtureLookups,2);
  assert.equal(h.states.at(-1).last_status,'completed');
  for(const row of h.rows){assert.equal(row.status,'settled');assert.equal(row.actual_home_goals,2);assert.equal(row.actual_away_goals,1);}
  assert.equal(h.controls.autoSettlementRecoveryEnabled,false);
});
test('ID lookup never accepts another fixture, nonfinal games, missing scores or unknown responses',async()=>{
  for(const [lookup,field] of [
    [async()=>sourceFixture(999),'notFound'],[async()=>sourceFixture(1,'NS'),'notFinished'],
    [async()=>sourceFixture(1,'FT',null),'missingScore'],[async()=>{throw Error('source down');},'lookupFailed'],
  ]){
    const h=harness({count:1,lookup});const result=await h.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co',apiFootballKey:'test'},{manual:true});
    assert.equal(result[field],1);assert.equal(result.settledCount,0);assert.equal(h.rows[0].status,'pending');
    assert.equal(h.calls.includes('model_predictions'),false);
  }
});
test('already complete date snapshots avoid the ID fallback and missing entries remain bounded by forty',async()=>{
  const full=harness({count:1,dateFixtures:[sourceFixture(1)],lookup:async()=>{throw Error('unnecessary lookup');}});
  assert.equal((await full.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co',apiFootballKey:'test'},{manual:true})).settledCount,1);
  assert.equal(full.calls.includes('fixture-by-id'),false);
  const missing=harness({lookup:async()=>null});const result=await missing.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co',apiFootballKey:'test'},{manual:true});
  assert.equal(result.notFound,40);assert.equal(missing.states.at(-1).last_status,'partial');assert.equal(missing.calls.filter(x=>x==='fixture-by-id').length,40);
});

const automaticCfg={cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co',apiFootballKey:'test'};
test('automatic recovery rotates past unfinished oldest games and uses ID fallback for moved fixtures',async()=>{
  const h=harness({count:45,automatic:true,lookup:async id=>sourceFixture(id,id<=25?'FT':'NS')});
  // All 45 fixtures share a kickoff: deterministic fixture-ID ordering and 20 cap.
  const kickoff=h.rows[0].kickoff_at;for(const row of h.rows)row.kickoff_at=kickoff;
  // A partial second batch must not keep selecting the same twenty forever.
  const lookup=h.rt;
  const first=await lookup.runSettlementWatchdog(automaticCfg);
  assert.equal(first.selectedCount,20);assert.equal(first.settledCount,20);
  assert.equal(h.audits.at(-1).detail.nextCursor.fixtureId,20);
  assert.equal((await lookup.runSettlementWatchdog(automaticCfg)).skipped,'already_checked');
  h.cache.clear();h.audits.at(-1).finished_at='2020-01-01T00:00:00Z';
  const second=await lookup.runSettlementWatchdog(automaticCfg);
  assert.equal(second.settledCount,5);assert.equal(second.notFinished,15);
  assert.equal(h.audits.at(-1).detail.nextCursor.fixtureId,40);
  h.cache.clear();h.audits.at(-1).finished_at='2020-01-01T00:00:00Z';
  const third=await lookup.runSettlementWatchdog(automaticCfg);
  assert.equal(third.notFinished,5);assert.equal(third.settledCount,0);
  assert.deepEqual(h.audits.at(-1).fixture_ids,[41,42,43,44,45]);
  h.cache.clear();assert.equal((await lookup.runSettlementWatchdog(automaticCfg)).skipped,'already_checked');
  h.audits.at(-1).finished_at='2020-01-01T00:00:00Z';
  const fourth=await lookup.runSettlementWatchdog(automaticCfg);assert.equal(fourth.notFinished,20);
  assert.deepEqual(h.audits.at(-1).fixture_ids,Array.from({length:20},(_,i)=>26+i));
  assert.equal(h.controls.autoSettlementRecoveryEnabled,true);
});
test('automatic pending-only scan, ownership, circuit, maintenance and reserve fail closed',async()=>{
  for(const [opts,reason] of [[{truncated:true},'recovery_scan_truncated'],[{maintenance:true},'recovery_paused'],[{remaining:3750},'recovery_provider_reserve'],[{verified:false},'runtime_unverified'],[{circuit:true},'circuit_open']]){
    const h=harness({...opts,automatic:true});const result=await h.rt.runSettlementWatchdog(automaticCfg);
    assert.equal(result.skipped || result.state,reason);assert.equal(h.calls.includes('fixtures'),false);assert.equal(h.calls.includes('model_predictions'),false);
  }
  const h=harness({automatic:true});const stopped=await h.rt.runSettlementWatchdog(automaticCfg,{canContinue:()=>false});
  assert.equal(stopped.ok,false);assert.equal(h.calls.includes('fixtures'),false);
  assert.equal(h.audits.at(-1).status,'failed');assert.equal(h.audits.at(-1).detail.nextCursor,undefined);
});
test('automatic completed-audit checkpoint read failure or invalid cursor cannot issue provider calls',async()=>{
  const h=harness({automatic:true});h.audits.push({action_type:'auto_recover',status:'partial',detail:{nextCursor:{fixtureId:'bad',kickoffAt:'invalid'}}});
  await assert.rejects(h.rt.runSettlementWatchdog(automaticCfg),/Invalid settlement queue checkpoint/);
  assert.equal(h.calls.includes('fixtures'),false);
});
test('daily nonfinal source is revisited after an hour instead of suppressing the whole day',async()=>{
  const h=harness({count:1});h.rows[0].kickoff_at=new Date(Date.now()-86400000).toISOString();
  const result=await h.rt.settleBacktestDaily(automaticCfg);
  assert.equal(result.settled,0);assert.equal([...h.cache.values()].at(-1).ttl,60);
});

test('date-limited batches never wrap backwards across the cursor and starve later dates',async()=>{
  const h=harness({automatic:true,count:10,lookup:async id=>sourceFixture(id,'NS')});
  for(const [index,row] of h.rows.entries())row.kickoff_at=new Date(Date.parse('2020-01-01T00:00:00Z')+Math.floor(index/2)*86400000).toISOString();
  // First date has a processed cursor in its middle; enough dates follow to hit cap5.
  h.rows.push({fixture_id:11,status:'pending',kickoff_at:'2020-01-06T00:00:00Z'});
  h.audits.push({action_type:'auto_recover',status:'partial',finished_at:'2020-01-01T00:00:00Z',detail:{nextCursor:{fixtureId:1,kickoffAt:h.rows[0].kickoff_at}}});
  await h.rt.runSettlementWatchdog(automaticCfg);
  assert.deepEqual(h.audits.at(-1).fixture_ids,[2,3,4,5,6,7,8,9,10]);
  assert.equal(h.audits.at(-1).detail.nextCursor.fixtureId,10);
  h.cache.clear();h.audits.at(-1).finished_at='2020-01-01T00:00:00Z';
  await h.rt.runSettlementWatchdog(automaticCfg);assert.deepEqual(h.audits.at(-1).fixture_ids,[11]);
});

test('an unreadable circuit state never becomes a closed circuit for a mutating recovery',async()=>{
  for(const manual of [false,true]){
    const h=harness({automatic:true,reliabilityFail:true});
    await assert.rejects(h.rt.runSettlementWatchdog(automaticCfg,{manual}),/reliability unavailable/);
    assert.equal(h.calls.includes('fixtures'),false);assert.equal(h.calls.includes('model_predictions'),false);
  }
});
