import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionMonitorRuntime} from '../src/production-monitor-runtime.js';

function harness({events=[],providerHealth='ok',schemaStatus='ok'}={}){
  const written=[];
  const rows=async()=>({items:[],persistent:true,migrationReady:true});
  const retired=()=>assert.fail('retired digest SLO must not be read, assessed or alerted');
  const runtime=createProductionMonitorRuntime({
    APP_VERSION:'test',RC_NAME:'test',memory:{},
    flushProviderSloWindow:async()=>({}),
    probeSupabaseConfirmed:async()=>({ok:true}),
    probeSupabaseSchemaDriftConfirmed:async()=>({ok:schemaStatus==='ok',status:schemaStatus,missing:[]}),
    readOpsEventsRange:async()=>({items:events,persistent:true,migrationReady:true}),
    readTelegramDedupeHealth:async()=>({state:'healthy'}),
    readProviderSloWindows:rows,readProviderIncidentAlertEvents:rows,readProviderIncidentAlertDeliveries:rows,
    readProviderIncidentAlertDeliveryContract:async()=>({ok:true}),
    providerIncidentAlertDestinations:async()=>[],
    currentReleaseIdentity:()=>({deploySha:'a'.repeat(40)}),
    scopeOpsEventsToDeployment:items=>({actionable:items,counts:{exact:items.length},attributionComplete:true}),
    postDeployRegressionReport:()=>({state:'collecting'}),
    planPostDeployRegressionLifecycle:()=>({action:'none'}),
    planPostDeployRegressionAlert:()=>({action:'none'}),
    providerSnapshot:()=>({health:providerHealth}),
    summarizeProviderObservabilityWindows:()=>({}),
    buildProviderSloIncidentTimeline:()=>({state:'healthy'}),
    planProviderIncidentAlert:()=>({action:'none'}),
    assessSecuritySignals:()=>({state:'healthy'}),
    securityIncidentTimeline:()=>({state:'healthy'}),
    providerIncidentAlertLedgerSummary:()=>({}),
    recordOpsEvent:async(_cfg,event)=>{written.push(event);return {};},
    readDailyDigestOpsEvents:retired,readDailyDigestSloEvents:retired,
    assessDailyDigestReliabilitySlo:retired,buildDailyDigestIncidentReport:retired,
    planDailyDigestReliabilitySloEvent:retired,planDailyDigestIncidentAlert:retired,
    deliverOperationalIncidentAlert:retired,
  });
  return {runtime,written};
}

test('after the former 08:15 UTC cutoff a missing digest run stays retired without warning ops',async()=>{
  for(const time of ['08:15:00','08:30:00','23:00:00']){
    const h=harness();
    const result=await h.runtime.runProductionMonitor({botToken:'local-only',adminTelegramIds:[1]},new Date(`2026-10-16T${time}Z`));
    assert.equal(result.state,'healthy');
    assert.equal(result.dailyDigest.reliabilitySlo.state,'retired');
    assert.equal(result.dailyDigest.alerting.nextAction,'none');
    assert.ok(h.written.some(x=>x.eventType==='production_monitor'));
    assert.ok(h.written.every(x=>!/^DAILY_DIGEST_/.test(x.code || '')));
  }
});

test('historical digest warnings cannot reopen retired alerts; active provider and schema incidents remain visible',async()=>{
  const events=Array.from({length:10},()=>({severity:'warning',source:'telegram',event_type:'daily_digest_slo',code:'DAILY_DIGEST_SLO_MISSING_RUN'}));
  const at=new Date('2026-10-16T09:00:00Z');
  assert.equal((await harness({events}).runtime.runProductionMonitor({},at)).state,'healthy');
  assert.equal((await harness({events,providerHealth:'warning'}).runtime.runProductionMonitor({},at)).state,'watch');
  assert.equal((await harness({events,schemaStatus:'drift'}).runtime.runProductionMonitor({},at)).state,'incident');
});
