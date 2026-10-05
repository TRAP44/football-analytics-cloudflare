import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_DEPLOY_REGRESSION_ACK_SLO_MINUTES,
  POST_DEPLOY_REGRESSION_ACK_CRITICAL_MINUTES,
  POST_DEPLOY_REGRESSION_RECOVERY_SLO_MINUTES,
  buildPostDeployRegressionIncidentEpisode,
  buildPostDeployRegressionSloDashboard,
} from '../src/post-deploy-regression-slo.js';

const sha='a'.repeat(40);
const lifecycle=(state,at,deploySha=sha,overrides={})=>({
  id:overrides.id,
  created_at:at,source:'release_regression',event_type:'post_deploy_regression',
  transition_key:overrides.transitionKey,
  metadata:{deploySha,lifecycleState:state,transitionKey:overrides.transitionKey},
});
const response=(state,at,deploySha=sha,overrides={})=>({
  created_at:at,source:'release_regression_response',event_type:'incident_response',
  metadata:{
    deploySha,
    responseState:state,
    ...(overrides.incidentEpisodeKey?{incidentEpisodeKey:overrides.incidentEpisodeKey}:{}),
  },
});

test('SLO ignores malformed deployment identity, history containers and timestamps',()=>{
  assert.equal(buildPostDeployRegressionIncidentEpisode({},sha),null);
  assert.equal(buildPostDeployRegressionIncidentEpisode([], 'not-a-sha'),null);

  const history=[
    lifecycle('incident','not-a-date',sha,{id:1}),
    lifecycle('watch','2026-09-29T09:00:00Z',sha,{id:2}),
  ];
  assert.equal(buildPostDeployRegressionIncidentEpisode(history,sha),null);
});

test('SLO response sequence cannot be forged by pre-incident or out-of-order rows',()=>{
  const history=[
    response('acknowledged','2026-09-29T09:50:00Z'),
    lifecycle('incident','2026-09-29T10:00:00Z',sha,{id:11}),
    response('resolved','2026-09-29T10:01:00Z'),
    response('investigating','2026-09-29T10:05:00Z'),
    response('acknowledged','2026-09-29T10:10:00Z'),
    response('resolved','2026-09-29T10:20:00Z'),
    lifecycle('recovered','2026-09-29T10:30:00Z',sha,{id:12}),
    response('investigating','2026-09-29T10:35:00Z'),
    response('resolved','2026-09-29T10:40:00Z'),
  ];
  const row=buildPostDeployRegressionIncidentEpisode(history,sha,Date.parse('2026-09-29T11:00:00Z'));
  assert.equal(row.incidentEpisodeKey,'event-11');
  assert.equal(row.ackLatencyMinutes,10);
  assert.equal(row.investigationLatencyMinutes,35);
  assert.equal(row.resolutionLatencyMinutes,40);
  assert.equal(row.postRecoveryResolutionMinutes,10);
});

test('multiple incidents on one deploy are separate SLO episodes and current selects the latest',()=>{
  const history=[
    lifecycle('incident','2026-09-29T10:00:00Z',sha,{id:21}),
    response('acknowledged','2026-09-29T10:20:00Z',sha,{incidentEpisodeKey:'event-21'}),
    response('investigating','2026-09-29T10:25:00Z',sha,{incidentEpisodeKey:'event-21'}),
    lifecycle('recovered','2026-09-29T11:00:00Z',sha,{id:22}),
    response('resolved','2026-09-29T11:10:00Z',sha,{incidentEpisodeKey:'event-21'}),
    lifecycle('watch','2026-09-29T12:00:00Z',sha,{id:23}),
    lifecycle('incident','2026-09-29T12:30:00Z',sha,{id:24}),
  ];

  const latest=buildPostDeployRegressionIncidentEpisode(history,sha,Date.parse('2026-09-29T13:01:00Z'));
  assert.equal(latest.incidentEpisodeKey,'event-24');
  assert.equal(latest.incidentAt,'2026-09-29T12:30:00.000Z');
  assert.equal(latest.ackStatus,'breached');

  const dashboard=buildPostDeployRegressionSloDashboard(history,{
    activeDeploySha:sha,
    asOfMs:Date.parse('2026-09-29T13:01:00Z'),
  });
  assert.equal(dashboard.summary.incidents,2);
  assert.equal(dashboard.current.incidentEpisodeKey,'event-24');
  assert.deepEqual(dashboard.episodes.map(item=>item.incidentEpisodeKey),['event-24','event-21']);
});

test('explicit response episode mismatch is ignored by SLO accounting',()=>{
  const history=[
    lifecycle('incident','2026-09-29T10:00:00Z',sha,{id:31}),
    response('acknowledged','2026-09-29T10:05:00Z',sha,{incidentEpisodeKey:'event-999'}),
  ];
  const row=buildPostDeployRegressionIncidentEpisode(history,sha,Date.parse('2026-09-29T10:40:00Z'));
  assert.equal(row.acknowledgedAt,null);
  assert.equal(row.ackStatus,'breached');
});

test('dashboard limit rejects boolean/fraction coercion and keeps the default cap',()=>{
  const deploys=Array.from({length:25},(_,index)=>index.toString(16).padStart(40,'0'));
  const history=deploys.map((deploySha,index)=>
    lifecycle('incident',new Date(Date.parse('2026-09-01T00:00:00Z')+index*60_000).toISOString(),deploySha,{id:index+1})
  );
  assert.equal(buildPostDeployRegressionSloDashboard(history,{limit:true}).episodes.length,20);
  assert.equal(buildPostDeployRegressionSloDashboard(history,{limit:'2.5'}).episodes.length,20);
  assert.equal(buildPostDeployRegressionSloDashboard(history,{limit:'5'}).episodes.length,5);
});

test('uses the existing operational incident SLO thresholds',()=>{
  assert.equal(POST_DEPLOY_REGRESSION_ACK_SLO_MINUTES,30);
  assert.equal(POST_DEPLOY_REGRESSION_ACK_CRITICAL_MINUTES,120);
  assert.equal(POST_DEPLOY_REGRESSION_RECOVERY_SLO_MINUTES,360);
});

test('calculates incident to ACK, investigation, recovery and resolution latencies',()=>{
  const history=[
    lifecycle('incident','2026-09-29T10:00:00Z'),
    response('acknowledged','2026-09-29T10:20:00Z'),
    response('investigating','2026-09-29T10:35:00Z'),
    lifecycle('recovered','2026-09-29T11:30:00Z'),
    response('resolved','2026-09-29T11:45:00Z'),
  ];
  const row=buildPostDeployRegressionIncidentEpisode(history,sha,Date.parse('2026-09-29T12:00:00Z'));
  assert.equal(row.ackLatencyMinutes,20);
  assert.equal(row.investigationLatencyMinutes,35);
  assert.equal(row.recoveryLatencyMinutes,90);
  assert.equal(row.resolutionLatencyMinutes,105);
  assert.equal(row.postRecoveryResolutionMinutes,15);
  assert.equal(row.ackStatus,'met');
  assert.equal(row.recoveryStatus,'met');
});

test('ACK becomes overdue after 30 minutes and critical after 120 while incident remains active',()=>{
  const history=[lifecycle('incident','2026-09-29T10:00:00Z')];
  const overdue=buildPostDeployRegressionIncidentEpisode(history,sha,Date.parse('2026-09-29T10:31:00Z'));
  assert.equal(overdue.ackStatus,'breached');
  assert.equal(overdue.ackCriticalOverdue,false);

  const critical=buildPostDeployRegressionIncidentEpisode(history,sha,Date.parse('2026-09-29T12:01:00Z'));
  assert.equal(critical.ackStatus,'breached');
  assert.equal(critical.ackCriticalOverdue,true);
});

test('recovery becomes overdue only at the existing 360 minute threshold',()=>{
  const history=[lifecycle('incident','2026-09-29T10:00:00Z')];
  const early=buildPostDeployRegressionIncidentEpisode(history,sha,Date.parse('2026-09-29T15:59:00Z'));
  assert.equal(early.recoveryStatus,'pending');
  const late=buildPostDeployRegressionIncidentEpisode(history,sha,Date.parse('2026-09-29T16:00:00Z'));
  assert.equal(late.recoveryStatus,'breached');
});

test('investigation and resolution are latency metrics without invented SLO targets',()=>{
  const dashboard=buildPostDeployRegressionSloDashboard([
    lifecycle('incident','2026-09-29T10:00:00Z'),
    response('acknowledged','2026-09-29T10:10:00Z'),
    response('investigating','2026-09-29T10:20:00Z'),
  ],{activeDeploySha:sha,asOfMs:Date.parse('2026-09-29T10:25:00Z')});
  assert.equal(dashboard.thresholds.investigationTargetMinutes,null);
  assert.equal(dashboard.thresholds.resolutionTargetMinutes,null);
  assert.equal(dashboard.current.investigationLatencyMinutes,20);
  assert.equal(dashboard.current.resolutionLatencyMinutes,null);
});

test('dashboard aggregates SLO compliance across deployment generations',()=>{
  const other='b'.repeat(40);
  const history=[
    lifecycle('incident','2026-09-29T10:00:00Z',sha),
    response('acknowledged','2026-09-29T10:20:00Z',sha),
    lifecycle('recovered','2026-09-29T11:00:00Z',sha),
    lifecycle('incident','2026-09-28T10:00:00Z',other),
    response('acknowledged','2026-09-28T10:40:00Z',other),
    lifecycle('recovered','2026-09-28T17:00:00Z',other),
  ];
  const dashboard=buildPostDeployRegressionSloDashboard(history,{
    activeDeploySha:sha,
    asOfMs:Date.parse('2026-09-29T12:00:00Z'),
  });
  assert.equal(dashboard.summary.incidents,2);
  assert.equal(dashboard.summary.ackEligible,2);
  assert.equal(dashboard.summary.ackMet,1);
  assert.equal(dashboard.summary.ackBreached,1);
  assert.equal(dashboard.summary.ackSloPct,50);
  assert.equal(dashboard.summary.recoveryEligible,2);
  assert.equal(dashboard.summary.recoveryMet,1);
  assert.equal(dashboard.summary.recoveryBreached,1);
  assert.equal(dashboard.summary.recoverySloPct,50);
});
