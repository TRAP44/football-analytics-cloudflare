import test from 'node:test';
import assert from 'node:assert/strict';
import { planPostDeployRegressionLifecycle } from '../src/post-deploy-regression-lifecycle.js';

const sha='a'.repeat(40);
const otherSha='b'.repeat(40);

const report=(state,minutes=15,deploySha=sha)=>({
  deploySha,
  completedWindows:minutes===60?3:minutes===30?2:1,
  windows:[
    {minutes:15,phase:'complete',state:minutes===15?state:'healthy',signals:minutes===15&&state!=='healthy'?[{code:'error_volume_regression'}]:[]},
    ...(minutes>=30?[{minutes:30,phase:'complete',state:minutes===30?state:'healthy',signals:minutes===30&&state!=='healthy'?[{code:'auth_failures_increased'}]:[]}]:[]),
    ...(minutes>=60?[{minutes:60,phase:'complete',state,signals:state!=='healthy'?[{code:'latency_p95_regression'}]:[]}]:[]),
  ],
});

const event=(state,minutes,options={})=>({
  id:options.id ?? 101,
  created_at:options.createdAt || '2026-09-29T13:20:00Z',
  source:'release_regression',
  event_type:'post_deploy_regression',
  code:options.code || (state==='incident'?'POST_DEPLOY_REGRESSION_INCIDENT':state==='recovered'?'POST_DEPLOY_REGRESSION_RECOVERED':'POST_DEPLOY_REGRESSION_WATCH'),
  metadata:{
    deploySha:options.deploySha || sha,
    lifecycleState:state,
    windowMinutes:minutes,
    transitionKey:options.transitionKey || null,
  },
});

test('A healthy regression report creates no lifecycle transition',()=>{
  const plan=planPostDeployRegressionLifecycle(report('healthy',15),[]);
  assert.deepEqual(plan,{action:'none',reason:'healthy_without_active_regression'});
});

test('B first regression signal opens exactly one WATCH transition',()=>{
  const plan=planPostDeployRegressionLifecycle(report('watch',15),[]);
  assert.equal(plan.action,'record');
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_WATCH');
  assert.equal(plan.meta.windowMinutes,15);
  assert.equal(plan.transitionKey,`${sha}:root:watch`);
  assert.equal(plan.meta.transitionKey,plan.transitionKey);
});

test('C repeated WATCH is deduplicated across later windows',()=>{
  const history=[event('watch',15,{id:111})];
  const sameWindow=planPostDeployRegressionLifecycle(report('watch',15),history);
  const laterWindow=planPostDeployRegressionLifecycle(report('watch',30),history);
  assert.deepEqual(sameWindow,{action:'none',reason:'lifecycle_state_already_recorded'});
  assert.deepEqual(laterWindow,{action:'none',reason:'lifecycle_state_already_recorded'});
});

test('D confirmed regression escalates WATCH to one INCIDENT transition',()=>{
  const plan=planPostDeployRegressionLifecycle(report('incident',30),[event('watch',15,{id:121})]);
  assert.equal(plan.action,'record');
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_INCIDENT');
  assert.equal(plan.severity,'error');
  assert.deepEqual(plan.meta.signalCodes,['auth_failures_increased']);
  assert.equal(plan.transitionKey,`${sha}:121:incident`);
});

test('E repeated INCIDENT is deduplicated across later windows',()=>{
  const history=[event('watch',15,{id:131}),event('incident',30,{id:132,createdAt:'2026-09-29T13:35:00Z'})];
  const plan=planPostDeployRegressionLifecycle(report('incident',60),history);
  assert.deepEqual(plan,{action:'none',reason:'lifecycle_state_already_recorded'});
});

test('F recovery from WATCH records one RECOVERED transition',()=>{
  const plan=planPostDeployRegressionLifecycle(report('healthy',30),[event('watch',15,{id:141})]);
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_RECOVERED');
  assert.equal(plan.meta.previousLifecycleState,'watch');
  assert.equal(plan.transitionKey,`${sha}:141:recovered`);
});

test('G recovery from INCIDENT records once and later healthy runs stay silent',()=>{
  const incident=event('incident',30,{id:151});
  const recovery=planPostDeployRegressionLifecycle(report('healthy',60),[incident]);
  assert.equal(recovery.code,'POST_DEPLOY_REGRESSION_RECOVERED');
  const recoveredRow=event('recovered',60,{id:152,createdAt:'2026-09-29T14:05:00Z'});
  const repeated=planPostDeployRegressionLifecycle(report('healthy',60),[incident,recoveredRow]);
  assert.deepEqual(repeated,{action:'none',reason:'healthy_without_active_regression'});
});

test('H new deployment starts a new lifecycle generation',()=>{
  const old=event('watch',15,{id:161,deploySha:otherSha});
  const plan=planPostDeployRegressionLifecycle(report('watch',15,sha),[old]);
  assert.equal(plan.action,'record');
  assert.equal(plan.transitionKey,`${sha}:root:watch`);
});

test('I collecting/insufficient window creates no false lifecycle event',()=>{
  const plan=planPostDeployRegressionLifecycle({
    deploySha:sha,
    completedWindows:0,
    windows:[{minutes:15,phase:'collecting',state:'collecting'}],
  },[]);
  assert.deepEqual(plan,{action:'none',reason:'no_completed_window'});
});

test('J recovery transition identity is stable for retry after persistence uncertainty',()=>{
  const history=[event('incident',30,{id:171})];
  const first=planPostDeployRegressionLifecycle(report('healthy',60),history);
  const retry=planPostDeployRegressionLifecycle(report('healthy',60),history);
  assert.equal(first.transitionKey,retry.transitionKey);
  assert.equal(first.transitionKey,`${sha}:171:recovered`);
});

test('K concurrent planners produce the same atomic transition identity',()=>{
  const history=[event('watch',15,{id:181})];
  const first=planPostDeployRegressionLifecycle(report('incident',30),history);
  const second=planPostDeployRegressionLifecycle(report('incident',30),history);
  assert.equal(first.action,'record');
  assert.equal(second.action,'record');
  assert.equal(first.transitionKey,second.transitionKey);
  assert.equal(first.transitionKey,`${sha}:181:incident`);
});
