import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProviderIncidentTelegramResult,
  deliverProviderIncidentAlert,
  planProviderIncidentAlert,
} from '../src/provider-incident-alerts.js';

function plan(id = 'retry-after-test') {
  return {
    action:'send',
    kind:'incident',
    incidentId:id,
    alertKey:id + ':incident',
    deliveryKey:id + ':incident',
    incident:{
      incidentId:id,
      active:true,
      state:'incident',
      highestState:'incident',
      severity:'incident',
      diagnostics:{primaryProvider:'api-football',primaryOperation:'/fixtures'},
    },
    targetDeliveries:[{slot:0,destinationKey:'destination-key-0001'}],
    targetSlots:[0],
  };
}

test('Telegram 429 persists the full retry_after and never retries immediately', async () => {
  let calls=0;
  let finalized=null;
  const result=await deliverProviderIncidentAlert({
    plan:plan(),
    adminTelegramIds:[123],
    claimDelivery:async () => ({acquired:true,status:'sending',attempts:1}),
    finalizeDelivery:async input => {
      finalized=input;
      return {ok:true,status:input.status};
    },
    sendMessage:async () => {
      calls += 1;
      return {ok:false,status:429,retryAfter:75,description:'Too Many Requests'};
    },
    nowMs:Date.parse('2026-09-28T10:30:00Z'),
  });
  assert.equal(calls,1);
  assert.equal(result.outcomes[0].state,'retry_pending');
  assert.equal(finalized.status,'retry_pending');
  assert.equal(finalized.retryAt,'2026-09-28T10:31:15.000Z');
});

test('retry_pending remains suppressed until its persisted retry_at and then reuses the same key', () => {
  const p=plan('retry-due-test');
  const report={activeIncident:p.incident,history:[p.incident]};
  const row={
    incident_id:p.incidentId,
    transition:'incident',
    alert_key:p.alertKey,
    destination_key:'destination-key-0001',
    destination_slot:0,
    status:'retry_pending',
    attempts:1,
    retry_at:'2026-09-28T10:31:15.000Z',
  };
  const destinations=[{slot:0,destinationKey:'destination-key-0001'}];

  const early=planProviderIncidentAlert(report,[row],{
    nowMs:Date.parse('2026-09-28T10:31:14Z'),
    destinations,
  });
  assert.equal(early.action,'none');
  assert.equal(early.reason,'delivery_waiting');

  const due=planProviderIncidentAlert(report,[row],{
    nowMs:Date.parse('2026-09-28T10:31:15Z'),
    destinations,
  });
  assert.equal(due.action,'send');
  assert.equal(due.alertKey,p.alertKey);
  assert.equal(due.attempt,2);
});

test('ambiguous status zero is unknown while explicit pre-send config failure is terminal', () => {
  const unknown=classifyProviderIncidentTelegramResult({
    ok:false,
    status:0,
    outcome:'unknown',
    description:'response lost',
  });
  assert.equal(unknown.state,'unknown');
  assert.equal(unknown.retryable,false);

  const notStarted=classifyProviderIncidentTelegramResult({
    ok:false,
    status:0,
    outcome:'not_started',
    description:'bot token missing',
  });
  assert.equal(notStarted.state,'terminal_failed');
  assert.equal(notStarted.retryable,false);
});
