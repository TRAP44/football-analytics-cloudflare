import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyDigestIncidentReport,
  dailyDigestIncidentAlertOpsEvents,
  formatDailyDigestIncidentAlert,
  planDailyDigestIncidentAlert,
} from '../src/daily-digest-incidents.js';
import { deliverOperationalIncidentAlert } from '../src/provider-incident-alerts.js';

const DATE='2026-09-29';

function event(at,code,metadata={}) {
  return {
    created_at:at,
    severity:code==='DAILY_DIGEST_RUN_OK'?'info':'warning',
    source:'telegram',
    event_type:'daily_digest',
    code,
    metadata:{date:DATE,...metadata},
  };
}

function destination(slot=0) {
  return {slot,destinationKey:'digest-destination-'+String(slot).padStart(2,'0')};
}

function ledgerRow(incidentId,kind='incident',status='sent',slot=0) {
  return {
    incident_id:incidentId,
    transition:kind,
    alert_key:incidentId+':'+kind,
    destination_key:destination(slot).destinationKey,
    destination_slot:slot,
    status,
    attempts:1,
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

test('A. late backlog opens a stable daily digest incident for that delivery date',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:25:00Z`,'DAILY_DIGEST_RUN_DEFERRED',{remaining:500}),
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:120,completionRate:0.88}),
  ],{nowMs:Date.parse(`${DATE}T07:52:00Z`)});

  assert.equal(report.state,'incident');
  assert.equal(report.activeIncident.incidentId,'digest-'+DATE);
  assert.equal(report.activeIncident.diagnostics.remaining,120);
});

test('B. sealed claims also open the same date-scoped incident identity',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:40:00Z`,'DAILY_DIGEST_SEALED_CLAIMS',{sealedClaims:2,oldestActiveClaimAgeMs:600000}),
  ]);
  assert.equal(report.activeIncident.incidentId,'digest-'+DATE);
  assert.equal(report.activeIncident.diagnostics.sealedClaims,2);
});

test('C. first incident alert targets every admin destination once',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:12}),
  ]);
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0),destination(1)]});
  assert.equal(plan.action,'send');
  assert.equal(plan.kind,'incident');
  assert.deepEqual(plan.targetSlots,[0,1]);
  assert.equal(plan.alertKey,'digest-'+DATE+':incident');
});

test('D. sent ledger rows suppress duplicate incident delivery',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:12}),
  ]);
  const id='digest-'+DATE;
  const plan=planDailyDigestIncidentAlert(
    report,
    [ledgerRow(id,'incident','sent',0)],
    {destinations:[destination(0)]},
  );
  assert.equal(plan.action,'none');
  assert.equal(plan.reason,'incident_alert_deduplicated');
});

test('E. healthy event after incident produces one recovery plan',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:12}),
    event(`${DATE}T07:55:00Z`,'DAILY_DIGEST_RUN_OK',{remaining:0}),
  ],{nowMs:Date.parse(`${DATE}T08:00:00Z`)});
  assert.equal(report.state,'healthy');
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

test('F. recovery is not alerted when no incident alert was ever attempted',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:4}),
    event(`${DATE}T07:55:00Z`,'DAILY_DIGEST_RUN_OK',{remaining:0}),
  ]);
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0)]});
  assert.equal(plan.action,'none');
  assert.equal(plan.reason,'recovery_without_prior_incident_alert');
});

test('G. operational delivery uses persistent claims and suppresses parallel duplicates', async()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:8}),
  ]);
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0)]});
  const store=memoryLedger();
  let sends=0;
  const sendMessage=async()=>{sends+=1; await Promise.resolve(); return {ok:true,status:200,outcome:'sent'};};
  const results=await Promise.all([
    deliverOperationalIncidentAlert({plan,text:formatDailyDigestIncidentAlert(plan),adminTelegramIds:[101],claimDelivery:store.claim,finalizeDelivery:store.finalize,sendMessage}),
    deliverOperationalIncidentAlert({plan,text:formatDailyDigestIncidentAlert(plan),adminTelegramIds:[101],claimDelivery:store.claim,finalizeDelivery:store.finalize,sendMessage}),
  ]);
  assert.equal(sends,1);
  const states=results.flatMap(x=>x.outcomes.map(y=>y.state));
  assert.equal(states.filter(x=>x==='sent').length,1);
  assert.equal(states.filter(x=>x==='duplicate').length,1);
});

test('H. partial admin delivery preserves sent and retry-pending outcomes independently', async()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_SEALED_CLAIMS',{sealedClaims:1}),
  ]);
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0),destination(1)]});
  const store=memoryLedger();
  const delivery=await deliverOperationalIncidentAlert({
    plan,
    text:formatDailyDigestIncidentAlert(plan),
    adminTelegramIds:[101,102],
    claimDelivery:store.claim,
    finalizeDelivery:store.finalize,
    sendMessage:async chatId => chatId===101
      ? {ok:true,status:200,outcome:'sent'}
      : {ok:false,status:429,retryAfter:60,description:'rate limited'},
    nowMs:Date.parse(`${DATE}T08:00:00Z`),
  });
  assert.deepEqual(delivery.outcomes.map(x=>x.state),['sent','retry_pending']);
  const events=dailyDigestIncidentAlertOpsEvents(plan,delivery);
  assert.ok(events.some(x=>x.code==='DAILY_DIGEST_INCIDENT_ALERT_SENT'));
  assert.ok(events.some(x=>x.code==='DAILY_DIGEST_INCIDENT_ALERT_RETRY_PENDING'));
});

test('I. alert text carries actionable digest diagnostics without user identifiers',()=>{
  const report=buildDailyDigestIncidentReport([
    event(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{
      remaining:25,sealedClaims:2,failed:1,completionRate:0.9,oldestActiveClaimAgeMs:360000,
    }),
  ]);
  const plan=planDailyDigestIncidentAlert(report,[],{destinations:[destination(0)]});
  const text=formatDailyDigestIncidentAlert(plan);
  assert.match(text,/Осталось получателей: 25/);
  assert.match(text,/Sealed claims: 2/);
  assert.match(text,/Completion rate: 90\.0%/);
  assert.doesNotMatch(text,/chat_id|telegram_id/i);
});
