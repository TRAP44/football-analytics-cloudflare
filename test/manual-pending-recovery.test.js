import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettlementRuntime} from '../src/settlement-runtime.js';
import {settlementDependencies} from '../test-support/runtime-deps.js';
import {runCron} from '../scripts/cron-runner.js';
function harness({maintenance=false,remaining=7000,truncated=false,verified=true,circuit=false,auditFail=false,count=45,lookup=null,dateFixtures=[]}={}){
  const calls=[],audits=[],states=[];
  const rows=Array.from({length:count},(_,i)=>({fixture_id:i+1,status:'pending',kickoff_at:new Date(Date.now()-(i+2)*86400000).toISOString()}));
  const controls={autoSettlementRecoveryEnabled:false,maintenanceMode:maintenance,revision:1};
  const snapshot={plan:'PRO',dailyLimit:7500,dailyRemaining:remaining,updatedAt:new Date().toISOString(),cooldownActive:false};
  const rt=createSettlementRuntime(settlementDependencies({
    memory:{modelPredictions:new Map(),modelRemediation:{actions:[]},provider:snapshot},
    SETTLEMENT_RUN_STALE_MINUTES:30,SETTLEMENT_RUN_MAX_ATTEMPTS:3,
    SETTLEMENT_FINALITY_DELAY_HOURS:24,SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS:24,SETTLEMENT_FINALITY_LOOKBACK_DAYS:90,
    DEFAULT_RUNTIME_CONTROLS:{},parseJsonObject:value=>value && typeof value==='object'?value:{},
    hasSupabase:()=>true,probeOptionalTable:async()=>({ok:true}),fetchWithTimeout:async()=>({ok:true}),supaHeaders:()=>({}),
    supaSelectPaged:async(_cfg,table,filter)=>{assert.deepEqual(filter,{status:'eq.pending'});return {rows,truncated};},
    supaSelectMany:async(_cfg,table,filter)=>table==='model_predictions'?rows.filter(row=>!filter.status || row.status==='pending'):[],supaSelectOne:async()=>circuit?{consecutive_failures:3,circuit_open_until:new Date(Date.now()+3600000).toISOString(),last_status:'failed'}:null,
    supaInsertIgnore:async(_cfg,table,row)=>{calls.push(table);audits.push(row);},
    supaPatch:async(_cfg,table,filter,patch)=>{calls.push(table);if(table==='model_predictions'){const id=Number(filter.fixture_id.slice(3));Object.assign(rows.find(row=>row.fixture_id===id),patch);}if(auditFail && table==='prediction_integrity_actions')throw Error('audit unavailable');},supaUpsert:async(_cfg,table,row)=>{calls.push(table);if(table==='settlement_watchdog_state')states.push(row);},
    loadProviderFixturesForDate:async()=>{calls.push('fixtures');return dateFixtures;},
    ...(lookup?{loadProviderFixture:async(...args)=>{calls.push('fixture-by-id');return lookup(...args);}}:{}),
    fixtureIdentity:f=>f?.fixture?.id || 0,fixtureStatusShort:f=>f?.fixture?.status?.short || '',
    isFinishedStatus:s=>['FT','AET','PEN'].includes(s),regulationScore:f=>f?.score?.fulltime || null,
    actualOutcomeFromGoals:(home,away)=>home>away?'home':home<away?'away':'draw',scoreBrier:()=>0.2,
    loadRuntimeControls:async()=>({source:verified?'supabase':'memory',value:controls}),stalePredictionCandidates:r=>r,
    providerSnapshot:()=>snapshot,loadSharedProviderState:async()=>{},probeProviderStatus:async()=>snapshot,
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,setCache:async()=>{calls.push('cache write');},
    recordOpsEvent:async()=>{},redactOpsString:s=>String(s||''),
    bytesToHex:bytes=>Buffer.from(bytes).toString('hex'),
  }));return {rt,calls,controls,audits,rows,states};
}
test('preview scans only pending rows with a hard forty-row/date cap and no writes',async()=>{
  const h=harness();const result=await h.rt.runSettlementWatchdog({cronRunner:'github-actions',supabaseUrl:'https://example.supabase.co'},{manual:true,preview:true});
  assert.equal(result.ok,true);assert.equal(result.stalePending,45);assert.equal(result.selectedCount,40);assert.equal(result.providerCalls,40);
  assert.deepEqual(h.calls,[]);assert.equal(h.controls.autoSettlementRecoveryEnabled,false);
});
test('manual recovery refuses non-runner calls, maintenance, truncated scans and user quota reserve',async()=>{
  const bad=harness();assert.equal((await bad.rt.runSettlementWatchdog({}, {manual:true})).skipped,'manual_recovery_runner_required');
  for(const [opts,reason] of [[{maintenance:true},'manual_recovery_paused'],[{truncated:true},'manual_recovery_scan_truncated'],[{remaining:3750},'manual_recovery_provider_reserve']]){
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
