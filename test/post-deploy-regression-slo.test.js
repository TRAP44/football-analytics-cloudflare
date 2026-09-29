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
const lifecycle=(state,at,deploySha=sha)=>({
  created_at:at,source:'release_regression',event_type:'post_deploy_regression',
  metadata:{deploySha,lifecycleState:state},
});
const response=(state,at,deploySha=sha)=>({
  created_at:at,source:'release_regression_response',event_type:'incident_response',
  metadata:{deploySha,responseState:state},
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
