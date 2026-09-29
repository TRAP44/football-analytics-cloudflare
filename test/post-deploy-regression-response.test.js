import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planPostDeployRegressionResponseTransition,
  summarizePostDeployRegressionResponse,
} from '../src/post-deploy-regression-response.js';

const sha='a'.repeat(40);
const lifecycle=(state,at)=>({
  created_at:at,
  source:'release_regression',
  event_type:'post_deploy_regression',
  code:`POST_DEPLOY_REGRESSION_${state.toUpperCase()}`,
  metadata:{deploySha:sha,lifecycleState:state},
});
const response=(state,at)=>({
  created_at:at,
  source:'release_regression_response',
  event_type:'incident_response',
  code:`POST_DEPLOY_REGRESSION_${state.toUpperCase()}`,
  metadata:{deploySha:sha,responseState:state},
});

test('no regression incident cannot be acknowledged',()=>{
  const plan=planPostDeployRegressionResponseTransition([lifecycle('watch','2026-09-29T15:00:00Z')],sha,'acknowledged');
  assert.equal(plan.action,'none');
  assert.equal(plan.reason,'no_incident');
});

test('incident response follows NEW -> ACKNOWLEDGED -> INVESTIGATING',()=>{
  const history=[lifecycle('incident','2026-09-29T15:00:00Z')];
  const ack=planPostDeployRegressionResponseTransition(history,sha,'acknowledged');
  assert.equal(ack.action,'record');
  assert.equal(ack.meta.previousResponseState,'new');

  history.push(response('acknowledged','2026-09-29T15:05:00Z'));
  const investigating=planPostDeployRegressionResponseTransition(history,sha,'investigating');
  assert.equal(investigating.action,'record');
  assert.equal(investigating.meta.previousResponseState,'acknowledged');
});

test('incident cannot be manually resolved before lifecycle recovery',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z'),
    response('acknowledged','2026-09-29T15:05:00Z'),
    response('investigating','2026-09-29T15:10:00Z'),
  ];
  const status=summarizePostDeployRegressionResponse(history,sha);
  assert.equal(status.state,'investigating');
  assert.equal(status.nextState,null);
  assert.equal(status.reason,'awaiting_recovery');
  const plan=planPostDeployRegressionResponseTransition(history,sha,'resolved');
  assert.equal(plan.action,'none');
  assert.equal(plan.reason,'invalid_transition');
});

test('RECOVERED unlocks one RESOLVED transition',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z'),
    response('acknowledged','2026-09-29T15:05:00Z'),
    response('investigating','2026-09-29T15:10:00Z'),
    lifecycle('recovered','2026-09-29T15:30:00Z'),
  ];
  const plan=planPostDeployRegressionResponseTransition(history,sha,'resolved');
  assert.equal(plan.action,'record');
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_RESOLVED');
  assert.equal(plan.transitionKey,`release-regression-response:${sha}:resolved`);
});

test('response transitions are idempotent and deployment scoped',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z'),
    response('acknowledged','2026-09-29T15:05:00Z'),
  ];
  const duplicate=planPostDeployRegressionResponseTransition(history,sha,'acknowledged');
  assert.equal(duplicate.action,'none');
  assert.equal(duplicate.reason,'already_recorded');

  const other='b'.repeat(40);
  const status=summarizePostDeployRegressionResponse(history,other);
  assert.equal(status.available,false);
  assert.equal(status.reason,'no_incident');
});
