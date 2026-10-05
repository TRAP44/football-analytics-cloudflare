import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPostDeployRegressionAlert,
  planPostDeployRegressionAlert,
  postDeployRegressionAlertOpsEvents,
  postDeployRegressionIncidentId,
} from '../src/post-deploy-regression-alerts.js';

const sha='a'.repeat(40);
const otherSha='b'.repeat(40);
const destinations=[
  {slot:0,destinationKey:'destination-a'},
  {slot:1,destinationKey:'destination-b'},
];

function lifecycle(state,at='2026-09-29T15:00:00Z',deploySha=sha,overrides={}){
  return {
    id:overrides.id||1,
    created_at:at,
    source:'release_regression',
    event_type:'post_deploy_regression',
    code:state==='incident'
      ? 'POST_DEPLOY_REGRESSION_INCIDENT'
      : state==='recovered'
        ? 'POST_DEPLOY_REGRESSION_RECOVERED'
        : 'POST_DEPLOY_REGRESSION_WATCH',
    metadata:{
      deploySha,
      lifecycleState:state,
      windowMinutes:overrides.windowMinutes||15,
      signalCodes:overrides.signalCodes||['auth_failures_increased'],
      releaseCandidate:'RC144',
      appVersion:'6.120.0-rc144',
    },
  };
}

function ledger(kind,status='sent',destinationKey='destination-a',overrides={}){
  const incidentId=postDeployRegressionIncidentId(overrides.deploySha||sha);
  return {
    incident_id:incidentId,
    transition:kind,
    alert_key:incidentId+':'+kind,
    destination_key:destinationKey,
    status,
    attempts:overrides.attempts??1,
    retry_at:overrides.retryAt||null,
  };
}

test('post-deploy alert planning rejects malformed deployment identities and deduplicates destinations',()=>{
  assert.equal(postDeployRegressionIncidentId('not-a-sha'),'');
  assert.equal(postDeployRegressionIncidentId(true),'');

  const invalid=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    [],
    {deploySha:'not-a-sha',destinations},
  );
  assert.deepEqual(invalid,{action:'none',reason:'deployment_identity_unavailable'});

  const plan=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    [],
    {
      deploySha:sha.toUpperCase(),
      destinations:[
        {slot:0,destinationKey:'destination-a'},
        {slot:'0',destinationKey:'duplicate-slot'},
        {slot:1,destinationKey:'destination-a'},
        {slot:true,destinationKey:'coerced-slot'},
        {slot:2,destinationKey:'destination-c'},
      ],
    },
  );
  assert.equal(plan.action,'send');
  assert.deepEqual(plan.targetSlots,[0,2]);
  assert.deepEqual(plan.targetDeliveries.map(item=>item.destinationKey),['destination-a','destination-c']);
});

test('post-deploy alert planning ignores malformed lifecycle rows instead of corrupting the latest state',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z'),
    lifecycle('recovered','not-a-date'),
    lifecycle('watch','2026-09-29T15:10:00Z',sha,{id:3}),
  ];
  history.push({
    source:'release_regression',
    event_type:'post_deploy_regression',
    created_at:'2026-09-29T15:20:00Z',
    metadata:{deploySha:sha,lifecycleState:'INCIDENT_WRONG',windowMinutes:30},
  });
  const plan=planPostDeployRegressionAlert(history,[],{deploySha:sha,destinations});
  assert.equal(plan.action,'none');
  assert.equal(plan.reason,'watch_not_alertable');
});

test('WATCH remains observable but never sends an admin alert',()=>{
  const plan=planPostDeployRegressionAlert(
    [lifecycle('watch')],
    [],
    {deploySha:sha,destinations},
  );
  assert.deepEqual(plan,{action:'none',reason:'watch_not_alertable'});
});

test('first persisted INCIDENT targets all configured admin destinations once',()=>{
  const plan=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    [],
    {deploySha:sha,destinations},
  );
  assert.equal(plan.action,'send');
  assert.equal(plan.kind,'incident');
  assert.equal(plan.incidentId,'release-regression:'+sha);
  assert.deepEqual(plan.targetSlots,[0,1]);
  assert.deepEqual(plan.incident.signalCodes,['auth_failures_increased']);
});

test('planned INCIDENT can be alerted in the same monitor run after lifecycle persistence',()=>{
  const planned={
    action:'record',
    code:'POST_DEPLOY_REGRESSION_INCIDENT',
    meta:{
      deploySha:sha,
      lifecycleState:'incident',
      windowMinutes:30,
      signalCodes:['critical_introduced'],
    },
  };
  const plan=planPostDeployRegressionAlert(
    [lifecycle('watch')],
    [],
    {deploySha:sha,plannedTransition:planned,destinations,nowMs:Date.parse('2026-09-29T15:30:00Z')},
  );
  assert.equal(plan.action,'send');
  assert.equal(plan.kind,'incident');
  assert.equal(plan.incident.windowMinutes,30);
  assert.equal(plan.incident.startedAt,'2026-09-29T15:30:00.000Z');
  assert.deepEqual(plan.incident.signalCodes,['critical_introduced']);
});

test('sent incident destinations are durably deduplicated',()=>{
  const plan=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    [ledger('incident','sent','destination-a'),ledger('incident','sent','destination-b')],
    {deploySha:sha,destinations},
  );
  assert.equal(plan.action,'none');
  assert.equal(plan.reason,'already_delivered');
});

test('expired claimed/sending leases are retryable instead of suppressing alerts forever',()=>{
  for(const status of ['claimed','sending']){
    const due=planPostDeployRegressionAlert(
      [lifecycle('incident')],
      [{
        ...ledger('incident',status,'destination-a',{attempts:1}),
        locked_until:'2026-09-29T15:20:00Z',
      }],
      {deploySha:sha,destinations:[destinations[0]],nowMs:Date.parse('2026-09-29T15:30:00Z')},
    );
    assert.equal(due.action,'send');
    assert.deepEqual(due.targetSlots,[0]);

    const waiting=planPostDeployRegressionAlert(
      [lifecycle('incident')],
      [{
        ...ledger('incident',status,'destination-a',{attempts:1}),
        locked_until:'2026-09-29T16:00:00Z',
      }],
      {deploySha:sha,destinations:[destinations[0]],nowMs:Date.parse('2026-09-29T15:30:00Z')},
    );
    assert.equal(waiting.action,'none');
    assert.equal(waiting.reason,'delivery_waiting');
  }
});

test('delivery planner uses the newest ledger row for a destination',()=>{
  const plan=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    [
      {...ledger('incident','sending','destination-a',{attempts:1}),updated_at:'2026-09-29T15:00:00Z',locked_until:'2026-09-29T16:00:00Z'},
      {...ledger('incident','sent','destination-a',{attempts:2}),updated_at:'2026-09-29T15:10:00Z'},
    ],
    {deploySha:sha,destinations:[destinations[0]],nowMs:Date.parse('2026-09-29T15:30:00Z')},
  );
  assert.equal(plan.action,'none');
  assert.equal(plan.reason,'already_delivered');
});

test('malformed ledger attempts fail closed instead of triggering duplicate retries',()=>{
  for(const attempts of [true,[1],'1.5','not-a-number']){
    const plan=planPostDeployRegressionAlert(
      [lifecycle('incident')],
      [ledger('incident','retry_pending','destination-a',{attempts,retryAt:'2026-09-29T15:20:00Z'})],
      {deploySha:sha,destinations:[destinations[0]],nowMs:Date.parse('2026-09-29T15:30:00Z')},
    );
    assert.equal(plan.action,'none');
    assert.equal(plan.reason,'delivery_outcome_unknown');
  }
});

test('retry_pending waits until retryAt and then targets only the due destination',()=>{
  const future=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    [
      ledger('incident','retry_pending','destination-a',{attempts:1,retryAt:'2026-09-29T16:00:00Z'}),
      ledger('incident','sent','destination-b'),
    ],
    {deploySha:sha,destinations,nowMs:Date.parse('2026-09-29T15:30:00Z')},
  );
  assert.equal(future.action,'none');
  assert.equal(future.reason,'retry_waiting');

  const due=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    [
      ledger('incident','retry_pending','destination-a',{attempts:1,retryAt:'2026-09-29T15:20:00Z'}),
      ledger('incident','sent','destination-b'),
    ],
    {deploySha:sha,destinations,nowMs:Date.parse('2026-09-29T15:30:00Z')},
  );
  assert.equal(due.action,'send');
  assert.deepEqual(due.targetSlots,[0]);
});

test('RECOVERED sends once only when an incident alert was previously attempted',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z',sha,{id:1,windowMinutes:30}),
    lifecycle('recovered','2026-09-29T15:30:00Z',sha,{id:2,windowMinutes:60,signalCodes:[]}),
  ];
  const plan=planPostDeployRegressionAlert(
    history,
    [ledger('incident','sent','destination-a'),ledger('incident','sent','destination-b')],
    {deploySha:sha,destinations},
  );
  assert.equal(plan.action,'send');
  assert.equal(plan.kind,'recovery');

  const deduped=planPostDeployRegressionAlert(
    history,
    [
      ledger('incident','sent','destination-a'),
      ledger('incident','sent','destination-b'),
      ledger('recovery','sent','destination-a'),
      ledger('recovery','sent','destination-b'),
    ],
    {deploySha:sha,destinations},
  );
  assert.equal(deduped.action,'none');
  assert.equal(deduped.reason,'already_delivered');
});

test('WATCH recovery and incident recovery without prior alert attempt stay silent',()=>{
  const watchRecovery=planPostDeployRegressionAlert(
    [
      lifecycle('watch','2026-09-29T15:00:00Z'),
      lifecycle('recovered','2026-09-29T15:30:00Z'),
    ],
    [],
    {deploySha:sha,destinations},
  );
  assert.equal(watchRecovery.action,'none');
  assert.equal(watchRecovery.reason,'recovery_without_incident');

  const incidentRecovery=planPostDeployRegressionAlert(
    [
      lifecycle('incident','2026-09-29T15:00:00Z'),
      lifecycle('recovered','2026-09-29T15:30:00Z'),
    ],
    [],
    {deploySha:sha,destinations},
  );
  assert.equal(incidentRecovery.action,'none');
  assert.equal(incidentRecovery.reason,'recovery_without_prior_incident_alert');
});

test('new deployment gets an independent incident identity',()=>{
  assert.notEqual(postDeployRegressionIncidentId(sha),postDeployRegressionIncidentId(otherSha));
  const oldLedger=[ledger('incident','sent','destination-a',{deploySha:otherSha})];
  const plan=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    oldLedger,
    {deploySha:sha,destinations:[destinations[0]]},
  );
  assert.equal(plan.action,'send');
});

test('alert copy contains diagnostics and explicitly preserves no-auto-rollback policy',()=>{
  const plan=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    [],
    {deploySha:sha,destinations:[destinations[0]]},
  );
  const text=formatPostDeployRegressionAlert(plan);
  assert.match(text,/Post-deploy regression incident/);
  assert.match(text,/auth_failures_increased/);
  assert.match(text,/Автоматический rollback/);
  assert.match(text,/aaaaaaaaaaaa/);
});

test('delivery outcomes become dedicated release regression alert ops events',()=>{
  const plan=planPostDeployRegressionAlert(
    [lifecycle('incident')],
    [],
    {deploySha:sha,destinations:[destinations[0]]},
  );
  const sent=postDeployRegressionAlertOpsEvents(plan,{outcomes:[{slot:0,state:'sent'}]});
  assert.equal(sent.length,1);
  assert.equal(sent[0].source,'release_regression_alert');
  assert.equal(sent[0].code,'POST_DEPLOY_REGRESSION_INCIDENT_ALERT_SENT');

  const failed=postDeployRegressionAlertOpsEvents(plan,{outcomes:[{slot:0,state:'persistence_failure'}]});
  assert.equal(failed[0].severity,'error');
  assert.equal(failed[0].code,'POST_DEPLOY_REGRESSION_ALERT_PERSISTENCE_FAILED');

  const coerced=postDeployRegressionAlertOpsEvents(plan,{outcomes:[{slot:true,state:'SENT'}]});
  assert.deepEqual(coerced[0].meta.recipientSlots,[]);
  assert.equal(coerced[0].code,'POST_DEPLOY_REGRESSION_INCIDENT_ALERT_SENT');
});
