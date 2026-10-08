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

test('retry classifier rejects malformed clock/status coercion without throwing', () => {
  const result=classifyProviderIncidentTelegramResult(
    {ok:false,status:'429',retryAfter:'60',description:'rate limited'},
    true,
  );
  assert.equal(result.state,'retry_pending');
  assert.ok(Number.isFinite(Date.parse(result.retryAt)));
});

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



test('Telegram 429 always respects rate-limit retry even when a gateway incorrectly returns ok true',()=>{
  const now=Date.parse('2026-09-28T10:30:00Z');
  const result=classifyProviderIncidentTelegramResult(
    {ok:true,status:429,outcome:'sent',retryAfter:75,description:'rate-limited'},now,
  );
  assert.equal(result.state,'retry_pending');
  assert.equal(result.retryable,true);
  assert.equal(result.retryAt,'2026-09-28T10:31:15.000Z');
});

test('Telegram success requires consistent outcome and successful HTTP status',()=>{
  const now=Date.parse('2026-09-28T10:30:00Z');
  assert.equal(classifyProviderIncidentTelegramResult({ok:true,status:200,outcome:'sent'},now).state,'sent');
  assert.equal(classifyProviderIncidentTelegramResult({ok:true,status:201},now).state,'sent');
  assert.equal(classifyProviderIncidentTelegramResult({ok:true},now).state,'sent');
  assert.equal(classifyProviderIncidentTelegramResult({ok:true,status:0},now).state,'unknown');
  assert.equal(classifyProviderIncidentTelegramResult({ok:true,status:503},now).state,'retry_pending');
  assert.equal(classifyProviderIncidentTelegramResult({ok:true,status:400},now).state,'terminal_failed');
  assert.equal(classifyProviderIncidentTelegramResult({ok:true,status:200,outcome:'unknown'},now).state,'unknown');
  assert.equal(classifyProviderIncidentTelegramResult({ok:true,status:200,outcome:'not_started'},now).state,'terminal_failed');
});

test('contradictory 429 is durably deferred rather than marked as a sent incident alert',async()=>{
  let sent=0,finalized=null;
  const result=await deliverProviderIncidentAlert({
    plan:plan('retry-contradictory-success'),
    adminTelegramIds:[123],
    claimDelivery:async()=>({acquired:true,status:'sending',attempts:1}),
    finalizeDelivery:async input=>{finalized=input;return {ok:true,status:input.status};},
    sendMessage:async()=>{sent++;return {ok:true,status:429,outcome:'sent',retryAfter:30};},
    nowMs:Date.parse('2026-09-28T10:30:00Z'),
  });
  assert.equal(sent,1);
  assert.equal(result.ok,false);
  assert.equal(result.outcomes[0].state,'retry_pending');
  assert.equal(finalized.status,'retry_pending');
  assert.equal(finalized.retryAt,'2026-09-28T10:30:30.000Z');
});

test('Telegram Retry-After remains bounded and malformed values cannot overflow persisted timestamps',()=>{
  const now=Date.parse('2026-09-28T10:30:00Z');
  for(const value of [true,{},'0',-1,1.5,'NaN',Infinity]){
    const classified=classifyProviderIncidentTelegramResult({
      ok:false,status:429,retryAfter:value,
    },now);
    assert.equal(classified.retryAt,'2026-09-28T10:30:01.000Z');
  }
  const capped=classifyProviderIncidentTelegramResult({
    ok:false,status:429,retryAfter:999999999999,
  },now);
  assert.equal(capped.retryAt,'2026-10-05T10:30:00.000Z');
});
