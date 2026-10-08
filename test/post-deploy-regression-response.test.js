import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planPostDeployRegressionResponseTransition,
  summarizePostDeployRegressionResponse,
} from '../src/post-deploy-regression-response.js';

const sha='a'.repeat(40);
const lifecycle=(state,at,id=101)=>({
  id,
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

test('response state rejects malformed deploy identity and malformed history containers',()=>{
  const malformed=summarizePostDeployRegressionResponse({},sha);
  assert.equal(malformed.available,false);
  assert.equal(malformed.reason,'no_incident');

  const invalidSha=summarizePostDeployRegressionResponse([], 'not-a-sha');
  assert.deepEqual(invalidSha,{
    available:false,
    reason:'missing_deploy_sha',
    incidentId:null,
    state:'unavailable',
    nextState:null,
  });
});

test('malformed timestamps and out-of-order response rows cannot advance incident response state',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z',201),
    response('resolved','2026-09-29T15:01:00Z'),
    response('investigating','not-a-date'),
    response('acknowledged','2026-09-29T15:05:00Z'),
    response('resolved','2026-09-29T15:06:00Z'),
  ];

  const status=summarizePostDeployRegressionResponse(history,sha);
  assert.equal(status.state,'acknowledged');
  assert.equal(status.nextState,'investigating');
  assert.deepEqual(status.history.map(item=>item.state),['acknowledged']);
  assert.equal(status.incidentEpisodeKey,'event-201');
});

test('a new incident episode on the same deploy resets manual response state and idempotency key',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z',301),
    response('acknowledged','2026-09-29T15:02:00Z'),
    response('investigating','2026-09-29T15:03:00Z'),
    lifecycle('recovered','2026-09-29T15:10:00Z',302),
    response('resolved','2026-09-29T15:12:00Z'),
    lifecycle('watch','2026-09-29T15:20:00Z',303),
    lifecycle('incident','2026-09-29T15:30:00Z',304),
  ];

  const status=summarizePostDeployRegressionResponse(history,sha);
  assert.equal(status.state,'new');
  assert.equal(status.nextState,'acknowledged');
  assert.equal(status.incidentEpisodeKey,'event-304');
  assert.deepEqual(status.history,[]);

  const plan=planPostDeployRegressionResponseTransition(history,sha,'acknowledged');
  assert.equal(plan.action,'record');
  assert.equal(plan.transitionKey,`release-regression-response:${sha}:event-304:acknowledged`);
});

test('response rows with an explicit different incident episode key are ignored',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z',401),
    {
      ...response('acknowledged','2026-09-29T15:05:00Z'),
      metadata:{deploySha:sha,responseState:'acknowledged',incidentEpisodeKey:'event-999'},
    },
  ];
  const status=summarizePostDeployRegressionResponse(history,sha);
  assert.equal(status.state,'new');
  assert.equal(status.nextState,'acknowledged');
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
  assert.equal(plan.transitionKey,`release-regression-response:${sha}:event-101:resolved`);
  assert.equal(plan.meta.incidentEpisodeKey,'event-101');
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



test('a forged RESOLVED event before recovery cannot silently close an active incident',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z'),
    response('acknowledged','2026-09-29T15:05:00Z'),
    response('investigating','2026-09-29T15:10:00Z'),
    response('resolved','2026-09-29T15:15:00Z'),
  ];
  const status=summarizePostDeployRegressionResponse(history,sha);
  assert.equal(status.state,'investigating');
  assert.equal(status.reason,'awaiting_recovery');
  assert.equal(status.nextState,null);
  assert.equal(status.resolvedAt,null);
  assert.deepEqual(status.history.map(item=>item.state),['acknowledged','investigating']);
});

test('recovery must precede RESOLVED in persisted event chronology',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z'),
    response('acknowledged','2026-09-29T15:05:00Z'),
    response('investigating','2026-09-29T15:10:00Z'),
    response('resolved','2026-09-29T15:20:00Z'),
    lifecycle('recovered','2026-09-29T15:30:00Z'),
  ];
  const prior=summarizePostDeployRegressionResponse(history,sha);
  assert.equal(prior.state,'investigating');
  assert.equal(prior.nextState,'resolved');
  const planned=planPostDeployRegressionResponseTransition(history,sha,'resolved');
  assert.equal(planned.action,'record');
  history.push(response('resolved','2026-09-29T15:35:00Z'));
  const after=summarizePostDeployRegressionResponse(history,sha);
  assert.equal(after.state,'resolved');
  assert.equal(after.resolvedAt,'2026-09-29T15:35:00.000Z');
});

test('manual incident response only accepts the next known state',()=>{
  const history=[lifecycle('incident','2026-09-29T15:00:00Z')];
  for(const target of ['resolved','investigating','other',{},false]){
    const decision=planPostDeployRegressionResponseTransition(history,sha,target);
    assert.equal(decision.action,'none');
  }
  assert.equal(planPostDeployRegressionResponseTransition(history,sha,'ACKNOWLEDGED').action,'record');
});

test('historical response from another deployment or incident episode is excluded',()=>{
  const history=[
    lifecycle('incident','2026-09-29T15:00:00Z',301),
    {...response('acknowledged','2026-09-29T15:05:00Z'),metadata:{deploySha:'b'.repeat(40),responseState:'acknowledged'}},
    {...response('acknowledged','2026-09-29T15:06:00Z'),metadata:{deploySha:sha,responseState:'acknowledged',incidentEpisodeKey:'event-999'}},
  ];
  const status=summarizePostDeployRegressionResponse(history,sha);
  assert.equal(status.state,'new');
  assert.equal(status.nextState,'acknowledged');
  assert.equal(status.incidentEpisodeKey,'event-301');
});
