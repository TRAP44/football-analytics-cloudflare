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
});
