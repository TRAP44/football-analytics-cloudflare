import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderSloIncidentTimeline } from '../src/provider-slo-incidents.js';
import {
  deliverProviderIncidentAlert,
  planProviderIncidentAlert,
  providerIncidentAlertOpsEvent,
} from '../src/provider-incident-alerts.js';

function window(at, state, options = {}) {
  const requests = Number(options.requests ?? 20);
  const failures = Number(options.failures ?? (state === 'healthy' ? 0 : state === 'watch' ? 1 : 4));
  const successes = Math.max(0, requests - failures);
  const timeouts = Number(options.timeouts ?? (state === 'incident' ? 2 : 0));
  const rateLimits = Number(options.rateLimits ?? 0);
  const retries = Number(options.retries ?? (state === 'healthy' ? 0 : state === 'watch' ? 2 : 6));
  const avgLatency = Number(options.avgLatency ?? (state === 'healthy' ? 120 : state === 'watch' ? 2800 : 5500));
  const provider = options.provider || 'api-football';
  const operation = options.operation || '/fixtures';
  return {
    created_at:at,
    metadata:{
      windowStartedAt:new Date(Date.parse(at) - 15 * 60_000).toISOString(),
      windowEndedAt:at,
      sloState:state,
      totals:{
        attempts:requests + retries,
        requests,
        successes,
        failures,
        retries,
        timeouts,
        rateLimits,
        latencySamples:requests + retries,
        latencySumMs:avgLatency * (requests + retries),
        successRatePct:requests ? Math.round((successes / requests) * 1000) / 10 : null,
        errorRatePct:requests ? Math.round((failures / requests) * 1000) / 10 : null,
        timeoutRatePct:requests ? Math.round((timeouts / requests) * 1000) / 10 : null,
        rateLimitRatePct:requests ? Math.round((rateLimits / requests) * 1000) / 10 : null,
        retryRatePct:requests ? Math.round((retries / requests) * 1000) / 10 : null,
        avgAttemptLatencyMs:avgLatency,
        maxLatencyMs:avgLatency,
      },
      series:[{
        provider,
        operation,
        attempts:requests + retries,
        requests,
        successes,
        failures,
        retries,
        timeouts,
        rateLimits,
        latencySamples:requests + retries,
        latencySumMs:avgLatency * (requests + retries),
        maxLatencyMs:avgLatency,
      }],
    },
  };
}

function sentEvent(incidentId, kind = 'incident', key = incidentId + ':' + kind, slots = [0], at = '2026-09-28T11:00:00Z') {
  return {
    created_at:at,
    source:'provider_alert',
    code:'PROVIDER_SLO_ALERT_SENT',
    metadata:{
      incidentId,
      alertKind:kind,
      deliveryKey:key,
      deliveredSlots:slots,
      failedSlots:[],
    },
  };
}

test('healthy to watch, watch to incident and repeated incident windows keep one lifecycle id', () => {
  const base = [
    window('2026-09-28T09:45:00Z','healthy'),
    window('2026-09-28T10:00:00Z','healthy'),
    window('2026-09-28T10:15:00Z','watch'),
    window('2026-09-28T10:30:00Z','watch'),
  ];
  const watched = buildProviderSloIncidentTimeline(base,{nowMs:Date.parse('2026-09-28T10:35:00Z')});
  assert.equal(watched.state,'watch');
  assert.ok(watched.activeIncident?.incidentId);
  const incidentId = watched.activeIncident.incidentId;

  const incident = buildProviderSloIncidentTimeline([
    ...base,
    window('2026-09-28T10:45:00Z','incident'),
    window('2026-09-28T11:00:00Z','incident'),
  ],{nowMs:Date.parse('2026-09-28T11:05:00Z')});
  assert.equal(incident.state,'incident');
  assert.equal(incident.activeIncident.incidentId,incidentId);
  assert.equal(incident.transition?.kind,'escalated');

  const repeated = buildProviderSloIncidentTimeline([
    ...base,
    window('2026-09-28T10:45:00Z','incident'),
    window('2026-09-28T11:00:00Z','incident'),
    window('2026-09-28T11:15:00Z','incident',{failures:6,timeouts:4}),
  ],{nowMs:Date.parse('2026-09-28T11:20:00Z')});
  assert.equal(repeated.activeIncident.incidentId,incidentId);
  assert.equal(repeated.transition,null);
  assert.equal(repeated.activeIncident.diagnostics.errorRatePct,30);
});

test('severity escalates only from objective signals and small samples never become critical', () => {
  const critical = buildProviderSloIncidentTimeline([
    window('2026-09-28T10:00:00Z','incident',{requests:20,failures:12,timeouts:5,avgLatency:11000}),
    window('2026-09-28T10:15:00Z','incident',{requests:20,failures:11,timeouts:5,avgLatency:10500}),
  ],{nowMs:Date.parse('2026-09-28T10:20:00Z')});
  assert.equal(critical.activeIncident.severity,'critical');

  const small = buildProviderSloIncidentTimeline([
    window('2026-09-28T10:00:00Z','incident',{requests:12,failures:10,timeouts:8,avgLatency:15000}),
    window('2026-09-28T10:15:00Z','incident',{requests:12,failures:10,timeouts:8,avgLatency:15000}),
  ],{nowMs:Date.parse('2026-09-28T10:20:00Z')});
  assert.equal(small.activeIncident.severity,'incident');
});

test('recovery belongs to the same incident and a later degradation creates a new incident id', () => {
  const rows = [
    window('2026-09-28T10:00:00Z','incident'),
    window('2026-09-28T10:15:00Z','incident'),
    window('2026-09-28T10:30:00Z','healthy'),
    window('2026-09-28T10:45:00Z','healthy'),
  ];
  const recovered = buildProviderSloIncidentTimeline(rows,{nowMs:Date.parse('2026-09-28T10:50:00Z')});
  const firstId = recovered.history[0].incidentId;
  assert.equal(recovered.state,'healthy');
  assert.equal(recovered.transition?.kind,'recovered');
  assert.equal(recovered.transition?.incidentId,firstId);
  assert.equal(recovered.history[0].recoveredAt,'2026-09-28T10:45:00.000Z');

  const extraHealthy = buildProviderSloIncidentTimeline([
    ...rows,
    window('2026-09-28T11:00:00Z','healthy'),
  ],{nowMs:Date.parse('2026-09-28T11:05:00Z')});
  assert.equal(extraHealthy.transition,null);

  const next = buildProviderSloIncidentTimeline([
    ...rows,
    window('2026-09-28T11:00:00Z','healthy'),
    window('2026-09-28T11:15:00Z','watch'),
    window('2026-09-28T11:30:00Z','watch'),
    window('2026-09-28T11:45:00Z','incident'),
    window('2026-09-28T12:00:00Z','incident'),
  ],{nowMs:Date.parse('2026-09-28T12:05:00Z')});
  assert.equal(next.state,'incident');
  assert.notEqual(next.activeIncident.incidentId,firstId);
  assert.equal(next.history.length,2);
});

test('collecting breaks confirmation and two providers preserve diagnostic context', () => {
  const collecting = buildProviderSloIncidentTimeline([
    window('2026-09-28T10:00:00Z','watch'),
    window('2026-09-28T10:15:00Z','collecting',{requests:4}),
    window('2026-09-28T10:30:00Z','watch'),
  ]);
  assert.equal(collecting.state,'collecting');
  assert.equal(collecting.activeIncident,null);

  const multi = buildProviderSloIncidentTimeline([
    {
      created_at:'2026-09-28T11:00:00Z',
      metadata:{
        windowStartedAt:'2026-09-28T10:45:00Z',
        windowEndedAt:'2026-09-28T11:00:00Z',
        sloState:'incident',
        totals:{requests:20,successes:15,failures:5,retries:6,timeouts:3,rateLimits:2,latencySamples:26,latencySumMs:130000},
        series:[
          {provider:'api-football',operation:'/fixtures',requests:10,successes:7,failures:3,retries:4,timeouts:2,rateLimits:1,attempts:14,latencySamples:14,latencySumMs:84000},
          {provider:'OpenLigaDB',operation:'standings',requests:10,successes:8,failures:2,retries:2,timeouts:1,rateLimits:1,attempts:12,latencySamples:12,latencySumMs:46000},
        ],
      },
    },
    {
      created_at:'2026-09-28T11:15:00Z',
      metadata:{
        windowStartedAt:'2026-09-28T11:00:00Z',
        windowEndedAt:'2026-09-28T11:15:00Z',
        sloState:'incident',
        totals:{requests:20,successes:14,failures:6,retries:7,timeouts:4,rateLimits:2,latencySamples:27,latencySumMs:145000},
        series:[
          {provider:'api-football',operation:'/fixtures',requests:10,successes:6,failures:4,retries:5,timeouts:3,rateLimits:1,attempts:15,latencySamples:15,latencySumMs:95000},
          {provider:'OpenLigaDB',operation:'standings',requests:10,successes:8,failures:2,retries:2,timeouts:1,rateLimits:1,attempts:12,latencySamples:12,latencySumMs:50000},
        ],
      },
    },
  ],{nowMs:Date.parse('2026-09-28T11:20:00Z')});
  assert.equal(multi.state,'incident');
  assert.equal(multi.activeIncident.diagnostics.primaryProvider,'api-football');
  assert.deepEqual(new Set(multi.activeIncident.diagnostics.affectedProviders),new Set(['api-football','OpenLigaDB']));
});

test('watch never sends a full incident Telegram alert and an incident is deduplicated after delivery', () => {
  const watchIncident = {
    incidentId:'pslo-api-football-watch',
    active:true,
    state:'watch',
    highestState:'watch',
    severity:'warning',
  };
  assert.equal(planProviderIncidentAlert({activeIncident:watchIncident,history:[watchIncident]},[],{adminCount:1}).action,'none');

  const incident = {
    ...watchIncident,
    incidentId:'pslo-api-football-one',
    state:'incident',
    highestState:'incident',
    severity:'incident',
    startedAt:'2026-09-28T10:00:00Z',
    durationMinutes:30,
    fingerprint:'api-football|/fixtures|provider_slo|pslo-api-football-one',
    diagnostics:{primaryProvider:'api-football',primaryOperation:'/fixtures',sampleSize:20,errorRatePct:20,timeoutRatePct:10,rateLimitRatePct:0,avgAttemptLatencyMs:4000,reason:'timeout rate 10.0%'},
  };
  const report = {activeIncident:incident,history:[incident]};
  const first = planProviderIncidentAlert(report,[],{nowMs:Date.parse('2026-09-28T10:30:00Z'),adminCount:1});
  assert.equal(first.action,'send');
  assert.equal(first.kind,'incident');

  const prior = [sentEvent(incident.incidentId,'incident',incident.incidentId + ':incident')];
  const duplicate = planProviderIncidentAlert(report,prior,{nowMs:Date.parse('2026-09-28T10:45:00Z'),adminCount:1});
  assert.equal(duplicate.action,'none');
  assert.equal(duplicate.reason,'incident_alert_deduplicated');
});

test('critical escalation, long incident reminder and recovery are each deduplicated', () => {
  const incident = {
    incidentId:'pslo-api-football-two',
    active:true,
    state:'incident',
    highestState:'incident',
    severity:'critical',
    startedAt:'2026-09-28T00:00:00Z',
    durationMinutes:370,
    fingerprint:'api-football|/fixtures|provider_slo|pslo-api-football-two',
    diagnostics:{primaryProvider:'api-football',primaryOperation:'/fixtures',sampleSize:40,errorRatePct:55,timeoutRatePct:25,rateLimitRatePct:0,avgAttemptLatencyMs:11000,reason:'error rate 55.0%'},
  };
  const open = sentEvent(incident.incidentId,'incident',incident.incidentId + ':incident',[0],'2026-09-28T00:30:00Z');
  const escalation = planProviderIncidentAlert({activeIncident:incident,history:[incident]},[open],{nowMs:Date.parse('2026-09-28T06:10:00Z'),adminCount:1});
  assert.equal(escalation.kind,'escalation');

  const escalated = sentEvent(incident.incidentId,'escalation',incident.incidentId + ':escalation:critical',[0],'2026-09-28T06:10:00Z');
  const reminder = planProviderIncidentAlert({activeIncident:incident,history:[incident]},[open,escalated],{nowMs:Date.parse('2026-09-28T06:20:00Z'),adminCount:1});
  assert.equal(reminder.kind,'reminder');

  const reminded = sentEvent(incident.incidentId,'reminder',incident.incidentId + ':reminder:1',[0],'2026-09-28T06:20:00Z');
  const noSpam = planProviderIncidentAlert({activeIncident:incident,history:[incident]},[open,escalated,reminded],{nowMs:Date.parse('2026-09-28T06:35:00Z'),adminCount:1});
  assert.equal(noSpam.action,'none');

  const recovered = {...incident,active:false,state:'recovered',recoveredAt:'2026-09-28T07:00:00Z',durationMinutes:420};
  const recovery = planProviderIncidentAlert({activeIncident:null,history:[recovered]},[open,escalated,reminded],{nowMs:Date.parse('2026-09-28T07:00:00Z'),adminCount:1});
  assert.equal(recovery.kind,'recovery');
  const recoveredSent = sentEvent(incident.incidentId,'recovery',incident.incidentId + ':recovery',[0],'2026-09-28T07:00:00Z');
  const duplicateRecovery = planProviderIncidentAlert({activeIncident:null,history:[recovered]},[open,escalated,reminded,recoveredSent],{nowMs:Date.parse('2026-09-28T07:15:00Z'),adminCount:1});
  assert.equal(duplicateRecovery.action,'none');
});

test('failed Telegram delivery is best effort, cooled down and bounded', async () => {
  const incident = {
    incidentId:'pslo-api-football-fail',
    active:true,
    state:'incident',
    highestState:'incident',
    severity:'incident',
    startedAt:'2026-09-28T10:00:00Z',
    durationMinutes:30,
    fingerprint:'api-football|/fixtures|provider_slo|pslo-api-football-fail',
    diagnostics:{primaryProvider:'api-football',primaryOperation:'/fixtures',sampleSize:20,errorRatePct:20,timeoutRatePct:10,rateLimitRatePct:0,avgAttemptLatencyMs:4000,reason:'timeout rate 10.0%'},
  };
  const report = {activeIncident:incident,history:[incident]};
  const plan = planProviderIncidentAlert(report,[],{nowMs:Date.parse('2026-09-28T10:30:00Z'),adminCount:1});
  let calls = 0;
  const delivery = await deliverProviderIncidentAlert({
    plan,
    adminTelegramIds:[123],
    sendMessage:async () => { calls += 1; return {ok:false,status:503,description:'temporary'}; },
    sleep:async () => {},
  });
  assert.equal(delivery.ok,false);
  assert.deepEqual(delivery.failedSlots,[0]);
  assert.equal(calls,2);

  const failed = providerIncidentAlertOpsEvent(plan,delivery);
  failed.created_at='2026-09-28T10:30:00Z';
  const cooldown = planProviderIncidentAlert(report,[failed],{nowMs:Date.parse('2026-09-28T10:45:00Z'),adminCount:1});
  assert.equal(cooldown.action,'none');
  assert.equal(cooldown.reason,'delivery_cooldown');

  const retry = planProviderIncidentAlert(report,[failed],{nowMs:Date.parse('2026-09-28T11:01:00Z'),adminCount:1});
  assert.equal(retry.action,'send');
  assert.deepEqual(retry.targetSlots,[0]);

  const failures = [1,2,3].map((n) => ({
    created_at:'2026-09-28T1' + (n - 1) + ':00:00Z',
    source:'provider_alert',
    code:'PROVIDER_SLO_ALERT_FAILED',
    metadata:{incidentId:incident.incidentId,alertKind:'incident',deliveryKey:incident.incidentId + ':incident',deliveredSlots:[],failedSlots:[0]},
  }));
  const exhausted = planProviderIncidentAlert(report,failures,{nowMs:Date.parse('2026-09-28T13:00:00Z'),adminCount:1});
  assert.equal(exhausted.action,'none');
  assert.equal(exhausted.reason,'delivery_exhausted');
});

test('partial delivery retries only the failed admin slot', async () => {
  const incident = {
    incidentId:'pslo-api-football-partial',
    active:true,
    state:'incident',
    highestState:'incident',
    severity:'incident',
    startedAt:'2026-09-28T10:00:00Z',
    durationMinutes:30,
    fingerprint:'api-football|/fixtures|provider_slo|pslo-api-football-partial',
    diagnostics:{primaryProvider:'api-football',primaryOperation:'/fixtures',sampleSize:20,errorRatePct:20,timeoutRatePct:10,rateLimitRatePct:0,avgAttemptLatencyMs:4000,reason:'timeout rate 10.0%'},
  };
  const report={activeIncident:incident,history:[incident]};
  const plan=planProviderIncidentAlert(report,[],{nowMs:Date.parse('2026-09-28T10:30:00Z'),adminCount:2});
  const delivery=await deliverProviderIncidentAlert({
    plan,
    adminTelegramIds:[111,222],
    sendMessage:async (id) => id === 111 ? {ok:true,status:200} : {ok:false,status:403,description:'forbidden'},
    sleep:async () => {},
  });
  assert.deepEqual(delivery.deliveredSlots,[0]);
  assert.deepEqual(delivery.failedSlots,[1]);
  const event=providerIncidentAlertOpsEvent(plan,delivery);
  event.created_at='2026-09-28T10:30:00Z';
  const retry=planProviderIncidentAlert(report,[event],{nowMs:Date.parse('2026-09-28T11:01:00Z'),adminCount:2});
  assert.deepEqual(retry.targetSlots,[1]);
});

test('restart reconstruction keeps incident id and persisted alert event suppresses duplicates', () => {
  const rows=[
    window('2026-09-28T10:00:00Z','incident'),
    window('2026-09-28T10:15:00Z','incident'),
    window('2026-09-28T10:30:00Z','incident'),
  ];
  const before=buildProviderSloIncidentTimeline(rows,{nowMs:Date.parse('2026-09-28T10:35:00Z')});
  const after=buildProviderSloIncidentTimeline(JSON.parse(JSON.stringify(rows)),{nowMs:Date.parse('2026-09-28T10:36:00Z')});
  assert.equal(after.activeIncident.incidentId,before.activeIncident.incidentId);
  const prior=[sentEvent(before.activeIncident.incidentId,'incident',before.activeIncident.incidentId + ':incident')];
  const plan=planProviderIncidentAlert(after,prior,{nowMs:Date.parse('2026-09-28T10:36:00Z'),adminCount:1});
  assert.equal(plan.action,'none');
});
