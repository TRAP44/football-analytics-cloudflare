import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyDigestIncidentReport,
  dailyDigestIncidentAlertOpsEvents,
  formatDailyDigestIncidentAlert,
  planDailyDigestIncidentAlert,
  summarizeDailyDigestOperationalStatus,
} from '../src/daily-digest-incidents.js';
import { deliverOperationalIncidentAlert } from '../src/provider-incident-alerts.js';

const DATE='2026-09-29';

function event(at,code,metadata={},overrides={}) {
  return {
    created_at:at,
    severity:code==='DAILY_DIGEST_RUN_OK'?'info':'warning',
    source:'telegram',
    event_type:'daily_digest',
    code,
    metadata:{date:DATE,...metadata},
    ...overrides,
  };
}

function destination(slot=0) {
  return {slot,destinationKey:'digest-destination-'+String(slot).padStart(2,'0')};
}

function episodeAlertKey(incidentId,kind='incident',episode=1) {
  return episode>1 ? `${incidentId}:${kind}:${episode}` : `${incidentId}:${kind}`;
}

function ledgerRow(incidentId,kind='incident',status='sent',slot=0,episode=1,overrides={}) {
  return {
    incident_id:incidentId,
    transition:kind,
    alert_key:episodeAlertKey(incidentId,kind,episode),
    destination_key:destination(slot).destinationKey,
    destination_slot:slot,
    status,
    attempts:1,
    ...overrides,
  };
}

function memoryLedger() {
  const rows=new Map();
  const key=x=>String(x.alertKey)+'|'+String(x.destinationKey);
  return {
    rows,
    async claim(input) {
      const k=key(input);
      const row=rows.get(k);
      if (row) return {acquired:false,status:row.status,attempts:row.attempts,reason:'duplicate'};
      rows.set(k,{status:'sending',attempts:1});
      return {acquired:true,status:'sending',attempts:1,reason:'created'};
    },
    async finalize(input) {
      const k=key(input);
      const row=rows.get(k);
      if (!row || row.status!=='sending') return {ok:false,reason:'not_sending'};
      rows.set(k,{...row,status:input.status,retryAt:input.retryAt||null});
      return {ok:true,status:input.status,attempts:row.attempts};
    },
  };
}

test('late backlog opens the first backward-compatible date-scoped incident episode',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:25:00Z`,'DAILY_DIGEST_RUN_DEFERRED',{remaining:500}),
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:120,completionRate:0.88}),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});

  assert.equal(report.state,'incident');
  assert.equal(report.activeIncident.incidentId,'digest-'+DATE);
  assert.equal(report.activeIncident.episode,1);
  assert.equal(report.activeIncident.fingerprint,'daily_digest|'+DATE);
  assert.equal(report.activeIncident.diagnostics.remaining,120);

  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0)]});
  assert.equal(plan.alertKey,'digest-'+DATE+':incident');
});

test('sealed claims open the same first-episode incident identity',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:40:00Z`,'DAILY_DIGEST_SEALED_CLAIMS',{sealedClaims:2,oldestActiveClaimAgeMs:600000}),
  ],{nowMs:Date.parse(`${DATE}T07:45:00Z`)});

  assert.equal(report.activeIncident.incidentId,'digest-'+DATE);
  assert.equal(report.activeIncident.episode,1);
  assert.equal(report.activeIncident.diagnostics.sealedClaims,2);
});

test('first incident alert targets each valid admin destination once',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:12}),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});

  const plan=planDailyDigestIncidentAlert(report,[],{
    destinations:[
      {slot:true,destinationKey:'boolean-slot'},
      destination(0),
      {slot:0,destinationKey:'duplicate-slot'},
      destination(1),
      {slot:2,destinationKey:destination(1).destinationKey},
      {slot:'3',destinationKey:'  digest-destination-03  '},
      {slot:4,destinationKey:{bad:true}},
    ],
  });

  assert.equal(plan.action,'send');
  assert.equal(plan.kind,'incident');
  assert.deepEqual(plan.targetSlots,[0,1,3]);
  assert.deepEqual(plan.targetDeliveries,[
    destination(0),
    destination(1),
    destination(3),
  ]);
});

test('sent ledger rows suppress duplicate delivery for the same episode',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:12}),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});
  const id='digest-'+DATE;

  const plan=planDailyDigestIncidentAlert(
    report,
    [ledgerRow(id,'incident','sent',0)],
    {destinations:[destination(0)]},
  );

  assert.equal(plan.action,'none');
  assert.equal(plan.reason,'incident_alert_deduplicated');
});

test('healthy event closes the first episode and recovery keeps the legacy alert key',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:12}),
    event(`${DATE}T07:55:00Z`,'DAILY_DIGEST_RUN_OK',{remaining:0}),
  ],{nowMs:Date.parse(`${DATE}T08:00:00Z`)});

  assert.equal(report.state,'healthy');
  assert.equal(report.history.length,1);
  assert.equal(report.history[0].episode,1);
  assert.equal(report.history[0].recoveredAt,`${DATE}T07:55:00.000Z`);

  const id='digest-'+DATE;
  const plan=planDailyDigestIncidentAlert(
    report,
    [ledgerRow(id,'incident','sent',0)],
    {destinations:[destination(0)]},
  );

  assert.equal(plan.action,'send');
  assert.equal(plan.kind,'recovery');
  assert.equal(plan.alertKey,id+':recovery');
});

test('same-day relapse creates a new episode and is not suppressed by the first incident ledger',()=>{
  const id='digest-'+DATE;
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:40:00Z`,'DAILY_DIGEST_SEALED_CLAIMS',{sealedClaims:1}),
    event(`${DATE}T07:45:00Z`,'DAILY_DIGEST_RUN_OK',{remaining:0}),
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:9}),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});

  assert.equal(report.state,'incident');
  assert.equal(report.history.length,2);
  assert.equal(report.activeIncident.episode,2);
  assert.equal(report.activeIncident.startedAt,`${DATE}T07:50:00.000Z`);
  assert.equal(report.history[1].episode,1);
  assert.equal(report.history[1].state,'recovered');

  const plan=planDailyDigestIncidentAlert(
    report,
    [
      ledgerRow(id,'incident','sent',0,1),
      ledgerRow(id,'recovery','sent',0,1),
    ],
    {destinations:[destination(0)]},
  );

  assert.equal(plan.action,'send');
  assert.equal(plan.kind,'incident');
  assert.equal(plan.alertKey,id+':incident:2');
  assert.deepEqual(plan.targetSlots,[0]);
});

test('recovery for a repeated episode requires that episode incident alert and uses its own key',()=>{
  const id='digest-'+DATE;
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:40:00Z`,'DAILY_DIGEST_SEALED_CLAIMS',{sealedClaims:1}),
    event(`${DATE}T07:45:00Z`,'DAILY_DIGEST_RUN_OK',{remaining:0}),
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:9}),
    event(`${DATE}T07:55:00Z`,'DAILY_DIGEST_RUN_OK',{remaining:0}),
  ],{nowMs:Date.parse(`${DATE}T08:00:00Z`)});

  assert.equal(report.state,'healthy');
  assert.equal(report.history[0].episode,2);
  assert.equal(report.history[0].state,'recovered');

  const withoutSecondIncident=planDailyDigestIncidentAlert(
    report,
    [
      ledgerRow(id,'incident','sent',0,1),
      ledgerRow(id,'recovery','sent',0,1),
    ],
    {destinations:[destination(0)]},
  );
  assert.equal(withoutSecondIncident.action,'none');
  assert.equal(withoutSecondIncident.reason,'recovery_without_prior_incident_alert');

  const withSecondIncident=planDailyDigestIncidentAlert(
    report,
    [
      ledgerRow(id,'incident','sent',0,1),
      ledgerRow(id,'recovery','sent',0,1),
      ledgerRow(id,'incident','sent',0,2),
    ],
    {destinations:[destination(0)]},
  );
  assert.equal(withSecondIncident.action,'send');
  assert.equal(withSecondIncident.kind,'recovery');
  assert.equal(withSecondIncident.alertKey,id+':recovery:2');
});

test('recovery is not alerted when no matching incident alert was ever attempted',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:4}),
    event(`${DATE}T07:55:00Z`,'DAILY_DIGEST_RUN_OK',{remaining:0}),
  ],{nowMs:Date.parse(`${DATE}T08:00:00Z`)});

  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0)]});
  assert.equal(plan.action,'none');
  assert.equal(plan.reason,'recovery_without_prior_incident_alert');
});

test('operational delivery uses persistent claims and suppresses parallel duplicates',async()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:8}),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0)]});
  const store=memoryLedger();
  let sends=0;
  const sendMessage=async()=>{
    sends+=1;
    await Promise.resolve();
    return {ok:true,status:200,outcome:'sent'};
  };

  const results=await Promise.all([
    deliverOperationalIncidentAlert({
      plan,
      text:formatDailyDigestIncidentAlert(plan),
      adminTelegramIds:[101],
      claimDelivery:store.claim,
      finalizeDelivery:store.finalize,
      sendMessage,
    }),
    deliverOperationalIncidentAlert({
      plan,
      text:formatDailyDigestIncidentAlert(plan),
      adminTelegramIds:[101],
      claimDelivery:store.claim,
      finalizeDelivery:store.finalize,
      sendMessage,
    }),
  ]);

  assert.equal(sends,1);
  const states=results.flatMap(x=>x.outcomes.map(y=>y.state));
  assert.equal(states.filter(x=>x==='sent').length,1);
  assert.equal(states.filter(x=>x==='duplicate').length,1);
});

test('delivery fails closed when persistent claim or finalize primitives are unavailable',async()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:8}),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0)]});
  let sends=0;

  const result=await deliverOperationalIncidentAlert({
    plan,
    text:formatDailyDigestIncidentAlert(plan),
    adminTelegramIds:[101],
    sendMessage:async()=>{sends+=1; return {ok:true,status:200,outcome:'sent'};},
  });

  assert.equal(result.ok,false);
  assert.equal(result.failClosed,true);
  assert.equal(sends,0);
  assert.equal(result.outcomes[0].state,'persistence_failure');
});

test('partial admin delivery preserves sent and retry-pending outcomes independently',async()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_SEALED_CLAIMS',{sealedClaims:1}),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0),destination(1)]});
  const store=memoryLedger();

  const delivery=await deliverOperationalIncidentAlert({
    plan,
    text:formatDailyDigestIncidentAlert(plan),
    adminTelegramIds:[101,102],
    claimDelivery:store.claim,
    finalizeDelivery:store.finalize,
    sendMessage:async chatId=>chatId===101
      ? {ok:true,status:200,outcome:'sent'}
      : {ok:false,status:429,retryAfter:60,description:'rate limited'},
    nowMs:Date.parse(`${DATE}T08:00:00Z`),
  });

  assert.deepEqual(delivery.outcomes.map(x=>x.state),['sent','retry_pending']);
  const events=dailyDigestIncidentAlertOpsEvents(plan,delivery);
  assert.ok(events.some(x=>x.code==='DAILY_DIGEST_INCIDENT_ALERT_SENT'));
  assert.ok(events.some(x=>x.code==='DAILY_DIGEST_INCIDENT_ALERT_RETRY_PENDING'));
  assert.ok(events.every(x=>!JSON.stringify(x).includes('101')));
  assert.ok(events.every(x=>!JSON.stringify(x).includes('102')));
});

test('alert diagnostics preserve unknown rates as unknown instead of fabricating 100 percent',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{
      remaining:true,
      sealedClaims:false,
      failed:true,
      completionRate:true,
      oldestActiveClaimAgeMs:true,
    }),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0)]});

  assert.equal(report.activeIncident.diagnostics.remaining,0);
  assert.equal(report.activeIncident.diagnostics.failed,0);
  assert.equal(report.activeIncident.diagnostics.completionRate,null);

  const text=formatDailyDigestIncidentAlert(plan);
  assert.match(text,/Осталось получателей: 0/);
  assert.match(text,/Completion rate: —/);
  assert.doesNotMatch(text,/100\.0%/);

  const malformedRecovery=formatDailyDigestIncidentAlert({
    kind:'recovery',
    incident:{
      incidentId:'digest-test',
      date:DATE,
      recoveredAt:'not-a-date',
      durationMinutes:true,
    },
  });
  assert.match(malformedRecovery,/Восстановление: —/);
  assert.match(malformedRecovery,/Длительность: —/);
});

test('alert text carries valid actionable digest diagnostics without user identifiers',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{
      remaining:25,
      sealedClaims:2,
      failed:1,
      completionRate:0.9,
      oldestActiveClaimAgeMs:360000,
      telegram_id:123456789,
      chat_id:987654321,
    }),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0)]});
  const text=formatDailyDigestIncidentAlert(plan);

  assert.match(text,/Осталось получателей: 25/);
  assert.match(text,/Sealed claims: 2/);
  assert.match(text,/Completion rate: 90\.0%/);
  assert.doesNotMatch(text,/chat_id|telegram_id|123456789|987654321/i);
});

test('operational ledger counts malformed statuses as unknown attention instead of hiding them',()=>{
  const id='digest-'+DATE;
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:4}),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});

  const status=summarizeDailyDigestOperationalStatus(
    [
      event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:4}),
    ],
    [
      ledgerRow(id,'incident','sent',0),
      ledgerRow(id,'incident','mystery_state',1),
    ],
    {nowMs:Date.parse(`${DATE}T07:52:00Z`)},
  );

  assert.equal(report.activeIncident.incidentId,id);
  assert.equal(status.alertDelivery.rows,2);
  assert.equal(status.alertDelivery.states.sent,1);
  assert.equal(status.alertDelivery.states.unknown,1);
  assert.equal(status.alertDelivery.operationalAttention,1);
});
