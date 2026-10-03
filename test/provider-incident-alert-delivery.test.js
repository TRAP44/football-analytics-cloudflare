import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderSloIncidentTimeline } from '../src/provider-slo-incidents.js';
import {
  classifyProviderIncidentTelegramResult,
  deliverProviderIncidentAlert,
  planProviderIncidentAlert,
  providerIncidentAlertLedgerSummary,
  providerIncidentAlertOpsEvents,
  providerIncidentBotIdentity,
  providerIncidentDestinationKey,
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

function ledgerRow(incidentId, transition = 'incident', status = 'sent', options = {}) {
  return {
    incident_id:incidentId,
    transition,
    alert_key:options.alertKey || incidentId + ':' + transition,
    destination_key:options.destinationKey || 'destination-key-0001',
    destination_slot:Number(options.slot || 0),
    status,
    attempts:Number(options.attempts || 1),
    retry_at:options.retryAt || null,
    locked_until:options.lockedUntil || null,
    created_at:options.createdAt || '2026-09-28T11:00:00Z',
  };
}

function alertIncident(id = 'pslo-api-football-one', overrides = {}) {
  return {
    incidentId:id,
    active:true,
    state:'incident',
    highestState:'incident',
    severity:'incident',
    startedAt:'2026-09-28T10:00:00Z',
    durationMinutes:30,
    fingerprint:'api-football|/fixtures|provider_slo|' + id,
    diagnostics:{
      primaryProvider:'api-football',
      primaryOperation:'/fixtures',
      sampleSize:20,
      errorRatePct:20,
      timeoutRatePct:10,
      rateLimitRatePct:0,
      avgAttemptLatencyMs:4000,
      reason:'timeout rate 10.0%',
    },
    ...overrides,
  };
}

function deliveryPlan(id = 'pslo-api-football-delivery', targets = [0]) {
  const incident=alertIncident(id);
  return {
    action:'send',
    kind:'incident',
    incidentId:id,
    incident,
    alertKey:id + ':incident',
    deliveryKey:id + ':incident',
    targetDeliveries:targets.map(slot => ({
      slot,
      destinationKey:'destination-key-' + String(slot).padStart(4,'0'),
    })),
    targetSlots:[...targets],
  };
}

function memoryLedgerStore() {
  const rows=new Map();
  const key=input => String(input.alertKey) + '|' + String(input.destinationKey);
  return {
    rows,
    async claim(input) {
      const k=key(input);
      const existing=rows.get(k);
      if (existing) {
        return {
          acquired:false,
          status:existing.status,
          attempts:existing.attempts,
          retryAt:existing.retryAt || null,
          reason:'duplicate',
        };
      }
      rows.set(k,{status:'sending',attempts:1,retryAt:null});
      return {acquired:true,status:'sending',attempts:1,reason:'created'};
    },
    async finalize(input) {
      const k=key(input);
      const existing=rows.get(k);
      if (!existing || existing.status !== 'sending') return {ok:false,reason:'not_sending'};
      rows.set(k,{
        ...existing,
        status:input.status,
        retryAt:input.retryAt || null,
      });
      return {ok:true,status:input.status,attempts:existing.attempts,retryAt:input.retryAt || null};
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

test('watch never sends an incident alert and a sent ledger row suppresses the duplicate', () => {
  const watchIncident={
    incidentId:'pslo-api-football-watch',
    active:true,
    state:'watch',
    highestState:'watch',
    severity:'warning',
  };
  const destinations=[{slot:0,destinationKey:'destination-key-0001'}];
  assert.equal(
    planProviderIncidentAlert({activeIncident:watchIncident,history:[watchIncident]},[],{destinations}).action,
    'none'
  );

  const incident=alertIncident();
  const report={activeIncident:incident,history:[incident]};
  const first=planProviderIncidentAlert(report,[],{nowMs:Date.parse('2026-09-28T10:30:00Z'),destinations});
  assert.equal(first.action,'send');
  assert.equal(first.kind,'incident');
  assert.equal(first.alertKey,incident.incidentId + ':incident');

  const prior=[ledgerRow(incident.incidentId)];
  const duplicate=planProviderIncidentAlert(report,prior,{nowMs:Date.parse('2026-09-28T10:45:00Z'),destinations});
  assert.equal(duplicate.action,'none');
  assert.equal(duplicate.reason,'incident_alert_deduplicated');
});

test('retry_pending reuses the same stable row and cannot run before retry_at', () => {
  const incident=alertIncident('pslo-api-football-retry');
  const destinations=[{slot:0,destinationKey:'destination-key-0001'}];
  const row=ledgerRow(incident.incidentId,'incident','retry_pending',{
    attempts:1,
    retryAt:'2026-09-28T10:31:00Z',
  });
  const early=planProviderIncidentAlert({activeIncident:incident,history:[incident]},[row],{
    nowMs:Date.parse('2026-09-28T10:30:00Z'),
    destinations,
  });
  assert.equal(early.action,'none');
  assert.equal(early.reason,'delivery_waiting');

  const due=planProviderIncidentAlert({activeIncident:incident,history:[incident]},[row],{
    nowMs:Date.parse('2026-09-28T10:32:00Z'),
    destinations,
  });
  assert.equal(due.action,'send');
  assert.equal(due.alertKey,incident.incidentId + ':incident');
  assert.equal(due.attempt,2);
  assert.deepEqual(due.targetSlots,[0]);
});

test('unknown and terminal_failed states never blind-retry', () => {
  const incident=alertIncident('pslo-api-football-unknown');
  const destinations=[{slot:0,destinationKey:'destination-key-0001'}];
  for (const status of ['unknown','terminal_failed']) {
    const plan=planProviderIncidentAlert(
      {activeIncident:incident,history:[incident]},
      [ledgerRow(incident.incidentId,'incident',status)],
      {nowMs:Date.parse('2026-09-28T12:00:00Z'),destinations}
    );
    assert.equal(plan.action,'none');
    assert.equal(plan.reason,'delivery_exhausted');
  }
});

test('OPEN and RECOVERY have separate identities and a new generation gets a new alert identity', () => {
  const first=alertIncident('pslo-api-football-generation-one');
  const destinationKey='destination-key-0001';
  const destinations=[{slot:0,destinationKey}];
  const open=ledgerRow(first.incidentId,'incident','sent',{destinationKey});
  const recovered={...first,active:false,state:'recovered',recoveredAt:'2026-09-28T11:00:00Z',durationMinutes:60};
  const recovery=planProviderIncidentAlert({activeIncident:null,history:[recovered]},[open],{destinations});
  assert.equal(recovery.action,'send');
  assert.equal(recovery.kind,'recovery');
  assert.equal(recovery.alertKey,first.incidentId + ':recovery');

  const recoverySent=ledgerRow(first.incidentId,'recovery','sent',{
    destinationKey,
    alertKey:first.incidentId + ':recovery',
  });
  const duplicateRecovery=planProviderIncidentAlert(
    {activeIncident:null,history:[recovered]},
    [open,recoverySent],
    {destinations}
  );
  assert.equal(duplicateRecovery.action,'none');

  const next=alertIncident('pslo-api-football-generation-two');
  const nextPlan=planProviderIncidentAlert({activeIncident:next,history:[recovered,next]},[open,recoverySent],{destinations});
  assert.equal(nextPlan.action,'send');
  assert.equal(nextPlan.alertKey,next.incidentId + ':incident');
  assert.notEqual(nextPlan.alertKey,first.incidentId + ':incident');
});

test('all-success delivery claims once and finalizes sent', async () => {
  const store=memoryLedgerStore();
  let sends=0;
  const result=await deliverProviderIncidentAlert({
    plan:deliveryPlan('pslo-success'),
    adminTelegramIds:[101],
    claimDelivery:store.claim,
    finalizeDelivery:store.finalize,
    sendMessage:async () => {
      sends += 1;
      return {ok:true,status:200,outcome:'sent'};
    },
    nowMs:Date.parse('2026-09-28T10:30:00Z'),
  });
  assert.equal(result.ok,true);
  assert.equal(sends,1);
  assert.deepEqual(result.deliveredSlots,[0]);
  assert.equal([...store.rows.values()][0].status,'sent');
});

test('parallel executions allow exactly one owner and suppress duplicates', async () => {
  const store=memoryLedgerStore();
  let sends=0;
  const plan=deliveryPlan('pslo-concurrency');
  const sendMessage=async () => {
    sends += 1;
    await Promise.resolve();
    return {ok:true,status:200,outcome:'sent'};
  };
  const results=await Promise.all([
    deliverProviderIncidentAlert({
      plan,
      adminTelegramIds:[101],
      claimDelivery:store.claim,
      finalizeDelivery:store.finalize,
      sendMessage,
    }),
    deliverProviderIncidentAlert({
      plan,
      adminTelegramIds:[101],
      claimDelivery:store.claim,
      finalizeDelivery:store.finalize,
      sendMessage,
    }),
    deliverProviderIncidentAlert({
      plan,
      adminTelegramIds:[101],
      claimDelivery:store.claim,
      finalizeDelivery:store.finalize,
      sendMessage,
    }),
  ]);
  assert.equal(sends,1);
  const states=results.flatMap(result => result.outcomes.map(item => item.state));
  assert.equal(states.filter(state => state === 'sent').length,1);
  assert.equal(states.filter(state => state === 'duplicate').length,2);
});

test('unconfirmed claim result and rejected claim both fail closed without Telegram delivery', async () => {
  for (const claimDelivery of [
    async () => ({ok:false}),
    async () => { throw new Error('database unavailable'); },
  ]) {
    let sends=0;
    const result=await deliverProviderIncidentAlert({
      plan:deliveryPlan('pslo-persistence-' + sends),
      adminTelegramIds:[101],
      claimDelivery,
      finalizeDelivery:async () => ({ok:true}),
      sendMessage:async () => {
        sends += 1;
        return {ok:true,status:200};
      },
    });
    assert.equal(sends,0);
    assert.equal(result.ok,false);
    assert.equal(result.outcomes[0].state,'persistence_failure');
  }
});

test('rejected Telegram Promise is unknown, is finalized once and is never retried in-process', async () => {
  const store=memoryLedgerStore();
  let sends=0;
  const result=await deliverProviderIncidentAlert({
    plan:deliveryPlan('pslo-ambiguous'),
    adminTelegramIds:[101],
    claimDelivery:store.claim,
    finalizeDelivery:store.finalize,
    sendMessage:async () => {
      sends += 1;
      throw new Error('response connection lost');
    },
  });
  assert.equal(sends,1);
  assert.equal(result.ok,false);
  assert.equal(result.outcomes[0].state,'unknown');
  assert.equal([...store.rows.values()][0].status,'unknown');
});

test('Telegram 429, confirmed temporary failure and terminal failure have distinct states', () => {
  const now=Date.parse('2026-09-28T10:30:00Z');
  const rate=classifyProviderIncidentTelegramResult({ok:false,status:429,retryAfter:75,description:'rate limited'},now);
  assert.equal(rate.state,'retry_pending');
  assert.equal(rate.retryAt,'2026-09-28T10:31:15.000Z');

  const temporary=classifyProviderIncidentTelegramResult({ok:false,status:503,description:'unavailable'},now);
  assert.equal(temporary.state,'retry_pending');
  assert.equal(temporary.retryAt,'2026-09-28T11:00:00.000Z');

  const terminal=classifyProviderIncidentTelegramResult({ok:false,status:403,description:'forbidden'},now);
  assert.equal(terminal.state,'terminal_failed');

  const unknown=classifyProviderIncidentTelegramResult({ok:false,status:0,outcome:'unknown',description:'network'},now);
  assert.equal(unknown.state,'unknown');
});

test('Telegram 429 persists retry time and performs no immediate resend', async () => {
  const store=memoryLedgerStore();
  let sends=0;
  const result=await deliverProviderIncidentAlert({
    plan:deliveryPlan('pslo-429'),
    adminTelegramIds:[101],
    claimDelivery:store.claim,
    finalizeDelivery:store.finalize,
    sendMessage:async () => {
      sends += 1;
      return {ok:false,status:429,retryAfter:60,description:'Too Many Requests'};
    },
    nowMs:Date.parse('2026-09-28T10:30:00Z'),
  });
  assert.equal(sends,1);
  assert.equal(result.outcomes[0].state,'retry_pending');
  assert.equal(result.outcomes[0].retryAt,'2026-09-28T10:31:00.000Z');
  const row=[...store.rows.values()][0];
  assert.equal(row.status,'retry_pending');
  assert.equal(row.retryAt,'2026-09-28T10:31:00.000Z');
});

test('one failed recipient does not erase sent, duplicate or unknown outcomes', async () => {
  const plan=deliveryPlan('pslo-mixed',[0,1,2,3]);
  const states=new Map();
  const result=await deliverProviderIncidentAlert({
    plan,
    adminTelegramIds:[101,102,103,104],
    claimDelivery:async input => {
      if (input.destinationSlot === 2) return {acquired:false,status:'sent',attempts:1,reason:'already_sent'};
      states.set(input.destinationSlot,'sending');
      return {acquired:true,status:'sending',attempts:1};
    },
    finalizeDelivery:async input => {
      const slot=Number(input.destinationKey.slice(-4));
      states.set(slot,input.status);
      return {ok:true,status:input.status};
    },
    sendMessage:async chatId => {
      if (chatId === 101) return {ok:true,status:200,outcome:'sent'};
      if (chatId === 102) return {ok:false,status:503,outcome:'confirmed_failure',description:'temporary'};
      if (chatId === 104) throw new Error('ambiguous transport');
      assert.fail('duplicate slot must not send');
    },
    nowMs:Date.parse('2026-09-28T10:30:00Z'),
  });
  assert.deepEqual(result.outcomes.map(item => item.state),['sent','retry_pending','duplicate','unknown']);
  const events=providerIncidentAlertOpsEvents(plan,result);
  const codes=new Set(events.map(event => event.code));
  assert.ok(codes.has('PROVIDER_SLO_ALERT_SENT'));
  assert.ok(codes.has('PROVIDER_SLO_ALERT_RETRY_PENDING'));
  assert.ok(codes.has('PROVIDER_SLO_ALERT_DUPLICATE_SUPPRESSED'));
  assert.ok(codes.has('PROVIDER_SLO_ALERT_UNKNOWN'));
});

test('ledger summary exposes unknown and recoverable operational states', () => {
  const rows=[
    ledgerRow('one','incident','sent'),
    ledgerRow('two','incident','retry_pending',{destinationKey:'destination-key-0002'}),
    ledgerRow('three','incident','unknown',{destinationKey:'destination-key-0003'}),
    ledgerRow('four','incident','terminal_failed',{destinationKey:'destination-key-0004'}),
  ];
  const summary=providerIncidentAlertLedgerSummary(rows);
  assert.equal(summary.rows,4);
  assert.equal(summary.states.sent,1);
  assert.equal(summary.states.retry_pending,1);
  assert.equal(summary.states.unknown,1);
  assert.equal(summary.states.terminal_failed,1);
  assert.equal(summary.operationalAttention,3);
});


test('active alert lease blocks while an expired claimed lease becomes reclaimable', () => {
  const incident=alertIncident('pslo-lease-reclaim');
  const destinations=[{slot:0,destinationKey:'destination-key-0001'}];
  const report={activeIncident:incident,history:[incident]};

  const active=planProviderIncidentAlert(report,[
    ledgerRow(incident.incidentId,'incident','claimed',{
      lockedUntil:'2026-09-28T10:35:00Z',
    }),
  ],{
    nowMs:Date.parse('2026-09-28T10:30:00Z'),
    destinations,
  });
  assert.equal(active.action,'none');
  assert.equal(active.reason,'delivery_waiting');

  const stale=planProviderIncidentAlert(report,[
    ledgerRow(incident.incidentId,'incident','claimed',{
      lockedUntil:'2026-09-28T10:29:59Z',
    }),
  ],{
    nowMs:Date.parse('2026-09-28T10:30:00Z'),
    destinations,
  });
  assert.equal(stale.action,'send');
  assert.deepEqual(stale.targetSlots,[0]);
});

test('expired sending lease is sent back to the database for unknown-state reconciliation, not blind resend', () => {
  const incident=alertIncident('pslo-stale-sending');
  const destinations=[{slot:0,destinationKey:'destination-key-0001'}];
  const plan=planProviderIncidentAlert(
    {activeIncident:incident,history:[incident]},
    [ledgerRow(incident.incidentId,'incident','sending',{lockedUntil:'2026-09-28T10:29:59Z'})],
    {nowMs:Date.parse('2026-09-28T10:30:00Z'),destinations},
  );
  assert.equal(plan.action,'send');
  assert.deepEqual(plan.targetSlots,[0]);
});

test('v2 two-phase alert delivery begins durable sending state before Telegram side effects', async () => {
  const order=[];
  let sends=0;
  const result=await deliverProviderIncidentAlert({
    plan:deliveryPlan('pslo-two-phase'),
    adminTelegramIds:[101],
    claimDelivery:async () => {
      order.push('claim');
      return {acquired:true,status:'claimed',attempts:1,reason:'created'};
    },
    beginDelivery:async () => {
      order.push('begin');
      return {ok:true,status:'sending',attempts:1};
    },
    finalizeDelivery:async input => {
      order.push('finalize:'+input.status);
      return {ok:true,status:input.status};
    },
    sendMessage:async () => {
      order.push('send');
      sends+=1;
      return {ok:true,status:200,outcome:'sent'};
    },
  });
  assert.equal(result.ok,true);
  assert.equal(sends,1);
  assert.deepEqual(order,['claim','begin','send','finalize:sent']);
});

test('unconfirmed begin-send transition fails closed before Telegram delivery', async () => {
  let sends=0;
  const result=await deliverProviderIncidentAlert({
    plan:deliveryPlan('pslo-begin-fail'),
    adminTelegramIds:[101],
    claimDelivery:async () => ({acquired:true,status:'claimed',attempts:1}),
    beginDelivery:async () => ({ok:false,status:'claimed',reason:'claim_lease_expired'}),
    finalizeDelivery:async () => ({ok:true}),
    sendMessage:async () => {
      sends+=1;
      return {ok:true,status:200};
    },
  });
  assert.equal(sends,0);
  assert.equal(result.ok,false);
  assert.equal(result.outcomes[0].state,'persistence_failure');
  assert.equal(result.outcomes[0].reason,'claim_lease_expired');
});

test('provider incident destination identity survives bot-token rotation', async () => {
  const firstIdentity=providerIncidentBotIdentity('123456789:old-token-material');
  const rotatedIdentity=providerIncidentBotIdentity('123456789:new-token-material');
  assert.equal(firstIdentity,'telegram-bot:123456789');
  assert.equal(rotatedIdentity,firstIdentity);
  const before=await providerIncidentDestinationKey(987654321,firstIdentity);
  const after=await providerIncidentDestinationKey(987654321,rotatedIdentity);
  assert.equal(after,before);
  assert.equal(before.length,40);
});
